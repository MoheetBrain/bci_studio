# HBCI-02 final report (mandate section 18)

Branch `claude/clever-keller-507b3e` (worktree `.claude/worktrees/clever-keller-507b3e`), 2026-10-27. Nothing
was pushed or merged into `main`; nothing was ordered, submitted or spent. Labels: CONCEPT / RTL / SYNTH /
LAYOUT / MEASURED (nothing is MEASURED). Sections marked ⟨pending⟩ are filled in from the subagent results
(`docs/ML_EVALUATION.md`, `docs/PHYSICAL.md`, `docs/UI_V04_STATUS.md`) when they land.

## A. What was built

1. **A real on-chip decoder** (`rtl/hbci_ai_decoder.v`, spec `docs/AI_DECODER.md`), replacing the experimental v0.4
   MLP after a line-by-line audit (`docs/HBCI02_AUDIT.md`, 14 findings): log-domain feature quantiser
   (64·log2(E), per-channel centre/shift, int8); a frame protocol that only combines features carrying the same
   per-channel window index (missing, duplicate, late and over-span features counted, never mixed; `feat_sync`
   recovery); a 46-word parameter block verified by CRC-32 on chip (no prediction without a verified model; writes
   while enabled rejected and counted; full readback); an 8→NH→NO MLP (ReLU, programmable shift) or an 8→NO linear
   model selectable at run time on the same silicon, one time-shared 8×8 multiplier, 34-bit accumulator, argmax
   and margin; a 4-deep prediction FIFO with sequence numbers and gap/saturation flags; diagnostics of the last
   frame (x, h, logits). Latency NH·8 + NO·N2 + 2 cycles from start (NH = 4, NO = 2: 42).
2. **DSP changes** (`rtl/hbci_readout_core.v`): per-channel 16-bit window index, `feat_sync`, feature tap before
   the record FIFO and not gated by the output mode. Record behaviour unchanged (all v0.3 suites pass).
3. **Integrated digital top** (`rtl/hbci02_digital_top.v`): register file (8-bit address, 32-bit data: config,
   model region, counters, diagnostics, prediction FIFO) and a built-in self-test (LFSR source + MISR over every
   record and prediction, deterministic from reset).
4. **Chip top** (`rtl/hbci02_chip_top.v`): SPI register bus (40-bit transactions), SPI sample stream (24-bit
   frames with parity), serial record output (96-bit frames), direct prediction pins, reset synchroniser: 15
   signal pins + power. Pin list and padframe proposal in `docs/TEST_PLAN.md`.
5. **Training → quantise → export → RTL pipeline**: `scripts/golden_ai.py` (bit-exact reference),
   `experiments/E02_onchip_decoder/run_e02.py` (numpy training, in-fold channel selection and calibration,
   post-training quantisation, export of 46-word blocks + CRC, held-out vectors and recorded streams), and
   `make top-stream` (the recorded stream through the RTL against the pipeline's expectation).
6. **Verification infrastructure**: cycle-accurate models of the decoder and of the whole top, seeded stimulus
   generators (model, protocol, stress, e2e, BIST, adverse, stream), checkers, mutation control, SymbiYosys
   properties, gate-level runs, the studio trace generator; `make v04`.
7. **Documents**: architecture, decoder spec, verification record, DSP measurements, test plan, gap register,
   fabrication readiness, AFE/ADC decision, biohybrid interfaces.

## B. What works (independently verified; commands in `docs/VERIFICATION.md`)
- RTL: 26 runs / 200 checks / 0 errors across the decoder (5 configurations), the integrated top (4), the chip
  top (3): every prediction cycle-exact against the bit-exact reference, every record, feature-tap event and
  register read cycle-exact against the combined model; BIST signatures reproducible from reset.
- Negative control: 13/13 deliberately broken decoders caught. Formal: 8 property groups proven by k-induction.
- Gate level: the Yosys netlists of the decoder and of the integrated top match the models.
- Lint: 0 warnings in 12 configurations. v0.1/v0.2/v0.3 suites unchanged and passing.
- Synthesis (SYNTH): `hbci02_digital_top` 32,187 SKY130 HD cells, 6,042 flops, 316,574 µm² cell area.
- DSP measurements: Q2.14 filter within 0.006 dB of the double-precision design, pole-radius margin 0.079 at
  3,051.76 S/s; 2.6 codes rms rounding error on real ECoG (`docs/DSP_OPTIMISATION.md`).
- Real-data decoder (`docs/ML_EVALUATION.md`, DANDI 000019 EC9_B15, overt speech vs silence, 5 chronological
  blocks, 85 epochs / 1,105 frames, everything label-dependent fitted inside each fold): quantised linear
  Model A 74.3 % balanced accuracy per 42 ms frame [71.4, 77.0] and 98.0 % per epoch [95.1, 100] against a
  permutation null of 54.4 / 61.3 % (p = 0.005); MLPs (NH = 4/6/8) are not better; quantisation costs nothing
  (float 74.2 %). The exported model through the Verilog on 200,000 recorded samples: 1,560 DSP energies and
  195 predictions identical to the pipeline's independent numpy expectation.
- Physical design (LAYOUT, `docs/PHYSICAL.md`): `hbci02_chip_top` placed and routed on SKY130 HD at 10 MHz,
  setup and hold met at all 9 corners (worst +6.35 ns), DRC/LVS/antenna 0/0/0, die 1.04 × 1.05 mm (1.10 mm²),
  61,973 cells, 52.8 % utilisation; power estimate 4.9–6.5 mW at nom_tt. Open: 10,666 slew warnings at the
  slow corner; 11 MHz fails by 2.87 ns and the v0.3 core fails 20 MHz by 21.7 ns on the same single-cycle
  biquad → energy → quantiser chain (155 stages, 97.8 ns at max_ss).

## C. What does not work / is not done
- The layout is core-only (no padframe/ESD ring), the routed netlist is not simulated, slew/fanout warnings
  are open, the clock is 10 MHz (the DSP's single-cycle biquad; pipelining it is the identified fix), power is
  an estimate with default activity, no scan.
- Decoder accuracy is from one subject and one session of overt speech; label-free channel selection is near
  chance, so a per-user supervised calibration recording is required; vowel identity (3 classes) is weak
  (61.7 % per epoch, p = 0.01); cross-session and cross-subject generalisation are untested.
- Analogue front end and ADC are external (`docs/AFE_ADC_DECISION.md`); no biological validation; not an
  implant.
- Fabrication: no shuttle selected, no quote confirmed (`docs/FABRICATION_READINESS.md`); nothing may be ordered
  without the owner's approval.
- Studio: ⟨pending UI_V04_STATUS⟩.

## D. Engineering performance (labelled)
| Quantity | Value | Label |
|---|---|---|
| Neural decoding accuracy (speech vs silence, one subject, one session) | 74.3 % per frame, 98.0 % per epoch; null 54.4 / 61.3 % | held-out software; RTL identical on the recorded stream |
| Model parameters | ≤ 64 + 16 int8 weights + 12 int32 biases + 8 centres/shifts (46 words, 184 bytes) | RTL |
| Inference operations | NH·8 + NO·N2 MACs (NH = 4, NO = 2: 40) | RTL |
| Inference latency | NH·8 + NO·N2 + 2 cycles (42) + 2 from frame completion | RTL (cycle model) |
| Max sustainable input | one sample per clock into the DSP; one frame per 42 cycles into the decoder | RTL |
| Hardware area | 561,654 µm² standard cells; die 1.04 × 1.05 mm = 1.10 mm² (core only) | LAYOUT |
| Clock | 10 MHz met at 9 corners (+6.35 ns worst); 20 MHz not met (DSP biquad) | LAYOUT |
| Power, energy per inference | 4.9 mW (flow default activity) / 6.5 mW (uniform 0.1 activity) at nom_tt; ≤ 27 nJ per MLP inference, ≤ 12 nJ per linear inference (whole chip × cycles) | ESTIMATE |
| Input bandwidth | 24 bits per sample over SPI; 8 × 30 kS/s = 5.76 Mbit/s | RTL |
| Output bandwidth | 96 bits per record; 416 k records/s at 40 MHz | RTL |
| Model memory | 46 × 32-bit words (flops) | RTL / SYNTH |

## E. Silicon readiness
Level **5 — physically placed and routed** (core-only layout, open-source DRC/LVS/antenna clean, timing met at
10 MHz). Level 6 (physically verified with outstanding foundry dependencies) is **not** claimed: the padframe,
the routed-netlist simulation, the slew/fanout warnings and IR drop with pads are open. Levels 7–8 not reached.

## F. Next funding-relevant milestone
The smallest decisive step is a **padframe-included, DRC/LVS-clean layout of `hbci02_chip_top` with the
biquad pipelined to close at ≥ 20 MHz and the routed netlist simulated on the BIST profile**, submitted to a dry-run
check of one shuttle. That removes the three objections an independent reviewer would raise first (no pads, no
routed-netlist proof, slow-corner slews). It needs no money: it is two to three weeks of engineering on the
existing flow. The first spend after that is the shuttle slot and a test PCB: `docs/FABRICATION_READINESS.md`
prices the routes (ChipFoundry chipIgnite about $15k for 100 packaged parts; Tiny Tapeout about €70 per tile
plus a dev kit, area-marginal at ~0.6 mm² per 8×4 tiles for a 1.1 mm² core; IHP SG13G2 at 2,800 €/mm² needs a
PDK port). A pre-seed or prototyping grant of roughly $25–40k would cover one chipIgnite run, packaging, a test
PCB, bench instruments and the bring-up time, and would test exactly: the BIST known-answer signatures and the
recorded-ECoG predictions on real silicon against the RTL expectation, power and maximum clock.
