# HBCI build status

Updated: 2026-10-27. Current version: **v0.4 (HBCI-02)** on branch `claude/clever-keller-507b3e` (also
`feature/hbci-02-onchip-ai`, pushed to origin): the v0.3 readout processor plus a verified on-chip neural
decoder, register/SPI interfaces, BIST and a SKY130 layout. Report: `docs/HBCI02_REPORT.md`. `main` still holds
v0.3; the v0.3 section below is kept as history.

## Run it (v0.4, from the worktree)
- **Studio:** http://localhost:5183
- **Start:**

  ```bash
  cd ~/Hamiltonian-BCI-Chip/.claude/worktrees/clever-keller-507b3e/studio && source ../scripts/env.sh && npm run dev -- --port 5183 --strictPort
  ```
  (first time: `npm ci` in that `studio/` directory). The Claude desktop app starts the same server with the
  `hbci-studio` launch configuration.
- **All v0.4 hardware evidence** (about 25 min: lint, decoder/top/chip suites, gate level, mutation, formal,
  traces, recorded-ECoG run):

  ```bash
  cd ~/Hamiltonian-BCI-Chip/.claude/worktrees/clever-keller-507b3e && make v04
  ```
- **Browser models vs RTL:** `npm run check:v03 && npm run check:model && npm run check:v04` in `studio/`.

## v0.3 record (kept for history)

Updated: 2026-10-20. Version **v0.3**, a waveform-preserving multichannel readout and representation processor.

### Run it (v0.3, main checkout)
- **Studio:** http://localhost:5180
- **Restart:**

  ```bash
  cd ~/Hamiltonian-BCI-Chip/studio && source ../scripts/env.sh && npm run dev
  ```
- **All hardware evidence** (about 2.5 min; 17 suites):

  ```bash
  cd ~/Hamiltonian-BCI-Chip && make artifacts
  ```
- **Browser models vs RTL:**

  ```bash
  cd ~/Hamiltonian-BCI-Chip/studio && npm run check:v03 && npm run check:model
  ```
- **Real-data test** (fetches about 355 MB once, then cached):

  ```bash
  cd ~/Hamiltonian-BCI-Chip && /usr/bin/python3 -E experiments/E01_ecog_vowel/run_e01.py
  ```
- **Repository:** https://github.com/MoheetBrain/Hamiltonian-BCI-Chip (private)

## v0.3 milestones
| Milestone | Outcome |
|---|---|
| **A**: baseline, audit, shared model, early studio change | **Done.** Tag `v0.2`; layout branch merged. `docs/RESEARCH_AUDIT.md`: BISC 65,536 electrodes / 1,024 channels and MC_Maze contents verified against primary sources, Nyquist arithmetic checked. `system/hbci_system.json` is the single shared model. Top-bar readout mode and live payload |
| **B**: RAW vertical slice | **Done.** `hbci_readout_core` RAW path. RAW reconstruction is bit-exact on every channel with 0 drops (20,337 samples, 2 reset segments; plus NUM_CH=6 with rejects) |
| **C**: FEATURE + HYBRID in RTL | **Done.** DF-I biquad (Q2.14, rounding + saturation) and windowed band energy. Matches the cycle-accurate golden model on every sample and record, including saturation and every `win_log2`. HYBRID = RAW + FEATURE, with payload above RAW (+3.05% in the test). Schematics and waveforms regenerated |
| **D**: studio upgrade | **Done.** Bench and thin cortical-interface (CONCEPT) presets; READ→CHIP→DECODER→LLM→FEEDBACK loop in 3D and 2D; v0.3 die with mode-path highlighting; linked representation views; follow-one-sample journey; payload calculator; lessons ("What changes if I remove it?"); 9-step 60-second guided lesson; software-only feedback contract; resizable panels; measured FPS meter |
| **E**: bounded real-data experiment | **Done, with limits.** Datasets were checked by content first: MC_Maze (spikes only), PESD (**all simulated**), DANDI 000481 (undocumented labels) and 001193 (pre-reduced envelope) were rejected. DANDI 000019 human ECoG was used (see below). Vowel identity was inconclusive |
| **F**: technology mapping | **Done (mapping only).** SKY130 HD mapping of `hbci_readout_core`: 18,577 cells, 3,155 flip-flops, 174,484 µm² cell area. The v0.2 event core keeps its genuine 40 MHz layout. **No layout for the v0.3 core** (not attempted) |

## Hardware verification (`make artifacts` at commit `56b1e46`, re-checked by the main agent)
**17 suites, 348 checks, 0 errors.** Verilator `-Wall` reports 0 warnings (7 configurations).
`rtl/hbci_event_core.v` is byte-identical to `v0.2`.

| Suite | Checks | Result |
|---|---:|---|
| v0.2 suites (event core: directed, random vs golden, gate level, scenario, mutation, v0.1/v0.2 equivalence) | 147 | PASS |
| `v03_legacy_preserved` | 3 | PASS |
| `v03_raw_reconstruction` | 22 | PASS |
| `v03_feature_golden` | 22 | PASS |
| `v03_hybrid` | 13 | PASS |
| `v03_session_gating`: no records, drops or seq advance while the session is off | 11 | PASS |
| `v03_overload_gaps`: RAW 6,749, EVENT 590 and FEATURE 1,764 drops, all counted and flagged; generated = emitted + dropped | 22 | PASS |
| `v03_modes_reset_ts` | 22 | PASS |
| `v03_gate_level`: synthesised netlist cycle-identical to RTL | 29 | PASS |
| `v03_mutation`: 10 of 10 mutants killed | 10 | PASS |
| `v03_scenario_trace` | 47 | PASS |

**Independent cross-check.** The studio's TypeScript model of the v0.3 core agrees with the RTL trace on
**4,000/4,000 samples** (y, ysat, acc, cnt, done), **120/120 FEATURE records** and **4,000/4,000 RAW records**.
The v0.2 model still agrees on 3,200/3,200 samples.

**Generic synthesis (`synth -booth`):**

| Module | Cells | Flip-flops |
|---|---:|---:|
| `hbci_readout_core` (total) | 18,932 | 3,314 |
| `hbci_biquad` | 6,907 | 0 |
| `hbci_record_mux` | 5,027 | 1,813 |
| `hbci_feature_state` | 2,803 | 984 |
| `hbci_band_energy` | 1,914 | 0 |

The v0.3 core is about 9× the v0.2 core: five 16×16 multipliers, a 16-deep FIFO, and per-channel filter and
energy state.

## E01 real-data test (`experiments/E01_ecog_vowel/`)
**Data:** DANDI 000019, human ECoG, session EC9_B15, CC-BY-4.0. 60 anatomically selected sensorimotor channels
at 3051.76 Hz (195 s), read with HTTP range requests.

**Method:** the chip-equivalent FEATURE and EVENT models are compared with RAW host features, using LDA with a
permutation null.

| Task | RAW | FEATURE | EVENT | HYBRID |
|---|---|---|---|---|
| Speech vs silence (chance 50%, n = 68) | 84.1% | 89.1% | 50.0% | 90.2% |
| Vowel identity (chance 33%, n = 51) | 45.5% (p 0.055) | 41.0% (p 0.23) | 33.6% | 49.6% (p 0.03, not significant after correction) |

- Payload for 60 channels: RAW records 16.3 Mbit/s, sample values 2.93 Mbit/s, FEATURE 0.127 Mbit/s,
  EVENT 71 bit/s.
- **Limits:** single subject, single session, offline analysis, no hardware recording. The NWB units are
  ambiguous. The RTL itself was not run on this data. FEATURE > RAW reflects the RAW host recipe, not extra
  information. Full report: `experiments/E01_ecog_vowel/REPORT.md`.

## Browser tests (built-in browser, 1680×1050; pane hidden, frames stepped manually)
Real clicks, each confirmed by store and DOM state:
- **RTL trace source:** the badge reads RTL and there is no stale flag (the RTL hash matches).
- **Sample journey:** clicking the RAW plot shows the actual RTL numbers. The browser recomputation of
  `y` = 4058 matches the RTL.
- **Through the circuit:** the button animated the HYBRID path `rtl.readout` → `raw_path`+`u_fstate` →
  `u_biquad` → `u_energy` → `u_records`.
- **Top-bar mode:** setting RAW took effect.
- **Preset switch:** switching to cortical rendered the conceptual preset.
- **60-second lesson:** it started; Next advanced it; auto-advance reached the die in EVENT mode with the EVENT
  path animating; Esc exited.
- **Circuit view:** netlist-derived v0.3 diagram (9 blocks, 18 edges); the selected block shows its Verilog
  source lines.
- **E01 tab:** renders.
- **Gates:** all 12 modules are listed.

**Not observed:** real-time animation smoothness. The pane was hidden throughout. The FPS meter's readings
during testing count manually driven frames.

Screenshots are in `docs/screenshots/v0.3/`.

## What remains conceptual, unknown or blocked
- **Conceptual (CONCEPT):**
  - electrodes, analog front end, ADC, power and coil, telemetry, housing and package;
  - the thin cortical-interface preset (no dimensions; not engineered);
  - die placement in the 3D view;
  - the external neural decoder (not implemented);
  - the LLM stage (SCRIPTED example only);
  - the feedback interface (research branch; software contract only, with no stimulation and no tissue
    connection).
- **Unknown:**
  - the timing, area and power of the v0.3 core in silicon (no v0.3 layout or STA);
  - real-time studio frame rate on a visible display;
  - whether FEATURE or RAW preserves more decodable vowel information (E01 was inconclusive);
  - cross-session stability (not tested).
- **Blocked or not attempted:**
  - a v0.3 place-and-route (the LibreLane flow exists for the v0.2 core; not attempted for v0.3);
  - a labelled multi-session real-data experiment;
  - running the RTL itself on the real ECoG data.
- **Never in scope:** stimulation, emotional monitoring, a threshold "mental password", biological hardware
  connection, and on-chip decoding or LLM inference.

## v0.2 record (kept for history)

Updated: 2026-10-19

### Run it
- **Studio:** http://localhost:5180
- **Restart:**

  ```bash
  cd ~/Hamiltonian-BCI-Chip/studio && source ../scripts/env.sh && npm run dev
  ```
- **Regenerate all hardware evidence** (about 60 s):

  ```bash
  cd ~/Hamiltonian-BCI-Chip && make artifacts
  ```
- **Regenerate the genuine layout** (about 2–3 min; first time `make eda-vm`, see `docs/PHYSICAL.md`):

  ```bash
  cd ~/Hamiltonian-BCI-Chip && make layout
  ```

### Environment (new Mac Studio, nothing installed system-wide)
| Tool | Version | Location |
|---|---|---|
| Node.js | v24.22.0 LTS (SHA-256 verified) | `~/.local/opt/node-v24.22.0-darwin-arm64` |
| OSS CAD Suite | 2026-10-19: Yosys 0.70+157, Icarus Verilog 14.0 (devel), Verilator 5.053, Graphviz, GTKWave | `~/.local/opt/oss-cad-suite` |
| SKY130 HD liberty | tt_025C_1v80, pinned commit and SHA-256 in `docs/PHYSICAL.md` | `~/.local/pdk/sky130_fd_sc_hd` |
| netlistsvg | 1.0.2 | `tools/node_modules` |
| Lima | 2.2.1 (SHA-256 verified), VM `hbci-eda`: Ubuntu 24.04 arm64, 16 vCPU, 32 GiB, Apple Virtualization.framework, no admin rights | `~/.local/opt/lima-2.2.1`, `~/.lima/hbci-eda` |
| LibreLane (OpenLane 2 successor) | 3.0.16 via Nix inside the VM: OpenROAD `dcf36133`, Yosys 0.62, Magic 8.3.623, Netgen 1.5.316, KLayout 0.30.7 | VM `~/librelane`, PDK sky130A open_pdks `8afc8346` in VM `~/.ciel` |

### Baseline (tag `v0.1-baseline`)
The original `Hamiltonian_BCI_Chip_v0.1.zip` was not on this machine, so v0.1 was **reconstructed from the
written brief**.

| Target | Baseline result |
|---|---|
| `make sim` | PASS, 15 checks |
| `make synth` | 1997 generic cells, 421 flip-flops |
| `make lint` | 10 Verilator warnings |

### Hardware verification (v0.2, `make artifacts`, verified independently by the main agent)
| Suite | Checks | Result |
|---|---:|---|
| `tb_hbci_event_core` (v0.1 directed) | 15 | PASS |
| `tb_hbci_directed`: reset, invalid input, threshold boundaries, channel state, refractory, signed arithmetic, timestamps, back-pressure | 55 | PASS |
| `random_vs_golden`: 4 seeded runs, about 80k samples vs a bit-accurate Python model | 28 | PASS |
| `gate_level_vs_golden`: Yosys netlist + simcells, cycle-exact vs RTL | 32 | PASS |
| `scenario_trace` | 8 | PASS |
| `mutation_sanity`: 8 deliberately broken RTLs, all caught | 8 | PASS |
| `yosys_equiv_v01_v02`: lint-cleaned RTL proven equivalent to v0.1 | 1 | PASS |

Further checks:
- **Lint:** Verilator `-Wall` reports 0 warnings (down from 10).
- **DEMO model cross-check:** the browser's TypeScript model agrees with the RTL trace on **3200/3200 samples**
  across all 9 internal fields, with 66/66 events. Run it with `npm run check:model` in `studio/`.
- **No RTL functional bug was found.**

### Synthesis
**Generic Yosys synthesis (hierarchical):**

| Module | Cells | Flip-flops |
|---|---:|---:|
| Top | 2003 | 421 |
| `channel_state` | 803 | 272 |
| `baseline_ema` | 492 | 0 |
| `threshold_detector` | 325 | 0 |
| `timestamp` | 188 | 64 |
| `event_packer` | 149 | 85 |
| `refractory_ctrl` | 44 | 0 |

**SKY130 HD mapping (flattened):** 2009 cells, 389 flip-flops, 19,615 µm² cell area.
- This is cell footprint area only; the place-and-route result is below.
- The SKY130 netlist itself has not been equivalence-checked.

### Physical design (`make layout`, LibreLane 3.0.16 on SKY130 HD, 2026-10-19)
| Item | Result |
|---|---|
| Die / core (calculated) | 245.755 × 256.475 µm (0.0630 mm²) / 234.60 × 233.92 µm |
| Cells | 3,888 standard cells incl. 389 flip-flops and 792 well taps, plus 6,190 filler/decap |
| Utilisation | 45 % at floorplan → 62.7 % after timing repair |
| Clock | `clk` at **40 MHz** (25 ns) |
| Setup / hold | met at all 9 corners: worst setup slack +0.666 ns (`max_ss_100C_1v60`), worst hold slack +0.107 ns |
| DRC / LVS / antenna / XOR | 0 / 0 / 0 / 0 (Magic and KLayout DRC, Netgen LVS) |
| Power | **estimate** 3.43 mW at nom_tt (2.69–4.03 mW over corners), default switching activity |
| Open warnings | 89 max-slew violations at the ss corners (0 at tt/ff); 13 CTS leaf buffers drive 11–12 flops (limit 10) |

- **50 MHz was attempted first.** 13 exploration runs completed (7 at 50 MHz, the rest at 40 and 33 MHz), every
  one DRC/LVS-clean, and 2 more ran out of memory. At 50 MHz timing is met at the tt and ff corners (+7.3 ns) but
  never at ss_100C_1v60 (best −0.358 ns). The limit is the single-cycle
  read–EMA–threshold–write path, about 40 cells. No timing-closure claim is made for 50 MHz.
- LibreLane's own checkers only stop the flow on typical-corner violations, so "flow complete" is not used as
  evidence. Every corner is read from the metrics.
- Not done: routed-netlist simulation, a padframe, foundry sign-off, fabrication.

### Acceptance tests (built-in browser, 1600×1000)
The browser pane was hidden during testing, so requestAnimationFrame was throttled. 3D state was checked
through the store and by stepping frames manually. Animation smoothness at 60 fps was **not observed**.

| # | Test | Result | How it was checked |
|---|---|---|---|
| 1 | Local URL shows a 3D BCI assembly | PASS | Screenshot at http://localhost:5180 |
| 2 | Rotate freely | PASS | Drag moved the camera from (3.0, 9.9, 16.6) to (−7.3, 7.4, 16.4) |
| 3 | Explosion slider separates parts | PASS | Slider at 0 and 100%; screenshots after stepping frames |
| 4 | Click the HBCI processor to inspect it | PASS | Raycast click selected `sys.hbci01`; inspector populated |
| 5 | Double-click into package, expose the die, then the die architecture | PASS | Levels changed package → die; Expose die lifted the lid; die shows the 6 RTL blocks |
| 6 | Threshold detector: function, inputs, outputs | PASS | Inspector and circuit detail: ports, formula, 325 cells, 19/19 related tests |
| 7 | RTL-derived schematic | PASS | netlistsvg gate view; clicking an XOR highlighted source line 285 |
| 8 | Play and pause neural simulation | PASS | DEMO playback and RTL trace playback |
| 9 | Inject a spike and watch the data flow | PASS | ch3 spike: stages from electrode to packet; die lane and blocks lit; numbers shown |
| 10 | Genuine RTL waveforms | PASS | RTL Trace Mode: digital waveforms (12 VCD signals) and per-block waveforms in the circuit view |
| 11 | Return to the full assembly without a restart | PASS, after a fix | Camera returns to the home framing (3.0, 9.9, 16.7) |
| 12 | Real vs conceptual is visible at once | PASS | Persistent View/Selection evidence badges; inspector status stepper; legend |
| 13 | Genuine layout tab shows the real GDS with metrics | PASS | Port 5182 worktree preview at 1600×1000. The tab is enabled with a LAYOUT badge; routing/devices/40 µm renders; pan and zoom with a µm scale bar and cursor read-out; metrics and checks match `layout_summary.json`; with the summary removed, the tab is disabled and the view reverts to CONCEPT |

### Bugs found and fixed during acceptance testing
- **3D labels:** clicking a label selected the part and then immediately deselected it, because the canvas
  "missed" handler also caught the click. Fixed.
- **Camera after drill-down:** returning from the die stayed zoomed in on the chip, because the home framing
  was measured mid-transition. Fixed with a re-frame after the transition.
- **Gate view:** it did not fit on load, clicks inside hollow gate shapes missed, and the source map listed
  Yosys techmap lines. All fixed.
- **Lab:** the live score counted a spike detected just before its trough as a false positive. Fixed.
- **Circuit view:** React Flow warned because the inputs node had an empty id. Fixed.

### Milestones
| Milestone | Status |
|---|---|
| A: 3D exploded assembly | done |
| B: package, die and block drill-down | done |
| C: real RTL waveforms and netlist schematics | done |
| D: signal lab and RTL trace mode | done |
| E: physical design | done for the open-source flow: SKY130 HD place-and-route with LibreLane in a Lima VM, DRC/LVS/antenna clean, timing met at 40 MHz on all 9 corners. The LAYOUT tab shows it; the CONCEPT floorplan is a separate tab. Not fabricated |

### Known gaps
- **3D labels:** they can overlap at some camera angles.
- **Expose die:** the camera does not re-frame after the lid lifts (use Fit).
- **Hot reload:** several 3D files export constants, so Vite does full reloads instead of fast refresh (dev
  only).
- **Circuit and gate views:** these are compact on narrow windows. They are best on a large display.
- **Production bundle:** a single 1.4 MB chunk (410 kB gzipped). Code-splitting has not been done.
- **Layout:** slow-corner slew violations (89) and CTS leaf fanout (11–12 vs 10) remain. The power figure is an
  estimate with default activity. The routed netlist has not been simulated against the RTL. 50 MHz does not
  close at ss without an RTL change.
- **Layout artifacts** add 5.5 MB to `studio/public/artifacts/layout/` (GDS and DEF gzipped, three PNG renders).
