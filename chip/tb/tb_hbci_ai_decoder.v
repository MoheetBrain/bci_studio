// ============================================================================
// HBCI-02 on-chip AI decoder testbench: file-driven, deterministic.
//
// Drives hbci_ai_decoder from a $readmemh stimulus (64-bit words, format in
// scripts/golden_ai_cycle.py) and logs every input the DUT saw and every
// prediction it emitted, so scripts/check_ai.py can replay the inputs through
// the cycle-accurate Python model and compare.
//
// Plusargs: +stim=FILE +log=FILE [+vcd=FILE] [+n=N] [+seed=N]
// Log lines (cycle = rising edges since time 0; values present at that edge):
//   F cycle ch energy ts sat win en   feature presented (en = cfg_ai_en at that edge)
//   E cycle en                        cfg_ai_en value from this edge on (on change)
//   G cycle mask / S cycle span       cfg_ch_mask / cfg_frame_span from this edge on (on change)
//   K cycle                           feat_sync high at this edge
//   Y cycle ready                     pred_ready value from this edge on (on change)
//   W cycle addr data                 model write at this edge
//   X cycle crc                       MODEL_CRC write at this edge
//   V cycle                           verify pulse at this edge
//   R cycle                           rst_n low at this edge
//   P cycle cls margin ts frame seq flags count   prediction popped at this edge
//   C cycle frames pred incomplete dup late span busy pdrop nomodel satfr wrrej  (after a drain)
//   M cycle valid error busy rejected model_id    (after a drain, or on POLL)
//   L cycle frame_id missing sat ts x h l0 l1 l2 l3   last inferred frame (x, h as 16 hex digits)
//   B cycle addr data                 model word readback (after a drain)
//   M? cycle id                       marker
//   END cycles / DONE
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci_ai_decoder;
    parameter integer NH = 4;
    parameter integer NO = 2;
    parameter integer TS_W = 32;
    parameter integer WIN_IDX_W = 16;
    parameter integer PRED_LOG2 = 2;
    localparam integer MAX_STIM = 1 << 18;

    reg clk = 1'b0, rst_n = 1'b0;
    reg cfg_ai_en = 1'b0, feat_sync = 1'b0;
    reg [7:0] cfg_ch_mask = 8'hFF;
    reg [TS_W-1:0] cfg_frame_span = {TS_W{1'b1}};
    reg feat_valid = 1'b0, feat_sat = 1'b0;
    reg [2:0] feat_ch = 3'd0;
    reg [31:0] feat_energy = 32'd0;
    reg [TS_W-1:0] feat_ts = 0;
    reg [WIN_IDX_W-1:0] feat_win = 0;
    reg model_we = 1'b0, crc_we = 1'b0, model_verify = 1'b0, model_clear_rej = 1'b0;
    reg [5:0] model_addr = 6'd0;
    reg [31:0] model_wdata = 32'd0, crc_wdata = 32'd0;
    wire [31:0] model_rdata, crc_expected;
    wire model_valid, model_error, model_busy, model_rejected;
    wire [15:0] model_id;
    wire [31:0] stat_model_wr_rej;
    wire pred_valid;
    reg  pred_ready = 1'b1;
    wire [1:0] pred_class;
    wire [31:0] pred_margin;
    wire [TS_W-1:0] pred_ts;
    wire [WIN_IDX_W-1:0] pred_frame_id;
    wire [15:0] pred_seq;
    wire [3:0] pred_flags;
    wire [PRED_LOG2:0] pred_count;
    wire pred_strobe;
    wire [1:0] pred_class_direct;
    wire [31:0] stat_frames, stat_pred, stat_incomplete, stat_dup, stat_late, stat_span, stat_busy,
                stat_pred_drop, stat_nomodel, stat_sat_frames;
    wire [WIN_IDX_W-1:0] last_frame_id;
    wire [7:0] last_missing, last_sat;
    wire [63:0] last_x, last_h;
    wire [127:0] last_logit;
    wire [TS_W-1:0] last_ts;

`ifdef GATE
    hbci_ai_decoder dut (
`else
    hbci_ai_decoder #(.NH(NH), .NO(NO), .TS_W(TS_W), .WIN_IDX_W(WIN_IDX_W), .PRED_LOG2(PRED_LOG2)) dut (
`endif
        .clk(clk), .rst_n(rst_n), .cfg_ai_en(cfg_ai_en), .feat_sync(feat_sync),
        .cfg_ch_mask(cfg_ch_mask), .cfg_frame_span(cfg_frame_span),
        .feat_valid(feat_valid), .feat_ch(feat_ch), .feat_energy(feat_energy), .feat_ts(feat_ts),
        .feat_sat(feat_sat), .feat_win(feat_win),
        .model_we(model_we), .model_addr(model_addr), .model_wdata(model_wdata), .model_rdata(model_rdata),
        .crc_we(crc_we), .crc_wdata(crc_wdata), .crc_expected(crc_expected),
        .model_verify(model_verify), .model_clear_rej(model_clear_rej),
        .model_valid(model_valid), .model_error(model_error), .model_busy(model_busy),
        .model_rejected(model_rejected), .model_id(model_id), .stat_model_wr_rej(stat_model_wr_rej),
        .pred_valid(pred_valid), .pred_ready(pred_ready), .pred_class(pred_class), .pred_margin(pred_margin),
        .pred_ts(pred_ts), .pred_frame_id(pred_frame_id), .pred_seq(pred_seq), .pred_flags(pred_flags),
        .pred_count(pred_count), .pred_strobe(pred_strobe), .pred_class_direct(pred_class_direct),
        .stat_frames(stat_frames), .stat_pred(stat_pred), .stat_incomplete(stat_incomplete),
        .stat_dup(stat_dup), .stat_late(stat_late), .stat_span(stat_span), .stat_busy(stat_busy),
        .stat_pred_drop(stat_pred_drop), .stat_nomodel(stat_nomodel), .stat_sat_frames(stat_sat_frames),
        .last_frame_id(last_frame_id), .last_missing(last_missing), .last_sat(last_sat),
        .last_x(last_x), .last_h(last_h), .last_logit(last_logit), .last_ts(last_ts)
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

    reg [31:0] rng_ready = 32'h1234_5678;
    integer log_fd, cycle = 0, ready_pct = 100;
    reg force_ready = 1'b0;
    reg last_ready = 1'bx, last_en = 1'bx;
    reg [7:0] last_mask = 8'bx;
    reg [TS_W-1:0] last_span = {TS_W{1'bx}};
    reg [TS_W-1:0] ts = 0;
    reg [31:0] ts_inc = 32'd1;
    integer x_err = 0, n_pop = 0, n_strobe = 0, strobe_err = 0;

    always @(negedge clk) begin
        rng_ready = xorshift32(rng_ready);
        if (force_ready) pred_ready = 1'b1;
        else             pred_ready = ((rng_ready % 100) < ready_pct);
    end

    always @(posedge clk) begin
        cycle <= cycle + 1;
        if (pred_ready !== last_ready) begin
            $fdisplay(log_fd, "Y %0d %0d", cycle, pred_ready);
            last_ready = pred_ready;
        end
        if (cfg_ai_en !== last_en) begin
            $fdisplay(log_fd, "E %0d %0d", cycle, cfg_ai_en);
            last_en = cfg_ai_en;
        end
        if (cfg_ch_mask !== last_mask) begin
            $fdisplay(log_fd, "G %0d %0d", cycle, cfg_ch_mask);
            last_mask = cfg_ch_mask;
        end
        if (cfg_frame_span !== last_span) begin
            $fdisplay(log_fd, "S %0d %0d", cycle, cfg_frame_span);
            last_span = cfg_frame_span;
        end
        if (!rst_n) begin
            $fdisplay(log_fd, "R %0d", cycle);
            n_strobe = 0;
        end else begin
            if (^pred_valid === 1'bx || ^model_valid === 1'bx) x_err = x_err + 1;
            if (feat_sync) $fdisplay(log_fd, "K %0d", cycle);
            if (feat_valid) $fdisplay(log_fd, "F %0d %0d %0d %0d %0d %0d %0d", cycle, feat_ch, feat_energy, feat_ts,
                                      feat_sat, feat_win, cfg_ai_en);
            if (model_we) $fdisplay(log_fd, "W %0d %0d %0d", cycle, model_addr, model_wdata);
            if (crc_we) $fdisplay(log_fd, "X %0d %0d", cycle, crc_wdata);
            if (model_verify) $fdisplay(log_fd, "V %0d", cycle);
            if (model_clear_rej) $fdisplay(log_fd, "Q %0d", cycle);
            if (pred_strobe === 1'b1) n_strobe = n_strobe + 1;
            if (pred_valid === 1'b1 && pred_ready === 1'b1) begin
                if ((^{pred_class, pred_margin, pred_ts, pred_frame_id, pred_seq, pred_flags}) === 1'bx) x_err = x_err + 1;
                $fdisplay(log_fd, "P %0d %0d %0d %0d %0d %0d %0d %0d", cycle, pred_class, pred_margin, pred_ts,
                          pred_frame_id, pred_seq, pred_flags, pred_count);
                n_pop = n_pop + 1;
            end
        end
    end

    reg [63:0] stim [0:MAX_STIM-1];
    reg [63:0] w;
    reg [1023:0] stim_file, log_file, vcd_file;
    integer nstim, n, k, seed, wd;

    task idle_cycle;
        begin
            feat_valid = 1'b0; model_we = 1'b0; crc_we = 1'b0; model_verify = 1'b0;
            feat_sync = 1'b0; model_clear_rej = 1'b0;
            @(negedge clk);
        end
    endtask

    task log_status;
        begin
            $fdisplay(log_fd, "C %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d", cycle, stat_frames, stat_pred,
                      stat_incomplete, stat_dup, stat_late, stat_span, stat_busy, stat_pred_drop, stat_nomodel,
                      stat_sat_frames, stat_model_wr_rej);
            $fdisplay(log_fd, "M %0d %0d %0d %0d %0d %0d", cycle, model_valid, model_error, model_busy,
                      model_rejected, model_id);
            $fdisplay(log_fd, "L %0d %0d %0d %0d %0d %016x %016x %0d %0d %0d %0d", cycle, last_frame_id, last_missing,
                      last_sat, last_ts, last_x, last_h, last_logit[31:0], last_logit[63:32], last_logit[95:64],
                      last_logit[127:96]);
        end
    endtask

    task drain;   // wait until the engine, the CRC FSM and the FIFO are idle, then log status and readback
        begin
            idle_cycle;
            force_ready = 1'b1; pred_ready = 1'b1;
            wd = 0;
`ifdef GATE
            repeat (600) idle_cycle;     // engine (<= 83 cycles), CRC (184), FIFO drain: no hierarchy in a netlist
`else
            while ((dut.u_engine.busy || dut.pend_v || pred_valid || model_busy) && wd < 100000) begin
                idle_cycle;
                wd = wd + 1;
            end
            if (wd >= 100000) $display("ERROR: drain did not complete");
`endif
            idle_cycle;
            log_status;
            for (k = 0; k < 46; k = k + 1) begin
                model_addr = k;
                #1;
                $fdisplay(log_fd, "B %0d %0d %0d", cycle, k, model_rdata);
            end
            idle_cycle;
        end
    endtask

    initial begin
        if (!$value$plusargs("stim=%s", stim_file)) begin $display("ERROR: +stim= missing"); $finish; end
        if (!$value$plusargs("log=%s", log_file))   begin $display("ERROR: +log= missing");  $finish; end
        if ($value$plusargs("seed=%d", seed)) rng_ready = (seed == 0) ? 32'h1234_5678 : seed;
        if ($value$plusargs("vcd=%s", vcd_file)) begin
            $dumpfile(vcd_file);
            $dumpvars(0, tb_hbci_ai_decoder);
        end
        log_fd = $fopen(log_file, "w");
        for (n = 0; n < MAX_STIM; n = n + 1) stim[n] = {64{1'bx}};
        if ($value$plusargs("n=%d", nstim) && nstim > 0) $readmemh(stim_file, stim, 0, nstim - 1);
        else $readmemh(stim_file, stim);
        nstim = 0;
        while (nstim < MAX_STIM && ^stim[nstim] !== 1'bx) nstim = nstim + 1;
        $fdisplay(log_fd, "# stim=%0s n=%0d NH=%0d NO=%0d TS_W=%0d WIN_IDX_W=%0d PRED_LOG2=%0d", stim_file, nstim,
                  NH, NO, TS_W, WIN_IDX_W, PRED_LOG2);
        rst_n = 1'b0;
        repeat (3) @(posedge clk);
        @(negedge clk);
        rst_n = 1'b1;
        for (n = 0; n < nstim; n = n + 1) begin
            w = stim[n];
            case (w[63:60])
                4'd0: begin                                   // FEAT
                    for (k = 0; k < w[55:48]; k = k + 1) idle_cycle;
                    feat_valid = 1'b1; feat_ch = w[59:57]; feat_sat = w[56];
                    feat_win = w[32 +: WIN_IDX_W]; feat_energy = w[31:0]; feat_ts = ts;
                    @(negedge clk);
                    feat_valid = 1'b0;
                    ts = ts + ts_inc[TS_W-1:0];
                end
                4'd1: begin                                   // RESET
                    drain;
                    force_ready = 1'b0;
                    rst_n = 1'b0;
                    @(negedge clk);
                    rst_n = 1'b1;
                    ts = 0;
                end
                4'd2: begin                                   // CFG
                    case (w[59:56])
                        4'd0: cfg_ai_en = w[0];
                        4'd1: cfg_ch_mask = w[7:0];
                        4'd2: cfg_frame_span = w[TS_W-1:0];
                        4'd3: ready_pct = w[31:0];
                        4'd4: ts_inc = w[31:0];
                        4'd5: begin feat_sync = 1'b1; @(negedge clk); feat_sync = 1'b0; end
                        4'd6: begin model_clear_rej = 1'b1; @(negedge clk); model_clear_rej = 1'b0; end
                        4'd7: ts = w[TS_W-1:0];
                        default: $display("WARNING: unknown cfg %0d", w[59:56]);
                    endcase
                end
                4'd3: for (k = 0; k < w[31:0]; k = k + 1) idle_cycle;   // WAIT
                4'd4: begin                                   // MODEL_WR
                    model_we = 1'b1; model_addr = w[45:40]; model_wdata = w[31:0];
                    @(negedge clk);
                    model_we = 1'b0;
                end
                4'd5: begin crc_we = 1'b1; crc_wdata = w[31:0]; @(negedge clk); crc_we = 1'b0; end
                4'd6: begin model_verify = 1'b1; @(negedge clk); model_verify = 1'b0; end
                4'd7: begin drain; force_ready = 1'b0; end    // DRAIN
                4'd8: $fdisplay(log_fd, "N %0d %0d", cycle, w[31:0]);   // MARK
                4'd9: begin                                   // POLL: model status now
                    $fdisplay(log_fd, "M %0d %0d %0d %0d %0d %0d", cycle, model_valid, model_error, model_busy,
                              model_rejected, model_id);
                    @(negedge clk);
                end
                4'd10: begin                                  // HARD_RESET: no drain
                    idle_cycle;
                    rst_n = 1'b0;
                    @(negedge clk);
                    rst_n = 1'b1;
                    ts = 0;
                end
                default: $display("WARNING: unknown op %0d at word %0d", w[63:60], n);
            endcase
        end
        drain;
        $fdisplay(log_fd, "K? strobe_vs_pred %0d", n_strobe - stat_pred);
        $fdisplay(log_fd, "K? x_on_outputs %0d", x_err);
        $fdisplay(log_fd, "K? pops_info %0d", n_pop);
        $fdisplay(log_fd, "END %0d", cycle);
        $fdisplay(log_fd, "DONE");
        $fclose(log_fd);
        $finish;
    end
endmodule

`default_nettype wire
