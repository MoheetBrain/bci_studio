# HBCI v0.4 — On-chip AI (research implementation)

## What is implemented
- Synthesizable Verilog-2005 module: `rtl/hbci_onchip_mlp.v`.
- A quantized **8 → 4 → 2** neural network with programmable signed int8 weights, signed int32 biases, ReLU hidden layer, 8 signed int8 features, sequential multiply-accumulate logic, and one held class/margin output.
- Intended input: the **eight FEATURE window-energy values** already produced in the v0.3 DSP, after configurable right shift, clamp to signed int8 and signed centre adjustment.
- 54 writable registers: 32 first-layer weights + 4 first-layer biases + 8 second-layer weights + 2 second-layer biases + 8 feature centres. All must be provisioned before `model_ready` becomes true.
- A timestamped feature-frame collector and output `pred_valid/pred_ready` handshake. Saturated feature windows invalidate incomplete frames, duplicate channel entries restart a frame, and output drops are counted.
- Prediction is local hardware inference. **Weights are loaded from outside the inference block**; no training algorithm lives on chip.

## What is NOT implemented / NOT claimed
- The experimental integrated top `rtl/hbci_v04_digital_top.v` connects the decoder to the existing `hbci_readout_core` using new explicit `ai_feat_*` outputs tapped BEFORE the record FIFO. This connection is coded but **not yet simulated, synthesised, or physically verified**. It must be validated independently.
- No verified model accuracy on neural data, no training/evaluation pipeline, no real pretrained weights, no multi-session or cross-subject results.
- No SKY130 mapping / place-and-route / energy estimate for this AI module. No measured silicon.
- No neural electrodes, AFE, ADC, medical stimulation or biohybrid neural interface.
- No LLM, semantic thought decoder, or demonstration of human–AI symbiosis.

## Precise arithmetic
For channels `c=0..7`, `x[c] = clamp_int8((energy[c] >> feature_shift) - centre[c])`. Frame completes on observing one fresh record for every channel. Then:
```text
hidden[h] = clamp_0_127((bias1[h] + Σ_c weight1[h,c] * x[c]) >>> 7)
logit[o] = bias2[o] + Σ_h weight2[o,h] * hidden[h]
class = 1 if logit1 > logit0 else 0
margin = saturate_int32(logit1 - logit0)
```
Model registers are changed only with `enable=0`. An 8x4 layer and 4x2 layer use 40 multiply-accumulate operations per prediction, implemented sequentially to share arithmetic. Predictions are meaningful only when weights are trained on genuine labelled neural data.

## Interface and verification
Testbench: `tb/tb_hbci_onchip_mlp.v`.
Suggested commands using Icarus Verilog:
```bash
iverilog -g2005 -s tb_hbci_onchip_mlp -o /tmp/hbci_ai.vvp \
  rtl/hbci_onchip_mlp.v tb/tb_hbci_onchip_mlp.v
vvp /tmp/hbci_ai.vvp
verilator --lint-only -Wall --top-module hbci_onchip_mlp rtl/hbci_onchip_mlp.v
```
These commands have **not been executed or passed here**. The current execution environment has no installed Verilog simulator. The directed test checks model programming, completion, simple classification, frame timestamp and drop counter.

## Next decisive milestones (in order)
1. Run Icarus and Verilator on **both** standalone decoder and integrated top; correct any lint or simulation failures. Expand to randomized directed tests and compare every prediction against a bit-exact Python model.
2. **Train** the 8→4→2 model on real labelled neural FEATURE data with proper train/test separation, frozen calibration parameters, held-out evaluation and permutation controls. Do not make accuracy claims until measured.
3. Validate integrated feature tap end-to-end. Define a **shared frame identifier** and synchronized feature windows; the current frame collector merely accepts the next one-per-channel feature record and does not prove those windows are time-aligned. Check missing-record handling and gate predictions by explicit session consent.
4. Add synthesis and SKY130 place-and-route, post-route equivalence/STA and realistic activity-based power estimates. Compare to v0.3 with and without the AI.
5. Keep a raw/feature diagnostic pathway and ensure no loss of essential information for future neural decoders.
6. After independent engineering review, proceed to a packaged bench test. Not for biological or human connection.

## Architectural decision
The long-term system can have local neural inference **and** a larger external reasoning model. Local inference is not intrinsically better for all tasks: the right balance depends on implant power, latency, model size, data privacy, heat and decoder accuracy.
