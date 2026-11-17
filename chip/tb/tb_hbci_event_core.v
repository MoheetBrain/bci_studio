// ============================================================================
// HBCI-01 v0.1 testbench (reconstructed) — directed, deterministic, self-checking.
// Run: make sim     (Icarus Verilog)   Waveform: build/hbci_event_core.vcd
// v0.2: the 15 checks are unchanged; each now also prints a tab-separated
//   RESULT <id> <category> PASS|FAIL <name>
// line for scripts/parse_directed.py (category set per section via `cat`).
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci_event_core;
    localparam integer NUM_CH = 8;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg  [15:0] cfg_threshold = 16'd0;
    reg  [15:0] cfg_hysteresis = 16'd0;
    reg  [7:0]  cfg_refractory = 8'd0;
    reg  [3:0]  cfg_alpha_shift = 4'd4;
    reg         in_valid = 1'b0;
    wire        in_ready;
    reg  [2:0]  in_channel = 3'd0;
    reg  signed [15:0] in_sample = 16'sd0;
    wire        ev_valid;
    reg         ev_ready = 1'b1;
    wire [2:0]  ev_channel;
    wire [31:0] ev_timestamp;
    wire        ev_polarity;
    wire [15:0] ev_magnitude;
    wire [31:0] stat_samples, stat_events, stat_rejected;

    hbci_event_core dut (
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

    always #5 clk = ~clk;   // 100 MHz simulation clock (not a timing claim)

    integer errors = 0;
    integer checks = 0;
    reg [8*20-1:0] cat = "reset";

    // Event capture: every handshake on the output is logged.
    integer ev_count = 0;
    reg [2:0]  last_ch;
    reg [31:0] last_ts;
    reg        last_pol;
    reg [15:0] last_mag;
    always @(posedge clk) begin
        if (rst_n && ev_valid && ev_ready) begin
            ev_count = ev_count + 1;
            last_ch  = ev_channel;
            last_ts  = ev_timestamp;
            last_pol = ev_polarity;
            last_mag = ev_magnitude;
            $display("  EVENT ch=%0d ts=%0d pol=%0d mag=%0d", ev_channel, ev_timestamp, ev_polarity, ev_magnitude);
        end
    end

    task check(input cond, input [8*64-1:0] what);
        begin
            checks = checks + 1;
            if (!cond) begin
                errors = errors + 1;
                $display("FAIL: %0s (t=%0t)", what, $time);
            end
            $display("RESULT\tV01-%02d\t%0s\t%0s\t%0s\t", checks, cat, cond ? "PASS" : "FAIL", what);
        end
    endtask

    // Send one sample and wait for it to be accepted.
    task send(input [2:0] ch, input signed [15:0] x);
        begin
            @(negedge clk);
            in_valid   = 1'b1;
            in_channel = ch;
            in_sample  = x;
            @(posedge clk);
            while (!in_ready) @(posedge clk);
            @(negedge clk);
            in_valid = 1'b0;
        end
    endtask

    integer k, before;

    initial begin
        $dumpfile("build/hbci_event_core.vcd");
        $dumpvars(0, tb_hbci_event_core);

        // ---------------------------------------------------------------- reset
        repeat (3) @(posedge clk);
        check(ev_valid == 1'b0, "ev_valid low during reset");
        check(stat_samples == 0, "timestamp zero during reset");
        rst_n = 1'b1;

        // --------------------------------------------- detection disabled (thr=0)
        cat = "threshold_boundary";
        for (k = 0; k < 4; k = k + 1) send(3'd0, 16'sd1000);
        check(ev_count == 0, "threshold 0 disables detection");

        // ----------------------------------------------------- threshold boundary
        cfg_threshold  = 16'd100;
        cfg_hysteresis = 16'd20;
        cfg_refractory = 8'd0;
        cfg_alpha_shift = 4'd15;   // near-frozen baseline for exact residuals
        send(3'd1, 16'sd0);        // primes channel 1, baseline = 0
        before = ev_count;
        send(3'd1, 16'sd99);       // |r| = 99 < 100: no event
        check(ev_count == before, "residual one below threshold: no event");
        send(3'd1, 16'sd0);        // re-arm
        send(3'd1, 16'sd100);      // |r| = 100: event
        @(posedge clk); #1;
        check(ev_count == before + 1, "residual equal to threshold: event");
        check(last_ch == 3'd1 && last_pol == 1'b0 && last_mag == 16'd100, "event fields at threshold");

        // ------------------------------------------------------------- hysteresis
        cat = "threshold_boundary";
        before = ev_count;
        send(3'd1, 16'sd150);      // still above, not re-armed: no event
        send(3'd1, 16'sd85);       // 85 >= 80 (= 100 - 20): still not re-armed
        send(3'd1, 16'sd150);
        check(ev_count == before, "no re-trigger without falling below threshold-hysteresis");
        send(3'd1, 16'sd79);       // 79 < 80: re-armed
        send(3'd1, 16'sd150);
        @(posedge clk); #1;
        check(ev_count == before + 1, "re-trigger after re-arm");

        // ---------------------------------------------------- negative polarity
        cat = "signed_arithmetic";
        before = ev_count;
        send(3'd1, 16'sd0);
        send(3'd1, -16'sd120);
        @(posedge clk); #1;
        check(ev_count == before + 1 && last_pol == 1'b1 && last_mag == 16'd120, "negative crossing reported with polarity 1");

        // ------------------------------------------------------------- refractory
        cat = "refractory";
        cfg_refractory = 8'd3;
        send(3'd2, 16'sd0);        // prime channel 2
        before = ev_count;
        send(3'd2, 16'sd200);      // fires, refractory = 3
        send(3'd2, 16'sd0);        // refr 3 -> 2 (re-arms)
        send(3'd2, 16'sd200);      // refr 2 -> 1, blocked
        send(3'd2, 16'sd0);        // refr 1 -> 0
        send(3'd2, 16'sd200);      // fires again
        @(posedge clk); #1;
        check(ev_count == before + 2, "refractory blocks events for cfg_refractory samples");

        // ------------------------------------------------- channel independence
        cat = "channel_state";
        cfg_refractory = 8'd0;
        send(3'd3, 16'sd0);
        send(3'd4, 16'sd0);
        before = ev_count;
        send(3'd3, 16'sd300);      // channel 3 fires
        send(3'd4, 16'sd300);      // channel 4 fires independently
        @(posedge clk); #1;
        check(ev_count == before + 2 && last_ch == 3'd4, "per-channel state is independent");

        // ------------------------------------------------- timestamp consistency
        cat = "timestamp";
        before = stat_samples;
        send(3'd5, 16'sd0);
        send(3'd5, 16'sd500);
        @(posedge clk); #1;
        check(last_ts == before + 1, "event timestamp equals index of the crossing sample");
        check(stat_samples == before + 2, "sample counter advances once per accepted sample");

        // ------------------------------------------------------- back-pressure
        cat = "backpressure";
        ev_ready = 1'b0;
        send(3'd6, 16'sd0);
        send(3'd6, 16'sd400);      // event held in output slot
        @(negedge clk);
        in_valid = 1'b1; in_channel = 3'd7; in_sample = 16'sd0;
        @(posedge clk); #1;
        check(in_ready == 1'b0, "input stalls while event slot is full");
        ev_ready = 1'b1;
        @(posedge clk); #1;
        @(negedge clk); in_valid = 1'b0;
        check(stat_events == ev_count, "no events dropped under back-pressure");

        // ---------------------------------------------------------------- done
        repeat (4) @(posedge clk);
        $display("SUMMARY checks=%0d errors=%0d events=%0d samples=%0d", checks, errors, ev_count, stat_samples);
        if (errors == 0) $display("PASS");
        else             $display("FAIL");
        $finish;
    end
endmodule

`default_nettype wire
