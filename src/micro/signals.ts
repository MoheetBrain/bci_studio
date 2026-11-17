// Signal catalogue for the microscope: every net of the v0.3 readout core and of the legacy event core, built
// from rtl_modules.json (Yosys netlist connectivity), with a plain-language meaning, a signal class, and the
// source of any value shown for it. Values are only ever:
//   RTL     — read from the Icarus trace (rtl_trace_v03.json waves or per-sample fields),
//   DERIVED — reconstructed from trace values by a rule stated next to it (and cross-checked where possible),
//   CONFIG  — the constant configuration the RTL run used,
//   NO TRACE — nothing recorded it; no number is invented.
import type { RtlModules, RtlTraceV03, RtlTraceV04, V03Sample } from '../artifacts/types';
import type { NetScope } from './microStore';

export type SigClass = 'data' | 'address' | 'control' | 'clock' | 'reset' | 'enable' | 'state-read' | 'state-write'
  | 'handshake' | 'status' | 'config';

export const CLASS_LABEL: Record<SigClass, string> = {
  data: 'data', address: 'address (selects a channel)', control: 'control pulse', clock: 'clock', reset: 'reset',
  enable: 'enable', 'state-read': 'state read (memory → logic)', 'state-write': 'state feedback (logic → memory)',
  handshake: 'ready/valid handshake', status: 'status', config: 'configuration',
};

export interface NetEnd { inst: string; port: string }
export interface Net {
  net: string;
  scope: NetScope;
  width: number;
  signed: boolean;
  /** Where the value comes from: instance outputs or top-level ports (several = top-level glue logic). */
  drivers: NetEnd[];
  sinks: NetEnd[];
  cls: SigClass;
  meaning: string;
  /** How it is produced when the driver is top-level glue logic (Verilog expression). */
  expr?: string;
}

interface Meta { cls: SigClass; meaning: string; expr?: string }

const V03_META: Record<string, Meta> = {
  clk: { cls: 'clock', meaning: 'The single clock. Every register in the chip updates on its rising edge.' },
  rst_n: { cls: 'reset', meaning: 'Asynchronous active-low reset: 0 clears every register.' },
  in_valid: { cls: 'handshake', meaning: '1 = a new sample is on in_channel / in_sample this cycle. There is no ready: an ADC cannot wait.' },
  in_channel: { cls: 'address', meaning: 'Which channel (0–7) the sample belongs to; it selects that channel\'s entry in the per-channel memories.' },
  in_sample: { cls: 'data', meaning: 'The digitised sample, a signed 16-bit ADC code.' },
  accept: { cls: 'enable', meaning: 'This sample is taken: valid and channel in range. Enables the memory write and the sample counter.', expr: 'accept = in_valid & (in_channel < NUM_CH)' },
  reject: { cls: 'enable', meaning: 'A valid sample with an out-of-range channel: ignored and counted.', expr: 'reject = in_valid & ~(in_channel < NUM_CH)' },
  raw_gen: { cls: 'control', meaning: 'Pulse: make a RAW record of this sample now.', expr: 'raw_gen = accept & cfg_session_en & cfg_mode[0]   // RAW or HYBRID' },
  raw_data: { cls: 'data', meaning: 'in_sample sign-extended to 32 bits: the RAW record\'s payload.', expr: 'raw_data = {{16{in_sample[15]}}, in_sample}' },
  event_gen: { cls: 'control', meaning: 'Pulse: make an EVENT record now (the legacy core reported a crossing).', expr: 'event_gen = ev_valid & cfg_session_en & (cfg_mode == 0)' },
  feat_gen: { cls: 'control', meaning: 'Pulse: a channel\'s energy window just ended; make a FEATURE record.', expr: 'feat_gen = accept & en_done & cfg_session_en & cfg_mode[1]   // FEATURE or HYBRID' },
  bq_y: { cls: 'data', meaning: 'The filtered sample from the band-pass filter (signed 16 bits, after rounding and saturation).' },
  bq_ysat: { cls: 'status', meaning: '1 = the filter output had to be clipped to fit 16 bits.' },
  fs_x1: { cls: 'state-read', meaning: 'This channel\'s previous input sample, read from feature memory.' },
  fs_x2: { cls: 'state-read', meaning: 'This channel\'s input from two samples ago.' },
  fs_y1: { cls: 'state-read', meaning: 'This channel\'s previous filter output.' },
  fs_y2: { cls: 'state-read', meaning: 'This channel\'s filter output from two samples ago.' },
  fs_acc: { cls: 'state-read', meaning: 'Energy accumulated so far in this channel\'s window (48-bit).' },
  fs_cnt: { cls: 'state-read', meaning: 'How many samples of this channel\'s window have been added so far.' },
  fs_sat: { cls: 'state-read', meaning: 'Sticky flag: something saturated earlier in this window.' },
  en_acc_wr: { cls: 'state-write', meaning: 'New accumulator value written back to feature memory (0 when the window ends).' },
  en_cnt_wr: { cls: 'state-write', meaning: 'New window count written back (0 when the window ends).' },
  en_sat_wr: { cls: 'state-write', meaning: 'New sticky saturation flag written back.' },
  en_energy: { cls: 'data', meaning: 'The window\'s energy, shifted and saturated to 32 bits: the FEATURE record\'s payload.' },
  en_feat_sat: { cls: 'status', meaning: '1 = the filter or the energy saturated in this window (FEATURE record flag).' },
  ev_channel: { cls: 'data', meaning: 'Channel of the event from the legacy core.' },
  ev_magnitude: { cls: 'data', meaning: 'Size of the residual at the crossing (|x − baseline|).' },
  ev_polarity: { cls: 'data', meaning: '1 = the crossing went negative.' },
  ev_timestamp: { cls: 'data', meaning: 'Sample index of the crossing sample.' },
  sample_idx: { cls: 'data', meaning: 'Global sample index: how many samples have been accepted so far. Stamped on RAW and FEATURE records.' },
  rec_valid: { cls: 'handshake', meaning: '1 = a record is waiting at the output.' },
  rec_ready: { cls: 'handshake', meaning: '1 = the receiver takes the record this cycle.' },
  rec_type: { cls: 'data', meaning: 'Record type: 0 RAW, 1 EVENT, 2 FEATURE.' },
  rec_channel: { cls: 'data', meaning: 'Channel of the record at the output.' },
  rec_flags: { cls: 'data', meaning: 'bit0 sat, bit1 gap (records of this type were dropped before this one).' },
  rec_seq: { cls: 'data', meaning: 'Per-type sequence number: a jump means records were dropped.' },
  rec_ts: { cls: 'data', meaning: 'Sample index carried by the record.' },
  rec_data: { cls: 'data', meaning: 'Record payload: RAW sample, EVENT {polarity, magnitude} or FEATURE energy.' },
  stat_drop_raw: { cls: 'status', meaning: 'Count of RAW records dropped because their pending register was full.' },
  stat_drop_event: { cls: 'status', meaning: 'Count of EVENT records dropped.' },
  stat_drop_feature: { cls: 'status', meaning: 'Count of FEATURE records dropped.' },
  stat_event_missed: { cls: 'status', meaning: 'Samples the legacy core could not accept (must stay 0 by design).', expr: 'stat_event_missed += accept & ~u_event.in_ready' },
  stat_rejected: { cls: 'status', meaning: 'Count of samples with an out-of-range channel.' },
  fifo_hwm: { cls: 'status', meaning: 'Highest FIFO occupancy seen (high-water mark).' },
};
for (const c of ['cfg_threshold', 'cfg_hysteresis', 'cfg_refractory', 'cfg_alpha_shift', 'cfg_b0', 'cfg_b1', 'cfg_b2', 'cfg_a1', 'cfg_a2', 'cfg_win_log2', 'cfg_energy_shift', 'cfg_mode', 'cfg_session_en'])
  V03_META[c] = {
    cls: 'config',
    meaning: c.startsWith('cfg_b') || c.startsWith('cfg_a') && c !== 'cfg_alpha_shift'
      ? 'Filter coefficient (signed Q2.14: value ÷ 16384), set by the host.'
      : c === 'cfg_win_log2' ? 'Energy window length = 2^k samples of a channel.'
        : c === 'cfg_energy_shift' ? 'Right shift applied to the energy before it is saturated to 32 bits.'
          : 'Configuration for the legacy event core, set by the host.',
  };

const EVENT_META: Record<string, Meta> = {
  clk: V03_META.clk, rst_n: V03_META.rst_n, in_channel: V03_META.in_channel, in_sample: V03_META.in_sample,
  cfg_alpha_shift: { cls: 'config', meaning: 'Baseline time constant: the EMA moves 1/2^k of the way each sample.' },
  cfg_threshold: { cls: 'config', meaning: 'Spike threshold on |residual| (0 disables detection).' },
  cfg_hysteresis: { cls: 'config', meaning: 'Re-arm when |residual| falls below threshold − hysteresis.' },
  cfg_refractory: { cls: 'config', meaning: 'Samples of the same channel ignored after an event.' },
  ev_ready: { cls: 'handshake', meaning: 'Receiver takes the event (tied to 1 inside the v0.3 chip).' },
  accept: { cls: 'enable', meaning: 'Sample taken: valid, ready and channel in range.', expr: 'accept = in_valid & in_ready & (in_channel < NUM_CH)' },
  reject: { cls: 'enable', meaning: 'Taken but out of range: ignored and counted.' },
  ev_push: { cls: 'control', meaning: 'Pulse: load a new event into the output slot.', expr: 'ev_push = accept & fire' },
  st_baseline: { cls: 'state-read', meaning: 'This channel\'s baseline (Q16.8 fixed point) read from event memory.' },
  st_primed: { cls: 'state-read', meaning: 'Has this channel seen its first sample yet?' },
  st_armed: { cls: 'state-read', meaning: 'Is this channel allowed to fire (re-armed after the last event)?' },
  st_refr: { cls: 'state-read', meaning: 'Refractory samples left for this channel.' },
  nx_baseline: { cls: 'state-write', meaning: 'Updated baseline written back to event memory.' },
  nx_armed: { cls: 'state-write', meaning: 'Updated armed flag written back.' },
  nx_refr: { cls: 'state-write', meaning: 'Updated refractory count written back.' },
  residual: { cls: 'data', meaning: 'x − baseline: how far the sample is from the background (signed 17 bits).' },
  above: { cls: 'control', meaning: '1 = |residual| ≥ threshold.' },
  below_rearm: { cls: 'control', meaning: '1 = |residual| is low enough to re-arm.' },
  det_enable: { cls: 'enable', meaning: 'Detection enabled (threshold ≠ 0).' },
  magnitude: { cls: 'data', meaning: '|residual|.' },
  polarity: { cls: 'data', meaning: '1 = negative residual.' },
  ts_now: { cls: 'data', meaning: 'Sample count inside the legacy core (event timestamp).' },
  ev_valid: { cls: 'handshake', meaning: '1 = an event is waiting in the output slot.' },
  ev_channel: V03_META.ev_channel, ev_magnitude: V03_META.ev_magnitude, ev_polarity: V03_META.ev_polarity, ev_timestamp: V03_META.ev_timestamp,
  in_ready: { cls: 'handshake', meaning: '1 = the output slot is free, so a sample can be taken.' },
  stat_events: { cls: 'status', meaning: 'Count of events emitted.' },
  stat_rejected: V03_META.stat_rejected,
};

// ── v0.4: hbci02_digital_top (v04 scope) and hbci_ai_decoder (ai scope) ──
const V04_META: Record<string, Meta> = {
  clk: V03_META.clk, rst_n: V03_META.rst_n, in_valid: V03_META.in_valid, in_channel: V03_META.in_channel, in_sample: V03_META.in_sample,
  rec_valid: V03_META.rec_valid, rec_ready: V03_META.rec_ready, rec_type: V03_META.rec_type, rec_channel: V03_META.rec_channel, rec_flags: V03_META.rec_flags, rec_seq: V03_META.rec_seq, rec_ts: V03_META.rec_ts, rec_data: V03_META.rec_data,
  reg_addr: { cls: 'address', meaning: 'Register bus word address (8 bits): which mailbox of the register map the host reads or writes.' },
  reg_wdata: { cls: 'data', meaning: 'Register bus write data (32 bits).' },
  reg_rdata: { cls: 'data', meaning: 'Register bus read data (32 bits): the multiplexed value of the addressed register.' },
  reg_we: { cls: 'control', meaning: 'Register write strobe.' },
  reg_re: { cls: 'control', meaning: 'Register read strobe (used by PRED_ACK-style side effects).' },
  cfg_ai_en: { cls: 'config', meaning: 'CTRL.ai_en: inference enabled (also gated by session_en at the top level).' },
  cfg_ch_mask: { cls: 'config', meaning: 'CH_MASK: which channels a frame must contain (default 0xFF).' },
  cfg_frame_span: { cls: 'config', meaning: 'FRAME_SPAN: maximum ts_last − ts_first inside a frame.' },
  feat_sync: { cls: 'control', meaning: 'One-cycle pulse: every channel restarts at window 0 and the open frame is cleared.' },
  model_we: { cls: 'control', meaning: 'Write strobe for a model word (MODEL[0..45]).' },
  model_addr: { cls: 'address', meaning: 'Which of the 46 model words is addressed.' },
  model_wdata: { cls: 'data', meaning: 'Model word write data.' },
  model_rdata: { cls: 'data', meaning: 'Model word read-back (the same mux the CRC check uses).' },
  model_verify: { cls: 'control', meaning: 'MODEL_CTRL.verify: start the CRC-32 check of the 46 words.' },
  model_clear_rej: { cls: 'control', meaning: 'Clears the sticky MODEL_STATUS.rejected flag.' },
  crc_we: { cls: 'control', meaning: 'Write strobe for MODEL_CRC (the expected checksum).' },
  crc_wdata: { cls: 'data', meaning: 'Expected CRC-32 value written by the host.' },
  pred_pop: { cls: 'control', meaning: 'PRED_ACK: pop the head of the prediction FIFO.' },
  pred_strobe: { cls: 'control', meaning: 'Direct pin: one-cycle pulse per prediction (pred_direct_en).' },
  pred_class_out: { cls: 'data', meaning: 'Direct pin: the last predicted class, held.' },
  pred_irq: { cls: 'control', meaning: 'Interrupt: a prediction is waiting in the FIFO.' },
  cfg_bist_en: { cls: 'config', meaning: 'CTRL.bist_en: the LFSR replaces the sample input and the MISR folds the outputs.' },
  bist_clear: { cls: 'control', meaning: 'Reset the self-test signature.' },
  bist_len: { cls: 'config', meaning: 'Self-test length.' },
};
const AI_META: Record<string, Meta> = {
  clk: V03_META.clk, rst_n: V03_META.rst_n,
  cfg_ai_en: V04_META.cfg_ai_en, cfg_ch_mask: V04_META.cfg_ch_mask, cfg_frame_span: V04_META.cfg_frame_span, feat_sync: V04_META.feat_sync,
  feat_valid: { cls: 'handshake', meaning: '1 = a FEATURE window just completed: the tap carries one feature this cycle.' },
  feat_ch: { cls: 'address', meaning: 'Channel of the feature on the tap.' },
  feat_energy: { cls: 'data', meaning: 'The window energy (unsigned 32 bits), straight from the band-energy block.' },
  feat_ts: { cls: 'data', meaning: 'Sample index of the window\'s last sample.' },
  feat_sat: { cls: 'status', meaning: '1 = the filter or the energy saturated inside the window.' },
  feat_win: { cls: 'data', meaning: 'Per-channel window index: the frame key. Only features with the same win_idx are combined.' },
  pend_x: { cls: 'data', meaning: 'The eight quantised inputs of the complete frame waiting in the pending register (8 × int8).' },
  pend_id: { cls: 'data', meaning: 'Window index of the pending frame.' },
  pend_ts: { cls: 'data', meaning: 'ts_last of the pending frame.' },
  pend_sat: { cls: 'status', meaning: 'Saturated-channel mask of the pending frame.' },
  eng_start: { cls: 'control', meaning: 'Start pulse to the MLP engine: the pending frame is handed over.' },
  model_we: V04_META.model_we, model_addr: V04_META.model_addr, model_wdata: V04_META.model_wdata, model_verify: V04_META.model_verify, model_clear_rej: V04_META.model_clear_rej, crc_we: V04_META.crc_we, crc_wdata: V04_META.crc_wdata,
  pred_ready: { cls: 'handshake', meaning: 'The host (PRED_ACK) or direct mode takes the head prediction this cycle.' },
  pred_valid: { cls: 'handshake', meaning: '1 = a prediction waits at the head of the 4-deep FIFO.' },
  pred_class: { cls: 'data', meaning: 'Predicted class of the head prediction (argmax of the logits).' },
  pred_margin: { cls: 'data', meaning: 'Winning logit minus the best other logit (≥ 0).' },
  pred_ts: { cls: 'data', meaning: 'ts_last of the frame the prediction belongs to.' },
  pred_frame_id: { cls: 'data', meaning: 'Window index of that frame.' },
  pred_seq: { cls: 'data', meaning: 'Running prediction number: a jump means a prediction was dropped.' },
  pred_flags: { cls: 'data', meaning: 'bit 0 sat (a saturated channel in the frame), bit 1 gap (something was dropped before this one).' },
  pred_count: { cls: 'status', meaning: 'Number of predictions in the FIFO (0..4).' },
  pcnt: { cls: 'status', meaning: 'FIFO occupancy register.' },
  pred_strobe: V04_META.pred_strobe,
  pred_class_direct: { cls: 'data', meaning: 'Direct pin value of the last class.' },
  stat_frames: { cls: 'status', meaning: 'AI_FRAMES: complete frames.' },
  stat_pred: { cls: 'status', meaning: 'AI_PRED: predictions produced.' },
  stat_incomplete: { cls: 'status', meaning: 'AI_INCOMPLETE: frames abandoned because a newer window arrived.' },
  stat_dup: { cls: 'status', meaning: 'AI_DUP: frames abandoned because a channel repeated its window.' },
  stat_late: { cls: 'status', meaning: 'AI_LATE: features discarded as belonging to an older window.' },
  stat_span: { cls: 'status', meaning: 'AI_SPAN: frames abandoned for exceeding FRAME_SPAN.' },
  stat_busy: { cls: 'status', meaning: 'AI_BUSY: complete frames dropped while the engine was busy.' },
  stat_pred_drop: { cls: 'status', meaning: 'AI_PRED_DROP: predictions dropped because the FIFO was full.' },
  stat_nomodel: { cls: 'status', meaning: 'AI_NOMODEL: frames dropped because no verified model was loaded.' },
  stat_sat_frames: { cls: 'status', meaning: 'AI_SAT_FRAMES: frames containing a saturated channel.' },
  last_missing: { cls: 'status', meaning: 'LAST_FRAME.missing: channels that were missing from the last abandoned frame.' },
  model_valid: { cls: 'status', meaning: 'MODEL_STATUS.valid: the 46 words passed their CRC-32. No prediction without it.' },
  model_error: { cls: 'status', meaning: 'MODEL_STATUS.error: the CRC-32 did not match.' },
  model_busy: { cls: 'status', meaning: 'MODEL_STATUS.busy: the CRC check is running (4 cycles per word).' },
  model_rejected: { cls: 'status', meaning: 'MODEL_STATUS.rejected: a model write arrived while ai_en = 1 and was refused.' },
};

type Mods = RtlModules & { v03?: { top: string; connections: RtlModules['connections'] } };
type NetMaps = Record<NetScope, Map<string, Net>>;

function portSigned(mods: Mods, inst: string, port: string, scope: NetScope): boolean | null {
  const byScope: Record<NetScope, Record<string, string>> = {
    v03: { '': 'hbci_readout_core', u_event: 'hbci_event_core', u_fstate: 'hbci_feature_state', u_biquad: 'hbci_biquad', u_energy: 'hbci_band_energy', u_records: 'hbci_record_mux', u_ts: 'hbci_timestamp' },
    event: { '': 'hbci_event_core', u_state: 'hbci_channel_state', u_baseline: 'hbci_baseline_ema', u_threshold: 'hbci_threshold_detector', u_refractory: 'hbci_refractory_ctrl', u_timestamp: 'hbci_timestamp', u_packer: 'hbci_event_packer' },
    v04: { '': 'hbci02_digital_top', u_readout: 'hbci_readout_core', u_ai: 'hbci_ai_decoder', u_bist: 'hbci_bist' },
    ai: { '': 'hbci_ai_decoder', u_quant: 'hbci_feat_quant', u_collect: 'hbci_frame_collector', u_model: 'hbci_model_store', u_engine: 'hbci_mlp_engine' },
  };
  const mod = mods.modules.find((m) => m.name === byScope[scope][inst]);
  const p = mod?.ports.find((x) => x.name === port);
  return p ? !!p.signed : null;
}

const cache = new WeakMap<object, NetMaps>();

/** All nets of every scope, keyed by net name. */
export function netIndex(mods: RtlModules | null): NetMaps {
  const empty: NetMaps = { v03: new Map(), event: new Map(), v04: new Map(), ai: new Map() };
  if (!mods) return empty;
  const hit = cache.get(mods);
  if (hit) return hit;
  const m = mods as Mods;
  const out: NetMaps = { v03: new Map(), event: new Map(), v04: new Map(), ai: new Map() };
  const build = (scope: NetScope, conns: RtlModules['connections'], meta: Record<string, Meta>) => {
    for (const c of conns) {
      // v0.4 netlists list clock/reset-driven registers as "clk → output"; those are not signal paths.
      if ((scope === 'v04' || scope === 'ai') && c.from.inst === '' && (c.from.port === 'clk' || c.from.port === 'rst_n') && c.net !== 'clk' && c.net !== 'rst_n') continue;
      let n = out[scope].get(c.net);
      if (!n) {
        const mt = meta[c.net] ?? { cls: 'data' as SigClass, meaning: 'A net of the synthesised netlist.' };
        n = { net: c.net, scope, width: c.width, signed: false, drivers: [], sinks: [], cls: mt.cls, meaning: mt.meaning, expr: mt.expr };
        out[scope].set(c.net, n);
      }
      if (!n.drivers.some((d) => d.inst === c.from.inst && d.port === c.from.port)) n.drivers.push({ ...c.from });
      if (!n.sinks.some((d) => d.inst === c.to.inst && d.port === c.to.port)) n.sinks.push({ ...c.to });
    }
    for (const n of out[scope].values()) {
      const ends = [...n.drivers.filter((d) => d.inst !== '' || d.port === n.net), ...n.sinks];
      n.signed = ends.some((e) => portSigned(m, e.inst, e.port, scope));
    }
  };
  if (m.v03?.connections) build('v03', m.v03.connections, V03_META);
  build('event', m.connections, EVENT_META);
  if (m.v04?.connections) build('v04', m.v04.connections, V04_META);
  if (m.v04?.ai?.connections) build('ai', m.v04.ai.connections, AI_META);
  cache.set(mods, out);
  return out;
}

/** True when the net is produced by top-level glue logic from several inputs (not a straight wire). */
export function isGlue(n: Net): boolean {
  return n.drivers.length > 1 || (n.drivers.length === 1 && n.drivers[0].inst === '' && n.drivers[0].port !== n.net);
}

// ───────────────────────────────────────────── die routes → nets ──
/** The real nets each conceptual die route stands for (route ids from dieLayout.ts). */
export const ROUTE_NETS: Record<string, { scope: NetScope; nets: string[] }> = {
  // v0.4 decoder routes (ai scope) and top-level routes (v04 scope)
  tap: { scope: 'ai', nets: ['feat_valid', 'feat_ch', 'feat_energy', 'feat_ts', 'feat_sat', 'feat_win'] },
  q_c: { scope: 'ai', nets: ['feat_valid', 'feat_ch', 'feat_ts', 'feat_sat', 'feat_win'] },
  m_q: { scope: 'ai', nets: ['feat_ch'] },
  c_e: { scope: 'ai', nets: ['pend_x', 'pend_id', 'pend_ts', 'pend_sat', 'eng_start'] },
  m_e: { scope: 'ai', nets: ['model_valid'] },
  e_f: { scope: 'ai', nets: ['pred_class', 'pred_margin', 'pred_ts', 'pred_frame_id', 'pred_seq', 'pred_flags', 'pred_valid'] },
  pred: { scope: 'v04', nets: ['pred_strobe', 'pred_class_out', 'pred_irq'] },
  bus: { scope: 'v04', nets: ['reg_addr', 'reg_wdata', 'reg_we', 'reg_re', 'reg_rdata'] },
  regs_model: { scope: 'v04', nets: ['model_we', 'model_addr', 'model_wdata', 'crc_we', 'crc_wdata', 'model_verify', 'model_clear_rej'] },
  regs_ai: { scope: 'v04', nets: ['cfg_ch_mask', 'cfg_frame_span', 'feat_sync', 'pred_pop'] },
  regs_cfg: { scope: 'v04', nets: ['feat_sync'] },
  bist: { scope: 'v04', nets: ['cfg_bist_en', 'bist_clear', 'bist_len'] },
  in: { scope: 'v03', nets: ['in_valid', 'in_channel', 'in_sample'] },
  out: { scope: 'v03', nets: ['rec_valid', 'rec_ready', 'rec_type', 'rec_channel', 'rec_flags', 'rec_seq', 'rec_ts', 'rec_data'] },
  raw: { scope: 'v03', nets: ['raw_gen', 'raw_data', 'in_channel'] },
  ts_rec: { scope: 'v03', nets: ['sample_idx'] },
  sp_ev: { scope: 'v03', nets: ['in_valid', 'in_channel', 'in_sample'] },
  ev_rec: { scope: 'v03', nets: ['event_gen', 'ev_channel', 'ev_timestamp', 'ev_polarity', 'ev_magnitude'] },
  sp_fs: { scope: 'v03', nets: ['in_channel', 'accept', 'in_sample'] },
  fs_bq: { scope: 'v03', nets: ['fs_x1', 'fs_x2', 'fs_y1', 'fs_y2'] },
  bq_fs: { scope: 'v03', nets: ['bq_y'] },
  bq_en: { scope: 'v03', nets: ['bq_y', 'bq_ysat'] },
  fs_en: { scope: 'v03', nets: ['fs_acc', 'fs_cnt', 'fs_sat'] },
  en_fs: { scope: 'v03', nets: ['en_acc_wr', 'en_cnt_wr', 'en_sat_wr'] },
  en_rec: { scope: 'v03', nets: ['feat_gen', 'en_energy', 'en_feat_sat'] },
  st_bl: { scope: 'event', nets: ['st_baseline', 'st_primed'] },
  bl_st: { scope: 'event', nets: ['nx_baseline'] },
  bl_th: { scope: 'event', nets: ['residual'] },
  th_rf: { scope: 'event', nets: ['above', 'below_rearm', 'det_enable'] },
  th_pk: { scope: 'event', nets: ['magnitude', 'polarity'] },
  st_rf: { scope: 'event', nets: ['st_armed', 'st_refr', 'st_primed'] },
  rf_st: { scope: 'event', nets: ['nx_armed', 'nx_refr'] },
  rf_pk: { scope: 'event', nets: ['ev_push'] },
  ts_pk: { scope: 'event', nets: ['ts_now'] },
};

// ─────────────────────────────────────────────── values from the trace ──
export type ValueSource = 'RTL' | 'DERIVED' | 'CONFIG' | 'NO TRACE';
export interface SigValue { v: number | null; src: ValueSource; how: string }

const WAVE_OF: Record<string, string> = {
  in_valid: 'in_valid', in_channel: 'in_channel', in_sample: 'in_sample', raw_gen: 'raw_gen', event_gen: 'event_gen',
  feat_gen: 'feat_gen', bq_y: 'u_biquad.y', bq_ysat: 'u_biquad.ysat', rec_valid: 'rec_valid', rec_ready: 'rec_ready',
  rec_type: 'rec_type', rec_channel: 'rec_channel', rec_flags: 'rec_flags', rec_seq: 'rec_seq', rec_data: 'rec_data',
};

/** Value of a wave at `cycle` (last change at or before it), or null before its first change. */
export function waveAt(changes: [number, number][], cycle: number): number | null {
  let lo = 0, hi = changes.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (changes[mid][0] <= cycle) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans < 0 ? null : changes[ans][1];
}

function toSigned(v: number, w: number): number {
  return v >= 2 ** (w - 1) ? v - 2 ** w : v;
}

/** Feature-memory contents of channel `ch` just before sample `i` is processed, from the trace history. */
export function historyBefore(samples: V03Sample[], i: number, ch: number): { x1: number; x2: number; y1: number; y2: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let k = i - 1; k >= 0 && xs.length < 2; k--) {
    if (samples[k].ch === ch) { xs.push(samples[k].x); ys.push(samples[k].y); }
  }
  return { x1: xs[0] ?? 0, x2: xs[1] ?? 0, y1: ys[0] ?? 0, y2: ys[1] ?? 0, n: xs.length };
}

const CONFIG_OF: Record<string, keyof RtlTraceV03['config']> = {
  cfg_threshold: 'threshold', cfg_hysteresis: 'hysteresis', cfg_refractory: 'refractory', cfg_alpha_shift: 'alpha_shift',
  cfg_b0: 'b0', cfg_b1: 'b1', cfg_b2: 'b2', cfg_a1: 'a1', cfg_a2: 'a2', cfg_win_log2: 'win_log2', cfg_energy_shift: 'energy_shift',
};

/**
 * Value of a v0.3 net at the cycle of accepted sample `i` of the HYBRID trace run. Never invents a value:
 * when the trace cannot support one, the result is { v: null, src: 'NO TRACE' } with the reason.
 */
export function netValue(net: Net, tr: RtlTraceV03 | null, i: number, t4?: { trace: RtlTraceV04 | null; frame: number }): SigValue {
  if (net.scope === 'v04' || net.scope === 'ai') return netValueV04(net, t4?.trace ?? null, t4?.frame ?? 0);
  if (!tr) return { v: null, src: 'NO TRACE', how: 'rtl_trace_v03.json is not loaded (run make artifacts).' };
  if (net.scope !== 'v03') return { v: null, src: 'NO TRACE', how: 'The v0.3 trace does not record the legacy core\'s internal nets. A separate v0.2 trace (different stimulus) is used in the module view.' };
  const s = tr.samples[Math.min(Math.max(0, i), tr.samples.length - 1)];
  const cyc = s.cycle;
  const wname = WAVE_OF[net.net];
  if (wname) {
    const w = tr.waves.find((x) => x.name === wname);
    if (w) {
      const raw = waveAt(w.changes, cyc);
      if (raw === null) return { v: null, src: 'NO TRACE', how: `${wname} has no recorded value before cycle ${cyc}.` };
      return { v: w.signed ? toSigned(raw, w.width) : raw, src: 'RTL', how: `VCD signal ${wname} at cycle ${cyc} (HYBRID run)` };
    }
  }
  const cfg = CONFIG_OF[net.net];
  if (cfg) return { v: tr.config[cfg], src: 'CONFIG', how: 'constant configuration of the RTL run (testbench setting)' };
  if (net.net === 'cfg_mode') return { v: 3, src: 'CONFIG', how: 'HYBRID run (cfg_mode = 3); the trace also has separate EVENT, RAW and FEATURE runs' };
  if (net.net === 'cfg_session_en') return { v: 1, src: 'CONFIG', how: 'session enabled for the whole recorded run' };
  const h = () => historyBefore(tr.samples, s.i, s.ch);
  switch (net.net) {
    case 'fs_acc': return { v: s.acc, src: 'RTL', how: `per-sample trace field acc (read before update), sample ${s.i}, ch${s.ch}` };
    case 'fs_cnt': return { v: s.cnt, src: 'RTL', how: `per-sample trace field cnt (read before update), sample ${s.i}, ch${s.ch}` };
    case 'sample_idx': return { v: s.i, src: 'RTL', how: 'trace field i: the sample index while this sample is processed' };
    case 'accept': return { v: 1, src: 'DERIVED', how: 'in_valid = 1 and in_channel < 8 at this cycle (every trace sample is an accepted one)' };
    case 'reject': return { v: 0, src: 'DERIVED', how: 'stat_rejected stays 0 for the whole run, so reject never pulses' };
    case 'raw_data': return { v: s.x, src: 'DERIVED', how: 'in_sample sign-extended; numerically equal to in_sample' };
    case 'fs_x1': return { v: h().x1, src: 'DERIVED', how: `previous input of ch${s.ch} in the trace (0 after reset if none yet)` };
    case 'fs_x2': return { v: h().x2, src: 'DERIVED', how: `input of ch${s.ch} two samples earlier in the trace` };
    case 'fs_y1': return { v: h().y1, src: 'DERIVED', how: `previous filter output of ch${s.ch} in the trace` };
    case 'fs_y2': return { v: h().y2, src: 'DERIVED', how: `filter output of ch${s.ch} two samples earlier in the trace` };
    case 'en_acc_wr': return { v: s.done ? 0 : s.acc + s.y * s.y, src: 'DERIVED', how: 'acc + y² from the trace (0 when the window ends: done = 1)' };
    case 'en_cnt_wr': return { v: s.done ? 0 : s.cnt + 1, src: 'DERIVED', how: 'cnt + 1 from the trace (0 when the window ends)' };
    case 'stat_drop_raw': case 'stat_drop_event': case 'stat_drop_feature': case 'stat_rejected': case 'stat_event_missed': {
      const key = net.net === 'stat_rejected' ? 'rejected' : net.net === 'stat_event_missed' ? 'event_missed' : net.net.replace('stat_', '');
      const fin = (tr.runs.HYBRID.stats as unknown as Record<string, number>)[key];
      return fin === 0
        ? { v: 0, src: 'DERIVED', how: 'final count of the HYBRID run is 0 and the counter only counts up, so it is 0 at every cycle' }
        : { v: null, src: 'NO TRACE', how: `only the final count (${fin}) is recorded` };
    }
    case 'clk': return { v: null, src: 'NO TRACE', how: 'the clock toggles every cycle; the trace samples once per cycle and does not store it' };
    default: return { v: null, src: 'NO TRACE', how: 'this net is not in the recorded VCD subset or the per-sample fields' };
  }
}

/** Format a value: decimal, plus hex and binary when `bits` is set. */
export function fmtValue(v: number | null, width: number, signed: boolean, bits: boolean): string {
  if (v === null) return '—';
  const dec = v.toLocaleString('en-GB');
  if (!bits) return dec;
  const u = signed && v < 0 ? 2 ** width + v : v;
  const bin = width <= 32 ? u.toString(2).padStart(width, '0').replace(/(\d{4})(?=\d)/g, '$1_') : '';
  return `${dec}   0b${bin}`;
}

/**
 * Values of v0.4 nets at the frame selected in the on-chip AI pipeline view, read from rtl_trace_v04(.real).json:
 * the frame's last feature on the tap, the pending frame, and the prediction that left the FIFO. The v0.4 trace
 * has no per-cycle VCD subset, so every other net reads NO TRACE.
 */
export function netValueV04(net: Net, t: RtlTraceV04 | null, frameIdx: number): SigValue {
  if (!t) return { v: null, src: 'NO TRACE', how: 'rtl_trace_v04.json is not loaded (run make artifacts).' };
  const fr = t.frames[Math.max(0, Math.min(frameIdx, t.frames.length - 1))];
  if (!fr) return { v: null, src: 'NO TRACE', how: 'the v0.4 trace holds no frames' };
  const feat = [...t.features].reverse().find((f) => f.win === fr.frame_id && f.ts === fr.ts_last) ?? null;
  const pred = t.predictions.find((p) => p.frame === fr.frame_id && p.ts === fr.ts_last) ?? null;
  const where = `frame ${fr.frame_id} of the v0.4 trace (selected in the on-chip AI view)`;
  const cfg = (k: keyof RtlTraceV04['config']) => ({ v: t.config[k] as number, src: 'CONFIG' as const, how: 'constant configuration of the v0.4 RTL run' });
  switch (net.net) {
    case 'feat_valid': return { v: 1, src: 'RTL', how: `the tap carried this frame's last feature at cycle ${feat?.cycle ?? '?'} (${where})` };
    case 'feat_ch': return feat ? { v: feat.ch, src: 'RTL', how: `last feature of ${where}, cycle ${feat.cycle}` } : { v: null, src: 'NO TRACE', how: 'no feature found for the selected frame' };
    case 'feat_energy': return feat ? { v: feat.energy, src: 'RTL', how: `energy of ch${feat.ch}, window ${feat.win} (${where})` } : { v: null, src: 'NO TRACE', how: 'no feature found for the selected frame' };
    case 'feat_ts': return feat ? { v: feat.ts, src: 'RTL', how: `ts of the last feature of ${where}` } : { v: null, src: 'NO TRACE', how: 'no feature found' };
    case 'feat_sat': return feat ? { v: feat.sat, src: 'RTL', how: `sat flag of the last feature of ${where}` } : { v: null, src: 'NO TRACE', how: 'no feature found' };
    case 'feat_win': return { v: fr.frame_id, src: 'RTL', how: `window index = frame_id of ${where}` };
    case 'pend_id': return { v: fr.frame_id, src: 'RTL', how: `frame_id of ${where}` };
    case 'pend_ts': return { v: fr.ts_last, src: 'RTL', how: `ts_last of ${where}` };
    case 'pend_sat': return { v: fr.sat_mask, src: 'RTL', how: `sat_mask of ${where}` };
    case 'eng_start': return { v: 1, src: 'RTL', how: `the engine started ${t.latency.frame_complete_to_engine_start} cycles after the frame completed (cycle ${fr.complete_cycle})` };
    case 'pred_class': return pred ? { v: pred.cls, src: 'RTL', how: `prediction popped at cycle ${pred.cycle} for ${where}` } : { v: null, src: 'NO TRACE', how: 'no prediction left the FIFO for this frame' };
    case 'pred_margin': return pred ? { v: pred.margin, src: 'RTL', how: `prediction for ${where}` } : { v: null, src: 'NO TRACE', how: 'no prediction for this frame' };
    case 'pred_ts': return pred ? { v: pred.ts, src: 'RTL', how: `prediction for ${where}` } : { v: null, src: 'NO TRACE', how: 'no prediction for this frame' };
    case 'pred_frame_id': return pred ? { v: pred.frame, src: 'RTL', how: `prediction for ${where}` } : { v: null, src: 'NO TRACE', how: 'no prediction for this frame' };
    case 'pred_seq': return pred ? { v: pred.seq, src: 'RTL', how: `prediction for ${where}` } : { v: null, src: 'NO TRACE', how: 'no prediction for this frame' };
    case 'pred_flags': return pred ? { v: pred.flags, src: 'RTL', how: `prediction for ${where}` } : { v: null, src: 'NO TRACE', how: 'no prediction for this frame' };
    case 'pred_valid': return pred ? { v: 1, src: 'RTL', how: `a prediction waited in the FIFO until cycle ${pred.cycle}` } : { v: null, src: 'NO TRACE', how: 'no prediction for this frame' };
    case 'cfg_ch_mask': return cfg('ch_mask');
    case 'cfg_frame_span': return cfg('frame_span');
    case 'cfg_ai_en': return { v: 1, src: 'CONFIG', how: 'ai_en = 1 for the whole recorded run' };
    case 'model_valid': return { v: 1, src: 'DERIVED', how: 'predictions were produced, which the RTL only does with model_valid = 1 (ai_nomodel = 0 for the run)' };
    case 'stat_frames': case 'stat_pred': case 'stat_incomplete': case 'stat_dup': case 'stat_late': case 'stat_span': case 'stat_busy': case 'stat_pred_drop': case 'stat_nomodel': case 'stat_sat_frames': {
      const key = net.net.replace('stat_', 'ai_').replace('ai_frames', 'ai_frames');
      const v = t.counters[key];
      return v === undefined ? { v: null, src: 'NO TRACE', how: 'counter not in the trace' } : { v, src: 'RTL', how: `final value of the run (counters.${key})` };
    }
    default: return { v: null, src: 'NO TRACE', how: 'the v0.4 trace records features, frames, inferences and predictions, not this net per cycle' };
  }
}
