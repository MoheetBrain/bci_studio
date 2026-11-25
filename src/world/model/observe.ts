// What a virtual recording contact "hears" in the Instrument-flight field.
//
// SYNTHETIC OBSERVATION MODEL — a declared generator, not a volume-conductor calculation and not a recording:
//
//     y(t) = Σ_i a_i · Σ_j h(t − t_ij) + n(t)
//
//   t_ij   spike times of model cell i (events of the LIF circuit);
//   h      one fixed waveform with a unit negative peak, placed so that the peak falls on the spike time. It is the
//          studio's existing teaching template (the negative time-derivative of one Hodgkin–Huxley action potential);
//   a_i    120 µV × 30 µm / max(d_i, 15 µm), with d_i the distance from the contact to the cell's soma in scene µm.
//          The 15 µm floor only avoids a singularity; it is not a claim about what happens next to a real contact;
//   n      white Gaussian noise, 6 µV rms, a counter-based function of (seed, contact, sample) — so a stretch of
//          recording is the same whenever and in whatever order it is asked for.
//
// The contact is referenced to an ideal distant ground (no reference electrode is modelled). Moving the CAMERA never
// enters this file: only a contact position, which changes through an explicit "place contact" command.
//
// Pure module. Unit-tested in tests/world-lif.test.ts.
import { spikeTemplate } from '../../experiment/model/template.ts';
import { hash3 } from './lif.ts';

export const OBS = { fsHz: 20000, refAmpUv: 120, refDistUm: 30, minDistUm: 15, noiseUv: 6, threshK: 4.5, deadMs: 1 } as const;

export type Vec3 = [number, number, number];
export const distUm = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Size of a cell's spike at a contact, µV (negative peak), for a soma-to-contact distance in µm. */
export const ampAtUv = (dUm: number) => (OBS.refAmpUv * OBS.refDistUm) / Math.max(OBS.minDistUm, dUm);

/** Standard normal noise sample number k of a contact. */
export function noiseAt(seed: number, slot: number, k: number): number {
  const u1 = (hash3(seed, slot * 2 + 1, k) + 1) / 4294967297, u2 = hash3(seed, slot * 2 + 2, k) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Where a contact was from a given model step on. */
export interface Placement { atStep: number; pos: Vec3 }
/** The placement in force at a step (the last one at or before it), or null if the contact has not been placed. */
export function placementAt(list: readonly Placement[], step: number): Placement | null {
  let hit: Placement | null = null;
  for (const p of list) { if (p.atStep <= step) hit = p; else break; }
  return hit;
}

export interface TraceArgs {
  /** Soma positions, µm. */
  cells: readonly Vec3[];
  /** Spike times per cell, ms, ascending. */
  spikes: readonly (readonly number[])[];
  placements: readonly Placement[];
  seed: number;
  slot: number;
  /** First sample (= model step) and number of samples. */
  fromStep: number;
  n: number;
  dtMs: number;
  /** Leave the noise out (to show the generator's own contributions). */
  noNoise?: boolean;
  /** Keep only this cell's contribution. */
  only?: number;
}

/** The contact voltage over a stretch of model time, µV. Zero before the contact was first placed. */
export function contactTrace(a: TraceArgs): Float32Array {
  const out = new Float32Array(a.n), tmpl = spikeTemplate(OBS.fsHz), L = tmpl.ec.length, pk = tmpl.ecPeak;
  const first = a.placements[0]?.atStep ?? Infinity;
  if (!a.noNoise) for (let i = 0; i < a.n; i++) { const k = a.fromStep + i; if (k >= first) out[i] = OBS.noiseUv * noiseAt(a.seed, a.slot, k); }
  const t0 = a.fromStep * a.dtMs, t1 = (a.fromStep + a.n) * a.dtMs, pad = (L * 1000) / OBS.fsHz;
  for (let c = 0; c < a.cells.length; c++) {
    if (a.only != null && a.only !== c) continue;
    for (const t of a.spikes[c]) {
      if (t < t0 - pad) continue;
      if (t > t1 + pad) break;
      const at = Math.round(t / a.dtMs), p = placementAt(a.placements, at);
      if (!p) continue;
      const amp = ampAtUv(distUm(p.pos, a.cells[c])), o = at - pk - a.fromStep;
      for (let j = Math.max(0, -o); j < L && o + j < a.n; j++) out[o + j] += amp * tmpl.ec[j];
    }
  }
  return out;
}

export interface Detected { /** Sample index of the trough. */ i: number; /** Trough depth, µV (positive number). */ ampUv: number }
/**
 * Threshold detection on a stretch of trace: a downward crossing of −K·σ starts an event; its size is the deepest
 * point within the next 0.6 ms; nothing else is detected for 1 ms. An INFERENCE — it can miss, merge or invent events.
 */
export function detect(trace: Float32Array, sigmaUv: number = OBS.noiseUv, k: number = OBS.threshK): Detected[] {
  const thr = -k * sigmaUv, dead = Math.round((OBS.deadMs / 1000) * OBS.fsHz), look = Math.round(0.0006 * OBS.fsHz), out: Detected[] = [];
  for (let i = 1; i < trace.length; i++) {
    if (!(trace[i] < thr && trace[i - 1] >= thr)) continue;
    let m = i;
    for (let j = i; j < Math.min(trace.length, i + look); j++) if (trace[j] < trace[m]) m = j;
    out.push({ i: m, ampUv: -trace[m] });
    i += dead;
  }
  return out;
}
