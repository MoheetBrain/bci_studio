// Experimental HBCI v0.4 integrated DIGITAL top.
// Entire v0.3 readout remains intact; feature windows tap directly into
// hardware MLP before the record FIFO. No electrode/AFE/ADC or implant exists.
`timescale 1ns/1ps
`default_nettype none
module hbci_v04_digital_top (
    input wire clk, rst_n,
    input wire cfg_session_en,
    input wire [1:0] cfg_mode,
    input wire [15:0] cfg_threshold, cfg_hysteresis,
    input wire [7:0] cfg_refractory,
    input wire [3:0] cfg_alpha_shift,
    input wire signed [15:0] cfg_b0, cfg_b1, cfg_b2, cfg_a1, cfg_a2,
    input wire [3:0] cfg_win_log2,
    input wire [5:0] cfg_energy_shift,
    input wire in_valid,
    input wire [2:0] in_channel,
    input wire signed [15:0] in_sample,
    output wire rec_valid,
    input wire rec_ready,
    output wire [1:0] rec_type,
    output wire [2:0] rec_channel,
    output wire [3:0] rec_flags,
    output wire [15:0] rec_seq,
    output wire [31:0] rec_ts, rec_data,
    output wire [31:0] stat_samples, stat_rejected, stat_drop_raw,
    output wire [31:0] stat_drop_event, stat_drop_feature,
    output wire [31:0] stat_event_missed, stat_fifo_hwm,
    // Separate control plane for programmable model weights.
    input wire model_we,
    input wire [5:0] model_addr,
    input wire signed [31:0] model_data,
    input wire [5:0] model_feature_shift,
    output wire model_ready,
    // Local prediction stream, independent of record telemetry.
    output wire pred_valid,
    input wire pred_ready,
    output wire pred_class,
    output wire signed [31:0] pred_margin,
    output wire [31:0] pred_ts,
    output wire [15:0] pred_seq,
    output wire [31:0] ai_frames, ai_skipped, ai_saturated, ai_pred_drop
);
    wire feature_valid, feature_saturated;
    wire [2:0] feature_channel;
    wire [31:0] feature_energy, feature_timestamp;
    hbci_readout_core u_readout(
        .clk(clk), .rst_n(rst_n), .cfg_session_en(cfg_session_en), .cfg_mode(cfg_mode),
        .cfg_threshold(cfg_threshold), .cfg_hysteresis(cfg_hysteresis),
        .cfg_refractory(cfg_refractory), .cfg_alpha_shift(cfg_alpha_shift),
        .cfg_b0(cfg_b0), .cfg_b1(cfg_b1), .cfg_b2(cfg_b2), .cfg_a1(cfg_a1), .cfg_a2(cfg_a2),
        .cfg_win_log2(cfg_win_log2), .cfg_energy_shift(cfg_energy_shift),
        .in_valid(in_valid), .in_channel(in_channel), .in_sample(in_sample),
        .rec_valid(rec_valid), .rec_ready(rec_ready),
        .rec_type(rec_type), .rec_channel(rec_channel),
        .rec_flags(rec_flags), .rec_seq(rec_seq), .rec_ts(rec_ts), .rec_data(rec_data),
        .stat_samples(stat_samples), .stat_rejected(stat_rejected),
        .stat_drop_raw(stat_drop_raw), .stat_drop_event(stat_drop_event),
        .stat_drop_feature(stat_drop_feature), .stat_event_missed(stat_event_missed),
        .stat_fifo_hwm(stat_fifo_hwm),
        .ai_feat_valid(feature_valid), .ai_feat_ch(feature_channel),
        .ai_feat_energy(feature_energy), .ai_feat_ts(feature_timestamp),
        .ai_feat_saturated(feature_saturated)
    );
    hbci_onchip_mlp u_local_ai(
        .clk(clk), .rst_n(rst_n),
        .enable(cfg_session_en && cfg_mode[1]),
        .feature_shift(model_feature_shift),
        .feat_valid(feature_valid), .feat_ch(feature_channel),
        .feat_energy(feature_energy), .feat_ts(feature_timestamp),
        .feat_saturated(feature_saturated),
        .model_we(model_we), .model_addr(model_addr), .model_data(model_data),
        .model_ready(model_ready),
        .pred_valid(pred_valid), .pred_ready(pred_ready),
        .pred_class(pred_class), .pred_margin(pred_margin),
        .pred_ts(pred_ts), .pred_seq(pred_seq),
        .stat_frames(ai_frames), .stat_skipped(ai_skipped),
        .stat_saturated(ai_saturated), .stat_pred_drop(ai_pred_drop)
    );
endmodule
`default_nettype wire
