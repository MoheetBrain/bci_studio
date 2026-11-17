// ============================================================================
// HBCI-01 — v0.3 readout core (hbci_readout_core)
// ----------------------------------------------------------------------------
// Specification: docs/V03_READOUT_SPEC.md. Shared constants (modes, record
// format, default filter coefficients): system/hbci_system.json.
//
// Wraps the UNCHANGED v0.2 event core (rtl/hbci_event_core.v, instance u_event)
// and adds, for a time-multiplexed stream of signed digital samples:
//   * RAW      every accepted sample (channel, value, sample index)
//   * FEATURE  a causal per-channel band-pass biquad (DF-I, Q2.14) and the
//              energy sum(y^2) over windows of 2^k samples of that channel
//   * EVENT    the legacy threshold events, re-packed as records
//   * HYBRID   RAW + FEATURE
// and a record multiplexer (pending registers, priority arbiter, FIFO) with
// explicit per-type sequence numbers, gap flags and drop counters.
//
// Capture is gated by the explicit control input cfg_session_en (no neural
// "wake word"). Channel state keeps updating while the session is off.
//
// RAW preserves only the digital values that ENTER this block. Nothing lost
// earlier (sensing, analog filtering, digitisation) can be recovered here.
//
// This is digital readout logic only: no electrodes, analog front end, ADC,
// power, telemetry or packaging, and no timing closure is claimed.
//
// v0.4 (HBCI-02): a feature tap for the on-chip AI decoder (ai_feat_*), taken
// BEFORE the record multiplexer and FIFO so output back-pressure never starves
// inference, carrying a per-channel 16-bit window index (frame identifier, see
// docs/AI_DECODER.md section 2), and a feat_sync input that re-synchronises the
// window counters of every channel. Record behaviour is unchanged from v0.3.
//
// Verilog-2005. Single clock, asynchronous active-low reset. Every register is
// reset (including the FIFO storage), so outputs are never X after reset.
// Parameter limits: 4 <= SAMPLE_W <= 30, 1 <= CH_W, NUM_CH <= 2^CH_W,
// 1 <= WIN_W <= 15, ACC_W >= 2*SAMPLE_W-1+WIN_W (no accumulator overflow),
// 1 <= FIFO_LOG2.
// ============================================================================
`timescale 1ns/1ps
`default_nettype none
// All v0.3 readout modules intentionally live in this one file.
/* verilator lint_off DECLFILENAME */

module hbci_readout_core #(
    parameter integer NUM_CH    = 8,    // number of input channels
    parameter integer CH_W      = 3,    // channel index width
    parameter integer SAMPLE_W  = 16,   // signed sample width
    parameter integer TS_W      = 32,   // sample index (timestamp) width
    parameter integer SEQ_W     = 16,   // per-type record sequence number width
    parameter integer FIFO_LOG2 = 4,    // record FIFO depth = 2^FIFO_LOG2
    parameter integer WIN_W     = 10,   // maximum energy window = 2^WIN_W samples
    parameter integer ACC_W     = 48,   // energy accumulator width
    parameter integer WIN_IDX_W = 16    // per-channel window index (frame identifier) width
) (
    input  wire                       clk,
    input  wire                       rst_n,

    // Configuration (quasi-static; sampled on use)
    input  wire                       cfg_session_en,   // 0: no records of any type are generated
    input  wire [1:0]                 cfg_mode,         // 0 EVENT, 1 RAW, 2 FEATURE, 3 HYBRID
    input  wire [SAMPLE_W-1:0]        cfg_threshold,    // legacy event core
    input  wire [SAMPLE_W-1:0]        cfg_hysteresis,   // legacy event core
    input  wire [7:0]                 cfg_refractory,   // legacy event core
    input  wire [3:0]                 cfg_alpha_shift,  // legacy event core
    input  wire signed [15:0]         cfg_b0,           // biquad coefficients, signed Q2.14
    input  wire signed [15:0]         cfg_b1,
    input  wire signed [15:0]         cfg_b2,
    input  wire signed [15:0]         cfg_a1,
    input  wire signed [15:0]         cfg_a2,
    input  wire [3:0]                 cfg_win_log2,     // window = 2^min(k, WIN_W) samples of a channel
    input  wire [5:0]                 cfg_energy_shift, // energy = sat32(sum >> shift)
    input  wire                       feat_sync,        // 1-cycle pulse: window counters of all channels <= 0

    // Sample input (ADC style: no back-pressure)
    input  wire                       in_valid,
    input  wire [CH_W-1:0]            in_channel,
    input  wire signed [SAMPLE_W-1:0] in_sample,

    // Record output (valid/ready)
    output wire                       rec_valid,
    input  wire                       rec_ready,
    output wire [1:0]                 rec_type,         // 0 RAW, 1 EVENT, 2 FEATURE
    output wire [CH_W-1:0]            rec_channel,
    output wire [3:0]                 rec_flags,        // bit0 sat, bit1 gap, bits 3:2 zero
    output wire [SEQ_W-1:0]           rec_seq,
    output wire [TS_W-1:0]            rec_ts,
    output wire [31:0]                rec_data,

    // Status counters
    output wire [TS_W-1:0]            stat_samples,     // accepted samples (== next sample index)
    output wire [TS_W-1:0]            stat_rejected,    // in_valid with channel >= NUM_CH
    output wire [31:0]                stat_drop_raw,
    output wire [31:0]                stat_drop_event,
    output wire [31:0]                stat_drop_feature,
    output reg  [31:0]                stat_event_missed,// samples u_event could not accept (stays 0)
    output wire [31:0]                stat_fifo_hwm,    // FIFO high-water mark, zero-extended
    // Feature tap for the on-chip AI decoder: before the record FIFO, not gated by
    // the output mode or the session (inference has its own enable).
    output wire                       ai_feat_valid,    // a window of channel ai_feat_ch completed this cycle
    output wire [CH_W-1:0]            ai_feat_ch,
    output wire [31:0]                ai_feat_energy,   // sat32(acc >> cfg_energy_shift), as in FEATURE records
    output wire [TS_W-1:0]            ai_feat_ts,       // index of the window's last sample
    output wire                       ai_feat_saturated,// FEATURE flags.sat of this window
    output wire [WIN_IDX_W-1:0]       ai_feat_win       // index of the completed window on that channel
);
    localparam integer FRAC_W = 8;      // legacy baseline fractional bits (v0.2 default)
    localparam integer REFR_W = 8;      // legacy refractory width (cfg_refractory[7:0])

    // ------------------------------------------------------------- accept
    wire [31:0] in_channel_x = {{(32-CH_W){1'b0}}, in_channel};
    wire ch_ok  = (in_channel_x < NUM_CH);
    wire accept = in_valid & ch_ok;      // updates channel state; index i = stat_samples
    wire reject = in_valid & ~ch_ok;     // ignored, counted in stat_rejected

    // Top-level sample index and rejected counter (reused v0.2 module)
    wire [TS_W-1:0] sample_idx;
    hbci_timestamp #(
        .TS_W(TS_W)
    ) u_ts (
        .clk(clk), .rst_n(rst_n),
        .tick(accept), .reject(reject),
        .ts_now(sample_idx), .rejected(stat_rejected)
    );
    assign stat_samples = sample_idx;

    // ------------------------------------------------- mode / session decode
    wire mode_event   = cfg_session_en & (cfg_mode == 2'd0);
    wire mode_raw     = cfg_session_en & cfg_mode[0];          // RAW (1) or HYBRID (3)
    wire mode_feature = cfg_session_en & cfg_mode[1];          // FEATURE (2) or HYBRID (3)

    // ------------------------------------------------------------ legacy path
    wire                ev_in_ready;
    wire                ev_valid;
    wire [CH_W-1:0]     ev_channel;
    wire [TS_W-1:0]     ev_timestamp;
    wire                ev_polarity;
    wire [SAMPLE_W-1:0] ev_magnitude;
    // u_event keeps its own counters; the top level uses u_ts instead.
    /* verilator lint_off UNUSEDSIGNAL */
    wire [TS_W-1:0]     ev_stat_samples, ev_stat_events, ev_stat_rejected;
    /* verilator lint_on UNUSEDSIGNAL */

    hbci_event_core #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W),
        .FRAC_W(FRAC_W), .TS_W(TS_W), .REFR_W(REFR_W)
    ) u_event (
        .clk(clk), .rst_n(rst_n),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .in_valid(in_valid), .in_ready(ev_in_ready),
        .in_channel(in_channel), .in_sample(in_sample),
        .ev_valid(ev_valid), .ev_ready(1'b1),               // always drained
        .ev_channel(ev_channel), .ev_timestamp(ev_timestamp),
        .ev_polarity(ev_polarity), .ev_magnitude(ev_magnitude),
        .stat_samples(ev_stat_samples), .stat_events(ev_stat_events),
        .stat_rejected(ev_stat_rejected)
    );

    // An EVENT record is generated in the cycle ev_valid is high (ev_ready = 1,
    // so each such cycle carries a distinct event).
    wire        event_gen  = ev_valid & mode_event;
    wire [31:0] event_data = {{(31-SAMPLE_W){1'b0}}, ev_polarity, ev_magnitude};

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            stat_event_missed <= 32'd0;
        else if (accept & ~ev_in_ready)
            stat_event_missed <= stat_event_missed + 32'd1;
    end

    // --------------------------------------------------------------- RAW path
    wire        raw_gen  = accept & mode_raw;
    wire [31:0] raw_data = {{(32-SAMPLE_W){in_sample[SAMPLE_W-1]}}, in_sample};

    // ----------------------------------------------------------- FEATURE path
    wire signed [SAMPLE_W-1:0] fs_x1, fs_x2, fs_y1, fs_y2;
    wire [ACC_W-1:0]           fs_acc;
    wire [WIN_W-1:0]           fs_cnt;
    wire                       fs_sat;
    wire [WIN_IDX_W-1:0]       fs_win;

    wire signed [SAMPLE_W-1:0] bq_y;
    wire                       bq_ysat;

    wire                       en_done;
    wire [31:0]                en_energy;
    wire                       en_feat_sat;
    wire [ACC_W-1:0]           en_acc_wr;
    wire [WIN_W-1:0]           en_cnt_wr;
    wire                       en_sat_wr;

    // Window index: advances when the window completes; feat_sync zeroes it (and
    // acc/cnt/sat) on every channel at once.
    localparam [WIN_IDX_W-1:0] WIN_ONE = {{(WIN_IDX_W-1){1'b0}}, 1'b1};
    wire [WIN_IDX_W-1:0] win_wr = en_done ? (fs_win + WIN_ONE) : fs_win;

    hbci_feature_state #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .ACC_W(ACC_W), .WIN_W(WIN_W),
        .WIN_IDX_W(WIN_IDX_W)
    ) u_fstate (
        .clk(clk), .rst_n(rst_n),
        .ch(in_channel),
        .rd_x1(fs_x1), .rd_x2(fs_x2), .rd_y1(fs_y1), .rd_y2(fs_y2),
        .rd_acc(fs_acc), .rd_cnt(fs_cnt), .rd_sat(fs_sat), .rd_win(fs_win),
        .we(accept),                     // every accepted sample, regardless of session/mode
        .sync(feat_sync),
        .wr_x(in_sample), .wr_y(bq_y),
        .wr_acc(en_acc_wr), .wr_cnt(en_cnt_wr), .wr_sat(en_sat_wr), .wr_win(win_wr)
    );

    hbci_biquad #(
        .SAMPLE_W(SAMPLE_W), .COEF_W(16), .COEF_FRAC(14)
    ) u_biquad (
        .x(in_sample), .x1(fs_x1), .x2(fs_x2), .y1(fs_y1), .y2(fs_y2),
        .b0(cfg_b0), .b1(cfg_b1), .b2(cfg_b2), .a1(cfg_a1), .a2(cfg_a2),
        .y(bq_y), .ysat(bq_ysat)
    );

    hbci_band_energy #(
        .SAMPLE_W(SAMPLE_W), .ACC_W(ACC_W), .WIN_W(WIN_W)
    ) u_energy (
        .y(bq_y), .ysat(bq_ysat),
        .acc(fs_acc), .cnt(fs_cnt), .sat(fs_sat),
        .win_log2(cfg_win_log2), .energy_shift(cfg_energy_shift),
        .done(en_done), .energy(en_energy), .feat_sat(en_feat_sat),
        .acc_wr(en_acc_wr), .cnt_wr(en_cnt_wr), .sat_wr(en_sat_wr)
    );

    wire feat_gen = accept & en_done & mode_feature;

    // AI tap: every completed window, in every mode; suppressed in a sync cycle
    // (the window that ends in that cycle is discarded together with the counters).
    assign ai_feat_valid     = accept & en_done & ~feat_sync;
    assign ai_feat_ch        = in_channel;
    assign ai_feat_energy    = en_energy;
    assign ai_feat_ts        = sample_idx;
    assign ai_feat_saturated = en_feat_sat;
    assign ai_feat_win       = fs_win;

    // ------------------------------------------------------------- records
    wire [FIFO_LOG2:0] fifo_hwm;

    hbci_record_mux #(
        .CH_W(CH_W), .TS_W(TS_W), .SEQ_W(SEQ_W), .FIFO_LOG2(FIFO_LOG2)
    ) u_records (
        .clk(clk), .rst_n(rst_n),
        .raw_gen(raw_gen), .raw_ch(in_channel), .raw_ts(sample_idx), .raw_data(raw_data),
        .ev_gen(event_gen), .ev_ch(ev_channel), .ev_ts(ev_timestamp), .ev_data(event_data),
        .ft_gen(feat_gen), .ft_ch(in_channel), .ft_ts(sample_idx), .ft_data(en_energy),
        .ft_sat(en_feat_sat),
        .rec_valid(rec_valid), .rec_ready(rec_ready),
        .rec_type(rec_type), .rec_channel(rec_channel), .rec_flags(rec_flags),
        .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .drop_raw(stat_drop_raw), .drop_event(stat_drop_event), .drop_feature(stat_drop_feature),
        .fifo_hwm(fifo_hwm)
    );
    assign stat_fifo_hwm = {{(31-FIFO_LOG2){1'b0}}, fifo_hwm};
endmodule

// ============================================================================
// Per-channel feature register file: one read/write port addressed by `ch`.
// Per channel: x1, x2, y1, y2 (filter history), acc (window energy), cnt
// (samples in the current window) and sat (saturation seen in the window).
// On a write the filter history shifts: x2 <= x1, x1 <= wr_x, y2 <= y1,
// y1 <= wr_y. Reads are combinational; out-of-range reads return zeros.
// ============================================================================
module hbci_feature_state #(
    parameter integer NUM_CH    = 8,
    parameter integer CH_W      = 3,
    parameter integer SAMPLE_W  = 16,
    parameter integer ACC_W     = 48,
    parameter integer WIN_W     = 10,
    parameter integer WIN_IDX_W = 16
) (
    input  wire                       clk,
    input  wire                       rst_n,
    input  wire [CH_W-1:0]            ch,
    output wire signed [SAMPLE_W-1:0] rd_x1,
    output wire signed [SAMPLE_W-1:0] rd_x2,
    output wire signed [SAMPLE_W-1:0] rd_y1,
    output wire signed [SAMPLE_W-1:0] rd_y2,
    output wire [ACC_W-1:0]           rd_acc,
    output wire [WIN_W-1:0]           rd_cnt,
    output wire                       rd_sat,
    output wire [WIN_IDX_W-1:0]       rd_win,
    input  wire                       we,
    input  wire                       sync,             // acc, cnt, sat, win of every channel <= 0
    input  wire signed [SAMPLE_W-1:0] wr_x,
    input  wire signed [SAMPLE_W-1:0] wr_y,
    input  wire [ACC_W-1:0]           wr_acc,
    input  wire [WIN_W-1:0]           wr_cnt,
    input  wire                       wr_sat,
    input  wire [WIN_IDX_W-1:0]       wr_win
);
    reg signed [SAMPLE_W-1:0] x1  [0:NUM_CH-1];
    reg signed [SAMPLE_W-1:0] x2  [0:NUM_CH-1];
    reg signed [SAMPLE_W-1:0] y1  [0:NUM_CH-1];
    reg signed [SAMPLE_W-1:0] y2  [0:NUM_CH-1];
    reg [ACC_W-1:0]           acc [0:NUM_CH-1];
    reg [WIN_W-1:0]           cnt [0:NUM_CH-1];
    reg [NUM_CH-1:0]          sat;
    reg [WIN_IDX_W-1:0]       win [0:NUM_CH-1];

    wire [31:0] ch_x = {{(32-CH_W){1'b0}}, ch};
    wire in_range = (ch_x < NUM_CH);
    assign rd_x1  = in_range ? x1[ch]  : {SAMPLE_W{1'b0}};
    assign rd_x2  = in_range ? x2[ch]  : {SAMPLE_W{1'b0}};
    assign rd_y1  = in_range ? y1[ch]  : {SAMPLE_W{1'b0}};
    assign rd_y2  = in_range ? y2[ch]  : {SAMPLE_W{1'b0}};
    assign rd_acc = in_range ? acc[ch] : {ACC_W{1'b0}};
    assign rd_cnt = in_range ? cnt[ch] : {WIN_W{1'b0}};
    assign rd_sat = in_range ? sat[ch] : 1'b0;
    assign rd_win = in_range ? win[ch] : {WIN_IDX_W{1'b0}};

    integer i;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (i = 0; i < NUM_CH; i = i + 1) begin
                x1[i]  <= {SAMPLE_W{1'b0}};
                x2[i]  <= {SAMPLE_W{1'b0}};
                y1[i]  <= {SAMPLE_W{1'b0}};
                y2[i]  <= {SAMPLE_W{1'b0}};
                acc[i] <= {ACC_W{1'b0}};
                cnt[i] <= {WIN_W{1'b0}};
                win[i] <= {WIN_IDX_W{1'b0}};
            end
            sat <= {NUM_CH{1'b0}};
        end else begin
            if (we && in_range) begin
                x2[ch]  <= x1[ch];
                x1[ch]  <= wr_x;
                y2[ch]  <= y1[ch];
                y1[ch]  <= wr_y;
                acc[ch] <= wr_acc;
                cnt[ch] <= wr_cnt;
                sat[ch] <= wr_sat;
                win[ch] <= wr_win;
            end
            if (sync) begin                  // wins over the write of the same cycle
                for (i = 0; i < NUM_CH; i = i + 1) begin
                    acc[i] <= {ACC_W{1'b0}};
                    cnt[i] <= {WIN_W{1'b0}};
                    win[i] <= {WIN_IDX_W{1'b0}};
                end
                sat <= {NUM_CH{1'b0}};
            end
        end
    end
endmodule

// ============================================================================
// Direct-form-I biquad with rounding and saturation. Combinational, exact.
//   p      = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2      (ACC_W = SAMPLE_W+COEF_W+3
//                                                     bits: no intermediate overflow)
//   y_full = (p + 2^(COEF_FRAC-1)) >>> COEF_FRAC        (round half up)
//   y      = sat_SAMPLE_W(y_full),  ysat = (y_full != y)
// The shipped core uses COEF_W = 16, COEF_FRAC = 14 (signed Q2.14).
// ============================================================================
module hbci_biquad #(
    parameter integer SAMPLE_W  = 16,
    parameter integer COEF_W    = 16,
    parameter integer COEF_FRAC = 14
) (
    input  wire signed [SAMPLE_W-1:0] x,
    input  wire signed [SAMPLE_W-1:0] x1,
    input  wire signed [SAMPLE_W-1:0] x2,
    input  wire signed [SAMPLE_W-1:0] y1,
    input  wire signed [SAMPLE_W-1:0] y2,
    input  wire signed [COEF_W-1:0]   b0,
    input  wire signed [COEF_W-1:0]   b1,
    input  wire signed [COEF_W-1:0]   b2,
    input  wire signed [COEF_W-1:0]   a1,
    input  wire signed [COEF_W-1:0]   a2,
    output wire signed [SAMPLE_W-1:0] y,
    output wire                       ysat
);
    localparam integer P_W  = SAMPLE_W + COEF_W + 3;   // 35 bits for 16 x 16
    localparam integer YF_W = P_W - COEF_FRAC;         // width of y_full (21 bits)

    // Operands sign-extended to the full accumulator width, so every product
    // and sum below is exact two's-complement arithmetic in P_W bits.
    wire signed [P_W-1:0] sx  = {{(P_W-SAMPLE_W){x[SAMPLE_W-1]}},  x};
    wire signed [P_W-1:0] sx1 = {{(P_W-SAMPLE_W){x1[SAMPLE_W-1]}}, x1};
    wire signed [P_W-1:0] sx2 = {{(P_W-SAMPLE_W){x2[SAMPLE_W-1]}}, x2};
    wire signed [P_W-1:0] sy1 = {{(P_W-SAMPLE_W){y1[SAMPLE_W-1]}}, y1};
    wire signed [P_W-1:0] sy2 = {{(P_W-SAMPLE_W){y2[SAMPLE_W-1]}}, y2};
    wire signed [P_W-1:0] cb0 = {{(P_W-COEF_W){b0[COEF_W-1]}}, b0};
    wire signed [P_W-1:0] cb1 = {{(P_W-COEF_W){b1[COEF_W-1]}}, b1};
    wire signed [P_W-1:0] cb2 = {{(P_W-COEF_W){b2[COEF_W-1]}}, b2};
    wire signed [P_W-1:0] ca1 = {{(P_W-COEF_W){a1[COEF_W-1]}}, a1};
    wire signed [P_W-1:0] ca2 = {{(P_W-COEF_W){a2[COEF_W-1]}}, a2};

    wire signed [P_W-1:0] m_b0 = cb0 * sx;
    wire signed [P_W-1:0] m_b1 = cb1 * sx1;
    wire signed [P_W-1:0] m_b2 = cb2 * sx2;
    wire signed [P_W-1:0] m_a1 = ca1 * sy1;
    wire signed [P_W-1:0] m_a2 = ca2 * sy2;
    wire signed [P_W-1:0] p    = m_b0 + m_b1 + m_b2 - m_a1 - m_a2;

    // Rounding constant 2^(COEF_FRAC-1); the low COEF_FRAC bits of p_r are
    // discarded by the arithmetic shift (floor), so they are intentionally unused.
    localparam [P_W-1:0] ROUND = {{(P_W-COEF_FRAC){1'b0}}, 1'b1, {(COEF_FRAC-1){1'b0}}};
    /* verilator lint_off UNUSEDSIGNAL */
    wire signed [P_W-1:0] p_r  = p + ROUND;
    /* verilator lint_on UNUSEDSIGNAL */
    wire signed [YF_W-1:0] y_full = p_r[P_W-1:COEF_FRAC];   // == p_r >>> COEF_FRAC

    // y_full fits SAMPLE_W bits iff its top YF_W-SAMPLE_W+1 bits are all equal.
    wire [YF_W-SAMPLE_W:0] top = y_full[YF_W-1:SAMPLE_W-1];
    wire fits = (&top) | ~(|top);
    localparam [SAMPLE_W-1:0] Y_MAX = {1'b0, {(SAMPLE_W-1){1'b1}}};
    localparam [SAMPLE_W-1:0] Y_MIN = {1'b1, {(SAMPLE_W-1){1'b0}}};
    assign y    = fits ? y_full[SAMPLE_W-1:0] : (y_full[YF_W-1] ? Y_MIN : Y_MAX);
    assign ysat = ~fits;
endmodule

// ============================================================================
// Band energy: square, accumulate, window-done and output saturation.
// Combinational.
//   sq       = y*y                                   (2*SAMPLE_W-1 bits, unsigned)
//   acc_next = acc + sq                              (ACC_W bits, exact)
//   k        = min(win_log2, WIN_W),  win = 2^k
//   done     = (cnt >= win - 1)
//   energy   = sat32(acc_next >> energy_shift),  esat = value did not fit 32 bits
//   feat_sat = sat | ysat | esat                     (FEATURE record flags.sat)
//   done:  acc, cnt, sat <= 0
//   else:  acc <= acc_next, cnt <= cnt + 1, sat <= sat | ysat
// `done` uses >= rather than == so that shrinking the window while a window is
// open ends it at the next sample (identical to == while cfg is constant).
// ============================================================================
module hbci_band_energy #(
    parameter integer SAMPLE_W = 16,
    parameter integer ACC_W    = 48,
    parameter integer WIN_W    = 10
) (
    input  wire signed [SAMPLE_W-1:0] y,
    input  wire                       ysat,
    input  wire [ACC_W-1:0]           acc,
    input  wire [WIN_W-1:0]           cnt,
    input  wire                       sat,
    input  wire [3:0]                 win_log2,
    input  wire [5:0]                 energy_shift,
    output wire                       done,
    output wire [31:0]                energy,
    output wire                       feat_sat,
    output wire [ACC_W-1:0]           acc_wr,
    output wire [WIN_W-1:0]           cnt_wr,
    output wire                       sat_wr
);
    localparam integer SQ_W = 2 * SAMPLE_W - 1;

    // y*y <= 2^(2*SAMPLE_W-2) (y = -2^(SAMPLE_W-1)), so the top bit of the
    // 2*SAMPLE_W-bit signed product is always 0 and is intentionally unused.
    wire signed [2*SAMPLE_W-1:0] y_x = {{SAMPLE_W{y[SAMPLE_W-1]}}, y};
    /* verilator lint_off UNUSEDSIGNAL */
    wire signed [2*SAMPLE_W-1:0] sq_full = y_x * y_x;
    /* verilator lint_on UNUSEDSIGNAL */
    wire [SQ_W-1:0]  sq       = sq_full[SQ_W-1:0];
    wire [ACC_W-1:0] acc_next = acc + {{(ACC_W-SQ_W){1'b0}}, sq};

    // Window: k = min(win_log2, WIN_W); win - 1 = WIN_W-bit mask of k ones.
    wire [31:0]      wl_x   = {28'd0, win_log2};
    wire [31:0]      k      = (wl_x > WIN_W) ? WIN_W : wl_x;
    wire [WIN_W-1:0] win_m1 = ~({WIN_W{1'b1}} << k);
    assign done = (cnt >= win_m1);

    // Output scaling and saturation to 32 bits.
    wire [ACC_W-1:0] shifted = acc_next >> energy_shift;
    wire             esat;
    generate
        if (ACC_W > 32) begin : g_sat
            assign esat   = |shifted[ACC_W-1:32];
            assign energy = esat ? 32'hFFFF_FFFF : shifted[31:0];
        end else begin : g_nosat
            assign esat   = 1'b0;
            assign energy = {{(32-ACC_W){1'b0}}, shifted};
        end
    endgenerate

    assign feat_sat = sat | ysat | esat;
    assign acc_wr   = done ? {ACC_W{1'b0}} : acc_next;
    assign cnt_wr   = done ? {WIN_W{1'b0}} : (cnt + {{(WIN_W-1){1'b0}}, 1'b1});
    assign sat_wr   = done ? 1'b0 : (sat | ysat);
endmodule

// ============================================================================
// Record multiplexer: pending registers, arbiter, FIFO, seq/gap/drop rules.
//   * Three 1-deep pending registers (RAW, EVENT, FEATURE). A record generated
//     while its pending register is full and not being emptied this cycle is
//     DROPPED: drop_<type>++ and gap_pending[type] is set.
//   * seq_<type> increments for every generated record (dropped or not); the
//     first record of each type after reset has seq 0.
//   * A record accepted into its pending register takes gap = gap_pending[type]
//     and clears gap_pending[type]. So flags.gap is set on exactly the first
//     emitted record GENERATED after a loss, i.e. the record whose seq jumps.
//   * Each cycle at most one pending record moves into the FIFO if the FIFO is
//     not full (registered occupancy): priority EVENT > FEATURE > RAW.
//   * A record generated in the cycle its pending register empties into the
//     FIFO is accepted (not dropped).
//   * The FIFO head drives rec_*; a record leaves on rec_valid & rec_ready.
// FIFO entry: {type[1:0], channel, flags[3:0], seq, ts, data[31:0]}.
// ============================================================================
module hbci_record_mux #(
    parameter integer CH_W      = 3,
    parameter integer TS_W      = 32,
    parameter integer SEQ_W     = 16,
    parameter integer FIFO_LOG2 = 4
) (
    input  wire                 clk,
    input  wire                 rst_n,
    input  wire                 raw_gen,
    input  wire [CH_W-1:0]      raw_ch,
    input  wire [TS_W-1:0]      raw_ts,
    input  wire [31:0]          raw_data,
    input  wire                 ev_gen,
    input  wire [CH_W-1:0]      ev_ch,
    input  wire [TS_W-1:0]      ev_ts,
    input  wire [31:0]          ev_data,
    input  wire                 ft_gen,
    input  wire [CH_W-1:0]      ft_ch,
    input  wire [TS_W-1:0]      ft_ts,
    input  wire [31:0]          ft_data,
    input  wire                 ft_sat,
    output wire                 rec_valid,
    input  wire                 rec_ready,
    output wire [1:0]           rec_type,
    output wire [CH_W-1:0]      rec_channel,
    output wire [3:0]           rec_flags,
    output wire [SEQ_W-1:0]     rec_seq,
    output wire [TS_W-1:0]      rec_ts,
    output wire [31:0]          rec_data,
    output reg  [31:0]          drop_raw,
    output reg  [31:0]          drop_event,
    output reg  [31:0]          drop_feature,
    output reg  [FIFO_LOG2:0]   fifo_hwm
);
    localparam integer DEPTH   = 1 << FIFO_LOG2;
    localparam integer ENTRY_W = 2 + CH_W + 4 + SEQ_W + TS_W + 32;
    localparam [1:0] T_RAW = 2'd0, T_EVENT = 2'd1, T_FEATURE = 2'd2;
    localparam [SEQ_W-1:0]   SEQ_ONE = {{(SEQ_W-1){1'b0}}, 1'b1};
    localparam [FIFO_LOG2:0] CNT_ONE = {{FIFO_LOG2{1'b0}}, 1'b1};
    localparam [FIFO_LOG2-1:0] PTR_ONE = {{(FIFO_LOG2-1){1'b0}}, 1'b1};

    // ------------------------------------------------------ pending registers
    reg              p_raw_v, p_raw_gap;
    reg [CH_W-1:0]   p_raw_ch;
    reg [TS_W-1:0]   p_raw_ts;
    reg [31:0]       p_raw_data;
    reg [SEQ_W-1:0]  p_raw_seq;

    reg              p_ev_v, p_ev_gap;
    reg [CH_W-1:0]   p_ev_ch;
    reg [TS_W-1:0]   p_ev_ts;
    reg [31:0]       p_ev_data;
    reg [SEQ_W-1:0]  p_ev_seq;

    reg              p_ft_v, p_ft_gap, p_ft_sat;
    reg [CH_W-1:0]   p_ft_ch;
    reg [TS_W-1:0]   p_ft_ts;
    reg [31:0]       p_ft_data;
    reg [SEQ_W-1:0]  p_ft_seq;

    reg [SEQ_W-1:0]  seq_raw, seq_ev, seq_ft;      // next sequence number per type
    reg              gp_raw, gp_ev, gp_ft;         // gap_pending per type

    // --------------------------------------------------------------- FIFO
    reg [ENTRY_W-1:0]   mem [0:DEPTH-1];
    reg [FIFO_LOG2-1:0] wr_ptr, rd_ptr;
    reg [FIFO_LOG2:0]   count;

    wire fifo_full = count[FIFO_LOG2];             // count <= DEPTH, so MSB set <=> full
    assign rec_valid = (count != {(FIFO_LOG2+1){1'b0}});
    wire pop = rec_valid & rec_ready;

    // ------------------------------------------------------------ arbiter
    wire mv_ev  = p_ev_v & ~fifo_full;
    wire mv_ft  = p_ft_v & ~p_ev_v & ~fifo_full;
    wire mv_raw = p_raw_v & ~p_ev_v & ~p_ft_v & ~fifo_full;
    wire push   = mv_ev | mv_ft | mv_raw;

    wire [ENTRY_W-1:0] e_ev  = {T_EVENT,   p_ev_ch,  2'b00, p_ev_gap,  1'b0,     p_ev_seq,  p_ev_ts,  p_ev_data};
    wire [ENTRY_W-1:0] e_ft  = {T_FEATURE, p_ft_ch,  2'b00, p_ft_gap,  p_ft_sat, p_ft_seq,  p_ft_ts,  p_ft_data};
    wire [ENTRY_W-1:0] e_raw = {T_RAW,     p_raw_ch, 2'b00, p_raw_gap, 1'b0,     p_raw_seq, p_raw_ts, p_raw_data};
    wire [ENTRY_W-1:0] entry = mv_ev ? e_ev : (mv_ft ? e_ft : e_raw);

    wire [FIFO_LOG2:0] count_next = push ? (pop ? count : count + CNT_ONE)
                                         : (pop ? count - CNT_ONE : count);

    // FIFO head
    wire [ENTRY_W-1:0] head = mem[rd_ptr];
    assign rec_data    = head[31:0];
    assign rec_ts      = head[32 +: TS_W];
    assign rec_seq     = head[32 + TS_W +: SEQ_W];
    assign rec_flags   = head[32 + TS_W + SEQ_W +: 4];
    assign rec_channel = head[36 + TS_W + SEQ_W +: CH_W];
    assign rec_type    = head[36 + TS_W + SEQ_W + CH_W +: 2];

    integer i;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (i = 0; i < DEPTH; i = i + 1) mem[i] <= {ENTRY_W{1'b0}};
            wr_ptr <= {FIFO_LOG2{1'b0}};
            rd_ptr <= {FIFO_LOG2{1'b0}};
            count  <= {(FIFO_LOG2+1){1'b0}};
            fifo_hwm <= {(FIFO_LOG2+1){1'b0}};
        end else begin
            if (push) begin
                mem[wr_ptr] <= entry;
                wr_ptr <= wr_ptr + PTR_ONE;
            end
            if (pop) rd_ptr <= rd_ptr + PTR_ONE;
            count <= count_next;
            if (count_next > fifo_hwm) fifo_hwm <= count_next;
        end
    end

    // ------------------------------------------- RAW pending register
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            p_raw_v <= 1'b0; p_raw_gap <= 1'b0; p_raw_ch <= {CH_W{1'b0}};
            p_raw_ts <= {TS_W{1'b0}}; p_raw_data <= 32'd0; p_raw_seq <= {SEQ_W{1'b0}};
            seq_raw <= {SEQ_W{1'b0}}; gp_raw <= 1'b0; drop_raw <= 32'd0;
        end else if (raw_gen) begin
            seq_raw <= seq_raw + SEQ_ONE;
            if (p_raw_v & ~mv_raw) begin              // register still full: drop
                drop_raw <= drop_raw + 32'd1;
                gp_raw   <= 1'b1;
            end else begin                            // accept
                p_raw_v <= 1'b1; p_raw_gap <= gp_raw; p_raw_ch <= raw_ch;
                p_raw_ts <= raw_ts; p_raw_data <= raw_data; p_raw_seq <= seq_raw;
                gp_raw  <= 1'b0;
            end
        end else if (mv_raw) begin
            p_raw_v <= 1'b0;
        end
    end

    // ----------------------------------------- EVENT pending register
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            p_ev_v <= 1'b0; p_ev_gap <= 1'b0; p_ev_ch <= {CH_W{1'b0}};
            p_ev_ts <= {TS_W{1'b0}}; p_ev_data <= 32'd0; p_ev_seq <= {SEQ_W{1'b0}};
            seq_ev <= {SEQ_W{1'b0}}; gp_ev <= 1'b0; drop_event <= 32'd0;
        end else if (ev_gen) begin
            seq_ev <= seq_ev + SEQ_ONE;
            if (p_ev_v & ~mv_ev) begin
                drop_event <= drop_event + 32'd1;
                gp_ev      <= 1'b1;
            end else begin
                p_ev_v <= 1'b1; p_ev_gap <= gp_ev; p_ev_ch <= ev_ch;
                p_ev_ts <= ev_ts; p_ev_data <= ev_data; p_ev_seq <= seq_ev;
                gp_ev  <= 1'b0;
            end
        end else if (mv_ev) begin
            p_ev_v <= 1'b0;
        end
    end

    // --------------------------------------- FEATURE pending register
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            p_ft_v <= 1'b0; p_ft_gap <= 1'b0; p_ft_sat <= 1'b0; p_ft_ch <= {CH_W{1'b0}};
            p_ft_ts <= {TS_W{1'b0}}; p_ft_data <= 32'd0; p_ft_seq <= {SEQ_W{1'b0}};
            seq_ft <= {SEQ_W{1'b0}}; gp_ft <= 1'b0; drop_feature <= 32'd0;
        end else if (ft_gen) begin
            seq_ft <= seq_ft + SEQ_ONE;
            if (p_ft_v & ~mv_ft) begin
                drop_feature <= drop_feature + 32'd1;
                gp_ft        <= 1'b1;
            end else begin
                p_ft_v <= 1'b1; p_ft_gap <= gp_ft; p_ft_sat <= ft_sat; p_ft_ch <= ft_ch;
                p_ft_ts <= ft_ts; p_ft_data <= ft_data; p_ft_seq <= seq_ft;
                gp_ft  <= 1'b0;
            end
        end else if (mv_ft) begin
            p_ft_v <= 1'b0;
        end
    end
endmodule

/* verilator lint_on DECLFILENAME */
`default_nettype wire
