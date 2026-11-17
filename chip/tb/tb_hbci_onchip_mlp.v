// Directed smoke test for the synthesizable research MLP.
// Test uses a trivial programmable network: hidden0 = max(0, input0),
// hidden1 = max(0, input1), output0 = hidden0, output1 = hidden1.
// Output class 1 iff energy on ch1 exceeds energy on ch0.
`timescale 1ns/1ps
module tb_hbci_onchip_mlp;
reg clk=0, rst_n=0, enable=0, feat_valid=0, feat_saturated=0;
reg [5:0] feature_shift=0, model_addr=0;
reg [2:0] feat_ch=0;
reg [31:0] feat_energy=0, feat_ts=0;
reg model_we=0;
reg signed [31:0] model_data=0;
wire model_ready, pred_valid, pred_class;
wire signed [31:0] pred_margin;
wire [31:0] pred_ts;
wire [15:0] pred_seq;
wire [31:0] stat_frames, stat_skipped, stat_saturated, stat_pred_drop;
reg pred_ready=1;
hbci_onchip_mlp dut( .clk(clk), .rst_n(rst_n), .enable(enable),
  .feature_shift(feature_shift), .feat_valid(feat_valid),
  .feat_ch(feat_ch), .feat_energy(feat_energy), .feat_ts(feat_ts),
  .feat_saturated(feat_saturated),
  .model_we(model_we), .model_addr(model_addr), .model_data(model_data),
  .model_ready(model_ready), .pred_valid(pred_valid), .pred_ready(pred_ready),
  .pred_class(pred_class), .pred_margin(pred_margin), .pred_ts(pred_ts),
  .pred_seq(pred_seq), .stat_frames(stat_frames), .stat_skipped(stat_skipped),
  .stat_saturated(stat_saturated), .stat_pred_drop(stat_pred_drop));
always #5 clk=~clk;
task write_model(input integer a, input integer d);
begin @(negedge clk); model_addr=a; model_data=d; model_we=1;
      @(negedge clk); model_we=0; end
endtask
task send(input integer channel, input integer energy);
begin @(negedge clk); feat_ch=channel; feat_energy=energy; feat_ts=channel+100;
      feat_valid=1;
      @(negedge clk); feat_valid=0; end
endtask
integer i;
initial begin
 repeat(3) @(negedge clk); rst_n=1;
 for(i=0;i<54;i=i+1) write_model(i,0);
 write_model(0,127); // W1[0,0]
 write_model(9,127); // W1[1,1]
 write_model(36,127); // W2[0,0]
 write_model(41,127); // W2[1,1]
 if (!model_ready) $fatal(1,"model weights incomplete");
 enable=1;
 send(0,10); send(1,100);
 for(i=2;i<8;i=i+1) send(i,0);
 wait(pred_valid);
 if (pred_class !== 1'b1) $fatal(1,"wrong class");
 if (pred_ts !== 32'd107) $fatal(1,"wrong timestamp");
 if (stat_frames !== 1) $fatal(1,"wrong frame count");
 if (stat_pred_drop !== 0) $fatal(1,"unexpected drop");
 $display("PASS: local quantized MLP generated a prediction");
 $finish;
end
initial begin #100000; $fatal(1,"timeout"); end
endmodule
