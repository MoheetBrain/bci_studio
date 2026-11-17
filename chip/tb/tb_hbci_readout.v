// ============================================================================
// HBCI-01 v0.3 readout-core testbench — file-driven, deterministic.
//
// Drives hbci_readout_core from a $readmemh stimulus (64-bit words, format in
// scripts/golden_v03.py) and logs every input the DUT saw and every record it
// emitted, so scripts/check_v03.py can replay the inputs through the
// cycle-accurate Python golden model and compare cycle by cycle.
//
// Used for the v0.3 suites (RAW reconstruction, FEATURE bit-accuracy, HYBRID,
// session gating, overload/gaps, mode switching), the gate-level suite
// (compile with -DGATE and the Yosys netlist) and the studio trace
// (+vcd=FILE, scripts/make_trace_v03.py).
//
// Plusargs:
//   +stim=FILE  +log=FILE  [+vcd=FILE] [+n=N] [+seed=N] [+ready_pct=N] [+idle_hold=1]
//
// Log lines (cycle = number of rising clock edges since time 0; values are
// the ones present at that rising edge, before the registers update):
//   A i cycle ch x                 accepted sample (testbench view: in_valid & ch < NUM_CH)
//   F i cycle ch x y ysat acc cnt done x1 x2 y1 y2 sat esat energy fsat
//                                  feature path internals at every accepted sample, read from
//                                  the RTL by hierarchical reference (pre-update acc/cnt/sat;
//                                  not available with -DGATE)
//   G cycle type ch ts data sat    record generated (raw_gen/event_gen/feat_gen; RTL only)
//   J cycle ch x                   rejected sample (channel >= NUM_CH)
//   O cycle type ch flags seq ts data   record handshake (rec_valid & rec_ready)
//   W cycle addr value             configuration register value from this edge on
//   Y cycle value                  rec_ready value from this edge on (logged on change)
//   R cycle                        rst_n low at this edge
//   C cycle samples rejected drop_raw drop_event drop_feature event_missed fifo_hwm
//                                  status counters before edge `cycle` (after a drain)
//   M cycle id                     marker from the stimulus
//   K name count                   testbench consistency counters (0 = good; *_info = info)
//   END cycles / DONE
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci_readout;
    parameter integer NUM_CH    = 8;
    parameter integer CH_W      = 3;
    parameter integer SAMPLE_W  = 16;
    parameter integer TS_W      = 32;
    parameter integer SEQ_W     = 16;
    parameter integer FIFO_LOG2 = 4;
    parameter integer WIN_W     = 10;
    parameter integer ACC_W     = 48;
    localparam integer MAX_STIM = 1 << 18;

    reg                        clk = 1'b0;
    reg                        rst_n = 1'b0;
    reg                        cfg_session_en = 1'b0;
    reg  [1:0]                 cfg_mode = 2'd0;
    reg  [SAMPLE_W-1:0]        cfg_threshold = 0;
    reg  [SAMPLE_W-1:0]        cfg_hysteresis = 0;
    reg  [7:0]                 cfg_refractory = 0;
    reg  [3:0]                 cfg_alpha_shift = 0;
    reg  signed [15:0]         cfg_b0 = 0, cfg_b1 = 0, cfg_b2 = 0, cfg_a1 = 0, cfg_a2 = 0;
    reg  [3:0]                 cfg_win_log2 = 0;
    reg  [5:0]                 cfg_energy_shift = 0;
    reg                        in_valid = 1'b0;
    reg  [CH_W-1:0]            in_channel = 0;
    reg  signed [SAMPLE_W-1:0] in_sample = 0;
    wire                       rec_valid;
    reg                        rec_ready = 1'b1;
    wire [1:0]                 rec_type;
    wire [CH_W-1:0]            rec_channel;
    wire [3:0]                 rec_flags;
    wire [SEQ_W-1:0]           rec_seq;
    wire [TS_W-1:0]            rec_ts;
    wire [31:0]                rec_data;
    wire [TS_W-1:0]            stat_samples, stat_rejected;
    wire [31:0]                stat_drop_raw, stat_drop_event, stat_drop_feature;
    wire [31:0]                stat_event_missed, stat_fifo_hwm;

`ifdef GATE
    hbci_readout_core dut (
`else
    hbci_readout_core #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W), .SEQ_W(SEQ_W),
        .FIFO_LOG2(FIFO_LOG2), .WIN_W(WIN_W), .ACC_W(ACC_W)
    ) dut (
`endif
        .clk(clk), .rst_n(rst_n),
        .cfg_session_en(cfg_session_en), .cfg_mode(cfg_mode),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .cfg_b0(cfg_b0), .cfg_b1(cfg_b1), .cfg_b2(cfg_b2), .cfg_a1(cfg_a1), .cfg_a2(cfg_a2),
        .cfg_win_log2(cfg_win_log2), .cfg_energy_shift(cfg_energy_shift), .feat_sync(1'b0),
        .in_valid(in_valid), .in_channel(in_channel), .in_sample(in_sample),
        .rec_valid(rec_valid), .rec_ready(rec_ready),
        .rec_type(rec_type), .rec_channel(rec_channel), .rec_flags(rec_flags),
        .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .stat_samples(stat_samples), .stat_rejected(stat_rejected),
        .stat_drop_raw(stat_drop_raw), .stat_drop_event(stat_drop_event),
        .stat_drop_feature(stat_drop_feature), .stat_event_missed(stat_event_missed),
        .stat_fifo_hwm(stat_fifo_hwm),
        .ai_feat_valid(), .ai_feat_ch(), .ai_feat_energy(), .ai_feat_ts(), .ai_feat_saturated(), .ai_feat_win()
    );

    always #5 clk = ~clk;   // simulation clock only; no timing claim

    // ------------------------------------------------------------ utilities
    function [31:0] xorshift32(input [31:0] s);
        reg [31:0] t;
        begin
            t = s ^ (s << 13);
            t = t ^ (t >> 17);
            xorshift32 = t ^ (t << 5);
        end
    endfunction

    reg [31:0] rng_ready = 32'h1234_5678;   // rec_ready throttling
    reg [31:0] rng_bus   = 32'h9e37_79b9;   // garbage on the bus while in_valid is low
    integer log_fd;
    integer cycle = 0;
    integer ready_pct = 100;
    integer idle_hold = 0;
    reg     force_ready = 1'b0;
    reg [TS_W-1:0] acc_idx = 0;              // testbench count of accepted samples since reset
    integer ts_err = 0;                      // stat_samples != testbench count
    integer x_err = 0;                       // X/Z on rec_valid or on a record handshake
    integer acc_err = 0;                     // dut.accept disagrees with the testbench view (RTL)
    integer evts_err = 0;                    // u_event timestamp != index of the crossing sample (RTL)
    integer missed_err = 0;                  // u_event.in_ready low on an accepted sample (RTL)
    integer gen_raw = 0, gen_event = 0, gen_feature = 0;   // generated records (RTL)
    integer n_out = 0;
    reg     last_ready = 1'bx;
    reg     prev_acc = 1'b0;
    reg [TS_W-1:0] prev_idx = 0;

    // --------------------------------------------------------------- rec_ready
    always @(negedge clk) begin
        rng_ready = xorshift32(rng_ready);
        if (force_ready) rec_ready = 1'b1;
        else             rec_ready = ((rng_ready % 100) < ready_pct);
    end

    // ---------------------------------------------------------------- monitor
    wire ch_ok = ({{(32-CH_W){1'b0}}, in_channel} < NUM_CH);
    always @(posedge clk) begin
        cycle <= cycle + 1;
        if (rec_ready !== last_ready) begin
            $fdisplay(log_fd, "Y %0d %0d", cycle, rec_ready);
            last_ready = rec_ready;
        end
        if (!rst_n) begin
            $fdisplay(log_fd, "R %0d", cycle);
            acc_idx  = 0;
            prev_acc = 1'b0;
        end else begin
            if (^rec_valid === 1'bx) x_err = x_err + 1;
            if (in_valid && ch_ok) begin
                $fdisplay(log_fd, "A %0d %0d %0d %0d", acc_idx, cycle, in_channel, in_sample);
`ifndef GATE
                $fdisplay(log_fd, "F %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d",
                    dut.sample_idx, cycle, dut.in_channel, dut.in_sample, dut.bq_y, dut.bq_ysat,
                    dut.fs_acc, dut.fs_cnt, dut.en_done, dut.fs_x1, dut.fs_x2, dut.fs_y1, dut.fs_y2,
                    dut.fs_sat, dut.u_energy.esat, dut.en_energy, dut.en_feat_sat);
                if (dut.accept !== 1'b1) acc_err = acc_err + 1;
                if (dut.ev_in_ready !== 1'b1) missed_err = missed_err + 1;
`endif
                if (stat_samples !== acc_idx) ts_err = ts_err + 1;
            end
            if (in_valid && !ch_ok)
                $fdisplay(log_fd, "J %0d %0d %0d", cycle, in_channel, in_sample);
`ifndef GATE
            if (!(in_valid && ch_ok) && dut.accept !== 1'b0) acc_err = acc_err + 1;
            // u_event's event register holds the index of the sample accepted one edge earlier
            if (dut.ev_valid === 1'b1 && (!prev_acc || dut.ev_timestamp !== prev_idx)) evts_err = evts_err + 1;
            if (dut.raw_gen) begin
                gen_raw = gen_raw + 1;
                $fdisplay(log_fd, "G %0d 0 %0d %0d %0d 0", cycle, dut.in_channel, dut.sample_idx, dut.raw_data);
            end
            if (dut.event_gen) begin
                gen_event = gen_event + 1;
                $fdisplay(log_fd, "G %0d 1 %0d %0d %0d 0", cycle, dut.ev_channel, dut.ev_timestamp, dut.event_data);
            end
            if (dut.feat_gen) begin
                gen_feature = gen_feature + 1;
                $fdisplay(log_fd, "G %0d 2 %0d %0d %0d %0d", cycle, dut.in_channel, dut.sample_idx,
                          dut.en_energy, dut.en_feat_sat);
            end
`endif
            if (rec_valid === 1'b1 && rec_ready === 1'b1) begin
                if ((^{rec_type, rec_channel, rec_flags, rec_seq, rec_ts, rec_data}) === 1'bx) x_err = x_err + 1;
                $fdisplay(log_fd, "O %0d %0d %0d %0d %0d %0d %0d", cycle, rec_type, rec_channel, rec_flags,
                          rec_seq, rec_ts, rec_data);
                n_out = n_out + 1;
            end
            prev_acc = in_valid && ch_ok;
            prev_idx = acc_idx;
            if (in_valid && ch_ok) acc_idx = acc_idx + 1'b1;
        end
    end

    // ----------------------------------------------------------------- driver
    reg [63:0] stim [0:MAX_STIM-1];
    reg [63:0] w;
    reg [1023:0] stim_file, log_file, vcd_file;
    integer nstim, n, k, seed, quiet, wd;
    reg [31:0] v;

    task bus_idle;
        begin
            in_valid = 1'b0;
            rng_bus  = xorshift32(rng_bus);
            if (idle_hold == 0) begin
                in_channel = rng_bus[CH_W-1:0];       // garbage while in_valid is low
                in_sample  = rng_bus[31:32-SAMPLE_W];
            end
        end
    endtask

    task drain_and_count;
        begin
            bus_idle;
            force_ready = 1'b1;
            rec_ready   = 1'b1;
            quiet = 0;
            wd = 0;
            while (quiet < 4 && wd < 200000) begin
                @(negedge clk);
                bus_idle;
                if (rec_valid === 1'b0) quiet = quiet + 1;
                else quiet = 0;
                wd = wd + 1;
            end
            if (wd >= 200000) $display("ERROR: drain did not complete");
            $fdisplay(log_fd, "C %0d %0d %0d %0d %0d %0d %0d %0d", cycle, stat_samples, stat_rejected,
                      stat_drop_raw, stat_drop_event, stat_drop_feature, stat_event_missed, stat_fifo_hwm);
        end
    endtask

    task apply_cfg(input [3:0] addr, input [31:0] value);
        begin
            case (addr)
                4'd0:  begin cfg_session_en   = value[0];          $fdisplay(log_fd, "W %0d 0 %0d", cycle, cfg_session_en); end
                4'd1:  begin cfg_mode         = value[1:0];        $fdisplay(log_fd, "W %0d 1 %0d", cycle, cfg_mode); end
                4'd2:  begin cfg_threshold    = value[SAMPLE_W-1:0]; $fdisplay(log_fd, "W %0d 2 %0d", cycle, cfg_threshold); end
                4'd3:  begin cfg_hysteresis   = value[SAMPLE_W-1:0]; $fdisplay(log_fd, "W %0d 3 %0d", cycle, cfg_hysteresis); end
                4'd4:  begin cfg_refractory   = value[7:0];        $fdisplay(log_fd, "W %0d 4 %0d", cycle, cfg_refractory); end
                4'd5:  begin cfg_alpha_shift  = value[3:0];        $fdisplay(log_fd, "W %0d 5 %0d", cycle, cfg_alpha_shift); end
                4'd6:  begin cfg_b0           = value[15:0];       $fdisplay(log_fd, "W %0d 6 %0d", cycle, cfg_b0); end
                4'd7:  begin cfg_b1           = value[15:0];       $fdisplay(log_fd, "W %0d 7 %0d", cycle, cfg_b1); end
                4'd8:  begin cfg_b2           = value[15:0];       $fdisplay(log_fd, "W %0d 8 %0d", cycle, cfg_b2); end
                4'd9:  begin cfg_a1           = value[15:0];       $fdisplay(log_fd, "W %0d 9 %0d", cycle, cfg_a1); end
                4'd10: begin cfg_a2           = value[15:0];       $fdisplay(log_fd, "W %0d 10 %0d", cycle, cfg_a2); end
                4'd11: begin cfg_win_log2     = value[3:0];        $fdisplay(log_fd, "W %0d 11 %0d", cycle, cfg_win_log2); end
                4'd12: begin cfg_energy_shift = value[5:0];        $fdisplay(log_fd, "W %0d 12 %0d", cycle, cfg_energy_shift); end
                4'd13: begin ready_pct        = value;             $fdisplay(log_fd, "W %0d 13 %0d", cycle, ready_pct); end
                4'd14: begin idle_hold        = value;             $fdisplay(log_fd, "W %0d 14 %0d", cycle, idle_hold); end
                default: $display("WARNING: unknown cfg address %0d", addr);
            endcase
        end
    endtask

    initial begin
        if (!$value$plusargs("stim=%s", stim_file)) begin $display("ERROR: +stim= missing"); $finish; end
        if (!$value$plusargs("log=%s", log_file))   begin $display("ERROR: +log= missing");  $finish; end
        if (!$value$plusargs("ready_pct=%d", ready_pct)) ready_pct = 100;
        if (!$value$plusargs("idle_hold=%d", idle_hold)) idle_hold = 0;
        if ($value$plusargs("seed=%d", seed)) begin
            rng_ready = (seed == 0) ? 32'h1234_5678 : seed;
            rng_bus   = rng_ready ^ 32'h5bd1_e995;
        end
        if ($value$plusargs("vcd=%s", vcd_file)) begin
            $dumpfile(vcd_file);
            $dumpvars(0, tb_hbci_readout);
        end
        log_fd = $fopen(log_file, "w");
        for (n = 0; n < MAX_STIM; n = n + 1) stim[n] = {64{1'bx}};
        if ($value$plusargs("n=%d", nstim) && nstim > 0) $readmemh(stim_file, stim, 0, nstim - 1);
        else $readmemh(stim_file, stim);
        nstim = 0;
        while (nstim < MAX_STIM && ^stim[nstim] !== 1'bx) nstim = nstim + 1;
        $fdisplay(log_fd, "# stim=%0s n=%0d NUM_CH=%0d CH_W=%0d SAMPLE_W=%0d TS_W=%0d SEQ_W=%0d FIFO_LOG2=%0d WIN_W=%0d ACC_W=%0d ready_pct=%0d",
                  stim_file, nstim, NUM_CH, CH_W, SAMPLE_W, TS_W, SEQ_W, FIFO_LOG2, WIN_W, ACC_W, ready_pct);

        rst_n = 1'b0;
        repeat (3) @(posedge clk);
        @(negedge clk);
        rst_n = 1'b1;

        for (n = 0; n < nstim; n = n + 1) begin
            w = stim[n];
            for (k = 0; k < w[39:32]; k = k + 1) begin
                bus_idle;
                @(negedge clk);
            end
            case (w[63:60])
                4'd0: begin                                    // SAMPLE
                    in_valid   = 1'b1;
                    in_channel = w[56 +: CH_W];
                    in_sample  = w[40 +: SAMPLE_W];
                    @(negedge clk);
                    in_valid   = 1'b0;                         // re-asserted at once by a following sample
                end
                4'd1: begin                                    // RESET
                    drain_and_count;
                    rst_n = 1'b0;
                    @(negedge clk);
                    rst_n = 1'b1;
                    force_ready = 1'b0;
                end
                4'd2: apply_cfg(w[59:56], w[31:0]);            // CFG (effective from the next edge)
                4'd3: begin                                    // WAIT
                    v = w[31:0];
                    for (k = 0; k < v; k = k + 1) begin
                        bus_idle;
                        @(negedge clk);
                    end
                end
                4'd4: begin                                    // DRAIN
                    drain_and_count;
                    force_ready = 1'b0;
                end
                4'd5: $fdisplay(log_fd, "M %0d %0d", cycle, w[31:0]);
                default: $display("WARNING: unknown op %0d at word %0d", w[63:60], n);
            endcase
        end
        drain_and_count;
        $fdisplay(log_fd, "K ts_vs_count %0d", ts_err);
        $fdisplay(log_fd, "K x_on_outputs %0d", x_err);
`ifndef GATE
        $fdisplay(log_fd, "K accept_vs_tb %0d", acc_err);
        $fdisplay(log_fd, "K event_ts_vs_index %0d", evts_err);
        $fdisplay(log_fd, "K event_core_not_ready %0d", missed_err);
        $fdisplay(log_fd, "K gen_raw_info %0d", gen_raw);
        $fdisplay(log_fd, "K gen_event_info %0d", gen_event);
        $fdisplay(log_fd, "K gen_feature_info %0d", gen_feature);
`endif
        $fdisplay(log_fd, "K records_out_info %0d", n_out);
        $fdisplay(log_fd, "END %0d", cycle);
        $fdisplay(log_fd, "DONE");
        $fclose(log_fd);
        $finish;
    end
endmodule

`default_nettype wire
