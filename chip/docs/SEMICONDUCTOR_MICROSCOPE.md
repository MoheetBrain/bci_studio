# Semiconductor microscope (studio, MY CHIP)

The MY CHIP part of the studio is a zoomable microscope for the HBCI-01 v0.3 readout chip. It goes from the whole
die down to one transistor. Each zoom level shows what kind of evidence it is drawn from. Where an artifact does
not exist, the level says so instead of drawing something plausible.

Run it: `cd studio && npm run dev`, then open <http://127.0.0.1:5180/> and click **My chip**.

## Zoom levels

| Level | Opens from | Header (display mode) | Drawn from | Real | Drawn for clarity |
|---|---|---|---|---|---|
| 0 Die map | Package → **Explore inside** | LOGICAL BLOCK MAP — REAL RTL, CONCEPTUAL PLACEMENT | `rtl_modules.json`, `synth_stats.json`, `rtl_trace_v03.json` | block identities, ports, netlist connections, cell counts (tile area), record counts | positions, shapes, copper routes, white pads, FIFO animation |
| RTL circuit | die → readout/core tile | RTL CIRCUIT | `rtl_modules.json` (v03 connections) | instances and the nets between them | box layout |
| 1 Module | die tile → **Explore inside** (camera flies in) | MODULE DATAFLOW — REAL PORTS, SIMPLIFIED INSIDE | `rtl_modules.json`, `moduleSpecs.ts`, Verilog | every port (name, width, signedness, direction), the block at the other end, values at the sample cursor | the operator boxes inside the block (each one links to its Verilog lines) |
| 2 One sample | module → **One sample, step by step** | ONE SAMPLE — ACTUAL RTL TRACE VALUES | `rtl_trace_v03.json` (v0.2 blocks: `rtl_trace.json`) | traced values (RTL), history read back from earlier samples (DERIVED), configuration (CONFIG) | the order of the five steps |
| 3 Gates | module → **Its gates** | SYNTHESISED GATES | `schematics/*.json/svg` (Yosys + netlistsvg) | generic gates mapped by Yosys, source-line mapping | reduced widths where marked |
| 4 Cell | gates → **Next: a real standard cell** | STANDARD CELL — SKY130 PDK DATA / TRANSISTOR TUTORIAL — EDUCATIONAL | `artifacts/cells/*.json` (GDS of the v0.2 layout + SKY130 PDK) | polygons of `sky130_fd_sc_hd__nand2_2` / `inv_2`, layer names, SPICE transistors | tutorial tab: idealised switches |
| 5 Layout | cell → **See the whole v0.2 layout** | PHYSICAL LAYOUT — v0.2 ONLY | `artifacts/layout/` (LibreLane run on the v0.2 event core) | the placed-and-routed v0.2 event core, timing, power estimate | nothing; v0.3 is **NOT AVAILABLE FOR v0.3** |

Back (Esc or the breadcrumb) steps outward one level, and from the module view **◀ Die map** goes straight back.
After a fly-in, the die re-frames to the whole map whichever way you return. Top/Front/Iso, Fit and Reset sit in
the 3D toolbar and **F** fits the selection.

Values carry a provenance tag: **RTL** (from the Icarus VCD), **DERIVED** (read from an earlier sample of the same
channel), **CONFIG** (a configuration register), **COMPUTED** (recomputed in the browser and checked against the
trace) and **NO TRACE** (not recorded, for example any gate-level value).

## Colours and marks on the die

- **Coloured tile:** one Verilog instance. The colour only tells blocks apart: blue/green/amber/red/violet/cyan for the
  legacy event blocks (`u_state` … `u_packer`), teal/green for the feature path (`u_fstate`, `u_biquad`, `u_energy`),
  brown for the output controller (`u_records`), cyan for the RAW gate, violet for the sample counter (`u_ts`). The
  position is not a floorplan (CONCEPTUAL POSITION); the area follows synthesised cell counts.
- **Lit frame:** the path makes records in the chosen `cfg_mode` (EVENT amber, RAW cyan, FEATURE green, HYBRID teal).
- **Copper/orange line:** a real netlist connection, drawn as a route. Path, length and thickness are not a
  fabricated wire. Click one for the signal inspector. **Triple line** = a bus (many wires).
- **Netlist lines** (legend switch): straight lines between the blocks the Yosys netlist connects; teal = v0.3 top,
  amber = inside the legacy event core. Clock and reset are not drawn.
- **White square:** an illustrative contact pad. Clicking one says **PIN MAPPING NOT ENGINEERED**, lists the ports
  grouped on that edge and shows a conceptual cross-section (pad, bond wire, die, substrate). The real chip has 33
  top-level ports (19 in, 14 out, 474 signal bits) and no pad ring.

## Names

Learn mode (default) shows the friendly name with the Verilog instance in monospace underneath; Expert mode
swaps them. `raw_gen` is top-level logic in `hbci_readout_core`, not a module. Prefixes: `u_` instance, `cfg_`
configuration input, `in_` sample input, `rec_` output record, `stat_` status counter (glossary in **What am I
looking at?**).

## Signal inspector

Click a route, a module port or a net. It shows: net name, driver and sink instance/port, width and signedness
(bit vs bus glyph), class (data, address, control, enable, handshake, state read/write, status, configuration), plain meaning, the value at the sample cursor with
its provenance, a 48-sample sparkline for that channel, the modes that use it, and **Follow this signal** to the
next block. While a signal is selected the rest of the die dims. The sample cursor (and **Show bits**) is shared
with the step-by-step view.

## Lessons

**Explore my chip · 7 lessons** (banner, Help menu or the overview inspector): bits and gates, a register and the
clock, a bus and a multiplexer, per-channel state, threshold + refractory, biquad + energy, output records. Each
lesson ends with an optional check question and has **Explain slower** and **Show source**. Good first stop:
`u_biquad`. Its multiply-and-accumulate is the operation AI accelerators repeat, but here it is one band-pass
filter, not an LLM accelerator.

## Regenerating the cell data

`make cells` runs `scripts/extract_cells.py`. It parses the v0.2 GDSII, takes layer names and transistor netlists
from the SKY130 PDK in the `hbci-eda` Lima VM (cached in `build/pdk/<rev>/`, gitignored) and writes
`studio/public/artifacts/cells/`. If the PDK cannot be read, those fields become `"unavailable"` with the reason.
The transistor gates found geometrically (poly over diffusion) match the SPICE devices in count, type and W×L.
That is a cross-check, not LVS.

## Limits (by design)

- No v0.3 place-and-route exists, so no v0.3 geometry is shown anywhere; level 5 is the v0.2 event core only.
- No gate-level simulation trace: gate values are NO TRACE.
- Pads, routes, tile positions and the FIFO animation are illustrative.
- The transistor tutorial is an idealised switch model (no resistance, capacitance or delay).
- Level 5 offers whole-layer groups (routing, devices, centre crop) rendered by KLayout. Per-layer toggles exist
  only in the level-4 cell view.

## Files

`studio/src/micro/`: `names.ts` (two-level names, glossary), `ViewModeBanner.tsx` (display modes, help card,
Focus), `signals.ts` + `SignalInspector.tsx`, `DieOverlays.tsx` (pad card, legend), `dieLook.ts` (die palette),
`module/` (levels 1–2), `gateExplain.ts` (level 3), `cell/` (level 4), `course/` (lessons), `useAutoFold.ts`
(folds the tree below 1600 px on the drawing levels), `microStore.ts`.

## v0.4 note (HBCI-02, on-chip AI decoder)

The die map (level 0) now shows `hbci02_digital_top`: the v0.3 readout core on the left, unchanged tile for tile, and
the on-chip AI decoder `u_ai` (`hbci_ai_decoder`) on the right as a raspberry-framed cluster with five tiles: quantiser
(`u_quant`), frame collector (`u_collect`), model store with CRC (`u_model`), MLP engine (`u_engine`) and the prediction
FIFO + pending register (top-level logic of the decoder). The register file (top-level logic of `hbci02_digital_top`)
and the BIST block sit in a strip above it. The decoder frame is lit in every `cfg_mode`: the FEATURE tap is not gated
by the mode. Routes, tile positions and the FIFO slots remain conceptual; tile areas follow `synth_stats.json`
(the FIFO and register-file tiles are "top minus submodules", labelled so). Netlist lines cover four scopes
(`rtl_modules.json` `connections`, `v03`, `v04`, `v04.ai`). The signal inspector reads v0.4 values from the frame
selected in the signal lab's **On-chip AI (v0.4)** tab (`rtl_trace_v04_real.json` or `rtl_trace_v04.json`); nets the
trace does not record per cycle read NO TRACE. The circuit level adds the v0.4 digital-top and decoder diagrams;
"Explore my chip" has an eighth lesson on the decoder. Level 5 now has one tab per genuine layout: the v0.2 event core
(`layout/`), the v0.3 readout core (`layout_v03/`, DSP only) and the v0.4 chip top `hbci02_chip_top` (`layout_v04/`);
a tab disables itself, saying why, when its artifact is absent. The die map never draws the layout's placement. Status and
screenshots: `docs/UI_V04_STATUS.md`, `docs/screenshots/v0.4/`.
