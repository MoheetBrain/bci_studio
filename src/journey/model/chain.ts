// Acquisition-chain model for the signal-journey lesson. Renderer-independent and deterministic:
//   runChain(params) is a pure function — same params (incl. seed) → identical numbers, on any machine.
//
// EVIDENCE LABEL: synthetic quantitative example. Nothing here is a recording. Every stage states its model:
//   source     sum of extracellular spikes from several model neurons (amplitude ∝ 1/distance — an assumption),
//              band-limited background, a slow field potential, an optional gamma-band burst and an optional
//              out-of-band interferer. The membrane-potential trace is an illustrative template, not a biophysical
//              simulation.
//   electrode  contact − reference, plus a DC electrode offset and thermal (Johnson) noise √(4kTRB).
//   AFE        1st-order high-pass → 2nd-order Butterworth low-pass → gain → hard saturation at ±swing.
//   ADC        ideal sampler + mid-tread quantiser, two's-complement codes, clamped at the rails.
//   digital    the studio's TypeScript models of the chip's EVENT and FEATURE paths. Those models are compared
//              bit-for-bit with RTL simulation traces on recorded fixtures (npm run check:model, check:v03); the input
//              used here is synthetic, so this stage is "model checked against RTL on fixtures", not an RTL run.
//
// "Continuous" signals are approximated on a fixed ANALOG_RATE_HZ grid; the ADC picks every k-th grid point.
import { freshState, stepCore, PACKET_BITS, type CoreConfig } from '../../lab/model';
import { DEFAULT_FEATURE, freshFeature, stepFeature } from '../../lab/featureModel';

export const ANALOG_RATE_HZ = 240_000;
/** Sample rates offered: each divides ANALOG_RATE_HZ exactly. */
export const SAMPLE_RATES_HZ = [1000, 2000, 5000, 10000, 20000, 30000] as const;
export const BOLTZMANN = 1.380649e-23;
export const BODY_TEMP_K = 310.15;
/** The chip's FEATURE filter was designed for this sample rate (chip/system/hbci_system.json). */
export const FEATURE_DESIGN_RATE_HZ = 2000;
export const FEATURE_DESIGN_BAND_HZ: [number, number] = [70, 150];
/** Bits of one FEATURE record on the serial output is not modelled here; EVENT packets are PACKET_BITS wide. */
export const EVENT_PACKET_BITS = PACKET_BITS;

export interface UnitParams {
  /** Distance from the electrode contact to the neuron's soma, micrometres. */
  distanceUm: number;
  /** Mean firing rate, spikes per second. */
  rateHz: number;
}

export interface ChainParams {
  seed: number;
  durationMs: number;
  // ── neural source ──
  units: UnitParams[];
  /** Extracellular spike amplitude (negative peak) of a unit at refDistanceUm, microvolts. */
  spikeUvAtRef: number;
  refDistanceUm: number;
  /** RMS of the unresolved background ("hash") from distant neurons, microvolts. */
  backgroundUvRms: number;
  lfpUvPk: number;
  lfpHz: number;
  gammaUvPk: number;
  gammaHz: number;
  gammaStartMs: number;
  gammaEndMs: number;
  /** Out-of-band tone used for the aliasing demonstration (0 = off). */
  interfererUvPk: number;
  interfererHz: number;
  // ── electrode ──
  electrodeOffsetMv: number;
  electrodeResistanceKohm: number;
  // ── analogue front end ──
  gain: number;
  /** High-pass corner, Hz. 0 = DC-coupled (no high-pass). */
  hpHz: number;
  /** Low-pass (anti-alias) corner, Hz. */
  lpHz: number;
  /** Amplifier input-referred noise over its pass band, microvolts RMS. */
  afeNoiseUvRms: number;
  /** Output swing: the amplifier output saturates at ±this, volts. */
  swingV: number;
  // ── ADC ──
  fsHz: number;
  bits: number;
  /** Full scale is ±vrefV at the ADC input. */
  vrefV: number;
  // ── digital (chip) ──
  core: CoreConfig;
}

/** A spike-band (intracortical) default: 30 kS/s, 16 bit, three resolvable neurons near the contact. */
export const DEFAULT_PARAMS: ChainParams = {
  seed: 7,
  durationMs: 200,
  units: [{ distanceUm: 35, rateHz: 22 }, { distanceUm: 55, rateHz: 30 }, { distanceUm: 120, rateHz: 40 }],
  spikeUvAtRef: 120,
  refDistanceUm: 30,
  backgroundUvRms: 6,
  lfpUvPk: 150,
  lfpHz: 8,
  gammaUvPk: 0,
  gammaHz: 100,
  gammaStartMs: 80,
  gammaEndMs: 140,
  interfererUvPk: 0,
  interfererHz: 17000,
  electrodeOffsetMv: 25,
  electrodeResistanceKohm: 200,
  gain: 400,
  hpHz: 300,
  lpHz: 7500,
  afeNoiseUvRms: 2.4,
  swingV: 0.6,
  fsHz: 30000,
  bits: 16,
  vrefV: 0.6,
  core: { threshold: 900, hysteresis: 300, refractory: 30, alphaShift: 6 },
};

export const LIMITS = {
  durationMs: [40, 400], distanceUm: [15, 400], rateHz: [0, 120], spikeUvAtRef: [10, 500], refDistanceUm: [10, 100],
  backgroundUvRms: [0, 40], lfpUvPk: [0, 1000], lfpHz: [1, 40], gammaUvPk: [0, 300], gammaHz: [40, 300],
  interfererUvPk: [0, 500], interfererHz: [500, 100000], electrodeOffsetMv: [-100, 100], electrodeResistanceKohm: [1, 5000],
  gain: [1, 5000], hpHz: [0, 1000], lpHz: [100, 20000], afeNoiseUvRms: [0, 20], swingV: [0.1, 2.5], bits: [4, 16], vrefV: [0.1, 2.5],
  threshold: [0, 65535], hysteresis: [0, 65535], refractory: [0, 255], alphaShift: [0, 15],
} as const;

export function validateParams(p: ChainParams): string[] {
  const e: string[] = [];
  const range = (name: string, v: number, [lo, hi]: readonly [number, number]) => {
    if (!Number.isFinite(v)) e.push(`${name} is not a finite number`);
    else if (v < lo || v > hi) e.push(`${name} = ${v} is outside ${lo}…${hi}`);
  };
  if (!Number.isInteger(p.seed)) e.push('seed must be an integer');
  range('durationMs', p.durationMs, LIMITS.durationMs);
  if (!Array.isArray(p.units) || p.units.length < 1 || p.units.length > 8) e.push('units must hold 1…8 neurons');
  else p.units.forEach((u, i) => { range(`units[${i}].distanceUm`, u.distanceUm, LIMITS.distanceUm); range(`units[${i}].rateHz`, u.rateHz, LIMITS.rateHz); });
  for (const k of ['spikeUvAtRef', 'refDistanceUm', 'backgroundUvRms', 'lfpUvPk', 'lfpHz', 'gammaUvPk', 'gammaHz', 'interfererUvPk', 'interfererHz',
    'electrodeOffsetMv', 'electrodeResistanceKohm', 'gain', 'hpHz', 'lpHz', 'afeNoiseUvRms', 'swingV', 'bits', 'vrefV'] as const) range(k, p[k], LIMITS[k]);
  if (!Number.isInteger(p.bits)) e.push('bits must be an integer');
  if (!(SAMPLE_RATES_HZ as readonly number[]).includes(p.fsHz)) e.push(`fsHz must be one of ${SAMPLE_RATES_HZ.join(', ')}`);
  if (Number.isFinite(p.gammaStartMs) && Number.isFinite(p.gammaEndMs)) { if (p.gammaEndMs < p.gammaStartMs) e.push('gammaEndMs is before gammaStartMs'); } else e.push('gamma window is not finite');
  range('core.threshold', p.core.threshold, LIMITS.threshold); range('core.hysteresis', p.core.hysteresis, LIMITS.hysteresis);
  range('core.refractory', p.core.refractory, LIMITS.refractory); range('core.alphaShift', p.core.alphaShift, LIMITS.alphaShift);
  for (const k of ['threshold', 'hysteresis', 'refractory', 'alphaShift'] as const) if (!Number.isInteger(p.core[k])) e.push(`core.${k} must be an integer`);
  return e;
}

// ── deterministic random numbers ────────────────────────────────────────────────────────────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(r: () => number): () => number {
  return () => {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
}

// ── waveform templates (time in ms relative to the spike time) ──────────────────────────────────────────────────
/** Extracellular spike, unit negative peak (value −1 at t = 0), followed by a smaller, slower positive phase. */
export function extracellularTemplate(tMs: number): number {
  return -Math.exp(-((tMs / 0.11) ** 2)) + 0.32 * Math.exp(-(((tMs - 0.42) / 0.28) ** 2));
}
/** Illustrative membrane potential of the same neuron, millivolts (rest −65, peak ≈ +30, brief after-hyperpolarisation). */
export function membraneTemplateMv(tMs: number): number {
  const up = 95 * Math.exp(-(((tMs - 0.12) / 0.22) ** 2));
  const ahp = -9 * Math.exp(-(((tMs - 1.5) / 0.9) ** 2));
  return up + ahp;
}
export const RESTING_MV = -65;

// ── filters on the analogue grid ────────────────────────────────────────────────────────────────────────────────
/** `dc` is the level the filter has already settled on before t = 0 (the amplifier is assumed switched on long before). */
function highPass1(x: Float64Array, fc: number, fs: number, dc: number): Float64Array {
  if (fc <= 0) return x.slice();
  const y = new Float64Array(x.length);
  const a = 1 / (1 + (2 * Math.PI * fc) / fs);
  let xp = dc, yp = 0;
  for (let i = 0; i < x.length; i++) { yp = a * (yp + x[i] - xp); xp = x[i]; y[i] = yp; }
  return y;
}
function lowPass2Butter(x: Float64Array, fc: number, fs: number, dc: number): Float64Array {
  const k = Math.tan((Math.PI * fc) / fs), q = Math.SQRT1_2;
  const n = 1 / (1 + k / q + k * k);
  const b0 = k * k * n, b1 = 2 * b0, b2 = b0, a1 = 2 * (k * k - 1) * n, a2 = (1 - k / q + k * k) * n;
  const y = new Float64Array(x.length);
  let x1 = dc, x2 = dc, y1 = dc, y2 = dc;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** |H(f)| of the analogue prototypes (1st-order HP · 2nd-order Butterworth LP), as amplitude ratio. */
export function afeMagnitude(fHz: number, hpHz: number, lpHz: number): number {
  const hp = hpHz <= 0 ? 1 : (fHz / hpHz) / Math.sqrt(1 + (fHz / hpHz) ** 2);
  const lp = 1 / Math.sqrt(1 + (fHz / lpHz) ** 4);
  return hp * lp;
}
/** Frequency at which a tone of fHz appears after sampling at fsHz (folded into 0…fs/2). */
export function aliasFrequency(fHz: number, fsHz: number): number {
  const m = ((fHz % fsHz) + fsHz) % fsHz;
  return m > fsHz / 2 ? fsHz - m : m;
}
/** Thermal noise of a resistance over a bandwidth, volts RMS. */
export function thermalNoiseV(resistanceOhm: number, bandwidthHz: number, tempK = BODY_TEMP_K): number {
  return Math.sqrt(4 * BOLTZMANN * tempK * resistanceOhm * bandwidthHz);
}

export interface TruthSpike { unit: number; tMs: number; ampUv: number }
export interface ChainEvent { n: number; tMs: number; polarity: 0 | 1; magnitude: number; matchedUnit: number | null }
export interface FeatureWindow { n: number; tMs: number; energy: number; saturated: boolean }

export interface ChainResult {
  params: ChainParams;
  analog: {
    rateHz: number;
    count: number;
    /** Membrane potential of unit 0, mV (illustrative template). */
    vmMv: Float32Array;
    /** Electrode potential relative to the reference, µV, without the DC offset. */
    veUv: Float32Array;
    /** Amplifier output, volts (after filtering, gain and saturation). */
    afeV: Float32Array;
  };
  adc: {
    count: number;
    /** Analogue grid points per ADC sample. */
    step: number;
    code: Int32Array;
    /** The 16-bit signed sample handed to the chip (code left-aligned to 16 bits). */
    sample16: Int16Array;
    clipped: Uint8Array;
  };
  digital: {
    baseline: Int32Array;
    residual: Int32Array;
    fire: Uint8Array;
    refractory: Uint8Array;
    y: Int16Array;
    events: ChainEvent[];
    windows: FeatureWindow[];
  };
  truth: TruthSpike[];
  derived: Derived;
}

export interface Derived {
  unitAmplitudeUv: number[];
  lsbV: number;
  lsbInputUv: number;
  fullScaleInputMv: number;
  quantNoiseInputUvRms: number;
  electrodeThermalUvRms: number;
  inputNoiseUvRms: number;
  noiseBandwidthHz: number;
  afeClipFraction: number;
  adcClipFraction: number;
  nyquistHz: number;
  lpAttenuationAtNyquistDb: number;
  interferer: null | { fHz: number; aliasHz: number; aliased: boolean; attenuationDb: number; inputUvPk: number; afterFilterUvPk: number };
  dcOffsetAtOutputV: number;
  featureBandHz: [number, number];
  featureWindowMs: number;
  rawBitsPerS: number;
  eventBitsPerS: number;
  detection: { trueSpikes: number; detectable: number; hits: number; misses: number; falsePositives: number; toleranceMs: number };
  thresholdInputUv: number;
  /** Fraction of a spike's peak amplitude that survives the amplifier's band-pass (noise-free template). */
  spikePeakRetained: number;
}

/** Run the whole chain. Throws on invalid parameters (use validateParams first for messages). */
export function runChain(p: ChainParams): ChainResult {
  const errors = validateParams(p);
  if (errors.length) throw new Error(`invalid chain parameters: ${errors.join('; ')}`);
  const Fa = ANALOG_RATE_HZ;
  const N = Math.round((p.durationMs / 1000) * Fa);
  const dtMs = 1000 / Fa;
  const rand = mulberry32(p.seed);
  const gauss = gaussian(rand);

  // 1 · neural source ──────────────────────────────────────────────────────────────────────────────────────────
  const unitAmplitudeUv = p.units.map((u) => (p.spikeUvAtRef * p.refDistanceUm) / u.distanceUm);
  const truth: TruthSpike[] = [];
  const ve = new Float64Array(N);
  const vm = new Float64Array(N).fill(RESTING_MV);
  p.units.forEach((u, ui) => {
    if (u.rateHz <= 0) return;
    let t = 0;
    for (;;) {
      t += (-Math.log(1 - rand()) / u.rateHz) * 1000 + 2.5; // Poisson intervals plus a 2.5 ms refractory period
      if (t >= p.durationMs - 3) break;
      truth.push({ unit: ui, tMs: t, ampUv: unitAmplitudeUv[ui] });
      const i0 = Math.max(0, Math.floor((t - 1) / dtMs)), i1 = Math.min(N - 1, Math.ceil((t + 4) / dtMs));
      for (let i = i0; i <= i1; i++) {
        const rel = i * dtMs - t;
        ve[i] += unitAmplitudeUv[ui] * extracellularTemplate(rel);
        if (ui === 0) vm[i] += membraneTemplateMv(rel);
      }
    }
  });
  truth.sort((a, b) => a.tMs - b.tMs);
  // unresolved background: band-limited Gaussian (one-pole low-pass at 5 kHz), normalised to the requested RMS
  if (p.backgroundUvRms > 0) {
    const bg = new Float64Array(N);
    const a = Math.exp((-2 * Math.PI * 5000) / Fa);
    let s = 0, sq = 0;
    for (let i = 0; i < N; i++) { s = a * s + (1 - a) * gauss(); bg[i] = s; sq += s * s; }
    const k = p.backgroundUvRms / Math.sqrt(sq / N);
    for (let i = 0; i < N; i++) ve[i] += bg[i] * k;
  }
  for (let i = 0; i < N; i++) {
    const tS = i / Fa, tMs = i * dtMs;
    let v = p.lfpUvPk * Math.sin(2 * Math.PI * p.lfpHz * tS);
    if (p.gammaUvPk > 0 && tMs >= p.gammaStartMs && tMs <= p.gammaEndMs) {
      const w = Math.sin((Math.PI * (tMs - p.gammaStartMs)) / Math.max(1e-9, p.gammaEndMs - p.gammaStartMs)); // smooth on/off
      v += p.gammaUvPk * w * Math.sin(2 * Math.PI * p.gammaHz * tS);
    }
    if (p.interfererUvPk > 0) v += p.interfererUvPk * Math.sin(2 * Math.PI * p.interfererHz * tS);
    ve[i] += v;
  }

  // 2 · electrode + amplifier input noise ──────────────────────────────────────────────────────────────────────
  const noiseBandwidthHz = 1.11 * p.lpHz; // equivalent noise bandwidth of a 2nd-order Butterworth low-pass
  const electrodeThermalUvRms = thermalNoiseV(p.electrodeResistanceKohm * 1e3, noiseBandwidthHz) * 1e6;
  const inputNoiseUvRms = Math.hypot(electrodeThermalUvRms, p.afeNoiseUvRms);
  // white noise on the grid whose in-band (after the low-pass) RMS equals inputNoiseUvRms
  const sigma = inputNoiseUvRms * Math.sqrt(Fa / 2 / noiseBandwidthHz);
  const vin = new Float64Array(N);
  for (let i = 0; i < N; i++) vin[i] = ve[i] + p.electrodeOffsetMv * 1000 + (inputNoiseUvRms > 0 ? sigma * gauss() : 0);

  // 3 · analogue front end: high-pass → low-pass → gain → saturation ───────────────────────────────────────────
  const offsetUv = p.electrodeOffsetMv * 1000;
  const filtered = lowPass2Butter(highPass1(vin, p.hpHz, Fa, offsetUv), p.lpHz, Fa, p.hpHz > 0 ? 0 : offsetUv);
  const afe = new Float32Array(N);
  let afeClip = 0;
  for (let i = 0; i < N; i++) {
    let v = filtered[i] * 1e-6 * p.gain;
    if (v > p.swingV) { v = p.swingV; afeClip++; } else if (v < -p.swingV) { v = -p.swingV; afeClip++; }
    afe[i] = v;
  }

  // 4 · ADC: sample, quantise (mid-tread), clamp; two's-complement code; left-align to the chip's 16-bit sample ──
  const step = Fa / p.fsHz;
  const M = Math.floor(N / step);
  const lsbV = (2 * p.vrefV) / 2 ** p.bits;
  const cmax = 2 ** (p.bits - 1) - 1, cmin = -(2 ** (p.bits - 1));
  const code = new Int32Array(M), sample16 = new Int16Array(M), clipped = new Uint8Array(M);
  let adcClip = 0;
  for (let n = 0; n < M; n++) {
    let c = Math.round(afe[n * step] / lsbV);
    if (c > cmax) { c = cmax; clipped[n] = 1; adcClip++; } else if (c < cmin) { c = cmin; clipped[n] = 1; adcClip++; }
    code[n] = c;
    sample16[n] = c * 2 ** (16 - p.bits);
  }

  // 5 · digital: the chip's EVENT and FEATURE paths on channel 0 (models checked against RTL on fixtures) ─────
  const cs = freshState()[0];
  const fs = freshFeature();
  const baseline = new Int32Array(M), residual = new Int32Array(M), fire = new Uint8Array(M), refractory = new Uint8Array(M), y = new Int16Array(M);
  const events: ChainEvent[] = [];
  const windows: FeatureWindow[] = [];
  const tolMs = 1.0;
  const used = new Set<number>();
  for (let n = 0; n < M; n++) {
    const r = stepCore(cs, n, 0, sample16[n], p.core);
    baseline[n] = r.baseInt; residual[n] = r.res; fire[n] = r.fire; refractory[n] = r.refr;
    const f = stepFeature(fs, sample16[n], DEFAULT_FEATURE);
    y[n] = f.y;
    const tMs = (n / p.fsHz) * 1000;
    if (f.done) windows.push({ n, tMs, energy: f.energy, saturated: f.esat === 1 });
    if (r.fire) {
      // match to the nearest not-yet-matched true spike within ±tolMs (the group delay of the low-pass is < 0.1 ms here)
      let best = -1, bd = Infinity;
      for (let k = 0; k < truth.length; k++) {
        const d = Math.abs(truth[k].tMs - tMs);
        if (d <= tolMs && d < bd && !used.has(k)) { bd = d; best = k; }
      }
      if (best >= 0) used.add(best);
      events.push({ n, tMs, polarity: r.pol, magnitude: r.mag, matchedUnit: best >= 0 ? truth[best].unit : null });
    }
  }

  // derived, human-readable consequences ────────────────────────────────────────────────────────────────────────
  const thresholdInputUv = ((p.core.threshold / 2 ** (16 - p.bits)) * lsbV / p.gain) * 1e6;
  // How much of a spike's peak survives the amplifier's band-pass: filter one noise-free unit template and take its peak.
  const tpl = new Float64Array(Math.round(0.012 * Fa));
  for (let i = 0; i < tpl.length; i++) tpl[i] = extracellularTemplate(i * dtMs - 4);
  const tplOut = lowPass2Butter(highPass1(tpl, p.hpHz, Fa, 0), p.lpHz, Fa, 0);
  let spikePeakRetained = 0;
  for (const v of tplOut) spikePeakRetained = Math.max(spikePeakRetained, Math.abs(v));
  // a spike counts as "detectable" when its filtered peak (ignoring noise) reaches the threshold
  const detectable = truth.filter((s) => s.ampUv * spikePeakRetained >= thresholdInputUv).length;
  const hits = events.filter((e) => e.matchedUnit !== null).length;
  const interferer = p.interfererUvPk > 0 ? (() => {
    const mag = afeMagnitude(p.interfererHz, p.hpHz, p.lpHz);
    const aliasHz = aliasFrequency(p.interfererHz, p.fsHz);
    return { fHz: p.interfererHz, aliasHz, aliased: p.interfererHz > p.fsHz / 2, attenuationDb: 20 * Math.log10(mag), inputUvPk: p.interfererUvPk, afterFilterUvPk: p.interfererUvPk * mag };
  })() : null;
  const scale = p.fsHz / FEATURE_DESIGN_RATE_HZ;
  const derived: Derived = {
    unitAmplitudeUv,
    lsbV,
    lsbInputUv: (lsbV / p.gain) * 1e6,
    fullScaleInputMv: (Math.min(p.vrefV, p.swingV) / p.gain) * 1e3,
    quantNoiseInputUvRms: (lsbV / Math.sqrt(12) / p.gain) * 1e6,
    electrodeThermalUvRms,
    inputNoiseUvRms,
    noiseBandwidthHz,
    afeClipFraction: afeClip / N,
    adcClipFraction: M ? adcClip / M : 0,
    nyquistHz: p.fsHz / 2,
    lpAttenuationAtNyquistDb: 20 * Math.log10(afeMagnitude(p.fsHz / 2, 0, p.lpHz)),
    interferer,
    dcOffsetAtOutputV: p.hpHz > 0 ? 0 : (p.electrodeOffsetMv / 1000) * p.gain,
    featureBandHz: [FEATURE_DESIGN_BAND_HZ[0] * scale, FEATURE_DESIGN_BAND_HZ[1] * scale],
    featureWindowMs: ((1 << DEFAULT_FEATURE.winLog2) / p.fsHz) * 1000,
    rawBitsPerS: p.fsHz * 16,
    eventBitsPerS: (events.length * EVENT_PACKET_BITS) / (p.durationMs / 1000),
    detection: { trueSpikes: truth.length, detectable, hits, misses: Math.max(0, detectable - hits), falsePositives: events.length - hits, toleranceMs: tolMs },
    thresholdInputUv,
    spikePeakRetained,
  };

  return {
    params: p,
    analog: { rateHz: Fa, count: N, vmMv: Float32Array.from(vm), veUv: Float32Array.from(ve), afeV: afe },
    adc: { count: M, step, code, sample16, clipped },
    digital: { baseline, residual, fire, refractory, y, events, windows },
    truth,
    derived,
  };
}

/** Everything the chain "knows" at an instant — recomputed from the result arrays, so scrubbing is exact and repeatable. */
export interface StateAt {
  tMs: number;
  /** Index on the analogue grid. */
  i: number;
  vmMv: number;
  veUv: number;
  afeV: number;
  /** Index of the latest ADC sample taken at or before tMs (−1 before the first). This is the chip's sample timestamp. */
  n: number;
  sampleTimeMs: number | null;
  code: number | null;
  sample16: number | null;
  adcClipped: boolean;
  baseline: number | null;
  residual: number | null;
  refractory: number | null;
  y: number | null;
  eventsSoFar: number;
  lastEvent: ChainEvent | null;
  windowsSoFar: number;
  lastWindow: FeatureWindow | null;
}

export function stateAt(r: ChainResult, tMs: number): StateAt {
  const t = Math.max(0, Math.min(r.params.durationMs, Number.isFinite(tMs) ? tMs : 0));
  const i = Math.min(r.analog.count - 1, Math.floor((t / 1000) * r.analog.rateHz));
  const n = Math.min(r.adc.count - 1, Math.floor(i / r.adc.step));
  const has = n >= 0 && r.adc.count > 0;
  const ev = r.digital.events.filter((e) => e.n <= n);
  const wn = r.digital.windows.filter((w) => w.n <= n);
  return {
    tMs: t, i,
    vmMv: r.analog.vmMv[i], veUv: r.analog.veUv[i], afeV: r.analog.afeV[i],
    n: has ? n : -1,
    sampleTimeMs: has ? (n / r.params.fsHz) * 1000 : null,
    code: has ? r.adc.code[n] : null,
    sample16: has ? r.adc.sample16[n] : null,
    adcClipped: has ? r.adc.clipped[n] === 1 : false,
    baseline: has ? r.digital.baseline[n] : null,
    residual: has ? r.digital.residual[n] : null,
    refractory: has ? r.digital.refractory[n] : null,
    y: has ? r.digital.y[n] : null,
    eventsSoFar: ev.length,
    lastEvent: ev.length ? ev[ev.length - 1] : null,
    windowsSoFar: wn.length,
    lastWindow: wn.length ? wn[wn.length - 1] : null,
  };
}

/** FNV-1a over the numeric outputs: a compact fingerprint used by the determinism tests. */
export function fingerprint(r: ChainResult): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193); h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193); h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193); h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193); };
  for (const c of r.adc.code) mix(c);
  for (const b of r.digital.baseline) mix(b);
  for (const e of r.digital.events) { mix(e.n); mix(e.magnitude); }
  for (const w of r.digital.windows) mix(w.energy);
  return (h >>> 0).toString(16).padStart(8, '0');
}
