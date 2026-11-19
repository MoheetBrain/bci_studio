// Two-level names for the hardware blocks: an understandable name for Learn mode and the literal Verilog
// instance / module for Expert mode. RTL names are never renamed; this only adds a plain-language layer.
// Every entry was checked against rtl/hbci_readout_core.v and rtl/hbci_event_core.v (port lists and
// assignments). Where a block does something narrower than its name suggests, `note` says so.
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';

export interface BlockName {
  /** Plain-language name (Learn mode headline). */
  friendly: string;
  /** Short plain name that fits on a die tile. */
  short: string;
  /** Literal Verilog instance (or net) name, shown in monospace. */
  inst: string;
  /** Verilog module the instance is of ('' for top-level nets). */
  module: string;
  /** One sentence: what it does, in plain words. */
  oneLine: string;
  /** What kind of thing it is in the RTL. */
  what: 'instance' | 'top-level logic' | 'top module' | 'pad (concept)';
  note?: string;
}

export const BLOCK_NAMES: Record<string, BlockName> = {
  'rtl.readout': {
    short: 'Readout chip', friendly: 'Readout chip (v0.3 top level)', inst: 'hbci_readout_core', module: 'hbci_readout_core', what: 'top module',
    oneLine: 'The whole v0.3 digital readout core: it wraps every block below and drives the output record stream.',
  },
  'rtl.core': {
    short: 'Legacy event detector', friendly: 'Legacy event-detection subsystem', inst: 'u_event', module: 'hbci_event_core', what: 'instance',
    oneLine: 'The unchanged v0.2 spike detector, kept as the EVENT comparator.',
  },
  'rtl.u_state': {
    short: 'Event memory', friendly: 'Event memory (per-channel state)', inst: 'u_state', module: 'hbci_channel_state', what: 'instance',
    oneLine: 'Remembers each channel\'s baseline, armed and primed flags and refractory count between samples.',
  },
  'rtl.u_baseline': {
    short: 'Background tracker', friendly: 'Background tracker (EMA baseline + residual)', inst: 'u_baseline', module: 'hbci_baseline_ema', what: 'instance',
    oneLine: 'Follows the slow background level and reports how far the new sample sits from it.',
  },
  'rtl.u_threshold': {
    short: 'Threshold comparator', friendly: 'Threshold comparator', inst: 'u_threshold', module: 'hbci_threshold_detector', what: 'instance',
    oneLine: 'Asks one question: is the size of the residual at or above the threshold?',
  },
  'rtl.u_refractory': {
    short: 'Re-trigger guard', friendly: 'Re-trigger guard (hysteresis + refractory)', inst: 'u_refractory', module: 'hbci_refractory_ctrl', what: 'instance',
    oneLine: 'Lets a channel fire only when armed and not in its refractory pause, so one spike is not reported many times.',
  },
  'rtl.u_timestamp': {
    short: 'Event index', friendly: 'Event sample index (timestamp)', inst: 'u_timestamp', module: 'hbci_timestamp', what: 'instance',
    oneLine: 'Counts accepted samples inside the legacy core; an event\'s timestamp is the index of its crossing sample.',
  },
  'rtl.u_packer': {
    short: 'Event packet', friendly: 'Event packet builder (one-slot output)', inst: 'u_packer', module: 'hbci_event_packer', what: 'instance',
    oneLine: 'Holds one finished event {channel, timestamp, polarity, magnitude} until it is taken.',
  },
  'rtl.u_fstate': {
    short: 'Feature memory', friendly: 'Feature memory (filter history + energy so far)', inst: 'u_fstate', module: 'hbci_feature_state', what: 'instance',
    oneLine: 'For each channel: the previous two inputs and outputs of the filter, the energy accumulator, the window counter and a saturation flag.',
  },
  'rtl.u_biquad': {
    short: 'Band-pass filter', friendly: 'Digital band-pass filter', inst: 'u_biquad', module: 'hbci_biquad', what: 'instance',
    oneLine: 'A weighted sum of five numbers (multiplies and adds), then rounding and saturation: it keeps the 70–150 Hz band.',
  },
  'rtl.u_energy': {
    short: 'Band energy', friendly: 'Band-energy calculator', inst: 'u_energy', module: 'hbci_band_energy', what: 'instance',
    oneLine: 'Squares each filtered sample, adds it to the window total and emits the total at the end of the window.',
  },
  'rtl.u_records': {
    short: 'Output traffic controller', friendly: 'Output traffic controller', inst: 'u_records', module: 'hbci_record_mux', what: 'instance',
    oneLine: 'Three pending registers, a priority arbiter and a 16-deep FIFO put RAW, EVENT and FEATURE records into one ordered stream and count every drop.',
  },
  'rtl.raw_path': {
    short: 'RAW gate', friendly: 'RAW gate (top-level logic, not a module)', inst: 'raw_gen', module: '', what: 'top-level logic',
    oneLine: 'raw_gen = accept & session & (mode is RAW or HYBRID): a few gates in the top level that decide whether a sample becomes a RAW record.',
    note: 'There is no RAW module: raw_gen is a net in hbci_readout_core plus the RAW pending register inside u_records.',
  },
  'rtl.u_ts': {
    short: 'Sample counter', friendly: 'Global sample counter + rejection count', inst: 'u_ts', module: 'hbci_timestamp', what: 'instance',
    oneLine: 'Counts every accepted sample (that count is the sample index stamped on RAW and FEATURE records) and every rejected out-of-range channel.',
    note: 'Same Verilog module as u_timestamp inside the legacy core (hbci_timestamp, defined in rtl/hbci_event_core.v), instantiated a second time at the v0.3 top.',
  },
  'die.pads': {
    short: 'Contact pads', friendly: 'Contact pads (illustrative)', inst: 'top-level ports', module: 'hbci02_digital_top', what: 'pad (concept)',
    oneLine: 'Where wires would join the die to its package. The ports are real; these squares are not an engineered pad ring.',
  },
  // ── v0.4 HBCI-02 ──
  'rtl.top04': {
    short: 'Chip logic (v0.4 top)', friendly: 'Integrated chip logic (v0.4 top level)', inst: 'hbci02_digital_top', module: 'hbci02_digital_top', what: 'top module',
    oneLine: 'DSP core + on-chip AI decoder + register file + self-test, wired together with the register bus.',
  },
  'rtl.regs': {
    short: 'Register file', friendly: 'Register file (host mailboxes)', inst: 'register decode', module: '', what: 'top-level logic',
    oneLine: 'Address decode for the 8-bit register map: configuration, model words, CRC, counters, diagnostics and the prediction FIFO head.',
    note: 'There is no register module: the decode is written directly in hbci02_digital_top (rtl/hbci02_digital_top.v).',
  },
  'rtl.u_bist': {
    short: 'Self-test', friendly: 'Built-in self-test (LFSR + MISR)', inst: 'u_bist', module: 'hbci_bist', what: 'instance',
    oneLine: 'Feeds a deterministic pseudo-random stream in and folds every record and prediction into one signature with a known answer.',
  },
  'rtl.ai': {
    short: 'On-chip AI decoder', friendly: 'On-chip AI decoder (v0.4)', inst: 'u_ai', module: 'hbci_ai_decoder', what: 'instance',
    oneLine: 'Quantises each window energy, collects one frame per window index, and runs a small CRC-protected neural network on it.',
  },
  'rtl.ai_quant': {
    short: 'Quantiser', friendly: 'Feature quantiser (64·log2, int8)', inst: 'u_quant', module: 'hbci_feat_quant', what: 'instance',
    oneLine: 'Logarithm, per-channel centre and shift, clip to one signed byte.',
  },
  'rtl.ai_collect': {
    short: 'Frame collector', friendly: 'Frame collector (same window index)', inst: 'u_collect', module: 'hbci_frame_collector', what: 'instance',
    oneLine: 'One value from every required channel, all from the same window number; every loss counted.',
  },
  'rtl.ai_model': {
    short: 'Model store (CRC)', friendly: 'Model store (46 words, CRC-32 verified)', inst: 'u_model', module: 'hbci_model_store', what: 'instance',
    oneLine: 'The network\'s 46 parameter words and the checksum check that gates every prediction.',
  },
  'rtl.ai_engine': {
    short: 'MLP engine', friendly: 'MLP engine (8 → NH → NO)', inst: 'u_engine', module: 'hbci_mlp_engine', what: 'instance',
    oneLine: 'Multiply-accumulate on one shared multiplier, ReLU with a shift, argmax and margin.',
  },
  'rtl.ai_fifo': {
    short: 'Prediction FIFO', friendly: 'Prediction FIFO + pending register', inst: 'pred FIFO', module: 'hbci_ai_decoder', what: 'top-level logic',
    oneLine: 'Four finished predictions waiting for the host; the one-slot frame register in front of the engine; counters and diagnostics.',
    note: 'Top-level logic of hbci_ai_decoder (rtl/hbci_ai_decoder.v lines 660–767), not a separate module.',
  },
};

/** Instance name → registry id (v0.3 and legacy), plus u_ts and $raw. */
export const INST_TO_ID: Record<string, string> = {
  u_event: 'rtl.core', u_state: 'rtl.u_state', u_baseline: 'rtl.u_baseline', u_threshold: 'rtl.u_threshold',
  u_refractory: 'rtl.u_refractory', u_timestamp: 'rtl.u_timestamp', u_packer: 'rtl.u_packer',
  u_fstate: 'rtl.u_fstate', u_biquad: 'rtl.u_biquad', u_energy: 'rtl.u_energy', u_records: 'rtl.u_records',
  $raw: 'rtl.raw_path', u_ts: 'rtl.u_ts',
  // v0.4 (hbci02_digital_top and hbci_ai_decoder scopes)
  u_readout: 'rtl.readout', u_ai: 'rtl.ai', u_bist: 'rtl.u_bist', $regs: 'rtl.regs',
  u_quant: 'rtl.ai_quant', u_collect: 'rtl.ai_collect', u_model: 'rtl.ai_model', u_engine: 'rtl.ai_engine', $fifo: 'rtl.ai_fifo',
};

/** Friendly name of an instance ('' = top-level ports, '$out' = top-level outputs). */
/** Short block name for tight diagram labels (the friendly name goes in the tooltip). */
export function instShort(inst: string): string {
  if (inst === '' || inst === '$in') return 'Chip inputs';
  if (inst === '$out') return 'Chip outputs';
  const id = INST_TO_ID[inst];
  return (id && BLOCK_NAMES[id]?.short) || inst;
}

export function instFriendly(inst: string): string {
  if (inst === '' || inst === '$in') return 'Chip inputs (top-level ports)';
  if (inst === '$out') return 'Chip outputs (top-level ports)';
  const id = INST_TO_ID[inst];
  return (id && BLOCK_NAMES[id]?.friendly) || inst;
}

/** Learn mode shows the friendly name first; Expert (Inspect) shows the instance first. */
export function useExpert(): boolean {
  return useScene((s) => s.uiMode === 'inspect');
}

/** Names for a registry id, falling back to the registry name. */
export function namesFor(id: string): { primary: string; secondary: string; mono: 'primary' | 'secondary' | null; expert: boolean } {
  const n = BLOCK_NAMES[id];
  const expert = useScene.getState().uiMode === 'inspect';
  if (!n) return { primary: COMPONENTS[id]?.name ?? id, secondary: '', mono: null, expert };
  const lit = n.module && n.module !== n.inst ? `${n.inst} · ${n.module}` : n.inst;
  return expert
    ? { primary: lit, secondary: n.friendly, mono: 'primary', expert }
    : { primary: n.friendly, secondary: lit, mono: 'secondary', expert };
}

/** Prefix glossary shown in the tiny expandable glossary. */
export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: 'u_', meaning: 'one particular instance (copy) of a module, e.g. u_biquad is the instance of module hbci_biquad' },
  { term: 'cfg_', meaning: 'configuration input: set by the host, quasi-static (thresholds, filter coefficients, mode)' },
  { term: 'in_', meaning: 'input sample stream (in_valid, in_channel, in_sample)' },
  { term: 'rec_', meaning: 'output record stream (rec_valid, rec_ready, rec_type, rec_data …)' },
  { term: 'stat_', meaning: 'status counter output (samples, rejected, drops, FIFO high-water mark)' },
  { term: '_gen', meaning: 'a "generate a record now" pulse: raw_gen, event_gen, feat_gen' },
  { term: 'rd_ / wr_', meaning: 'read port / write port of a per-channel memory' },
  { term: 'ai_feat_ / feat_', meaning: 'the FEATURE tap into the on-chip decoder: channel, energy, timestamp, saturation flag, window index' },
  { term: 'pred_', meaning: 'prediction FIFO head and direct pins (class, margin, ts, frame_id, seq, flags, strobe)' },
  { term: 'reg_', meaning: 'register bus (addr, wdata, we, re, rdata): the host\'s way to configure the chip and read it' },
  { term: 'model_ / crc_', meaning: 'the 46-word model store and its CRC-32 verification' },
  { term: '[15:0]', meaning: 'a bus of 16 wires (bits 15 down to 0); one wire = one bit' },
];
