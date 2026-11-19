// The schematic patch of cortex in the Neurons scene, and what one electrode contact picks up from it.
//
// Everything here is a TEACHING MODEL, stated as such in the UI:
//   • the cell positions and shapes are invented (seeded) — the atlas has no cellular data;
//   • the nearest neuron's membrane potential comes from the Hodgkin–Huxley model (model/hh.ts);
//   • the contact's voltage is  Σ units  amplitude(distance) × shape(t − spike time)  + seeded noise, with
//     amplitude = 120 µV × (30 µm / distance)  (the same stated rule the Signal scene uses) and, for the nearest
//     neuron, a shape proportional to −dV/dt of its own membrane potential;
//   • background neurons fire at fixed seeded times.
// Pure module: no DOM, no three.js. Unit-tested in tests/hh.test.ts.
import { extracellularTemplate, mulberry32 } from '../../journey/model/chain.ts';
import { simulateHH, type HHResult } from './hh.ts';

export const REF_AMP_UV = 120;
export const REF_DIST_UM = 30;
export const NOISE_RMS_UV = 6;
export const DISTANCE_LIMITS_UM: [number, number] = [20, 200];
/** Speed used to draw a spike travelling down the axon (illustrative; unmyelinated cortical axons conduct at well under 1 m/s). */
export const AXON_SPEED_UM_PER_MS = 400;

/** Peak size of a unit's spike at the contact, µV, by the lesson's 1 / distance rule. */
export const amplitudeUv = (distanceUm: number) => (REF_AMP_UV * REF_DIST_UM) / Math.max(1, distanceUm);

export interface Cell {
  id: number;
  /** Soma position, µm. x right, y up (towards the pial surface), z towards the viewer. */
  soma: [number, number, number];
  /** Soma radius, µm. */
  radius: number;
  /** Tip of the apical dendrite. */
  apex: [number, number, number];
  /** Basal dendrite tips. */
  basal: Array<[number, number, number]>;
  /** Points of the axon, from the soma downwards. */
  axon: Array<[number, number, number]>;
  /** Spike times in ms (background cells only; the focus cell's come from the membrane model). */
  spikesMs: number[];
}

export interface ColumnParams {
  currentUaCm2: number;
  /** Distance from the focus neuron's soma to the electrode contact, µm. */
  distanceUm: number;
  durationMs: number;
}
export const DEFAULT_COLUMN: ColumnParams = { currentUaCm2: 10, distanceUm: 60, durationMs: 120 };

export interface ColumnResult {
  params: ColumnParams;
  hh: HHResult;
  cells: Cell[];
  /** Position of the contact, µm (it moves along +x from the focus soma). */
  contact: [number, number, number];
  /** Distance of every cell's soma from the contact, µm. */
  distancesUm: number[];
  perMs: number;
  /** What the contact records, µV: all units plus noise. */
  electrodeUv: Float32Array;
  /** The nearest neuron's share alone, µV. */
  focusUv: Float32Array;
  /** The noise share alone, µV (seeded Gaussian, fixed rms). */
  noiseUv: Float32Array;
  focusAmplitudeUv: number;
  /** focusAmplitude / noise rms. */
  snr: number;
}

const SEED = 20261119;

/** Fixed layout: cell 0 is the focus neuron at the origin; the rest are scattered around it. */
export function layoutCells(durationMs: number): Cell[] {
  const rnd = mulberry32(SEED);
  const cells: Cell[] = [];
  const spots: Array<[number, number, number]> = [
    [0, 0, 0], [-150, 60, -60], [170, -40, -90], [-70, -120, 80], [120, 110, 70], [-210, -60, 40], [60, 190, -110], [230, 80, 20], [-120, 170, 110], [20, -200, -70],
  ];
  spots.forEach((s, id) => {
    const jitter = (a: number) => (id === 0 ? 0 : (rnd() - 0.5) * a);
    const soma: [number, number, number] = [s[0] + jitter(30), s[1] + jitter(30), s[2] + jitter(30)];
    const radius = id === 0 ? 11 : 8 + rnd() * 3;
    const apex: [number, number, number] = [soma[0] + (rnd() - 0.5) * 30, soma[1] + 240 + rnd() * 80, soma[2] + (rnd() - 0.5) * 30];
    const basal: Array<[number, number, number]> = [];
    const nb = 4 + Math.floor(rnd() * 2);
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + rnd() * 0.8, len = 60 + rnd() * 50;
      basal.push([soma[0] + Math.cos(a) * len, soma[1] - 20 - rnd() * 45, soma[2] + Math.sin(a) * len]);
    }
    const axon: Array<[number, number, number]> = [[soma[0], soma[1] - radius, soma[2]]];
    let x = soma[0], z = soma[2];
    for (let k = 1; k <= 6; k++) { x += (rnd() - 0.5) * 22; z += (rnd() - 0.5) * 22; axon.push([x, soma[1] - radius - k * 55, z]); }
    // background cells: a few fixed, irregular spike times
    const spikesMs: number[] = [];
    if (id > 0) {
      const rate = 6 + rnd() * 16;                // spikes per second
      let t = rnd() * 60;
      while (t < durationMs) { spikesMs.push(t); t += Math.max(3, -Math.log(1 - rnd()) * (1000 / rate)); }
    }
    cells.push({ id, soma, radius, apex, basal, axon, spikesMs });
  });
  return cells;
}

/** The whole scene for one set of parameters. Deterministic. */
export function buildColumn(p: ColumnParams): ColumnResult {
  const distanceUm = Math.max(DISTANCE_LIMITS_UM[0], Math.min(DISTANCE_LIMITS_UM[1], Number.isFinite(p.distanceUm) ? p.distanceUm : DEFAULT_COLUMN.distanceUm));
  const hh = simulateHH({ currentUaCm2: p.currentUaCm2, onMs: 10, offMs: p.durationMs - 15, durationMs: p.durationMs });
  const durationMs = hh.params.durationMs;
  const cells = layoutCells(durationMs);
  const contact: [number, number, number] = [distanceUm, 0, 0];
  const distancesUm = cells.map((c) => Math.hypot(c.soma[0] - contact[0], c.soma[1] - contact[1], c.soma[2] - contact[2]));
  const n = hh.v.length, perMs = hh.perMs;
  const focusUv = new Float32Array(n), electrodeUv = new Float32Array(n), noiseUv = new Float32Array(n);
  // nearest neuron: shape ∝ −dV/dt, scaled so that its largest downward deflection equals the rule's amplitude
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, hh.dvdt[i]);
  const focusAmplitudeUv = amplitudeUv(distanceUm);
  if (peak > 20) for (let i = 0; i < n; i++) focusUv[i] = (-hh.dvdt[i] / peak) * focusAmplitudeUv;
  electrodeUv.set(focusUv);
  // background neurons: the Signal scene's spike template at their own distance
  for (const c of cells) {
    if (c.id === 0) continue;
    const amp = amplitudeUv(distancesUm[c.id]);
    for (const ts of c.spikesMs) {
      const i0 = Math.max(0, Math.floor((ts - 0.6) * perMs)), i1 = Math.min(n - 1, Math.ceil((ts + 1.6) * perMs));
      for (let i = i0; i <= i1; i++) electrodeUv[i] += amp * extracellularTemplate(i / perMs - ts);
    }
  }
  // noise: fixed seed, so the trace is the same every time
  const rnd = mulberry32(SEED ^ 0x9e3779b9);
  for (let i = 0; i < n; i++) {
    let u = 0; while (u === 0) u = rnd();
    noiseUv[i] = NOISE_RMS_UV * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    electrodeUv[i] += noiseUv[i];
  }
  return { params: { ...p, distanceUm, durationMs, currentUaCm2: hh.params.currentUaCm2 }, hh, cells, contact, distancesUm, perMs, electrodeUv, focusUv, noiseUv, focusAmplitudeUv, snr: focusAmplitudeUv / NOISE_RMS_UV };
}

/** How far along its axon (0 = soma, 1 = end) each spike of a cell has travelled at time tMs; only pulses still on the axon. */
export function axonPulses(spikesMs: readonly number[], axonLengthUm: number, tMs: number): number[] {
  const out: number[] = [];
  for (const ts of spikesMs) {
    const d = (tMs - ts) * AXON_SPEED_UM_PER_MS;
    if (d >= 0 && d <= axonLengthUm) out.push(d / axonLengthUm);
  }
  return out;
}
