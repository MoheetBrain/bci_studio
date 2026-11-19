// ============================================================================
// HBCI-02 — on-chip AI decoder (hbci_ai_decoder), v0.4
// ----------------------------------------------------------------------------
// Specification: docs/AI_DECODER.md (binding). Bit-exact software reference:
// scripts/golden_ai.py. Replaces the experimental rtl/hbci_onchip_mlp.v (kept
// for history; see docs/HBCI02_AUDIT.md for its defects).
//
// Pipeline:  feature (ch, energy, ts, sat, win_idx)
//              -> hbci_feat_quant      64*log2 compression, per-channel centre/shift, int8
//              -> hbci_frame_collector one observation = one feature per required channel,
//                                      all from the same per-channel window index
//              -> pending register     one completed frame waiting for the engine
//              -> hbci_mlp_engine      8 -> NH -> NO quantised MLP, or 8 -> NO linear model,
//                                      one time-shared 8x8 multiplier, 34-bit accumulator
//              -> prediction FIFO      class, margin, timestamp, frame id, seq, flags
// Model parameters: hbci_model_store (46 x 32-bit words, CRC-32 verified; no
// prediction is produced until the loaded model has been verified).
//
// Genuine inference logic: the prediction is computed here, in synthesizable
// RTL. Training happens outside the chip. This is a bench research device, not
// a medical device, and nothing here is validated on an implant.
//
// Verilog-2005, single clock, asynchronous active-low reset, every register
// reset. Lint-clean under verilator -Wall.
// ============================================================================
`timescale 1ns/1ps
`default_nettype none
/* verilator lint_off DECLFILENAME */

// ============================================================================
// 64*log2(e) with a 6-bit linear mantissa (Mitchell): l = 64*n + m, n = index
// of the leading one, m = the six bits below it. l = 0 for e = 0. Combinational.
// ============================================================================
module hbci_log_energy (
    input  wire [31:0] e,
    output wire [10:0] l
);
    wire        n4 = |e[31:16];
    wire [15:0] s4 = n4 ? e[31:16] : e[15:0];
    wire        n3 = |s4[15:8];
    wire [7:0]  s3 = n3 ? s4[15:8] : s4[7:0];
    wire        n2 = |s3[7:4];
    wire [3:0]  s2 = n2 ? s3[7:4] : s3[3:0];
    wire        n1 = |s2[3:2];
    // s1[0] and norm[31], norm[24:0] are intentionally unused (only the leading one's
    // position and the six bits below it are needed).
    /* verilator lint_off UNUSEDSIGNAL */
    wire [1:0]  s1 = n1 ? s2[3:2] : s2[1:0];
    wire [31:0] norm;
    /* verilator lint_on UNUSEDSIGNAL */
    wire        n0 = s1[1];
    wire [4:0]  n  = {n4, n3, n2, n1, n0};
    wire [4:0]  sh = 5'd31 - n;
    assign norm = e << sh;                            // leading one moved to bit 31
    assign l = (e == 32'd0) ? 11'd0 : {n, norm[30:25]};
endmodule

// ============================================================================
// Feature quantiser (docs/AI_DECODER.md 3.1): x = sat_int8((l - centre) >>> qshift),
// 0 when the channel is not required. Combinational.
// ============================================================================
module hbci_feat_quant (
    input  wire [31:0]       energy,
    input  wire [11:0]       centre,
    input  wire [2:0]        qshift,
    input  wire              enabled,
    output wire [10:0]       l,
    output wire signed [7:0] x
);
    hbci_log_energy u_log (.e(energy), .l(l));
    wire signed [13:0] diff = $signed({3'b000, l}) - $signed({2'b00, centre});   // -4095 .. 2047
    wire signed [13:0] sh   = diff >>> qshift;
    wire signed [7:0]  xs   = (sh > 14'sd127) ? 8'sd127 : (sh < -14'sd128) ? -8'sd128 : sh[7:0];
    assign x = enabled ? xs : 8'sd0;
endmodule

// ============================================================================
// Frame collector (docs/AI_DECODER.md section 2). One feature per cycle at most.
// A frame = one quantised feature from every channel in ch_mask, all with the
// same window index. Every abandoned frame and discarded feature is counted.
// ============================================================================
module hbci_frame_collector #(
    parameter integer TS_W      = 32,
    parameter integer WIN_IDX_W = 16
) (
    input  wire                 clk,
    input  wire                 rst_n,
    input  wire                 enable,           // 0: no frame is open (cleared)
    input  wire                 sync,             // clears the open frame
    input  wire [7:0]           ch_mask,
    input  wire [TS_W-1:0]      frame_span,
    input  wire                 feat_valid,
    input  wire [2:0]           feat_ch,
    input  wire signed [7:0]    feat_x,
    input  wire [TS_W-1:0]      feat_ts,
    input  wire                 feat_sat,
    input  wire [WIN_IDX_W-1:0] feat_win,
    output reg                  frame_valid,      // one-cycle pulse, frame_* valid with it
    output reg  [WIN_IDX_W-1:0] frame_id,
    output reg  [TS_W-1:0]      frame_ts,         // ts of the last feature of the frame
    output reg  [63:0]          frame_x,          // x_7 .. x_0, int8 each
    output reg  [7:0]           frame_sat,
    output reg  [31:0]          stat_frames,
    output reg  [31:0]          stat_incomplete,
    output reg  [31:0]          stat_dup,
    output reg  [31:0]          stat_late,
    output reg  [31:0]          stat_span,
    output reg  [7:0]           last_missing      // channels missing from the last abandoned frame
`ifdef FORMAL
    , output wire                f_open,           // formal probes (SymbiYosys only)
    output wire [7:0]            f_seen,
    output wire [WIN_IDX_W-1:0]  f_id
`endif
);
    reg                  open;
    reg [WIN_IDX_W-1:0]  id;
    reg [TS_W-1:0]       ts_first;
    reg [7:0]            seen;
    reg [7:0]            sat;
    reg signed [7:0]     xr [0:7];

`ifdef FORMAL
    assign f_open = open;
    assign f_seen = seen;
    assign f_id   = id;
`endif
    wire                 act      = feat_valid & enable & ~sync & ch_mask[feat_ch];
    wire [WIN_IDX_W-1:0] d        = feat_win - id;
    wire                 same     = open & (d == {WIN_IDX_W{1'b0}});
    wire                 late     = open & d[WIN_IDX_W-1];
    wire                 newer    = open & ~d[WIN_IDX_W-1] & (d != {WIN_IDX_W{1'b0}});
    wire                 dup      = same & seen[feat_ch];
    wire [TS_W-1:0]      span_now = feat_ts - ts_first;
    wire                 span_bad = same & ~dup & (span_now > frame_span);
    wire                 restart  = ~open | newer | dup | span_bad;    // this feature opens a new frame
    wire                 abandon  = act & (newer | dup | span_bad);
    wire                 store    = act & ~late;
    wire [7:0]           chbit    = 8'b0000_0001 << feat_ch;
    wire [7:0]           seen_base = restart ? 8'd0 : seen;
    wire [7:0]           seen_next = seen_base | chbit;
    wire [7:0]           sat_base  = restart ? 8'd0 : sat;
    wire [7:0]           sat_next  = sat_base | (feat_sat ? chbit : 8'd0);
    wire                 complete  = store & ((seen_next & ch_mask) == ch_mask);

    integer k;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            open <= 1'b0; id <= {WIN_IDX_W{1'b0}}; ts_first <= {TS_W{1'b0}};
            seen <= 8'd0; sat <= 8'd0;
            for (k = 0; k < 8; k = k + 1) xr[k] <= 8'sd0;
            frame_valid <= 1'b0; frame_id <= {WIN_IDX_W{1'b0}}; frame_ts <= {TS_W{1'b0}};
            frame_x <= 64'd0; frame_sat <= 8'd0;
            stat_frames <= 32'd0; stat_incomplete <= 32'd0; stat_dup <= 32'd0;
            stat_late <= 32'd0; stat_span <= 32'd0; last_missing <= 8'd0;
        end else begin
            frame_valid <= 1'b0;
            if (act & late)        stat_late <= stat_late + 32'd1;
            if (act & newer)       stat_incomplete <= stat_incomplete + 32'd1;
            if (act & dup)         stat_dup <= stat_dup + 32'd1;
            if (act & span_bad)    stat_span <= stat_span + 32'd1;
            if (abandon)           last_missing <= ch_mask & ~seen;
            if (store) begin
                if (restart) begin
                    id <= feat_win;
                    ts_first <= feat_ts;
                    for (k = 0; k < 8; k = k + 1) xr[k] <= (k[2:0] == feat_ch) ? feat_x : 8'sd0;
                end else begin
                    xr[feat_ch] <= feat_x;
                end
                seen <= seen_next;
                sat  <= sat_next;
                open <= ~complete;
            end
            if (complete) begin
                stat_frames <= stat_frames + 32'd1;
                frame_valid <= 1'b1;
                frame_id    <= restart ? feat_win : id;
                frame_ts    <= feat_ts;
                frame_sat   <= sat_next;
                for (k = 0; k < 8; k = k + 1)
                    frame_x[8*k +: 8] <= (k[2:0] == feat_ch) ? feat_x : (seen_base[k] ? xr[k] : 8'sd0);
            end
            if (!enable || sync) begin
                open <= 1'b0;
                seen <= 8'd0;
                frame_valid <= 1'b0;
            end
        end
    end
endmodule

// ============================================================================
// Model store: 46 x 32-bit parameter words (docs/AI_DECODER.md 3.3), bus read
// and write, CRC-32 verification FSM, and the valid/error/busy/rejected status.
// Rows beyond NH/NO are not stored and read back as 0, so a model that does
// not fit this configuration fails its CRC check. Parameters are kept as flat
// vectors; word w of the W1 region is bits [32w +: 32] of w1_flat, etc.
// ============================================================================
module hbci_model_store #(
    parameter integer NH = 4,
    parameter integer NO = 2
) (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        ai_en,            // writes are rejected while 1
    input  wire        we,
    input  wire [5:0]  addr,             // 0..45 (others ignored)
    input  wire [31:0] wdata,
    output wire [31:0] rdata,            // word at addr (undefined while busy)
    input  wire        crc_we,
    input  wire [31:0] crc_wdata,
    output reg  [31:0] crc_expected,
    input  wire        verify,           // start the CRC check
    input  wire        clear_rej,
    output reg         valid,
    output reg         error,
    output reg         busy,
    output reg         rejected,         // sticky: a write was rejected (ai_en = 1 or busy)
    output reg  [31:0] stat_wr_rej,
    // model contents for the engine
    output reg  [NH*64-1:0] w1_flat,     // w1[h][c] at bits (h*8+c)*8 +: 8
    output reg  [NO*64-1:0] w2_flat,     // w2[o][k] at bits (o*8+k)*8 +: 8
    output reg  [NH*32-1:0] b1_flat,
    output reg  [NO*32-1:0] b2_flat,
    output reg  [95:0]      centre_flat, // centre[c] at bits c*12 +: 12
    output reg  [23:0]      qshift_flat, // qshift[c] at bits c*3 +: 3
    output wire [4:0]       s1,
    output wire             linear,
    output wire [15:0]      model_id
);
    localparam [31:0] CRC_POLY = 32'hEDB8_8320;
    localparam [31:0] NH32 = NH;
    localparam [31:0] NO32 = NO;

    reg [31:0] cfg;                        // bits 4:0 s1, 8 linear, 31:16 model_id
    assign s1       = cfg[4:0];
    assign linear   = cfg[8];
    assign model_id = cfg[31:16];

    // ------------------------------------------------------------- read mux
    reg [5:0]  crc_addr;
    reg [1:0]  crc_byte;
    reg [31:0] crc;
    wire [5:0] raddr = busy ? crc_addr : addr;
    wire       r_w1 = (raddr < 6'd16);
    wire       r_w2 = (raddr >= 6'd16) & (raddr < 6'd24);
    wire       r_b1 = (raddr >= 6'd24) & (raddr < 6'd32);
    wire       r_b2 = (raddr >= 6'd32) & (raddr < 6'd36);
    wire       r_ct = (raddr >= 6'd36) & (raddr < 6'd44);
    wire       r_cf = (raddr == 6'd44);
    wire [2:0] r_ch = raddr[2:0] + 3'd4;                   // channel of a centre word: raddr - 36
    wire       r_w1_ok = r_w1 & ({28'd0, raddr[4:1]} < NH32);
    wire       r_w2_ok = r_w2 & ({30'd0, raddr[2:1]} < NO32);
    wire       r_b1_ok = r_b1 & ({29'd0, raddr[2:0]} < NH32);
    wire       r_b2_ok = r_b2 & ({30'd0, raddr[1:0]} < NO32);
    wire [31:0] rword =
        r_w1_ok ? w1_flat[raddr[4:0]*32 +: 32] :
        r_w2_ok ? w2_flat[raddr[2:0]*32 +: 32] :
        r_b1_ok ? b1_flat[raddr[2:0]*32 +: 32] :
        r_b2_ok ? b2_flat[raddr[1:0]*32 +: 32] :
        r_ct    ? {17'd0, qshift_flat[r_ch*3 +: 3], centre_flat[r_ch*12 +: 12]} :
        r_cf    ? cfg : 32'd0;
    assign rdata = rword;

    // ---------------------------------------------------------------- CRC-32
    function [31:0] crc_byte_step;
        input [31:0] c;
        input [7:0]  b;
        reg   [31:0] t;
        integer j;
        begin
            t = c ^ {24'd0, b};
            for (j = 0; j < 8; j = j + 1)
                t = t[0] ? ((t >> 1) ^ CRC_POLY) : (t >> 1);
            crc_byte_step = t;
        end
    endfunction

    wire [7:0]  crc_in   = rword[8*crc_byte +: 8];
    wire [31:0] crc_next = crc_byte_step(crc, crc_in);
    wire        crc_last = (crc_addr == 6'd45) & (crc_byte == 2'd3);
    wire        wr_ok    = we & ~ai_en & ~busy & (addr < 6'd46);
    wire        w_w1_ok  = (addr < 6'd16) & ({28'd0, addr[4:1]} < NH32);
    wire        w_w2_ok  = (addr >= 6'd16) & (addr < 6'd24) & ({30'd0, addr[2:1]} < NO32);
    wire        w_b1_ok  = (addr >= 6'd24) & (addr < 6'd32) & ({29'd0, addr[2:0]} < NH32);
    wire        w_b2_ok  = (addr >= 6'd32) & (addr < 6'd36) & ({30'd0, addr[1:0]} < NO32);
    wire        w_ct     = (addr >= 6'd36) & (addr < 6'd44);
    wire [2:0]  w_ch     = addr[2:0] + 3'd4;               // channel of a centre word: addr - 36

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            w1_flat <= {(NH*64){1'b0}};
            w2_flat <= {(NO*64){1'b0}};
            b1_flat <= {(NH*32){1'b0}};
            b2_flat <= {(NO*32){1'b0}};
            centre_flat <= 96'd0;
            qshift_flat <= 24'd0;
            cfg <= 32'd0;
            crc_expected <= 32'd0;
            crc_addr <= 6'd0; crc_byte <= 2'd0; crc <= 32'hFFFF_FFFF;
            valid <= 1'b0; error <= 1'b0; busy <= 1'b0; rejected <= 1'b0; stat_wr_rej <= 32'd0;
        end else begin
            if (clear_rej) rejected <= 1'b0;
            if (we & (ai_en | busy)) begin
                rejected <= 1'b1;
                stat_wr_rej <= stat_wr_rej + 32'd1;
            end
            if (wr_ok) begin
                valid <= 1'b0;
                error <= 1'b0;
                if (w_w1_ok) w1_flat[addr[4:0]*32 +: 32] <= wdata;
                if (w_w2_ok) w2_flat[addr[2:0]*32 +: 32] <= wdata;
                if (w_b1_ok) b1_flat[addr[2:0]*32 +: 32] <= wdata;
                if (w_b2_ok) b2_flat[addr[1:0]*32 +: 32] <= wdata;
                if (w_ct) begin
                    centre_flat[w_ch*12 +: 12] <= wdata[11:0];
                    qshift_flat[w_ch*3 +: 3]   <= wdata[14:12];
                end
                if (addr == 6'd44) cfg <= {wdata[31:16], 7'd0, wdata[8], 3'd0, wdata[4:0]};
            end
            if (crc_we & ~busy) begin
                crc_expected <= crc_wdata;
                valid <= 1'b0;
                error <= 1'b0;
            end
            if (busy) begin
                crc <= crc_next;
                crc_byte <= crc_byte + 2'd1;
                if (crc_byte == 2'd3) crc_addr <= crc_addr + 6'd1;
                if (crc_last) begin
                    busy  <= 1'b0;
                    valid <= ((crc_next ^ 32'hFFFF_FFFF) == crc_expected);
                    error <= ((crc_next ^ 32'hFFFF_FFFF) != crc_expected);
                end
            end else if (verify & ~ai_en) begin
                busy <= 1'b1;
                valid <= 1'b0;
                error <= 1'b0;
                crc <= 32'hFFFF_FFFF;
                crc_addr <= 6'd0;
                crc_byte <= 2'd0;
            end
        end
    end
endmodule

// ============================================================================
// MLP engine (docs/AI_DECODER.md 3.2): one 8x8 signed multiplier, 34-bit
// accumulator, NH*8 + NO*N2 + 2 cycles from start to done.
// ============================================================================
module hbci_mlp_engine #(
    parameter integer NH        = 4,
    parameter integer NO        = 2,
    parameter integer TS_W      = 32,
    parameter integer WIN_IDX_W = 16
) (
    input  wire                 clk,
    input  wire                 rst_n,
    input  wire                 enable,           // 0: abort, back to idle
    input  wire                 start,
    output wire                 busy,
    input  wire [63:0]          in_x,
    input  wire [WIN_IDX_W-1:0] in_frame_id,
    input  wire [TS_W-1:0]      in_ts,
    input  wire [7:0]           in_sat,
    input  wire                 linear,
    input  wire [4:0]           s1,
    input  wire [NH*64-1:0]     w1_flat,
    input  wire [NO*64-1:0]     w2_flat,
    input  wire [NH*32-1:0]     b1_flat,
    input  wire [NO*32-1:0]     b2_flat,
    output reg                  done,             // one-cycle pulse, out_* valid with it and after
    output reg  [1:0]           out_cls,
    output reg  [31:0]          out_margin,
    output reg  [TS_W-1:0]      out_ts,
    output reg  [WIN_IDX_W-1:0] out_frame_id,
    output reg  [7:0]           out_sat,
    output reg  [63:0]          out_x,            // loaded at start (with out_ts/out_frame_id/out_sat)
    output reg  [63:0]          out_h,            // h_7 .. h_0 (0 for rows >= NH); updated at completion
    output reg  [127:0]         out_logit         // sat32(logit_3 .. logit_0) (0 for rows >= NO); at completion
);
    localparam [1:0] S_IDLE = 2'd0, S_L1 = 2'd1, S_L2 = 2'd2, S_FIN = 2'd3;
    localparam [31:0] NH_M1_32 = NH - 1;
    localparam [31:0] NO_M1_32 = NO - 1;
    localparam [2:0]  NH_M1 = NH_M1_32[2:0];
    localparam [2:0]  NO_M1 = NO_M1_32[2:0];
    reg [1:0]          state;
    reg [2:0]          row;
    reg [2:0]          col;
    reg signed [33:0]  acc;
    reg signed [7:0]   x [0:7];
    reg [6:0]          h [0:7];
    reg signed [33:0]  logit [0:3];
    assign busy = (state != S_IDLE);

    // operands
    wire [2:0] n2_last = linear ? 3'd7 : NH_M1;
    wire [5:0] w1_idx = {row, col};
    wire [5:0] w2_idx = {row, col};
    wire signed [7:0] a_l1 = x[col];
    wire signed [7:0] a_l2 = linear ? x[col] : $signed({1'b0, h[col]});
    wire signed [7:0] w_l1 = $signed(w1_flat[8*w1_idx +: 8]);
    wire signed [7:0] w_l2 = $signed(w2_flat[8*w2_idx +: 8]);
    wire signed [7:0] a = (state == S_L1) ? a_l1 : a_l2;
    wire signed [7:0] w = (state == S_L1) ? w_l1 : w_l2;
    wire signed [15:0] prod = a * w;
    wire signed [33:0] sum  = acc + {{18{prod[15]}}, prod};
    wire signed [33:0] relu_in = sum >>> s1;
    wire [6:0] relu = (relu_in < 34'sd0) ? 7'd0 : (relu_in > 34'sd127) ? 7'd127 : relu_in[6:0];
    wire [2:0] row_p1 = row + 3'd1;
    wire signed [31:0] b1_next = $signed(b1_flat[32*row_p1 +: 32]);
    wire signed [31:0] b2_next = $signed(b2_flat[32*row_p1 +: 32]);
    wire signed [31:0] b1_0 = $signed(b1_flat[31:0]);
    wire signed [31:0] b2_0 = $signed(b2_flat[31:0]);

    // argmax and margin over the NO logits (lowest index wins ties)
    reg [1:0] best;
    reg signed [33:0] second;
    integer o;
    always @(*) begin
        best = 2'd0;
        for (o = 1; o < NO; o = o + 1)
            if (logit[o] > logit[best]) best = o[1:0];
        second = 34'sh2_0000_0000;                       // most negative 34-bit value
        for (o = 0; o < NO; o = o + 1)
            if (o[1:0] != best && logit[o] > second) second = logit[o];
    end
    wire signed [34:0] mdiff = {logit[best][33], logit[best]} - {second[33], second};
    wire [31:0] margin_sat = (mdiff > 35'sd2147483647) ? 32'h7FFF_FFFF :
                             (mdiff < -35'sd2147483648) ? 32'h8000_0000 : mdiff[31:0];

    function [31:0] sat32;
        input signed [33:0] v;
        begin
            sat32 = (v > 34'sd2147483647) ? 32'h7FFF_FFFF : (v < -34'sd2147483648) ? 32'h8000_0000 : v[31:0];
        end
    endfunction

    integer k;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= S_IDLE; row <= 3'd0; col <= 3'd0; acc <= 34'sd0;
            for (k = 0; k < 8; k = k + 1) begin x[k] <= 8'sd0; h[k] <= 7'd0; end
            for (k = 0; k < 4; k = k + 1) logit[k] <= 34'sd0;
            done <= 1'b0; out_cls <= 2'd0; out_margin <= 32'd0; out_ts <= {TS_W{1'b0}};
            out_frame_id <= {WIN_IDX_W{1'b0}}; out_sat <= 8'd0; out_x <= 64'd0; out_h <= 64'd0;
            out_logit <= 128'd0;
        end else begin
            done <= 1'b0;
            case (state)
                S_IDLE: if (start & enable) begin
                    for (k = 0; k < 8; k = k + 1) begin
                        x[k] <= in_x[8*k +: 8];
                        h[k] <= 7'd0;
                    end
                    for (k = 0; k < 4; k = k + 1) logit[k] <= 34'sd0;
                    out_ts <= in_ts;
                    out_frame_id <= in_frame_id;
                    out_sat <= in_sat;
                    out_x <= in_x;
                    row <= 3'd0;
                    col <= 3'd0;
                    if (linear) begin
                        acc <= {{2{b2_0[31]}}, b2_0};
                        state <= S_L2;
                    end else begin
                        acc <= {{2{b1_0[31]}}, b1_0};
                        state <= S_L1;
                    end
                end
                S_L1: begin
                    if (col == 3'd7) begin
                        h[row] <= relu;
                        col <= 3'd0;
                        if (row == NH_M1) begin
                            row <= 3'd0;
                            acc <= {{2{b2_0[31]}}, b2_0};
                            state <= S_L2;
                        end else begin
                            row <= row_p1;
                            acc <= {{2{b1_next[31]}}, b1_next};
                        end
                    end else begin
                        acc <= sum;
                        col <= col + 3'd1;
                    end
                end
                S_L2: begin
                    if (col == n2_last) begin
                        logit[row[1:0]] <= sum;
                        col <= 3'd0;
                        if (row == NO_M1) begin
                            row <= 3'd0;
                            state <= S_FIN;
                        end else begin
                            row <= row_p1;
                            acc <= {{2{b2_next[31]}}, b2_next};
                        end
                    end else begin
                        acc <= sum;
                        col <= col + 3'd1;
                    end
                end
                S_FIN: begin
                    done <= 1'b1;
                    out_cls <= best;
                    out_margin <= margin_sat;
                    for (k = 0; k < 8; k = k + 1)
                        out_h[8*k +: 8] <= {1'b0, h[k]};
                    for (k = 0; k < 4; k = k + 1)
                        out_logit[32*k +: 32] <= (k < NO) ? sat32(logit[k]) : 32'd0;
                    state <= S_IDLE;
                end
                default: state <= S_IDLE;
            endcase
            if (!enable) begin
                state <= S_IDLE;
                done <= 1'b0;
            end
        end
    end
endmodule

// ============================================================================
// Decoder top: quantiser, collector, pending register, model store, engine,
// prediction FIFO, counters and last-frame diagnostics.
// ============================================================================
module hbci_ai_decoder #(
    parameter integer NH        = 4,
    parameter integer NO        = 2,
    parameter integer TS_W      = 32,
    parameter integer WIN_IDX_W = 16,
    parameter integer PRED_LOG2 = 2     // prediction FIFO depth = 2^PRED_LOG2
) (
    input  wire                 clk,
    input  wire                 rst_n,
    // control
    input  wire                 cfg_ai_en,
    input  wire                 feat_sync,
    input  wire [7:0]           cfg_ch_mask,
    input  wire [TS_W-1:0]      cfg_frame_span,
    // features from hbci_readout_core
    input  wire                 feat_valid,
    input  wire [2:0]           feat_ch,
    input  wire [31:0]          feat_energy,
    input  wire [TS_W-1:0]      feat_ts,
    input  wire                 feat_sat,
    input  wire [WIN_IDX_W-1:0] feat_win,
    // model bus
    input  wire                 model_we,
    input  wire [5:0]           model_addr,
    input  wire [31:0]          model_wdata,
    output wire [31:0]          model_rdata,
    input  wire                 crc_we,
    input  wire [31:0]          crc_wdata,
    output wire [31:0]          crc_expected,
    input  wire                 model_verify,
    input  wire                 model_clear_rej,
    output wire                 model_valid,
    output wire                 model_error,
    output wire                 model_busy,
    output wire                 model_rejected,
    output wire [15:0]          model_id,
    output wire [31:0]          stat_model_wr_rej,
    // predictions (FIFO head)
    output wire                 pred_valid,
    input  wire                 pred_ready,       // pop
    output wire [1:0]           pred_class,
    output wire [31:0]          pred_margin,
    output wire [TS_W-1:0]      pred_ts,
    output wire [WIN_IDX_W-1:0] pred_frame_id,
    output wire [15:0]          pred_seq,
    output wire [3:0]           pred_flags,       // bit0 sat, bit1 gap
    output wire [PRED_LOG2:0]   pred_count,
    output reg                  pred_strobe,      // one cycle per emitted prediction
    output reg  [1:0]           pred_class_direct,
    // counters
    output wire [31:0]          stat_frames,
    output reg  [31:0]          stat_pred,
    output wire [31:0]          stat_incomplete,
    output wire [31:0]          stat_dup,
    output wire [31:0]          stat_late,
    output wire [31:0]          stat_span,
    output reg  [31:0]          stat_busy,
    output reg  [31:0]          stat_pred_drop,
    output reg  [31:0]          stat_nomodel,
    output reg  [31:0]          stat_sat_frames,
    // last inferred frame
    output wire [WIN_IDX_W-1:0] last_frame_id,
    output wire [7:0]           last_missing,
    output wire [7:0]           last_sat,
    output wire [63:0]          last_x,
    output wire [63:0]          last_h,
    output wire [127:0]         last_logit,
    output wire [TS_W-1:0]      last_ts
`ifdef FORMAL
    , output wire                f_pend_v,         // formal probes (SymbiYosys only)
    output wire                  f_eng_busy,
    output wire                  f_frame_valid,
    output wire [63:0]           f_frame_x,
    output wire                  f_col_open,
    output wire [7:0]            f_col_seen,
    output wire [WIN_IDX_W-1:0]  f_col_id
`endif
);
    // ------------------------------------------------------------- model
    wire [NH*64-1:0] w1_flat;
    wire [NO*64-1:0] w2_flat;
    wire [NH*32-1:0] b1_flat;
    wire [NO*32-1:0] b2_flat;
    wire [95:0]      centre_flat;
    wire [23:0]      qshift_flat;
    wire [4:0]       s1;
    wire             linear;

    hbci_model_store #(.NH(NH), .NO(NO)) u_model (
        .clk(clk), .rst_n(rst_n), .ai_en(cfg_ai_en),
        .we(model_we), .addr(model_addr), .wdata(model_wdata), .rdata(model_rdata),
        .crc_we(crc_we), .crc_wdata(crc_wdata), .crc_expected(crc_expected),
        .verify(model_verify), .clear_rej(model_clear_rej),
        .valid(model_valid), .error(model_error), .busy(model_busy), .rejected(model_rejected),
        .stat_wr_rej(stat_model_wr_rej),
        .w1_flat(w1_flat), .w2_flat(w2_flat), .b1_flat(b1_flat), .b2_flat(b2_flat),
        .centre_flat(centre_flat), .qshift_flat(qshift_flat), .s1(s1), .linear(linear),
        .model_id(model_id)
    );

    // --------------------------------------------------------- quantiser
    wire [10:0]       q_l;
    wire signed [7:0] q_x;
    /* verilator lint_off UNUSEDSIGNAL */
    wire [10:0] q_l_unused = q_l;
    /* verilator lint_on UNUSEDSIGNAL */
    hbci_feat_quant u_quant (
        .energy(feat_energy), .centre(centre_flat[12*feat_ch +: 12]), .qshift(qshift_flat[3*feat_ch +: 3]),
        .enabled(cfg_ch_mask[feat_ch]), .l(q_l), .x(q_x)
    );

    // --------------------------------------------------------- collector
    wire                 frame_valid;
    wire [WIN_IDX_W-1:0] frame_id;
    wire [TS_W-1:0]      frame_ts;
    wire [63:0]          frame_x;
    wire [7:0]           frame_sat;

    hbci_frame_collector #(.TS_W(TS_W), .WIN_IDX_W(WIN_IDX_W)) u_collect (
`ifdef FORMAL
        .f_open(f_col_open), .f_seen(f_col_seen), .f_id(f_col_id),
`endif
        .clk(clk), .rst_n(rst_n), .enable(cfg_ai_en), .sync(feat_sync),
        .ch_mask(cfg_ch_mask), .frame_span(cfg_frame_span),
        .feat_valid(feat_valid), .feat_ch(feat_ch), .feat_x(q_x), .feat_ts(feat_ts),
        .feat_sat(feat_sat), .feat_win(feat_win),
        .frame_valid(frame_valid), .frame_id(frame_id), .frame_ts(frame_ts), .frame_x(frame_x),
        .frame_sat(frame_sat),
        .stat_frames(stat_frames), .stat_incomplete(stat_incomplete), .stat_dup(stat_dup),
        .stat_late(stat_late), .stat_span(stat_span), .last_missing(last_missing)
    );

    // ------------------------------------------------- pending register
    reg                  pend_v;
    reg [WIN_IDX_W-1:0]  pend_id;
    reg [TS_W-1:0]       pend_ts;
    reg [63:0]           pend_x;
    reg [7:0]            pend_sat;
    wire                 eng_busy;
    wire                 eng_start = pend_v & ~eng_busy & cfg_ai_en;
`ifdef FORMAL
    assign f_pend_v = pend_v;
    assign f_eng_busy = eng_busy;
    assign f_frame_valid = frame_valid;
    assign f_frame_x = frame_x;
`endif

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            pend_v <= 1'b0; pend_id <= {WIN_IDX_W{1'b0}}; pend_ts <= {TS_W{1'b0}};
            pend_x <= 64'd0; pend_sat <= 8'd0;
            stat_busy <= 32'd0; stat_nomodel <= 32'd0;
        end else begin
            if (eng_start) pend_v <= 1'b0;
            if (frame_valid) begin
                if (!model_valid) begin
                    stat_nomodel <= stat_nomodel + 32'd1;
                end else if (pend_v & ~eng_start) begin
                    stat_busy <= stat_busy + 32'd1;
                end else begin
                    pend_v <= 1'b1; pend_id <= frame_id; pend_ts <= frame_ts;
                    pend_x <= frame_x; pend_sat <= frame_sat;
                end
            end
            if (!cfg_ai_en) pend_v <= 1'b0;
        end
    end

    // ------------------------------------------------------------ engine
    wire                 eng_done;
    wire [1:0]           eng_cls;
    wire [31:0]          eng_margin;
    wire [TS_W-1:0]      eng_ts;
    wire [WIN_IDX_W-1:0] eng_frame_id;
    wire [7:0]           eng_sat;

    hbci_mlp_engine #(.NH(NH), .NO(NO), .TS_W(TS_W), .WIN_IDX_W(WIN_IDX_W)) u_engine (
        .clk(clk), .rst_n(rst_n), .enable(cfg_ai_en), .start(eng_start), .busy(eng_busy),
        .in_x(pend_x), .in_frame_id(pend_id), .in_ts(pend_ts), .in_sat(pend_sat),
        .linear(linear), .s1(s1), .w1_flat(w1_flat), .w2_flat(w2_flat), .b1_flat(b1_flat), .b2_flat(b2_flat),
        .done(eng_done), .out_cls(eng_cls), .out_margin(eng_margin), .out_ts(eng_ts),
        .out_frame_id(eng_frame_id), .out_sat(eng_sat), .out_x(last_x), .out_h(last_h), .out_logit(last_logit)
    );
    assign last_frame_id = eng_frame_id;
    assign last_ts       = eng_ts;
    assign last_sat      = eng_sat;

    // --------------------------------------------------- prediction FIFO
    localparam integer DEPTH = 1 << PRED_LOG2;
    localparam integer PW = 2 + 32 + TS_W + WIN_IDX_W + 16 + 4;
    reg [PW-1:0]        pmem [0:DEPTH-1];
    reg [PRED_LOG2-1:0] pwr, prd;
    reg [PRED_LOG2:0]   pcnt;
    reg [15:0]          seq;
    reg                 gap;
    wire pfull = pcnt[PRED_LOG2];
    wire ppush = eng_done & ~pfull;
    wire ppop  = pred_valid & pred_ready;
    wire [3:0] pflags = {2'b00, gap, |eng_sat};
    wire [PW-1:0] pentry = {eng_cls, eng_margin, eng_ts, eng_frame_id, seq, pflags};
    wire [PW-1:0] phead = pmem[prd];

    assign pred_valid    = (pcnt != {(PRED_LOG2+1){1'b0}});
    assign pred_count    = pcnt;
    assign pred_flags    = phead[3:0];
    assign pred_seq      = phead[4 +: 16];
    assign pred_frame_id = phead[20 +: WIN_IDX_W];
    assign pred_ts       = phead[20+WIN_IDX_W +: TS_W];
    assign pred_margin   = phead[20+WIN_IDX_W+TS_W +: 32];
    assign pred_class    = phead[PW-1:PW-2];

    integer p;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (p = 0; p < DEPTH; p = p + 1) pmem[p] <= {PW{1'b0}};
            pwr <= {PRED_LOG2{1'b0}}; prd <= {PRED_LOG2{1'b0}}; pcnt <= {(PRED_LOG2+1){1'b0}};
            seq <= 16'd0; gap <= 1'b0; stat_pred <= 32'd0; stat_pred_drop <= 32'd0;
            stat_sat_frames <= 32'd0; pred_strobe <= 1'b0; pred_class_direct <= 2'd0;
        end else begin
            pred_strobe <= 1'b0;
            if (eng_done) begin
                if (|eng_sat) stat_sat_frames <= stat_sat_frames + 32'd1;
                if (pfull) begin
                    stat_pred_drop <= stat_pred_drop + 32'd1;
                    gap <= 1'b1;
                end else begin
                    pmem[pwr] <= pentry;
                    pwr <= pwr + {{(PRED_LOG2-1){1'b0}}, 1'b1};
                    seq <= seq + 16'd1;
                    gap <= 1'b0;
                    stat_pred <= stat_pred + 32'd1;
                    pred_strobe <= 1'b1;
                    pred_class_direct <= eng_cls;
                end
            end
            if (ppop) prd <= prd + {{(PRED_LOG2-1){1'b0}}, 1'b1};
            pcnt <= pcnt + (ppush ? {{PRED_LOG2{1'b0}}, 1'b1} : {(PRED_LOG2+1){1'b0}})
                         - (ppop  ? {{PRED_LOG2{1'b0}}, 1'b1} : {(PRED_LOG2+1){1'b0}});
        end
    end
endmodule

/* verilator lint_on DECLFILENAME */
`default_nettype wire
