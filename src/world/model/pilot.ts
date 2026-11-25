// Decoder pilot: a control loop the player closes with their own eyes and hands.
//
//   keys → SYNTHETIC intended velocity → model population → spike counts per contact → fitted decoder → cursor
//
// FEATURE-LEVEL SURROGATE of the Experiment scene's motor chain. It keeps that chain's population (the same 24 units,
// tuning rule and distances, from experiment/model/motor.ts) and its decoders (experiment/model/decoders.ts), and
// replaces the waveform stages by a statistical stand-in so that one 50 ms bin costs microseconds:
//
//   kept        cosine direction tuning with a speed term; Poisson spikes with a 3 ms dead time; spike size by the
//               1/distance rule; counts per 50 ms bin; exponential rate smoothing; the decoders, unchanged.
//   BYPASSED    waveform synthesis, the analogue front end, the ADC, the digital band-pass, the common average
//               reference and the sample-by-sample threshold detector.
//   stand-in    each spike is counted with probability Φ((κ·a − θ)/σ): a = spike size at the contact, κ = how much the
//               chain's filters shrink the spike template's peak (computed once from those same filters), σ = noise at
//               the detector (the electrode noise scaled to the detector's band and reference), θ = the threshold FIXED
//               AT CALIBRATION, K·σ_cal. Noise alone crosses the threshold at Rice's rate f₀·exp(−θ²/2σ²).
//               Not modelled: overlapping spikes, detector dead time, leakage through the common reference, clipping.
//
// The full, auditable chain is the Experiment scene (batch). tests/world-pilot.test.ts states how closely this
// surrogate's counts follow it at the reference setting.
//
// Three declared ways to break the loop (conditions), and nothing else:
//   noise    electrode noise × 2.5 after calibration: the fixed threshold now lets noise through and misses spikes;
//   lost     three contacts deliver nothing;
//   drift    every unit's preferred direction and base rate change by a fixed, seeded amount — a STAND-IN for the many
//            reasons tuning seen at a contact changes between sessions, not a model of any one of them.
//
// Nothing here reads a brain. The intended velocity is the keyboard's. Pure module; unit-tested.
import { DECODERS, decoderSpec, runModel, score, type Dataset, type DecoderState, type Model, type Score } from '../../experiment/model/decoders.ts';
import { butterHP2, butterLP2, runBiquad } from '../../experiment/model/dsp.ts';
import { BIN_MS, DSP_BAND_HZ, GRID_HZ, N_CH, NEAR0_UM, TARGET_RADIUS, VMAX, layoutUnits, unitAmpUv, unitRate, type Unit } from '../../experiment/model/motor.ts';
import { spikeTemplate } from '../../experiment/model/template.ts';
import { hash3 } from './lif.ts';

export const PILOT_REVISION = 'pilot-surrogate-1';
export const PILOT_BIN_MS = BIN_MS;
export const PILOT_DECODERS = ['linear', 'kalman', 'mlp8'] as const;
export type PilotDecoderId = (typeof PILOT_DECODERS)[number];
export const PILOT_TAU_MS = 250;
export const PILOT_THRESH_K = 4.5;
export const PILOT_FIT_SEED = 5;
export const PILOT_TRAIN_REACHES = 20;
export const PILOT_HELD_REACHES = 10;
const REACH_S = 1.6, BIN_S = BIN_MS / 1000, DEAD_S = 0.003;

export interface PilotCondition { /** Electrode noise, µV rms (0.3–7.5 kHz). */ noiseUv: number; /** Contacts that deliver nothing. */ lost: number[]; /** 0 = the calibrated population … 1 = strongly drifted. */ drift: number }
export const PILOT_BASE: PilotCondition = { noiseUv: 7, lost: [], drift: 0 };
export type PilotFault = 'noise' | 'lost' | 'drift';
export const PILOT_FAULTS: Record<PilotFault, { label: string; what: string; apply: (c: PilotCondition) => PilotCondition }> = {
  noise: { label: 'More noise', what: 'Electrode noise rises from 7 to 17.5 µV rms. The detection thresholds stay where calibration put them.', apply: (c) => ({ ...c, noiseUv: 17.5 }) },
  lost: { label: 'Lose 3 contacts', what: 'Contacts 1, 4 and 6 deliver nothing from now on.', apply: (c) => ({ ...c, lost: [0, 3, 5] }) },
  drift: { label: 'Tuning drift', what: 'Every unit’s preferred direction and resting rate shift by a fixed amount (a stand-in for session-to-session change).', apply: (c) => ({ ...c, drift: 1 }) },
};
export const condKey = (c: PilotCondition) => `${c.noiseUv}|${c.lost.join(',')}|${c.drift}`;

// ── the detector stand-in ───────────────────────────────────────────────────────────────────────────────────────
/** How much the chain's filters (300 Hz high-pass, 7.5 kHz low-pass, 300 Hz–3 kHz digital band-pass) shrink the spike peak. */
export const PEAK_KEPT: number = (() => {
  const t = spikeTemplate(GRID_HZ), pad = 600, x = new Float32Array(t.ec.length + 2 * pad);
  x.set(t.ec, pad);
  const a = 1 / (1 + (2 * Math.PI * 300) / GRID_HZ), hp = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) hp[i] = a * (hp[i - 1] + x[i] - x[i - 1]);
  const y = runBiquad(butterLP2(DSP_BAND_HZ[1], GRID_HZ), runBiquad(butterHP2(DSP_BAND_HZ[0], GRID_HZ), runBiquad(butterLP2(7500, GRID_HZ), hp)));
  let m = 0;
  for (const v of y) m = Math.min(m, v);
  return -m;
})();
/** Noise at the detector for a given electrode noise: band 0.3–7.5 kHz → 0.3–3 kHz, then the common average of 8. */
export const detectorNoiseUv = (noiseUv: number) => noiseUv * Math.sqrt((DSP_BAND_HZ[1] - DSP_BAND_HZ[0]) / (7500 - 300)) * Math.sqrt(1 - 1 / N_CH);
/** Rice's rate of downward threshold crossings by band-limited Gaussian noise, per second. */
const RICE_F0 = Math.sqrt((DSP_BAND_HZ[1] ** 3 - DSP_BAND_HZ[0] ** 3) / (3 * (DSP_BAND_HZ[1] - DSP_BAND_HZ[0])));
export const falseRateHz = (thresholdUv: number, sigmaUv: number) => RICE_F0 * Math.exp(-(thresholdUv * thresholdUv) / (2 * sigmaUv * sigmaUv));
/** Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
export const detectProb = (ampUv: number, thresholdUv: number, sigmaUv: number) => phi((PEAK_KEPT * ampUv - thresholdUv) / sigmaUv);

// ── the population under a condition ────────────────────────────────────────────────────────────────────────────
const UNITS = layoutUnits();
const DRIFT = UNITS.map((u) => ({ dTheta: ((hash3(0xd21f7, u.id, 1) / 4294967296) * 2 - 1) * 1.5, base: ((hash3(0xd21f7, u.id, 2) / 4294967296) * 2 - 1) * 0.45 }));
/** The unit as the contacts see it under a condition. */
function driftedUnit(u: Unit, drift: number): Unit {
  return drift === 0 ? u : { ...u, prefRad: u.prefRad + drift * DRIFT[u.id].dTheta, baseHz: Math.max(1, u.baseHz * (1 + drift * DRIFT[u.id].base)) };
}

export interface PilotSpike { unit: number; tS: number; counted: boolean }
const u01 = (a: number, b: number, c: number) => (hash3(a, b, c) + 0.5) / 4294967296;

/**
 * One 50 ms bin of the population and the detector stand-in. Deterministic in (stream, bin): the same bin of the same
 * stream always gives the same spikes, whatever was asked before.
 */
export function genBin(stream: number, bin: number, vx: number, vy: number, cond: PilotCondition, thresholdsUv: ArrayLike<number>, lastSpike: Float64Array, counts: Float32Array, spikes?: PilotSpike[]): void {
  counts.fill(0);
  const t0 = bin * BIN_S, sigma = detectorNoiseUv(cond.noiseUv);
  for (const base of UNITS) {
    const u = driftedUnit(base, cond.drift), rate = unitRate(u, vx, vy), lost = cond.lost.includes(u.ch);
    if (rate <= 0) continue;
    const p = detectProb(unitAmpUv(base, NEAR0_UM), thresholdsUv[u.ch], sigma), key = hash3(stream, u.id, 0x5eed);
    let t = t0, j = 0;
    for (;;) {
      t += -Math.log(1 - u01(key, bin, j++)) / rate;
      if (t >= t0 + BIN_S) break;
      if (t - lastSpike[u.id] < DEAD_S) continue;
      lastSpike[u.id] = t;
      const counted = !lost && u01(key, bin, 0x4000 + j) < p;
      if (counted) counts[u.ch]++;
      spikes?.push({ unit: u.id, tS: t, counted });
    }
  }
  for (let ch = 0; ch < N_CH; ch++) {
    if (cond.lost.includes(ch)) { counts[ch] = 0; continue; }
    // noise crossings: Poisson with the Rice rate (Knuth's method; the mean is far below one except when noise has risen)
    const lam = falseRateHz(thresholdsUv[ch], sigma) * BIN_S, key = hash3(stream, 1000 + ch, 0xfa15e);
    if (lam <= 0) continue;
    if (lam > 30) { counts[ch] += Math.round(lam); continue; }
    const L = Math.exp(-lam); let k = 0, prod = u01(key, bin, 0);
    while (prod > L) { k++; prod *= u01(key, bin, k); }
    counts[ch] += k;
  }
}

/** Intended velocity of the scripted calibration task at time t (s): out along a direction and back, bell-shaped speed. */
export function scriptedIntent(taskSeed: number, tS: number): [number, number] {
  const k = Math.floor(tS / REACH_S), u = (tS - k * REACH_S) / REACH_S;
  if (u < 0.125 || u > 0.875) return [0, 0];
  const s = Math.sin(Math.PI * ((u - 0.125) / 0.75)) ** 2, pair = Math.floor(k / 2);
  // the eight directions in a seeded order, each followed by its opposite
  const th = (((pair * 3 + (hash3(taskSeed, Math.floor(pair / 8), 0xd1) % 8)) % 8) * Math.PI) / 4 + (k % 2 ? Math.PI : 0);
  return [s * Math.cos(th), s * Math.sin(th)];
}

/** A dataset of scripted reaches recorded under a condition with given thresholds. */
export function scriptedDataset(stream: number, reaches: number, cond: PilotCondition, thresholdsUv: ArrayLike<number>): Dataset {
  const nBins = Math.round((reaches * REACH_S) / BIN_S), alpha = 1 - Math.exp(-BIN_MS / PILOT_TAU_MS);
  const counts = new Float32Array(nBins * N_CH), rates = new Float32Array(nBins * N_CH), target = new Float32Array(nBins * 2), valid = new Uint8Array(nBins);
  const last = new Float64Array(UNITS.length).fill(-1), c = new Float32Array(N_CH);
  for (let k = 0; k < nBins; k++) {
    const [vx, vy] = scriptedIntent(stream, (k + 0.5) * BIN_S);
    genBin(stream, k, vx, vy, cond, thresholdsUv, last, c);
    for (let ch = 0; ch < N_CH; ch++) { const r0 = k > 0 ? rates[(k - 1) * N_CH + ch] : 0; counts[k * N_CH + ch] = c[ch]; rates[k * N_CH + ch] = r0 + alpha * (c[ch] / BIN_S - r0); }
    target[k * 2] = vx; target[k * 2 + 1] = vy; valid[k] = k >= 10 ? 1 : 0;
  }
  return { nCh: N_CH, nOut: 2, nBins, binMs: BIN_MS, counts, rates, target, valid };
}

export interface PilotCalibration {
  id: number;
  atBin: number;
  cond: PilotCondition;
  thresholdsUv: number[];
  trainSeed: number; heldOutSeed: number; trainBins: number; heldOutBins: number;
  /** Held-out score of each decoder under the condition it was fitted on (data it never saw). */
  scores: Record<string, Score>;
}
export interface PilotEvaluation { atBin: number; evalSeed: number; cond: PilotCondition; scores: Record<string, Score> }

export type PilotCommandKind = 'calibrate' | 'fault' | 'clear' | 'decoder' | 'centre';
export interface PilotCommand { seq: number; atBin: number; kind: PilotCommandKind; target: string }

export interface PilotSnapshot {
  bin: number; tS: number;
  intent: [number, number]; decoded: [number, number];
  cursor: [number, number]; ghost: [number, number]; target: [number, number];
  counts: number[]; rates: number[];
  spikes: PilotSpike[];
  hits: number; misses: number;
  /** The reach that just ended, if one did in this bin. */
  ended: { hit: boolean; timeS: number; efficiency: number } | null;
  /**
   * How well the decoded velocity followed the intended one over the last 5 s: R² = 1 − Σ|decoded − intended|² /
   * Σ|intended − mean|², both axes pooled. Unlike a correlation it falls when the decoder adds a constant push.
   * NaN while the intent has not varied.
   */
  fit: number;
  decoderId: string; calibrated: boolean; cond: PilotCondition;
  /**
   * How the active decoder arrived at `decoded` in this bin, exactly as its own step reported it:
   * decoded[o] = base[o] + Σ_j terms[o][j]. For the linear decoder and the Kalman filter a term is one recording
   * contact (`termOf` = 'channel'); for the network it is one hidden unit. `base` is a bias, or (Kalman) the filter's
   * own previous estimate carried forward. Empty while no decoder is fitted.
   */
  base: number[]; terms: number[][]; termOf: 'channel' | 'hidden' | 'none';
}

/** Intended velocity for an intent code: 0 = none, 1…8 = E, NE, N, NW, W, SW, S, SE at full speed, +9 = the same at 45 %. */
export function intentOf(code: number): [number, number] {
  const dir = code % 9, slow = code >= 9;
  if (dir === 0) return [0, 0];
  const a = ((dir - 1) * Math.PI) / 4, s = slow ? 0.45 : 1;
  return [s * Math.cos(a), s * Math.sin(a)];
}
/** The intent code for held direction keys (x, y each −1, 0 or 1) and the precision key. */
export function intentCode(x: number, y: number, slow: boolean): number {
  if (!x && !y) return 0;
  const dir = ((Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 8) + 1;
  return dir + (slow ? 9 : 0);
}

export interface PilotExport {
  format: 'hbci.world.pilot-run'; version: 1;
  runId: string; seed: number; modelRevision: string; binMs: number;
  bins: number; digest: string;
  commands: PilotCommand[];
  /** One intent code per bin. */
  intents: number[];
}

const TIMEOUT_BINS = Math.round(12 / BIN_S), DWELL_BINS = 6, R_WINDOW = 100;

export class PilotSession {
  readonly seed: number;
  runId: string;
  bin = 0;
  cond: PilotCondition = { ...PILOT_BASE, lost: [] };
  calibration: PilotCalibration | null = null;
  evaluation: PilotEvaluation | null = null;
  decoderId: PilotDecoderId = 'linear';
  commands: PilotCommand[] = [];
  intents: number[] = [];
  cursor: [number, number] = [0, 0];
  ghost: [number, number] = [0, 0];
  target: [number, number] = [0, 0];
  hits = 0; misses = 0;
  private models = new Map<string, Model>();
  private dec: DecoderState | null = null;
  private thresholds = new Float32Array(N_CH);
  private rates = new Float32Array(N_CH);
  private counts = new Float32Array(N_CH);
  private last = new Float64Array(UNITS.length).fill(-1);
  private seq = 0; private calibrations = 0; private evaluations = 0;
  private targetN = 0; private trialStart = 0; private dwell = 0; private pathLen = 0; private startDist = 0;
  private recent: number[] = [];     // intent x, y, decoded x, y per bin, last R_WINDOW bins
  private path: number[] = [];

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.runId = `pilot-${this.seed}-${Date.now().toString(36)}`;
    this.nextTarget();
  }

  private log(kind: PilotCommandKind, target: string): void { this.commands.push({ seq: this.seq++, atBin: this.bin, kind, target }); }
  private nextTarget(): void {
    const n = this.targetN++, a = (hash3(this.seed, n, 0x7a6) / 4294967296) * 2 * Math.PI, r = 0.5 + 0.3 * (hash3(this.seed, n, 0x7a7) / 4294967296);
    // keep the next target away from where the cursor already is
    let x = r * Math.cos(a), y = r * Math.sin(a);
    if (Math.hypot(x - this.cursor[0], y - this.cursor[1]) < 0.45) { x = -x; y = -y; }
    this.target = [x, y]; this.trialStart = this.bin; this.dwell = 0; this.pathLen = 0;
    this.startDist = Math.max(0, Math.hypot(x - this.cursor[0], y - this.cursor[1]) - TARGET_RADIUS);
    this.ghost = [this.cursor[0], this.cursor[1]];
  }

  /**
   * Calibration, as a sequence of small steps so that a caller can show progress and stop between them.
   * Thresholds are re-estimated for the CURRENT condition, a training set and a separate held-out set of scripted
   * reaches are generated (different seeds), every decoder is fitted on the first and scored on the second.
   */
  *calibrateSteps(): Generator<{ done: number; total: number; what: string }, PilotCalibration, void> {
    const id = ++this.calibrations, total = 2 + PILOT_DECODERS.length;
    const cond: PilotCondition = { ...this.cond, lost: this.cond.lost.slice() }, sigma = detectorNoiseUv(cond.noiseUv);
    const thresholdsUv = Array.from({ length: N_CH }, () => PILOT_THRESH_K * sigma);
    const trainSeed = hash3(this.seed, id, 0xca1), heldOutSeed = hash3(this.seed, id, 0xca2);
    yield { done: 0, total, what: `Recording ${PILOT_TRAIN_REACHES} scripted reaches (simulated)` };
    const train = scriptedDataset(trainSeed, PILOT_TRAIN_REACHES, cond, thresholdsUv);
    yield { done: 1, total, what: `Recording ${PILOT_HELD_REACHES} more reaches, kept out of the fit` };
    const held = scriptedDataset(heldOutSeed, PILOT_HELD_REACHES, cond, thresholdsUv);
    const models = new Map<string, Model>(), scores: Record<string, Score> = {};
    let k = 2;
    for (const d of PILOT_DECODERS) {
      yield { done: k++, total, what: `Fitting ${decoderSpec(d).name}` };
      const m = decoderSpec(d).fit(train, PILOT_FIT_SEED);
      models.set(d, m); scores[d] = score(runModel(m, held), held);
    }
    // nothing is committed until every step has finished: a stopped calibration leaves the session as it was
    this.models = models; this.thresholds = Float32Array.from(thresholdsUv);
    this.dec = models.get(this.decoderId)!.init();
    const count = (d: Dataset) => d.valid.reduce((a, v) => a + v, 0);
    this.calibration = { id, atBin: this.bin, cond, thresholdsUv, trainSeed, heldOutSeed, trainBins: count(train), heldOutBins: count(held), scores };
    this.log('calibrate', String(id));
    this.evaluate();
    return this.calibration;
  }
  calibrate(): PilotCalibration { const g = this.calibrateSteps(); for (;;) { const r = g.next(); if (r.done) return r.value; } }

  /** Score every fitted decoder, without refitting, on a fresh set of scripted reaches under the CURRENT condition. */
  evaluate(): PilotEvaluation | null {
    if (!this.calibration) return null;
    const evalSeed = hash3(this.seed, ++this.evaluations, 0xe7a1);
    const d = scriptedDataset(evalSeed, PILOT_HELD_REACHES, this.cond, this.thresholds), scores: Record<string, Score> = {};
    for (const [id, m] of this.models) scores[id] = score(runModel(m, d), d);
    return (this.evaluation = { atBin: this.bin, evalSeed, cond: { ...this.cond, lost: this.cond.lost.slice() }, scores });
  }

  fault(f: PilotFault): void { this.cond = PILOT_FAULTS[f].apply(this.cond); this.log('fault', f); this.evaluate(); }
  clearFaults(): void { this.cond = { ...PILOT_BASE, lost: [] }; this.log('clear', ''); this.evaluate(); }
  setDecoder(id: PilotDecoderId): void {
    if (!(PILOT_DECODERS as readonly string[]).includes(id)) return;
    this.decoderId = id; this.dec = this.models.get(id)?.init() ?? null; this.log('decoder', id);
  }
  /** Put the cursor back in the middle (the task's own reset; the model is not touched). */
  centre(): void { this.cursor = [0, 0]; this.log('centre', ''); this.nextTarget(); }

  /** One 50 ms bin: the intent code in, everything that happened out. */
  step(code: number): PilotSnapshot {
    const k = this.bin, intent = intentOf(code), spikes: PilotSpike[] = [];
    this.intents.push(code);
    genBin(hash3(this.seed, 0, 0x91a7), k, intent[0], intent[1], this.cond, this.thresholds, this.last, this.counts, spikes);
    const alpha = 1 - Math.exp(-BIN_MS / PILOT_TAU_MS);
    for (let ch = 0; ch < N_CH; ch++) this.rates[ch] += alpha * (this.counts[ch] / BIN_S - this.rates[ch]);
    let decoded: [number, number] = [0, 0], base: number[] = [], terms: number[][] = [], termOf: PilotSnapshot['termOf'] = 'none';
    const model = this.models.get(this.decoderId);
    if (model && this.dec) { const out = model.step(this.dec, { counts: this.counts, rates: this.rates }), y = out.y; decoded = [y[0], y[1]]; base = out.base.slice(); terms = out.contrib.map((r) => r.slice()); termOf = out.contribOf; }
    // the cursor is moved by the DECODED velocity only; the ghost shows where the intended velocity would have taken it
    const px = this.cursor[0], py = this.cursor[1], lim = 1.15, cl = (v: number) => Math.max(-lim, Math.min(lim, v));
    this.cursor = [cl(px + decoded[0] * VMAX * BIN_S), cl(py + decoded[1] * VMAX * BIN_S)];
    this.ghost = [cl(this.ghost[0] + intent[0] * VMAX * BIN_S), cl(this.ghost[1] + intent[1] * VMAX * BIN_S)];
    this.pathLen += Math.hypot(this.cursor[0] - px, this.cursor[1] - py);
    this.path.push(this.cursor[0], this.cursor[1]);
    this.recent.push(intent[0], intent[1], decoded[0], decoded[1]);
    if (this.recent.length > R_WINDOW * 4) this.recent.splice(0, 4);
    this.bin = k + 1;
    let ended: PilotSnapshot['ended'] = null;
    const tg = this.target, inside = Math.hypot(this.cursor[0] - tg[0], this.cursor[1] - tg[1]) <= TARGET_RADIUS;
    this.dwell = inside ? this.dwell + 1 : 0;
    const hit = this.dwell >= DWELL_BINS, late = this.bin - this.trialStart >= TIMEOUT_BINS;
    if (hit || late) {
      ended = { hit, timeS: (this.bin - this.trialStart) * BIN_S, efficiency: this.pathLen > 0 ? Math.min(1, this.startDist / this.pathLen) : 0 };
      if (hit) this.hits++; else this.misses++;
      this.nextTarget();
    }
    return {
      bin: this.bin, tS: this.bin * BIN_S, intent, decoded, cursor: [this.cursor[0], this.cursor[1]], ghost: [this.ghost[0], this.ghost[1]], target: [tg[0], tg[1]],
      counts: Array.from(this.counts), rates: Array.from(this.rates), spikes, hits: this.hits, misses: this.misses, ended, fit: this.recentFit(),
      decoderId: this.decoderId, calibrated: !!this.calibration, cond: this.cond, base, terms, termOf,
    };
  }

  private recentFit(): number {
    const a = this.recent, n = a.length / 4;
    if (n < 20) return NaN;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += a[i * 4] / n; my += a[i * 4 + 1] / n; }
    let sse = 0, sst = 0;
    for (let i = 0; i < n; i++) { sse += (a[i * 4 + 2] - a[i * 4]) ** 2 + (a[i * 4 + 3] - a[i * 4 + 1]) ** 2; sst += (a[i * 4] - mx) ** 2 + (a[i * 4 + 1] - my) ** 2; }
    return sst > 1e-6 ? 1 - sse / sst : NaN;
  }

  digest(): string {
    let h = 0x811c9dc5;
    const b = new Uint8Array(Float64Array.from([...this.path, this.bin, this.hits, this.misses]).buffer);
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  export(): PilotExport {
    return { format: 'hbci.world.pilot-run', version: 1, runId: this.runId, seed: this.seed, modelRevision: PILOT_REVISION, binMs: BIN_MS, bins: this.bin, digest: this.digest(), commands: this.commands.slice(), intents: this.intents.slice() };
  }

  /** Rebuild a session by replaying an export: the same commands at the same bins, the same intent in every bin. */
  static import(x: PilotExport): { session: PilotSession; matches: boolean } {
    if (x?.format !== 'hbci.world.pilot-run' || x.version !== 1) throw new Error('not a pilot-run export');
    if (x.modelRevision !== PILOT_REVISION) throw new Error(`model revision ${x.modelRevision} is not the one in this build (${PILOT_REVISION})`);
    const s = new PilotSession(x.seed), cmds = x.commands.slice().sort((a, b) => a.atBin - b.atBin || a.seq - b.seq);
    let c = 0;
    const apply = () => {
      for (; c < cmds.length && cmds[c].atBin <= s.bin; c++) {
        const cmd = cmds[c];
        if (cmd.kind === 'calibrate') s.calibrate();
        else if (cmd.kind === 'fault') s.fault(cmd.target as PilotFault);
        else if (cmd.kind === 'clear') s.clearFaults();
        else if (cmd.kind === 'decoder') s.setDecoder(cmd.target as PilotDecoderId);
        else if (cmd.kind === 'centre') s.centre();
      }
    };
    for (let k = 0; k < x.bins; k++) { apply(); s.step(x.intents[k] ?? 0); }
    apply();
    return { session: s, matches: s.digest() === x.digest };
  }
}

export { DECODERS as PILOT_ALL_DECODERS, TARGET_RADIUS as PILOT_TARGET_RADIUS, N_CH as PILOT_CH, UNITS as PILOT_UNITS };
