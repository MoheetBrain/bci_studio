// DEMO model of the v0.3 readout core (docs/V03_READOUT_SPEC.md): a bit-accurate TypeScript port of the
// FEATURE path (DF-I biquad, Q2.14, rounding + saturation; windowed y² energy) and of RAW/EVENT record
// generation. The record multiplexer's cycle timing (pending registers, FIFO, drops) is NOT modelled:
// the DEMO assumes no overload. The RTL trace shows real record timing. Evidence: DEMO.
import { FEATURE, TEACHING } from '../model/system';
import type { ProcMode } from '../model/types';
import { freshState, stepCore, type CoreConfig } from './model';

export const NUM_CH = TEACHING.num_channels;
export const FS = TEACHING.sample_rate_hz;

export interface FeatureConfig { b0: number; b1: number; b2: number; a1: number; a2: number; winLog2: number; energyShift: number }
export const DEFAULT_FEATURE: FeatureConfig = {
  ...FEATURE.coefficients_q14,
  winLog2: FEATURE.defaults.win_log2,
  energyShift: FEATURE.defaults.energy_shift,
};

const sat16 = (v: number) => Math.max(-32768, Math.min(32767, v));
const SAT32 = 4294967295;

export interface FState { x1: number; x2: number; y1: number; y2: number; acc: bigint; cnt: number; sat: boolean }

/** Fresh per-channel FEATURE state (reset values of hbci_feature_state). */
export function freshFeature(): FState {
  return { x1: 0, x2: 0, y1: 0, y2: 0, acc: 0n, cnt: 0, sat: false };
}

export interface FeatStep { y: number; ysat: 0 | 1; acc: number; cnt: number; done: 0 | 1; energy: number; esat: 0 | 1 }

/** One accepted sample through the feature path (exact integer arithmetic). */
export function stepFeature(st: FState, x: number, c: FeatureConfig): FeatStep {
  // Products fit easily in float64 integers (|p| < 2^35), so Number arithmetic is exact here.
  const p = c.b0 * x + c.b1 * st.x1 + c.b2 * st.x2 - c.a1 * st.y1 - c.a2 * st.y2;
  const yFull = Math.floor((p + 8192) / 16384); // arithmetic shift right by 14 == floor division
  const y = sat16(yFull);
  const ysat: 0 | 1 = y !== yFull ? 1 : 0;
  const accBefore = st.acc;
  const cntBefore = st.cnt;
  const accNext = st.acc + BigInt(y * y);
  const win = 1 << Math.min(c.winLog2, 10);
  const done: 0 | 1 = st.cnt === win - 1 ? 1 : 0;
  let energy = 0;
  let esat: 0 | 1 = 0;
  if (done) {
    const shifted = accNext >> BigInt(c.energyShift);
    if (shifted > BigInt(SAT32)) { energy = SAT32; esat = 1; } else energy = Number(shifted);
  }
  const satFlag = st.sat || ysat === 1;
  if (done) { st.acc = 0n; st.cnt = 0; st.sat = false; } else { st.acc = accNext; st.cnt += 1; st.sat = satFlag; }
  st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
  return { y, ysat, acc: Number(accBefore), cnt: cntBefore, done, energy, esat: (esat || (done && satFlag)) ? 1 : 0 };
}

// ───────────────────────────────────────────── synthetic teaching scenario ──

export interface ScenarioTruth {
  channels: { ch: number; description: string }[];
  bursts: { ch: number; t0: number; t1: number; fHz: number; amp: number }[];
  spikes: { ch: number; t: number; amp: number }[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 8-channel teaching scenario at FS (per channel, T samples), plus user-injected bursts. */
export function teachingScenario(T: number, noise: number, seed: number, injected: { ch: number; t: number }[] = []) {
  const r = rng(seed);
  const g = () => (r() + r() + r() + r() + r() + r() - 3) * 1.414;
  const x: number[][] = Array.from({ length: NUM_CH }, () => new Array(T).fill(0));
  const truth: ScenarioTruth = {
    channels: [
      { ch: 0, description: '10 Hz oscillation + noise (below the band)' },
      { ch: 1, description: 'noise + 100 Hz burst (in band)' },
      { ch: 2, description: '300 Hz tone (above the band)' },
      { ch: 3, description: 'linear chirp 20 → 400 Hz' },
      { ch: 4, description: 'broadband noise' },
      { ch: 5, description: 'spikes (for EVENT)' },
      { ch: 6, description: '100 Hz amplitude-modulated (in band)' },
      { ch: 7, description: 'step + large-amplitude 100 Hz segment (saturation)' },
    ],
    bursts: [],
    spikes: [],
  };
  const tau = 2 * Math.PI / FS;
  for (let t = 0; t < T; t++) {
    x[0][t] = 1500 * Math.sin(tau * 10 * t);
    x[2][t] = 1200 * Math.sin(tau * 300 * t);
    const f = 20 + (380 * t) / T; // chirp instantaneous frequency
    x[3][t] = 1200 * Math.sin(tau * (20 * t + (380 / (2 * T)) * t * t));
    void f;
    x[6][t] = 1200 * (0.5 + 0.5 * Math.sin(tau * 3 * t)) * Math.sin(tau * 100 * t);
    x[7][t] = t < T * 0.4 ? -2000 : t < T * 0.6 ? 6000 : 6000 + 26000 * Math.sin(tau * 100 * t);
    for (let ch = 0; ch < NUM_CH; ch++) x[ch][t] += g() * (ch === 4 ? noise * 4 : noise);
  }
  const b1 = { ch: 1, t0: Math.floor(T * 0.35), t1: Math.floor(T * 0.65), fHz: 100, amp: 1500 };
  truth.bursts.push(b1, { ch: 6, t0: 0, t1: T, fHz: 100, amp: 1200 });
  for (const inj of injected) truth.bursts.push({ ch: inj.ch, t0: inj.t, t1: Math.min(T, inj.t + 60), fHz: 100, amp: 2500 });
  for (const b of truth.bursts.slice(0, 1).concat(truth.bursts.slice(2))) {
    for (let t = b.t0; t < b.t1; t++) {
      const env = Math.sin((Math.PI * (t - b.t0)) / (b.t1 - b.t0));
      x[b.ch][t] += b.amp * env * Math.sin(tau * b.fHz * t);
    }
  }
  const shape = [0.15, -0.55, -1.0, -0.35, 0.3, 0.22, 0.08];
  for (let t = 30; t < T - 10; t += 37 + Math.floor(r() * 30)) {
    const amp = 900 + r() * 1400;
    truth.spikes.push({ ch: 5, t, amp });
    shape.forEach((k, j) => { if (t + j - 2 < T) x[5][t + j - 2] += k * amp; });
  }
  for (const row of x) for (let t = 0; t < T; t++) row[t] = sat16(Math.round(row[t]));
  return { x, truth };
}

// ───────────────────────────────────────────── full DEMO run ──

export interface DemoRecord { type: 0 | 1 | 2; ch: number; seq: number; ts: number; data: number; flags: number }
export interface DemoSample { i: number; ch: number; t: number; x: number; y: number; ysat: 0 | 1; acc: number; cnt: number; done: 0 | 1; energy: number; fire: 0 | 1; pol: 0 | 1; mag: number }

export interface DemoRunV03 {
  samples: DemoSample[];               // indexed by global sample index i = t * NUM_CH + ch
  records: Record<ProcMode, DemoRecord[]>;
  T: number;
}

export function runReadout(x: number[][], core: CoreConfig, feat: FeatureConfig): DemoRunV03 {
  const T = x[0].length;
  const cs = freshState();
  const fs: FState[] = Array.from({ length: NUM_CH }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0, acc: 0n, cnt: 0, sat: false }));
  const samples: DemoSample[] = new Array(T * NUM_CH);
  const seq = { raw: 0, ev: 0, ft: 0 };
  const rec: Record<ProcMode, DemoRecord[]> = { EVENT: [], RAW: [], FEATURE: [], HYBRID: [] };
  for (let t = 0; t < T; t++) {
    for (let ch = 0; ch < NUM_CH; ch++) {
      const i = t * NUM_CH + ch;
      const xv = x[ch][t];
      const e = stepCore(cs[ch], i, ch, xv, core);
      const f = stepFeature(fs[ch], xv, feat);
      samples[i] = { i, ch, t, x: xv, y: f.y, ysat: f.ysat, acc: f.acc, cnt: f.cnt, done: f.done, energy: f.energy, fire: e.fire, pol: e.pol, mag: e.mag };
      const rawRec: DemoRecord = { type: 0, ch, seq: seq.raw++, ts: i, data: xv, flags: 0 };
      rec.RAW.push(rawRec);
      rec.HYBRID.push({ ...rawRec });
      if (f.done) {
        const fr: DemoRecord = { type: 2, ch, seq: seq.ft++, ts: i, data: f.energy, flags: f.esat ? 1 : 0 };
        rec.FEATURE.push(fr);
        rec.HYBRID.push({ ...fr });
      }
      if (e.fire) rec.EVENT.push({ type: 1, ch, seq: seq.ev++, ts: i, data: (e.pol << 16) | e.mag, flags: 0 });
    }
  }
  return { samples, records: rec, T };
}
