// ============================================================================
// HBCI-01 v0.2 stream testbench — file-driven, deterministic.
//
// Used for three jobs (see Makefile):
//   * seeded random regression vs. the Python golden model (scripts/golden_model.py)
//   * post-synthesis gate-level simulation (compile with -DGATE and the Yosys netlist)
//   * the 8-channel scenario trace for the studio (+vcd=..., scripts/make_trace.py)
//
// Stimulus: $readmemh file of 80-bit words, format documented in golden_model.py.
// Plusargs:
//   +stim=FILE        stimulus (required)
//   +log=FILE         transaction log (required)
//   +vcd=FILE         optional VCD dump of the whole testbench
//   +ready_pct=N      ev_ready is high with probability N% per cycle (default 100)
//   +seed=N           seed of the testbench xorshift PRNG (ev_ready, bus garbage)
//   +n=N              number of stimulus words (optional; avoids a $readmemh warning)
//   +idle_hold=1      during idle cycles keep the last bus values instead of driving
//                     pseudo-random garbage (used for the studio scenario so waves stay
//                     readable; the regression keeps the default garbage)
//
// Log lines (cycle = number of rising clock edges since time 0; values are the
// ones present at that rising edge, i.e. before the registers update):
//   S i cycle ch x base res mag above rearm armed refr primed fire
//        at every accepted sample, read from the RTL by hierarchical reference
//        (not available with -DGATE: the flattened netlist has no such nets)
//   A i cycle ch x        accepted sample (testbench-visible ports only)
//   J cycle ch x          rejected handshake (channel >= NUM_CH)
//   E cycle ch ts pol mag output event handshake (ev_valid & ev_ready)
//   C samples events rejected   counters after the output is drained
//   R cycle               reset pulse (issued after draining)
//   K name count          internal consistency counters (0 = good)
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci_stream;
    parameter integer NUM_CH   = 8;
    parameter integer CH_W     = 3;
    parameter integer SAMPLE_W = 16;
    parameter integer FRAC_W   = 8;
    parameter integer TS_W     = 32;
    parameter integer REFR_W   = 8;
    localparam integer BASE_W   = SAMPLE_W + FRAC_W;
    localparam integer MAX_STIM = 1 << 17;

    reg                       clk = 1'b0;
    reg                       rst_n = 1'b0;
    reg  [SAMPLE_W-1:0]       cfg_threshold = 0;
    reg  [SAMPLE_W-1:0]       cfg_hysteresis = 0;
    reg  [REFR_W-1:0]         cfg_refractory = 0;
    reg  [3:0]                cfg_alpha_shift = 0;
    reg                       in_valid = 1'b0;
    wire                      in_ready;
    reg  [CH_W-1:0]           in_channel = 0;
    reg  signed [SAMPLE_W-1:0] in_sample = 0;
    wire                      ev_valid;
    reg                       ev_ready = 1'b1;
    wire [CH_W-1:0]           ev_channel;
    wire [TS_W-1:0]           ev_timestamp;
    wire                      ev_polarity;
    wire [SAMPLE_W-1:0]       ev_magnitude;
    wire [TS_W-1:0]           stat_samples, stat_events, stat_rejected;

`ifdef GATE
    hbci_event_core dut (
`else
    hbci_event_core #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W),
        .FRAC_W(FRAC_W), .TS_W(TS_W), .REFR_W(REFR_W)
    ) dut (
`endif
        .clk(clk), .rst_n(rst_n),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .in_valid(in_valid), .in_ready(in_ready),
        .in_channel(in_channel), .in_sample(in_sample),
        .ev_valid(ev_valid), .ev_ready(ev_ready),
        .ev_channel(ev_channel), .ev_timestamp(ev_timestamp),
        .ev_polarity(ev_polarity), .ev_magnitude(ev_magnitude),
        .stat_samples(stat_samples), .stat_events(stat_events),
        .stat_rejected(stat_rejected)
    );

    always #5 clk = ~clk;   // simulation clock only; no timing claim

    // ------------------------------------------------------------ utilities
    reg [31:0] rng = 32'h1234_5678;
    function [31:0] xorshift32(input [31:0] s);
        reg [31:0] t;
        begin
            t = s ^ (s << 13);
            t = t ^ (t >> 17);
            xorshift32 = t ^ (t << 5);
        end
    endfunction

    integer log_fd;
    integer cycle = 0;
    integer ready_pct = 100;
    integer idle_hold = 0;
    reg     force_ready = 1'b0;
    reg [TS_W-1:0] acc_idx = 0;      // testbench count of accepted samples since reset
    integer guard_err = 0;           // EMA guard-bit violations (RTL only)
    integer ts_err = 0;              // stat_samples != testbench sample count
    integer acc_err = 0;             // dut.accept disagrees with the testbench handshake view
    integer ready_err = 0;           // in_ready != (~ev_valid | ev_ready)
    integer hold_err = 0;            // event payload changed while stalled
    integer stall_cycles = 0;
    reg                 prev_stall = 1'b0;
    reg [CH_W+TS_W+SAMPLE_W:0] prev_payload = 0;

    // --------------------------------------------------------------- ev_ready
    always @(negedge clk) begin
        rng = xorshift32(rng);
        if (force_ready) ev_ready = 1'b1;
        else             ev_ready = ((rng % 100) < ready_pct);
    end

    // ---------------------------------------------------------------- monitor
    wire hs     = in_valid & in_ready;
    wire ch_ok  = ({{(32-CH_W){1'b0}}, in_channel} < NUM_CH);
    always @(posedge clk) begin
        cycle <= cycle + 1;
        if (rst_n) begin
            if (in_ready !== (~ev_valid | ev_ready)) ready_err = ready_err + 1;
            if (prev_stall && (ev_valid !== 1'b1 ||
                prev_payload !== {ev_channel, ev_timestamp, ev_polarity, ev_magnitude}))
                hold_err = hold_err + 1;
            prev_stall   = ev_valid & ~ev_ready;
            prev_payload = {ev_channel, ev_timestamp, ev_polarity, ev_magnitude};
            if (ev_valid & ~ev_ready) stall_cycles = stall_cycles + 1;

            if (hs && ch_ok) begin
`ifndef GATE
                $fdisplay(log_fd, "S %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d",
                    dut.stat_samples, cycle, dut.in_channel, dut.in_sample, dut.st_baseline,
                    dut.residual, dut.magnitude, dut.above, dut.below_rearm,
                    dut.st_armed, dut.st_refr, dut.st_primed, dut.fire);
                if (dut.accept !== 1'b1) acc_err = acc_err + 1;
                if (dut.st_primed && (dut.u_baseline.sum_q[BASE_W] !== dut.u_baseline.sum_q[BASE_W-1]))
                    guard_err = guard_err + 1;
`else
                $fdisplay(log_fd, "A %0d %0d %0d %0d", acc_idx, cycle, in_channel, in_sample);
`endif
                if (stat_samples !== acc_idx) ts_err = ts_err + 1;
                acc_idx = acc_idx + 1'b1;
            end
`ifndef GATE
            if (!(hs && ch_ok) && dut.accept !== 1'b0) acc_err = acc_err + 1;
`endif
            if (hs && !ch_ok)
                $fdisplay(log_fd, "J %0d %0d %0d", cycle, in_channel, in_sample);
            if (ev_valid && ev_ready)
                $fdisplay(log_fd, "E %0d %0d %0d %0d %0d",
                          cycle, ev_channel, ev_timestamp, ev_polarity, ev_magnitude);
        end
    end

    // ----------------------------------------------------------------- driver
    reg [79:0] stim [0:MAX_STIM-1];
    reg [79:0] w;
    reg [1023:0] stim_file, log_file, vcd_file;
    integer nstim, n, k, seed, wd;

    task drain_and_count;
        begin
            @(negedge clk);
            in_valid    = 1'b0;
            force_ready = 1'b1;
            ev_ready    = 1'b1;
            wd = 0;
            while (ev_valid === 1'b1 && wd < 16) begin @(negedge clk); wd = wd + 1; end
            @(negedge clk);
            $fdisplay(log_fd, "C %0d %0d %0d", stat_samples, stat_events, stat_rejected);
        end
    endtask

    initial begin
        if (!$value$plusargs("stim=%s", stim_file)) begin $display("ERROR: +stim= missing"); $finish; end
        if (!$value$plusargs("log=%s", log_file))   begin $display("ERROR: +log= missing");  $finish; end
        if (!$value$plusargs("ready_pct=%d", ready_pct)) ready_pct = 100;
        if (!$value$plusargs("idle_hold=%d", idle_hold)) idle_hold = 0;
        if ($value$plusargs("seed=%d", seed)) rng = (seed == 0) ? 32'h1234_5678 : seed;
        if ($value$plusargs("vcd=%s", vcd_file)) begin
            $dumpfile(vcd_file);
            $dumpvars(0, tb_hbci_stream);
        end
        log_fd = $fopen(log_file, "w");
        for (n = 0; n < MAX_STIM; n = n + 1) stim[n] = {80{1'bx}};
        if ($value$plusargs("n=%d", nstim) && nstim > 0) begin
            $readmemh(stim_file, stim, 0, nstim - 1);   // exact length: no short-file warning
        end else begin
            $readmemh(stim_file, stim);
            nstim = 0;
        end
        nstim = 0;
        while (nstim < MAX_STIM && ^stim[nstim] !== 1'bx) nstim = nstim + 1;
        $fdisplay(log_fd, "# stim=%0s n=%0d NUM_CH=%0d CH_W=%0d SAMPLE_W=%0d FRAC_W=%0d TS_W=%0d REFR_W=%0d ready_pct=%0d idle_hold=%0d",
                  stim_file, nstim, NUM_CH, CH_W, SAMPLE_W, FRAC_W, TS_W, REFR_W, ready_pct, idle_hold);

        rst_n = 1'b0;
        repeat (3) @(posedge clk);
        @(negedge clk);
        rst_n = 1'b1;

        for (n = 0; n < nstim; n = n + 1) begin
            w = stim[n];
            for (k = 0; k < w[11:8]; k = k + 1) begin
                @(negedge clk);
                rng        = xorshift32(rng);
                in_valid   = 1'b0;
                if (idle_hold == 0) begin
                    in_channel = rng[CH_W-1:0];     // garbage while in_valid is low
                    in_sample  = rng[31:32-SAMPLE_W];
                end
            end
            if (w[79:76] == 4'd1) begin
                drain_and_count;
                rst_n = 1'b0;
                acc_idx = 0;
                $fdisplay(log_fd, "R %0d", cycle);
                @(negedge clk);
                rst_n = 1'b1;
                force_ready = 1'b0;
            end else begin
                @(negedge clk);
                cfg_threshold   = w[40 +: SAMPLE_W];
                cfg_hysteresis  = w[24 +: SAMPLE_W];
                cfg_refractory  = w[16 +: REFR_W];
                cfg_alpha_shift = w[15:12];
                in_valid        = 1'b1;
                in_channel      = w[72 +: CH_W];
                in_sample       = w[56 +: SAMPLE_W];
                @(posedge clk);
                wd = 0;
                while (!in_ready) begin
                    @(posedge clk);
                    wd = wd + 1;
                    if (wd > 100000) begin $display("ERROR: input stalled forever"); $finish; end
                end
            end
        end
        drain_and_count;
`ifndef GATE
        $fdisplay(log_fd, "K guard_bit %0d", guard_err);           // RTL-internal checks only
        $fdisplay(log_fd, "K accept_vs_handshake %0d", acc_err);
`endif
        $fdisplay(log_fd, "K ts_vs_count %0d", ts_err);
        $fdisplay(log_fd, "K in_ready_rule %0d", ready_err);
        $fdisplay(log_fd, "K stall_hold %0d", hold_err);
        $fdisplay(log_fd, "K stall_cycles_info %0d", stall_cycles);
        $fdisplay(log_fd, "K cycles_info %0d", cycle);
        $fdisplay(log_fd, "DONE");
        $fclose(log_fd);
        $finish;
    end
endmodule

`default_nettype wire
