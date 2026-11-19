# HBCI-02 initial technical audit

Date: 2026-10-26. Branch: `claude/clever-keller-507b3e` (worktree
`.claude/worktrees/clever-keller-507b3e`), created from local `main` at `1448535` and merged with
`origin/feature/hbci-v04-onchip-ai` at `b1132fa` (merge commit `bc67ed6`). This is the audit the HBCI-02
mandate (section 2) requires before any change. Everything below was checked in this session unless marked
"reported" (taken from the repository's own documents).

## 1. Repository state (checked 2026-10-26)

| Item | Finding |
|---|---|
| Working trees | Main checkout `/Users/moheet/Hamiltonian-BCI-Chip` on `main` at `1448535`, clean, no untracked files. Worktree `epic-goodall-c1826a` on `feature/semiconductor-microscope` at `1448535`, clean. This worktree, clean at start |
| Local branches | `main` (1448535), `feature/semiconductor-microscope` (1448535, identical to main: fast-forward merged 2026-10-23), `claude/epic-goodall-c1826a`, this branch |
| Remote branches | `origin/main` at `c9bb8e7` (**local main is one commit ahead and unpushed**: the semiconductor-microscope work), `origin/feature/hbci-v04-onchip-ai` at `b1132fa` (7 commits on top of `c9bb8e7`; exists only on origin) |
| Tags | `v0.1-baseline`, `v0.2`, `v0.3` |
| Unpushed work | Commit `1448535` (studio microscope, 78 files, +7,940 lines, no RTL change: `git diff c9bb8e7 1448535 -- rtl/ scripts/golden* experiments/` is empty). It is safe on `main` and in two worktrees. **Not pushed**; pushing is the user's decision |
| `main` vs `feature/hbci-v04-onchip-ai` | Merge base `c9bb8e7`. The v0.4 branch adds 6 files (`rtl/hbci_onchip_mlp.v`, `rtl/hbci_v04_digital_top.v`, `tb/tb_hbci_onchip_mlp.v`, `docs/V04_ONCHIP_AI.md`, `.github/workflows/hbci-ai.yml`) and 13 lines in `rtl/hbci_readout_core.v` (the `ai_feat_*` tap). `main` since the merge base changes only `studio/`, docs and scripts. **No overlapping files**, so the merge is conflict-free and loses nothing |
| CI | GitHub Actions run 40409329373 on the v0.4 branch: `completed success` (2026-10-26). It runs the smoke testbench, Verilator lint **with `-Wno-fatal` and without `-Wall`**, and a Yosys `proc; opt; check` elaboration. It is not a verification result |

Newest complete versions, by component:

| Component | Newest version | Where |
|---|---|---|
| Neural readout processor | v0.3 `hbci_readout_core` (+ unchanged v0.2 `hbci_event_core`) | `rtl/`, tag `v0.3`, `main` |
| On-chip AI | experimental `hbci_onchip_mlp` + `hbci_v04_digital_top` | `origin/feature/hbci-v04-onchip-ai`, now merged here |
| Studio | microscope build (`1448535`) | `main` (unpushed) |
| Physical-design flow | LibreLane 3.0.16 Classic flow for `hbci_event_core` only | `physical/`, `main` |
| Tests | 17 suites / 348 checks for v0.2 + v0.3 (`make test`), one smoke test for v0.4 | `tb/`, `scripts/`, `Makefile` |

## 2. What exists, what is simulated, what is laid out

| Block | Exists as | Simulated | Synthesised | Laid out | Measured |
|---|---|---|---|---|---|
| `hbci_event_core` (v0.2 comparator) | RTL, unchanged since v0.2 | yes: directed, random vs golden, gate level, mutation, v0.1 equivalence | generic + SKY130 mapping | **yes**: LibreLane on SKY130 HD, 40 MHz, 9 corners, DRC/LVS/antenna clean, 0.063 mm² die (`docs/PHYSICAL.md`) | no |
| `hbci_readout_core` (v0.3 RAW/EVENT/FEATURE/HYBRID) | RTL | yes: 11 suites vs a cycle-accurate golden model, gate level, 10/10 mutants killed (`make v03`, reproduced 2026-10-23) | generic (18,932 cells) + SKY130 mapping (18,577 cells, 174,484 µm² cell area) | **no** (never attempted) | no |
| `hbci_onchip_mlp` (v0.4 8→4→2 MLP) | RTL | one directed smoke test (identity network, one frame) | generic only, this session: **6,069 cells, 1,206 flops** (`synth -booth`) | no | no |
| `hbci_v04_digital_top` | RTL | **never simulated** | generic, this session: 25,002 cells total | no | no |
| Register / serial interface, padframe, DFT | nothing | | | | |
| Analogue front end, ADC, electrodes, power, telemetry | nothing (CONCEPT in the studio) | | | | |

Tool status on this machine: Icarus 14.0, Verilator 5.053, Yosys 0.70 (OSS CAD Suite, also SymbiYosys/sby,
eqy, mcy, z3, yices, boolector, bitwuzla), Python 3.9 with numpy 1.26 and h5py 3.11 (no scipy, torch or
scikit-learn), Node 24. The EDA VM `hbci-eda` (Lima 2.2.1, LibreLane 3.0.16, sky130A) is present and
**stopped**. The DANDI 000019 session EC9_B15 data are cached locally (`~/.local/data/dandi-000019/`: the
60-channel NPZ used by E01 and the 19 MB NWB header file). No KiCad on this machine.

## 3. Line-by-line audit of the v0.4 on-chip AI (`rtl/hbci_onchip_mlp.v`, `rtl/hbci_v04_digital_top.v`)

Reproduced this session: `iverilog -g2005 -Wall` + `vvp` on `tb/tb_hbci_onchip_mlp.v` prints
`PASS: local quantized MLP generated a prediction`; `verilator --lint-only -Wall` reports **12 warnings**
(8 WIDTHEXPAND, 4 WIDTHTRUNC); the repository's own flows require 0.

| # | Area | Finding | Severity |
|---|---|---|---|
| A1 | Frame alignment | The collector accepts "the next feature of each channel" (`seen` bitmask). There is no frame identifier: a channel that lost samples (its window index lags) is silently combined with the other channels' later windows. The mandate's Phase B requirement is unmet | **High** |
| A2 | Model integrity | `model_ready = &written`, a sticky bitmask of addresses ever written since reset. No CRC, no version, no readback. A later partial or corrupted update still reports ready; nothing prevents predictions with a wrong model | **High** |
| A3 | Input quantisation | `x = clamp_int8((energy >> feature_shift) - centre[ch])`: one global shift, 256-wide linear window per channel. Band energy is heavy-tailed; a linear 8-bit window after a global shift wastes most of the range and makes the model sensitive to gain. No per-channel scale | High (accuracy) |
| A4 | Fixed-point | Hidden activation uses a hard-coded `>>> 7`; the quantiser must fold every scale into int8 weights under that constraint. Biases are 32-bit but their scale is implicit | Medium |
| A5 | Saturated features | `feat_saturated` clears the whole partial frame (`seen <= 0`) and does not store the feature: a persistently saturating channel blocks **all** predictions | Medium |
| A6 | Enable gating | `enable = cfg_session_en && cfg_mode[1]`: no inference in RAW or EVENT mode, and the feature tap `ai_feat_valid = feat_gen` is also mode-gated. A bench known-answer test with RAW output is impossible; disabling mid-inference aborts silently | Medium |
| A7 | Throughput | One inference takes 41 cycles (32 + 8 MACs + 1); a frame completing while busy is counted in `stat_skipped`. With `win_log2 = 0` at full input rate frames arrive every 8 cycles, so most are skipped. Undocumented | Low (document) |
| A8 | Output backpressure | 1-deep `pred_*` register; a new prediction while `pred_valid && !pred_ready` is dropped and counted, but the next prediction carries no gap flag | Low |
| A9 | Model writes while enabled | Silently ignored, no error flag | Low |
| A10 | Lint / widths | WIDTHEXPAND on signed sub/add (functionally correct under Verilog signed rules, but unverified); WIDTHTRUNC on `model_addr - 6'd32` used as a 2-bit index (correct because of the range check, but implicit). `feat_ts` is fixed at 32 bits while the readout core's `TS_W` is a parameter | Low |
| A11 | Arithmetic | 8×8 signed products (16 bit), 40-bit accumulator (no overflow possible: 8 × 2^14 + 2^31 < 2^39), ReLU clamp 0..127, 41-bit margin saturated to 32 bits, `class = logit1 > logit0` (tie → 0). **Correct** as written | OK |
| A12 | Reset | Every register including the parameter arrays is reset; model must be reloaded after reset. Correct, but 640 parameter flops with async reset | OK (cost) |
| A13 | Verification | One directed case with an identity network; no reference model, no random tests, no reset-during-load, no backpressure, no integrated-top simulation (the top was never simulated at all) | **High** |
| A14 | Interface | 54 parallel model registers and ~150 configuration input bits as top-level ports; no serial or memory-mapped interface, no padframe, no DFT. Not testable as silicon | **High** (section 10) |

Conclusion: the v0.4 MLP arithmetic is sound, but the block is not a usable decoder: it has no frame
semantics, no model integrity, a poor quantiser, and no verification. Section 5 of the mandate is therefore
implemented from this starting point rather than by patching.

## 4. What is unverified or missing (project level)

| Gap | Status |
|---|---|
| Trained decoder | None. The MLP has never been trained; no training/quantise/export pipeline; no bit-exact software reference |
| Real-data benchmark for the chip model | E01 (DANDI 000019, 60 channels, one session) compared representations with an **offline host LDA**. No 8-channel subset, no on-chip model, no chronological split |
| v0.3 DSP in silicon | SKY130 technology mapping only (18,577 cells). No floorplan, timing, power or critical path for v0.3 |
| v0.4 top | Never simulated; generic synthesis only |
| Record-output bandwidth | 89-bit records per sample (RAW 16.3 Mbit/s for 60 ch at 3 kS/s): no block packaging |
| FIFO / backpressure | v0.3 handles overflow with drops, counters, seq and gap flags (verified). The AI tap sits before the FIFO (good), but the AI block's own frame drop policy is not verified |
| Timing | Only the v0.2 core has a timing result (40 MHz met, 50 MHz not met at ss). Nothing for v0.3/v0.4 |
| Equivalence RTL ↔ SKY130 netlist | Not done for any SKY130 netlist (generic gate-level sim only) |
| Physical sign-off gaps (v0.2) | 89 slew violations at ss corners, 13 CTS fanout violations, no padframe, no IR-drop pads, power with default activity |
| Testability | No register interface, no serial I/O, no BIST, no pin list, no PCB |
| AFE/ADC decision, biohybrid boundaries, fabrication route | Not documented |

## 5. Protection measures applied
- No reset, rebase or history rewrite. `main` and the two existing worktrees are untouched.
- All work happens on this branch in this worktree. Nothing is pushed or merged into `main` without the user.
- The v0.4 branch was merged with `--no-ff` so its 7 commits remain intact.

## 6. Order of work (from the mandate)
1. Section 5: redesign the AI block (frame protocol, quantiser, programmable fixed point, CRC-checked model
   load, flow control) with a bit-exact Python reference and randomised equivalence tests.
2. Section 6: reproduce E01, select an 8-channel subset without leakage, train/quantise/export, compare models.
3. Section 7–8: DSP improvements and the integrated verification programme.
4. Section 9–10: register/serial interface and padframe proposal; LibreLane on the v0.3 core and the full
   HBCI-02 top; BIST.
5. Section 11–15: decisions, docs, studio.
