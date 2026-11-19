// Die-level block layout and RTL dataflow routes for the v0.4 integrated top (hbci02_digital_top): the v0.3
// readout core (hbci_readout_core, every block and route of the v0.3 map preserved) on the left, the on-chip AI
// decoder (hbci_ai_decoder: quantiser, frame collector, model store, MLP engine, prediction FIFO) on the right,
// with the register file and the BIST block above it. Block identity comes from the RTL; relative block size
// comes from generic synthesis cell counts (synth_stats.json when it lists the modules, else built-in numbers that
// are labelled as such). Placement is CONCEPT: no floorplan has been published for this chip.
import { useMemo } from 'react';
import { COMPONENTS } from '../model/components';
import { useArtifacts } from '../artifacts/load';
import type { DiePath } from './modes';

/** Generic Yosys cell counts of the legacy event-core blocks (v0.2 snapshot; artifact overrides). */
export const BLOCK_CELLS: Record<string, number> = {
  'rtl.u_state': 803,
  'rtl.u_baseline': 479,
  'rtl.u_threshold': 332,
  'rtl.u_timestamp': 188,
  'rtl.u_packer': 149,
  'rtl.u_refractory': 44,
};

/**
 * Placeholder sizes for the v0.3 blocks, used only until synth_stats.json lists their modules.
 * Rough register/multiplier estimates, shown with "est." on the tiles; never mixed with measured numbers.
 */
export const V03_CELLS_ESTIMATE: Record<string, number> = {
  'rtl.u_fstate': 2100,
  'rtl.u_biquad': 7000,
  'rtl.u_energy': 1600,
  'rtl.u_records': 3600,
};

/** Placeholder sizes for the v0.4 blocks (same rule: only until synth_stats.json lists hbci02_digital_top). */
export const V04_CELLS_ESTIMATE: Record<string, number> = {
  'rtl.ai_quant': 400,
  'rtl.ai_collect': 1600,
  'rtl.ai_model': 3900,
  'rtl.ai_engine': 4300,
  'rtl.ai_fifo': 1800,
  'rtl.regs': 3200,
  'rtl.u_bist': 1000,
};

export const EVENT_IDS = Object.keys(BLOCK_CELLS);
export const V03_IDS = Object.keys(V03_CELLS_ESTIMATE);
export const V04_IDS = Object.keys(V04_CELLS_ESTIMATE);

export const BLOCK_TINT: Record<string, string> = {
  'rtl.u_state': '#5b8bd9',
  'rtl.u_baseline': '#4fd19a',
  'rtl.u_threshold': '#f2c14e',
  'rtl.u_refractory': '#f0646e',
  'rtl.u_timestamp': '#b48cf2',
  'rtl.u_packer': '#4fd1e8',
  'rtl.u_fstate': '#3fbf8f',
  'rtl.u_biquad': '#6fe0b0',
  'rtl.u_energy': '#a6e36f',
  'rtl.u_records': '#e0a96d',
  'rtl.raw_path': '#4fd1e8',
  'rtl.u_ts': '#9d8cf2',
  'rtl.ai_quant': '#e88ab0',
  'rtl.ai_collect': '#f0a3c0',
  'rtl.ai_model': '#d9a0e8',
  'rtl.ai_engine': '#f27ea0',
  'rtl.ai_fifo': '#e8b4c8',
  'rtl.regs': '#c9ced6',
  'rtl.u_bist': '#b8c7d9',
};

/** Paper-theme tints: same hues, darkened so borders and the secondary label keep WCAG contrast on a white tile. */
export const BLOCK_TINT_LIGHT: Record<string, string> = {
  'rtl.u_state': '#2f62a8',
  'rtl.u_baseline': '#1e7d4a',
  'rtl.u_threshold': '#8a6400',
  'rtl.u_refractory': '#b3261e',
  'rtl.u_timestamp': '#6e3fb0',
  'rtl.u_packer': '#0b6f85',
  'rtl.u_fstate': '#1c7a57',
  'rtl.u_biquad': '#176b62',
  'rtl.u_energy': '#4f7a12',
  'rtl.u_records': '#9a4f12',
  'rtl.raw_path': '#0b6f85',
  'rtl.u_ts': '#5b4bb0',
  'rtl.ai_quant': '#b03a6a',
  'rtl.ai_collect': '#a0305e',
  'rtl.ai_model': '#7a3f9a',
  'rtl.ai_engine': '#b02a4e',
  'rtl.ai_fifo': '#8c3b5c',
  'rtl.regs': '#4d5760',
  'rtl.u_bist': '#3f5a78',
};

export const BLOCK_SUB: Record<string, string> = {
  'rtl.u_state': 'per-channel state ×8',
  'rtl.u_baseline': 'baseline EMA + residual',
  'rtl.u_threshold': 'threshold detector',
  'rtl.u_refractory': 'refractory',
  'rtl.u_timestamp': 'timestamp',
  'rtl.u_packer': 'event output',
  'rtl.u_fstate': 'feature state ×8 + win_idx',
  'rtl.u_biquad': 'biquad band-pass',
  'rtl.u_energy': 'band energy Σy² → ai_feat tap',
  'rtl.u_records': 'record mux + FIFO',
  'rtl.u_ts': 'global sample counter',
  'rtl.ai_quant': '64·log2(E) → int8',
  'rtl.ai_collect': 'same window index ×8',
  'rtl.ai_model': '46 words · CRC-32',
  'rtl.ai_engine': '8→NH→NO MLP / linear',
  'rtl.ai_fifo': 'pred FIFO ×4 + pending',
  'rtl.regs': 'register map 0x00–0x6D',
  'rtl.u_bist': 'LFSR + MISR self-test',
};

/** Die outline: a rectangle now (the v0.4 top is wider than the v0.3 core). DIE_SIZE keeps the width for the package transition. */
export const DIE_W = 10.2;
export const DIE_H = 6.6;
export const DIE_SIZE = DIE_W;
export const DIE_TOP = 0.1;
/** Pad centre lines (x for the left/right columns, z for the top/bottom rows). */
export const PAD_X = DIE_W / 2 - 0.32;
export const PAD_Z = DIE_H / 2 - 0.32;
/** Outline of hbci02_digital_top (the whole digital logic). */
export const TOP_HALF_X = 4.49;
export const TOP_HALF_Z = 2.8;
/** The readout core keeps its v0.3 square, shifted left. */
export const CORE_HALF = 2.64;
export const RO_CX = -TOP_HALF_X + 0.15 + CORE_HALF;
export const TILE_H = 0.09;
export const TILE_BASE = DIE_TOP + 0.014;
export const TILE_TOP = TILE_BASE + TILE_H;
export const TRACE_Y = TILE_TOP + 0.008;

export interface Rect { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number; w: number; h: number }

export interface BlockRect extends Rect {
  id: string;
  name: string;
  sub: string;
  cells: number;
  cellsLabel: string;
  tint: string;
  path: DiePath;
  /** Per-channel lanes drawn on the tile (state register files). */
  lanes: number;
}

export type EdgeOwner = 'readout' | 'core' | 'raw' | 'ai' | 'top';

export interface DieEdge {
  id: string;
  /** Component ids that count as this edge's source / destination for lab activity. */
  from: string[];
  to: string[];
  signals: string;
  writeback?: boolean;
  path: DiePath;
  owner: EdgeOwner;
  /** Polylines in (x, z); the first is the main lane used for pulses. */
  lanes: [number, number][][];
}

export type PadSide = 'top' | 'bottom' | 'left' | 'right';
export type PadGroup = 'in' | 'rec' | 'reg' | 'pred' | 'clk';
export interface DiePad { x: number; z: number; side: PadSide; k: number; n: number; group: PadGroup }

export interface DieLayout {
  blocks: BlockRect[];
  byId: Record<string, BlockRect>;
  edges: DieEdge[];
  cluster: Rect;
  clusterTiles: Rect;
  raw: Rect;
  feature: Rect;
  spineX: number;
  rawZ: number;
  outZ: number;
  /** Pending-register centres inside the record multiplexer, per record type. */
  pending: { type: 'EVENT' | 'RAW' | 'FEATURE'; x: number; z: number; path: DiePath }[];
  fifo: Rect;
  /** v0.4: the readout core square, the AI decoder cluster and the strip with the register file and BIST. */
  core: Rect;
  ai: Rect;
  strip: Rect;
  /** Illustrative contact pads with the port group each edge stands for. */
  pads: DiePad[];
  eventSource: 'synth_stats.json' | 'built-in snapshot';
  v03Source: 'synth_stats.json' | 'estimate';
  v04Source: 'synth_stats.json' | 'estimate';
  eventCells: number;
  totalCells: number;
  readoutCells: number | null;
  aiCells: number | null;
  topCells: number | null;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function R(x0: number, x1: number, z0: number, z1: number): Rect {
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, h: z1 - z0 };
}

function block(id: string, cells: number, est: boolean, path: DiePath, r: Rect, lanes = 0): BlockRect {
  const name = COMPONENTS[id]?.rtlInstance ?? id;
  return {
    ...r, id, name, cells, path, lanes,
    sub: BLOCK_SUB[id] ?? '', tint: BLOCK_TINT[id] ?? '#8f8fb3',
    cellsLabel: est ? `≈${cells} cells (est.)` : `${cells} cells`,
  };
}

/** The six legacy event-core tiles inside `T` (same arrangement as v0.2, scaled into the cluster). */
function eventTiles(c: Record<string, number>, T: Rect, g: number) {
  const s = c['rtl.u_state'], b = c['rtl.u_baseline'], t = c['rtl.u_threshold'];
  const ts = c['rtl.u_timestamp'], rf = c['rtl.u_refractory'], pk = c['rtl.u_packer'];
  const tot = s + b + t + ts + rf + pk;
  const ws = ((T.w - g) * s) / tot;
  const xr0 = T.x0 + ws + g;
  const wr = T.x1 - xr0;
  const Rr = b + t + ts + rf + pk;
  const Hn = T.h - 2 * g;
  // keep every row tall enough for a legible label
  let hb = (Hn * b) / Rr, ht = (Hn * t) / Rr;
  let hbot = Hn - hb - ht;
  const minH = Math.min(0.36, Hn / 3.2);
  if (hbot < minH) {
    const k = (Hn - minH) / (hb + ht);
    hb *= k;
    ht *= k;
    hbot = minH;
  }
  const zb1 = T.z0 + hb, zt0 = zb1 + g, zt1 = zt0 + ht, zbot0 = zt1 + g;
  const B = ts + rf + pk;
  const wrn = wr - 2 * g;
  let wts = (wrn * ts) / B, wrf = (wrn * rf) / B;
  const minW = 0.2;
  if (wrf < minW) {
    wts -= minW - wrf;
    wrf = minW;
  }
  const st = block('rtl.u_state', s, false, 'event', R(T.x0, T.x0 + ws, T.z0, T.z1), 8);
  const bl = block('rtl.u_baseline', b, false, 'event', R(xr0, T.x1, T.z0, zb1));
  const th = block('rtl.u_threshold', t, false, 'event', R(xr0, T.x1, zt0, zt1));
  const tsr = block('rtl.u_timestamp', ts, false, 'event', R(xr0, xr0 + wts, zbot0, T.z1));
  const rfr = block('rtl.u_refractory', rf, false, 'event', R(xr0 + wts + g, xr0 + wts + g + wrf, zbot0, T.z1));
  const pkr = block('rtl.u_packer', pk, false, 'event', R(xr0 + wts + g + wrf + g, T.x1, zbot0, T.z1));
  return { st, bl, th, tsr, rfr, pkr, wr, zt1, hbot };
}

/** Illustrative pads: 16 per long edge, 10 per short edge, grouped by the ports the studio draws there. */
function makePads(recX: number, regX: number): DiePad[] {
  const out: DiePad[] = [];
  const nTB = 16, nLR = 10;
  for (let k = 0; k < nTB; k++) {
    const x = -4.6 + (k * 9.2) / (nTB - 1);
    out.push({ x, z: -PAD_Z, side: 'top', k, n: nTB, group: Math.abs(x - recX) < Math.abs(x - regX) ? 'rec' : 'reg' });
  }
  for (let k = 0; k < nTB; k++) out.push({ x: -4.6 + (k * 9.2) / (nTB - 1), z: PAD_Z, side: 'bottom', k, n: nTB, group: 'clk' });
  for (let k = 0; k < nLR; k++) out.push({ x: -PAD_X, z: -2.6 + (k * 5.2) / (nLR - 1), side: 'left', k, n: nLR, group: 'in' });
  for (let k = 0; k < nLR; k++) out.push({ x: PAD_X, z: -2.6 + (k * 5.2) / (nLR - 1), side: 'right', k, n: nLR, group: 'pred' });
  return out;
}

export function computeDieLayout(
  ev: Record<string, number>,
  v3: Record<string, number>,
  v4: Record<string, number>,
  eventSource: DieLayout['eventSource'],
  v03Source: DieLayout['v03Source'],
  v04Source: DieLayout['v04Source'],
  readoutCells: number | null,
  aiCells: number | null,
  topCells: number | null,
): DieLayout {
  const g = 0.14, p = 0.16;
  // ── the v0.3 readout core, exactly as before but shifted left by ox ──
  const ox = RO_CX;
  const XS0 = -2.55 + ox, XS1 = -2.33 + ox, spineX = (XS0 + XS1) / 2;
  const XL = -2.2 + ox, XR = 2.52 + ox, Z0 = -2.52, Z1 = 2.52;
  const E = EVENT_IDS.reduce((a, id) => a + ev[id], 0);
  const F = v3['rtl.u_fstate'] + v3['rtl.u_biquad'] + v3['rtl.u_energy'];
  const Rc = v3['rtl.u_records'];
  const T = E + F + Rc;
  const est = v03Source === 'estimate';
  const est4 = v04Source === 'estimate';

  // record multiplexer: a column next to the right edge of the core (area ≈ ∝ cells, clamped)
  const recZ0 = Z0 + 0.3, recZ1 = Z1 - 0.3;
  const wR = clamp(((XR - XL) * (Z1 - Z0) * Rc) / T / (recZ1 - recZ0), 0.85, 1.1);
  const xR0 = XR - wR;
  const XM1 = xR0 - 0.3;

  // bands: legacy EVENT cluster (top), RAW lane + global sample counter (middle), FEATURE path (bottom)
  const hRaw = 0.74;
  const H = Z1 - Z0 - hRaw - 2 * g;
  const hE = clamp((H * E) / (E + F), 2.0, H - 1.5);
  const cluster = R(XL, XM1, Z0, Z0 + hE);
  const raw = R(XL, XM1, cluster.z1 + g, cluster.z1 + g + hRaw);
  const feature = R(XL, XM1, raw.z1 + g, Z1);
  // RAW lanes run along the lower part of the band; u_ts sits in its upper right corner.
  const rawZ = raw.z1 - 0.2;
  const tsR = R(raw.x1 - 1.02, raw.x1 - 0.06, raw.z0 + 0.05, raw.z0 + 0.36);

  const clusterTiles = R(cluster.x0 + 0.08, cluster.x1 - 0.08, cluster.z0 + 0.3, cluster.z1 - 0.08);
  const { st, bl, th, tsr, rfr, pkr, wr, zt1 } = eventTiles(ev, clusterTiles, 0.11);

  // FEATURE path widths ∝ cells (with a legible minimum)
  const fIds = ['rtl.u_fstate', 'rtl.u_biquad', 'rtl.u_energy'];
  const Wf = feature.w - 2 * g;
  const minW = 0.8;
  let ws = fIds.map((id) => (Wf * v3[id]) / F);
  const short = ws.reduce((a, w) => a + Math.max(0, minW - w), 0);
  if (short > 0) {
    const big = ws.reduce((a, w) => a + (w > minW ? w - minW : 0), 0);
    ws = ws.map((w) => (w < minW ? minW : minW + ((w - minW) * (big - short)) / big));
  }
  let fx = feature.x0;
  const fr = fIds.map((_, i) => {
    const r = R(fx, fx + ws[i], feature.z0, feature.z1);
    fx += ws[i] + g;
    return r;
  });
  const fs = block('rtl.u_fstate', v3['rtl.u_fstate'], est, 'feature', fr[0], 8);
  const bq = block('rtl.u_biquad', v3['rtl.u_biquad'], est, 'feature', fr[1]);
  const en = block('rtl.u_energy', v3['rtl.u_energy'], est, 'feature', fr[2]);
  const rec = block('rtl.u_records', Rc, est, 'all', R(xR0, XR, recZ0, recZ1));
  // u_ts is the same module as u_timestamp (hbci_timestamp), instantiated again at the v0.3 top.
  const uts = block('rtl.u_ts', ev['rtl.u_timestamp'], false, 'all', tsR);
  uts.cellsLabel = `${ev['rtl.u_timestamp']} cells (hbci_timestamp)`;

  // ── v0.4: the AI decoder cluster (right), the register file and BIST (strip above it) ──
  const core = R(RO_CX - CORE_HALF, RO_CX + CORE_HALF, -CORE_HALF, CORE_HALF);
  const AX0 = core.x1 + 0.3, AX1 = TOP_HALF_X - 0.15;
  const strip = R(AX0, AX1, -CORE_HALF, -2.14);
  const ai = R(AX0, AX1, -1.92, Z1);
  const colW = (ai.w - g) / 2;
  const lx0 = ai.x0, lx1 = ai.x0 + colW - 0.03, rx0 = lx1 + g, rx1 = ai.x1;
  const quant = block('rtl.ai_quant', v4['rtl.ai_quant'], est4, 'ai', R(lx0, lx1, ai.z1 - 0.7, ai.z1));
  const collect = block('rtl.ai_collect', v4['rtl.ai_collect'], est4, 'ai', R(lx0, lx1, quant.z0 - g - 1.26, quant.z0 - g));
  const model = block('rtl.ai_model', v4['rtl.ai_model'], est4, 'ai', R(lx0, lx1, ai.z0, collect.z0 - g));
  const fifo4 = block('rtl.ai_fifo', v4['rtl.ai_fifo'], est4, 'ai', R(rx0, rx1, ai.z1 - 0.7, ai.z1), 4);
  const engine = block('rtl.ai_engine', v4['rtl.ai_engine'], est4, 'ai', R(rx0, rx1, ai.z0, fifo4.z0 - g));
  const regs = block('rtl.regs', v4['rtl.regs'], est4, 'all', R(strip.x0, strip.x0 + strip.w * 0.57, strip.z0, strip.z1));
  const bist = block('rtl.u_bist', v4['rtl.u_bist'], est4, 'all', R(regs.x1 + g, strip.x1, strip.z0, strip.z1));
  if (!est4) {
    regs.cellsLabel = `${v4['rtl.regs']} cells (top − submodules)`;
    fifo4.cellsLabel = `${v4['rtl.ai_fifo']} cells (decoder − submodules)`;
  }

  const blocks = [st, bl, th, rfr, tsr, pkr, fs, bq, en, uts, rec, quant, collect, model, engine, fifo4, regs, bist];
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));

  // record-mux internals: pending registers at the arrival height of each record type, then FIFO
  const zEv = clamp(pkr.cz, recZ0 + 0.25, recZ1 - 0.25);
  const zFe = clamp(en.cz, recZ0 + 0.25, recZ1 - 0.25);
  const pending: DieLayout['pending'] = [
    { type: 'EVENT', x: xR0 + 0.2, z: zEv, path: 'event' },
    { type: 'RAW', x: xR0 + 0.2, z: rawZ, path: 'raw' },
    { type: 'FEATURE', x: xR0 + 0.2, z: zFe, path: 'feature' },
  ];
  const fifo = R(xR0 + 0.5, XR - 0.1, recZ0 + 0.55, recZ1 - 0.2);
  const outZ = fifo.cz;
  const pads = makePads(rec.cx, regs.cx);

  const rfx = (f: number) => rfr.x0 + rfr.w * f;
  const zg = zt1 + 0.11 / 2;
  const lanes3 = (x0: number, x1: number, z: number, d = 0.1) => [0, -1, 1].map((k) => [[x0, z + k * d], [x1, z + k * d]] as [number, number][]);
  const lanes3v = (x: number, z0: number, z1: number, d = 0.1) => [0, -1, 1].map((k) => [[x + k * d, z0], [x + k * d, z1]] as [number, number][]);
  const tapZ = Z1 + 0.08;
  const aiGapX = ai.x0 - 0.12;
  const busZ = strip.z1 + 0.11;

  const edges: DieEdge[] = [
    // shared plumbing
    { id: 'in', from: ['die.pads', 'rtl.readout'], to: ['rtl.readout'], path: 'all', owner: 'readout', signals: 'in_valid, in_channel[2:0], in_sample[15:0]', lanes: lanes3(-PAD_X, spineX + 0.03, rawZ) },
    { id: 'out', from: ['rtl.u_records'], to: ['die.pads', 'rtl.readout', 'rtl.u_records'], path: 'all', owner: 'readout', signals: 'rec_valid, rec_type, rec_channel, rec_flags, rec_seq, rec_ts, rec_data', lanes: lanes3v(rec.cx, rec.z0 + p, -PAD_Z, 0.14) },
    // RAW: straight through
    { id: 'raw', from: ['rtl.raw_path', 'rtl.readout'], to: ['rtl.u_records'], path: 'raw', owner: 'raw', signals: 'raw_gen · {channel, sample}', lanes: lanes3(spineX, xR0 + 0.12, rawZ) },
    { id: 'ts_rec', from: ['rtl.u_ts'], to: ['rtl.u_records'], path: 'all', owner: 'readout', signals: 'sample_idx → raw_ts, ft_ts', lanes: [[[uts.x1 - p, uts.cz], [xR0 + 0.12, uts.cz]]] },
    // EVENT: spine → legacy core → record mux
    { id: 'sp_ev', from: ['rtl.readout', 'die.pads'], to: ['rtl.u_state', 'rtl.core'], path: 'event', owner: 'readout', signals: 'accepted sample → u_event', lanes: [[[spineX, rawZ - 0.1], [spineX, st.cz], [st.x0 + p, st.cz]]] },
    { id: 'ev_rec', from: ['rtl.u_packer', 'rtl.core'], to: ['rtl.u_records'], path: 'event', owner: 'readout', signals: 'ev_valid · {channel, timestamp, polarity, magnitude}', lanes: [[[pkr.x1 - p, zEv], [xR0 + 0.12, zEv]]] },
    // FEATURE: spine → state → biquad → energy → record mux
    { id: 'sp_fs', from: ['rtl.readout', 'die.pads'], to: ['rtl.u_fstate'], path: 'feature', owner: 'readout', signals: 'accepted sample → feature state', lanes: [[[spineX, rawZ + 0.1], [spineX, fs.cz], [fs.x0 + p, fs.cz]]] },
    { id: 'fs_bq', from: ['rtl.u_fstate'], to: ['rtl.u_biquad'], path: 'feature', owner: 'readout', signals: 'x1, x2, y1, y2', lanes: [[[fs.x1 - p, fs.cz - 0.32], [bq.x0 + p, fs.cz - 0.32]]] },
    { id: 'bq_fs', from: ['rtl.u_biquad'], to: ['rtl.u_fstate'], path: 'feature', owner: 'readout', writeback: true, signals: 'y → y1, x → x1 (write-back)', lanes: [[[bq.x0 + p, fs.cz - 0.12], [fs.x1 - p, fs.cz - 0.12]]] },
    { id: 'bq_en', from: ['rtl.u_biquad'], to: ['rtl.u_energy'], path: 'feature', owner: 'readout', signals: 'y (filtered sample), ysat', lanes: [[[bq.x1 - p, bq.cz + 0.15], [en.x0 + p, bq.cz + 0.15]]] },
    { id: 'fs_en', from: ['rtl.u_fstate'], to: ['rtl.u_energy'], path: 'feature', owner: 'readout', signals: 'acc, cnt, win_idx', lanes: [[[fs.cx, fs.z1 - p], [fs.cx, Z1 + 0.06], [en.cx + 0.08, Z1 + 0.06], [en.cx + 0.08, en.z1 - p]]] },
    { id: 'en_fs', from: ['rtl.u_energy'], to: ['rtl.u_fstate'], path: 'feature', owner: 'readout', writeback: true, signals: 'acc_next, cnt_next, win_idx + 1 (write-back)', lanes: [[[en.cx - 0.08, en.z0 + p], [en.cx - 0.08, feature.z0 - g / 2], [fs.cx + 0.1, feature.z0 - g / 2], [fs.cx + 0.1, fs.z0 + p]]] },
    { id: 'en_rec', from: ['rtl.u_energy'], to: ['rtl.u_records'], path: 'feature', owner: 'readout', signals: 'done · energy[31:0], sat', lanes: [[[en.x1 - p, zFe], [xR0 + 0.12, zFe]]] },
    // legacy EVENT core internals (unchanged v0.2 connections)
    { id: 'st_bl', from: ['rtl.u_state'], to: ['rtl.u_baseline'], path: 'event', owner: 'core', signals: 'rd_baseline, rd_primed', lanes: [[[st.x1 - p, bl.cz - 0.1], [bl.x0 + p, bl.cz - 0.1]]] },
    { id: 'bl_st', from: ['rtl.u_baseline'], to: ['rtl.u_state'], path: 'event', owner: 'core', writeback: true, signals: 'baseline_next (write-back)', lanes: [[[bl.x0 + p, bl.cz + 0.1], [st.x1 - p, bl.cz + 0.1]]] },
    { id: 'bl_th', from: ['rtl.u_baseline'], to: ['rtl.u_threshold'], path: 'event', owner: 'core', signals: 'residual[16:0]', lanes: [[[bl.x0 + wr * 0.35, bl.z1 - 0.08], [bl.x0 + wr * 0.35, th.z0 + 0.08]]] },
    { id: 'th_rf', from: ['rtl.u_threshold'], to: ['rtl.u_refractory'], path: 'event', owner: 'core', signals: 'above, below_rearm', lanes: [[[rfx(0.75), th.z1 - 0.08], [rfx(0.75), rfr.z0 + 0.08]]] },
    { id: 'th_pk', from: ['rtl.u_threshold'], to: ['rtl.u_packer'], path: 'event', owner: 'core', signals: 'magnitude, polarity', lanes: [[[pkr.cx - 0.12, th.z1 - 0.08], [pkr.cx - 0.12, pkr.z0 + 0.08]]] },
    { id: 'st_rf', from: ['rtl.u_state'], to: ['rtl.u_refractory'], path: 'event', owner: 'core', signals: 'rd_armed, rd_refr', lanes: [[[st.x1 - p, zg - 0.03], [rfx(0.45), zg - 0.03], [rfx(0.45), rfr.z0 + 0.08]]] },
    { id: 'rf_st', from: ['rtl.u_refractory'], to: ['rtl.u_state'], path: 'event', owner: 'core', writeback: true, signals: 'armed_next, refr_next (write-back)', lanes: [[[rfx(0.2), rfr.z0 + 0.08], [rfx(0.2), zg + 0.03], [st.x1 - p, zg + 0.03]]] },
    { id: 'rf_pk', from: ['rtl.u_refractory'], to: ['rtl.u_packer'], path: 'event', owner: 'core', signals: 'fire', lanes: [[[rfr.cx, rfr.z1 - 0.12], [pkr.x0 + 0.08, rfr.z1 - 0.12]]] },
    { id: 'ts_pk', from: ['rtl.u_timestamp'], to: ['rtl.u_packer'], path: 'event', owner: 'core', signals: 'ts_now[31:0]', lanes: [[[tsr.cx, tsr.z1 - 0.08], [tsr.cx, clusterTiles.z1 + 0.045], [pkr.cx + 0.1, clusterTiles.z1 + 0.045], [pkr.cx + 0.1, pkr.z1 - 0.08]]] },
    // v0.4: the FEATURE tap into the decoder, the decoder's internal routes, the prediction output
    { id: 'tap', from: ['rtl.u_energy', 'rtl.readout'], to: ['rtl.ai_quant', 'rtl.ai'], path: 'ai', owner: 'ai', signals: 'ai_feat_valid · {ch, energy[31:0], ts[31:0], sat, win_idx[15:0]} (before the record FIFO)', lanes: [[[en.x1 - 0.12, en.z1 - p], [en.x1 - 0.12, tapZ], [quant.cx, tapZ], [quant.cx, quant.z1 - p]]] },
    { id: 'q_c', from: ['rtl.ai_quant'], to: ['rtl.ai_collect'], path: 'ai', owner: 'ai', signals: 'x[7:0] (int8) with feat_valid, feat_ch, feat_ts, feat_sat, feat_win', lanes: [[[quant.cx, quant.z0 + p], [quant.cx, collect.z1 - p]]] },
    { id: 'm_q', from: ['rtl.ai_model'], to: ['rtl.ai_quant'], path: 'ai', owner: 'ai', signals: 'centre[11:0], qshift[2:0] of the feature\'s channel (model words 36..43)', lanes: [[[model.x0 + p, model.cz + 0.5], [aiGapX, model.cz + 0.5], [aiGapX, quant.cz], [quant.x0 + p, quant.cz]]] },
    { id: 'c_e', from: ['rtl.ai_collect'], to: ['rtl.ai_engine', 'rtl.ai_fifo'], path: 'ai', owner: 'ai', signals: 'frame_valid · frame_x[63:0], frame_id, frame_ts, frame_sat → pending register → start, in_x, in_frame_id, in_ts, in_sat', lanes: [[[collect.x1 - p, collect.cz], [engine.x0 + p, collect.cz]]] },
    { id: 'm_e', from: ['rtl.ai_model'], to: ['rtl.ai_engine'], path: 'ai', owner: 'ai', signals: 'w1_flat, w2_flat, b1, b2, s1, linear, model_valid', lanes: lanes3(model.x1 - p, engine.x0 + p, model.cz, 0.09) },
    { id: 'e_f', from: ['rtl.ai_engine'], to: ['rtl.ai_fifo'], path: 'ai', owner: 'ai', signals: 'done · out_class[1:0], out_margin[31:0], frame id, ts, sat', lanes: [[[engine.cx, engine.z1 - p], [engine.cx, fifo4.z0 + p]]] },
    { id: 'pred', from: ['rtl.ai_fifo', 'rtl.ai'], to: ['die.pads'], path: 'ai', owner: 'ai', signals: 'pred_strobe, pred_class_out[1:0], pred_irq (direct pins); FIFO head over the register bus', lanes: lanes3(fifo4.x1 - p, PAD_X, fifo4.cz, 0.09) },
    // v0.4: register bus and the register file
    { id: 'bus', from: ['die.pads'], to: ['rtl.regs', 'rtl.top04'], path: 'all', owner: 'top', signals: 'reg_addr[7:0], reg_wdata[31:0], reg_we, reg_re → · ← reg_rdata[31:0]', lanes: lanes3v(regs.cx, -PAD_Z, regs.z0 + p, 0.1) },
    { id: 'regs_model', from: ['rtl.regs'], to: ['rtl.ai_model'], path: 'all', owner: 'top', signals: 'model_we, model_addr[5:0], model_wdata[31:0], crc_we, crc_wdata, model_verify, model_clear_rej (MODEL[0..45], MODEL_CRC, MODEL_CTRL)', lanes: [[[regs.cx - 0.3, regs.z1 - p], [regs.cx - 0.3, model.z0 + p]]] },
    { id: 'regs_ai', from: ['rtl.regs'], to: ['rtl.ai_engine', 'rtl.ai_fifo', 'rtl.ai'], path: 'all', owner: 'top', signals: 'cfg_ai_en, cfg_ch_mask, cfg_frame_span, feat_sync, pred_pop (PRED_ACK) → · ← pred_* head, stat_*, LAST_* diagnostics', lanes: [[[regs.x1 - 0.3, regs.z1 - p], [regs.x1 - 0.3, busZ], [engine.cx, busZ], [engine.cx, engine.z0 + p]]] },
    { id: 'regs_cfg', from: ['rtl.regs'], to: ['rtl.readout', 'rtl.core', 'rtl.u_fstate'], path: 'all', owner: 'top', signals: 'cfg_session_en, cfg_mode, cfg_threshold … cfg_energy_shift, feat_sync → · ← stat_samples … stat_fifo_hwm', lanes: [[[regs.x0 + p, regs.cz], [core.x1 + 0.02, regs.cz]]] },
    { id: 'bist', from: ['rtl.u_bist'], to: ['rtl.regs'], path: 'all', owner: 'top', signals: 'bist_sig (MISR), bist_count ← · → enable, clear, len (BIST_CTRL); u_bist also taps the sample input, rec_* and pred_*', lanes: [[[bist.x0 + p, bist.cz], [regs.x1 - p, regs.cz]]] },
  ];

  return {
    blocks, byId, edges, cluster, clusterTiles, raw, feature, spineX, rawZ, outZ, pending, fifo,
    core, ai, strip, pads,
    eventSource, v03Source, v04Source, eventCells: E, totalCells: T, readoutCells, aiCells, topCells,
  };
}

/** Layout from synth_stats.json when available, else the built-in numbers (never mixed per group). */
export function useDieLayout(): DieLayout {
  const synth = useArtifacts((s) => s.synth);
  return useMemo(() => {
    const cellsOf = (mod: string | undefined) => {
      if (!mod || !synth?.modules?.length) return null;
      const m = synth.modules.find((x) => x.module === mod) ?? synth.modules.find((x) => x.module.includes(mod));
      return m && m.cells > 0 ? m.cells : null;
    };
    const lookup = (ids: string[]) => {
      const out: Record<string, number> = {};
      for (const id of ids) {
        const c = cellsOf(COMPONENTS[id]?.rtlModule);
        if (c) out[id] = c;
      }
      return Object.keys(out).length === ids.length ? out : null;
    };
    const ev = lookup(EVENT_IDS);
    const v3 = lookup(V03_IDS);
    // v0.4: the five decoder modules + BIST come from synth_stats.json; the prediction FIFO (decoder top-level
    // logic) and the register file (hbci02_digital_top top-level logic) are the totals minus their submodules.
    const top = cellsOf('hbci02_digital_top');
    const aiTot = cellsOf('hbci_ai_decoder');
    const parts = { quant: cellsOf('hbci_feat_quant'), collect: cellsOf('hbci_frame_collector'), model: cellsOf('hbci_model_store'), engine: cellsOf('hbci_mlp_engine'), bist: cellsOf('hbci_bist'), readout: cellsOf('hbci_readout_core') };
    let v4: Record<string, number> | null = null;
    if (top && aiTot && parts.quant && parts.collect && parts.model && parts.engine && parts.bist && parts.readout) {
      v4 = {
        'rtl.ai_quant': parts.quant, 'rtl.ai_collect': parts.collect, 'rtl.ai_model': parts.model, 'rtl.ai_engine': parts.engine,
        'rtl.ai_fifo': Math.max(1, aiTot - parts.quant - parts.collect - parts.model - parts.engine),
        'rtl.regs': Math.max(1, top - parts.readout - aiTot - parts.bist),
        'rtl.u_bist': parts.bist,
      };
    }
    return computeDieLayout(
      ev ?? { ...BLOCK_CELLS },
      v3 ?? { ...V03_CELLS_ESTIMATE },
      v4 ?? { ...V04_CELLS_ESTIMATE },
      ev ? 'synth_stats.json' : 'built-in snapshot',
      v3 ? 'synth_stats.json' : 'estimate',
      v4 ? 'synth_stats.json' : 'estimate',
      parts.readout,
      aiTot,
      top,
    );
  }, [synth]);
}
