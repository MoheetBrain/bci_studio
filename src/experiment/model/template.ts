// One action potential from the Hodgkin–Huxley model, used as the shape of every simulated spike.
//
//   vmMv  membrane potential relative to rest, mV — what an intracellular electrode would see (in this model);
//   ec    extracellular shape, unit negative peak — taken as −(dV/dt − I_inj / C): the negative time-derivative of the
//         membrane potential with the test pulse's own contribution removed. This is the same teaching rule the Neurons
//         scene states. A real extracellular spike depends on the cell's geometry, which is not modelled.
// Time zero is the moment the brief test pulse begins; the upstroke follows about a millisecond later.
import { HH, simulateHH } from '../../neuro/model/hh.ts';

export interface SpikeTemplate {
  /** Samples per second of both arrays. */
  fs: number;
  vmMv: Float32Array;
  ec: Float32Array;
  /** Index of the extracellular negative peak. */
  ecPeak: number;
  /** Time of the membrane potential's upward zero crossing, ms after time zero. */
  crossMs: number;
}

const cache = new Map<number, SpikeTemplate>();

export function spikeTemplate(fs: number): SpikeTemplate {
  const hit = cache.get(fs);
  if (hit) return hit;
  const on = 1, off = 1.5;
  const r = simulateHH({ currentUaCm2: 30, onMs: on, offMs: off, durationMs: 20 });
  if (r.spikesMs.length !== 1) throw new Error(`spike template: expected one action potential, got ${r.spikesMs.length}`);
  const at = (a: Float32Array, tMs: number) => {
    const x = Math.max(0, Math.min(a.length - 1, tMs * r.perMs)), i = Math.floor(x), f = x - i;
    return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i];
  };
  const nVm = Math.round(0.014 * fs), nEc = Math.round(0.0045 * fs);
  const vmMv = new Float32Array(nVm), ec = new Float32Array(nEc);
  for (let i = 0; i < nVm; i++) vmMv[i] = at(r.v, on + (i / fs) * 1000) - HH.rest;
  let peak = 0, ecPeak = 0;
  for (let i = 0; i < nEc; i++) {
    const t = on + (i / fs) * 1000;
    const d = at(r.dvdt, t) - at(r.iInj, t) / HH.C;
    ec[i] = -d;
    if (d > peak) { peak = d; ecPeak = i; }
  }
  for (let i = 0; i < nEc; i++) ec[i] /= peak;
  // fade the tail to zero so that adding templates never leaves a step
  for (let i = 0; i < 6 && i < nEc; i++) ec[nEc - 1 - i] *= i / 6;
  const t: SpikeTemplate = { fs, vmMv, ec, ecPeak, crossMs: r.spikesMs[0] - on };
  cache.set(fs, t);
  return t;
}
