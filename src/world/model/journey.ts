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

/** The two recording contacts the player places. (Not "A" and "B": those are the input cells.) */
export const CONTACT_IDS = ['P1', 'P2'] as const;
export type ContactId = (typeof CONTACT_IDS)[number];
/** Each contact has its own noise stream (slot) under the one observation seed, so that moving one never changes the other's noise. */
export const CONTACT_SLOT: Record<ContactId, number> = { P1: 0, P2: 1 };
/** Where each contact is, in model coordinates (µm; see model/layout.ts) — or null while it has not been placed. */
export interface Contacts { P1: Vec3 | null; P2: Vec3 | null }
export const NO_CONTACTS: Contacts = { P1: null, P2: null };
const sameV = (a: Vec3 | null, b: Vec3 | null) => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
export const sameContacts = (a: Contacts, b: Contacts) => sameV(a.P1, b.P1) && sameV(a.P2, b.P2);
const copyContacts = (c: Contacts): Contacts => ({ P1: c.P1 ? [c.P1[0], c.P1[1], c.P1[2]] : null, P2: c.P2 ? [c.P2[0], c.P2[1], c.P2[2]] : null });

/**
 * A position a contact may take: finite, inside the block, rounded to a tenth of a micrometre (so that a saved layout
 * and a replayed one are the same numbers). Returns null for anything that is not a position.
 */
export function contactPosition(p: readonly number[] | null | undefined, box: { min: readonly number[]; max: readonly number[] }): Vec3 | null {
  if (!p || p.length < 3 || !p.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const q = [0, 1, 2].map((k) => Math.round(Math.max(box.min[k], Math.min(box.max[k], p[k])) * 10) / 10);
  return [q[0], q[1], q[2]];
}
/** Distance from a contact to each cell body, and the size that rule gives each cell's spike there. */
export function contributions(run: LifRun, pos: Vec3): Array<{ cell: string; distUm: number; ampUv: number; spikes: number }> {
  return run.circuit.cells.map((c, i) => { const d = distUm(pos, c.pos as Vec3); return { cell: c.id, distUm: d, ampUv: ampAtUv(d), spikes: run.spikes[i].length }; });
}

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
export function probeRecording(run: LifRun, tip: Vec3, seed: number = PROBE_SEED, slot: number = PROBE_SLOT): ProbeRecording {
  const cells = run.circuit.cells, pos = cells.map((c) => c.pos as Vec3);
  const trace = contactTrace({ cells: pos, spikes: run.spikes, placements: [{ atStep: 0, pos: tip }], seed, slot, fromStep: 0, n: run.nSteps + 1, dtMs: run.dt });
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

// ── what differs between two layouts of the contacts ────────────────────────────────────────────────────────────
/** The declared differences between two contact layouts, in terms of the nearest model cell (what the recording depends on). */
export function contactChanges(a: Contacts, b: Contacts, variant = 0): Change[] {
  const cells = workshopCircuit(variant).cells, out: Change[] = [];
  const near = (p: Vec3) => { let best = cells[0], d = Infinity; for (const c of cells) { const x = distUm(p, c.pos as Vec3); if (x < d) { d = x; best = c; } } return `${d.toFixed(0)} µm from ${best.id}`; };
  for (const id of CONTACT_IDS) {
    if (sameV(a[id], b[id])) continue;
    const from = a[id], to = b[id];
    out.push({ key: `contact:${id}`, what: !from ? `${id} placed` : !to ? `${id} removed` : `${id} moved ${distUm(from, to).toFixed(0)} µm`, from: from ? near(from) : 'not placed', to: to ? near(to) : 'not placed', where: id });
  }
  return out;
}

// ── a history of runs that can be undone ────────────────────────────────────────────────────────────────────────
export interface HistoryEntry { n: number; setup: WorkshopSetup; contacts: Contacts; digest: string; fired: boolean; label: string }
/**
 * The experiment: the circuit's causes, where the two contacts are, the seed of their noise, and the run those causes
 * give. The player's craft and the camera are NOT part of it — they are navigation, kept elsewhere.
 */
export interface Lab {
  setup: WorkshopSetup;
  contacts: Contacts;
  /** Seed of the contacts' noise. The same seed means the same noise, sample for sample, whatever else changes. */
  seed: number;
  result: WorkshopResult;
  /** What everything is compared with: a circuit configuration AND a contact layout, under the same seed. It changes only when the player says so. */
  baseline: WorkshopResult;
  baselineContacts: Contacts;
  history: HistoryEntry[];
  /** Steps that were undone and can be done again (emptied by any new change). */
  future: HistoryEntry[];
}

const copy = (s: WorkshopSetup): WorkshopSetup => ({ ...s, conn: { ...s.conn }, extra: s.extra.map((e) => ({ ...e })) });
const entry = (n: number, r: WorkshopResult, contacts: Contacts, label: string): HistoryEntry => ({ n, setup: copy(r.recipe.parameters), contacts: copyContacts(contacts), digest: r.digest, fired: r.firedMs != null, label });

/** A fresh experiment: the circuit as found and no contact placed — which is also the baseline. */
export function newLab(variant = 0): Lab {
  const setup = defaultSetup(variant), result = makeRun(setup);
  return { setup, contacts: copyContacts(NO_CONTACTS), seed: PROBE_SEED, result, baseline: result, baselineContacts: copyContacts(NO_CONTACTS), history: [entry(1, result, NO_CONTACTS, 'The circuit as you found it')], future: [] };
}
/** What of an experiment is kept between visits: every step's causes and contact layout, the baseline, the seed. No run, no trace: those are recomputed. */
export interface SavedEntry { setup: WorkshopSetup; contacts: Contacts; label: string }
export interface SavedLab { history: SavedEntry[]; baseline: { setup: WorkshopSetup; contacts: Contacts } | null; seed: number }
export const saveLab = (lab: Lab): SavedLab => ({
  history: lab.history.map((h) => ({ setup: copy(h.setup), contacts: copyContacts(h.contacts), label: h.label })),
  baseline: { setup: copy(lab.baseline.recipe.parameters), contacts: copyContacts(lab.baselineContacts) }, seed: lab.seed,
});
/** The experiment a saved one stands for: every run is computed again from its causes (the model is deterministic, so they are the same runs). */
export function restoreLab(s: SavedLab): Lab {
  if (!s.history.length) return newLab(0);
  let prev = makeRun(copy(s.history[0].setup));
  const history = [entry(1, prev, s.history[0].contacts, s.history[0].label)];
  for (const e of s.history.slice(1)) {
    if (changesBetween(prev.recipe.parameters, e.setup).length) prev = makeRun(copy(e.setup), prev.recipe.runId);
    history.push(entry(history.length + 1, prev, e.contacts, e.label));
  }
  const last = s.history[s.history.length - 1], b = s.baseline ?? { setup: s.history[0].setup, contacts: s.history[0].contacts };
  const baseline = changesBetween(prev.recipe.parameters, b.setup).length ? makeRun(copy(b.setup)) : prev;
  return { setup: copy(last.setup), contacts: copyContacts(last.contacts), seed: s.seed, result: prev, baseline, baselineContacts: copyContacts(b.contacts), history, future: [] };
}

/** Apply a change of causes: a new run whose parent is the current one. No-op when nothing would change. */
export function applyChange(lab: Lab, patch: Partial<WorkshopSetup>): Lab {
  const setup = copy({ ...lab.setup, ...patch }), ch = changesBetween(lab.setup, setup);
  if (!ch.length) return lab;
  const result = makeRun(setup, lab.result.recipe.runId), label = ch.map((c) => `${c.what}: ${c.from} → ${c.to}`).join('; ');
  return { ...lab, setup, result, history: [...lab.history, entry(lab.history.length + 1, result, lab.contacts, label)].slice(-80), future: [] };
}
/**
 * Put a contact somewhere (or take it away with null). ONE step of the history, however the position was arrived at.
 * The circuit's run is not recomputed and cannot change: a contact observes, it does not act.
 */
export function placeContact(lab: Lab, id: ContactId, pos: Vec3 | null): Lab {
  const contacts = copyContacts({ ...lab.contacts, [id]: pos }), ch = contactChanges(lab.contacts, contacts, lab.setup.variant);
  if (!ch.length) return lab;
  return { ...lab, contacts, history: [...lab.history, entry(lab.history.length + 1, lab.result, contacts, ch.map((c) => `${c.what}: ${c.from} → ${c.to}`).join('; '))].slice(-80), future: [] };
}
const restore = (lab: Lab, e: HistoryEntry): Pick<Lab, 'setup' | 'contacts' | 'result'> => ({ setup: copy(e.setup), contacts: copyContacts(e.contacts), result: e.digest === lab.result.digest && changesBetween(lab.setup, e.setup).length === 0 ? lab.result : makeRun(copy(e.setup)) });
/** Step back one change (of a cause or of a contact). A run is computed again from its causes and must end in the same state. */
export function undo(lab: Lab): Lab {
  if (lab.history.length < 2) return lab;
  const history = lab.history.slice(0, -1), gone = lab.history[lab.history.length - 1];
  return { ...lab, ...restore(lab, history[history.length - 1]), history, future: [...lab.future, gone] };
}
/** Do again the step that was last undone. */
export function redo(lab: Lab): Lab {
  if (!lab.future.length) return lab;
  const e = lab.future[lab.future.length - 1];
  return { ...lab, ...restore(lab, e), history: [...lab.history, e], future: lab.future.slice(0, -1) };
}
/** Go back to the baseline's causes and contact layout (as one new step, so that this too can be undone). */
export function toBaseline(lab: Lab): Lab {
  const setup = copy(lab.baseline.recipe.parameters), contacts = copyContacts(lab.baselineContacts);
  if (!changesBetween(lab.setup, setup).length && sameContacts(lab.contacts, contacts)) return lab;
  const result = changesBetween(lab.setup, setup).length ? makeRun(setup, lab.result.recipe.runId) : lab.result;
  return { ...lab, setup, contacts, result, history: [...lab.history, entry(lab.history.length + 1, result, contacts, 'Back to the baseline')].slice(-80), future: [] };
}
/** Make the current configuration — causes, contact layout, seed — the one that later ones are compared with. */
export const keepAsBaseline = (lab: Lab): Lab => ({ ...lab, baseline: lab.result, baselineContacts: copyContacts(lab.contacts) });
/** Every declared difference between the baseline and now: causes of the circuit, then contacts. Empty = this is the baseline. */
export const labChanges = (lab: Lab): Change[] => [...changesBetween(lab.baseline.recipe.parameters, lab.setup), ...contactChanges(lab.baselineContacts, lab.contacts, lab.setup.variant)];

/** One line that says what was changed against the baseline and what that did, or that nothing differs. */
export function compareSentence(lab: Lab): string {
  const ch = changesBetween(lab.baseline.recipe.parameters, lab.setup), moved = contactChanges(lab.baselineContacts, lab.contacts, lab.setup.variant);
  if (!ch.length && !moved.length) return 'This is the baseline run.';
  const b = lab.baseline, c = lab.result, was = b.firedMs != null ? `fired at ${f1(b.firedMs)} ms` : `stayed ${f1(b.thresholdMv - b.peakMv)} mV short`;
  const now = c.firedMs != null ? `fires at ${f1(c.firedMs)} ms` : `stays ${f1(c.thresholdMv - c.peakMv)} mV short`;
  const circuit = ch.length ? `Changed against the baseline: ${ch.map((x) => `${x.what.toLowerCase()} (${x.from} → ${x.to})`).join('; ')}. T ${was}; now it ${now}.` : '';
  const contacts = moved.length ? `${moved.map((x) => `${x.what} (${x.from} → ${x.to})`).join('; ')}: the circuit’s spikes are the same ones${ch.length ? '' : ' as in the baseline'} — only what ${moved.map((x) => x.where).join(' and ')} record${moved.length === 1 ? 's' : ''} of them differs.` : '';
  return [circuit, contacts].filter(Boolean).join(' ');
}

/** What a contact saw, in one sentence. `run` (when given) lets it say that the loudest cell there did not fire at all. */
export function contactSentence(id: ContactId, p: ProbeRecording, run?: LifRun): string {
  const loud = Object.entries(p.ampsUv).sort((a, b) => b[1] - a[1])[0], counted = p.events.filter((e) => e.cell != null), by = new Map<string, number>();
  for (const e of counted) by.set(e.cell!, (by.get(e.cell!) ?? 0) + 1);
  const thr = `−${p.thresholdUv.toFixed(0)} µV`, li = run ? run.circuit.cells.findIndex((c) => c.id === loud[0]) : -1, silent = li >= 0 && run!.spikes[li].length === 0;
  const loudest = `${loud[0]}, ${loud[1].toFixed(0)} µV${silent ? ` — but ${loud[0]} does not fire in this run` : ''}`;
  if (!p.events.length) return `${id} counted nothing: no deflection crossed its ${thr} threshold. The loudest cell there would be ${loudest}.`;
  return `${id} counted ${p.events.length} crossing${p.events.length === 1 ? '' : 's'} of ${thr}: ${[...by].map(([c, n]) => `${n} from ${c}`).join(', ') || 'none traced to a spike'}${p.events.length > counted.length ? `, ${p.events.length - counted.length} from noise alone` : ''}. Loudest there: ${loudest}.`;
}
