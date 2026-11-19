// ============================================================================
// HBCI-02 integrated digital top testbench: file-driven host model.
//
// Drives hbci02_digital_top through its register bus and sample port from a
// $readmemh stimulus (64-bit words, format in scripts/golden_top.py) and logs
// everything the DUT saw and produced, so scripts/check_top.py can replay the
// run through the combined v0.3 readout model and the v0.4 decoder model.
//
// Plusargs: +stim=FILE +log=FILE [+vcd=FILE] [+n=N] [+seed=N]
// Log lines (cycle = rising edges since time 0; values present at that edge):
//   A i cycle ch x        accepted external sample     J cycle ch x   rejected sample
//   O cycle type ch flags seq ts data   record handshake (external port)
//   Y cycle ready         rec_ready from this edge on (on change)
//   W cycle addr data     register write at this edge
//   D cycle addr data     register read (reg_rdata sampled at this edge)
//   T cycle ch energy ts sat win   feature tap (RTL only)
//   R cycle               rst_n low at this edge
//   N cycle id            marker
//   K? name count         testbench consistency counters
//   END cycles / DONE
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci02_top;
    parameter integer NUM_CH    = 8;
    parameter integer CH_W      = 3;
    parameter integer SAMPLE_W  = 16;
    parameter integer TS_W      = 32;
    parameter integer SEQ_W     = 16;
    parameter integer FIFO_LOG2 = 4;
    parameter integer WIN_W     = 10;
    parameter integer ACC_W     = 48;
    parameter integer WIN_IDX_W = 16;
    parameter integer NH        = 4;
    parameter integer NO        = 2;
    parameter integer PRED_LOG2 = 2;
    localparam integer MAX_STIM = 1 << 20;

    reg clk = 1'b0, rst_n = 1'b0;
    reg reg_wr = 1'b0;
    reg [7:0] reg_addr = 8'd0;
    reg [31:0] reg_wdata = 32'd0;
    wire [31:0] reg_rdata;
    reg in_valid = 1'b0;
    reg [CH_W-1:0] in_channel = 0;
    reg signed [SAMPLE_W-1:0] in_sample = 0;
    wire rec_valid;
    reg  rec_ready = 1'b1;
    wire [1:0] rec_type;
    wire [CH_W-1:0] rec_channel;
    wire [3:0] rec_flags;
    wire [SEQ_W-1:0] rec_seq;
    wire [TS_W-1:0] rec_ts;
    wire [31:0] rec_data;
    wire pred_strobe, pred_irq;
    wire [1:0] pred_class_out;

`ifdef GATE
    hbci02_digital_top dut (
`else
    hbci02_digital_top #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W), .SEQ_W(SEQ_W), .FIFO_LOG2(FIFO_LOG2),
        .WIN_W(WIN_W), .ACC_W(ACC_W), .WIN_IDX_W(WIN_IDX_W), .NH(NH), .NO(NO), .PRED_LOG2(PRED_LOG2)
    ) dut (
`endif
        .clk(clk), .rst_n(rst_n),
        .reg_wr(reg_wr), .reg_addr(reg_addr), .reg_wdata(reg_wdata), .reg_rdata(reg_rdata),
        .in_valid(in_valid), .in_channel(in_channel), .in_sample(in_sample),
        .rec_valid(rec_valid), .rec_ready(rec_ready), .rec_type(rec_type), .rec_channel(rec_channel),
        .rec_flags(rec_flags), .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .pred_strobe(pred_strobe), .pred_class_out(pred_class_out), .pred_irq(pred_irq)
    );

    always #5 clk = ~clk;

    function [31:0] xorshift32(input [31:0] s);
        reg [31:0] t;
        begin
            t = s ^ (s << 13);
            t = t ^ (t >> 17);
            xorshift32 = t ^ (t << 5);
        end
    endfunction

    reg [31:0] rng_ready = 32'h1234_5678, rng_bus = 32'h9e37_79b9;
    integer log_fd, cycle = 0, ready_pct = 100, idle_hold = 0;
    reg force_ready = 1'b0;
    reg last_ready = 1'bx;
    reg [TS_W-1:0] acc_idx = 0;
    integer x_err = 0, n_out = 0, n_strobe = 0;
    wire ch_ok = ({{(32-CH_W){1'b0}}, in_channel} < NUM_CH);

    always @(negedge clk) begin
        rng_ready = xorshift32(rng_ready);
        if (force_ready) rec_ready = 1'b1;
        else             rec_ready = ((rng_ready % 100) < ready_pct);
    end

    always @(posedge clk) begin
        cycle <= cycle + 1;
        if (rec_ready !== last_ready) begin
            $fdisplay(log_fd, "Y %0d %0d", cycle, rec_ready);
            last_ready = rec_ready;
        end
        if (!rst_n) begin
            $fdisplay(log_fd, "R %0d", cycle);
            acc_idx = 0;
        end else begin
            if (^rec_valid === 1'bx) x_err = x_err + 1;
            if (in_valid && ch_ok) begin
                $fdisplay(log_fd, "A %0d %0d %0d %0d", acc_idx, cycle, in_channel, in_sample);
                acc_idx = acc_idx + 1'b1;
            end
            if (in_valid && !ch_ok) $fdisplay(log_fd, "J %0d %0d %0d", cycle, in_channel, in_sample);
            if (reg_wr) $fdisplay(log_fd, "W %0d %0d %0d", cycle, reg_addr, reg_wdata);
`ifndef GATE
            if (dut.feat_valid) $fdisplay(log_fd, "T %0d %0d %0d %0d %0d %0d", cycle, dut.feat_ch, dut.feat_energy,
                                          dut.feat_ts, dut.feat_sat, dut.feat_win);
`endif
            if (pred_strobe === 1'b1) n_strobe = n_strobe + 1;
            if (rec_valid === 1'b1 && rec_ready === 1'b1) begin
                if ((^{rec_type, rec_channel, rec_flags, rec_seq, rec_ts, rec_data}) === 1'bx) x_err = x_err + 1;
                $fdisplay(log_fd, "O %0d %0d %0d %0d %0d %0d %0d", cycle, rec_type, rec_channel, rec_flags,
                          rec_seq, rec_ts, rec_data);
                n_out = n_out + 1;
            end
        end
    end

    reg [63:0] stim [0:MAX_STIM-1];
    reg [63:0] w;
    reg [1023:0] stim_file, log_file, vcd_file;
    integer nstim, n, k, seed, wd, gate_drain = 3000;
    reg [31:0] rd;

    task bus_idle;
        begin
            in_valid = 1'b0; reg_wr = 1'b0;
            rng_bus = xorshift32(rng_bus);
            if (idle_hold == 0) begin
                in_channel = rng_bus[CH_W-1:0];
                in_sample  = rng_bus[31:32-SAMPLE_W];
            end
        end
    endtask

    task idle_cycle;
        begin
            bus_idle;
            @(negedge clk);
        end
    endtask

    task reg_write(input [7:0] a, input [31:0] d);
        begin
            in_valid = 1'b0; reg_wr = 1'b1; reg_addr = a; reg_wdata = d;
            @(negedge clk);
            reg_wr = 1'b0;
        end
    endtask

    task reg_read(input [7:0] a);
        begin
            in_valid = 1'b0; reg_wr = 1'b0; reg_addr = a;
            @(posedge clk);
            rd = reg_rdata;
            $fdisplay(log_fd, "D %0d %0d %0d", cycle, a, rd);
            @(negedge clk);
        end
    endtask

    task poll_pred;   // host sequence: read PRED_STATUS; if valid read the words and acknowledge
        begin
            reg_read(8'h30);
            if (rd[0]) begin
                reg_read(8'h31); reg_read(8'h32); reg_read(8'h33);
                reg_write(8'h34, 32'd1);
            end
        end
    endtask

    task drain;   // drain the record FIFO (ready forced), wait for the engine and CRC, read every status word
        begin
            idle_cycle;
            force_ready = 1'b1; rec_ready = 1'b1;
            wd = 0;
`ifdef GATE
            // no hierarchical references into the netlist: wait for the longest possible activity
            // (BIST run + inference + CRC + FIFO drain), then read the registers
            repeat (gate_drain) idle_cycle;
`else
            while ((rec_valid || dut.u_ai.u_engine.busy || dut.u_ai.pend_v || dut.model_busy || dut.bist_running
                    || dut.u_readout.u_records.p_raw_v || dut.u_readout.u_records.p_ft_v
                    || dut.u_readout.u_records.p_ev_v) && wd < 400000) begin
                idle_cycle;
                wd = wd + 1;
            end
            if (wd >= 400000) $display("ERROR: drain did not complete");
`endif
            idle_cycle;
            for (k = 8'h10; k <= 8'h16; k = k + 1) reg_read(k[7:0]);
            for (k = 8'h18; k <= 8'h22; k = k + 1) reg_read(k[7:0]);
            for (k = 8'h24; k <= 8'h2D; k = k + 1) reg_read(k[7:0]);
            reg_read(8'h30); reg_read(8'h3A); reg_read(8'h3C); reg_read(8'h3D); reg_read(8'h3E);
            idle_cycle;
        end
    endtask

    initial begin
        if (!$value$plusargs("stim=%s", stim_file)) begin $display("ERROR: +stim= missing"); $finish; end
        if (!$value$plusargs("log=%s", log_file))   begin $display("ERROR: +log= missing");  $finish; end
        if ($value$plusargs("seed=%d", seed)) begin
            rng_ready = (seed == 0) ? 32'h1234_5678 : seed;
            rng_bus   = rng_ready ^ 32'h5bd1_e995;
        end
        if (!$value$plusargs("gate_drain=%d", gate_drain)) gate_drain = 3000;
        if ($value$plusargs("vcd=%s", vcd_file)) begin
            $dumpfile(vcd_file);
            $dumpvars(0, tb_hbci02_top);
        end
        log_fd = $fopen(log_file, "w");
        for (n = 0; n < MAX_STIM; n = n + 1) stim[n] = {64{1'bx}};
        if ($value$plusargs("n=%d", nstim) && nstim > 0) $readmemh(stim_file, stim, 0, nstim - 1);
        else $readmemh(stim_file, stim);
        nstim = 0;
        while (nstim < MAX_STIM && ^stim[nstim] !== 1'bx) nstim = nstim + 1;
        $fdisplay(log_fd, "# stim=%0s n=%0d NUM_CH=%0d CH_W=%0d SAMPLE_W=%0d TS_W=%0d SEQ_W=%0d FIFO_LOG2=%0d WIN_W=%0d ACC_W=%0d WIN_IDX_W=%0d NH=%0d NO=%0d PRED_LOG2=%0d",
                  stim_file, nstim, NUM_CH, CH_W, SAMPLE_W, TS_W, SEQ_W, FIFO_LOG2, WIN_W, ACC_W, WIN_IDX_W, NH, NO, PRED_LOG2);
        rst_n = 1'b0;
        repeat (3) @(posedge clk);
        @(negedge clk);
        rst_n = 1'b1;
        for (n = 0; n < nstim; n = n + 1) begin
            w = stim[n];
            case (w[63:60])
                4'd0: begin                                   // SAMPLE
                    for (k = 0; k < w[39:32]; k = k + 1) idle_cycle;
                    in_valid = 1'b1; reg_wr = 1'b0;
                    in_channel = w[56 +: CH_W];
                    in_sample  = w[40 +: SAMPLE_W];
                    @(negedge clk);
                    in_valid = 1'b0;
                end
                4'd1: begin                                   // RESET (after a drain)
                    drain;
                    force_ready = 1'b0;
                    rst_n = 1'b0;
                    @(negedge clk);
                    rst_n = 1'b1;
                end
                4'd2: reg_write(w[55:48], w[31:0]);           // REG_WR
                4'd3: for (k = 0; k < w[31:0]; k = k + 1) idle_cycle;   // WAIT
                4'd4: reg_read(w[55:48]);                     // REG_RD
                4'd5: begin drain; force_ready = 1'b0; end    // DRAIN
                4'd6: $fdisplay(log_fd, "N %0d %0d", cycle, w[31:0]);   // MARK
                4'd7: ready_pct = w[31:0];                    // READY_PCT
                4'd8: poll_pred;                              // POLL_PRED
                4'd9: begin                                   // HARD_RESET
                    idle_cycle;
                    rst_n = 1'b0;
                    @(negedge clk);
                    rst_n = 1'b1;
                end
                4'd10: idle_hold = w[31:0];                   // IDLE_HOLD
                default: $display("WARNING: unknown op %0d at word %0d", w[63:60], n);
            endcase
        end
        drain;
        $fdisplay(log_fd, "K? x_on_outputs %0d", x_err);
        $fdisplay(log_fd, "K? records_out_info %0d", n_out);
        $fdisplay(log_fd, "K? strobes_info %0d", n_strobe);
        $fdisplay(log_fd, "END %0d", cycle);
        $fdisplay(log_fd, "DONE");
        $fclose(log_fd);
        $finish;
    end
endmodule

`default_nettype wire
