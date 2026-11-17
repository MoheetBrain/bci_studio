# UI v0.4 status — the studio around the HBCI-02 on-chip AI decoder (studio only)

Updated: 2026-10-27, branch `claude/clever-keller-507b3e` (worktree). Hardware unchanged by this work: nothing under
`rtl/`, `tb/`, `scripts/`, `system/`, `experiments/`, `physical/` or `studio/public/artifacts/` was edited. Only
`studio/src/**`, `studio/scripts/check-v04-vs-rtl.mjs`, `studio/package.json` (one added script), `.claude/launch.json`
(dev server on port 5183, relative command), this file and a v0.4 note in `docs/SEMICONDUCTOR_MICROSCOPE.md` changed.
Nothing was committed.

Evidence labels: **CONCEPT / RTL / SYNTH / LAYOUT / MEASURED** are the mandate's five and are now listed first in the
studio's legend; **DEMO** and **SCRIPTED** stay as explicitly "studio-only" labels for the browser models and the
scripted LLM example. Nothing is MEASURED. LAYOUT evidence: the v0.2 event core (`layout/`), the v0.3 readout core
(`layout_v03/`, DSP only) and, since it appeared during this work, the v0.4 chip top `hbci02_chip_top` (`layout_v04/`);
each is a separate, labelled tab and none is called the die map's placement.

Legend: **DONE / PARTIAL / NOT DONE**; **TESTED** = exercised in the built-in browser at 1440 × 900 (pane hidden, so
3D transitions were waited out rather than watched); screenshots in `docs/screenshots/v0.4/`.

## A. Evidence labels
| Item | Status | Test | Evidence |
|---|---|---|---|
| Legend reordered: the five mandated labels first, DEMO/SCRIPTED under "studio-only" | DONE | TESTED | inspector overview |
| Help text per label rewritten (SYNTH = Yosys + SKY130 cell mapping, no layout; LAYOUT = v0.2 event core only) | DONE | TESTED | badge tooltips |
| On-chip decoder and every v0.4 block: RTL + SYNTH badges; `rtl.core` additionally LAYOUT (v0.2) | DONE | TESTED | `15_inspector_expert_model_store.jpg` |
| Chip / die: CONCEPT (geometry) + RTL + SYNTH (logic); AFE, ADC, electrodes, package parts: CONCEPT | DONE | TESTED | package inspector head: `CONCEPT RTL SYNTH` |
| Loop strip READ → CHIP → DECODER → LLM → FEEDBACK: DECODER now RTL (on chip), LLM SCRIPTED, FEEDBACK CONCEPT | DONE | TESTED | dots `CONCEPT, RTL, RTL, SCRIPTED, CONCEPT`; `13_system_loop_strip_decoder_rtl.jpg` |
| External decoder kept conceptual for larger models (`loop.ext_decoder`, ghost plate "LARGER DECODER · NOT IMPLEMENTED") | DONE | TESTED | `14_system_external_decoder_concept.jpg` |
| No view calls anything a microscope image of fabricated silicon; every layout tab names its design and version; absent artifacts say "NO LAYOUT … YET" | DONE | TESTED | `12_layout_v02_only_no_v04.jpg` (before `layout_v04/` appeared), `18_layout_v03_readout_core_tab.jpg`, `19_layout_v04_chip_top_tab.jpg` |
| Chip / die / v0.4 blocks gain a LAYOUT badge (and a KNOWN die size 1.043 × 1.053 mm) once `layout_v04/layout_summary.json` is present; `rtl.readout` gets one from `layout_v03/` | DONE | TESTED | `20_package_inspector_layout_known_size.jpg` |
| Studio override of `system/hbci_system.json` loop stage (the JSON still lists the v0.3 external decoder) | DONE, labelled in `model/system.ts` | — | the override note is shown in the stage tooltip |

## B. The AI decoder on the die
| Item | Status | Test | Evidence |
|---|---|---|---|
| Die becomes the v0.4 top: rectangular die, `hbci02_digital_top` outline, v0.3 readout core shifted left with **every v0.3 block and route preserved** (legacy event cluster, RAW lane, feature state → biquad → energy, u_ts, record mux) | DONE | TESTED | `01_die_v04_overview_iso.jpg`, `02_die_v04_top_view.jpg` |
| Decoder cluster `u_ai` (raspberry frame, lit in every mode) with tiles u_quant, u_collect, u_model (CRC), u_engine, prediction FIFO (+ pending register); register file and u_bist in a strip above | DONE | TESTED | `03_die_ai_decoder_cluster_zoom.jpg` |
| Tile areas from `synth_stats.json` (FIFO and register file = top minus submodules, labelled so); estimates only if the artifact is missing | DONE | TESTED | tiles read 386 / 1574 / 3858 / 4331 cells |
| Routes: FEATURE tap u_energy → u_quant, quant → collect → (pending) → engine, model → engine / quant, engine → FIFO → pred pins, register bus → register file → model store / decoder / DSP core, BIST | DONE | TESTED | click on collect→engine route opened the signal inspector with `pend_id 0 RTL`, `pend_ts 1,023 RTL`, `eng_start 1`; `05_die_signal_inspector_pending_route.jpg` |
| Pads regrouped: in_* (left), rec_* and reg_* (top), pred pins (right), clk/rst_n (bottom); pad card uses `hbci02_digital_top` ports | DONE | TESTED (pad card not re-opened; grouping read in code) | — |
| Netlist lines for all four scopes (v0.3 teal, legacy amber, v0.4 top grey, decoder raspberry) | DONE | TESTED | `16_die_netlist_lines_four_scopes.jpg` |
| Signal inspector: v0.4 / ai scopes with net meanings (rtl_modules.json `v04`, `v04.ai`), values from the selected frame of the v0.4 trace, NO TRACE where the trace has no per-cycle value | DONE | TESTED | see above |
| Inspector for each sub-block: plain-English explanation + exact rule, register map rows it touches, model-loading story (no prediction without a verified CRC), real ports and netlist connections, Verilog source with the block's lines highlighted, cell counts and SKY130 numbers | DONE | TESTED | `15_inspector_expert_model_store.jpg` |
| Component tree: hbci02_digital_top → register file, BIST, readout core (unchanged subtree), AI decoder → 5 sub-blocks | DONE | TESTED | tree screenshot in `01` |

## C. Chronological pipeline view (signal lab › "On-chip AI (v0.4)")
| Item | Status | Test | Evidence |
|---|---|---|---|
| Stream switch Recorded (`rtl_trace_v04_real.json`, DANDI 000019 ECoG) / Synthetic (`rtl_trace_v04.json`); frame picker by window index | DONE | TESTED | `08_lab_onchip_ai_recorded_stream.jpg`, `09_…synthetic…` |
| Model banner: TRAINED (label, file, git rev, linear 8→2, CRC-32 with browser check) or SYNTHETIC PLACEHOLDER; E02 metrics labelled "software eval, not RTL" | DONE | TESTED | banner text in both streams |
| Stage 1: the 8 channels' window samples (sparklines + the 128 ADC codes of the chosen channel, sample indices and cycles) | DONE | TESTED | |
| Stage 2: energies per channel with win_idx, ts, sat, tap cycle | DONE | TESTED | |
| Stage 3: L and x per channel, RTL first, browser re-run of the spec formula as a ✓ check | DONE | TESTED | all ✓ on both streams |
| Stage 4: frame (frame_id, ts_first/ts_last, span vs FRAME_SPAN, ch_mask, sat_mask, complete cycle, x[8]) | DONE | TESTED | |
| Stage 5: h (MLP) / logits, class, margin, start→done cycles vs the latency formula, all RTL with ✓ checks; linear mode handled | DONE | TESTED | 18 cycles = NO·8 + 2 ✓ |
| Stage 6: the prediction record that left the FIFO (class, margin, ts, frame_id, seq, flags, pop cycle) and the latency chain complete → start → done → pop | DONE | TESTED | 39 cycles end to end in the shown frame |
| Counters of the run and records totals in the footer | DONE | TESTED | |
| Die highlights the decoder path while the tab is open; "↗" on each stage selects the block on the die | DONE | TESTED (highlight set; die not re-screenshotted) | |
| `npm run check:v04`: re-runs quantiser, MLP, CRC and latency formulas over both traces | DONE | PASS | 24/24 + 256/256 features, 3/3 + 32/32 inferences, CRC match, latency 18 everywhere |

## D. Lesson
| Item | Status | Test | Evidence |
|---|---|---|---|
| Lesson 8 "The on-chip decoder (v0.4)": frames (same window, the four collector outcomes), quantiser, MLP / linear, CRC + prediction record, with the selected frame's numbers and a check question | DONE | TESTED | `10_lesson8_frames_same_window.jpg`, `11_lesson8_quantiser.jpg`; check answered (correct option recognised) |
| Lesson counts updated (8), entry points in the overview inspector ("Lesson 8", "Follow one frame through the decoder") | DONE | TESTED | |
| Existing lessons' text updated where they said the decoder is not implemented | DONE | NOT TESTED after edit | `ui/Lesson.tsx` |

## E. Circuit view
| Item | Status | Test | Evidence |
|---|---|---|---|
| Layout level: tabs Conceptual floorplan / v0.2 event core / v0.3 readout core / v0.4 chip top, each with its own images, metrics, status rows and file links; tabs disable themselves (with a reason) when the artifact is absent | DONE | TESTED | `18`, `19` |
| Four diagrams: v0.4 digital top (u_readout, u_ai, u_bist, $regs register file), v0.4 AI decoder (u_quant, u_collect, u_model, u_engine, $fifo), v0.3 readout core, legacy event core; the selection decides which is shown | DONE | TESTED | `06_circuit_v04_ai_decoder.jpg` (7 nodes, 14 edges), `07_circuit_v04_digital_top.jpg` (6 nodes, 16 edges) |
| Edges from rtl_modules.json `v04` / `v04.ai`; clock/reset-driven "clk → output" rows filtered; pred_* routed through the FIFO node, cfg/model writes through the register-file node (both labelled as top-level logic) | DONE | TESTED | legend text |
| Detail pane: ports, computation rule, cells, connections, Verilog with block lines highlighted | DONE | TESTED | |

## Verification
| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS (2.02 MB chunk, existing size warning) |
| `npm run check:v03` | PASS: 4000/4000 internals, 120/120 FEATURE records, RAW exact |
| `npm run check:model` | PASS: 3200/3200 samples, 66/66 events |
| `npm run check:v04` (new) | PASS on both v0.4 traces (see C) |
| Browser console | no errors on any visited level |

## Still conceptual (and said so in the UI)
Electrodes, AFE, ADC, package, bond wires, pads, pin mapping, the communication link, the larger external decoder,
the language model (SCRIPTED), the feedback path, the cortical candidate, every die-map position/route shape, the FIFO
animations (the genuine v0.4 die size and placement are on the Physical layout level, not on the die map). Whether a prediction is *right* is a software question (E02 metrics are
shown as software evaluation), never an RTL or MEASURED one.

## Artifact problems and notes for the hardware side
- `rtl_trace_v04.json` changed during this work: it now carries the **trained** linear model (`SOFTWARE (trained,
  exported)`, 3 frames of 128-sample windows), no longer the placeholder MLP the brief described. The studio handles
  both (banner switches on `source.model.trained`); the placeholder path was verified only with the earlier file.
- `rtl_trace_v04_real.json` has `profile.sample_rate_hz: null` and `ground_truth: null`; the studio types were widened
  to allow this. 32 inferences but 31 predictions: the last prediction was never popped before the simulation ended
  (shown as "no prediction left the FIFO for this frame", counters say `ai_pred 32`).
- `latency.formula` in both traces says `NH*8 + NO*N2 + 2`, while `docs/AI_DECODER.md` 3.4 says `+ 3` (83 cycles for
  NH = 8); the RTL header and the traces agree on `+ 2`. The doc should be corrected.
- `rtl_sha256` in the v0.4 traces is the hash of the four v0.4 source files, not of `rtl/*.v` as in the v0.3 trace, so
  the studio's build-time stale check (`__RTL_SHA256__`, all `rtl/*.v`) cannot be applied to v0.4; the hash is shown
  instead. Either hash the same set in both places or expose the v0.4 set to the studio (vite.config.ts is outside this
  task's edit list).
- `schematics.json` has no entries for the v0.4 modules, so "gates" for u_quant … u_bist shows "No schematic"; the
  gates view and lesson 1 still use the v0.3 filter.
- `manifest.json` was regenerated during the work (lists the v0.4 files now); `index.html` (`<title>HBCI-01 Studio`) is
  outside the edit list and still says HBCI-01.
- `system/hbci_system.json` still describes the loop decoder as external/CONCEPT and the mission as "HBCI-01"; the
  studio overrides the decoder stage in `model/system.ts` (labelled) and shows the mission text as is.
- `artifacts/layout_v03/` and `artifacts/layout_v04/` both appeared during this work (designs `hbci_readout_core` at
  788.8 × 799.6 µm and `hbci02_chip_top` at 1042.8 × 1053.5 µm, 10 MHz, DRC/LVS/antenna/timing all pass). The studio
  loads them with the same `LayoutSummary` contract; before `layout_v04/` existed the tab correctly read "none yet".
  The v0.4 die map still draws conceptual positions and says so; it does not read the DEF.

## Known limits
- 3D transitions were not watched in real time (hidden pane); frame rate not claimed.
- The v0.4 signal inspector shows frame-level values (tap feature, pending frame, prediction); the v0.4 trace has no
  per-cycle VCD subset, so other nets read NO TRACE.
- The module microscope (Level 1/2 "Explore inside") is not specified for the decoder blocks: they open the circuit
  view instead (`enter: 'circuit'`).
