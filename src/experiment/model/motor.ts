// Motor-cortex experiment: from an intended cursor movement to a decoded one, through every stage of a recording
// chain. One deterministic simulation; every number shown in the Experiment scene is read from its result.
//
// SIMULATED — a teaching model. Nothing here is a recording, and its numbers are not predictions for an implant.
//
//   intent      what the (simulated) user wants the cursor to do: a 2-D velocity, |v| ≤ 1.
//   neurons     24 model units, three near each of 8 contacts. Firing rate = base + |v|·(k + m·cos(θ − θ_pref)):
//               cosine direction tuning (Georgopoulos et al. 1982) with a speed term (Moran & Schwartz 1999).
//               Spike times are Poisson with a 3 ms dead time.
//   spike       one Hodgkin–Huxley action potential (template.ts); the contact sees its negative time-derivative,
//               scaled to 120 µV at 30 µm and falling as 1 / distance (the studio's stated teaching rule).
//   electrode   contact voltage = Σ spikes + white noise (rms given in the 0.3–7.5 kHz band) + a slow field potential
//               + a DC electrode offset (+ optional common-mode artefacts: mains hum and brief transients).
//   front end   1st-order high-pass → 2nd-order Butterworth low-pass → gain → saturation at ±1 V.
//   ADC         ideal sampler at fs (every k-th point of a 30 kHz grid, so a wide filter really does alias) and a
//               mid-tread quantiser, ±1 V full scale.
//   DSP         300 Hz – 3 kHz band-pass (two biquads), optional common average reference, threshold at −K·σ̂ with
//               σ̂ = median|x| / 0.6745 from the first second, 1 ms dead time, counts per 50 ms bin, exponential smoothing.
//   decoder     any Model from decoders.ts (fitted on a calibration run of this same chain).
//   feedback    closed loop: the simulated user sees the cursor 100 ms late and always aims at the target.
//
// Pure module: no DOM, no three.js. Unit-tested in tests/experiment-motor.test.ts.
import { afeMagnitude, butterHP2, butterLP2, lsbOf, madSigma, quantise } from './dsp.ts';
import { gaussian, mulberry32, subSeed } from './rng.ts';
import { spikeTemplate } from './template.ts';
import type { Dataset, Model, StepOut } from './decoders.ts';

export const GRID_HZ = 30000;
export const BIN_MS = 50;
export const N_CH = 8;
export const UNITS_PER_CH = 3;
export const REF_AMP_UV = 120;
export const REF_DIST_UM = 30;
/** Distance of the nearest neuron in the reference placement, µm. */
export const NEAR0_UM = 45;
export const SAMPLE_RATES_HZ = [30000, 15000, 10000, 6000, 5000, 3000, 2000] as const;
export const HP_CHOICES_HZ = [0, 1, 10, 100, 300, 500] as const;
export const SWING_V = 1;
export const VREF_V = 1;
/** The detector estimates its noise level during this first stretch; nothing is decoded before it ends. */
export const CAL_S = 1;
export const DSP_BAND_HZ: [number, number] = [300, 3000];
/** Cursor speed at |decoded velocity| = 1, workspace units per second (the workspace is ±1). */
export const VMAX = 1.4;
export const TARGET_RING = 0.7;
export const TARGET_RADIUS = 0.16;
/** How late the simulated user sees the cursor, bins (2 × 50 ms). */
export const FEEDBACK_DELAY_BINS = 2;

export interface MotorParams {
  seed: number;
  /** Distance from each contact to its nearest neuron, µm (all contacts move together). */
  nearUm: number;
  /** Noise at the electrode, µV rms in the 0.3–7.5 kHz band. */
  noiseUv: number;
  /** Add common-mode artefacts (mains hum and brief transients on all contacts at once). */
  artefact: boolean;
  gain: number;
  /** High-pass corner of the front end, Hz. 0 = DC-coupled. */
  hpHz: number;
  /** Low-pass (anti-alias) corner of the front end, Hz. */
  lpHz: number;
  fsHz: number;
  bits: number;
  /** Subtract the average of all contacts from each contact. */
  car: boolean;
  /** Detection threshold, in multiples of the noise estimate. */
  threshK: number;
  /** Time constant of the firing-rate smoothing, ms. */
  tauMs: number;
  /** The contact whose waveforms are kept for display. */
  focusCh: number;
}

export const DEFAULT_MOTOR: MotorParams = {
  seed: 11, nearUm: NEAR0_UM, noiseUv: 7, artefact: true, gain: 500, hpHz: 300, lpHz: 7500, fsHz: 30000, bits: 12, car: true, threshK: 4.5, tauMs: 250, focusCh: 0,
};
export const MOTOR_LIMITS = { nearUm: [25, 200], noiseUv: [1, 40], gain: [20, 5000], lpHz: [500, 12000], bits: [4, 16], threshK: [3, 7], tauMs: [50, 800] } as const;

export function clampMotor(p: MotorParams): MotorParams {
  const c = (v: number, [lo, hi]: readonly [number, number], d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const D = DEFAULT_MOTOR;
  return {
    seed: Number.isFinite(p.seed) ? Math.floor(p.seed) >>> 0 : D.seed,
    nearUm: c(p.nearUm, MOTOR_LIMITS.nearUm, D.nearUm), noiseUv: c(p.noiseUv, MOTOR_LIMITS.noiseUv, D.noiseUv), artefact: !!p.artefact,
    gain: c(p.gain, MOTOR_LIMITS.gain, D.gain),
    hpHz: (HP_CHOICES_HZ as readonly number[]).includes(p.hpHz) ? p.hpHz : D.hpHz,
    lpHz: c(p.lpHz, MOTOR_LIMITS.lpHz, D.lpHz),
    fsHz: (SAMPLE_RATES_HZ as readonly number[]).includes(p.fsHz) ? p.fsHz : D.fsHz,
    bits: Math.round(c(p.bits, MOTOR_LIMITS.bits, D.bits)), car: !!p.car,
    threshK: c(p.threshK, MOTOR_LIMITS.threshK, D.threshK), tauMs: c(p.tauMs, MOTOR_LIMITS.tauMs, D.tauMs),
    focusCh: Math.max(0, Math.min(N_CH - 1, Math.round(Number.isFinite(p.focusCh) ? p.focusCh : 0))),
  };
}

// ── the model neurons ───────────────────────────────────────────────────────────────────────────────────────────
export interface Unit {
  id: number;
  ch: number;
  /** 0 = nearest to its contact, 2 = furthest. */
  rank: number;
  /** Distance to the contact in the reference placement, µm. */
  dist0Um: number;
  /** Preferred direction, radians (0 = right, π/2 = up). */
  prefRad: number;
  baseHz: number;
  /** Depth of direction tuning, Hz at full speed. */
  modHz: number;
  /** Speed-only term, Hz at full speed. */
  speedHz: number;
  /** Position relative to its contact, µm (for drawing only). */
  pos: [number, number, number];
}

const LAYOUT_SEED = 1105;
let unitsCache: Unit[] | null = null;
/** The same 24 units every time: the "tissue" does not change when a recording parameter does. */
export function layoutUnits(): Unit[] {
  if (unitsCache) return unitsCache;
  const r = mulberry32(LAYOUT_SEED), out: Unit[] = [];
  for (let ch = 0; ch < N_CH; ch++) {
    for (let rank = 0; rank < UNITS_PER_CH; rank++) {
      const dist0Um = rank === 0 ? 38 + 14 * r() : rank === 1 ? 72 + 30 * r() : 135 + 55 * r();
      const prefRad = rank === 0 ? (ch * Math.PI) / 4 + (r() - 0.5) * 0.5 : r() * 2 * Math.PI;
      const baseHz = rank === 0 ? 15 + 6 * r() : rank === 1 ? 9 + 6 * r() : 6 + 6 * r();
      const modHz = rank === 0 ? 30 + 10 * r() : rank === 1 ? 12 + 8 * r() : 6 + 6 * r();
      const az = r() * 2 * Math.PI, el = (r() - 0.5) * 1.6;
      out.push({ id: out.length, ch, rank, dist0Um, prefRad, baseHz, modHz, speedHz: 2 + 3 * r(), pos: [Math.cos(az) * Math.cos(el) * dist0Um, Math.sin(el) * dist0Um, Math.sin(az) * Math.cos(el) * dist0Um] });
    }
  }
  return (unitsCache = out);
}
/** Firing rate of a unit for an intended velocity (vx, vy), spikes per second. */
export function unitRate(u: Unit, vx: number, vy: number): number {
  const sp = Math.hypot(vx, vy);
  if (sp < 1e-9) return u.baseHz;
  return Math.max(0, u.baseHz + sp * (u.speedHz + u.modHz * Math.cos(Math.atan2(vy, vx) - u.prefRad)));
}
/** Size of a unit's spike at its contact, µV (negative peak), by the 1 / distance rule. */
export const unitAmpUv = (u: Unit, nearUm: number) => (REF_AMP_UV * REF_DIST_UM) / Math.max(10, u.dist0Um + (nearUm - NEAR0_UM));

/** White-noise rms on the 30 kHz grid that gives 1 µV rms after the reference front-end band (0.3–7.5 kHz). */
const GRID_PER_BAND = (() => {
  let acc = 0, n = 0;
  for (let f = 5; f < GRID_HZ / 2; f += 10) { acc += afeMagnitude(f, 300, 7500) ** 2; n++; }
  return 1 / Math.sqrt(acc / n);
})();

// ── tasks ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type Task =
  /** Open loop: the cursor is moved for the user along straight reaches; the user is assumed to intend the same movement. */
  | { mode: 'calibration'; taskSeed: number; durationS: number }
  /** Closed loop: the decoder moves the cursor and the simulated user steers it to targets. */
  | { mode: 'closed'; taskSeed: number; durationS: number; model: Model };

export interface Trial { target: [number, number]; startS: number; endS: number; hit: boolean }

export interface FocusTraces {
  ch: number; gridHz: number; fsHz: number;
  /** Contact voltage, µV (without the DC offset, which is reported separately). */
  elecUv: Float32Array;
  /** After the high-pass, referred to the input, µV. */
  hpUv: Float32Array;
  /** After low-pass, gain and saturation: what the ADC samples, volts. */
  ampV: Float32Array;
  /** ADC output codes, one per sample at fs. */
  codes: Int32Array;
  /** After the digital band-pass, referred to the input, µV. */
  digUv: Float32Array;
  /** The common average that was subtracted (zero when off), µV. */
  refUv: Float32Array;
  /** After referencing: what the detector sees, µV. */
  outUv: Float32Array;
  lsbUv: number;
  offsetMv: number;
  /** Fraction of ADC samples that sat on a rail (amplifier or converter). */
  clippedFrac: number;
}

/** The decoder's arithmetic per bin, so that any output can be taken apart again. y = base + Σ_j contrib[j]. */
export interface StepLog {
  nIn: number; nTerm: number; contribOf: 'channel' | 'hidden';
  inputs: Float32Array;     // nBins × nIn   (the features as the decoder normalised them)
  base: Float32Array;       // nBins × 2
  contrib: Float32Array;    // nBins × 2 × nTerm
  hidden: Float32Array | null;   // nBins × nTerm (MLP)
}

export interface MotorRun {
  kind: 'motor';
  mode: Task['mode'];
  params: MotorParams;
  taskSeed: number;
  durationS: number; binMs: number; nBins: number; nCh: number;
  units: Unit[];
  /** Spike amplitude of each unit at its contact, µV. */
  ampUv: number[];
  /** Spike times of each unit, seconds. */
  spikeT: Float32Array[];
  intent: Float32Array;        // nBins × 2
  targetXY: Float32Array;      // nBins × 2 (NaN while no target is shown)
  cursor: Float32Array;        // (nBins + 1) × 2
  counts: Float32Array;        // nBins × nCh
  rates: Float32Array;         // nBins × nCh
  decoded: Float32Array;       // nBins × 2
  decodedSd: Float32Array;     // nBins × 2
  valid: Uint8Array;
  sigmaUv: Float32Array;       // per channel
  thresholdUv: Float32Array;   // per channel (positive number; the detector fires below −threshold)
  /** Threshold crossings: channel, time (s) and the model unit that caused each (−1 = noise or artefact). */
  events: { n: number; ch: Uint8Array; t: Float32Array; unit: Int16Array };
  trials: Trial[];
  artefactT: number[];
  offsetsMv: number[];
  focus: FocusTraces | null;
  decoderId: string | null;
  /** What the decoder computed in every bin, term by term (only for recorded closed-loop runs). */
  steps: StepLog | null;
  /** Wall-clock time the simulation took, ms (machine-dependent; not part of the result's identity). */
  computeMs: number;
}

const DIRS8 = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
function shuffled<T>(a: readonly T[], r: () => number): T[] { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** Intended velocity of the calibration task at time t (s): out along a direction and back, bell-shaped speed. */
function calibrationIntent(dirs: number[], t: number): [number, number] {
  const T = 1.6, t0 = t - CAL_S;
  if (t0 < 0) return [0, 0];
  const k = Math.floor(t0 / T), u = (t0 - k * T) / T;
  if (u < 0.125 || u > 0.875) return [0, 0];
  const s = Math.sin(Math.PI * ((u - 0.125) / 0.75)) ** 2;
  const th = dirs[Math.floor(k / 2) % dirs.length] + (k % 2 ? Math.PI : 0);
  return [s * Math.cos(th), s * Math.sin(th)];
}

export function simulateMotor(input: MotorParams, task: Task, record = false): MotorRun {
  const t0wall = typeof performance !== 'undefined' ? performance.now() : 0;
  const p = clampMotor(input);
  const units = layoutUnits();
  const ampUv = units.map((u) => unitAmpUv(u, p.nearUm));
  const tmpl = spikeTemplate(GRID_HZ), L = tmpl.ec.length;
  const binN = (GRID_HZ * BIN_MS) / 1000, binS = BIN_MS / 1000;
  const nBins = Math.round(task.durationS / binS), nGrid = nBins * binN;
  const dec = GRID_HZ / p.fsHz, nAdc = Math.floor(nGrid / dec);
  const calSamples = Math.round(CAL_S * p.fsHz);

  // random streams: one for spikes, one per channel for noise, one for the task and one for artefacts
  const seed = p.seed ^ Math.imul(task.taskSeed + 1, 0x9e3779b1);
  const spikeR = mulberry32(subSeed(seed, 1)), taskR = mulberry32(subSeed(task.taskSeed, 7)), artR = mulberry32(subSeed(p.seed, 3));
  const noise = Array.from({ length: N_CH }, (_, c) => gaussian(mulberry32(subSeed(seed, 100 + c))));
  const fixR = mulberry32(subSeed(LAYOUT_SEED, 9));
  const offsetsMv = Array.from({ length: N_CH }, () => 8 + 22 * fixR());
  const lfpGain = Array.from({ length: N_CH }, () => 0.85 + 0.3 * fixR());
  const artGain = Array.from({ length: N_CH }, () => 0.97 + 0.06 * fixR());
  const sigmaGrid = p.noiseUv * GRID_PER_BAND;

  // artefact transients (the same times whatever else changes, so runs can be compared)
  const artefactT: number[] = [], artefactA: number[] = [];
  if (p.artefact) { let t = CAL_S + 0.35 + artR() * 0.5; while (t < task.durationS - 0.05) { artefactT.push(t); artefactA.push((220 + 160 * artR()) * (artR() < 0.5 ? -1 : 1)); t += 0.8 + artR(); } }
  let artIdx = 0;

  // filters
  const hpA = p.hpHz > 0 ? 1 / (1 + (2 * Math.PI * p.hpHz) / GRID_HZ) : 1;
  const lp = butterLP2(p.lpHz, GRID_HZ), dh = butterHP2(DSP_BAND_HZ[0], p.fsHz), dl = butterLP2(Math.min(DSP_BAND_HZ[1], 0.4 * p.fsHz), p.fsHz);
  const lsb = lsbOf(p.bits, VREF_V), codeToUv = (lsb / p.gain) * 1e6;
  const S = () => new Float64Array(N_CH);
  const hxp = S(), hyp = S(), lx1 = S(), lx2 = S(), ly1 = S(), ly2 = S();
  const ax1 = S(), ax2 = S(), ay1 = S(), ay2 = S(), bx1 = S(), bx2 = S(), by1 = S(), by2 = S();
  for (let c = 0; c < N_CH; c++) { const o = offsetsMv[c] * 1e-3; hxp[c] = o; if (p.hpHz <= 0) { lx1[c] = lx2[c] = ly1[c] = ly2[c] = o; } }
  const dvals = S(), prev = S(), sigmaUv = new Float32Array(N_CH), thr = new Float32Array(N_CH);
  const refr = new Int32Array(N_CH), refrN = Math.max(1, Math.round(0.001 * p.fsHz));
  const calBuf = Array.from({ length: N_CH }, () => new Float32Array(calSamples));

  const acc = Array.from({ length: N_CH }, () => new Float32Array(binN + L));
  const noiseBlock = Array.from({ length: N_CH }, () => new Float32Array(binN));
  const spikes: number[][] = units.map(() => []), lastSpike = new Float64Array(units.length).fill(-1);
  const evCh: number[] = [], evT: number[] = [];

  const intent = new Float32Array(nBins * 2), targetXY = new Float32Array(nBins * 2).fill(NaN), cursor = new Float32Array((nBins + 1) * 2);
  const counts = new Float32Array(nBins * N_CH), rates = new Float32Array(nBins * N_CH), decoded = new Float32Array(nBins * 2), decodedSd = new Float32Array(nBins * 2), valid = new Uint8Array(nBins);
  const alpha = 1 - Math.exp(-BIN_MS / p.tauMs);
  const f = record ? {
    elecUv: new Float32Array(nGrid), hpUv: new Float32Array(nGrid), ampV: new Float32Array(nGrid),
    codes: new Int32Array(nAdc), digUv: new Float32Array(nAdc), refUv: new Float32Array(nAdc), outUv: new Float32Array(nAdc),
  } : null;
  const fc = p.focusCh;
  let clipped = 0;
  let steps: StepLog | null = null;

  // task state
  const dirs = shuffled(DIRS8, taskR);
  const trials: Trial[] = [];
  const model = task.mode === 'closed' ? task.model : null;
  const state = model?.init();
  let target: [number, number] | null = null, trialStart = 0, dwell = 0, targetN = 0;
  const firstTargetBin = Math.round((CAL_S + 0.5) / binS), timeoutBins = Math.round(5 / binS), dwellBins = 6;
  const nextTarget = (k: number) => { const th = dirs[targetN % dirs.length] + (Math.floor(targetN / dirs.length) % 2 ? Math.PI / 8 : 0); targetN++; target = [TARGET_RING * Math.cos(th), TARGET_RING * Math.sin(th)]; trialStart = k; dwell = 0; };

  const TWO_PI = 2 * Math.PI;
  for (let k = 0; k < nBins; k++) {
    const tBin = k * binS;
    // 1 · what the user intends in this bin
    let vx = 0, vy = 0;
    if (task.mode === 'calibration') [vx, vy] = calibrationIntent(dirs, tBin + binS / 2);
    else {
      if (!target && k >= firstTargetBin) nextTarget(k);
      if (target) {
        const kd = Math.max(0, k - FEEDBACK_DELAY_BINS);
        const dx = target[0] - cursor[kd * 2], dy = target[1] - cursor[kd * 2 + 1], d = Math.hypot(dx, dy);
        if (d > 1e-6) { const g = Math.min(1, d / 0.35) / d; vx = dx * g; vy = dy * g; }
        targetXY[k * 2] = target[0]; targetXY[k * 2 + 1] = target[1];
      }
    }
    intent[k * 2] = vx; intent[k * 2 + 1] = vy;

    // 2 · spikes of every unit in this bin, added to their contact's waveform
    for (const u of units) {
      const rate = unitRate(u, vx, vy);
      if (rate <= 0) continue;
      let t = tBin;
      for (;;) {
        t += -Math.log(1 - spikeR()) / rate;
        if (t >= tBin + binS) break;
        if (t - lastSpike[u.id] < 0.003) continue;
        lastSpike[u.id] = t; spikes[u.id].push(t);
        const o = Math.round((t - tBin) * GRID_HZ), a = ampUv[u.id], buf = acc[u.ch];
        for (let i = 0; i < L; i++) buf[o + i] += a * tmpl.ec[i];
      }
    }

    // 3 · the recording chain, sample by sample
    const g0 = k * binN;
    // draw the noise first, channel by channel, so that each channel's stream does not depend on the others
    for (let c = 0; c < N_CH; c++) { const b = noiseBlock[c], gz = noise[c]; for (let i = 0; i < binN; i++) b[i] = sigmaGrid * gz(); }
    for (let i = 0; i < binN; i++) {
      const g = g0 + i, t = g / GRID_HZ;
      const common = 90 * Math.sin(TWO_PI * 3.1 * t + 0.4) + 55 * Math.sin(TWO_PI * 8.7 * t + 1.9) + 25 * Math.sin(TWO_PI * 19 * t + 4.1);
      let art = 0;
      if (p.artefact) {
        art = 30 * Math.sin(TWO_PI * 50 * t);
        while (artIdx < artefactT.length && t > artefactT[artIdx] + 0.001) artIdx++;
        if (artIdx < artefactT.length && t >= artefactT[artIdx]) { const u = (t - artefactT[artIdx]) / 0.001; art += artefactA[artIdx] * Math.sin(TWO_PI * u) * (0.5 - 0.5 * Math.cos(TWO_PI * u)); }
      }
      const sampleNow = g % dec === 0, s = sampleNow ? g / dec : -1;
      for (let c = 0; c < N_CH; c++) {
        const x = acc[c][i] + common * lfpGain[c] + art * artGain[c] + noiseBlock[c][i];
        const v = x * 1e-6 + offsetsMv[c] * 1e-3;
        let y = v;
        if (p.hpHz > 0) { y = hpA * (hyp[c] + v - hxp[c]); hxp[c] = v; hyp[c] = y; }
        const w = lp.b0 * y + lp.b1 * lx1[c] + lp.b2 * lx2[c] - lp.a1 * ly1[c] - lp.a2 * ly2[c];
        lx2[c] = lx1[c]; lx1[c] = y; ly2[c] = ly1[c]; ly1[c] = w;
        let o = w * p.gain;
        if (o > SWING_V) o = SWING_V; else if (o < -SWING_V) o = -SWING_V;
        if (f && c === fc) { f.elecUv[g] = x; f.hpUv[g] = (p.hpHz > 0 ? y : y - offsetsMv[c] * 1e-3) * 1e6; f.ampV[g] = o; }
        if (sampleNow) {
          const code = quantise(o, p.bits, VREF_V);
          const xin = code * codeToUv;
          const a = dh.b0 * xin + dh.b1 * ax1[c] + dh.b2 * ax2[c] - dh.a1 * ay1[c] - dh.a2 * ay2[c];
          ax2[c] = ax1[c]; ax1[c] = xin; ay2[c] = ay1[c]; ay1[c] = a;
          const b = dl.b0 * a + dl.b1 * bx1[c] + dl.b2 * bx2[c] - dl.a1 * by1[c] - dl.a2 * by2[c];
          bx2[c] = bx1[c]; bx1[c] = a; by2[c] = by1[c]; by1[c] = b;
          dvals[c] = b;
          if (f && c === fc) { f.codes[s] = code; f.digUv[s] = b; if (Math.abs(o) >= SWING_V || code === -(2 ** (p.bits - 1)) || code === 2 ** (p.bits - 1) - 1) clipped++; }
        }
      }
      if (sampleNow) {
        let ref = 0;
        if (p.car) { for (let c = 0; c < N_CH; c++) ref += dvals[c]; ref /= N_CH; }
        if (s === calSamples) for (let c = 0; c < N_CH; c++) { sigmaUv[c] = madSigma(calBuf[c]); thr[c] = p.threshK * sigmaUv[c]; }
        for (let c = 0; c < N_CH; c++) {
          const z = dvals[c] - ref;
          if (s < calSamples) calBuf[c][s] = z;
          else if (thr[c] > 0 && z < -thr[c] && prev[c] >= -thr[c] && refr[c] <= 0) { evCh.push(c); evT.push(t); counts[k * N_CH + c]++; refr[c] = refrN; }
          prev[c] = z; refr[c]--;
          if (f && c === fc) { f.refUv[s] = ref; f.outUv[s] = z; }
        }
      }
    }
    for (let c = 0; c < N_CH; c++) { acc[c].copyWithin(0, binN); acc[c].fill(0, L); }

    // 4 · features, decoder, cursor
    for (let c = 0; c < N_CH; c++) { const r0 = k > 0 ? rates[(k - 1) * N_CH + c] : 0; rates[k * N_CH + c] = r0 + alpha * (counts[k * N_CH + c] / binS - r0); }
    valid[k] = tBin >= CAL_S + 0.25 ? 1 : 0;
    let out: StepOut | null = null;
    if (model && state && valid[k]) {
      out = model.step(state, { counts: counts.subarray(k * N_CH, (k + 1) * N_CH), rates: rates.subarray(k * N_CH, (k + 1) * N_CH) });
      decoded[k * 2] = out.y[0]; decoded[k * 2 + 1] = out.y[1]; decodedSd[k * 2] = out.sd[0]; decodedSd[k * 2 + 1] = out.sd[1];
      if (record) {
        const nIn = out.inputs.length, nTerm = out.contrib[0].length;
        steps ??= { nIn, nTerm, contribOf: out.contribOf, inputs: new Float32Array(nBins * nIn), base: new Float32Array(nBins * 2), contrib: new Float32Array(nBins * 2 * nTerm), hidden: out.hidden ? new Float32Array(nBins * nTerm) : null };
        steps.inputs.set(out.inputs, k * nIn);
        steps.base[k * 2] = out.base[0]; steps.base[k * 2 + 1] = out.base[1];
        steps.contrib.set(out.contrib[0], k * 2 * nTerm); steps.contrib.set(out.contrib[1], (k * 2 + 1) * nTerm);
        if (steps.hidden && out.hidden) steps.hidden.set(out.hidden, k * nTerm);
      }
    }
    const mvx = task.mode === 'calibration' ? vx : decoded[k * 2], mvy = task.mode === 'calibration' ? vy : decoded[k * 2 + 1];
    cursor[(k + 1) * 2] = Math.max(-1.15, Math.min(1.15, cursor[k * 2] + mvx * VMAX * binS));
    cursor[(k + 1) * 2 + 1] = Math.max(-1.15, Math.min(1.15, cursor[k * 2 + 1] + mvy * VMAX * binS));
    if (task.mode === 'closed' && target) {
      const tg: [number, number] = target;
      const inside = Math.hypot(cursor[(k + 1) * 2] - tg[0], cursor[(k + 1) * 2 + 1] - tg[1]) <= TARGET_RADIUS;
      dwell = inside ? dwell + 1 : 0;
      const hit = dwell >= dwellBins, late = k - trialStart >= timeoutBins;
      if (hit || late) { trials.push({ target: tg, startS: trialStart * binS, endS: (k + 1) * binS, hit }); nextTarget(k + 1); }
    }
  }

  // which model unit caused each threshold crossing (so a prediction can be traced back to a cell, or to noise)
  const n = evT.length, evUnit = new Int16Array(n).fill(-1);
  const peakS = tmpl.ecPeak / GRID_HZ, ptr = new Int32Array(units.length);
  for (let e = 0; e < n; e++) {
    let best = -1, bd = Infinity;
    for (let r = 0; r < UNITS_PER_CH; r++) {
      const u = evCh[e] * UNITS_PER_CH + r, sp = spikes[u];
      while (ptr[u] < sp.length && sp[ptr[u]] + peakS < evT[e] - 0.0016) ptr[u]++;
      for (let q = ptr[u]; q < sp.length; q++) {
        const d = evT[e] - (sp[q] + peakS);
        if (d < -0.0005) break;
        if (d <= 0.0016 && Math.abs(d) < bd) { bd = Math.abs(d); best = u; }
      }
    }
    evUnit[e] = best;
  }
  const thresholdUv = thr;
  return {
    kind: 'motor', mode: task.mode, params: p, taskSeed: task.taskSeed, durationS: nBins * binS, binMs: BIN_MS, nBins, nCh: N_CH,
    units, ampUv, spikeT: spikes.map((s) => Float32Array.from(s)), intent, targetXY, cursor, counts, rates, decoded, decodedSd, valid,
    sigmaUv, thresholdUv, events: { n, ch: Uint8Array.from(evCh), t: Float32Array.from(evT), unit: evUnit }, trials, artefactT, offsetsMv,
    focus: f ? { ch: fc, gridHz: GRID_HZ, fsHz: p.fsHz, ...f, lsbUv: codeToUv, offsetMv: offsetsMv[fc], clippedFrac: clipped / Math.max(1, nAdc) } : null,
    decoderId: model?.id ?? null, steps,
    computeMs: typeof performance !== 'undefined' ? performance.now() - t0wall : 0,
  };
}

/** The features and the intended velocity of a run, as a dataset for fitting or scoring decoders. */
export function toDataset(r: MotorRun): Dataset {
  return { nCh: r.nCh, nOut: 2, nBins: r.nBins, binMs: r.binMs, counts: r.counts, rates: r.rates, target: r.intent, valid: r.valid };
}

/** Durations of the standard runs, seconds. */
export const RUN_S = { calibration: CAL_S + 20 * 1.6, heldOut: CAL_S + 10 * 1.6, closed: 16 } as const;
export const TASK_SEED = { calibration: 1, heldOut: 2, closed: 3 } as const;

export interface ClosedSummary { trials: number; hits: number; meanTimeS: number | null; pathEfficiency: number | null }
/** How the closed-loop task went: targets reached, mean time to reach one, and how direct the paths were. */
export function summariseClosed(r: MotorRun): ClosedSummary {
  const hits = r.trials.filter((t) => t.hit);
  let eff = 0;
  for (const t of hits) {
    const k0 = Math.round(t.startS / (r.binMs / 1000)), k1 = Math.round(t.endS / (r.binMs / 1000));
    let path = 0;
    for (let k = k0; k < k1; k++) path += Math.hypot(r.cursor[(k + 1) * 2] - r.cursor[k * 2], r.cursor[(k + 1) * 2 + 1] - r.cursor[k * 2 + 1]);
    const straight = Math.max(0, Math.hypot(t.target[0] - r.cursor[k0 * 2], t.target[1] - r.cursor[k0 * 2 + 1]) - TARGET_RADIUS);
    eff += path > 0 ? Math.min(1, straight / path) : 0;
  }
  return {
    trials: r.trials.length, hits: hits.length,
    meanTimeS: hits.length ? hits.reduce((a, t) => a + (t.endS - t.startS), 0) / hits.length : null,
    pathEfficiency: hits.length ? eff / hits.length : null,
  };
}
