// The two LIF circuits of the toys. Every number is a MODEL PARAMETER chosen to make a mechanism visible; none is a
// measurement of a real cell or synapse. Positions are scene coordinates in µm.
//
//   workshop   five cells for the Time workshop: two input cells (A, B) converge on a target (T); A also drives an
//              inhibitory cell (I) whose connection onto T can be switched; T drives a follower (D).
//   field      ten cells for Instrument flight: one cell fires regularly and drives a wave through some of the others;
//              the rest fire irregularly on background input. Which cell leads depends on the seed.
//
// Pure module. Unit-tested in tests/world-lif.test.ts.
import { LIF_DT_MS, LIF_LIMITS, LIF_REVISION, hash3, simulate, type LifCellDef, type LifCircuit, type LifCommand, type LifConnDef, type LifRun } from './lif.ts';

const BASE = { cm: 0.25, gl: 1 / 60, el: -70, vth: -54, vreset: -70, trefMs: 2, tauE: 2, tauI: 4 } as const;
const cell = (id: string, label: string, kind: 'exc' | 'inh', pos: [number, number, number], over: Partial<LifCellDef> = {}): LifCellDef => ({ id, label, kind, pos, ...BASE, ...over });

/** A value in [lo, hi] that depends only on (seed, slot). */
export const pick = (seed: number, slot: number, lo: number, hi: number) => lo + ((hi - lo) * hash3(seed, slot, 0x51ed)) / 4294967296;

export const WORKSHOP_MS = 60;
export const WORKSHOP_DEFAULT = { aMs: 10, bMs: 22 } as const;

function buildWorkshop(v: number, attempt: number): LifCircuit {
  const key = v === 0 ? 0 : hash3(v, attempt, 0x77) || 1;
  const f = (slot: number, lo: number, hi: number, ref: number) => (v === 0 ? ref : pick(key, slot, lo, hi));
  const glT = f(1, 1 / 85, 1 / 42, 1 / 60);
  const cells: LifCellDef[] = [
    cell('A', 'Input cell A', 'exc', [-118, 34, 46]),
    cell('B', 'Input cell B', 'exc', [-96, -62, -52]),
    cell('I', 'Inhibitory cell I', 'inh', [-14, 86, -38], { cm: 0.15, gl: 1 / 40, trefMs: 1.5 }),
    cell('T', 'Target cell T', 'exc', [44, 0, 0], { gl: glT }),
    cell('D', 'Follower cell D', 'exc', [168, -26, 30]),
  ];
  const conns: LifConnDef[] = [
    { id: 'A>T', from: 'A', to: 'T', w: f(2, 1.45, 2.0, 1.7), delayMs: 1.5 },
    { id: 'B>T', from: 'B', to: 'T', w: f(3, 1.45, 2.0, 1.7), delayMs: 1.5 },
    { id: 'A>I', from: 'A', to: 'I', w: 3.2, delayMs: 0.5 },
    { id: 'I>T', from: 'I', to: 'T', w: -f(4, 0.9, 1.5, 1.2), delayMs: Math.round(f(5, 1.0, 2.6, 1.6) * 20) / 20, enabled: false },
    { id: 'T>D', from: 'T', to: 'D', w: 4.2, delayMs: 2 },
  ];
  return {
    id: 'workshop', revision: `${LIF_REVISION}/workshop-1`, dt: LIF_DT_MS, seed: v, cells, conns,
    // one pulse on an input cell is enough to make it fire once, a little under a millisecond later
    inputs: [{ id: 'inA', label: 'Stimulus on A', to: 'A', w: 6 }, { id: 'inB', label: 'Stimulus on B', to: 'B', w: 6 }],
  };
}

/** What the player controls in the Time workshop. Times are in ms from the start of the run; null = no pulse. */
export interface WorkshopSetup {
  variant: number;
  aMs: number | null;
  bMs: number | null;
  /** Connections switched away from the circuit's own defaults. */
  conn: Record<string, boolean>;
  /** Leak conductance of the target cell, µS (null = the circuit's own). */
  glT: number | null;
  /** Extra pulses added while paused ("pulse now"). */
  extra: Array<{ input: 'inA' | 'inB'; ms: number }>;
}
export const defaultSetup = (variant = 0): WorkshopSetup => ({ variant, aMs: WORKSHOP_DEFAULT.aMs, bMs: WORKSHOP_DEFAULT.bMs, conn: {}, glT: null, extra: [] });

/** The command list that a setup stands for (every cause the player set, as timestamped commands). */
export function workshopCommands(c: LifCircuit, setup: WorkshopSetup): LifCommand[] {
  const st = (ms: number) => Math.max(0, Math.round(ms / c.dt));
  const out: LifCommand[] = [];
  let seq = 0;
  for (const k of c.conns) if (k.id in setup.conn) out.push({ seq: seq++, atStep: 0, kind: 'connection', target: k.id, value: setup.conn[k.id] ? 1 : 0 });
  if (setup.glT != null) out.push({ seq: seq++, atStep: 0, kind: 'cell-gl', target: 'T', value: Math.max(LIF_LIMITS.gl[0], Math.min(LIF_LIMITS.gl[1], setup.glT)) });
  if (setup.aMs != null) out.push({ seq: seq++, atStep: st(setup.aMs), kind: 'pulse', target: 'inA', value: 1 });
  if (setup.bMs != null) out.push({ seq: seq++, atStep: st(setup.bMs), kind: 'pulse', target: 'inB', value: 1 });
  for (const e of setup.extra) out.push({ seq: seq++, atStep: st(e.ms), kind: 'pulse', target: e.input, value: 1 });
  return out;
}
export const runWorkshop = (setup: WorkshopSetup, c: LifCircuit = workshopCircuit(setup.variant)): LifRun =>
  simulate(c, workshopCommands(c, setup), Math.round(WORKSHOP_MS / c.dt), { checkpointEvery: 100 });

/**
 * For which gaps (B − A, ms) does the target fire? Found by running the model at every `resMs` from −20 to +20 with A
 * at 25 ms. Returns the lowest and highest firing gap, or null when the target never fires.
 */
export function firingWindow(setup: WorkshopSetup, c: LifCircuit = workshopCircuit(setup.variant), resMs = 0.25): { lo: number; hi: number } | null {
  const t = c.cells.findIndex((x) => x.id === 'T');
  let lo = NaN, hi = NaN;
  for (let g = -20; g <= 20; g += resMs) {
    if (!runWorkshop({ ...setup, aMs: 25, bMs: 25 + g, extra: [] }, c).spikes[t].length) continue;
    if (Number.isNaN(lo)) lo = g;
    hi = g;
  }
  return Number.isNaN(lo) ? null : { lo, hi };
}

const workshopCache = new Map<number, LifCircuit>();
/**
 * The Time-workshop circuit. `variant` 0 is the reference. Any other number changes the target cell's leak, the two
 * input weights and the inhibitory path within stated bounds, so that what was learned has to be tried on new numbers.
 * Variants are kept only if the task stays possible: the target can fire with the inhibitory connection on.
 */
export function workshopCircuit(variant = 0): LifCircuit {
  const v = variant >>> 0, hit = workshopCache.get(v);
  if (hit) return hit;
  let c = buildWorkshop(v, 0);
  if (v !== 0) {
    for (let attempt = 0; attempt < 32; attempt++) {
      c = buildWorkshop(v, attempt);
      const s = defaultSetup(v), open = firingWindow(s, c, 1), shut = firingWindow({ ...s, conn: { 'I>T': true } }, c, 0.5);
      if (open && shut && open.hi - open.lo >= 6 && shut.hi - shut.lo >= 1.5 && shut.hi - shut.lo < open.hi - open.lo) break;
      if (attempt === 31) c = buildWorkshop(0, 0);
    }
  }
  workshopCache.set(v, c);
  return c;
}

export const FIELD_CELLS = 10;
const FIELD_POS: Array<[number, number, number]> = [
  [-190, 40, 60], [-120, -70, -40], [-60, 80, -80], [-20, -20, 70], [40, 60, 10],
  [70, -80, -60], [130, 10, 80], [170, 90, -30], [210, -50, 20], [10, -120, -10],
];

export interface FieldTruth { driver: number; followers: number[]; independents: number[] }

/**
 * The Instrument-flight field. One cell (the driver) has a constant supra-threshold current and so fires regularly;
 * its spikes spread through a seeded tree of strong excitatory connections; three cells take no part and fire
 * irregularly. Returns the circuit and the generator's own truth about it (never shown until the player asks).
 */
export function fieldCircuit(seed: number): { circuit: LifCircuit; truth: FieldTruth } {
  const s = (seed >>> 0) || 1;
  // a seeded order of the ten cells: first the driver, then six followers, then three independents
  const order = Array.from({ length: FIELD_CELLS }, (_, i) => i);
  for (let i = FIELD_CELLS - 1; i > 0; i--) { const j = hash3(s, i, 0xf1e1d) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const driver = order[0], followers = order.slice(1, 7), independents = order.slice(7);
  const cells: LifCellDef[] = FIELD_POS.map((pos, i) => {
    const kind = 'exc' as const, label = `Cell ${i + 1}`;
    if (i === driver) return cell(`c${i + 1}`, label, kind, pos, { ibias: pick(s, 40, 0.3, 0.34), gl: 1 / 60 });
    if (independents.includes(i)) return cell(`c${i + 1}`, label, kind, pos, { bgRateHz: pick(s, 50 + i, 190, 250), bgW: 0.62, gl: 1 / pick(s, 60 + i, 45, 70) });
    return cell(`c${i + 1}`, label, kind, pos, { gl: 1 / pick(s, 70 + i, 45, 70) });
  });
  // tree: followers 0–2 hang on the driver, 3–5 on one of the first three
  const conns: LifConnDef[] = followers.map((to, k) => {
    const from = k < 3 ? driver : followers[hash3(s, k, 0xb0b) % 3];
    return { id: `c${from + 1}>c${to + 1}`, from: `c${from + 1}`, to: `c${to + 1}`, w: 4.4, delayMs: Math.round(pick(s, 80 + k, 1.2, 4.2) * 20) / 20 };
  });
  return { circuit: { id: 'field', revision: `${LIF_REVISION}/field-1`, dt: LIF_DT_MS, seed: s, cells, conns, inputs: [] }, truth: { driver, followers, independents } };
}
