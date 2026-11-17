// ============================================================================
// HBCI-02 — integrated digital top (hbci02_digital_top), v0.4
// ----------------------------------------------------------------------------
// ADC-style sample input -> hbci_readout_core (v0.3 DSP: RAW / EVENT / FEATURE /
// HYBRID records) -> FEATURE tap -> hbci_ai_decoder (on-chip inference) ->
// predictions, with a synchronous 8-bit-address / 32-bit-data register bus for
// configuration, model loading, status, counters, diagnostics and the
// prediction FIFO, plus a built-in self-test (hbci_bist) that drives the whole
// path from an on-chip LFSR and folds every record and prediction into a
// signature register (known-answer test for silicon bring-up).
//
// Register map: docs/AI_DECODER.md section 4. The chip-level wrapper
// (rtl/hbci02_chip_top.v) serialises this bus and the sample/record streams.
//
// Verilog-2005, single clock, asynchronous active-low reset, every register
// reset. Lint-clean under verilator -Wall. Supersedes rtl/hbci_v04_digital_top.v.
// ============================================================================
`timescale 1ns/1ps
`default_nettype none
/* verilator lint_off DECLFILENAME */

module hbci02_digital_top #(
    parameter integer NUM_CH    = 8,
    parameter integer CH_W      = 3,
    parameter integer SAMPLE_W  = 16,
    parameter integer TS_W      = 32,
    parameter integer SEQ_W     = 16,
    parameter integer FIFO_LOG2 = 4,
    parameter integer WIN_W     = 10,
    parameter integer ACC_W     = 48,
    parameter integer WIN_IDX_W = 16,
    parameter integer NH        = 4,
    parameter integer NO        = 2,
    parameter integer PRED_LOG2 = 2
) (
    input  wire                       clk,
    input  wire                       rst_n,
    // register bus: one write per cycle (reg_wr), combinational read data
    input  wire                       reg_wr,
    input  wire [7:0]                 reg_addr,
    input  wire [31:0]                reg_wdata,
    output reg  [31:0]                reg_rdata,
    // sample input (ADC style, no back-pressure)
    input  wire                       in_valid,
    input  wire [CH_W-1:0]            in_channel,
    input  wire signed [SAMPLE_W-1:0] in_sample,
    // record output (valid/ready)
    output wire                       rec_valid,
    input  wire                       rec_ready,
    output wire [1:0]                 rec_type,
    output wire [CH_W-1:0]            rec_channel,
    output wire [3:0]                 rec_flags,
    output wire [SEQ_W-1:0]           rec_seq,
    output wire [TS_W-1:0]            rec_ts,
    output wire [31:0]                rec_data,
    // direct prediction pins (when CTRL.pred_direct_en)
    output wire                       pred_strobe,
    output wire [1:0]                 pred_class_out,
    output wire                       pred_irq          // prediction FIFO not empty
);
    localparam [31:0] ID = 32'h4842_0204;              // "HB", 0x02, v0.4

    // ----------------------------------------------------------- registers
    reg        cfg_session_en, cfg_ai_en, cfg_bist_en, cfg_pred_direct;
    reg [1:0]  cfg_mode;
    reg [SAMPLE_W-1:0] cfg_threshold, cfg_hysteresis;
    reg [7:0]  cfg_refractory;
    reg [3:0]  cfg_alpha_shift;
    reg signed [15:0] cfg_b0, cfg_b1, cfg_b2, cfg_a1, cfg_a2;
    reg [3:0]  cfg_win_log2;
    reg [5:0]  cfg_energy_shift;
    reg [7:0]  cfg_ch_mask;
    reg [TS_W-1:0] cfg_frame_span;
    reg        feat_sync;                               // one-cycle pulse
    reg        pred_ack;                                // one-cycle pulse
    reg        model_verify, model_clear_rej;           // one-cycle pulses
    reg        bist_start, bist_clear;                  // one-cycle pulses
    reg [31:0] bist_len;

    wire wr = reg_wr & ~cfg_bist_en | reg_wr & (reg_addr == 8'h01 | reg_addr == 8'h3E | reg_addr == 8'h3F);
    wire w_ctrl = wr & (reg_addr == 8'h01);

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cfg_session_en <= 1'b0; cfg_ai_en <= 1'b0; cfg_bist_en <= 1'b0; cfg_pred_direct <= 1'b0;
            cfg_mode <= 2'd0; cfg_threshold <= {SAMPLE_W{1'b0}}; cfg_hysteresis <= {SAMPLE_W{1'b0}};
            cfg_refractory <= 8'd0; cfg_alpha_shift <= 4'd0;
            cfg_b0 <= 16'sd0; cfg_b1 <= 16'sd0; cfg_b2 <= 16'sd0; cfg_a1 <= 16'sd0; cfg_a2 <= 16'sd0;
            cfg_win_log2 <= 4'd0; cfg_energy_shift <= 6'd0; cfg_ch_mask <= 8'hFF;
            cfg_frame_span <= {TS_W{1'b1}};
            feat_sync <= 1'b0; pred_ack <= 1'b0; model_verify <= 1'b0; model_clear_rej <= 1'b0;
            bist_start <= 1'b0; bist_clear <= 1'b0; bist_len <= 32'd0;
        end else begin
            feat_sync <= w_ctrl & reg_wdata[4];
            pred_ack <= wr & (reg_addr == 8'h34) & reg_wdata[0];
            model_verify <= wr & (reg_addr == 8'h39) & reg_wdata[0];
            model_clear_rej <= wr & (reg_addr == 8'h3A);
            bist_start <= wr & (reg_addr == 8'h3E) & reg_wdata[0];
            bist_clear <= wr & (reg_addr == 8'h3E) & reg_wdata[1];
            if (wr) begin
                case (reg_addr)
                    8'h01: begin
                        cfg_session_en <= reg_wdata[0];
                        cfg_mode <= reg_wdata[2:1];
                        cfg_ai_en <= reg_wdata[3];
                        cfg_bist_en <= reg_wdata[5];
                        cfg_pred_direct <= reg_wdata[6];
                    end
                    8'h02: cfg_threshold <= reg_wdata[SAMPLE_W-1:0];
                    8'h03: cfg_hysteresis <= reg_wdata[SAMPLE_W-1:0];
                    8'h04: cfg_refractory <= reg_wdata[7:0];
                    8'h05: cfg_alpha_shift <= reg_wdata[3:0];
                    8'h06: cfg_b0 <= reg_wdata[15:0];
                    8'h07: cfg_b1 <= reg_wdata[15:0];
                    8'h08: cfg_b2 <= reg_wdata[15:0];
                    8'h09: cfg_a1 <= reg_wdata[15:0];
                    8'h0A: cfg_a2 <= reg_wdata[15:0];
                    8'h0B: cfg_win_log2 <= reg_wdata[3:0];
                    8'h0C: cfg_energy_shift <= reg_wdata[5:0];
                    8'h0D: cfg_ch_mask <= reg_wdata[7:0];
                    8'h0E: cfg_frame_span <= reg_wdata[TS_W-1:0];
                    8'h3F: bist_len <= reg_wdata;
                    default: begin end
                endcase
            end
        end
    end

    // --------------------------------------------------------------- BIST
    // While CTRL.bist_en = 1 the LFSR replaces the external samples, the record
    // output is consumed internally and folded into the signature, and so is every
    // prediction. The external record output stays silent.
    wire                       bist_valid;
    wire [CH_W-1:0]            bist_ch;
    wire signed [SAMPLE_W-1:0] bist_sample;
    wire                       core_in_valid = cfg_bist_en ? bist_valid : in_valid;
    wire [CH_W-1:0]            core_in_ch    = cfg_bist_en ? bist_ch : in_channel;
    wire signed [SAMPLE_W-1:0] core_in_smp   = cfg_bist_en ? bist_sample : in_sample;
    wire                       core_rec_valid;
    wire                       core_rec_ready = cfg_bist_en ? 1'b1 : rec_ready;
    assign rec_valid = core_rec_valid & ~cfg_bist_en;

    // --------------------------------------------------------- readout core
    wire [TS_W-1:0] stat_samples, stat_rejected;
    wire [31:0] stat_drop_raw, stat_drop_event, stat_drop_feature, stat_event_missed, stat_fifo_hwm;
    wire                 feat_valid, feat_sat;
    wire [CH_W-1:0]      feat_ch;
    wire [31:0]          feat_energy;
    wire [TS_W-1:0]      feat_ts;
    wire [WIN_IDX_W-1:0] feat_win;

    hbci_readout_core #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W), .SEQ_W(SEQ_W),
        .FIFO_LOG2(FIFO_LOG2), .WIN_W(WIN_W), .ACC_W(ACC_W), .WIN_IDX_W(WIN_IDX_W)
    ) u_readout (
        .clk(clk), .rst_n(rst_n),
        .cfg_session_en(cfg_session_en), .cfg_mode(cfg_mode),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .cfg_b0(cfg_b0), .cfg_b1(cfg_b1), .cfg_b2(cfg_b2), .cfg_a1(cfg_a1), .cfg_a2(cfg_a2),
        .cfg_win_log2(cfg_win_log2), .cfg_energy_shift(cfg_energy_shift), .feat_sync(feat_sync),
        .in_valid(core_in_valid), .in_channel(core_in_ch), .in_sample(core_in_smp),
        .rec_valid(core_rec_valid), .rec_ready(core_rec_ready),
        .rec_type(rec_type), .rec_channel(rec_channel), .rec_flags(rec_flags),
        .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .stat_samples(stat_samples), .stat_rejected(stat_rejected),
        .stat_drop_raw(stat_drop_raw), .stat_drop_event(stat_drop_event),
        .stat_drop_feature(stat_drop_feature), .stat_event_missed(stat_event_missed),
        .stat_fifo_hwm(stat_fifo_hwm),
        .ai_feat_valid(feat_valid), .ai_feat_ch(feat_ch), .ai_feat_energy(feat_energy),
        .ai_feat_ts(feat_ts), .ai_feat_saturated(feat_sat), .ai_feat_win(feat_win)
    );

    // ------------------------------------------------------------ decoder
    wire        model_region = (reg_addr >= 8'h40) & (reg_addr < 8'h6E);
    wire        model_we = wr & model_region;
    wire [5:0]  model_addr = reg_addr[5:0] - 6'd0;      // 0x40 -> 0 (low six bits of 0x40..0x6D are 0..45)
    wire [31:0] model_rdata, crc_expected;
    wire        model_valid, model_error, model_busy, model_rejected;
    wire [15:0] model_id;
    wire [31:0] stat_model_wr_rej;
    wire        pred_valid;
    wire [1:0]  pred_class;
    wire [31:0] pred_margin;
    wire [TS_W-1:0] pred_ts;
    wire [WIN_IDX_W-1:0] pred_frame_id;
    wire [15:0] pred_seq;
    wire [3:0]  pred_flags;
    wire [PRED_LOG2:0] pred_count;
    wire        pred_strobe_i;
    wire [1:0]  pred_class_direct;
    wire [31:0] ai_frames, ai_pred, ai_incomplete, ai_dup, ai_late, ai_span, ai_busy, ai_pred_drop,
                ai_nomodel, ai_sat_frames;
    wire [WIN_IDX_W-1:0] last_frame_id;
    wire [7:0]  last_missing, last_sat;
    wire [63:0] last_x, last_h;
    wire [127:0] last_logit;
    wire [TS_W-1:0] last_ts;
    wire        bist_pred_pop;
    wire        pred_pop = cfg_bist_en ? bist_pred_pop : pred_ack;

    hbci_ai_decoder #(
        .NH(NH), .NO(NO), .TS_W(TS_W), .WIN_IDX_W(WIN_IDX_W), .PRED_LOG2(PRED_LOG2)
    ) u_ai (
        .clk(clk), .rst_n(rst_n),
        .cfg_ai_en(cfg_session_en & cfg_ai_en), .feat_sync(feat_sync),
        .cfg_ch_mask(cfg_ch_mask), .cfg_frame_span(cfg_frame_span),
        .feat_valid(feat_valid), .feat_ch(feat_ch), .feat_energy(feat_energy), .feat_ts(feat_ts),
        .feat_sat(feat_sat), .feat_win(feat_win),
        .model_we(model_we), .model_addr(model_addr), .model_wdata(reg_wdata), .model_rdata(model_rdata),
        .crc_we(wr & (reg_addr == 8'h38)), .crc_wdata(reg_wdata), .crc_expected(crc_expected),
        .model_verify(model_verify), .model_clear_rej(model_clear_rej),
        .model_valid(model_valid), .model_error(model_error), .model_busy(model_busy),
        .model_rejected(model_rejected), .model_id(model_id), .stat_model_wr_rej(stat_model_wr_rej),
        .pred_valid(pred_valid), .pred_ready(pred_pop), .pred_class(pred_class), .pred_margin(pred_margin),
        .pred_ts(pred_ts), .pred_frame_id(pred_frame_id), .pred_seq(pred_seq), .pred_flags(pred_flags),
        .pred_count(pred_count), .pred_strobe(pred_strobe_i), .pred_class_direct(pred_class_direct),
        .stat_frames(ai_frames), .stat_pred(ai_pred), .stat_incomplete(ai_incomplete), .stat_dup(ai_dup),
        .stat_late(ai_late), .stat_span(ai_span), .stat_busy(ai_busy), .stat_pred_drop(ai_pred_drop),
        .stat_nomodel(ai_nomodel), .stat_sat_frames(ai_sat_frames),
        .last_frame_id(last_frame_id), .last_missing(last_missing), .last_sat(last_sat),
        .last_x(last_x), .last_h(last_h), .last_logit(last_logit), .last_ts(last_ts)
    );
    assign pred_strobe    = pred_strobe_i & cfg_pred_direct;
    assign pred_class_out = cfg_pred_direct ? pred_class_direct : 2'd0;
    assign pred_irq       = pred_valid & ~cfg_bist_en;

    // ------------------------------------------------------------- BIST block
    wire [31:0] bist_sig, bist_count;
    wire        bist_running;
    hbci_bist #(.CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W), .SEQ_W(SEQ_W), .WIN_IDX_W(WIN_IDX_W)) u_bist (
        .clk(clk), .rst_n(rst_n), .enable(cfg_bist_en), .start(bist_start), .clear(bist_clear),
        .len(bist_len), .running(bist_running),
        .smp_valid(bist_valid), .smp_ch(bist_ch), .smp_sample(bist_sample),
        .rec_valid(core_rec_valid & cfg_bist_en), .rec_type(rec_type), .rec_channel(rec_channel),
        .rec_flags(rec_flags), .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .pred_valid(pred_valid & cfg_bist_en), .pred_pop(bist_pred_pop), .pred_class(pred_class),
        .pred_margin(pred_margin), .pred_ts(pred_ts), .pred_frame_id(pred_frame_id), .pred_seq(pred_seq),
        .pred_flags(pred_flags),
        .signature(bist_sig), .count(bist_count)
    );

    // --------------------------------------------------------------- reads
    wire [31:0] x_ts_samples  = {{(32-TS_W){1'b0}}, stat_samples};
    wire [31:0] x_ts_rejected = {{(32-TS_W){1'b0}}, stat_rejected};
    wire [31:0] x_pred_ts     = {{(32-TS_W){1'b0}}, pred_ts};
    wire [31:0] x_last_ts     = {{(32-TS_W){1'b0}}, last_ts};
    wire [31:0] x_frame_span  = {{(32-TS_W){1'b0}}, cfg_frame_span};
    wire [15:0] x_pred_frame  = {{(16-WIN_IDX_W){1'b0}}, pred_frame_id};
    wire [15:0] x_last_frame  = {{(16-WIN_IDX_W){1'b0}}, last_frame_id};
    /* verilator lint_off UNUSEDSIGNAL */
    wire [31:0] x_pred_count  = {{(31-PRED_LOG2){1'b0}}, pred_count};   // PRED_STATUS carries 3 count bits
    /* verilator lint_on UNUSEDSIGNAL */

    always @(*) begin
        reg_rdata = 32'd0;
        if (model_region) reg_rdata = model_rdata;
        else case (reg_addr)
            8'h00: reg_rdata = ID;
            8'h01: reg_rdata = {25'd0, cfg_pred_direct, cfg_bist_en, 1'b0, cfg_ai_en, cfg_mode, cfg_session_en};
            8'h02: reg_rdata = {{(32-SAMPLE_W){1'b0}}, cfg_threshold};
            8'h03: reg_rdata = {{(32-SAMPLE_W){1'b0}}, cfg_hysteresis};
            8'h04: reg_rdata = {24'd0, cfg_refractory};
            8'h05: reg_rdata = {28'd0, cfg_alpha_shift};
            8'h06: reg_rdata = {{16{cfg_b0[15]}}, cfg_b0};
            8'h07: reg_rdata = {{16{cfg_b1[15]}}, cfg_b1};
            8'h08: reg_rdata = {{16{cfg_b2[15]}}, cfg_b2};
            8'h09: reg_rdata = {{16{cfg_a1[15]}}, cfg_a1};
            8'h0A: reg_rdata = {{16{cfg_a2[15]}}, cfg_a2};
            8'h0B: reg_rdata = {28'd0, cfg_win_log2};
            8'h0C: reg_rdata = {26'd0, cfg_energy_shift};
            8'h0D: reg_rdata = {24'd0, cfg_ch_mask};
            8'h0E: reg_rdata = x_frame_span;
            8'h10: reg_rdata = x_ts_samples;
            8'h11: reg_rdata = x_ts_rejected;
            8'h12: reg_rdata = stat_drop_raw;
            8'h13: reg_rdata = stat_drop_event;
            8'h14: reg_rdata = stat_drop_feature;
            8'h15: reg_rdata = stat_event_missed;
            8'h16: reg_rdata = stat_fifo_hwm;
            8'h18: reg_rdata = ai_frames;
            8'h19: reg_rdata = ai_pred;
            8'h1A: reg_rdata = ai_incomplete;
            8'h1B: reg_rdata = ai_dup;
            8'h1C: reg_rdata = ai_late;
            8'h1D: reg_rdata = ai_span;
            8'h1E: reg_rdata = ai_busy;
            8'h1F: reg_rdata = ai_pred_drop;
            8'h20: reg_rdata = ai_nomodel;
            8'h21: reg_rdata = ai_sat_frames;
            8'h22: reg_rdata = stat_model_wr_rej;
            8'h24: reg_rdata = {last_sat, last_missing, x_last_frame};
            8'h25: reg_rdata = last_x[31:0];
            8'h26: reg_rdata = last_x[63:32];
            8'h27: reg_rdata = last_h[31:0];
            8'h28: reg_rdata = last_h[63:32];
            8'h29: reg_rdata = last_logit[31:0];
            8'h2A: reg_rdata = last_logit[63:32];
            8'h2B: reg_rdata = last_logit[95:64];
            8'h2C: reg_rdata = last_logit[127:96];
            8'h2D: reg_rdata = x_last_ts;
            8'h30: reg_rdata = pred_valid ? {22'd0, pred_class, pred_flags, x_pred_count[2:0], 1'b1} : 32'd0;
            8'h31: reg_rdata = pred_valid ? pred_margin : 32'd0;
            8'h32: reg_rdata = pred_valid ? x_pred_ts : 32'd0;
            8'h33: reg_rdata = pred_valid ? {x_pred_frame, pred_seq} : 32'd0;
            8'h38: reg_rdata = crc_expected;
            8'h3A: reg_rdata = {model_id, 12'd0, model_rejected, model_busy, model_error, model_valid};
            8'h3C: reg_rdata = bist_sig;
            8'h3D: reg_rdata = bist_count;
            8'h3E: reg_rdata = {31'd0, bist_running};
            8'h3F: reg_rdata = bist_len;
            default: reg_rdata = 32'd0;
        endcase
    end
endmodule

// ============================================================================
// Built-in self-test: deterministic xorshift32 sample source (one sample every
// 4 cycles, channels round-robin, len samples) and a MISR over every record and
// prediction. The expected signature for a configuration comes from the Python
// golden models (scripts/check_top.py --bist), so this is a known-answer test of
// the whole DSP + AI path that needs no external stimulus.
//   fold(sig, w) = rotl(sig, 5) ^ w
//   record:      sig = fold(fold(fold(sig, data), ts), {type, ch, flags, seq})
//   prediction:  sig = fold(fold(fold(fold(sig, margin), ts), {frame_id, seq}), {class, flags})
// A record and a prediction in the same cycle fold the record first.
// ============================================================================
module hbci_bist #(
    parameter integer CH_W      = 3,
    parameter integer SAMPLE_W  = 16,
    parameter integer TS_W      = 32,
    parameter integer SEQ_W     = 16,
    parameter integer WIN_IDX_W = 16
) (
    input  wire                       clk,
    input  wire                       rst_n,
    input  wire                       enable,
    input  wire                       start,
    input  wire                       clear,
    input  wire [31:0]                len,
    output reg                        running,
    output reg                        smp_valid,
    output reg  [CH_W-1:0]            smp_ch,
    output reg  signed [SAMPLE_W-1:0] smp_sample,
    input  wire                       rec_valid,
    input  wire [1:0]                 rec_type,
    input  wire [CH_W-1:0]            rec_channel,
    input  wire [3:0]                 rec_flags,
    input  wire [SEQ_W-1:0]           rec_seq,
    input  wire [TS_W-1:0]            rec_ts,
    input  wire [31:0]                rec_data,
    input  wire                       pred_valid,
    output wire                       pred_pop,
    input  wire [1:0]                 pred_class,
    input  wire [31:0]                pred_margin,
    input  wire [TS_W-1:0]            pred_ts,
    input  wire [WIN_IDX_W-1:0]       pred_frame_id,
    input  wire [15:0]                pred_seq,
    input  wire [3:0]                 pred_flags,
    output reg  [31:0]                signature,
    output reg  [31:0]                count
);
    reg [31:0]     lfsr;
    reg [31:0]     remaining;
    reg [1:0]      phase;
    reg [CH_W-1:0] ch_cnt;
    assign pred_pop = enable & pred_valid;

    function [31:0] xs32;
        input [31:0] s;
        reg [31:0] t;
        begin
            t = s ^ (s << 13);
            t = t ^ (t >> 17);
            xs32 = t ^ (t << 5);
        end
    endfunction

    function [31:0] fold;
        input [31:0] sig;
        input [31:0] w;
        begin
            fold = {sig[26:0], sig[31:27]} ^ w;
        end
    endfunction

    wire [31:0] rec_meta  = {{(26-CH_W-SEQ_W){1'b0}}, rec_type, rec_channel, rec_flags, rec_seq};
    wire [31:0] rec_ts32  = {{(32-TS_W){1'b0}}, rec_ts};
    wire [31:0] pred_ids  = {{(16-WIN_IDX_W){1'b0}}, pred_frame_id, pred_seq};
    wire [31:0] pred_meta = {26'd0, pred_class, pred_flags};
    wire [31:0] pred_ts32 = {{(32-TS_W){1'b0}}, pred_ts};
    wire [31:0] sig_rec   = fold(fold(fold(signature, rec_data), rec_ts32), rec_meta);
    wire [31:0] sig_pred  = fold(fold(fold(fold(sig_rec, pred_margin), pred_ts32), pred_ids), pred_meta);
    wire [31:0] sig_ponly = fold(fold(fold(fold(signature, pred_margin), pred_ts32), pred_ids), pred_meta);

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            lfsr <= 32'h2545_F491; remaining <= 32'd0; phase <= 2'd0; running <= 1'b0; ch_cnt <= {CH_W{1'b0}};
            smp_valid <= 1'b0; smp_ch <= {CH_W{1'b0}}; smp_sample <= {SAMPLE_W{1'b0}};
            signature <= 32'd0; count <= 32'd0;
        end else begin
            smp_valid <= 1'b0;
            if (clear) begin
                signature <= 32'd0; count <= 32'd0; lfsr <= 32'h2545_F491; ch_cnt <= {CH_W{1'b0}};
                running <= 1'b0; remaining <= 32'd0; phase <= 2'd0;
            end else if (start & enable) begin
                running <= 1'b1; remaining <= len; phase <= 2'd0;
            end else if (running) begin
                phase <= phase + 2'd1;
                if (phase == 2'd3) begin
                    if (remaining == 32'd0) begin
                        running <= 1'b0;
                    end else begin
                        smp_valid <= 1'b1;
                        smp_ch <= ch_cnt;
                        smp_sample <= lfsr[SAMPLE_W-1:0];
                        lfsr <= xs32(lfsr);
                        ch_cnt <= ch_cnt + {{(CH_W-1){1'b0}}, 1'b1};
                        remaining <= remaining - 32'd1;
                    end
                end
            end
            if (enable & (rec_valid | pred_valid)) begin
                signature <= rec_valid ? (pred_valid ? sig_pred : sig_rec) : sig_ponly;
                count <= count + {31'd0, rec_valid} + {31'd0, pred_valid};
            end
        end
    end
endmodule

/* verilator lint_on DECLFILENAME */
`default_nettype wire
