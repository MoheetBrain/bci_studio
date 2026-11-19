# HBCI-02 gap register

Unresolved engineering issues, their severity for the next milestone (an electrically testable digital ASIC
candidate), and the next evidence each one needs. Updated 2026-10-26 (commit noted per row when it changes).
Severity: **H** blocks fabrication or the main claim; **M** limits performance or confidence; **L** cosmetic or
future work.

| # | Gap | Sev | Status | Next evidence needed |
|---|---|---|---|---|
| G1 | **Physical design of the HBCI-02 top** | — | **closed at 10 MHz** (`docs/PHYSICAL.md`): setup/hold met at 9 corners, DRC/LVS/antenna 0, 1.10 mm² die, 4.9 mW estimate | a 20–40 MHz result needs the biquad pipeline (G20) |
| G20 | **Clock limited to 10 MHz by the single-cycle DSP biquad** (v0.3 core fails 20 MHz by 21.7 ns at ss) | M | measured; fix identified (`docs/DSP_OPTIMISATION.md` §1) | pipeline the biquad and energy square, update golden_v03 and re-run `make v03 v04 layout-v04` |
| G2 | **Padframe and ESD**: the layout is core-only; no I/O ring, no pad cells, no bond diagram | H | proposal only (`docs/TEST_PLAN.md` §1) | a padframe-included flow run (sky130_fd_io cells or a Caravel-style harness) with DRC/LVS |
| G3 | **Trained-model accuracy on real data** | — | **closed** (`docs/ML_EVALUATION.md`): Model A (quantised linear) 74.3 % per frame [71.4, 77.0], 98.0 % per epoch, null 54.4 / 61.3 % (p = 0.005); RTL run on 200,000 recorded samples equals the pipeline on 1,560 energies and 195 predictions | remaining: single subject/session; channel selection needs a supervised calibration recording (label-free selection is near chance); cross-session stability untested |
| G4 | **RTL vs SKY130 netlist equivalence**: the generic Yosys netlist is simulated cycle-exact, the SKY130-mapped and routed netlists are not | M | open | gate-level simulation of the routed netlist (`final/nl/*.v` + sky130 cell models) on the BIST profile, or a Yosys/eqy equivalence check |
| G5 | **Power with real activity**: 4.9 mW (flow default) vs 6.5 mW (uniform 0.1 activity) at nom_tt; the v0.3 stand-alone default figure (494 mW) is an artefact | M | open | VCD/SAIF-driven power from the BIST or recorded-stream simulation of the routed netlist |
| G6 | **Slow-corner slew and fanout warnings**: 10,666 max-slew and 138 max-fanout violations on the HBCI-02 run (setup still met) | M | open, reviewed | tighter slew repair after the biquad pipeline (the 60 % repair setting ran out of memory on the VM in the v0.2 study) |
| G7 | **No scan/ATPG**: stuck-at coverage relies on BIST and functional tests | M | accepted for a research MPW | if a commercial test flow is required: scan insertion (not available in the open flow) |
| G8 | **Reset release**: `rst_n` is constrained as a synchronous-release input; no on-chip reset synchroniser | M | open | add a 2-flop reset synchroniser in the chip top (cheap) before the padframe run |
| G9 | **Prediction FIFO depth 4** and 1-deep pending frame: bursts beyond that are dropped (counted, flagged) | L | by design | bench measurement of drop counters at the intended polling rate |
| G10 | **Inference throughput**: one frame per NH·8 + NO·N2 + 2 cycles; with win_log2 = 0 at full rate frames arrive every 8 cycles and most are dropped | L | documented | none needed unless sub-window frames are wanted; a second multiplier would halve the latency |
| G11 | **Decoder area** (10,707 cells, 2,387 flops): 14 32-bit counters and the 4-deep 118-bit FIFO are ~40 % of its flops | L | open | reduce counters to 16 bits and the FIFO to 2 entries if area matters after layout |
| G12 | **Feature richness**: one band-energy feature per channel; the tap carries energy only | L | by design (v0.3); E02 shows host RAW features on the same 8 channels give 97.1 % per epoch vs 98–99 % for the chip features, so nothing this task needs is discarded | a second band only if a harder task demands it |
| G19 | **Dead or corrupted channels**: a channel with zero energy quantises to −128 and ruins the prediction (E02: 50–71 % epoch accuracy) | M | documented rule: mask it with `cfg_ch_mask` (costs 1–3 points) | bench procedure to detect dead channels from FEATURE records before enabling inference |
| G13 | **Analogue front end / ADC**: none on the die | H for the long-term system, not for this chip | external for the first chip (`docs/AFE_ADC_DECISION.md`) | a mixed-signal feasibility study needs device models and an analogue designer |
| G14 | **Fabrication route**: no shuttle selected, no quotes confirmed, no padframe | H | `docs/FABRICATION_READINESS.md` | a confirmed shuttle with its padframe rules and a dry-run submission check |
| G15 | **Test PCB**: proposal only; KiCad not installed | M | `docs/TEST_PLAN.md` §4 | schematic + layout once the package is chosen |
| G16 | **Formal coverage**: decoder only, reduced configuration, constant mask | L | documented | properties on the top (register timing) and on the DSP record path |
| G17 | **Studio**: the microscope and die views show the v0.3 blocks; the AI block and v0.4 pipeline views are being added | L | in progress | `npm run typecheck`, `build`, `check:v03`, `check:model` passing with the new views |
| G18 | **Biological validation**: none; the chip is a bench device | — | out of scope by design | separate programme |
