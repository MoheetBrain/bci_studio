# HBCI-01 physical design status

## What exists
| Step | Status | Evidence |
|---|---|---|
| RTL simulation (Icarus Verilog) | done | `make test`, `studio/public/artifacts/verification.json` |
| Generic synthesis (Yosys, no PDK) | done | `make synth`, `synth_stats.json` |
| Gate-level simulation of the generic netlist | done, cycle-exact vs RTL | `gate_level_vs_golden` suite |
| SKY130 HD technology mapping | done (cell area only) | `make sky130`, `sky130_stats.json` |
| Floorplan, placement, CTS, routing (SKY130 HD) | **done** | `make layout`, `artifacts/layout/` |
| DRC (Magic + KLayout), LVS (Netgen), antenna, GDS XOR | **clean** | `layout_summary.json` → `checks` |
| Static timing, 9 corners, after routing + RC extraction | **met at 40 MHz**; not met at 50 MHz | `layout_summary.json` → `timing` |
| Power | **estimate only** (no switching activity from simulation) | `layout_summary.json` → `power` |
| Gate-level simulation of the *routed* netlist | not run | — |
| Padframe / I/O ring, packaging, foundry sign-off, fabrication | not done, not planned | — |

Evidence label for the layout: **LAYOUT**: a genuine placed-and-routed GDSII from an open-source PDK flow. It
has not been fabricated or measured.

## Genuine layout (`make layout`), 2026-10-19

### Toolchain (exact versions)
OpenROAD has no native macOS build, so the flow runs in a Linux VM. No admin rights are needed.

| Component | Version | Notes |
|---|---|---|
| Lima | 2.2.1 (`lima-2.2.1-Darwin-arm64.tar.gz`, SHA-256 `9e9eacce88f37e185c346bad73aa6136f738d8cdf8c3bb23cd42b071824bc66e`) | `~/.local/opt/lima-2.2.1`, VM `hbci-eda` uses Apple Virtualization.framework (`vz`) |
| VM guest | Ubuntu 24.04.5 LTS aarch64 (cloud image `release-20260926`) | 16 vCPU, 32 GiB RAM, 100 GiB sparse disk; mounts only `~/Hamiltonian-BCI-Chip` (read-write) |
| Nix | nix-installer v2.35.3 (inside the VM) | FOSSi Foundation binary cache `nix-cache.fossi-foundation.org` |
| LibreLane | **3.0.16** (git tag `3.0.16`) | The continuation of OpenLane 2, renamed in 2025. Same Classic flow and JSON config format |
| PDK | sky130A, open_pdks `8afc8346a57fe1ab7934ba5a6056ea8b43078e71` (fetched by Ciel) | Standard cells `sky130_fd_sc_hd` |
| OpenROAD | `dcf36133a369abc8f3c5e5738cd4d82e4903c0e0` | Floorplan, placement, CTS, resizer, routing, STA (OpenSTA 2.7.0), RC extraction |
| Yosys | 0.62 (`7326bb7d`) | Synthesis inside the flow (the studio's own SKY130 mapping uses Yosys 0.70 on macOS) |
| Magic | 8.3.623 | GDS stream-out, DRC, SPICE extraction |
| Netgen | 1.5.316 | LVS |
| KLayout | 0.30.7 | GDS stream-out, DRC, XOR, batch rendering of the studio images |
| Verilator | 5.044 | Lint step at the start of the flow |

Setup from scratch is `make eda-vm`. `physical/lima/vm.sh` does not install Lima itself: if Lima is missing it
prints the commands to install it from the official release, with checksum verification. It then creates the VM and runs
`physical/lima/provision.sh`, which installs Nix and LibreLane, and the LibreLane smoke test passed. After that,
`make layout` takes about 2–3 minutes.

### Constraints (everything the flow was told)
Files: `physical/openlane/config.json` and `physical/openlane/hbci_event_core.sdc`.

| Constraint | Value | Why |
|---|---|---|
| Top / RTL | `hbci_event_core` from `rtl/hbci_event_core.v`, default parameters (`NUM_CH=8`) | RTL unchanged |
| Clock | port `clk`, **25.0 ns (40 MHz)** | 50 MHz was the first target; see the attempts below |
| Clock uncertainty / transition | 0.25 ns / 0.15 ns | LibreLane sky130 defaults, written out in the SDC |
| I/O delay | 20 % of the period on every input and output (5.0 ns at 40 MHz) | Core assumed to sit in a synchronous system on the same clock |
| Reset | `rst_n`, asynchronous active-low; constrained like a data input (20 % input delay), **not** a false path | Recovery/removal at all 389 flops are timed; assumes an external reset synchroniser releases reset synchronously |
| Drive / load | inputs and clock driven by `sky130_fd_sc_hd__inv_2`; outputs loaded with 33.442 fF (an `inv_16` input) | sky130 defaults |
| Design rules | max transition 0.75 ns, max fanout 10, max capacitance 0.2 pF | sky130 defaults |
| OCV derate | ±5 % | sky130 default |
| Floorplan | relative sizing, **core utilisation 45 %**, aspect ratio 1, global-placement target density 55 % | Gives the resizer room for buffering |
| Pins | default: OpenROAD `place_pins` after an I/O-less global placement; met2 on top/bottom, met3 on left/right; no pin-order file | 217 signal pins, 900 slots |
| Routing layers | met1–met5; power grid met4 (vertical) / met5 (horizontal) straps, met1 rails | sky130 defaults |
| Synthesis | Yosys `AREA 0`, flattened | LibreLane default |
| Cells kept off the design | `sky130_fd_sc_hd__clkdlybuf4s*` (`EXTRA_EXCLUDED_CELLS`) | Clock-delay buffers; LibreLane's repair used them as ordinary data buffers (≈1 ns per stage at ss) |
| Repair after global routing | `RUN_POST_GRT_DESIGN_REPAIR`, `RUN_POST_GRT_RESIZER_TIMING` = true | Uses routed-wire parasitics |
| Resizer setup margin | 2.0 ns after CTS, 1.5 ns after global routing | Absorbs the ≈1.1 ns gap between PnR estimates and max-RC sign-off at ss |
| Slew repair margin | 45 % (before and after global routing) | Fewer slow-corner slew violations |
| STA corners | 9: {nom, min, max} RC × {tt_025C_1v80, ss_100C_1v60, ff_n40C_1v95} | All reported |

### Results (run `hbci_layout`; `studio/public/artifacts/layout/layout_summary.json`)
| Item | Value |
|---|---|
| Die (calculated by the floorplanner) | **245.755 × 256.475 µm = 0.0630 mm²** |
| Core | 234.60 × 233.92 µm = 0.0549 mm² (origin 5.52, 10.88 µm) |
| Cells | 3,888 standard cells: 389 flip-flops, 1,471 logic, 68 inverters, 1,107 repair/timing buffers, 61 clock-tree cells, 792 well taps. Plus 6,190 filler/decap cells. 10,078 instances in total |
| Utilisation | 62.7 % of the core after timing repair (45 % at floorplan) |
| Routing | 84,080 µm of wire, 20,587 vias; detailed-route DRC 0 |
| Setup (40 MHz) | **met at all 9 corners**. Worst slack +0.666 ns at `max_ss_100C_1v60`; +10.21 ns at `nom_tt_025C_1v80`; +13.7 ns at ff |
| Hold | **met at all 9 corners**. Worst slack +0.107 ns at `min_ff_n40C_1v95` |
| DRC | **0** Magic, **0** KLayout |
| LVS | **0** errors (Netgen: devices, nets and pins match) |
| Antenna | **0** violating nets/pins (no repair diodes were needed) |
| GDS XOR (Magic vs KLayout stream-out) | 0 differences |
| Power (ESTIMATE) | **3.43 mW at `nom_tt_025C_1v80`** (internal 2.19, switching 1.24 mW, leakage 30 nW); 2.69–4.03 mW across the 9 corners. OpenROAD `report_power` with OpenSTA's default switching activity, so no simulation-derived activity. Not a measurement |
| IR drop | 0.3 mV worst on VPWR. OpenROAD's estimate with no supply-pad locations (`VSRC_LOC_FILES` unset), so not meaningful for a real chip |

**Open issues the checks report:**
- **89 max-transition (slew) violations at `max_ss_100C_1v60`** (43 at nom_ss, 30 at min_ss, 0 at tt and ff).
  These are data-buffer trees reaching ≈1.0 ns against the 0.75 ns limit. Setup still passes at ss, but slack
  there is computed on slews beyond the constraint, so treat ss slack as approximate.
- **13 max-fanout violations:** CTS leaf clock buffers drive 11–12 flops each against a limit of 10.
- LibreLane's own sky130 checkers stop the flow only for **typical-corner** timing violations
  (`TIMING_VIOLATION_CORNERS = *tt*`). Slow-corner violations are only warnings. "Flow complete" is therefore
  **not** a timing claim: the 50 MHz runs below also finished with exit code 0. The studio and this file read
  every corner from the metrics instead.

### Timing-closure attempts (all kept in `build/openlane/`, reproducible with `make layout-sweep`)
The RTL was never changed. Every run below is DRC-, LVS- and antenna-clean. "ss WS" is the worst setup slack
over the three ss corners.

| Run | Clock | What changed (vs LibreLane defaults) | tt WS | ss WS | setup TNS | slew viol. |
|---|---|---|---:|---:|---:|---:|
| hbci_50mhz | 50 MHz | none (first attempt) | +7.35 | **−0.817** | −54.8 | 476 |
| x50_grt | 50 MHz | post-GRT design + timing repair | +7.41 | −0.575 | −31.7 | 422 |
| x50_delay | 50 MHz | + synthesis `DELAY 1` | +6.44 | −2.671 | −247.4 | 624 |
| x40_grt | 40 MHz | post-GRT repair | +9.57 | −0.817 | −25.4 | 525 |
| y50_m | 50 MHz | + setup margin 1.0/0.5 ns, slew margin 30 % | +7.51 | −0.358 | −5.7 | 140 |
| y40_m | 40 MHz | same | +9.58 | −0.607 | −15.7 | 149 |
| y33_m | 33 MHz | same | +11.63 | −0.435 | −2.5 | 240 |
| z50 | 50 MHz | `clkdlybuf4s*` excluded + post-GRT repair | +7.36 | −0.652 | −29.4 | 496 |
| z50m | 50 MHz | + margins 0.5/0.2 ns, slew 30 % | +7.30 | −0.826 | −32.6 | 207 |
| z40m | 40 MHz | same | +9.44 | −0.846 | −18.5 | 247 |
| w50 | 50 MHz | `clkdlybuf4s*` excluded, margins 2.0/1.5 ns, slew 45 % | +7.22 | −0.773 | −41.9 | 65 |
| **w40 = hbci_layout** | **40 MHz** | same (published) | **+10.21** | **+0.666** | **0** | 89 |
| w33 | 33 MHz | same | +12.25 | +0.552 | 0 | 70 |
| w40s, w40sc | 40 MHz | slew margin 60 % (± CTS clusters of 10) | — | — | — | — |

w40s and w40sc **failed**: OpenROAD's pre-route `repair_design` grew to 15–32 GiB and the VM's OOM killer
stopped it (three runs were in parallel in the 32 GiB VM). Their logs are kept; the settings were dropped.

**What limits 50 MHz.** The worst paths start at `in_channel` and end at the channel-state flip-flops. In one
cycle they go through the 8-way channel-state mux, the 24-bit EMA subtract, |residual|, the threshold and
hysteresis compare and the write-back mux. That is about 40 cells, 17–21 ns at ss_100C_1v60 after the 20 % input
delay, which is the RTL's single-cycle architecture. Delay cells on data paths and post-route parasitics added
1–2 ns on top. At 50 MHz no flow knob tried here closed the ss corners. Doing so would need an RTL change
(for example pipelining the read-modify-write), which was out of scope.

### Studio artifacts (`studio/public/artifacts/layout/`)
| File | Contents |
|---|---|
| `layout_summary.json` | Everything above, read from the run's `final/metrics.json`, `resolved.json` and per-corner `power.rpt` (contract: `LayoutSummary` in `studio/src/artifacts/types.ts`, checked by `scripts/check_artifacts.py`) |
| `layout_routing.png` | Whole die, met1–met5 and vias (KLayout batch render of the final GDS) |
| `layout_cells.png` | Whole die, device layers: n-well outline, diffusion, taps, poly, contacts |
| `layout_detail.png` | 40 × 40 µm at the die centre, every drawn layer in the PDK's `sky130A.lyp` colours |
| `hbci_event_core.gds.gz`, `hbci_event_core.def.gz` | Final GDSII and DEF |
| `metrics.json`, `resolved_config.json` | LibreLane's final metrics and the fully resolved configuration |

The images are straight KLayout renderings of the GDS (`physical/render_gds.py`). The layer selection and colours
are chosen per view, and no geometry is drawn by hand. The studio's **Genuine layout (GDSII)** tab is enabled
only when `layout_summary.json` exists for a completed run with images. Otherwise it stays disabled, and
`layout_report.py` deletes a stale summary when a new run fails to reach sign-off.

### Reproduce
```bash
make eda-vm        # once: Lima VM + Nix + LibreLane 3.0.16 + PDK (~10 min, ~2 GB download)
make layout        # ~2-3 min: flow, render, layout_summary.json, manifest, contract check
make layout-sweep  # optional: the exploration runs above
physical/lima/vm.sh stop   # free the VM's 32 GiB of RAM
```
Run directories, with every step's logs, stay in `build/openlane/<tag>/run` (git-ignored).

## SKY130 technology mapping (`make sky130`, macOS-native Yosys)
- **Library:** `sky130_fd_sc_hd__tt_025C_1v80` (SkyWater SKY130 high-density standard cells, typical corner,
  25 °C, 1.80 V; Apache-2.0).
- **Source:** OpenROAD-flow-scripts at commit `b5dceb3c08fd30c9a1c5c0587bc6a57e0392080a`, path
  `flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib`.
- **SHA-256:** `ec0e1067a35c8bf20b11e58d1e8ac53326067e4dac84a125cc1b917a3518d0d9`
- **Installed at:** `~/.local/pdk/sky130_fd_sc_hd/` (not in the repo).
- **Flow (`synth/sky130_map.ys`):** `synth -flatten`, then `dfflibmap` and `abc -liberty`. Cells matching
  `*lpflow*`, `*probe*`, `*clkdly*` and `*dlygate*` are marked don't-use, as in standard SKY130 flows.
- **Result (2026-10-19):** 2009 cells and 389 flip-flops, all of them `dfrtp_1` / `dfstp_1` (async reset or set).
  - Total cell area: 19,615 µm² (0.0196 mm²).
  - Sequential cell area: 9,744 µm².

This mapping is independent of the LibreLane run. LibreLane synthesises the RTL itself, with Yosys 0.62 and
`_2`-drive cells by default, giving 24,791 µm² before placement. It ends at 34,422 µm² of standard-cell area
after timing repair.

### Caveats
- Cell area is the sum of library footprints. It excludes utilisation margin, routing, the clock tree, the I/O
  ring and the power grid.
- The flattened run removes the `stat_rejected` counter (32 flip-flops). It is constant when `NUM_CH = 8`,
  because every 3-bit channel number is in range. The hierarchical generic run keeps it (421 flip-flops). The
  LibreLane run also flattens, and also has 389 flip-flops.
- Neither SKY130 netlist (this mapping, or LibreLane's routed netlist) has been formally checked or simulated
  against the RTL. A Yosys `equiv_*` attempt was set aside after it failed at script setup. LVS proves that the
  layout matches LibreLane's netlist, not that the netlist matches the RTL.

  The generic gate-level netlist *is* simulation-verified, but it is not the same netlist as either SKY130 one.

---

# HBCI-02 (v0.4) and v0.3 core: genuine layouts, 2026-10-27

Same toolchain as above (LibreLane 3.0.16, OpenROAD `dcf36133`, Yosys 0.62, Magic 8.3.623, Netgen 1.5.316,
KLayout 0.30.7, sky130A open_pdks `8afc8346`, Lima VM `hbci-eda`). Flow generalised by `physical/run_layout.sh`
and `physical/layout.mk` (`make layout-v03`, `make layout-v04`); configurations in `physical/openlane/<design>/`.
Every number below is read from the run's `final/metrics.json` and per-corner `power.rpt`; run directories are
`build/openlane/<tag>/` (git-ignored). Published artifacts: `studio/public/artifacts/layout_v03/` and
`layout_v04/` (same `LayoutSummary` schema as the v0.2 result; the v0.2 `layout/` is untouched and is **not**
this chip). Label: **LAYOUT** (placed and routed, open-source sign-off checks), not fabricated, not measured.
Detailed per-run reports: `physical/REPORT_v03_layout.md`, `physical/REPORT_v04_layout.md`.

## HBCI-02 chip top (`hbci02_chip_top`, run `v04_10mhz`)
| Item | Value |
|---|---|
| Clock | **100 ns (10 MHz)**, port `clk`; SDC as for v0.2 (20 % I/O delay, ±5 % derate, 0.25 ns uncertainty) |
| Floorplan | core utilisation 40 %, target density 50 %; resizer setup margins 6 / 5 ns; slew repair 20 % |
| Die | **1042.75 × 1053.47 µm = 1.098 mm²**; core 1031.3 × 1030.9 µm |
| Cells | 61,973 standard cells: 6,388 flip-flops, 25,210 combinational, 422 inverters, 13,190 timing-repair buffers, 1,207 clock-tree cells, 507 antenna diodes, 15,049 taps; plus 147,356 fillers |
| Standard-cell area / utilisation | 561,654 µm² / 52.8 % after repair |
| Routing | 1.864 m of wire, 336,215 vias, detailed-route DRC 0 |
| Setup | **met at all 9 corners**: worst +6.35 ns at `max_ss_100C_1v60`, +9.53 ns at min_ss, +52.7 ns at tt, +70.3 ns at ff; 0 violations, TNS 0 |
| Hold | met at all 9 corners, worst +0.088 ns |
| DRC / LVS / antenna | **0 / 0 / 0** (Magic and KLayout DRC, Netgen LVS, OpenROAD antenna with 507 diodes inserted) |
| Open warnings | **10,666 max-slew violations at max_ss** (0 at ff), 28 fanout and 7 capacitance in the final STA report (the flow's aggregate fanout metric reads 138): electrical checks at 0.75 ns / fanout 10 limits; the v0.2 slew problem recurs at scale on the slow corners; see "What limits the clock" |
| Power (ESTIMATE, no VCD) | 4.92 mW at nom_tt with the flow's default activity (internal 4.37, switching 1.43, leakage 1.2 µW; 4.15–5.80 mW over the 9 corners); **6.53 mW** at nom_tt with a uniform 0.1 toggle activity (`physical/analyze_run.py`) |
| Energy per inference (ESTIMATE, upper bound) | whole-chip 6.53 mW × 42 cycles / 10 MHz = **≤ 27 nJ** (18 cycles for the linear model: ≤ 12 nJ); the decoder is 33.6 % of the cell area; per-block attribution needs activity from simulation (gap G5) |
| Worst setup path | register `u_core.cfg_bist_en` → register `u_core.u_ai.frame_x[38]`: 155 stages, 97.8 ns at max_ss = BIST input mux → channel-state read → biquad (5 Booth multipliers, 35-bit sum, round/saturate) → square → 48-bit accumulate → barrel shift/saturate → log quantiser → collector; cell-by-cell listing in `physical/REPORT_v04_layout.md` |
| Faster attempt | `v04_11mhz` (90 ns): **fails** at max_ss by −2.87 ns on the same chain; 10 MHz is the limit of this RTL |
| Runtime / memory | 24.5 min, peak 3.6 GiB in the VM (slew-repair margins ≥ 45 % run out of memory) |
| Area split (SYNTH, hierarchical) | readout core 55 %, AI decoder 33.6 % (model store 11 %, MLP engine 8.2 %, frame collector 5.4 %), BIST 2.7 %, serial wrappers 4 % |

The chip at 10 MHz accepts one sample per clock (10 MS/s against the intended 8 × 30 kS/s = 0.24 MS/s) and one
inference per 42 clocks (4.2 µs, far below the 42 ms window at 3 kS/s), so the 10 MHz result is functionally
sufficient for the bench test vehicle; it is not the architecture's speed limit, which is set by the single-cycle
biquad (next section).

## v0.3 readout core alone (`hbci_readout_core`, runs `v03_10mhz`, `v03_10mhz_m`, `v03_20mhz`, `v03_40mhz`)
| Run | Clock | Setup worst (max_ss) | Result |
|---|---|---:|---|
| `v03_40mhz` | 40 MHz | — | flow failed (exit 1) at timing repair |
| `v03_20mhz` | 20 MHz | −21.68 ns (783 violations, TNS −1,494 ns) | **not met**: +3.1 ns at tt only |
| `v03_10mhz` | 10 MHz | −3.56 ns (84 violations) | not met at ss with default margins |
| `v03_10mhz_m` (published) | **10 MHz** | **+0.72 ns**, hold +0.10 ns, 0 violations | met at all 9 corners with 6 / 5 ns resizer margins |

`v03_10mhz_m`: die 788.8 × 799.6 µm (0.631 mm²), 34,902 standard cells (3,283 flops, 8,112 repair buffers of
which 3,399 for hold, 603 clock cells), 307,565 µm² cell area, 51 % utilisation, DRC/LVS/antenna/XOR 0,
4,119 slew (max_ss), 4 fanout and 4 capacitance violations; reset tree 744 buffers in 12 levels; no global-routing
overflow; `v03_40mhz` ran out of memory (32 GiB) in repair_design. Its worst path runs from the input port
`in_channel[1]` through the channel-state read mux, the five Booth multipliers and 35-bit sum, round/saturate,
square, 48-bit accumulate, barrel shift and saturate to the output port `ai_feat_energy[16]` in one cycle
(106 stages, 58.8 ns of cell delay at max_ss): in the stand-alone core the feature tap is a combinational
input-to-output path carrying both 20 % I/O budgets; the register-to-register limit of the same netlist is 55.9 ns
at max_ss (17.9 MHz). Power: the flow's default-activity figure (494 mW) is an activity-propagation artefact on
217 unconstrained output ports and is not used; a uniform 0.1 toggle activity gives 3.33 mW at nom_tt (ESTIMATE).
SYNTH area split: record mux 37 %, feature state 24 %, biquad 20 %, legacy core 11 %, band energy 5.5 %.

## What limits the clock
The v0.3 DSP evaluates, in one cycle, the channel-state read mux → five 16×16 products → 35-bit adder tree →
round/saturate → square → 48-bit accumulate → write-back mux. At the slow corner that is roughly 90 ns of logic
after repair. Neither the decoder (one 8×8 product + 34-bit add per cycle, 46-way read mux, CRC byte step) nor
the SPI logic is near the limit. Raising the clock to the v0.2 level (40 MHz) requires pipelining the biquad
(register the products, add in the next cycle, one-cycle write-back delay with a same-channel bypass) and
registering the energy square: an RTL change with a golden-model change, deliberately not made in this pass
(`docs/DSP_OPTIMISATION.md` §1). The 10 MHz design meets every functional requirement of the bench chip.

## Acceptance against the mandate's checks
| Check | HBCI-02 at 10 MHz |
|---|---|
| Unresolved DRC / LVS / antenna | 0 / 0 / 0 |
| Timing closure across corners | setup and hold met at 9 corners |
| Unreviewed slew / cap / fanout | **10,666 slew, 138 fanout open** (0 cap): on the ss corners, data buffer trees beyond 0.75 ns; setup still met with margin. Reviewed, not fixed; the fix is the biquad pipeline plus tighter slew repair (60 % repair OOM-ed in the v0.2 study) |
| Power grid, clock distribution | generated by the flow (met4/met5 straps, CTS with 1,207 cells); IR drop not evaluated with pad locations |
| Timing constraints and I/O assumptions | `physical/openlane/hbci02_chip_top/*.sdc` (documented) |
| RTL-to-netlist functional verification | generic netlist cycle-exact (VERIFICATION.md); routed netlist **not simulated** (gap G4) |
| Missing for foundry sign-off | padframe/ESD ring, IR-drop with pads, routed-netlist simulation, foundry DRC deck (open PDK rules only), antenna with the real I/O cells, packaging |
