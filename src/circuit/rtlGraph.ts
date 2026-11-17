// Builds the functional block graph of hbci_event_core from rtl_modules.json connections.
// Falls back to a hand-transcribed connection list (from rtl/hbci_event_core.v) when the
// artifact is missing; the view labels which source is in use.
import type { RtlConnection, RtlModules } from '../artifacts/types';

export interface BlockEdge {
  id: string;
  from: string;     // instance name, '' = top-level inputs, '$out' = top-level outputs
  to: string;
  nets: { net: string; width: number; fromPort: string; toPort: string }[];
  writeback: boolean;
}

export const INSTANCES = ['u_state', 'u_baseline', 'u_threshold', 'u_refractory', 'u_timestamp', 'u_packer'] as const;

export const INSTANCE_MODULE: Record<string, string> = {
  u_state: 'hbci_channel_state',
  u_baseline: 'hbci_baseline_ema',
  u_threshold: 'hbci_threshold_detector',
  u_refractory: 'hbci_refractory_ctrl',
  u_timestamp: 'hbci_timestamp',
  u_packer: 'hbci_event_packer',
};

const FALLBACK: [string, string, string, string, number][] = [
  // [fromInst, fromPort, toInst, toPort, width]
  ['', 'in_channel', 'u_state', 'ch', 3],
  ['', 'in_sample', 'u_baseline', 'sample', 16],
  ['', 'cfg_alpha_shift', 'u_baseline', 'alpha_shift', 4],
  ['', 'cfg_threshold', 'u_threshold', 'threshold', 16],
  ['', 'cfg_hysteresis', 'u_threshold', 'hysteresis', 16],
  ['', 'cfg_refractory', 'u_refractory', 'cfg_refractory', 8],
  ['', 'in_valid (accept)', 'u_state', 'we', 1],
  ['', 'in_valid (accept)', 'u_timestamp', 'tick', 1],
  ['', 'ev_ready', 'u_packer', 'ev_ready', 1],
  ['u_state', 'rd_baseline', 'u_baseline', 'baseline_q', 24],
  ['u_state', 'rd_primed', 'u_baseline', 'primed', 1],
  ['u_state', 'rd_primed', 'u_refractory', 'primed', 1],
  ['u_state', 'rd_armed', 'u_refractory', 'armed', 1],
  ['u_state', 'rd_refr', 'u_refractory', 'refr_cnt', 8],
  ['u_baseline', 'residual', 'u_threshold', 'residual', 17],
  ['u_baseline', 'baseline_next', 'u_state', 'wr_baseline', 24],
  ['u_threshold', 'above', 'u_refractory', 'above', 1],
  ['u_threshold', 'below_rearm', 'u_refractory', 'below_rearm', 1],
  ['u_threshold', 'enable', 'u_refractory', 'enable', 1],
  ['u_threshold', 'magnitude', 'u_packer', 'in_magnitude', 16],
  ['u_threshold', 'polarity', 'u_packer', 'in_polarity', 1],
  ['u_refractory', 'fire', 'u_packer', 'push', 1],
  ['u_refractory', 'armed_next', 'u_state', 'wr_armed', 1],
  ['u_refractory', 'refr_next', 'u_state', 'wr_refr', 8],
  ['u_timestamp', 'ts_now', 'u_packer', 'in_timestamp', 32],
  ['u_timestamp', 'ts_now', '$out', 'stat_samples', 32],
  ['u_timestamp', 'rejected', '$out', 'stat_rejected', 32],
  ['u_packer', 'ev_valid', '$out', 'ev_valid', 1],
  ['u_packer', 'ev_channel', '$out', 'ev_channel', 3],
  ['u_packer', 'ev_timestamp', '$out', 'ev_timestamp', 32],
  ['u_packer', 'ev_polarity', '$out', 'ev_polarity', 1],
  ['u_packer', 'ev_magnitude', '$out', 'ev_magnitude', 16],
  ['u_packer', 'events', '$out', 'stat_events', 32],
  ['u_packer', 'slot_free', '$out', 'in_ready', 1],
];

const WRITEBACK = new Set(['u_baseline>u_state', 'u_refractory>u_state']);

function aggregate(rows: { from: string; fromPort: string; to: string; toPort: string; net: string; width: number }[]): BlockEdge[] {
  const map = new Map<string, BlockEdge>();
  for (const r of rows) {
    if (r.from === r.to) continue;
    const key = `${r.from}>${r.to}`;
    let e = map.get(key);
    if (!e) {
      e = { id: key, from: r.from, to: r.to, nets: [], writeback: WRITEBACK.has(key) };
      map.set(key, e);
    }
    if (!e.nets.some((n) => n.fromPort === r.fromPort && n.toPort === r.toPort)) {
      e.nets.push({ net: r.net, width: r.width, fromPort: r.fromPort, toPort: r.toPort });
    }
  }
  return [...map.values()];
}

export function buildGraph(mods: RtlModules | null): { edges: BlockEdge[]; source: 'artifact' | 'fallback' } {
  if (mods && mods.connections?.length) {
    const rows = mods.connections.map((c: RtlConnection) => ({
      from: c.from.inst,
      fromPort: c.from.port,
      to: c.to.inst === '' ? '$out' : c.to.inst,
      toPort: c.to.port,
      net: c.net,
      width: c.width,
    }));
    return { edges: aggregate(rows), source: 'artifact' };
  }
  return {
    edges: aggregate(FALLBACK.map(([from, fromPort, to, toPort, width]) => ({ from, fromPort, to, toPort, net: fromPort, width }))),
    source: 'fallback',
  };
}

/** Waveform signal names (from rtl_trace.json) most relevant to each block. */
export const BLOCK_WAVES: Record<string, RegExp> = {
  u_state: /in_valid|in_ready|in_channel/,
  u_baseline: /in_channel|in_sample/,
  u_threshold: /in_sample|above/,
  u_refractory: /above|fire/,
  u_timestamp: /in_valid|in_ready|ev_timestamp/,
  u_packer: /fire|ev_/,
};

// ───────────────────────────── v0.3 readout core (hbci_readout_core) ──
export const INSTANCES_V03 = ['u_event', 'u_fstate', 'u_biquad', 'u_energy', 'u_records', 'u_ts', '$raw'] as const;
export const INSTANCE_MODULE_V03: Record<string, string> = {
  u_event: 'hbci_event_core', u_fstate: 'hbci_feature_state', u_biquad: 'hbci_biquad',
  u_energy: 'hbci_band_energy', u_records: 'hbci_record_mux', u_ts: 'hbci_timestamp', $raw: 'hbci_readout_core',
};
/** Component ids for v0.3 diagram nodes ('$raw' is the top-level RAW gating, not an instance). */
export const V03_NODE_ID: Record<string, string> = {
  u_event: 'rtl.core', u_fstate: 'rtl.u_fstate', u_biquad: 'rtl.u_biquad', u_energy: 'rtl.u_energy',
  u_records: 'rtl.u_records', u_ts: 'rtl.u_ts', $raw: 'rtl.raw_path',
};

// Transcribed from docs/V03_READOUT_SPEC.md; replaced by the netlist-derived list when
// rtl_modules.json carries a "v03" section.
const FALLBACK_V03: [string, string, string, string, number][] = [
  ['', 'in_sample', 'u_event', 'in_sample', 16],
  ['', 'in_channel', 'u_event', 'in_channel', 3],
  ['', 'cfg_threshold', 'u_event', 'cfg_threshold', 16],
  ['', 'in_sample', '$raw', 'raw_gen', 16],
  ['', 'cfg_session_en', '$raw', 'raw_gen', 1],
  ['', 'cfg_mode', '$raw', 'raw_gen', 2],
  ['', 'in_channel', 'u_fstate', 'ch', 3],
  ['', 'in_sample', 'u_biquad', 'x', 16],
  ['', 'cfg_b0..a2', 'u_biquad', 'coeffs', 80],
  ['', 'cfg_win_log2', 'u_energy', 'win_log2', 4],
  ['', 'in_valid (accept)', 'u_ts', 'tick', 1],
  ['u_fstate', 'rd_x1/x2/y1/y2', 'u_biquad', 'x1/x2/y1/y2', 64],
  ['u_fstate', 'rd_acc/cnt', 'u_energy', 'acc/cnt', 58],
  ['u_biquad', 'y', 'u_energy', 'y', 16],
  ['u_biquad', 'y', 'u_fstate', 'wr_y1', 16],
  ['u_energy', 'acc_next/cnt_next', 'u_fstate', 'wr_acc/cnt', 58],
  ['u_energy', 'done/energy (feat_gen)', 'u_records', 'feat_*', 33],
  ['$raw', 'raw_gen + sample', 'u_records', 'raw_*', 17],
  ['u_event', 'ev_valid/ev_* (event_gen)', 'u_records', 'event_*', 50],
  ['u_ts', 'ts_now', 'u_records', 'ts', 32],
  ['u_records', 'rec_*', '$out', 'rec_valid/type/ch/flags/seq/ts/data', 89],
  ['u_records', 'stat_drop_*', '$out', 'stat_drop_*', 96],
];

const WRITEBACK_V03 = new Set(['u_biquad>u_fstate', 'u_energy>u_fstate']);

export function buildGraphV03(mods: RtlModules | null): { edges: BlockEdge[]; source: 'artifact' | 'fallback' } {
  const v03 = (mods as unknown as { v03?: { connections?: RtlConnection[] } } | null)?.v03;
  const rows = v03?.connections?.length
    ? v03.connections.map((c) => ({ from: c.from.inst, fromPort: c.from.port, to: c.to.inst === '' ? '$out' : c.to.inst, toPort: c.to.port, net: c.net, width: c.width }))
    : FALLBACK_V03.map(([from, fromPort, to, toPort, width]) => ({ from, fromPort, to, toPort, net: fromPort, width }));
  const map = new Map<string, BlockEdge>();
  for (const r of rows) {
    if (r.from === r.to) continue;
    const key = `${r.from}>${r.to}`;
    let e = map.get(key);
    if (!e) { e = { id: key, from: r.from, to: r.to, nets: [], writeback: WRITEBACK_V03.has(key) }; map.set(key, e); }
    if (!e.nets.some((n) => n.fromPort === r.fromPort && n.toPort === r.toPort)) e.nets.push({ net: r.net, width: r.width, fromPort: r.fromPort, toPort: r.toPort });
  }
  return { edges: [...map.values()], source: v03?.connections?.length ? 'artifact' : 'fallback' };
}

// ───────────────────────────── v0.4 HBCI-02: hbci02_digital_top (v04) and hbci_ai_decoder (ai) ──
export const INSTANCES_V04 = ['u_readout', 'u_ai', 'u_bist', '$regs'] as const;
export const INSTANCE_MODULE_V04: Record<string, string> = {
  u_readout: 'hbci_readout_core', u_ai: 'hbci_ai_decoder', u_bist: 'hbci_bist', $regs: 'hbci02_digital_top',
};
export const V04_NODE_ID: Record<string, string> = { u_readout: 'rtl.readout', u_ai: 'rtl.ai', u_bist: 'rtl.u_bist', $regs: 'rtl.regs' };

export const INSTANCES_AI = ['u_quant', 'u_collect', 'u_model', 'u_engine', '$fifo'] as const;
export const INSTANCE_MODULE_AI: Record<string, string> = {
  u_quant: 'hbci_feat_quant', u_collect: 'hbci_frame_collector', u_model: 'hbci_model_store', u_engine: 'hbci_mlp_engine', $fifo: 'hbci_ai_decoder',
};
export const AI_NODE_ID: Record<string, string> = { u_quant: 'rtl.ai_quant', u_collect: 'rtl.ai_collect', u_model: 'rtl.ai_model', u_engine: 'rtl.ai_engine', $fifo: 'rtl.ai_fifo' };

type Row = { from: string; fromPort: string; to: string; toPort: string; net: string; width: number };

function aggregateRows(rows: Row[], writeback: Set<string>): BlockEdge[] {
  const map = new Map<string, BlockEdge>();
  for (const r of rows) {
    if (r.from === r.to) continue;
    const key = `${r.from}>${r.to}`;
    let e = map.get(key);
    if (!e) { e = { id: key, from: r.from, to: r.to, nets: [], writeback: writeback.has(key) }; map.set(key, e); }
    if (!e.nets.some((n) => n.fromPort === r.fromPort && n.toPort === r.toPort)) e.nets.push({ net: r.net, width: r.width, fromPort: r.fromPort, toPort: r.toPort });
  }
  return [...map.values()];
}

/** Drop the netlist's "clk / rst_n → register output" rows (every flop) so only signal paths remain. */
const isClockRow = (c: RtlConnection) => c.from.inst === '' && (c.from.port === 'clk' || c.from.port === 'rst_n') && c.net !== 'clk' && c.net !== 'rst_n';

/**
 * hbci02_digital_top: u_readout, u_ai, u_bist and the register file. The register file is top-level logic, so
 * nets that the top drives into the instances from its registers (cfg_*, model_*, crc_*, pred_pop, bist_*) are
 * shown as coming from the `$regs` node and the status / prediction nets going back to the top as going to it.
 */
export function buildGraphV04(mods: RtlModules | null): { edges: BlockEdge[]; source: 'artifact' | 'missing' } {
  const v04 = mods?.v04;
  if (!v04?.connections?.length) return { edges: [], source: 'missing' };
  const REG_IN = /^(cfg_|model_|crc_|pred_pop|feat_sync|bist_|x_frame_span|\$)/;
  const REG_OUT = /^(stat_|pred_(valid|class$|margin|ts|frame_id|seq|flags|count)|model_(rdata|valid|error|busy|rejected|id)|last_|bist_sig|bist_count|rec_)/;
  const rows: Row[] = [];
  for (const c of v04.connections) {
    if (isClockRow(c)) continue;
    if (c.from.inst === '' && c.to.inst === '') continue;
    let from = c.from.inst, to = c.to.inst === '' ? '$out' : c.to.inst;
    if (from === '' && REG_IN.test(c.net)) from = '$regs';
    if (to === '$out' && (REG_OUT.test(c.to.port) || REG_OUT.test(c.net)) && !/^(rec_|pred_strobe|pred_irq|pred_class_out)/.test(c.to.port)) to = '$regs';
    rows.push({ from, fromPort: c.from.port, to, toPort: c.to.port, net: c.net, width: c.width });
  }
  // the register bus itself
  rows.push({ from: '', fromPort: 'reg_addr', to: '$regs', toPort: 'reg_addr', net: 'reg_addr', width: 8 });
  rows.push({ from: '', fromPort: 'reg_wdata', to: '$regs', toPort: 'reg_wdata', net: 'reg_wdata', width: 32 });
  rows.push({ from: '', fromPort: 'reg_we', to: '$regs', toPort: 'reg_we', net: 'reg_we', width: 1 });
  rows.push({ from: '', fromPort: 'reg_re', to: '$regs', toPort: 'reg_re', net: 'reg_re', width: 1 });
  rows.push({ from: '$regs', fromPort: 'reg_rdata', to: '$out', toPort: 'reg_rdata', net: 'reg_rdata', width: 32 });
  return { edges: aggregateRows(rows, new Set()), source: 'artifact' };
}

/**
 * hbci_ai_decoder: u_quant → u_collect → (pending register, top-level) → u_engine → prediction FIFO (top-level,
 * drawn as `$fifo`) → outputs; u_model feeds u_engine and u_quant. Nets the engine drives into the top's FIFO
 * registers (pred_*) are routed through `$fifo`.
 */
export function buildGraphAi(mods: RtlModules | null): { edges: BlockEdge[]; source: 'artifact' | 'missing' } {
  const ai = mods?.v04?.ai;
  if (!ai?.connections?.length) return { edges: [], source: 'missing' };
  const FIFO_NET = /^(pred_|pcnt|stat_pred)/;
  const rows: Row[] = [];
  for (const c of ai.connections) {
    if (isClockRow(c)) continue;
    if (c.from.inst === '' && c.to.inst === '') continue;
    let from = c.from.inst, to = c.to.inst === '' ? '$out' : c.to.inst;
    if (to === '$out' && FIFO_NET.test(c.to.port)) { to = '$fifo'; }
    if (from === '' && c.from.port === 'pred_ready') from = '$fifo';
    rows.push({ from, fromPort: c.from.port, to, toPort: c.to.port, net: c.net, width: c.width });
  }
  const fifoOut = ['pred_valid', 'pred_class', 'pred_margin', 'pred_ts', 'pred_frame_id', 'pred_seq', 'pred_flags', 'pred_count', 'pred_strobe', 'pred_class_direct'];
  const widths: Record<string, number> = { pred_valid: 1, pred_class: 2, pred_margin: 32, pred_ts: 32, pred_frame_id: 16, pred_seq: 16, pred_flags: 4, pred_count: 3, pred_strobe: 1, pred_class_direct: 2 };
  for (const n of fifoOut) rows.push({ from: '$fifo', fromPort: n, to: '$out', toPort: n, net: n, width: widths[n] });
  rows.push({ from: '', fromPort: 'pred_ready', to: '$fifo', toPort: 'pred_ready', net: 'pred_ready', width: 1 });
  return { edges: aggregateRows(rows, new Set(['u_model>u_quant'])), source: 'artifact' };
}
