// Engineering artifacts generated from the real hardware flow (`make artifacts`) into
// studio/public/artifacts/. Contract between the hardware flow and the studio.
// Every file is optional at runtime: views must show "artifact missing" instead of faking data.

/** manifest.json */
export interface Manifest {
  generated_at: string;           // ISO time
  git_rev: string;                // short hash of the RTL commit the artifacts came from
  tools: Record<string, string>;  // e.g. { yosys: "Yosys 0.70+157", iverilog: "...", verilator: "..." }
  files: string[];                // artifact file names present
}

/** verification.json — results of the self-checking testbench(es). */
export interface Verification {
  simulator: string;
  ran_at: string;
  suites: {
    name: string;                 // e.g. "tb_hbci_event_core"
    status: 'pass' | 'fail';
    checks: number;
    errors: number;
    tests: { id: string; name: string; category: string; status: 'pass' | 'fail'; detail?: string }[];
  }[];
  lint?: { tool: string; warnings: number; errors: number; messages: string[] };
}

/** rtl_modules.json — module/port/instance structure derived from Yosys + source slicing. */
export interface RtlPort { name: string; dir: 'input' | 'output' | 'inout'; width: number; signed?: boolean }
export interface RtlInstance { name: string; module: string }
export interface RtlModule {
  name: string;                   // Verilog module name (unparameterised)
  file: string;                   // repo-relative path
  line_start: number;
  line_end: number;
  ports: RtlPort[];
  instances: RtlInstance[];
  source: string;                 // exact source text of the module
}
/** Connection between two instance ports of the top module (from the hierarchical netlist). */
export interface RtlConnection {
  from: { inst: string; port: string };   // inst "" = top-level port
  to: { inst: string; port: string };
  net: string;                            // net name in the top module
  width: number;
}
export interface RtlModules {
  top: string;
  modules: RtlModule[];
  connections: RtlConnection[];
  /** v0.3: hbci_readout_core instance connections (top/connections above stay those of hbci_event_core). */
  v03?: { top: string; connections: RtlConnection[] };
  /** v0.4 (HBCI-02): hbci02_digital_top instance connections and, nested, the decoder's own. */
  v04?: { top: string; connections: RtlConnection[]; ai: { top: string; connections: RtlConnection[] } };
}

/** synth_stats.json — generic Yosys synthesis statistics. */
export interface SynthModuleStats {
  module: string;
  cells: number;                  // total including submodules
  flops: number;
  cell_types: Record<string, number>;
}
export interface SynthStats {
  flow: string;                   // exact yosys script summary, e.g. "synth -top hbci_event_core (generic gates)"
  note: string;                   // honesty note
  modules: SynthModuleStats[];
}

/** schematics.json — index of RTL-derived schematic SVGs (netlistsvg) and their JSON netlists. */
export interface SchematicEntry {
  id: string;                     // e.g. "hbci_threshold_detector.rtl", "hbci_refractory_ctrl.gates"
  module: string;
  kind: 'rtl' | 'gates';          // rtl = coarse cells ($ge, $sub, $mux); gates = $_AND_ ... after techmap
  params: Record<string, number>; // parameter overrides (e.g. reduced width for readability)
  reduced: boolean;               // true if parameters differ from the shipped core
  svg: string;                    // file name under artifacts/schematics/
  netlist: string;                // yosys write_json output under artifacts/schematics/
  cells: number;
  note?: string;
}
export interface Schematics { entries: SchematicEntry[] }

/**
 * rtl_trace.json — a deterministic 8-channel scenario run through the real RTL with Icarus.
 * `samples` is logged by the testbench at every accepted sample, using hierarchical references
 * to internal signals, so each row is the actual RTL value, not a recomputation.
 */
export interface TraceSample {
  i: number;        // global accepted-sample index (== timestamp)
  cycle: number;    // clock cycle number
  ch: number;
  x: number;        // in_sample (signed)
  base: number;     // stored baseline (Q16.8 raw integer) before update
  res: number;      // residual (signed)
  mag: number;      // |residual|
  above: 0 | 1;
  rearm: 0 | 1;     // below_rearm
  armed: 0 | 1;     // stored armed flag before update
  refr: number;     // stored refractory count before update
  primed: 0 | 1;
  fire: 0 | 1;
}
export interface TraceEvent { i: number; cycle: number; ch: number; ts: number; pol: 0 | 1; mag: number }
export interface GroundTruthSpike { i: number; ch: number; amp: number }   // injected spike positions
export interface WaveSignal { name: string; width: number; changes: [number, number][] } // [cycle, value]
export interface RtlTrace {
  scenario: string;
  seed: number;
  config: { threshold: number; hysteresis: number; refractory: number; alpha_shift: number };
  num_samples: number;
  samples: TraceSample[];
  events: TraceEvent[];
  ground_truth: GroundTruthSpike[];
  waves: WaveSignal[];            // a subset of VCD signals, sampled per clock
  vcd_file: string;               // path of the full VCD in the repo build dir
}

/** sky130_stats.json — optional technology mapping to the SKY130 HD library (make sky130). */
export interface Sky130Stats {
  generated_at: string;
  library: string;
  corner: string;
  library_source: string;
  library_sha256: string;
  flow: string;
  yosys: string;
  cells: number;
  flops: number;
  cell_area_um2: number;
  sequential_area_um2: number;
  cell_types: Record<string, number>;
  note: string;
}

/** layout/layout_summary.json — genuine place-and-route result (make layout). Absent until a flow completes. */
export type CheckStatus = 'pass' | 'fail' | 'not run';
export interface LayoutCorner {
  corner: string;
  setup_ws_ns: number | null;
  setup_tns_ns: number | null;
  hold_ws_ns: number | null;
  hold_tns_ns: number | null;
  setup_violations: number | null;
  hold_violations: number | null;
  max_slew_violations: number | null;
  max_cap_violations: number | null;
}
export interface LayoutImage {
  file: string;
  caption: string;
  width_px: number;
  height_px: number;
  region_um: [number, number, number, number];   // x0, y0, x1, y1 of the rendered window
}
/** One LibreLane run of this design (the published one and any exploration runs kept under build/openlane/). */
export interface LayoutAttempt {
  run_tag: string;
  clock_mhz: number;
  overrides: string[];            // flow knobs that differ from LibreLane defaults, read from that run's resolved.json
  setup_ws_ns: number | null;     // worst over all STA corners
  setup_tns_ns: number | null;
  hold_ws_ns: number | null;
  max_slew_violations: number | null;
  drc_lvs_clean: boolean;         // Magic + KLayout DRC, Netgen LVS and antenna all zero
  published: boolean;             // true for the run whose views are in artifacts/layout/
}
export interface LayoutSummary {
  generated_at: string;
  evidence: 'LAYOUT';
  status: 'complete' | 'failed';
  design: string;
  flow: { name: string; librelane: string; lineage: string; run_tag: string; steps: number; exit_code: number; host: string };
  tools: Record<string, string>;
  pdk: { name: string; scl: string; open_pdks_rev: string; default_corner: string; sta_corners: string[] };
  constraints: {
    clock_port: string; clock_period_ns: number; clock_mhz: number; core_util_pct: number; target_density_pct: number;
    aspect_ratio: number; io_delay_pct: number; clock_uncertainty_ns: number; clock_transition_ns: number;
    timing_derate_pct: number; max_transition_ns: number; max_fanout: number; reset: string; pin_placement: string;
    routing_layers: string; synthesis: string; config_file: string; sdc_file: string;
  };
  die: { width_um: number; height_um: number; area_um2: number; bbox_um: number[] };
  core: { width_um: number; height_um: number; area_um2: number; bbox_um: number[] };
  cells: { total: number; stdcell: number; sequential: number; by_class: Record<string, number> };
  area: { instance_um2: number; stdcell_um2: number; utilization_pct: number };
  timing: {
    corner: string;
    setup_ws_ns: number | null; setup_wns_ns: number | null; setup_tns_ns: number | null;
    hold_ws_ns: number | null; hold_wns_ns: number | null; hold_tns_ns: number | null;
    note: string;
    corners: LayoutCorner[];
  };
  power: {
    label: 'ESTIMATE';
    corner: string;                       // corner of the headline numbers (the default corner)
    total_mw: number; internal_mw: number; switching_mw: number; leakage_mw: number;
    by_corner_mw: Record<string, number>; // total per STA corner
    method: string;
  };
  routing: { wirelength_um: number | null; vias: number | null };
  checks: {
    drc: { status: CheckStatus; magic_errors: number | null; klayout_errors: number | null; detailed_route_errors: number | null };
    lvs: { status: CheckStatus; errors: number | null; device_difference: number | null; net_difference: number | null; unmatched_pins: number | null };
    antenna: { status: CheckStatus; violating_nets: number | null; violating_pins: number | null };
    xor: { status: CheckStatus; differences: number | null };
    timing: { status: CheckStatus; setup_violations: number | null; hold_violations: number | null };
    electrical: { max_slew_violations: number | null; max_cap_violations: number | null; max_fanout_violations: number | null };
  };
  images: LayoutImage[];
  files: Record<string, number>;   // published file -> size in bytes
  attempts: LayoutAttempt[];
  note: string;
}

// ───────────────────────────── v0.3 readout core (docs/V03_READOUT_SPEC.md) ──
export type RecordTypeCode = 0 | 1 | 2; // 0 RAW, 1 EVENT, 2 FEATURE
export interface V03Record { type: RecordTypeCode; ch: number; seq: number; ts: number; data: number; flags: number; cycle: number }
export interface V03RunStats {
  samples: number; rejected: number; drop_raw: number; drop_event: number; drop_feature: number;
  event_missed: number; fifo_hwm: number; record_bits: number;
}
export interface V03Sample { i: number; cycle: number; ch: number; x: number; y: number; ysat: 0 | 1; acc: number; cnt: number; done: 0 | 1 }
/** rtl_trace_v03.json — one stimulus run through hbci_readout_core once per mode (actual Icarus values). */
export interface RtlTraceV03 {
  scenario: string;
  seed: number;
  profile: { num_channels: number; sample_rate_hz: number; sample_bits: number };
  config: {
    threshold: number; hysteresis: number; refractory: number; alpha_shift: number;
    b0: number; b1: number; b2: number; a1: number; a2: number; win_log2: number; energy_shift: number;
  };
  num_samples: number;
  samples: V03Sample[];
  runs: Record<'EVENT' | 'RAW' | 'FEATURE' | 'HYBRID', { records: V03Record[]; stats: V03RunStats }>;
  ground_truth: {
    channels: { ch: number; description: string }[];
    bursts: { ch: number; i0: number; i1: number; f_hz: number; amp: number }[];
    spikes: { ch: number; i: number; amp: number }[];
  };
  waves: { name: string; width: number; signed?: boolean; changes: [number, number][] }[];
  rtl_sha256: string;
  vcd_file: string;
}

// ───────────────────────────── v0.4 HBCI-02 integrated top with the on-chip AI decoder (docs/AI_DECODER.md) ──
/** One accepted sample of the v0.4 run (RTL). */
export interface V04Sample { i: number; cycle: number; ch: number; x: number }
/** One completed FEATURE window as seen on the ai_feat_* tap, with the quantiser's L and x for it (RTL). */
export interface V04Feature { cycle: number; ch: number; energy: number; ts: number; sat: 0 | 1; win: number; L: number; x: number }
/** One complete frame leaving the collector (RTL). */
export interface V04Frame { frame_id: number; ts_first: number; ts_last: number; complete_cycle: number; x: number[]; sat_mask: number }
/** One inference of the MLP engine with its diagnostics (RTL). */
export interface V04Inference {
  frame_id: number; start_cycle: number; done_cycle: number; aborted: number | null; ts: number;
  x: number[]; h: number[]; logits: number[]; cls: number; margin: number; sat_mask: number;
}
/** One prediction record popped from the 4-deep FIFO over the register bus (RTL). */
export interface V04Prediction { cycle: number; cls: number; margin: number; ts: number; frame: number; seq: number; flags: number }
export interface V04Model {
  NH: number; NO: number; linear: 0 | 1; s1: number; model_id: number;
  W1: number[][]; W2: number[][]; b1: number[]; b2: number[]; centre: number[]; qshift: number[];
  words: number[]; crc32: number;
}
/**
 * rtl_trace_v04.json (synthetic teaching stream, placeholder model) or rtl_trace_v04_real.json (recorded stream,
 * trained model): one stimulus run through hbci02_digital_top with Icarus. Every value is the RTL's.
 */
export interface RtlTraceV04 {
  scenario: string;
  seed: number;
  source: {
    stream: { kind: string; label: string; description?: string; file?: string | null; [k: string]: unknown };
    /** `metrics` (when present) are SOFTWARE evaluation results of the exported model (experiments/E02), not RTL. */
    model: { label: string; trained: boolean; file?: string | null; git_rev?: string; channels?: number[]; metrics?: Record<string, Record<string, number>>; [k: string]: unknown };
  };
  /** sample_rate_hz is null for a recorded stream whose rate the trace does not carry. */
  profile: { num_channels: number; sample_rate_hz: number | null; sample_bits: number };
  config: {
    threshold: number; hysteresis: number; refractory: number; alpha_shift: number;
    b0: number; b1: number; b2: number; a1: number; a2: number; win_log2: number; energy_shift: number;
    mode: string; ch_mask: number; frame_span: number;
  };
  model: V04Model;
  num_samples: number;
  samples: V04Sample[];
  features: V04Feature[];
  frames: V04Frame[];
  inferences: V04Inference[];
  predictions: V04Prediction[];
  records: { counts: Record<string, number>; total: number };
  counters: Record<string, number>;
  latency: { frame_complete_to_engine_start: number; engine_start_to_fifo: number; formula: string };
  evidence: Record<string, string>;
  /** null for a recorded stream (no synthetic ground truth). */
  ground_truth: {
    channels: { ch: number; description: string }[];
    bursts: { ch: number; i0: number; i1: number; f_hz: number; amp: number }[];
    spikes: { ch: number; i: number; amp: number }[];
  } | null;
  rtl_sha256: string;
  vcd_file: string;
  checks: { passed: number; total: number };
}
