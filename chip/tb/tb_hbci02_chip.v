// ============================================================================
// HBCI-02 chip-top testbench: drives hbci02_chip_top through its SPI pins from
// the SAME stimulus format as tb/tb_hbci02_top.v (scripts/golden_top.py) and
// writes the SAME log format, so scripts/check_top.py checks the serial
// interfaces against the combined cycle-accurate model:
//   * register writes/reads become SPI transactions (W/D lines come from the
//     internal bus pulse and the bits shifted out on MISO, which must agree)
//   * samples become 24-bit frames on the sample SPI (A lines from the
//     internal in_valid, with the decoded channel/value)
//   * records are deserialised from rec_sdo/rec_sfrm by the testbench (O lines
//     at the cycle the record left the FIFO, which the TB reads from the
//     internal handshake; the deserialised frame must equal it)
// SCLK runs at clk/8. Plusargs as tb_hbci02_top.v.
// ============================================================================
`timescale 1ns/1ps
`default_nettype none

module tb_hbci02_chip;
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
    localparam integer SCLK_DIV = 8;      // clk cycles per SCLK period

    reg clk = 1'b0, rst_n = 1'b0;
    reg spi_sclk = 1'b0, spi_cs_n = 1'b1, spi_mosi = 1'b0;
    wire spi_miso;
    reg smp_sclk = 1'b0, smp_cs_n = 1'b1, smp_mosi = 1'b0;
    wire rec_sdo, rec_sfrm, pred_strobe, pred_irq;
    wire [1:0] pred_class;

    hbci02_chip_top #(
        .NUM_CH(NUM_CH), .CH_W(CH_W), .SAMPLE_W(SAMPLE_W), .TS_W(TS_W), .SEQ_W(SEQ_W), .FIFO_LOG2(FIFO_LOG2),
        .WIN_W(WIN_W), .ACC_W(ACC_W), .WIN_IDX_W(WIN_IDX_W), .NH(NH), .NO(NO), .PRED_LOG2(PRED_LOG2)
    ) dut (
        .clk(clk), .rst_n(rst_n),
        .spi_sclk(spi_sclk), .spi_cs_n(spi_cs_n), .spi_mosi(spi_mosi), .spi_miso(spi_miso),
        .smp_sclk(smp_sclk), .smp_cs_n(smp_cs_n), .smp_mosi(smp_mosi),
        .rec_sdo(rec_sdo), .rec_sfrm(rec_sfrm), .pred_strobe(pred_strobe), .pred_class(pred_class), .pred_irq(pred_irq)
    );
    always #5 clk = ~clk;

    integer log_fd, cycle = 0;
    integer x_err = 0, n_out = 0, ser_err = 0, miso_err = 0, n_rd = 0;
    reg last_ready = 1'bx;
    reg [TS_W-1:0] acc_idx = 0;
    reg [95:0] ser_sh = 96'd0, ser_last = 96'd0;
    integer ser_n = 0;
    reg ser_frm_q = 1'b0;
    reg [95:0] o_queue [0:4095];      // records popped (internal handshake), in order, for the serial check
    integer oq_w = 0, oq_r = 0;
    wire [95:0] o_word = {{(96-2-CH_W-4-SEQ_W-TS_W-32){1'b0}}, dut.rec_type, dut.rec_channel, dut.rec_flags,
                          dut.rec_seq, dut.rec_ts, dut.rec_data};

    always @(posedge clk) begin
        cycle <= cycle + 1;
        if (dut.rec_ready !== last_ready) begin
            $fdisplay(log_fd, "Y %0d %0d", cycle, dut.rec_ready);
            last_ready = dut.rec_ready;
        end
        if (!dut.rst_n_s) begin
            $fdisplay(log_fd, "R %0d", cycle);
            acc_idx = 0; ser_n = 0; oq_w = 0; oq_r = 0;
        end else begin
            if (dut.in_valid) begin
                if ({{(32-CH_W){1'b0}}, dut.in_channel} < NUM_CH) begin
                    $fdisplay(log_fd, "A %0d %0d %0d %0d", acc_idx, cycle, dut.in_channel, dut.in_sample);
                    acc_idx = acc_idx + 1'b1;
                end else $fdisplay(log_fd, "J %0d %0d %0d", cycle, dut.in_channel, dut.in_sample);
            end
            if (dut.reg_wr) $fdisplay(log_fd, "W %0d %0d %0d", cycle, dut.reg_addr, dut.reg_wdata);
            if (dut.u_core.feat_valid) $fdisplay(log_fd, "T %0d %0d %0d %0d %0d %0d", cycle, dut.u_core.feat_ch,
                                                 dut.u_core.feat_energy, dut.u_core.feat_ts, dut.u_core.feat_sat,
                                                 dut.u_core.feat_win);
            if (dut.rec_valid === 1'b1 && dut.rec_ready === 1'b1) begin
                $fdisplay(log_fd, "O %0d %0d %0d %0d %0d %0d %0d", cycle, dut.rec_type, dut.rec_channel, dut.rec_flags,
                          dut.rec_seq, dut.rec_ts, dut.rec_data);
                o_queue[oq_w % 4096] = o_word;
                oq_w = oq_w + 1;
                n_out = n_out + 1;
            end
            // serial record deserialiser: 96 bits while rec_sfrm is high
            if (rec_sfrm) begin
                ser_sh = {ser_sh[94:0], rec_sdo};
                ser_n = ser_n + 1;
                if (ser_n == 96) begin
                    if (oq_r >= oq_w || ser_sh !== o_queue[oq_r % 4096]) ser_err = ser_err + 1;
                    oq_r = oq_r + 1;
                    ser_n = 0;
                end
            end else if (ser_n != 0) begin
                ser_err = ser_err + 1;     // frame shorter than 96 bits
                ser_n = 0;
            end
            if (^rec_sfrm === 1'bx || ^spi_miso === 1'bx) x_err = x_err + 1;
        end
    end

    // ------------------------------------------------------------ SPI masters
    reg [63:0] stim [0:MAX_STIM-1];
    reg [63:0] w;
    reg [1023:0] stim_file, log_file, vcd_file;
    integer nstim, n, k, seed, b, ready_pct = 100, idle_hold = 0;
    reg [31:0] rd, rd_bus;
    reg [39:0] tx;
    reg [23:0] smp_tx;
    reg [31:0] rng = 32'h9e37_79b9;

    task idle_cycle;  begin @(negedge clk); end endtask

    task spi_xfer(input is_wr, input [7:0] addr, input [31:0] data);   // 40-bit transaction
        begin
            tx = {is_wr, addr[6:0], data};
            rd = 32'd0;
            spi_cs_n = 1'b0; spi_sclk = 1'b0;
            repeat (SCLK_DIV) @(negedge clk);
            for (b = 39; b >= 0; b = b - 1) begin
                spi_mosi = tx[b];
                repeat (SCLK_DIV / 2) @(negedge clk);
                spi_sclk = 1'b1;                         // slave samples MOSI
                repeat (SCLK_DIV / 2) @(negedge clk);
                if (!is_wr && b < 32) rd[b] = spi_miso;  // master samples MISO before the falling edge
                spi_sclk = 1'b0;                         // slave shifts MISO
            end
            repeat (SCLK_DIV) @(negedge clk);
            spi_cs_n = 1'b1;
            repeat (SCLK_DIV) @(negedge clk);
        end
    endtask

    task reg_write(input [7:0] a, input [31:0] d);
        begin spi_xfer(1'b1, a, d); end
    endtask

    task reg_read(input [7:0] a);
        begin
            spi_xfer(1'b0, a, 32'd0);
            // the register value the bus delivered when the command byte completed: read it again now
            // through the hierarchy to log the D line at a cycle where the model's state is the same
            // (no register changes between the command byte and the end of the transaction)
            @(posedge clk);
            rd_bus = dut.reg_rdata;
            $fdisplay(log_fd, "D %0d %0d %0d", cycle, a, rd);
            if (rd !== rd_bus && a < 8'h70) miso_err = miso_err + 1;
            n_rd = n_rd + 1;
            @(negedge clk);
        end
    endtask

    task send_sample(input [CH_W-1:0] ch, input [SAMPLE_W-1:0] x);
        begin
            smp_tx = {{(3-CH_W){1'b0}}, ch, 4'b0000, 1'b0, x};
            smp_tx[16] = ^{smp_tx[23:17], smp_tx[15:0]};        // even parity
            smp_cs_n = 1'b0; smp_sclk = 1'b0;
            repeat (SCLK_DIV / 2) @(negedge clk);
            for (b = 23; b >= 0; b = b - 1) begin
                smp_mosi = smp_tx[b];
                repeat (SCLK_DIV / 2) @(negedge clk);
                smp_sclk = 1'b1;
                repeat (SCLK_DIV / 2) @(negedge clk);
                smp_sclk = 1'b0;
            end
            repeat (SCLK_DIV / 2) @(negedge clk);
            smp_cs_n = 1'b1;
            repeat (2) @(negedge clk);
        end
    endtask

    task poll_pred;
        begin
            reg_read(8'h30);
            if (rd[0]) begin
                reg_read(8'h31); reg_read(8'h32); reg_read(8'h33);
                reg_write(8'h34, 32'd1);
            end
        end
    endtask

    task drain;
        begin
            k = 0;
            while ((dut.rec_valid || dut.u_core.u_ai.u_engine.busy || dut.u_core.u_ai.pend_v || dut.u_core.model_busy
                    || dut.u_core.bist_running || dut.u_rec.busy || dut.u_core.u_readout.u_records.p_raw_v
                    || dut.u_core.u_readout.u_records.p_ft_v || dut.u_core.u_readout.u_records.p_ev_v) && k < 400000) begin
                idle_cycle; k = k + 1;
            end
            if (k >= 400000) $display("ERROR: drain did not complete");
            idle_cycle;
            for (k = 8'h10; k <= 8'h16; k = k + 1) reg_read(k[7:0]);
            for (k = 8'h18; k <= 8'h22; k = k + 1) reg_read(k[7:0]);
            for (k = 8'h24; k <= 8'h2D; k = k + 1) reg_read(k[7:0]);
            reg_read(8'h30); reg_read(8'h3A); reg_read(8'h3C); reg_read(8'h3D); reg_read(8'h3E);
            reg_read(8'h70); reg_read(8'h71);
        end
    endtask

    initial begin
        if (!$value$plusargs("stim=%s", stim_file)) begin $display("ERROR: +stim= missing"); $finish; end
        if (!$value$plusargs("log=%s", log_file))   begin $display("ERROR: +log= missing");  $finish; end
        if ($value$plusargs("vcd=%s", vcd_file)) begin $dumpfile(vcd_file); $dumpvars(0, tb_hbci02_chip); end
        log_fd = $fopen(log_file, "w");
        for (n = 0; n < MAX_STIM; n = n + 1) stim[n] = {64{1'bx}};
        if ($value$plusargs("n=%d", nstim) && nstim > 0) $readmemh(stim_file, stim, 0, nstim - 1);
        else $readmemh(stim_file, stim);
        nstim = 0;
        while (nstim < MAX_STIM && ^stim[nstim] !== 1'bx) nstim = nstim + 1;
        $fdisplay(log_fd, "# chip stim=%0s n=%0d NUM_CH=%0d NH=%0d NO=%0d", stim_file, nstim, NUM_CH, NH, NO);
        rst_n = 1'b0;
        repeat (3) @(posedge clk);
        @(negedge clk);
        rst_n = 1'b1;
        repeat (4) @(negedge clk);
        for (n = 0; n < nstim; n = n + 1) begin
            w = stim[n];
            case (w[63:60])
                4'd0: begin
                    for (k = 0; k < w[39:32]; k = k + 1) idle_cycle;
                    send_sample(w[56 +: CH_W], w[40 +: SAMPLE_W]);
                end
                4'd1: begin drain; rst_n = 1'b0; @(negedge clk); rst_n = 1'b1; repeat (4) @(negedge clk); end
                4'd2: reg_write(w[55:48], w[31:0]);
                4'd3: for (k = 0; k < w[31:0]; k = k + 1) idle_cycle;
                4'd4: reg_read(w[55:48]);
                4'd5: drain;
                4'd6: $fdisplay(log_fd, "N %0d %0d", cycle, w[31:0]);
                4'd7: ready_pct = w[31:0];                     // no external back-pressure on the serial link
                4'd8: poll_pred;
                4'd9: begin idle_cycle; rst_n = 1'b0; @(negedge clk); rst_n = 1'b1; repeat (4) @(negedge clk); end
                4'd10: idle_hold = w[31:0];
                default: $display("WARNING: unknown op %0d at word %0d", w[63:60], n);
            endcase
        end
        drain;
        $fdisplay(log_fd, "K? x_on_outputs %0d", x_err);
        $fdisplay(log_fd, "K? serial_records_vs_fifo %0d", ser_err);
        $fdisplay(log_fd, "K? serial_records_pending %0d", oq_w - oq_r);
        $fdisplay(log_fd, "K? miso_vs_bus %0d", miso_err);
        $fdisplay(log_fd, "K? records_out_info %0d", n_out);
        $fdisplay(log_fd, "K? reads_info %0d", n_rd);
        $fdisplay(log_fd, "END %0d", cycle);
        $fdisplay(log_fd, "DONE");
        $fclose(log_fd);
        $finish;
    end
endmodule

`default_nettype wire
