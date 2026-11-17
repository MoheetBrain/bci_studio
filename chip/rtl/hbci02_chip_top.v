// ============================================================================
// HBCI-02 — chip-level top (hbci02_chip_top), v0.4
// ----------------------------------------------------------------------------
// Wraps hbci02_digital_top with the serial interfaces a packaged test chip
// needs, so the whole device works with 14 signal pins plus power:
//
//   clk, rst_n                      core clock and asynchronous active-low reset (asserted
//                                   asynchronously, released synchronously by a 2-flop
//                                   synchroniser inside the chip: hbci_reset_sync)
//   spi_sclk, spi_cs_n, spi_mosi, spi_miso   register bus: SPI mode 0 slave, MSB first,
//                                   one transaction per CS assertion: 8-bit command
//                                   {1 write / 0 read, addr[6:0]} then 32 data bits.
//                                   The 7-bit address covers the whole register map
//                                   (0x00..0x6D plus the two chip status words 0x70/0x71).
//   smp_sclk, smp_cs_n, smp_mosi    sample stream: SPI mode 0 slave, 24-bit frames
//                                   {ch[2:0], 4'b0, parity, sample[15:0]} MSB first,
//                                   one in_valid pulse per complete frame while CS is low
//                                   (parity = even parity over the other 23 bits; a bad
//                                   frame is dropped and counted)
//   rec_sdo, rec_sfrm               record output: 96-bit frames {7'b0, type, ch, flags,
//                                   seq, ts, data} MSB first at one bit per clk; rec_sfrm
//                                   is high for the 96 bits; the receiver samples on clk
//   pred_strobe, pred_class         direct prediction pins (CTRL.pred_direct_en)
//   pred_irq                        prediction FIFO not empty
//
// All SPI inputs are synchronised with two flip-flops and edge-detected in the
// core clock domain: SCLK must be <= clk / 6. The record serialiser pops the
// record FIFO only between frames, so back-pressure is intrinsic (a record is
// never corrupted; drops are counted by the DSP as in v0.3).
//
// Verilog-2005, lint-clean under verilator -Wall. This is the netlist that the
// physical-design flow implements and the padframe proposal pins out
// (docs/TEST_PLAN.md).
// ============================================================================
`timescale 1ns/1ps
`default_nettype none
/* verilator lint_off DECLFILENAME */

// ----------------------------------------------------------------------------
// Reset synchroniser: asynchronous assertion, release two clock edges after the
// pin rises, so every flop in the core sees a synchronous release (recovery/
// removal timing is then internal to the chip).
// ----------------------------------------------------------------------------
module hbci_reset_sync (
    input  wire clk,
    input  wire rst_n_in,
    output wire rst_n_out
);
    // The chain is asynchronously cleared and synchronously filled with ones: the
    // standard reset synchroniser (Verilator's SYNCASYNCNET warning is expected here).
    /* verilator lint_off SYNCASYNCNET */
    reg [1:0] q;
    /* verilator lint_on SYNCASYNCNET */
    always @(posedge clk or negedge rst_n_in) begin
        if (!rst_n_in) q <= 2'b00;
        else           q <= {q[0], 1'b1};
    end
    assign rst_n_out = q[1];
endmodule

// ----------------------------------------------------------------------------
// SPI mode-0 slave front end: synchronised inputs, sampled bits on SCLK rising
// edges, output bit changes on SCLK falling edges. Generic: delivers bit events.
// ----------------------------------------------------------------------------
module hbci_spi_sync (
    input  wire clk,
    input  wire rst_n,
    input  wire sclk,
    input  wire cs_n,
    input  wire mosi,
    output wire active,        // CS low (synchronised)
    output wire start,         // CS fell this cycle
    output wire stop,          // CS rose this cycle
    output wire rise,          // SCLK rising edge this cycle (while CS low)
    output wire fall,          // SCLK falling edge this cycle (while CS low)
    output wire din            // MOSI, synchronised
);
    reg [2:0] sclk_q, cs_q;
    reg [1:0] mosi_q;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sclk_q <= 3'd0; cs_q <= 3'b111; mosi_q <= 2'd0;
        end else begin
            sclk_q <= {sclk_q[1:0], sclk};
            cs_q   <= {cs_q[1:0], cs_n};
            mosi_q <= {mosi_q[0], mosi};
        end
    end
    assign active = ~cs_q[1];
    assign start  = cs_q[2] & ~cs_q[1];
    assign stop   = ~cs_q[2] & cs_q[1];
    assign rise   = active & ~sclk_q[2] & sclk_q[1];
    assign fall   = active & sclk_q[2] & ~sclk_q[1];
    assign din    = mosi_q[1];
endmodule

// ----------------------------------------------------------------------------
// Register-bus SPI slave: command byte {wr, addr[6:0]} then 32 data bits.
// Write: the register write pulses after the 40th bit. Read: the register is
// read (combinational reg_rdata) when the command byte completes and shifted
// out MSB first on the following falling edges.
// ----------------------------------------------------------------------------
module hbci_spi_regbus (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        sclk,
    input  wire        cs_n,
    input  wire        mosi,
    output reg         miso,
    output reg         reg_wr,
    output reg  [7:0]  reg_addr,
    output reg  [31:0] reg_wdata,
    input  wire [31:0] reg_rdata,
    output reg  [31:0] stat_spi_frames   // completed 40-bit transactions
);
    wire active, start, stop, rise, fall, din;
    hbci_spi_sync u_sync (.clk(clk), .rst_n(rst_n), .sclk(sclk), .cs_n(cs_n), .mosi(mosi),
                          .active(active), .start(start), .stop(stop), .rise(rise), .fall(fall), .din(din));
    reg [5:0]  nbit;
    reg [30:0] shift_in;           // the 32nd bit is combined with din when a word completes
    reg [31:0] shift_out;
    reg        is_wr;
    /* verilator lint_off UNUSEDSIGNAL */
    wire unused_stop = stop;
    /* verilator lint_on UNUSEDSIGNAL */

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            nbit <= 6'd0; shift_in <= 31'd0; shift_out <= 32'd0; is_wr <= 1'b0; miso <= 1'b0;
            reg_wr <= 1'b0; reg_addr <= 8'd0; reg_wdata <= 32'd0; stat_spi_frames <= 32'd0;
        end else begin
            reg_wr <= 1'b0;
            if (start) begin
                nbit <= 6'd0;
                miso <= 1'b0;
            end else if (rise) begin
                shift_in <= {shift_in[29:0], din};
                nbit <= nbit + 6'd1;
                if (nbit == 6'd7) begin                         // command byte complete
                    is_wr <= shift_in[6];
                    reg_addr <= {1'b0, shift_in[5:0], din};
                end
                if (nbit == 6'd39) begin
                    if (is_wr) begin
                        reg_wr <= 1'b1;
                        reg_wdata <= {shift_in, din};
                    end
                    stat_spi_frames <= stat_spi_frames + 32'd1;
                end
            end else if (fall) begin
                if (nbit == 6'd8) begin                         // first data bit of a read
                    shift_out <= {reg_rdata[30:0], 1'b0};
                    miso <= is_wr ? 1'b0 : reg_rdata[31];
                end else if (nbit > 6'd8 && nbit < 6'd40) begin
                    miso <= is_wr ? 1'b0 : shift_out[31];
                    shift_out <= {shift_out[30:0], 1'b0};
                end
            end
            if (!active) miso <= 1'b0;
        end
    end
endmodule

// ----------------------------------------------------------------------------
// Sample-stream SPI slave: 24-bit frames {ch[2:0], 4'b0, parity, sample[15:0]}.
// ----------------------------------------------------------------------------
module hbci_spi_samples #(
    parameter integer CH_W     = 3,
    parameter integer SAMPLE_W = 16
) (
    input  wire                       clk,
    input  wire                       rst_n,
    input  wire                       sclk,
    input  wire                       cs_n,
    input  wire                       mosi,
    output reg                        in_valid,
    output reg  [CH_W-1:0]            in_channel,
    output reg  signed [SAMPLE_W-1:0] in_sample,
    output reg  [31:0]                stat_parity_err
);
    wire active, start, stop, rise, fall, din;
    hbci_spi_sync u_sync (.clk(clk), .rst_n(rst_n), .sclk(sclk), .cs_n(cs_n), .mosi(mosi),
                          .active(active), .start(start), .stop(stop), .rise(rise), .fall(fall), .din(din));
    reg [4:0]  nbit;
    reg [22:0] shift_in;
    /* verilator lint_off UNUSEDSIGNAL */
    wire unused_stop = stop;
    wire unused_fall = fall;
    wire unused_active = active;
    /* verilator lint_on UNUSEDSIGNAL */
    wire [23:0] frame = {shift_in, din};
    wire parity_ok = (^{frame[23:17], frame[15:0]}) == frame[16];   // even parity: bit 16 = XOR of the others

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            nbit <= 5'd0; shift_in <= 23'd0; in_valid <= 1'b0; in_channel <= {CH_W{1'b0}};
            in_sample <= {SAMPLE_W{1'b0}}; stat_parity_err <= 32'd0;
        end else begin
            in_valid <= 1'b0;
            if (start) begin
                nbit <= 5'd0;
            end else if (rise) begin
                shift_in <= frame[22:0];
                if (nbit == 5'd23) begin
                    nbit <= 5'd0;
                    if (parity_ok) begin
                        in_valid   <= 1'b1;
                        in_channel <= frame[21 +: CH_W];
                        in_sample  <= frame[SAMPLE_W-1:0];
                    end else begin
                        stat_parity_err <= stat_parity_err + 32'd1;
                    end
                end else begin
                    nbit <= nbit + 5'd1;
                end
            end
        end
    end
endmodule

// ----------------------------------------------------------------------------
// Record serialiser: pops one record, shifts 96 bits MSB first at one bit per
// clk with rec_sfrm high, then pops the next.
// ----------------------------------------------------------------------------
module hbci_rec_serial #(
    parameter integer CH_W  = 3,
    parameter integer SEQ_W = 16,
    parameter integer TS_W  = 32
) (
    input  wire              clk,
    input  wire              rst_n,
    input  wire              rec_valid,
    output wire              rec_ready,
    input  wire [1:0]        rec_type,
    input  wire [CH_W-1:0]   rec_channel,
    input  wire [3:0]        rec_flags,
    input  wire [SEQ_W-1:0]  rec_seq,
    input  wire [TS_W-1:0]   rec_ts,
    input  wire [31:0]       rec_data,
    output reg               sdo,
    output reg               sfrm
);
    reg [95:0] sh;
    reg [6:0]  nbit;
    reg        busy;
    assign rec_ready = ~busy;
    wire [95:0] word = {{(96-2-CH_W-4-SEQ_W-TS_W-32){1'b0}}, rec_type, rec_channel, rec_flags, rec_seq, rec_ts, rec_data};
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sh <= 96'd0; nbit <= 7'd0; busy <= 1'b0; sdo <= 1'b0; sfrm <= 1'b0;
        end else begin
            if (!busy) begin
                sdo <= 1'b0; sfrm <= 1'b0;
                if (rec_valid) begin
                    busy <= 1'b1; sh <= word; nbit <= 7'd0;
                end
            end else begin
                sdo <= sh[95]; sfrm <= 1'b1;
                sh <= {sh[94:0], 1'b0};
                nbit <= nbit + 7'd1;
                if (nbit == 7'd95) busy <= 1'b0;
            end
        end
    end
endmodule

// ----------------------------------------------------------------------------
// Chip top
// ----------------------------------------------------------------------------
module hbci02_chip_top #(
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
    input  wire clk,
    input  wire rst_n,
    input  wire spi_sclk,
    input  wire spi_cs_n,
    input  wire spi_mosi,
    output wire spi_miso,
    input  wire smp_sclk,
    input  wire smp_cs_n,
    input  wire smp_mosi,
    output wire rec_sdo,
    output wire rec_sfrm,
    output wire pred_strobe,
    output wire [1:0] pred_class,
    output wire pred_irq
);
    wire        rst_n_s;                                   // synchronised core reset
    hbci_reset_sync u_rst (.clk(clk), .rst_n_in(rst_n), .rst_n_out(rst_n_s));
    wire        reg_wr;
    wire [7:0]  reg_addr;
    wire [31:0] reg_wdata, reg_rdata, core_rdata;
    wire [31:0] stat_spi_frames, stat_parity_err;
    wire        in_valid;
    wire [CH_W-1:0] in_channel;
    wire signed [SAMPLE_W-1:0] in_sample;
    wire        rec_valid, rec_ready;
    wire [1:0]  rec_type;
    wire [CH_W-1:0] rec_channel;
    wire [3:0]  rec_flags;
    wire [SEQ_W-1:0] rec_seq;
    wire [TS_W-1:0] rec_ts;
    wire [31:0] rec_data;

    hbci_spi_regbus u_spi (
        .clk(clk), .rst_n(rst_n_s), .sclk(spi_sclk), .cs_n(spi_cs_n), .mosi(spi_mosi), .miso(spi_miso),
        .reg_wr(reg_wr), .reg_addr(reg_addr), .reg_wdata(reg_wdata), .reg_rdata(reg_rdata),
        .stat_spi_frames(stat_spi_frames)
    );
    hbci_spi_samples #(.CH_W(CH_W), .SAMPLE_W(SAMPLE_W)) u_smp (
        .clk(clk), .rst_n(rst_n_s), .sclk(smp_sclk), .cs_n(smp_cs_n), .mosi(smp_mosi),
        .in_valid(in_valid), .in_channel(in_channel), .in_sample(in_sample), .stat_parity_err(stat_parity_err)
    );
    // Two chip-level status words at 0x70 / 0x71 (above the digital top's map).
    assign reg_rdata = (reg_addr == 8'h70) ? stat_spi_frames : (reg_addr == 8'h71) ? stat_parity_err : core_rdata;

    hbci02_digital_top #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W), .SEQ_W(SEQ_W), .FIFO_LOG2(FIFO_LOG2),
        .WIN_W(WIN_W), .ACC_W(ACC_W), .WIN_IDX_W(WIN_IDX_W), .NH(NH), .NO(NO), .PRED_LOG2(PRED_LOG2)
    ) u_core (
        .clk(clk), .rst_n(rst_n_s),
        .reg_wr(reg_wr), .reg_addr(reg_addr), .reg_wdata(reg_wdata), .reg_rdata(core_rdata),
        .in_valid(in_valid), .in_channel(in_channel), .in_sample(in_sample),
        .rec_valid(rec_valid), .rec_ready(rec_ready), .rec_type(rec_type), .rec_channel(rec_channel),
        .rec_flags(rec_flags), .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .pred_strobe(pred_strobe), .pred_class_out(pred_class), .pred_irq(pred_irq)
    );
    hbci_rec_serial #(.CH_W(CH_W), .SEQ_W(SEQ_W), .TS_W(TS_W)) u_rec (
        .clk(clk), .rst_n(rst_n_s), .rec_valid(rec_valid), .rec_ready(rec_ready), .rec_type(rec_type),
        .rec_channel(rec_channel), .rec_flags(rec_flags), .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .sdo(rec_sdo), .sfrm(rec_sfrm)
    );
endmodule

/* verilator lint_on DECLFILENAME */
`default_nettype wire
