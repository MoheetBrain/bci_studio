// ============================================================================
// HBCI-01 — Hamiltonian BCI event core (v0.2)
// ----------------------------------------------------------------------------
// Converts a time-multiplexed stream of signed neural samples (one sample per
// accepted handshake, tagged with a channel number) into a sparse stream of
// threshold-crossing events. Per channel it keeps:
//   * an exponential-moving-average baseline (Q16.8 fixed point)
//   * an "armed" flag (hysteresis: must fall below threshold-hysteresis to re-arm)
//   * a refractory down-counter (counted in that channel's own samples)
//   * a "primed" flag (the first sample initialises the baseline, no detection)
//
// Event-only output is LOSSY: the raw waveform cannot be reconstructed from it.
//
// This is a digital event core only. It is NOT a complete BCI: electrodes,
// analog front end, ADC, power, telemetry and packaging are outside this RTL.
//
// Verilog-2005. Single clock, asynchronous active-low reset.
//
// v0.2: lint-clean under `verilator --lint-only -Wall` (explicit sign extension
// and sizing, named ev_push wire; logic proven equivalent to v0.1).
// ============================================================================
`timescale 1ns/1ps
`default_nettype none
// All HBCI modules intentionally live in this one file.
/* verilator lint_off DECLFILENAME */

module hbci_event_core #(
    parameter integer NUM_CH   = 8,   // number of input channels
    parameter integer CH_W     = 3,   // channel index width
    parameter integer SAMPLE_W = 16,  // signed sample width
    parameter integer FRAC_W   = 8,   // baseline fractional bits
    parameter integer TS_W     = 32,  // timestamp width
    parameter integer REFR_W   = 8    // refractory counter width
) (
    input  wire                       clk,
    input  wire                       rst_n,

    // Configuration (quasi-static; sampled every accepted sample)
    input  wire [SAMPLE_W-1:0]        cfg_threshold,    // |residual| >= threshold fires; 0 disables detection
    input  wire [SAMPLE_W-1:0]        cfg_hysteresis,   // re-arm when |residual| < threshold - hysteresis
    input  wire [REFR_W-1:0]          cfg_refractory,   // samples of the same channel ignored after an event
    input  wire [3:0]                 cfg_alpha_shift,  // baseline EMA: b += (x - b) >>> alpha_shift

    // Sample input stream (valid/ready)
    input  wire                       in_valid,
    output wire                       in_ready,
    input  wire [CH_W-1:0]            in_channel,
    input  wire signed [SAMPLE_W-1:0] in_sample,

    // Event output stream (valid/ready)
    output wire                       ev_valid,
    input  wire                       ev_ready,
    output wire [CH_W-1:0]            ev_channel,
    output wire [TS_W-1:0]            ev_timestamp,
    output wire                       ev_polarity,      // 1 = negative-going residual
    output wire [SAMPLE_W-1:0]        ev_magnitude,     // |residual| at the crossing sample

    // Status counters
    output wire [TS_W-1:0]            stat_samples,     // accepted samples (== next timestamp)
    output wire [TS_W-1:0]            stat_events,      // events emitted
    output wire [TS_W-1:0]            stat_rejected     // handshakes with an out-of-range channel
);
    localparam integer BASE_W = SAMPLE_W + FRAC_W;

    // ---------------------------------------------------------------- handshake
    // Channel index zero-extended to 32 bits so the range check is width-clean.
    wire [31:0] in_channel_x = {{(32-CH_W){1'b0}}, in_channel};
    wire hs        = in_valid & in_ready;
    wire ch_ok     = (in_channel_x < NUM_CH);
    wire accept    = hs & ch_ok;          // a sample that updates channel state
    wire reject    = hs & ~ch_ok;         // consumed but ignored

    // ------------------------------------------------------------ channel state
    wire signed [BASE_W-1:0] st_baseline;
    wire [REFR_W-1:0]        st_refr;
    wire                     st_armed;
    wire                     st_primed;

    wire signed [BASE_W-1:0] nx_baseline;
    wire [REFR_W-1:0]        nx_refr;
    wire                     nx_armed;

    hbci_channel_state #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .BASE_W(BASE_W), .REFR_W(REFR_W)
    ) u_state (
        .clk(clk), .rst_n(rst_n),
        .ch(in_channel),
        .rd_baseline(st_baseline), .rd_refr(st_refr),
        .rd_armed(st_armed), .rd_primed(st_primed),
        .we(accept),
        .wr_baseline(nx_baseline), .wr_refr(nx_refr), .wr_armed(nx_armed)
    );

    // --------------------------------------------------- baseline and residual
    wire signed [SAMPLE_W:0] residual;

    hbci_baseline_ema #(
        .SAMPLE_W(SAMPLE_W), .FRAC_W(FRAC_W)
    ) u_baseline (
        .sample(in_sample), .baseline_q(st_baseline),
        .alpha_shift(cfg_alpha_shift), .primed(st_primed),
        .residual(residual), .baseline_next(nx_baseline)
    );

    // ------------------------------------------------------- threshold detector
    wire [SAMPLE_W-1:0] magnitude;
    wire                polarity, above, below_rearm, det_enable;

    hbci_threshold_detector #(
        .SAMPLE_W(SAMPLE_W)
    ) u_threshold (
        .residual(residual),
        .threshold(cfg_threshold), .hysteresis(cfg_hysteresis),
        .magnitude(magnitude), .polarity(polarity),
        .above(above), .below_rearm(below_rearm), .enable(det_enable)
    );

    // ----------------------------------------------- hysteresis and refractory
    wire fire;

    hbci_refractory_ctrl #(
        .REFR_W(REFR_W)
    ) u_refractory (
        .primed(st_primed), .enable(det_enable),
        .armed(st_armed), .refr_cnt(st_refr),
        .above(above), .below_rearm(below_rearm),
        .cfg_refractory(cfg_refractory),
        .fire(fire), .armed_next(nx_armed), .refr_next(nx_refr)
    );

    // ---------------------------------------------------------------- timestamp
    wire [TS_W-1:0] ts_now;

    hbci_timestamp #(
        .TS_W(TS_W)
    ) u_timestamp (
        .clk(clk), .rst_n(rst_n),
        .tick(accept), .reject(reject),
        .ts_now(ts_now), .rejected(stat_rejected)
    );
    assign stat_samples = ts_now;

    // ------------------------------------------------------------- event output
    wire ev_push = accept & fire;         // an accepted sample crossed the threshold

    hbci_event_packer #(
        .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W)
    ) u_packer (
        .clk(clk), .rst_n(rst_n),
        .push(ev_push),
        .in_channel(in_channel), .in_timestamp(ts_now),
        .in_polarity(polarity), .in_magnitude(magnitude),
        .ev_valid(ev_valid), .ev_ready(ev_ready),
        .ev_channel(ev_channel), .ev_timestamp(ev_timestamp),
        .ev_polarity(ev_polarity), .ev_magnitude(ev_magnitude),
        .events(stat_events), .slot_free(in_ready)
    );
endmodule

// ============================================================================
// Per-channel state register file: one read/write port addressed by `ch`.
// ============================================================================
module hbci_channel_state #(
    parameter integer NUM_CH = 8,
    parameter integer CH_W   = 3,
    parameter integer BASE_W = 24,
    parameter integer REFR_W = 8
) (
    input  wire                     clk,
    input  wire                     rst_n,
    input  wire [CH_W-1:0]          ch,
    output wire signed [BASE_W-1:0] rd_baseline,
    output wire [REFR_W-1:0]        rd_refr,
    output wire                     rd_armed,
    output wire                     rd_primed,
    input  wire                     we,
    input  wire signed [BASE_W-1:0] wr_baseline,
    input  wire [REFR_W-1:0]        wr_refr,
    input  wire                     wr_armed
);
    reg signed [BASE_W-1:0] baseline [0:NUM_CH-1];
    reg [REFR_W-1:0]        refr     [0:NUM_CH-1];
    reg [NUM_CH-1:0]        armed;
    reg [NUM_CH-1:0]        primed;

    // Out-of-range reads return a neutral state; writes are gated by `we`,
    // which the top level only asserts for in-range channels.
    wire [31:0] ch_x = {{(32-CH_W){1'b0}}, ch};
    wire in_range = (ch_x < NUM_CH);
    assign rd_baseline = in_range ? baseline[ch] : {BASE_W{1'b0}};
    assign rd_refr     = in_range ? refr[ch]     : {REFR_W{1'b0}};
    assign rd_armed    = in_range ? armed[ch]    : 1'b1;
    assign rd_primed   = in_range ? primed[ch]   : 1'b0;

    integer i;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (i = 0; i < NUM_CH; i = i + 1) begin
                baseline[i] <= {BASE_W{1'b0}};
                refr[i]     <= {REFR_W{1'b0}};
            end
            armed  <= {NUM_CH{1'b1}};
            primed <= {NUM_CH{1'b0}};
        end else if (we) begin
            baseline[ch] <= wr_baseline;
            refr[ch]     <= wr_refr;
            armed[ch]    <= wr_armed;
            primed[ch]   <= 1'b1;
        end
    end
endmodule

// ============================================================================
// Baseline estimator (EMA) and residual. Combinational.
//   residual      = sample - floor(baseline)            (SAMPLE_W+1 bits, signed)
//   baseline_next = baseline + ((sample - baseline) >>> alpha_shift)
// The first sample of a channel (primed = 0) initialises the baseline to the
// sample and produces a zero residual.
// ============================================================================
module hbci_baseline_ema #(
    parameter integer SAMPLE_W = 16,
    parameter integer FRAC_W   = 8
) (
    input  wire signed [SAMPLE_W-1:0]        sample,
    input  wire signed [SAMPLE_W+FRAC_W-1:0] baseline_q,
    input  wire [3:0]                        alpha_shift,
    input  wire                              primed,
    output wire signed [SAMPLE_W:0]          residual,
    output wire signed [SAMPLE_W+FRAC_W-1:0] baseline_next
);
    localparam integer BASE_W = SAMPLE_W + FRAC_W;

    // Integer part of the baseline: the top SAMPLE_W bits of the two's-complement
    // Q value, i.e. baseline_q >>> FRAC_W (arithmetic shift = floor).
    wire signed [SAMPLE_W-1:0] base_int = baseline_q[BASE_W-1:FRAC_W];

    // One extra bit so that e.g. -32768 - 32767 = -65535 cannot overflow.
    wire signed [SAMPLE_W:0] sample_x = {sample[SAMPLE_W-1], sample};       // sign-extended
    wire signed [SAMPLE_W:0] base_x   = {base_int[SAMPLE_W-1], base_int};   // sign-extended
    wire signed [SAMPLE_W:0] diff     = sample_x - base_x;
    assign residual = primed ? diff : {(SAMPLE_W+1){1'b0}};

    // EMA update in Q(SAMPLE_W).FRAC_W with one guard bit.
    wire signed [BASE_W:0] sample_q = {sample[SAMPLE_W-1], sample, {FRAC_W{1'b0}}};
    wire signed [BASE_W:0] base_q_x = {baseline_q[BASE_W-1], baseline_q};
    wire signed [BASE_W:0] err_q    = sample_q - base_q_x;
    wire signed [BASE_W:0] step_q   = err_q >>> alpha_shift;
    // Guard bit sum_q[BASE_W] is never read: it always equals sum_q[BASE_W-1]
    // (checked at every accepted sample by tb/tb_hbci_stream.v).
    /* verilator lint_off UNUSEDSIGNAL */
    wire signed [BASE_W:0] sum_q    = base_q_x + step_q;
    /* verilator lint_on UNUSEDSIGNAL */
    // The EMA result always lies between baseline and sample, so it fits BASE_W.
    assign baseline_next = primed ? sum_q[BASE_W-1:0] : sample_q[BASE_W-1:0];
endmodule

// ============================================================================
// Threshold detector. Combinational.
//   magnitude   = |residual|
//   above       = enable && magnitude >= threshold
//   below_rearm = magnitude < max(threshold - hysteresis, 1)
// ============================================================================
module hbci_threshold_detector #(
    parameter integer SAMPLE_W = 16
) (
    input  wire signed [SAMPLE_W:0] residual,
    input  wire [SAMPLE_W-1:0]      threshold,
    input  wire [SAMPLE_W-1:0]      hysteresis,
    output wire [SAMPLE_W-1:0]      magnitude,
    output wire                     polarity,
    output wire                     above,
    output wire                     below_rearm,
    output wire                     enable
);
    assign polarity = residual[SAMPLE_W];
    // Low SAMPLE_W bits of -residual (two's complement: ~r + 1). This is exact
    // because |residual| <= 2^SAMPLE_W - 1 (residual >= -(2^SAMPLE_W - 1)).
    wire [SAMPLE_W-1:0] negated = (~residual[SAMPLE_W-1:0]) + {{(SAMPLE_W-1){1'b0}}, 1'b1};
    assign magnitude = polarity ? negated : residual[SAMPLE_W-1:0];

    assign enable = (threshold != {SAMPLE_W{1'b0}});
    assign above  = enable & (magnitude >= threshold);

    wire [SAMPLE_W-1:0] rearm_level =
        (hysteresis >= threshold) ? {{(SAMPLE_W-1){1'b0}}, 1'b1} : (threshold - hysteresis);
    assign below_rearm = (magnitude < rearm_level);
endmodule

// ============================================================================
// Hysteresis and refractory control. Combinational.
//   fire       = primed & enable & armed & (refr_cnt == 0) & above
//   armed_next = fire ? 0 : (armed | below_rearm)
//   refr_next  = fire ? cfg_refractory : saturating decrement of refr_cnt
// ============================================================================
module hbci_refractory_ctrl #(
    parameter integer REFR_W = 8
) (
    input  wire              primed,
    input  wire              enable,
    input  wire              armed,
    input  wire [REFR_W-1:0] refr_cnt,
    input  wire              above,
    input  wire              below_rearm,
    input  wire [REFR_W-1:0] cfg_refractory,
    output wire              fire,
    output wire              armed_next,
    output wire [REFR_W-1:0] refr_next
);
    wire refr_active = (refr_cnt != {REFR_W{1'b0}});
    assign fire       = primed & enable & armed & ~refr_active & above;
    assign armed_next = fire ? 1'b0 : (armed | below_rearm);
    assign refr_next  = fire        ? cfg_refractory :
                        refr_active ? (refr_cnt - {{(REFR_W-1){1'b0}}, 1'b1}) :
                                      {REFR_W{1'b0}};
endmodule

// ============================================================================
// Timestamp: counts accepted samples. The event timestamp is the index of the
// sample that caused it (the counter value before that sample's increment).
// ============================================================================
module hbci_timestamp #(
    parameter integer TS_W = 32
) (
    input  wire            clk,
    input  wire            rst_n,
    input  wire            tick,
    input  wire            reject,
    output reg [TS_W-1:0]  ts_now,
    output reg [TS_W-1:0]  rejected
);
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            ts_now   <= {TS_W{1'b0}};
            rejected <= {TS_W{1'b0}};
        end else begin
            if (tick)   ts_now   <= ts_now + {{(TS_W-1){1'b0}}, 1'b1};
            if (reject) rejected <= rejected + {{(TS_W-1){1'b0}}, 1'b1};
        end
    end
endmodule

// ============================================================================
// Event output register (one slot, valid/ready). New input is accepted only
// when the slot is free or being drained, so no event is ever dropped.
// ============================================================================
module hbci_event_packer #(
    parameter integer CH_W     = 3,
    parameter integer SAMPLE_W = 16,
    parameter integer TS_W     = 32
) (
    input  wire                clk,
    input  wire                rst_n,
    input  wire                push,
    input  wire [CH_W-1:0]     in_channel,
    input  wire [TS_W-1:0]     in_timestamp,
    input  wire                in_polarity,
    input  wire [SAMPLE_W-1:0] in_magnitude,
    output reg                 ev_valid,
    input  wire                ev_ready,
    output reg [CH_W-1:0]      ev_channel,
    output reg [TS_W-1:0]      ev_timestamp,
    output reg                 ev_polarity,
    output reg [SAMPLE_W-1:0]  ev_magnitude,
    output reg [TS_W-1:0]      events,
    output wire                slot_free
);
    assign slot_free = ~ev_valid | ev_ready;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            ev_valid     <= 1'b0;
            ev_channel   <= {CH_W{1'b0}};
            ev_timestamp <= {TS_W{1'b0}};
            ev_polarity  <= 1'b0;
            ev_magnitude <= {SAMPLE_W{1'b0}};
            events       <= {TS_W{1'b0}};
        end else if (push) begin
            ev_valid     <= 1'b1;
            ev_channel   <= in_channel;
            ev_timestamp <= in_timestamp;
            ev_polarity  <= in_polarity;
            ev_magnitude <= in_magnitude;
            events       <= events + {{(TS_W-1){1'b0}}, 1'b1};
        end else if (ev_ready) begin
            ev_valid     <= 1'b0;
        end
    end
endmodule

/* verilator lint_on DECLFILENAME */
`default_nettype wire
