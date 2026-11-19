// Visual-cortex experiment: pictures switch on and off; eight contacts ON THE SURFACE record field potentials; band
// power is extracted and a classifier reports whether a picture is on, and whether it was an intact object.
//
// SIMULATED — a teaching model. Nothing here is a recording. In particular:
//   • a surface contact sums very many neurons, so there are no single-neuron spikes in this experiment at all;
//   • the neural background is "pink" noise; a picture multiplies it by (1 + drive) — a broadband power shift, the
//     feature that tracks local firing in the cited recordings (Manning et al. 2009; Ray & Maunsell 2011);
//   • intact objects drive the model's cortex harder than scrambled ones (the imaging result of Malach et al. 1995).
//     That difference is PUT IN BY HAND: the simulation illustrates it and is not evidence for it;
//   • every object drives it the same, so nothing here can tell one object from another — by construction;
//   • there is no simple law for how a surface potential falls with distance from a sheet of cortex, so this model has
//     no electrode-distance control. Recording quality is changed through the noise instead.
//
//   front end   1st-order high-pass → 2nd-order low-pass → gain → saturation at ±1 V     (same blocks as the motor chain)
//   ADC         sampler at fs (every k-th point of a 6 kHz grid) + mid-tread quantiser
//   DSP         optional common average reference (removes mains hum shared by all contacts) → 70–150 Hz band-pass
//               → power per 100 ms bin → dB relative to the first second (rest) → exponential smoothing
//   decoder     two logistic units on the eight band powers: P(picture on) and P(intact object | on)
//
// Pure module: no DOM. Unit-tested in tests/experiment-visual.test.ts.
import { butterHP2, butterLP2, lsbOf, quantise, solve } from './dsp.ts';
import { gaussian, mulberry32, subSeed } from './rng.ts';
import type { FocusTraces, StepLog } from './motor.ts';

export const VIS_GRID_HZ = 6000;
export const VIS_BIN_MS = 100;
export const VIS_N_CH = 8;
export const VIS_SAMPLE_RATES_HZ = [3000, 2000, 1000, 500, 250] as const;
export const VIS_HP_CHOICES_HZ = [0, 0.5, 5, 30] as const;
export const VIS_BAND_HZ: [number, number] = [70, 150];
export const VIS_CAL_S = 1;
/** Delay from picture onset to the start of the response in this cortex, seconds (model value). */
export const LATENCY_S = 0.09;
export const STIM_ON_S = 0.6;
export const STIM_PERIOD_S = 1.6;
export const OBJECTS = ['cup', 'key', 'shoe', 'lamp'] as const;

export interface VisualParams {
  seed: number;
  /** Measurement noise at each contact, µV rms over 1–300 Hz. */
  noiseUv: number;
  /** Add 50 Hz mains hum common to all contacts. */
  artefact: boolean;
  gain: number;
  hpHz: number;
  lpHz: number;
  fsHz: number;
  bits: number;
  car: boolean;
  /** Smoothing of the band power, ms. */
  tauMs: number;
  focusCh: number;
}
export const DEFAULT_VISUAL: VisualParams = { seed: 11, noiseUv: 3, artefact: true, gain: 1000, hpHz: 0.5, lpHz: 300, fsHz: 1000, bits: 12, car: true, tauMs: 150, focusCh: 0 };
export const VISUAL_LIMITS = { noiseUv: [0.5, 40], gain: [20, 5000], lpHz: [40, 2500], bits: [4, 16], tauMs: [50, 600] } as const;

export function clampVisual(p: VisualParams): VisualParams {
  const c = (v: number, [lo, hi]: readonly [number, number], d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const D = DEFAULT_VISUAL;
  return {
    seed: Number.isFinite(p.seed) ? Math.floor(p.seed) >>> 0 : D.seed, noiseUv: c(p.noiseUv, VISUAL_LIMITS.noiseUv, D.noiseUv), artefact: !!p.artefact,
    gain: c(p.gain, VISUAL_LIMITS.gain, D.gain), hpHz: (VIS_HP_CHOICES_HZ as readonly number[]).includes(p.hpHz) ? p.hpHz : D.hpHz,
    lpHz: c(p.lpHz, VISUAL_LIMITS.lpHz, D.lpHz), fsHz: (VIS_SAMPLE_RATES_HZ as readonly number[]).includes(p.fsHz) ? p.fsHz : D.fsHz,
    bits: Math.round(c(p.bits, VISUAL_LIMITS.bits, D.bits)), car: !!p.car, tauMs: c(p.tauMs, VISUAL_LIMITS.tauMs, D.tauMs),
    focusCh: Math.max(0, Math.min(VIS_N_CH - 1, Math.round(Number.isFinite(p.focusCh) ? p.focusCh : 0))),
  };
}

/** How strongly the cortex under each contact responds to pictures (model values; 0 = not visually driven). */
export const CONTACT_GAIN = [1.0, 0.85, 0.55, 0.3, 0.9, 0.7, 0.15, 0.05] as const;
/** Drive of an intact object and of a scrambled picture, relative units. */
export const DRIVE = { object: 1, scrambled: 0.4 } as const;
/** Background amplitude is multiplied by (1 + BROADBAND_GAIN · drive): about +8 dB of band power for a full response. */
export const BROADBAND_GAIN = 1.6;

export interface Stimulus { onS: number; offS: number; kind: 'object' | 'scrambled'; identity: number; trialGain: number }

export function schedule(taskSeed: number, durationS: number): Stimulus[] {
  const r = mulberry32(subSeed(taskSeed, 21)), g = gaussian(mulberry32(subSeed(taskSeed, 22))), out: Stimulus[] = [];
  let i = 0;
  for (let t = VIS_CAL_S + 0.5; t + STIM_ON_S + 0.3 < durationS; t += STIM_PERIOD_S, i++) {
    // balanced in pairs, order random within a pair
    const kind = (i % 2 === 0 ? r() < 0.5 : out[i - 1].kind === 'scrambled') ? 'object' : 'scrambled';
    out.push({ onS: t, offS: t + STIM_ON_S, kind, identity: Math.floor(r() * OBJECTS.length), trialGain: Math.exp(0.2 * g()) });
  }
  return out;
}

/** Population drive of one stimulus at time t (s): delayed rise, partial adaptation, decay after the picture goes. */
export function driveShape(s: Stimulus, t: number): number {
  const a = t - (s.onS + LATENCY_S);
  if (a < 0) return 0;
  const up = 1 - Math.exp(-a / 0.025), adapt = 0.7 + 0.3 * Math.exp(-a / 0.15);
  const b = t - (s.offS + LATENCY_S);
  return up * adapt * (b > 0 ? Math.exp(-b / 0.06) : 1);
}

export interface VisualModel {
  mu: number[]; sd: number[];
  /** Logistic weights on the standardised band powers: [on, intact] × channels, and biases. */
  W: number[][]; b: number[];
  /** Mean feature vector per object identity, from calibration (for the which-object attempt). */
  centroids: number[][];
}

export interface VisualRun {
  kind: 'visual';
  mode: 'calibration' | 'test';
  params: VisualParams;
  taskSeed: number;
  durationS: number; binMs: number; nBins: number; nCh: number;
  stim: Stimulus[];
  /** Population drive under each contact per bin (0 … about 1.3). */
  drive: Float32Array;          // nBins × nCh
  /** Band power per bin, dB relative to rest. */
  powerDb: Float32Array;        // nBins × nCh
  /** The same, smoothed: the decoder's inputs. */
  feat: Float32Array;           // nBins × nCh
  /** Truth per bin: 1 while a picture is on the screen; kind 0 none · 1 object · 2 scrambled. */
  on: Uint8Array; kindOf: Uint8Array;
  /** Decoder outputs per bin: P(on), P(intact | on). Zero until a model is supplied. */
  decoded: Float32Array;        // nBins × 2
  valid: Uint8Array;
  basePowerUv2: Float32Array;   // per channel: power at rest in the band
  focus: FocusTraces | null;
  steps: StepLog | null;
  computeMs: number;
}

export function simulateVisual(input: VisualParams, task: { mode: 'calibration' | 'test'; taskSeed: number; durationS: number; model?: VisualModel }, record = false): VisualRun {
  const t0wall = typeof performance !== 'undefined' ? performance.now() : 0;
  const p = clampVisual(input), N = VIS_N_CH;
  const binN = (VIS_GRID_HZ * VIS_BIN_MS) / 1000, binS = VIS_BIN_MS / 1000;
  const nBins = Math.round(task.durationS / binS), nGrid = nBins * binN, dec = VIS_GRID_HZ / p.fsHz, nAdc = Math.floor(nGrid / dec);
  const stim = schedule(task.taskSeed, task.durationS);
  const seed = p.seed ^ Math.imul(task.taskSeed + 1, 0x9e3779b1);
  const neural = Array.from({ length: N }, (_, c) => gaussian(mulberry32(subSeed(seed, 200 + c))));
  const meas = Array.from({ length: N }, (_, c) => gaussian(mulberry32(subSeed(seed, 300 + c))));
  const shared = gaussian(mulberry32(subSeed(seed, 400)));
  const fixR = mulberry32(subSeed(77, 9));
  const offsetsMv = Array.from({ length: N }, () => 5 + 20 * fixR());
  const lat = Array.from({ length: N }, () => (fixR() - 0.5) * 0.02);

  // pink-ish background: three leaky integrators of white noise per contact (corners 4, 30 and 250 Hz)
  const kA = 1 - Math.exp((-2 * Math.PI * 4) / VIS_GRID_HZ), kB = 1 - Math.exp((-2 * Math.PI * 30) / VIS_GRID_HZ), kC = 1 - Math.exp((-2 * Math.PI * 250) / VIS_GRID_HZ);
  const pA = new Float64Array(N), pB = new Float64Array(N), pC = new Float64Array(N);
  let sA = 0;
  const hpA = p.hpHz > 0 ? 1 / (1 + (2 * Math.PI * p.hpHz) / VIS_GRID_HZ) : 1;
  const lp = butterLP2(p.lpHz, VIS_GRID_HZ);
  const bh = butterHP2(VIS_BAND_HZ[0], p.fsHz), bl = butterLP2(Math.min(VIS_BAND_HZ[1], 0.4 * p.fsHz), p.fsHz);
  const lsb = lsbOf(p.bits, 1), codeToUv = (lsb / p.gain) * 1e6;
  const S = () => new Float64Array(N);
  const hxp = S(), hyp = S(), lx1 = S(), lx2 = S(), ly1 = S(), ly2 = S(), ax1 = S(), ax2 = S(), ay1 = S(), ay2 = S(), bx1 = S(), bx2 = S(), by1 = S(), by2 = S(), xin = S();
  for (let c = 0; c < N; c++) { const o = offsetsMv[c] * 1e-3; hxp[c] = o; if (p.hpHz <= 0) lx1[c] = lx2[c] = ly1[c] = ly2[c] = o; }
  // white measurement noise scaled so that it is noiseUv rms over 1–300 Hz (white on a 3 kHz-wide grid)
  const measSigma = p.noiseUv * Math.sqrt(VIS_GRID_HZ / 2 / 299);

  const drive = new Float32Array(nBins * N), powerDb = new Float32Array(nBins * N), feat = new Float32Array(nBins * N), decoded = new Float32Array(nBins * 2);
  const on = new Uint8Array(nBins), kindOf = new Uint8Array(nBins), valid = new Uint8Array(nBins), base = new Float32Array(N);
  const acc = S(), accN = new Int32Array(1), baseAcc = S();
  let baseN = 0;
  const alpha = 1 - Math.exp(-VIS_BIN_MS / p.tauMs);
  const f = record ? { elecUv: new Float32Array(nGrid), hpUv: new Float32Array(nGrid), ampV: new Float32Array(nGrid), codes: new Int32Array(nAdc), digUv: new Float32Array(nAdc), refUv: new Float32Array(nAdc), outUv: new Float32Array(nAdc) } : null;
  const fc = p.focusCh;
  let clipped = 0, si = 0, steps: StepLog | null = null;
  const TWO_PI = 2 * Math.PI, calSamples = Math.round(VIS_CAL_S * p.fsHz);
  const m = task.model;

  for (let k = 0; k < nBins; k++) {
    const tBin = k * binS, tMid = tBin + binS / 2;
    while (si < stim.length && stim[si].offS + 0.5 < tBin) si++;
    const cur = si < stim.length && stim[si].onS - 0.05 <= tBin + binS ? stim[si] : null;
    if (cur && tMid >= cur.onS && tMid < cur.offS) { on[k] = 1; kindOf[k] = cur.kind === 'object' ? 1 : 2; }
    acc.fill(0); accN[0] = 0;
    for (let i = 0; i < binN; i++) {
      const g = k * binN + i, t = g / VIS_GRID_HZ;
      // rhythm and hum shared by all contacts
      sA += 0.02 * (shared() - sA);
      const alphaRhythm = 14 * Math.sin(TWO_PI * 10 * t + 6 * sA);
      const hum = p.artefact ? 25 * Math.sin(TWO_PI * 50 * t) : 0;
      const sampleNow = g % dec === 0, s = sampleNow ? g / dec : -1;
      for (let c = 0; c < N; c++) {
        const w = neural[c]();
        pA[c] += kA * (w * 300 - pA[c]); pB[c] += kB * (w * 60 - pB[c]); pC[c] += kC * (w * 16 - pC[c]);
        let e = 0, erp = 0;
        if (cur) {
          e = CONTACT_GAIN[c] * DRIVE[cur.kind] * cur.trialGain * driveShape(cur, t - lat[c]);
          const a = t - cur.onS - lat[c];
          erp = CONTACT_GAIN[c] * (-16 * Math.exp(-(((a - 0.15) / 0.03) ** 2)) + 9 * Math.exp(-(((a - 0.26) / 0.05) ** 2)));
        }
        if (i === binN >> 1) drive[k * N + c] = e;
        const x = (pA[c] + pB[c] + pC[c]) * (1 + BROADBAND_GAIN * e) + erp + alphaRhythm * (0.7 + 0.04 * c) + hum + measSigma * meas[c]();
        const v = x * 1e-6 + offsetsMv[c] * 1e-3;
        let y = v;
        if (p.hpHz > 0) { y = hpA * (hyp[c] + v - hxp[c]); hxp[c] = v; hyp[c] = y; }
        const ww = lp.b0 * y + lp.b1 * lx1[c] + lp.b2 * lx2[c] - lp.a1 * ly1[c] - lp.a2 * ly2[c];
        lx2[c] = lx1[c]; lx1[c] = y; ly2[c] = ly1[c]; ly1[c] = ww;
        let o = ww * p.gain;
        if (o > 1) o = 1; else if (o < -1) o = -1;
        if (f && c === fc) { f.elecUv[g] = x; f.hpUv[g] = (p.hpHz > 0 ? y : y - offsetsMv[c] * 1e-3) * 1e6; f.ampV[g] = o; }
        if (sampleNow) {
          const code = quantise(o, p.bits, 1);
          xin[c] = code * codeToUv;
          if (f && c === fc) { f.codes[s] = code; f.digUv[s] = xin[c]; if (Math.abs(o) >= 1 || code === -(2 ** (p.bits - 1)) || code === 2 ** (p.bits - 1) - 1) clipped++; }
        }
      }
      if (sampleNow) {
        let ref = 0;
        if (p.car) { for (let c = 0; c < N; c++) ref += xin[c]; ref /= N; }
        for (let c = 0; c < N; c++) {
          const z = xin[c] - ref;
          const a = bh.b0 * z + bh.b1 * ax1[c] + bh.b2 * ax2[c] - bh.a1 * ay1[c] - bh.a2 * ay2[c];
          ax2[c] = ax1[c]; ax1[c] = z; ay2[c] = ay1[c]; ay1[c] = a;
          const b = bl.b0 * a + bl.b1 * bx1[c] + bl.b2 * bx2[c] - bl.a1 * by1[c] - bl.a2 * by2[c];
          bx2[c] = bx1[c]; bx1[c] = a; by2[c] = by1[c]; by1[c] = b;
          acc[c] += b * b;
          if (s >= calSamples * 0.3 && s < calSamples) baseAcc[c] += b * b;
          if (f && c === fc) { f.refUv[s] = ref; f.outUv[s] = b; }
        }
        accN[0]++;
        if (s >= calSamples * 0.3 && s < calSamples) baseN++;
        if (s === calSamples) for (let c = 0; c < N; c++) base[c] = Math.max(1e-6, baseAcc[c] / Math.max(1, baseN / 1));
      }
    }
    valid[k] = tBin >= VIS_CAL_S + 0.2 ? 1 : 0;
    for (let c = 0; c < N; c++) {
      const pw = acc[c] / Math.max(1, accN[0]);
      const db = base[c] > 0 ? 10 * Math.log10(Math.max(1e-9, pw) / base[c]) : 0;
      powerDb[k * N + c] = db;
      const prev = k > 0 ? feat[(k - 1) * N + c] : 0;
      feat[k * N + c] = prev + alpha * (db - prev);
    }
    if (m && valid[k]) {
      const z = m.mu.map((mu, c) => (feat[k * N + c] - mu) / m.sd[c]);
      const contrib = m.W.map((w) => w.map((v, c) => v * z[c]));
      const logit = contrib.map((cc, o) => cc.reduce((a, v) => a + v, m.b[o]));
      decoded[k * 2] = 1 / (1 + Math.exp(-logit[0])); decoded[k * 2 + 1] = 1 / (1 + Math.exp(-logit[1]));
      if (record) {
        steps ??= { nIn: N, nTerm: N, contribOf: 'channel', inputs: new Float32Array(nBins * N), base: new Float32Array(nBins * 2), contrib: new Float32Array(nBins * 2 * N), hidden: null };
        steps.inputs.set(z, k * N); steps.base[k * 2] = m.b[0]; steps.base[k * 2 + 1] = m.b[1];
        steps.contrib.set(contrib[0], k * 2 * N); steps.contrib.set(contrib[1], (k * 2 + 1) * N);
      }
    }
  }
  return {
    kind: 'visual', mode: task.mode, params: p, taskSeed: task.taskSeed, durationS: nBins * binS, binMs: VIS_BIN_MS, nBins, nCh: N, stim, drive, powerDb, feat, on, kindOf, decoded, valid,
    basePowerUv2: base,
    focus: f ? { ch: fc, gridHz: VIS_GRID_HZ, fsHz: p.fsHz, ...f, lsbUv: codeToUv, offsetMv: offsetsMv[fc], clippedFrac: clipped / Math.max(1, nAdc) } : null,
    steps, computeMs: typeof performance !== 'undefined' ? performance.now() - t0wall : 0,
  };
}

/** Bins in which each stimulus's response is expected (onset + latency … offset + latency). */
function responseBins(r: VisualRun, s: Stimulus): number[] {
  const out: number[] = [], binS = r.binMs / 1000;
  for (let k = Math.ceil((s.onS + LATENCY_S + 0.05) / binS); k < Math.min(r.nBins, Math.floor((s.offS + LATENCY_S) / binS)); k++) out.push(k);
  return out;
}

/** Fit the two logistic units and the per-object centroids on a calibration run. Deterministic (Newton steps). */
export function fitVisual(cal: VisualRun): VisualModel {
  const N = cal.nCh, rows: number[][] = [], yOn: number[] = [], yObj: number[] = [], isOnRow: boolean[] = [];
  for (let k = 0; k < cal.nBins; k++) {
    if (!cal.valid[k]) continue;
    rows.push(Array.from(cal.feat.subarray(k * N, (k + 1) * N)));
    // the response lags the screen by the latency: label a bin "on" when the cortex is expected to be driven
    const t = (k + 0.5) * (cal.binMs / 1000);
    const s = cal.stim.find((x) => t >= x.onS + LATENCY_S + 0.03 && t < x.offS + LATENCY_S + 0.03);
    yOn.push(s ? 1 : 0); isOnRow.push(!!s); yObj.push(s && s.kind === 'object' ? 1 : 0);
  }
  const mu = new Array<number>(N).fill(0), sd = new Array<number>(N).fill(0);
  for (const r of rows) for (let c = 0; c < N; c++) mu[c] += r[c] / rows.length;
  for (const r of rows) for (let c = 0; c < N; c++) sd[c] += (r[c] - mu[c]) ** 2 / rows.length;
  for (let c = 0; c < N; c++) sd[c] = Math.sqrt(sd[c]) || 1;
  const Z = rows.map((r) => r.map((v, c) => (v - mu[c]) / sd[c]));
  const logistic = (X: number[][], y: number[]) => {
    const w = new Array<number>(N + 1).fill(0), lam = 0.05;
    for (let it = 0; it < 25; it++) {
      const H = Array.from({ length: N + 1 }, (_, i) => Array.from({ length: N + 1 }, (_, j) => (i === j && i < N ? lam : i === j ? 1e-6 : 0)));
      const g = new Array<number>(N + 1).fill(0);
      for (let n = 0; n < X.length; n++) {
        const x = [...X[n], 1];
        const pr = 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + v * w[j], 0)));
        const d = pr - y[n], q = Math.max(1e-6, pr * (1 - pr));
        for (let i = 0; i <= N; i++) { g[i] += (d * x[i]) / X.length; for (let j = 0; j <= N; j++) H[i][j] += (q * x[i] * x[j]) / X.length; }
      }
      for (let i = 0; i < N; i++) g[i] += lam * w[i];
      const step = solve(H, g.map((v) => [v]));
      for (let i = 0; i <= N; i++) w[i] -= step[i][0];
    }
    return w;
  };
  const wOn = logistic(Z, yOn);
  const onRows = Z.filter((_, i) => isOnRow[i]), onY = yObj.filter((_, i) => isOnRow[i]);
  const wObj = onRows.length > 4 ? logistic(onRows, onY) : new Array<number>(N + 1).fill(0);
  const centroids = OBJECTS.map((_, id) => {
    const acc = new Array<number>(N).fill(0);
    let n = 0;
    for (const s of cal.stim) { if (s.kind !== 'object' || s.identity !== id) continue; for (const k of responseBins(cal, s)) { for (let c = 0; c < N; c++) acc[c] += cal.feat[k * N + c]; n++; } }
    return acc.map((v) => (n ? v / n : 0));
  });
  return { mu, sd, W: [wOn.slice(0, N), wObj.slice(0, N)], b: [wOn[N], wObj[N]], centroids };
}

export interface VisualSummary {
  stimuli: number;
  /** Pictures whose onset was reported (P(on) > 0.5 at some bin of the expected response). */
  detected: number;
  /** Mean delay from picture onset to the first bin with P(on) > 0.5, seconds. */
  meanDelayS: number | null;
  /** Bins with P(on) > 0.5 while no response was expected, out of all such bins. */
  falseAlarmBins: number; quietBins: number;
  /** Of the detected pictures: intact-versus-scrambled called correctly. */
  kindCorrect: number;
  /** Of the detected objects: which-object called correctly by nearest calibration centroid. Chance is 1 in 4. */
  identityCorrect: number; objects: number;
  /** Shown and detected, by kind of picture. */
  objectsShown: number; objectsDetected: number; scrambledShown: number; scrambledDetected: number;
}

export function summariseVisual(r: VisualRun, m: VisualModel): VisualSummary {
  const N = r.nCh, binS = r.binMs / 1000;
  let detected = 0, delay = 0, kindCorrect = 0, identityCorrect = 0, objects = 0, scrambledDetected = 0;
  const expected = new Uint8Array(r.nBins);
  for (const s of r.stim) {
    const bins = responseBins(r, s);
    // allow the smoothed power one bin either side
    for (let k = Math.floor(s.onS / binS); k <= Math.min(r.nBins - 1, Math.ceil((s.offS + LATENCY_S + 0.25) / binS)); k++) expected[k] = 1;
    const first = bins.find((k) => r.decoded[k * 2] > 0.5);
    if (first === undefined) continue;
    detected++; delay += (first + 1) * binS - s.onS;
    if (s.kind === 'scrambled') scrambledDetected++;
    const pObj = bins.reduce((a, k) => a + r.decoded[k * 2 + 1], 0) / bins.length;
    if ((pObj > 0.5) === (s.kind === 'object')) kindCorrect++;
    if (s.kind === 'object') {
      objects++;
      const v = new Array<number>(N).fill(0);
      for (const k of bins) for (let c = 0; c < N; c++) v[c] += r.feat[k * N + c] / bins.length;
      let best = 0, bd = Infinity;
      m.centroids.forEach((cen, id) => { const d = cen.reduce((a, x, c) => a + (x - v[c]) ** 2, 0); if (d < bd) { bd = d; best = id; } });
      if (best === s.identity) identityCorrect++;
    }
  }
  let fa = 0, quiet = 0;
  for (let k = 0; k < r.nBins; k++) if (r.valid[k] && !expected[k]) { quiet++; if (r.decoded[k * 2] > 0.5) fa++; }
  const objectsShown = r.stim.filter((s) => s.kind === 'object').length;
  return { stimuli: r.stim.length, detected, meanDelayS: detected ? delay / detected : null, falseAlarmBins: fa, quietBins: quiet, kindCorrect, identityCorrect, objects,
    objectsShown, objectsDetected: objects, scrambledShown: r.stim.length - objectsShown, scrambledDetected };
}

export const VIS_RUN_S = { calibration: 60, test: 20 } as const;
export const VIS_TASK_SEED = { calibration: 31, test: 32 } as const;
