// ============================================================================
// HBCI-01 v0.2 directed testbench — deterministic, self-checking, categorised.
//
// Every check prints one machine-readable, tab-separated line:
//   RESULT <id> <category> PASS|FAIL <name> <detail>
// which scripts/parse_directed.py turns into verification.json entries.
//
// Two DUT instances share the configuration and input bus:
//   dut   NUM_CH = 8 (shipped configuration)
//   dut6  NUM_CH = 6 (CH_W = 3, so channel codes 6 and 7 are out of range)
// `sel6` routes in_valid to one of them.
//
// Categories: reset, invalid_input, threshold_boundary, channel_state,
//             refractory, signed_arithmetic, timestamp, backpressure
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci_directed;
    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg  [15:0] cfg_threshold = 16'd0;
    reg  [15:0] cfg_hysteresis = 16'd0;
    reg  [7:0]  cfg_refractory = 8'd0;
    reg  [3:0]  cfg_alpha_shift = 4'd0;
    reg         in_valid = 1'b0;
    reg  [2:0]  in_channel = 3'd0;
    reg  signed [15:0] in_sample = 16'sd0;
    reg         ev_ready = 1'b1;
    reg         sel6 = 1'b0;

    wire        in_ready8, in_ready6;
    wire        ev_valid8, ev_valid6;
    wire [2:0]  ev_channel8, ev_channel6;
    wire [31:0] ev_timestamp8, ev_timestamp6;
    wire        ev_polarity8, ev_polarity6;
    wire [15:0] ev_magnitude8, ev_magnitude6;
    wire [31:0] stat_samples8, stat_events8, stat_rejected8;
    wire [31:0] stat_samples6, stat_events6, stat_rejected6;
    wire        in_ready = sel6 ? in_ready6 : in_ready8;

    hbci_event_core dut (
        .clk(clk), .rst_n(rst_n),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .in_valid(in_valid & ~sel6), .in_ready(in_ready8),
        .in_channel(in_channel), .in_sample(in_sample),
        .ev_valid(ev_valid8), .ev_ready(ev_ready),
        .ev_channel(ev_channel8), .ev_timestamp(ev_timestamp8),
        .ev_polarity(ev_polarity8), .ev_magnitude(ev_magnitude8),
        .stat_samples(stat_samples8), .stat_events(stat_events8),
        .stat_rejected(stat_rejected8)
    );

    hbci_event_core #(.NUM_CH(6), .CH_W(3)) dut6 (
        .clk(clk), .rst_n(rst_n),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .in_valid(in_valid & sel6), .in_ready(in_ready6),
        .in_channel(in_channel), .in_sample(in_sample),
        .ev_valid(ev_valid6), .ev_ready(ev_ready),
        .ev_channel(ev_channel6), .ev_timestamp(ev_timestamp6),
        .ev_polarity(ev_polarity6), .ev_magnitude(ev_magnitude6),
        .stat_samples(stat_samples6), .stat_events(stat_events6),
        .stat_rejected(stat_rejected6)
    );

    always #5 clk = ~clk;   // simulation clock only; no timing claim

    // ------------------------------------------------------------ reporting
    integer checks = 0, errors = 0;
    reg [8*200-1:0] det;
    task check(input [8*8-1:0] id, input [8*20-1:0] cat, input [8*110-1:0] name, input ok);
        begin
            checks = checks + 1;
            if (ok !== 1'b1) errors = errors + 1;
            $display("RESULT\t%0s\t%0s\t%0s\t%0s\t%0s", id, cat, (ok === 1'b1) ? "PASS" : "FAIL", name, det);
            det = "";
        end
    endtask

    // --------------------------------------------------------- PRNG / ready
    reg [31:0] rng = 32'hC0FF_EE01;
    function [31:0] xorshift32(input [31:0] s);
        reg [31:0] t;
        begin
            t = s ^ (s << 13);
            t = t ^ (t >> 17);
            xorshift32 = t ^ (t << 5);
        end
    endfunction
    reg rand_ready = 1'b0;
    always @(negedge clk) if (rand_ready) begin
        rng = xorshift32(rng);
        ev_ready = rng[7];
    end

    // ------------------------------------------------------ event capture
    integer ev_n = 0, ev6_n = 0, fire_n = 0;
    reg [2:0]  evc [0:4095];
    reg [31:0] evt [0:4095];
    reg        evp [0:4095];
    reg [15:0] evm [0:4095];
    reg [2:0]  ev6c [0:255];
    reg [31:0] ev6t [0:255];
    reg [31:0] fire_ts [0:4095];
    integer bp_ready_err = 0, bp_hold_err = 0, bp_stall = 0;
    reg prev_stall = 1'b0;
    reg [51:0] prev_payload = 52'd0;
    always @(posedge clk) begin
        if (rst_n) begin
            if (ev_valid8 && ev_ready) begin
                evc[ev_n] = ev_channel8; evt[ev_n] = ev_timestamp8;
                evp[ev_n] = ev_polarity8; evm[ev_n] = ev_magnitude8;
                ev_n = ev_n + 1;
            end
            if (ev_valid6 && ev_ready) begin
                ev6c[ev6_n] = ev_channel6; ev6t[ev6_n] = ev_timestamp6;
                ev6_n = ev6_n + 1;
            end
            if (dut.accept && dut.fire) begin
                fire_ts[fire_n] = dut.stat_samples;
                fire_n = fire_n + 1;
            end
            // handshake rules on the NUM_CH=8 instance, checked every cycle
            if (in_ready8 !== (~ev_valid8 | ev_ready)) bp_ready_err = bp_ready_err + 1;
            if (prev_stall && (ev_valid8 !== 1'b1 ||
                prev_payload !== {ev_channel8, ev_timestamp8, ev_polarity8, ev_magnitude8}))
                bp_hold_err = bp_hold_err + 1;
            prev_stall   = ev_valid8 & ~ev_ready;
            prev_payload = {ev_channel8, ev_timestamp8, ev_polarity8, ev_magnitude8};
            if (ev_valid8 & ~ev_ready) bp_stall = bp_stall + 1;
        end else begin
            prev_stall = 1'b0;
        end
    end

    // ----------------------------------------------------------- drivers
    // Values seen by the DUT at the accepting clock edge (before the update).
    integer cap_res, cap_base, cap_mag, cap_ts;
    reg     cap_above, cap_rearm, cap_armed, cap_primed, cap_fire, cap_pol;
    integer cap_refr;

    task send(input [2:0] ch, input integer x);
        begin
            @(negedge clk);
            in_valid   = 1'b1;
            in_channel = ch;
            in_sample  = x[15:0];
            @(posedge clk);
            while (!in_ready) @(posedge clk);
            if (sel6) begin
                cap_res = dut6.residual;   cap_base = dut6.st_baseline; cap_mag = dut6.magnitude;
                cap_above = dut6.above;    cap_rearm = dut6.below_rearm; cap_armed = dut6.st_armed;
                cap_refr = dut6.st_refr;   cap_primed = dut6.st_primed;  cap_fire = dut6.fire;
                cap_pol = dut6.polarity;   cap_ts = dut6.stat_samples;
            end else begin
                cap_res = dut.residual;    cap_base = dut.st_baseline;  cap_mag = dut.magnitude;
                cap_above = dut.above;     cap_rearm = dut.below_rearm; cap_armed = dut.st_armed;
                cap_refr = dut.st_refr;    cap_primed = dut.st_primed;  cap_fire = dut.fire;
                cap_pol = dut.polarity;    cap_ts = dut.stat_samples;
            end
            @(negedge clk);
            in_valid = 1'b0;
        end
    endtask

    task settle;   // let a pending event leave (ev_ready permitting)
        repeat (3) @(negedge clk);
    endtask

    task pulse_reset;   // asynchronous assert at a negedge, release at the next
        begin
            @(negedge clk);
            in_valid = 1'b0;
            rst_n = 1'b0;
            @(negedge clk);
            rst_n = 1'b1;
        end
    endtask

    task set_cfg(input integer thr, input integer hyst, input integer refr, input integer alpha);
        begin
            cfg_threshold = thr[15:0]; cfg_hysteresis = hyst[15:0];
            cfg_refractory = refr[7:0]; cfg_alpha_shift = alpha[3:0];
        end
    endtask

    // State snapshots (all per-channel registers, counters and the output slot)
    reg [511:0] snap_a, snap_b;
    integer q;
    task snap8(output [511:0] s);
        begin
            s = 512'd0;
            s[7:0]  = dut.u_state.primed;
            s[15:8] = dut.u_state.armed;
            for (q = 0; q < 8; q = q + 1) begin
                s[16 + q*8 +: 8]   = dut.u_state.refr[q];
                s[80 + q*24 +: 24] = dut.u_state.baseline[q];
            end
            s[272 +: 32] = stat_samples8;
            s[304 +: 32] = stat_events8;
            s[336 +: 32] = stat_rejected8;
            s[368]       = ev_valid8;
        end
    endtask
    task snap6(output [511:0] s);
        begin
            s = 512'd0;
            s[5:0]  = dut6.u_state.primed;
            s[13:8] = dut6.u_state.armed;
            for (q = 0; q < 6; q = q + 1) begin
                s[16 + q*8 +: 8]   = dut6.u_state.refr[q];
                s[80 + q*24 +: 24] = dut6.u_state.baseline[q];
            end
            s[272 +: 32] = stat_samples6;
            s[304 +: 32] = stat_events6;
            s[368]       = ev_valid6;
        end
    endtask

    // Reference EMA (spec formula with signed integers; >>> is arithmetic)
    function integer ema_ref(input integer b, input integer x, input integer a);
        ema_ref = b + (((x * 256) - b) >>> a);
    endfunction

    // ------------------------------------------------------------- scratch
    integer i, k, r, e0, e1, n0, ok, cnt, exp_n, gap, last_ts, b_ref, x;
    integer bk [0:7];
    reg [2:0]  exc [0:1023];
    reg [31:0] ext [0:1023];
    reg        exp_p [0:1023];
    reg [15:0] exm [0:1023];
    integer refr_trace [0:1023];
    integer ph [0:7];

    // Refractory run on channel 4 (alpha 0, threshold 100, hysteresis 0):
    // after every event the next sample re-arms (residual 0); every other
    // sample has |residual| = 200 (above). So events are spaced by
    // max(R + 1, 2) samples: R blocked samples, and at least one re-arm sample.
    task refr_run(input integer R, input integer nsmp, output integer nev, output integer gap_ok,
                  output integer gap_seen, output integer wrap_seen);
        integer j, ee0, xp;
        begin
            pulse_reset;
            set_cfg(100, 0, R, 0);
            ee0 = ev_n;
            send(3'd4, 0);                       // prime (index 0)
            xp = 0;
            refr_trace[0] = 0;
            for (j = 1; j < nsmp; j = j + 1) begin
                if (j > 1 && cap_fire) xp = xp;  // re-arm sample: residual 0
                else xp = (xp == 0) ? 200 : 0;   // |residual| = 200
                send(3'd4, xp);
                refr_trace[j] = dut.u_state.refr[4];
            end
            settle;
            nev = ev_n - ee0;
            gap_ok = 1; gap_seen = -1; wrap_seen = 0;
            for (j = ee0 + 1; j < ev_n; j = j + 1) begin
                gap_seen = evt[j] - evt[j-1];
                if (evt[j] - evt[j-1] != ((R + 1 > 2) ? R + 1 : 2)) gap_ok = 0;
            end
            for (j = 1; j < nsmp; j = j + 1) if (refr_trace[j] > R) wrap_seen = 1;
        end
    endtask

    integer nev, gok, gseen, wseen;

    initial begin
        det = "";
        $dumpfile("build/tb_hbci_directed.vcd");
        $dumpvars(0, tb_hbci_directed);

        // =================================================================
        // reset
        // =================================================================
        in_valid = 1'b1; in_channel = 3'd1; in_sample = 16'sd1000;   // activity during reset
        repeat (3) @(posedge clk);
        #1;
        $sformat(det, "ev_valid=%0d samples=%0d events=%0d rejected=%0d", ev_valid8, stat_samples8, stat_events8, stat_rejected8);
        check("RST-01", "reset", "outputs and counters stay zero while rst_n is low (with in_valid high)",
              ev_valid8 == 1'b0 && stat_samples8 == 0 && stat_events8 == 0 && stat_rejected8 == 0);
        ok = (dut.u_state.primed == 8'h00) && (dut.u_state.armed == 8'hFF);
        for (q = 0; q < 8; q = q + 1)
            if (dut.u_state.refr[q] != 0 || dut.u_state.baseline[q] != 0) ok = 0;
        $sformat(det, "primed=%b armed=%b", dut.u_state.primed, dut.u_state.armed);
        check("RST-02", "reset", "reset state: every channel unprimed, armed, refractory 0, baseline 0", ok);
        @(negedge clk); in_valid = 1'b0; rst_n = 1'b1;

        set_cfg(100, 0, 0, 4);
        send(3'd1, 5000);
        $sformat(det, "primed_before=%0d residual=%0d fire=%0d baseline_after=%0d",
                 cap_primed, cap_res, cap_fire, dut.u_state.baseline[1]);
        check("RST-03", "reset", "first sample after reset primes the channel: residual 0, no event, baseline = x*256",
              cap_primed == 0 && cap_res == 0 && cap_fire == 0 &&
              dut.u_state.baseline[1] == 5000 * 256 && dut.u_state.primed[1] == 1'b1);

        // build state with a pending event, then reset asynchronously mid-cycle
        set_cfg(100, 0, 5, 0);
        ev_ready = 1'b0;
        send(3'd2, 0);
        send(3'd2, 500);                        // fires; event held (ev_ready low)
        @(negedge clk);
        ok = (ev_valid8 == 1'b1) && (dut.u_state.refr[2] == 5) && (dut.u_state.armed[2] == 1'b0);
        #2 rst_n = 1'b0;                        // not aligned to any clock edge
        #1;
        $sformat(det, "pre: pending/refr/disarmed=%0d; post: ev_valid=%0d samples=%0d events=%0d primed=%b armed=%b refr2=%0d base2=%0d",
                 ok, ev_valid8, stat_samples8, stat_events8, dut.u_state.primed, dut.u_state.armed,
                 dut.u_state.refr[2], dut.u_state.baseline[2]);
        check("RST-04", "reset", "asynchronous mid-run reset immediately clears state, counters and a pending event",
              ok == 1 && ev_valid8 == 1'b0 && stat_samples8 == 0 && stat_events8 == 0 &&
              dut.u_state.primed == 8'h00 && dut.u_state.armed == 8'hFF &&
              dut.u_state.refr[2] == 0 && dut.u_state.baseline[2] == 0);
        @(negedge clk); rst_n = 1'b1; ev_ready = 1'b1;

        e0 = ev_n;
        send(3'd3, 0);
        send(3'd3, 1000);
        settle;
        $sformat(det, "events=%0d ts=%0d", ev_n - e0, evt[e0]);
        check("RST-05", "reset", "timestamps restart at 0 after reset (second sample -> ts 1)",
              ev_n - e0 == 1 && evt[e0] == 1);

        // =================================================================
        // invalid_input
        // =================================================================
        pulse_reset;
        set_cfg(100, 10, 6, 3);
        for (k = 0; k < 8; k = k + 1) send(k[2:0], -3000 + 700 * k);
        send(3'd5, 2000);                       // fires on channel 5 -> refractory active
        settle;
        snap8(snap_a);
        e0 = ev_n;
        for (k = 0; k < 60; k = k + 1) begin
            @(negedge clk);
            rng = xorshift32(rng);
            in_valid = 1'b0; in_channel = rng[2:0]; in_sample = rng[31:16];
        end
        settle;
        snap8(snap_b);
        $sformat(det, "60 idle cycles with pseudo-random bus; state equal=%0d events=%0d", snap_a == snap_b, ev_n - e0);
        check("INV-01", "invalid_input", "in_valid low with garbage on in_channel/in_sample changes no state", snap_a == snap_b && ev_n == e0);

        @(negedge clk); in_channel = 3'bxxx; in_sample = 16'bx;
        repeat (10) @(negedge clk);
        snap8(snap_b);
        $sformat(det, "state equal=%0d state has X=%0d ev_valid=%b in_ready=%b",
                 snap_a === snap_b, ^snap_b === 1'bx, ev_valid8, in_ready8);
        check("INV-02", "invalid_input", "in_valid low with X on the bus: no state change, no X reaches state or handshake",
              snap_a === snap_b && ev_valid8 === 1'b0 && in_ready8 === 1'b1);
        in_channel = 3'd0; in_sample = 16'sd0;

        // ---- NUM_CH = 6 instance: channel codes 6 and 7 are out of range
        sel6 = 1'b1;
        set_cfg(100, 0, 0, 2);
        for (k = 0; k < 6; k = k + 1) send(k[2:0], 1000 * k - 2500);
        snap6(snap_a);
        n0 = stat_rejected6; e0 = ev6_n;
        for (k = 0; k < 10; k = k + 1) send((k % 2) ? 3'd7 : 3'd6, (k % 2) ? -30000 : 30000);
        settle;
        snap6(snap_b);
        $sformat(det, "10 handshakes to ch6/ch7: rejected=%0d samples=%0d events=%0d state equal=%0d",
                 stat_rejected6 - n0, stat_samples6, ev6_n - e0, snap_a == snap_b);
        check("INV-03", "invalid_input", "NUM_CH=6: out-of-range handshakes are consumed, counted in stat_rejected, change nothing else",
              stat_rejected6 - n0 == 10 && snap_a == snap_b && ev6_n == e0 && stat_samples6 == 6);

        n0 = stat_samples6;
        send(3'd5, 6000);                       // channel 5 baseline is 2500 -> residual 3500
        settle;
        $sformat(det, "event ch=%0d ts=%0d expected ts=%0d", ev6c[e0], ev6t[e0], n0);
        check("INV-04", "invalid_input", "NUM_CH=6: rejected handshakes do not advance the timestamp; channel 5 detects normally",
              ev6_n - e0 == 1 && ev6c[e0] == 3'd5 && ev6t[e0] == n0);

        ev_ready = 1'b0;
        send(3'd4, 0);                          // channel 4 baseline 1500 -> |residual| 1500, fires
        @(negedge clk);
        n0 = stat_rejected6;
        in_valid = 1'b1; in_channel = 3'd7; in_sample = 16'sd1;
        cnt = 0;
        for (k = 0; k < 5; k = k + 1) begin @(posedge clk); #1; if (in_ready6 == 1'b0) cnt = cnt + 1; end
        ok = (stat_rejected6 == n0);
        @(negedge clk); ev_ready = 1'b1;
        @(posedge clk); #1;
        @(negedge clk); in_valid = 1'b0;
        $sformat(det, "stalled cycles=%0d/5 rejected during stall unchanged=%0d after release +%0d",
                 cnt, ok, stat_rejected6 - n0);
        check("INV-05", "invalid_input", "NUM_CH=6: an out-of-range handshake stalls while the event slot is full, then is consumed",
              cnt == 5 && ok == 1 && stat_rejected6 - n0 == 1);

        in_channel = 3'd6; #1;
        $sformat(det, "rd_primed=%b rd_armed=%b rd_refr=%0d rd_baseline=%0d",
                 dut6.u_state.rd_primed, dut6.u_state.rd_armed, dut6.u_state.rd_refr, dut6.u_state.rd_baseline);
        check("INV-06", "invalid_input", "NUM_CH=6: state read port returns the neutral state for an out-of-range channel",
              dut6.u_state.rd_primed == 1'b0 && dut6.u_state.rd_armed == 1'b1 &&
              dut6.u_state.rd_refr == 0 && dut6.u_state.rd_baseline == 0);
        settle;
        sel6 = 1'b0;
        check("INV-07", "invalid_input", "NUM_CH=8 instance saw none of the NUM_CH=6 traffic (stat_rejected stays 0)",
              stat_rejected8 == 0);

        // =================================================================
        // threshold_boundary (alpha_shift 0: residual = x - previous x)
        // =================================================================
        pulse_reset;
        set_cfg(100, 0, 0, 0);
        e0 = ev_n;
        send(3'd1, 0);
        send(3'd1, 99);
        $sformat(det, "residual=%0d above=%0d fire=%0d", cap_res, cap_above, cap_fire);
        check("THR-01", "threshold_boundary", "|residual| = threshold-1 (99 vs 100): no event", cap_res == 99 && cap_above == 0 && cap_fire == 0);
        send(3'd1, 199);
        $sformat(det, "residual=%0d above=%0d fire=%0d", cap_res, cap_above, cap_fire);
        settle;
        check("THR-02", "threshold_boundary", "|residual| = threshold (100): event with magnitude 100, polarity 0",
              cap_res == 100 && cap_fire == 1 && ev_n - e0 == 1 && evm[e0] == 100 && evp[e0] == 0);
        send(3'd1, 199);                        // residual 0: re-arm
        send(3'd1, 300);
        settle;
        $sformat(det, "residual=%0d events=%0d mag=%0d", cap_res, ev_n - e0, evm[e0+1]);
        check("THR-03", "threshold_boundary", "|residual| = threshold+1 (101): event with magnitude 101",
              cap_res == 101 && ev_n - e0 == 2 && evm[e0+1] == 101);
        send(3'd1, 300);                        // re-arm
        send(3'd1, 201);                        // -99: no event
        ok = (cap_res == -99 && cap_fire == 0);
        send(3'd1, 101);                        // -100: event, polarity 1
        send(3'd1, 101);                        // re-arm
        send(3'd1, 0);                          // -101: event
        settle;
        $sformat(det, "-99 quiet=%0d; events=%0d mags=%0d,%0d pols=%0d,%0d", ok, ev_n - e0, evm[e0+2], evm[e0+3], evp[e0+2], evp[e0+3]);
        check("THR-04", "threshold_boundary", "negative residuals -99 / -100 / -101: no event / event / event, polarity 1",
              ok == 1 && ev_n - e0 == 4 && evm[e0+2] == 100 && evp[e0+2] == 1 && evm[e0+3] == 101 && evp[e0+3] == 1);

        pulse_reset;
        set_cfg(0, 0, 0, 0);
        e0 = ev_n;
        send(3'd0, -32768);
        send(3'd0, 32767);
        settle;
        $sformat(det, "residual=%0d enable=%0d above=%0d events=%0d", cap_res, dut.det_enable, cap_above, ev_n - e0);
        check("THR-05", "threshold_boundary", "threshold 0 disables detection even at |residual| = 65535",
              cap_res == 65535 && cap_above == 0 && ev_n == e0 && dut.det_enable == 1'b0);

        pulse_reset;
        set_cfg(65535, 0, 0, 0);
        e0 = ev_n;
        send(3'd0, -32768);
        send(3'd0, 32766);                      // 65534: no event
        ok = (cap_res == 65534 && cap_above == 0);
        send(3'd0, -32768);                     // -65534: no event
        ok = ok && (cap_res == -65534 && cap_above == 0);
        send(3'd0, 32767);                      // +65535: event
        send(3'd0, 32767);                      // 0: re-arm
        send(3'd0, -32768);                     // -65535: event
        settle;
        $sformat(det, "65534 quiet=%0d events=%0d mag=%0d/%0d pol=%0d/%0d", ok, ev_n - e0, evm[e0], evm[e0+1], evp[e0], evp[e0+1]);
        check("THR-06", "threshold_boundary", "threshold 65535: only |residual| = 65535 fires (both polarities)",
              ok == 1 && ev_n - e0 == 2 && evm[e0] == 65535 && evp[e0] == 0 && evm[e0+1] == 65535 && evp[e0+1] == 1);

        pulse_reset;
        set_cfg(100, 100, 0, 0);                // hysteresis = threshold -> re-arm level 1
        e0 = ev_n;
        send(3'd2, 0);
        send(3'd2, 100);                        // fires
        send(3'd2, 101);                        // residual 1: 1 < 1 false -> stays disarmed
        ok = (cap_rearm == 0) && (dut.u_state.armed[2] == 1'b0);
        send(3'd2, 201);                        // residual 100, disarmed: no event
        ok = ok && (cap_fire == 0);
        send(3'd2, 201);                        // residual 0 -> re-arm
        ok = ok && (cap_rearm == 1) && (dut.u_state.armed[2] == 1'b1);
        send(3'd2, 301);                        // fires again
        settle;
        $sformat(det, "sequence ok=%0d events=%0d", ok, ev_n - e0);
        check("THR-07", "threshold_boundary", "hysteresis = threshold clamps the re-arm level to 1 (re-arm only at |residual| 0)",
              ok == 1 && ev_n - e0 == 2);

        set_cfg(100, 500, 0, 0);                // hysteresis > threshold
        send(3'd2, 302);                        // residual 1
        ok = (cap_rearm == 0);
        send(3'd2, 302);                        // residual 0
        ok = ok && (cap_rearm == 1);
        $sformat(det, "rearm(|r|=1)=0 and rearm(|r|=0)=1: %0d", ok);
        check("THR-08", "threshold_boundary", "hysteresis > threshold (500 vs 100) also clamps the re-arm level to 1", ok == 1);

        set_cfg(100, 99, 0, 0);                 // level = 1
        send(3'd2, 303);
        ok = (cap_rearm == 0);
        set_cfg(100, 98, 0, 0);                 // level = 2
        send(3'd2, 304);
        ok = ok && (cap_rearm == 1);
        $sformat(det, "hyst 99: |r|=1 does not re-arm; hyst 98: |r|=1 re-arms: %0d", ok);
        check("THR-09", "threshold_boundary", "re-arm level threshold-hysteresis: hyst 99 -> level 1, hyst 98 -> level 2", ok == 1);

        set_cfg(100, 20, 0, 0);                 // level = 80
        send(3'd2, 384);                        // residual 80
        ok = (cap_rearm == 0);
        send(3'd2, 463);                        // residual 79
        ok = ok && (cap_rearm == 1);
        $sformat(det, "|r|=80 -> rearm 0, |r|=79 -> rearm 1: %0d", ok);
        check("THR-10", "threshold_boundary", "re-arm boundary at threshold-hysteresis (100-20): 80 stays disarmed, 79 re-arms", ok == 1);

        // =================================================================
        // channel_state
        // =================================================================
        pulse_reset;
        set_cfg(1000, 0, 0, 0);
        for (k = 0; k < 8; k = k + 1) send(k[2:0], -20000 + 5000 * k);
        ok = 1;
        for (k = 0; k < 8; k = k + 1) begin
            send(k[2:0], -20000 + 5000 * k + 10 * k + 1);
            if (cap_res != 10 * k + 1) ok = 0;
        end
        for (k = 0; k < 8; k = k + 1)
            if (dut.u_state.baseline[k] != (-20000 + 5000 * k + 10 * k + 1) * 256) ok = 0;
        $sformat(det, "8 channels, baselines -20000..15000: residuals and stored baselines exact=%0d", ok);
        check("CH-01", "channel_state", "8 interleaved channels keep independent baselines (alpha 0)", ok == 1);

        // EMA independence with alpha 3 against the reference formula
        pulse_reset;
        set_cfg(60000, 0, 0, 3);
        for (k = 0; k < 8; k = k + 1) begin bk[k] = (-8000 + 2100 * k) * 256; send(k[2:0], -8000 + 2100 * k); end
        ok = 1;
        for (r = 0; r < 40; r = r + 1)
            for (k = 0; k < 8; k = k + 1) begin
                x = -8000 + 2100 * k + ((r * 37 + k * 11) % 300) - 150;
                send(k[2:0], x);
                if (cap_base != bk[k] || cap_res != x - (bk[k] >>> 8)) ok = 0;
                bk[k] = ema_ref(bk[k], x, 3);
            end
        for (k = 0; k < 8; k = k + 1) if (dut.u_state.baseline[k] != bk[k]) ok = 0;
        $sformat(det, "320 interleaved samples, alpha 3: baselines/residuals match reference=%0d", ok);
        check("CH-02", "channel_state", "interleaved EMA baselines evolve independently and match the reference formula", ok == 1);

        pulse_reset;
        set_cfg(100, 0, 0, 0);
        for (k = 0; k < 7; k = k + 1) send(k[2:0], 0);   // channel 7 left unprimed
        send(3'd3, 500);
        settle;                                 // let this event leave before CH-04 counts events
        $sformat(det, "armed=%b refr3=%0d", dut.u_state.armed, dut.u_state.refr[3]);
        check("CH-03", "channel_state", "an event disarms only its own channel", dut.u_state.armed == 8'b1111_0111);

        set_cfg(100, 0, 5, 0);
        e0 = ev_n;
        send(3'd2, 500);                        // fires, refractory 5 on channel 2
        send(3'd5, 500);                        // channel 5 fires on the next sample
        settle;
        $sformat(det, "events=%0d (ch %0d, ch %0d) refr2=%0d refr5=%0d", ev_n - e0, evc[e0], evc[e0+1],
                 dut.u_state.refr[2], dut.u_state.refr[5]);
        check("CH-04", "channel_state", "refractory is per channel: ch2 refractory does not block ch5, and ch5 samples do not count down ch2",
              ev_n - e0 == 2 && evc[e0] == 3'd2 && evc[e0+1] == 3'd5 && dut.u_state.refr[2] == 5 && dut.u_state.refr[5] == 5);

        e0 = ev_n;
        send(3'd7, 30000);                      // first sample of channel 7
        settle;
        $sformat(det, "primed_before=%0d events=%0d primed7_after=%0d", cap_primed, ev_n - e0, dut.u_state.primed[7]);
        check("CH-05", "channel_state", "primed is per channel: the first sample of an unprimed channel never fires",
              cap_primed == 0 && ev_n == e0 && dut.u_state.primed[7] == 1'b1);

        // full 8-channel interleaved event pattern with known expected events
        pulse_reset;
        set_cfg(200, 50, 2, 0);
        e0 = ev_n; exp_n = 0;
        for (r = 0; r < 7; r = r + 1)
            for (k = 0; k < 8; k = k + 1) begin
                x = -1000 * k + 3000;
                if (r == (k % 4) + 1) begin
                    x = x + ((k % 2) ? -(300 + k) : (300 + k));
                    exc[exp_n] = k; ext[exp_n] = r * 8 + k; exp_p[exp_n] = k % 2; exm[exp_n] = 300 + k;
                    exp_n = exp_n + 1;
                end
                send(k[2:0], x);
            end
        settle;
        ok = (ev_n - e0 == exp_n);
        for (i = 0; i < exp_n && ok; i = i + 1)
            if (evc[e0+i] != exc[i] || evt[e0+i] != ext[i] || evp[e0+i] != exp_p[i] || evm[e0+i] != exm[i]) ok = 0;
        $sformat(det, "expected %0d events, got %0d, fields equal=%0d", exp_n, ev_n - e0, ok);
        check("CH-06", "channel_state", "8-channel round-robin: one spike per channel gives exactly the expected (ch, ts, pol, mag) events", ok == 1);

        // =================================================================
        // refractory
        // =================================================================
        refr_run(0, 12, nev, gok, gseen, wseen);
        $sformat(det, "events=%0d gap=%0d (expected 2) refr after fire=%0d", nev, gseen, refr_trace[1]);
        check("REF-01", "refractory", "refractory 0: next event after re-arm (gap 2 samples), counter stays 0",
              nev == 6 && gok == 1 && refr_trace[1] == 0 && wseen == 0);
        refr_run(1, 12, nev, gok, gseen, wseen);
        $sformat(det, "events=%0d gap=%0d (expected 2) refr trace=%0d,%0d", nev, gseen, refr_trace[1], refr_trace[2]);
        check("REF-02", "refractory", "refractory 1: counter 1 then 0, gap 2 samples",
              nev == 6 && gok == 1 && refr_trace[1] == 1 && refr_trace[2] == 0);
        refr_run(3, 20, nev, gok, gseen, wseen);
        $sformat(det, "events=%0d gap=%0d (expected 4) refr trace=%0d,%0d,%0d,%0d", nev, gseen,
                 refr_trace[1], refr_trace[2], refr_trace[3], refr_trace[4]);
        check("REF-03", "refractory", "refractory 3: exactly 3 same-channel samples blocked (gap 4)",
              nev == 5 && gok == 1 && refr_trace[1] == 3 && refr_trace[2] == 2 && refr_trace[3] == 1 && refr_trace[4] == 0);
        check("REF-04", "refractory", "refractory counter saturates at 0 (never wraps to 2^REFR_W-1)", wseen == 0);
        refr_run(7, 30, nev, gok, gseen, wseen);
        $sformat(det, "events=%0d gap=%0d (expected 8)", nev, gseen);
        check("REF-05", "refractory", "refractory 7: gap 8 samples", nev == 4 && gok == 1);
        refr_run(255, 600, nev, gok, gseen, wseen);
        $sformat(det, "events=%0d gap=%0d (expected 256)", nev, gseen);
        check("REF-06", "refractory", "refractory 255 (maximum): gap 256 samples", nev == 3 && gok == 1 && wseen == 0);

        // re-arm during refractory, and cfg change mid-countdown
        pulse_reset;
        set_cfg(100, 0, 10, 0);
        e0 = ev_n;
        send(3'd6, 0);
        send(3'd6, 200);                        // index 1 fires, counter 10
        send(3'd6, 200);                        // residual 0: re-arms while refractory
        ok = (dut.u_state.armed[6] == 1'b1) && (dut.u_state.refr[6] == 9);
        $sformat(det, "armed=%0d refr=%0d", dut.u_state.armed[6], dut.u_state.refr[6]);
        check("REF-07", "refractory", "a sub-threshold sample during refractory re-arms the channel (armed=1, counter running)", ok == 1);
        set_cfg(100, 0, 3, 0);                  // shorter refractory mid-countdown
        for (k = 3; k < 16; k = k + 1) send(3'd6, (k % 2) ? 200 : 0);
        settle;
        $sformat(det, "events=%0d second ts=%0d (expected 12)", ev_n - e0, evt[e0+1]);
        check("REF-08", "refractory", "changing cfg_refractory during a countdown does not reload the running counter",
              ev_n - e0 >= 2 && evt[e0+1] == 12);

        // =================================================================
        // signed_arithmetic
        // =================================================================
        pulse_reset;
        set_cfg(0, 0, 0, 0);
        send(3'd0, -32768);
        ok = (dut.u_state.baseline[0] == -8388608);
        send(3'd0, 32767);
        $sformat(det, "residual=%0d magnitude=%0d polarity=%0d", cap_res, cap_mag, cap_pol);
        check("SGN-01", "signed_arithmetic", "residual +65535 (32767 - (-32768)) without overflow", cap_res == 65535 && cap_mag == 65535 && cap_pol == 0);
        send(3'd1, 32767);
        ok = ok && (dut.u_state.baseline[1] == 8388352);
        send(3'd1, -32768);
        $sformat(det, "residual=%0d magnitude=%0d polarity=%0d", cap_res, cap_mag, cap_pol);
        check("SGN-02", "signed_arithmetic", "residual -65535 (-32768 - 32767) without overflow; magnitude 65535", cap_res == -65535 && cap_mag == 65535 && cap_pol == 1);
        $sformat(det, "baseline(-32768)=-8388608 and baseline(32767)=8388352: %0d", ok);
        check("SGN-03", "signed_arithmetic", "baseline register holds the Q16.8 extremes -2^23 and 32767*256", ok == 1);

        pulse_reset;
        set_cfg(0, 0, 0, 1);
        send(3'd2, 0);
        send(3'd2, -1);                         // b = 0 + (-256 >>> 1) = -128
        ok = (dut.u_state.baseline[2] == -128);
        send(3'd2, 0);                          // residual = 0 - floor(-0.5) = 1
        $sformat(det, "baseline=-128 ok=%0d residual=%0d (expected 1)", ok, cap_res);
        check("SGN-04", "signed_arithmetic", "negative fractional baseline (-0.5) floors to -1 in the residual", ok == 1 && cap_res == 1);
        send(3'd3, 0);
        send(3'd3, 1);                          // b = 128 (0.5)
        ok = (dut.u_state.baseline[3] == 128);
        send(3'd3, 0);
        $sformat(det, "baseline=128 ok=%0d residual=%0d (expected 0)", ok, cap_res);
        check("SGN-05", "signed_arithmetic", "positive fractional baseline (+0.5) floors to 0 in the residual", ok == 1 && cap_res == 0);

        set_cfg(0, 0, 0, 0);
        send(3'd4, 100);
        send(3'd4, -12345);
        $sformat(det, "baseline=%0d (expected %0d)", dut.u_state.baseline[4], -12345 * 256);
        check("SGN-06", "signed_arithmetic", "alpha_shift 0: baseline takes the sample value exactly", dut.u_state.baseline[4] == -12345 * 256);

        set_cfg(0, 0, 0, 15);
        send(3'd5, 0);
        send(3'd5, 32767);                      // step = floor(8388352 / 32768) = 255
        ok = (dut.u_state.baseline[5] == 255);
        send(3'd5, -32768);                     // step = floor(-8388863 / 32768) = -257
        $sformat(det, "after +32767: %0d (exp 255); after -32768: %0d (exp -2)", ok ? 255 : -1, dut.u_state.baseline[5]);
        check("SGN-07", "signed_arithmetic", "alpha_shift 15: smallest EMA steps, floor of err/32768 for both signs",
              ok == 1 && dut.u_state.baseline[5] == -2);

        set_cfg(0, 0, 0, 4);
        send(3'd6, 0);
        ok = 1; b_ref = 0;
        for (k = 0; k < 300; k = k + 1) begin
            send(3'd6, 1000);
            if (dut.u_state.baseline[6] < b_ref) ok = 0;   // monotonic approach
            b_ref = dut.u_state.baseline[6];
        end
        $sformat(det, "baseline after 300 samples=%0d target=256000 monotonic=%0d", b_ref, ok);
        check("SGN-08", "signed_arithmetic", "EMA (alpha 4) converges from below to within 2^alpha LSB of x*256 (floor bias)",
              ok == 1 && b_ref <= 256000 && b_ref > 256000 - 16);
        send(3'd7, 0);
        for (k = 0; k < 300; k = k + 1) send(3'd7, -1000);
        $sformat(det, "baseline after 300 samples=%0d target=-256000", dut.u_state.baseline[7]);
        check("SGN-09", "signed_arithmetic", "EMA (alpha 4) converges exactly from above (floor steps never stall below zero error)",
              dut.u_state.baseline[7] == -256000);

        // random samples across the full range and all alpha values vs reference
        pulse_reset;
        set_cfg(0, 0, 0, 0);
        send(3'd1, 0);
        b_ref = 0; ok = 1;
        for (k = 0; k < 600; k = k + 1) begin
            rng = xorshift32(rng);
            cfg_alpha_shift = rng[3:0];
            x = $signed(rng[31:16]);
            send(3'd1, x);
            if (cap_base != b_ref || cap_res != x - (b_ref >>> 8) ||
                cap_mag != ((cap_res < 0) ? -cap_res : cap_res)) ok = 0;
            b_ref = ema_ref(b_ref, x, rng[3:0]);
        end
        $sformat(det, "600 random samples, random alpha 0..15: baseline/residual/magnitude match=%0d", ok);
        check("SGN-10", "signed_arithmetic", "EMA, residual and magnitude match the reference formula over the full signed range", ok == 1);

        // =================================================================
        // timestamp
        // =================================================================
        pulse_reset;
        set_cfg(500, 100, 1, 2);
        e0 = ev_n; n0 = fire_n; cnt = 0;
        for (k = 0; k < 8; k = k + 1) send(k[2:0], 0);
        cnt = 8;
        for (k = 0; k < 400; k = k + 1) begin
            rng = xorshift32(rng);
            x = (rng[11:0] > 12'd3900) ? ((rng[12]) ? 1500 : -1500) : ($signed(rng[31:24]) * 2);
            send(rng[15:13], x);
            cnt = cnt + 1;
            if (k == 200) begin
                i = stat_samples8;
                repeat (25) @(negedge clk);     // idle cycles
                ok = (stat_samples8 == i);
            end
        end
        settle;
        r = 1;
        for (i = 0; i < ev_n - e0; i = i + 1) if (evt[e0+i] != fire_ts[n0+i]) r = 0;
        $sformat(det, "%0d events; ts == index of the firing accepted sample for all=%0d", ev_n - e0, r);
        check("TS-01", "timestamp", "event timestamp == index of the accepted sample that fired",
              r == 1 && ev_n - e0 == fire_n - n0 && ev_n - e0 > 5);
        r = 1;
        for (i = e0 + 1; i < ev_n; i = i + 1) if (evt[i] <= evt[i-1]) r = 0;
        $sformat(det, "%0d events strictly increasing=%0d", ev_n - e0, r);
        check("TS-02", "timestamp", "event timestamps are strictly increasing", r == 1);
        $sformat(det, "stat_samples=%0d sent=%0d stat_events=%0d handshakes=%0d", stat_samples8, cnt, stat_events8, ev_n - e0);
        check("TS-03", "timestamp", "stat_samples == accepted samples; stat_events == event handshakes after drain",
              stat_samples8 == cnt && stat_events8 == ev_n - e0);
        $sformat(det, "25 idle cycles: stat_samples unchanged=%0d", ok);
        check("TS-04", "timestamp", "idle cycles (in_valid low) do not advance the timestamp", ok == 1);

        // =================================================================
        // backpressure
        // =================================================================
        pulse_reset;
        set_cfg(100, 0, 0, 0);
        bp_ready_err = 0; bp_hold_err = 0; bp_stall = 0;
        e1 = ev_n;
        for (k = 0; k < 4; k = k + 1) begin send(k[2:0], 1000 * k); ph[k] = 0; end
        e0 = ev_n; exp_n = 0;
        rand_ready = 1'b1;
        for (i = 0; i < 480; i = i + 1) begin
            k = i % 4;
            x = 1000 * k;
            if (ph[k] == 0) begin
                x = x + ((i % 8 < 4) ? 500 : -500);
                exc[exp_n] = k; ext[exp_n] = 4 + i; exp_p[exp_n] = (i % 8 >= 4); exm[exp_n] = 500;
                exp_n = exp_n + 1;
            end
            ph[k] = (ph[k] + 1) % 3;
            send(k[2:0], x);
        end
        rand_ready = 1'b0;
        ev_ready = 1'b1;
        settle;
        ok = (ev_n - e0 == exp_n);
        for (i = 0; i < exp_n && ok; i = i + 1)
            if (evc[e0+i] != exc[i] || evt[e0+i] != ext[i] || evp[e0+i] != exp_p[i] || evm[e0+i] != exm[i]) ok = 0;
        $sformat(det, "random ev_ready: expected %0d events, got %0d, all fields/order equal=%0d, stall cycles=%0d",
                 exp_n, ev_n - e0, ok, bp_stall);
        check("BP-01", "backpressure", "pseudo-random ev_ready: event stream equals the expected list (no drop, no duplicate, order kept)",
              ok == 1 && bp_stall > 20);
        $sformat(det, "violations=%0d", bp_ready_err);
        check("BP-02", "backpressure", "in_ready == !ev_valid || ev_ready on every cycle", bp_ready_err == 0);
        $sformat(det, "violations=%0d", bp_hold_err);
        check("BP-03", "backpressure", "ev_valid and the event payload stay stable while ev_ready is low", bp_hold_err == 0);

        // simultaneous drain and push in one cycle
        e0 = ev_n;
        ev_ready = 1'b0;
        send(3'd0, 500);                        // ch0 baseline 0 (alpha 0, last value 0) -> fires, held
        @(negedge clk);
        in_valid = 1'b1; in_channel = 3'd1; in_sample = 16'sd1500;   // ch1 last value 1000 -> fires
        ev_ready = 1'b1;                        // this edge: event 0 leaves AND sample 1 is accepted
        @(posedge clk); #1;
        ok = (ev_valid8 == 1'b1);
        @(negedge clk); in_valid = 1'b0;
        settle;
        $sformat(det, "events=%0d (ch %0d then ch %0d) slot reloaded in the drain cycle=%0d", ev_n - e0, evc[e0], evc[e0+1], ok);
        check("BP-04", "backpressure", "drain and push in the same cycle: both events delivered, in order",
              ev_n - e0 == 2 && evc[e0] == 3'd0 && evc[e0+1] == 3'd1 && ok == 1);
        $sformat(det, "stat_events=%0d handshakes since reset=%0d ev_valid=%0d", stat_events8, ev_n - e1, ev_valid8);
        check("BP-05", "backpressure", "after draining: stat_events == handshakes and the slot is empty",
              stat_events8 == ev_n - e1 && ev_valid8 == 1'b0);

        // =================================================================
        repeat (4) @(posedge clk);
        $display("SUMMARY checks=%0d errors=%0d", checks, errors);
        if (errors == 0) $display("PASS");
        else             $display("FAIL");
        $finish;
    end
endmodule

`default_nettype wire
