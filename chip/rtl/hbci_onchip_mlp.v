// HBCI v0.4 research block: eight-input, four-hidden, two-output quantised MLP.
// Real synthesizable inference logic, NOT an implant-ready device or a trained
// speech/thought decoder. Weights/centres must be learned and provisioned offline.
// 1 MAC is time-shared: 32 hidden products + 8 output products per inference.
// Verilog-2005. Models are writable ONLY while enable=0 to avoid torn weights.
`timescale 1ns/1ps
`default_nettype none

module hbci_onchip_mlp (
    input  wire               clk,
    input  wire               rst_n,
    input  wire               enable,
    input  wire [5:0]         feature_shift,
    input  wire               feat_valid,
    input  wire [2:0]         feat_ch,
    input  wire [31:0]        feat_energy,
    input  wire [31:0]        feat_ts,
    input  wire               feat_saturated,
    input  wire               model_we,
    input  wire [5:0]         model_addr,
    input  wire signed [31:0] model_data,
    output wire               model_ready,
    output reg                pred_valid,
    input  wire               pred_ready,
    output reg                pred_class,
    output reg signed [31:0]  pred_margin,
    output reg [31:0]         pred_ts,
    output reg [15:0]         pred_seq,
    output reg [31:0]         stat_frames,
    output reg [31:0]         stat_skipped,
    output reg [31:0]         stat_saturated,
    output reg [31:0]         stat_pred_drop
);
    // Address map: 0..31 W1[row*8+col], 32..35 B1,
    // 36..43 W2[row*4+col], 44..45 B2, 46..53 input centres.
    reg signed [7:0]  w1 [0:31];
    reg signed [31:0] b1 [0:3];
    reg signed [7:0]  w2 [0:7];
    reg signed [31:0] b2 [0:1];
    reg signed [15:0] centre [0:7];
    reg [53:0] written;
    assign model_ready = &written;

    // The collector continues gathering the next frame while one frame
    // is being inferred. Snapshot prevents cross-frame corruption.
    reg signed [7:0] collected [0:7];
    reg signed [7:0] snapshot  [0:7];
    reg signed [7:0] hidden    [0:3];
    reg [7:0] seen;
    reg [31:0] frame_ts;

    // 34-bit signed arithmetic: an unsigned 32-bit energy plus signed offset.
    wire [31:0] scaled_energy = feat_energy >> feature_shift;
    wire signed [33:0] centred_energy =
        $signed({2'b00, scaled_energy}) - $signed(centre[feat_ch]);
    wire signed [7:0] q_input =
        (centred_energy > 34'sd127)  ? 8'sh7f :
        (centred_energy < -34'sd128) ? 8'sh80 :
                                      centred_energy[7:0];
    wire [7:0] channel_bit = (8'b00000001 << feat_ch);
    wire [7:0] next_mask   = seen | channel_bit;

    localparam [1:0] IDLE=2'd0, HIDDEN_MAC=2'd1, OUT_MAC=2'd2;
    reg [1:0] state;
    reg [1:0] hi;
    reg [2:0] xi;
    reg       oi;
    reg [1:0] hj;
    reg signed [39:0] acc;
    reg signed [39:0] logit0;
    reg [15:0] next_seq;

    wire signed [15:0] hidden_product =
        $signed(snapshot[xi]) * $signed(w1[{hi,xi}]);
    wire signed [15:0] output_product =
        $signed(hidden[hj]) * $signed(w2[{oi,hj}]);
    wire signed [39:0] hidden_sum = acc + $signed(hidden_product);
    wire signed [39:0] output_sum = acc + $signed(output_product);

    // ReLU activation, Q7 scaling and saturation to positive int8.
    function [7:0] relu_q7;
        input signed [39:0] value;
        reg signed [39:0] scaled;
        begin
            scaled = value >>> 7;
            if (scaled <= 0)         relu_q7 = 8'd0;
            else if (scaled >= 127)  relu_q7 = 8'd127;
            else                     relu_q7 = scaled[7:0];
        end
    endfunction

    function signed [31:0] sat32;
        input signed [40:0] value;
        begin
            if (value > 41'sd2147483647)
                sat32 = 32'sh7fff_ffff;
            else if (value < -41'sd2147483648)
                sat32 = 32'sh8000_0000;
            else
                sat32 = value[31:0];
        end
    endfunction

    integer k;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            written <= 54'd0;
            seen <= 8'd0;
            frame_ts <= 32'd0;
            state <= IDLE;
            hi <= 2'd0;
            xi <= 3'd0;
            oi <= 1'b0;
            hj <= 2'd0;
            acc <= 40'sd0;
            logit0 <= 40'sd0;
            next_seq <= 16'd0;
            pred_valid <= 1'b0;
            pred_class <= 1'b0;
            pred_margin <= 32'sd0;
            pred_ts <= 32'd0;
            pred_seq <= 16'd0;
            stat_frames <= 32'd0;
            stat_skipped <= 32'd0;
            stat_saturated <= 32'd0;
            stat_pred_drop <= 32'd0;
            for (k=0; k<32; k=k+1) w1[k] <= 8'sd0;
            for (k=0; k<4; k=k+1) begin
                b1[k] <= 32'sd0;
                hidden[k] <= 8'sd0;
            end
            for (k=0; k<8; k=k+1) begin
                w2[k] <= 8'sd0;
                centre[k] <= 16'sd0;
                collected[k] <= 8'sd0;
                snapshot[k] <= 8'sd0;
            end
            for (k=0; k<2; k=k+1) b2[k] <= 32'sd0;
        end else begin
            // Inference weights cannot change while live decoding is active.
            if (model_we && !enable && model_addr < 6'd54) begin
                written[model_addr] <= 1'b1;
                if (model_addr < 6'd32)
                    w1[model_addr[4:0]] <= model_data[7:0];
                else if (model_addr < 6'd36)
                    b1[model_addr-6'd32] <= model_data;
                else if (model_addr < 6'd44)
                    w2[model_addr-6'd36] <= model_data[7:0];
                else if (model_addr < 6'd46)
                    b2[model_addr-6'd44] <= model_data;
                else
                    centre[model_addr-6'd46] <= model_data[15:0];
            end

            if (pred_valid && pred_ready) pred_valid <= 1'b0;

            if (!enable) begin
                seen <= 8'd0;
                state <= IDLE;
                pred_valid <= 1'b0; // do not leak a previous session's prediction
            end else begin
                // The input collector never waits for the inference engine.
                if (feat_valid) begin
                    if (feat_saturated) begin
                        seen <= 8'd0; // reject suspect window; do not mix frames
                        stat_saturated <= stat_saturated + 32'd1;
                    end else if ((seen & channel_bit) != 8'd0) begin
                        // Repeated channel without a complete frame: restart.
                        seen <= channel_bit;
                        collected[feat_ch] <= q_input;
                        stat_skipped <= stat_skipped + 32'd1;
                    end else if (next_mask == 8'hff) begin
                        seen <= 8'd0;
                        collected[feat_ch] <= q_input;
                        stat_frames <= stat_frames + 32'd1;
                        if (state != IDLE || !model_ready) begin
                            stat_skipped <= stat_skipped + 32'd1;
                        end else begin
                            for (k=0; k<8; k=k+1)
                                snapshot[k] <= (feat_ch == k) ? q_input : collected[k];
                            frame_ts <= feat_ts;
                            hi <= 2'd0;
                            xi <= 3'd0;
                            acc <= $signed(b1[0]);
                            state <= HIDDEN_MAC;
                        end
                    end else begin
                        seen <= next_mask;
                        collected[feat_ch] <= q_input;
                    end
                end

                case (state)
                    HIDDEN_MAC: begin
                        if (xi == 3'd7) begin
                            hidden[hi] <= relu_q7(hidden_sum);
                            xi <= 3'd0;
                            if (hi == 2'd3) begin
                                oi <= 1'b0;
                                hj <= 2'd0;
                                acc <= $signed(b2[0]);
                                state <= OUT_MAC;
                            end else begin
                                hi <= hi + 2'd1;
                                acc <= $signed(b1[hi + 2'd1]);
                            end
                        end else begin
                            acc <= hidden_sum;
                            xi <= xi + 3'd1;
                        end
                    end

                    OUT_MAC: begin
                        if (hj == 2'd3) begin
                            hj <= 2'd0;
                            if (!oi) begin
                                logit0 <= output_sum;
                                oi <= 1'b1;
                                acc <= $signed(b2[1]);
                            end else begin
                                if (!pred_valid || pred_ready) begin
                                    pred_valid <= 1'b1;
                                    pred_class <= (output_sum > logit0);
                                    pred_margin <= sat32(
                                        $signed({output_sum[39],output_sum}) -
                                        $signed({logit0[39],logit0})
                                    );
                                    pred_ts <= frame_ts;
                                    pred_seq <= next_seq;
                                end else begin
                                    stat_pred_drop <= stat_pred_drop + 32'd1;
                                end
                                next_seq <= next_seq + 16'd1;
                                state <= IDLE;
                            end
                        end else begin
                            acc <= output_sum;
                            hj <= hj + 2'd1;
                        end
                    end
                    default: begin end
                endcase
            end
        end
    end
endmodule

`default_nettype wire
