// The Hodgkin–Huxley membrane model (Hodgkin & Huxley 1952, J Physiol 117:500–544), integrated deterministically.
//
// What it is: the classic quantitative model of the squid giant axon membrane at 6.3 °C — sodium, potassium and leak
// conductances with voltage-dependent gates m, h, n. It is used here because every term is published and checkable.
// What it is not: a model of a human cortical pyramidal neuron (different channels, temperature and geometry), and
// not a recording. Voltages follow the modern sign convention (inside relative to outside, rest ≈ −65 mV).
//
// Pure module: no DOM, no three.js. Unit-tested in tests/hh.test.ts.

export const HH = {
  /** Membrane capacitance, µF/cm². */
  C: 1,
  /** Maximal conductances, mS/cm². */
  gNa: 120, gK: 36, gL: 0.3,
  /** Reversal potentials, mV (rest shifted to −65 mV). */
  ENa: 50, EK: -77, EL: -54.387,
  /** Resting potential of this parameter set, mV. */
  rest: -65,
} as const;

/** x / (1 − e^(−x/y)), with its limit y at x = 0 (removes the 0/0 in two of the rate functions). */
const vtrap = (x: number, y: number) => (Math.abs(x / y) < 1e-6 ? y * (1 + x / y / 2) : x / (1 - Math.exp(-x / y)));

/** Opening / closing rates of the three gates at membrane potential v (mV), in 1/ms. */
export function rates(v: number) {
  return {
    am: 0.1 * vtrap(v + 40, 10), bm: 4 * Math.exp(-(v + 65) / 18),
    ah: 0.07 * Math.exp(-(v + 65) / 20), bh: 1 / (1 + Math.exp(-(v + 35) / 10)),
    an: 0.01 * vtrap(v + 55, 10), bn: 0.125 * Math.exp(-(v + 65) / 80),
  };
}

/** Steady-state gate values at v. */
export function steady(v: number) {
  const r = rates(v);
  return { m: r.am / (r.am + r.bm), h: r.ah / (r.ah + r.bh), n: r.an / (r.an + r.bn) };
}

export interface HHParams {
  /** Injected current density during the step, µA/cm² (positive depolarises). */
  currentUaCm2: number;
  /** Start and end of the current step, ms. */
  onMs: number;
  offMs: number;
  durationMs: number;
}

export interface HHResult {
  params: HHParams;
  /** Samples per millisecond of every trace below. */
  perMs: number;
  /** Membrane potential, mV. */
  v: Float32Array;
  m: Float32Array; h: Float32Array; n: Float32Array;
  /** Ionic currents, µA/cm² (outward positive). */
  iNa: Float32Array; iK: Float32Array;
  /** Injected current, µA/cm². */
  iInj: Float32Array;
  /** dV/dt, mV/ms (used for the extracellular teaching model). */
  dvdt: Float32Array;
  /** Times (ms) at which v crosses 0 mV upwards: one per action potential. */
  spikesMs: number[];
}

export const HH_LIMITS = { currentUaCm2: [0, 30] as [number, number], durationMs: [20, 400] as [number, number] };

const DT = 0.01;          // integration step, ms
const OUT_EVERY = 2;      // keep every 2nd step → 50 samples per ms

/**
 * Integrate the model with a fixed-step fourth-order Runge–Kutta scheme, starting at rest with the gates at their
 * steady state. Same inputs always give the same arrays (no randomness, no wall-clock time).
 */
export function simulateHH(p: HHParams): HHResult {
  const I = Math.max(HH_LIMITS.currentUaCm2[0], Math.min(HH_LIMITS.currentUaCm2[1], Number.isFinite(p.currentUaCm2) ? p.currentUaCm2 : 0));
  const T = Math.max(HH_LIMITS.durationMs[0], Math.min(HH_LIMITS.durationMs[1], Number.isFinite(p.durationMs) ? p.durationMs : 100));
  const steps = Math.round(T / DT), nOut = Math.floor(steps / OUT_EVERY) + 1;
  const out = {
    v: new Float32Array(nOut), m: new Float32Array(nOut), h: new Float32Array(nOut), n: new Float32Array(nOut),
    iNa: new Float32Array(nOut), iK: new Float32Array(nOut), iInj: new Float32Array(nOut), dvdt: new Float32Array(nOut),
  };
  const inj = (t: number) => (t >= p.onMs && t < p.offMs ? I : 0);
  const f = (t: number, v: number, m: number, h: number, n: number): [number, number, number, number] => {
    const r = rates(v);
    const iNa = HH.gNa * m * m * m * h * (v - HH.ENa), iK = HH.gK * n * n * n * n * (v - HH.EK), iL = HH.gL * (v - HH.EL);
    return [(inj(t) - iNa - iK - iL) / HH.C, r.am * (1 - m) - r.bm * m, r.ah * (1 - h) - r.bh * h, r.an * (1 - n) - r.bn * n];
  };
  let v: number = HH.rest;
  let { m, h, n } = steady(v);
  const spikesMs: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s * DT;
    const k1 = f(t, v, m, h, n);
    if (s % OUT_EVERY === 0) {
      const o = s / OUT_EVERY;
      out.v[o] = v; out.m[o] = m; out.h[o] = h; out.n[o] = n;
      out.iNa[o] = HH.gNa * m * m * m * h * (v - HH.ENa); out.iK[o] = HH.gK * n * n * n * n * (v - HH.EK);
      out.iInj[o] = inj(t); out.dvdt[o] = k1[0];
    }
    if (s === steps) break;
    const k2 = f(t + DT / 2, v + (DT / 2) * k1[0], m + (DT / 2) * k1[1], h + (DT / 2) * k1[2], n + (DT / 2) * k1[3]);
    const k3 = f(t + DT / 2, v + (DT / 2) * k2[0], m + (DT / 2) * k2[1], h + (DT / 2) * k2[2], n + (DT / 2) * k2[3]);
    const k4 = f(t + DT, v + DT * k3[0], m + DT * k3[1], h + DT * k3[2], n + DT * k3[3]);
    const v1 = v + (DT / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    m += (DT / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    h += (DT / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    n += (DT / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    if (v < 0 && v1 >= 0) spikesMs.push(t + (DT * (0 - v)) / (v1 - v));
    v = v1;
  }
  return { params: { ...p, currentUaCm2: I, durationMs: T }, perMs: 1 / (DT * OUT_EVERY), ...out, spikesMs };
}

/** Linear interpolation of a trace at time tMs. */
export function sampleAt(trace: Float32Array, perMs: number, tMs: number): number {
  const x = Math.max(0, Math.min(trace.length - 1, tMs * perMs));
  const i = Math.floor(x), fr = x - i;
  return i + 1 < trace.length ? trace[i] * (1 - fr) + trace[i + 1] * fr : trace[i];
}

/**
 * True when the neuron is still firing regularly at the end of the current step. Just above threshold the model
 * gives one or two spikes and then settles; that is not "firing at N per second".
 */
export function isSustained(r: HHResult): boolean {
  const s = r.spikesMs.filter((t) => t >= r.params.onMs && t < r.params.offMs);
  if (s.length < 3) return false;
  const lastGap = s[s.length - 1] - s[s.length - 2];
  return r.params.offMs - s[s.length - 1] < 2 * lastGap;
}

/** Mean firing rate over the current step, in spikes per second (0 when fewer than two spikes). */
export function firingRateHz(r: HHResult): number {
  const s = r.spikesMs.filter((t) => t >= r.params.onMs && t < r.params.offMs);
  return s.length < 2 ? 0 : (1000 * (s.length - 1)) / (s[s.length - 1] - s[0]);
}
