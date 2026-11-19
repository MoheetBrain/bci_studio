# Hamiltonian BCI Chip — HBCI-01

**Mission:** Level 4 integrated biological and artificial cognition. **v0.3 deliverable:** a
waveform-preserving, multichannel neural readout and representation processor, connected to an interactive 3D
engineering-and-learning studio.

> HBCI-01 exists to investigate how neural recordings can be processed and communicated efficiently without
> unnecessarily destroying information needed by downstream decoders.

v0.3 adds `hbci_readout_core`, which reads out digitised samples in four representations:

| Mode | What leaves the chip |
|---|---|
| **RAW** | Every digital sample entering the core, during an explicit capture session |
| **EVENT** | The unchanged v0.2 threshold-event core, kept as a comparator |
| **FEATURE** | Causal 70–150 Hz band-pass and per-window band energy |
| **HYBRID** | RAW + FEATURE, which **increases** payload |

Every record carries a per-type sequence number, so drops are never silent. Learned decoding, alignment and LLM
inference stay **external**. The chip's features are numbers, not semantic tokens or decoded thoughts.

Further reading:
- spec: `docs/V03_READOUT_SPEC.md`;
- research audit: `docs/RESEARCH_AUDIT.md`;
- shared model: `system/hbci_system.json`;
- feedback contract (software only): `docs/FEEDBACK_CONTRACT.md`;
- real-data test: `experiments/E01_ecog_vowel/`.

> **Provenance.** The v0.1 starter archive (`Hamiltonian_BCI_Chip_v0.1.zip`) was not available on this
> machine. v0.1 in this repository is a **reconstruction from the written brief** (2026-10-19), not the
> original files.

> **Scope.** This is not a complete BCI. Electrodes, low-noise analog front end, ADC, power, telemetry and
> implant packaging are **not implemented**. Never connect development hardware to biological tissue or a
> human participant.

## Legacy EVENT core (`rtl/hbci_event_core.v`, unchanged since v0.2)
| Module | Function |
|---|---|
| `hbci_event_core` | Top level: valid/ready sample input, valid/ready event output, status counters |
| `hbci_channel_state` | Per-channel register file: Q16.8 baseline, refractory counter, armed and primed flags |
| `hbci_baseline_ema` | EMA baseline `b += (x − b) >>> k` and residual `x − ⌊b⌋` (17-bit signed) |
| `hbci_threshold_detector` | `|residual| ≥ threshold` (0 disables); re-arm level `max(threshold − hysteresis, 1)` |
| `hbci_refractory_ctrl` | Fires only when armed and not refractory; loads the refractory counter on an event |
| `hbci_timestamp` | Counts accepted samples; an event's timestamp is the index of its crossing sample |
| `hbci_event_packer` | One-slot output register; input stalls while the slot is full, so no event is dropped |

No FIFO, radio, decoder or compression codec exists in this RTL. Event-only output is **lossy**: the raw
waveform cannot be recovered from it.

## Quick start
```bash
source scripts/env.sh                    # local toolchain on PATH (Node, Yosys, Icarus, Verilator)
make artifacts                           # all tests + lint + synthesis + schematics + trace -> studio artifacts
cd studio && npm install && npm run dev  # studio at http://localhost:5180
```

## Hardware flow (targets are documented at the top of the Makefile)
| Target | What it does |
|---|---|
| `make sim` | v0.1 directed testbench (15 checks) |
| `make test` | All suites: v0.1 and v0.2 directed tests, random regression vs the Python golden model, gate-level simulation of the synthesised netlist, scenario trace, mutation sanity, and v0.1/v0.2 Yosys equivalence |
| `make lint` | Verilator `-Wall` for the shipped, NUM_CH=6 and reduced parameter sets |
| `make synth` | Hierarchical generic Yosys synthesis → `synth_stats.json` |
| `make schematics` | Per-module RTL and gate schematics (netlistsvg) |
| `make trace` | 8-channel scenario through the RTL → `rtl_trace.json` and VCD |
| `make sky130` | Optional mapping to SKY130 HD standard cells, giving cell area only (see `docs/PHYSICAL.md`) |
| `make artifacts` | Everything above, written to `studio/public/artifacts/` |
| `make layout` | Genuine place and route: LibreLane (OpenLane 2) on SKY130 HD inside a Lima VM, with DRC, LVS, antenna and multi-corner STA → `studio/public/artifacts/layout/` (see `docs/PHYSICAL.md`) |

Results and limitations are in `docs/VERIFICATION.md` and `docs/PHYSICAL.md`; the current state is in
`BUILD_STATUS.md`.

Generic and SKY130 synthesis give gate counts and cell area only. Neither says anything about timing closure,
power, die size, or fabrication readiness. Those questions are answered only as far as `make layout` answers them:
open-source sign-off checks on a placed-and-routed block, with a power *estimate*, and no fabrication.

## Studio (`studio/`)
React, TypeScript, Vite, Three.js / React Three Fiber, React Flow and Zustand.

| Area | Contents |
|---|---|
| Top bar | Semantic zoom (System › Package › Die › Circuit › Gates › Physical Layout) and the evidence badge |
| Left | Component tree |
| Centre | The active viewport |
| Right | Engineering inspector |
| Bottom | Signal lab: DEMO model, or RTL Trace Mode |

Every view states its evidence:

| Label | Meaning |
|---|---|
| CONCEPT | Illustrative only |
| DEMO | Browser model |
| RTL | Simulated Verilog |
| SYNTH | Synthesised netlist |
| LAYOUT | Placed-and-routed SKY130 HD layout from `make layout` (GDSII); not fabricated |
| MEASURED | Measured on real hardware; none exists |
