// The journey's experiment logic, as plain functions: what a probe beside the circuit records, what exactly differs
// between two runs, why the target cell did or did not reach threshold (from the runs themselves), and a history of
// runs that can be undone. Nothing here knows about a camera, a canvas or a clock.
//
// Three rules it keeps:
//   · a comparison changes only declared causes: `changesBetween` lists every difference between two set-ups, and the
//     two runs are computed by the same deterministic model from the same initial state;
//   · the probe's noise is a function of (seed, sample) only, so a baseline and a changed run have the SAME noise
//     sample by sample — whatever differs between their probe traces was caused by spikes;
//   · every number in an explanation is read from a run (or from a counterfactual run with one input removed), never
//     from where something is drawn.
// Pure module. Unit-tested in tests/world-journey.test.ts.
import { defaultSetup, runWorkshop, workshopCircuit, type WorkshopSetup } from './circuits.ts';
import type { LifRun } from './lif.ts';
import { OBS, ampAtUv, contactTrace, detect, distUm, type Vec3 } from './observe.ts';
import { makeRun, type WorkshopResult } from './workshopRun.ts';

export const PROBE_SEED = 20261125;
export const PROBE_SLOT = 0;

/** A threshold crossing on the probe, with the GENERATOR'S OWN knowledge of what caused it (a recording has no such column). */
export interface ProbeEvent { ms: number; ampUv: number; cell: string | null }
export interface ProbeRecording {
  /** Probe voltage against a distant ground, µV, one sample per model step (20 kHz). */
  trace: Float32Array;
  dtMs: number;
  sigmaUv: number;
  thresholdUv: number;
  events: ProbeEvent[];
  /** Size of each cell's spike at the probe, µV, by the 1/distance rule. */
  ampsUv: Record<string, number>;
}

/** What the probe at `tip` records during a run of the five-cell circuit. A synthetic observation (see model/observe.ts). */
export function probeRecording(run: LifRun, tip: Vec3, seed: number = PROBE_SEED): ProbeRecording {
  const cells = run.circuit.cells, pos = cells.map((c) => c.pos as Vec3);
  const trace = contactTrace({ cells: pos, spikes: run.spikes, placements: [{ atStep: 0, pos: tip }], seed, slot: PROBE_SLOT, fromStep: 0, n: run.nSteps + 1, dtMs: run.dt });
  const events: ProbeEvent[] = detect(trace).map((d) => {
    const ms = d.i * run.dt;
    let cell: string | null = null, best = 0.35;
    cells.forEach((c, i) => { for (const s of run.spikes[i]) { const gap = Math.abs(s - ms); if (gap < best) { best = gap; cell = c.id; } } });
    return { ms, ampUv: d.ampUv, cell };
  });
  return { trace, dtMs: run.dt, sigmaUv: OBS.noiseUv, thresholdUv: OBS.threshK * OBS.noiseUv, events, ampsUv: Object.fromEntries(cells.map((c, i) => [c.id, ampAtUv(distUm(tip, pos[i]))])) };
}

// ── what differs between two set-ups ────────────────────────────────────────────────────────────────────────────
export interface Change { key: string; what: string; from: string; to: string; where: string }
const ms = (v: number | null) => (v == null ? 'off' : `${(+v.toFixed(2)).toString()} ms`);
const tauOf = (gl: number, cm: number) => `${(cm / gl).toFixed(1)} ms`;

/** Every declared cause that differs between two set-ups of the same circuit variant. Empty = the same experiment. */
export function changesBetween(a: WorkshopSetup, b: WorkshopSetup): Change[] {
  const out: Change[] = [];
  if (a.variant !== b.variant) { out.push({ key: 'variant', what: 'Circuit numbers', from: `condition ${a.variant}`, to: `condition ${b.variant}`, where: 'the whole circuit' }); return out; }
  const c = workshopCircuit(a.variant), T = c.cells.find((x) => x.id === 'T')!;
  if (a.aMs !== b.aMs) out.push({ key: 'aMs', what: 'When input A fires', from: ms(a.aMs), to: ms(b.aMs), where: 'A' });
  if (a.bMs !== b.bMs) out.push({ key: 'bMs', what: 'When input B fires', from: ms(a.bMs), to: ms(b.bMs), where: 'B' });
  for (const k of c.conns) {
    const on = (s: WorkshopSetup) => s.conn[k.id] ?? k.enabled !== false;
    if (on(a) !== on(b)) out.push({ key: `conn:${k.id}`, what: `Connection ${k.from} → ${k.to}`, from: on(a) ? 'connected' : 'disconnected', to: on(b) ? 'connected' : 'disconnected', where: k.id });
  }
  if ((a.glT ?? T.gl) !== (b.glT ?? T.gl)) out.push({ key: 'glT', what: 'T’s membrane time constant', from: tauOf(a.glT ?? T.gl, T.cm), to: tauOf(b.glT ?? T.gl, T.cm), where: 'T' });
  const ex = (s: WorkshopSetup) => s.extra.map((e) => `${e.input}@${e.ms}`).join(',');
  if (ex(a) !== ex(b)) out.push({ key: 'extra', what: 'Extra input pulses', from: `${a.extra.length}`, to: `${b.extra.length}`, where: 'A/B' });
  return out;
}

// ── why the target did or did not fire ──────────────────────────────────────────────────────────────────────────
export interface Why {
  /** The moment the explanation is about: T's spike, or (if it did not fire) the moment it came closest. */
  atMs: number;
  fired: boolean;
  restMv: number; thresholdMv: number;
  /** T's membrane potential at that moment in the run itself (just before the spike, when there was one). */
  vMv: number;
  /** What each input path adds at that moment, mV: from a run with ONLY that input. A's path includes whatever A triggers through I. */
  fromA: number; fromB: number;
  /** The largest lift each path gives on its own, and when. */
  peakA: { mv: number; ms: number }; peakB: { mv: number; ms: number };
  /** vMv − (rest + fromA + fromB): zero while T has not fired (the sub-threshold model is linear). */
  residualMv: number;
  shortMv: number;
}

const tIndex = (r: LifRun) => r.circuit.cells.findIndex((x) => x.id === 'T');
function peakOf(v: ArrayLike<number>, rest: number, dt: number): { mv: number; ms: number } {
  let m = -Infinity, at = 0;
  for (let i = 0; i < v.length; i++) if (v[i] - rest > m) { m = v[i] - rest; at = i; }
  return { mv: m, ms: at * dt };
}

/** One-input counterfactual of a set-up: the same circuit and connections with only input A, or only input B. */
export const onlyInput = (s: WorkshopSetup, keep: 'A' | 'B'): WorkshopSetup => ({ ...s, aMs: keep === 'A' ? s.aMs : null, bMs: keep === 'B' ? s.bMs : null, extra: s.extra.filter((e) => e.input === (keep === 'A' ? 'inA' : 'inB')) });

/** The component traces used to explain a run: T's potential with only A's input, and with only B's. */
export function components(setup: WorkshopSetup): { a: LifRun; b: LifRun } {
  return { a: runWorkshop(onlyInput(setup, 'A')), b: runWorkshop(onlyInput(setup, 'B')) };
}

export function whyTarget(result: WorkshopResult, comp: { a: LifRun; b: LifRun } = components(result.recipe.parameters)): Why {
  const r = result.run, t = tIndex(r), cell = r.circuit.cells[t], rest = cell.el, thr = r.final.vth[t], v = r.v[t], dt = r.dt;
  const fired = result.firedMs != null;
  // the grid point just before the spike (the spike resets the potential), or the highest point of the run
  let k = 0;
  if (fired) k = Math.max(0, Math.floor(result.firedMs! / dt - 1e-9));
  else { let m = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > m) { m = v[i]; k = i; } }
  const fromA = comp.a.v[t][k] - rest, fromB = comp.b.v[t][k] - rest;
  return {
    atMs: fired ? result.firedMs! : k * dt, fired, restMv: rest, thresholdMv: thr, vMv: v[k], fromA, fromB,
    peakA: peakOf(comp.a.v[t], rest, dt), peakB: peakOf(comp.b.v[t], rest, dt), residualMv: v[k] - (rest + fromA + fromB), shortMv: fired ? 0 : thr - v[k],
  };
}

const f1 = (v: number) => v.toFixed(1).replace('-', '−');
/** What the run showed, in its own numbers. */
export function outcomeSentence(r: WorkshopResult): string {
  const gap = r.gapMs, how = gap == null ? 'With one input only' : gap === 0 ? 'A and B together' : `B ${f1(Math.abs(gap))} ms ${gap > 0 ? 'after' : 'before'} A`;
  return r.firedMs != null
    ? `${how}: T reached threshold and fired at ${f1(r.firedMs)} ms${r.followerMs != null ? `; D followed at ${f1(r.followerMs)} ms` : ''}.`
    : `${how}: T peaked at ${f1(r.peakMv)} mV, ${f1(r.thresholdMv - r.peakMv)} mV short of its ${f1(r.thresholdMv)} mV threshold. It did not fire.`;
}
/** The explanation of that outcome, from the run and its two one-input counterfactuals. */
export function whySentence(w: Why): string {
  const a = Math.max(0, w.fromA), b = Math.max(0, w.fromB), inh = w.fromA < -0.05;
  const parts = `A’s input ${inh ? `pulls T ${f1(-w.fromA)} mV down (through the inhibitory cell I)` : `adds ${f1(a)} mV`} and B’s adds ${f1(b)} mV at ${f1(w.atMs)} ms`;
  if (w.fired) return `${parts}: together they carry T from ${f1(w.restMv)} mV across its ${f1(w.thresholdMv)} mV threshold.`;
  const faded = w.peakA.mv - a > 0.5 && w.peakA.ms < w.atMs ? ` A’s input had peaked at ${f1(w.peakA.mv)} mV, ${f1(w.atMs - w.peakA.ms)} ms earlier, and has leaked away since.` : w.peakB.mv - b > 0.5 && w.peakB.ms < w.atMs ? ` B’s input had peaked at ${f1(w.peakB.mv)} mV, ${f1(w.atMs - w.peakB.ms)} ms earlier, and has leaked away since.` : '';
  return `${parts}: ${f1(w.restMv)} + ${f1(w.fromA + w.fromB)} = ${f1(w.vMv)} mV, ${f1(w.shortMv)} mV short of threshold.${faded}`;
}
/** What the probe saw, in one sentence. */
export function probeSentence(p: ProbeRecording): string {
  const big = p.events.filter((e) => e.cell === 'T'), small = p.events.length - big.length;
  const thr = `−${p.thresholdUv.toFixed(0)} µV`;
  if (!p.events.length) return `The probe counted nothing: no deflection crossed its ${thr} threshold. The other cells’ spikes are there, but only ${Math.max(...Object.entries(p.ampsUv).filter(([k]) => k !== 'T').map(([, v]) => v)).toFixed(0)} µV or less at this distance.`;
  const t = big.length ? `T’s spike, ${big[0].ampUv.toFixed(0)} µV at ${f1(big[0].ms)} ms` : '';
  return `The probe counted ${p.events.length} threshold crossing${p.events.length === 1 ? '' : 's'}${t ? `: ${t}` : ''}${small ? `${t ? ', and ' : ': '}${small} small one${small === 1 ? '' : 's'} near the ${thr} threshold` : ''}. A decoder is given counts like this — not which cell fired.`;
}

// ── a history of runs that can be undone ────────────────────────────────────────────────────────────────────────
export interface HistoryEntry { n: number; setup: WorkshopSetup; digest: string; fired: boolean; label: string }
export interface Lab {
  setup: WorkshopSetup;
  result: WorkshopResult;
  /** The run everything is compared with. It changes only when the player says so. */
  baseline: WorkshopResult;
  history: HistoryEntry[];
}

const copy = (s: WorkshopSetup): WorkshopSetup => ({ ...s, conn: { ...s.conn }, extra: s.extra.map((e) => ({ ...e })) });
const entry = (n: number, r: WorkshopResult, label: string): HistoryEntry => ({ n, setup: copy(r.recipe.parameters), digest: r.digest, fired: r.firedMs != null, label });

/** A fresh experiment: the circuit as found, which is also the baseline. */
export function newLab(variant = 0): Lab {
  const setup = defaultSetup(variant), result = makeRun(setup);
  return { setup, result, baseline: result, history: [entry(1, result, 'The circuit as you found it')] };
}
/** Apply a change of causes: a new run whose parent is the current one. No-op when nothing would change. */
export function applyChange(lab: Lab, patch: Partial<WorkshopSetup>): Lab {
  const setup = copy({ ...lab.setup, ...patch }), ch = changesBetween(lab.setup, setup);
  if (!ch.length) return lab;
  const result = makeRun(setup, lab.result.recipe.runId), label = ch.map((c) => `${c.what}: ${c.from} → ${c.to}`).join('; ');
  return { ...lab, setup, result, history: [...lab.history, entry(lab.history.length + 1, result, label)].slice(-60) };
}
/** Step back one change. The run is computed again from its set-up, and must end in the same state (the digest says so). */
export function undo(lab: Lab): Lab {
  if (lab.history.length < 2) return lab;
  const history = lab.history.slice(0, -1), prev = history[history.length - 1], result = makeRun(copy(prev.setup));
  return { ...lab, setup: copy(prev.setup), result, history };
}
/** Go back to the baseline's causes (as a new entry, so that this too can be undone). */
export function toBaseline(lab: Lab): Lab { return applyChange(lab, copy(lab.baseline.recipe.parameters)); }
/** Make the current run the one that later runs are compared with. */
export const keepAsBaseline = (lab: Lab): Lab => ({ ...lab, baseline: lab.result });

/** One line that says what was changed against the baseline and what that did, or that nothing differs. */
export function compareSentence(lab: Lab): string {
  const ch = changesBetween(lab.baseline.recipe.parameters, lab.setup);
  if (!ch.length) return 'This is the baseline run.';
  const b = lab.baseline, c = lab.result, was = b.firedMs != null ? `fired at ${f1(b.firedMs)} ms` : `stayed ${f1(b.thresholdMv - b.peakMv)} mV short`;
  const now = c.firedMs != null ? `fires at ${f1(c.firedMs)} ms` : `stays ${f1(c.thresholdMv - c.peakMv)} mV short`;
  return `Changed against the baseline: ${ch.map((x) => `${x.what.toLowerCase()} (${x.from} → ${x.to})`).join('; ')}. T ${was}; now it ${now}.`;
}
