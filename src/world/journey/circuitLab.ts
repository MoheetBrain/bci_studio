// The timing experiment as it runs in the world: one deterministic recording of the five-cell circuit per set of
// causes, two recording contacts the player places beside it, a playhead that moves through the recording in slow
// motion, and a history that can be undone and redone.
//
// Three clocks, kept apart:
//   wall time          frames arrive whenever the display draws them;
//   presentation       `speed` model-milliseconds per wall second (slow motion: 5 ms/s is 1/200 of real time);
//   scientific time    the model's own, in steps of 0.05 ms. The run is computed once, off the frame loop, from its
//                      causes; drawing faster or slower only moves the playhead through it.
// Pausing stops the playhead. It never stops the craft or the camera.
//
// What a contact records is a function of (the run's spike times, the contact's position, the seed, the contact's
// number) and of nothing else — see model/journey.ts and model/observe.ts. Where the craft or the camera is never
// enters it. Moving a contact recomputes that contact's recording; the circuit's run is the same object before and after.
//
// The scene (runtime arrays), the selection readout and the traces all read the SAME run at the SAME playhead.
import { create } from 'zustand';
import { WORKSHOP_MS, type WorkshopSetup } from '../model/circuits';
import { LIF_DT_MS, ModelClock, type LifRun } from '../model/lif';
import {
  CONTACT_IDS, CONTACT_SLOT, applyChange, components, contactPosition, keepAsBaseline, newLab, placeContact, probeRecording, redo, restoreLab, sameContacts, saveLab, toBaseline, undo, whyTarget,
  type ContactId, type Contacts, type Lab, type ProbeRecording, type SavedLab, type Why,
} from '../model/journey';
import { BLOCK } from '../model/layout';
import type { Vec3 } from '../model/observe';
import { rt } from '../runtime';
import { useJourney } from './journeyStore';

/** Presentation speeds, model-ms per wall second. Real time would be 1000. */
export const SPEEDS = [2, 5, 10, 25] as const;
export const slowFactor = (msPerS: number) => `1/${Math.round(1000 / msPerS)}`;
const LOOP_HOLD_S = 1.6;
/** Where each contact's "it just counted an event" flash lives in rt.site (the array's eight contacts are 1…8). */
export const CONTACT_SITE: Record<ContactId, number> = { P1: 0, P2: 9 };

export type Recs = Record<ContactId, ProbeRecording | null>;
interface Derived { rec: Recs; baseRec: Recs; why: Why; comp: { a: LifRun; b: LifRun }; baseComp: { a: LifRun; b: LifRun } }
const recsOf = (run: LifRun, at: Contacts, seed: number): Recs => ({
  P1: at.P1 ? probeRecording(run, at.P1, seed, CONTACT_SLOT.P1) : null,
  P2: at.P2 ? probeRecording(run, at.P2, seed, CONTACT_SLOT.P2) : null,
});
function derive(lab: Lab): Derived {
  const comp = components(lab.setup), sameRun = lab.baseline.recipe.runId === lab.result.recipe.runId;
  const rec = recsOf(lab.result.run, lab.contacts, lab.seed);
  // the baseline's recordings: the baseline's run, heard from where the contacts were in the baseline, with the same seed
  const baseRec = sameRun && sameContacts(lab.contacts, lab.baselineContacts) ? rec : recsOf(lab.baseline.run, lab.baselineContacts, lab.seed);
  return { rec, baseRec, why: whyTarget(lab.result, comp), comp, baseComp: sameRun ? comp : components(lab.baseline.recipe.parameters) };
}

interface LabState extends Derived {
  lab: Lab;
  /** The cell whose membrane potential the trace shows. */
  focus: string;
  speed: number;
  loop: boolean;
  paused: boolean;
  /** Model time of the playhead, ms (refreshed a few times a second; the scene reads the clock itself). */
  tMs: number;
  /** How many complete replays have been watched (for the route's "notice" step). */
  watched: number;
  /** The contact held ready to be put down (the next click on the scene places it), or null. Presentation: not part of the experiment. */
  tool: ContactId | null;
  /** A contact while it is being dragged: where it is right now. It joins the experiment's history when the drag ends. */
  drag: { id: ContactId; pos: Vec3 } | null;
  /** How far one press of a nudge button moves a contact, µm. */
  nudgeUm: number;
  change: (patch: Partial<WorkshopSetup>, restart?: boolean) => void;
  /** Put a contact at a position (model coordinates, µm) or take it away (null). One step of the history. */
  place: (id: ContactId, pos: readonly number[] | null) => void;
  dragTo: (id: ContactId, pos: readonly number[]) => void;
  /** End a drag: keep the new position (one step of the history) or put the contact back where it was. */
  dragEnd: (keep: boolean) => void;
  setTool: (id: ContactId | null) => void;
  undo: () => void;
  redo: () => void;
  toBaseline: () => void;
  keepBaseline: () => void;
  reset: () => void;
  restore: (saved: SavedLab) => void;
}

export const clock = new ModelClock(5, LIF_DT_MS);
export const labEng = { hold: 0, dirty: true, lastPush: 0 };
const first = newLab(0);

function commit(lab: Lab, restart = true): void {
  useLab.setState({ lab, ...derive(lab), drag: null });
  labEng.dirty = true;
  if (restart) replay();
  // what a later visit needs to come back to this experiment (the craft's pose is remembered separately)
  useJourney.getState().remember({ lab: saveLab(lab) });
}

export const useLab = create<LabState>((set, get) => ({
  lab: first, ...derive(first), focus: 'T', speed: 5, loop: true, paused: false, tMs: 0, watched: 0, tool: null, drag: null, nudgeUm: 5,
  change: (patch, restart = true) => { const cur = get().lab, next = applyChange(cur, patch); if (next !== cur) commit(next, restart); },
  // a contact observes: moving it never restarts the replay and never touches the run
  place: (id, pos) => { const cur = get().lab, next = placeContact(cur, id, pos === null ? null : contactPosition(pos, BLOCK)); if (next !== cur) commit(next, false); else if (get().drag) set({ drag: null, ...derive(cur) }); },
  dragTo: (id, pos) => {
    const p = contactPosition(pos, BLOCK), s = get();
    if (!p) return;
    set({ drag: { id, pos: p }, rec: { ...s.rec, [id]: probeRecording(s.lab.result.run, p, s.lab.seed, CONTACT_SLOT[id]) } });
    labEng.dirty = true;
  },
  dragEnd: (keep) => {
    const d = get().drag;
    if (!d) return;
    if (keep) get().place(d.id, d.pos);
    else { set({ drag: null, ...derive(get().lab) }); labEng.dirty = true; }
  },
  setTool: (tool) => { rt.tool = tool; set({ tool }); },
  undo: () => { const cur = get().lab, next = undo(cur); if (next !== cur) commit(next, next.result !== cur.result); },
  redo: () => { const cur = get().lab, next = redo(cur); if (next !== cur) commit(next, next.result !== cur.result); },
  toBaseline: () => { const cur = get().lab, next = toBaseline(cur); if (next !== cur) commit(next, next.result !== cur.result); },
  keepBaseline: () => commit(keepAsBaseline(get().lab), false),
  reset: () => { rt.tool = null; useLab.setState({ focus: 'T', speed: 5, loop: true, watched: 0, tool: null }); commit(newLab(0)); },
  restore: (saved) => { if (saved.history.length) commit(restoreLab(saved)); },
}));

/** Where a contact is right now (while it is dragged: where the drag has it), model µm — or null if it is not placed. */
export function contactAt(id: ContactId): Vec3 | null { const s = useLab.getState(); return s.drag?.id === id ? s.drag.pos : s.lab.contacts[id]; }
export const isContactId = (id: string): id is ContactId => (CONTACT_IDS as readonly string[]).includes(id);

// ── transport ───────────────────────────────────────────────────────────────────────────────────────────────────
const nSteps = () => useLab.getState().lab.result.run.nSteps;
export function replay(): void { clock.seek(0); clock.paused = false; labEng.hold = 0; labEng.dirty = true; useLab.setState({ paused: false }); }
export function setPaused(p: boolean): void { clock.paused = p; labEng.hold = 0; useLab.setState({ paused: p }); }
export function togglePause(): void { if (clock.step() >= nSteps()) { replay(); return; } setPaused(!clock.paused); }
/** Advance by a quarter of a millisecond of model time and stay paused. */
export function stepOnce(): void { clock.paused = true; clock.seek(Math.min(nSteps(), clock.step() + 5)); labEng.dirty = true; labEng.hold = 0; useLab.setState({ paused: true }); }
export function seekMs(ms: number): void { clock.seek(Math.max(0, Math.min(nSteps(), Math.round(ms / LIF_DT_MS)))); labEng.dirty = true; labEng.hold = 0; }
export const playheadMs = () => Math.min(nSteps(), clock.step()) * LIF_DT_MS;

/** The model's own numbers for a cell at the playhead. */
export function cellNow(id: string): { vMv: number; thresholdMv: number; restMv: number; lastSpikeMs: number | null; spikes: number } | null {
  const r = useLab.getState().lab.result.run, i = r.circuit.cells.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const k = Math.min(r.nSteps, clock.step()), t = k * r.dt;
  let last: number | null = null, n = 0;
  for (const s of r.spikes[i]) { if (s <= t) { last = s; n++; } else break; }
  return { vMv: r.v[i][k], thresholdMv: r.final.vth[i], restMv: r.circuit.cells[i].el, lastSpikeMs: last, spikes: n };
}
/** A contact's voltage at the playhead, µV, and how many crossings it has counted so far in this run. Null if it is not placed. */
export function contactNow(id: ContactId): { uV: number; counted: number } | null {
  const p = useLab.getState().rec[id];
  if (!p) return null;
  const k = Math.min(p.trace.length - 1, clock.step()), t = k * p.dtMs;
  return { uV: p.trace[k], counted: p.events.filter((e) => e.ms <= t).length };
}

/**
 * Once per drawn frame while the circuit is the running model: move the playhead and write what the scene shows.
 * `live` = false freezes it (the decoder task is running instead): the cells are drawn idle and nothing advances.
 */
export function labFrame(wall: number, live: boolean): void {
  const st = useLab.getState(), r = st.lab.result.run, c = r.circuit;
  clock.msPerSecond = st.speed;
  let k = Math.min(r.nSteps, live ? clock.tick(wall) : clock.step());
  if (live && k >= r.nSteps && !clock.paused) {
    // the end of the recording: hold the final state for a moment, then (if looping) play the same recording again
    clock.seek(r.nSteps); k = r.nSteps;
    if (labEng.hold === 0) useLab.setState({ watched: st.watched + 1 });
    labEng.hold += wall;
    if (!st.loop) { clock.paused = true; labEng.hold = 0; useLab.setState({ paused: true }); }
    else if (labEng.hold >= LOOP_HOLD_S) { labEng.hold = 0; clock.seek(0); k = 0; }
  }
  const t = k * r.dt, decay = Math.max(0.5, 0.16 * st.speed);
  for (let i = 0; i < c.cells.length; i++) {
    const x = c.cells[i], v = r.v[i][k];
    let last = -1e9;
    for (const s of r.spikes[i]) { if (s <= t) last = s; else break; }
    rt.act[i] = live ? Math.max(0, Math.min(1, (v - x.el) / (r.final.vth[i] - x.el))) : 0;
    rt.flash[i] = live && t - last < 6 * decay ? Math.exp(-(t - last) / decay) : 0;
    rt.dim[i] = live ? 0 : 0.5;
  }
  c.conns.forEach((q, i) => { rt.linkOn[i] = (st.lab.setup.conn[q.id] ?? q.enabled !== false) ? 1 : 0; });
  rt.pulses.length = 0;
  if (live) for (const s of r.sent) if (s.emitMs <= t && t < s.arriveMs) rt.pulses.push({ link: s.conn, u: (t - s.emitMs) / (s.arriveMs - s.emitMs) });
  // a contact lights when it counts a crossing — at the time of that crossing in its own recording
  for (const id of CONTACT_IDS) {
    let site = 0;
    const p = st.rec[id];
    if (live && p) for (const e of p.events) { if (e.ms > t) break; if (t - e.ms < 6 * decay) site = Math.max(site, Math.exp(-(t - e.ms) / decay)); }
    rt.site[CONTACT_SITE[id]] = site;
  }
  // the readouts outside the canvas are refreshed a few times a second, not every frame
  const now = performance.now();
  if (st.tMs !== t && (now - labEng.lastPush > 110 || clock.paused)) { labEng.lastPush = now; useLab.setState({ tMs: t }); }
}

export const RUN_MS = WORKSHOP_MS;
if (typeof window !== 'undefined') (window as unknown as { __lab?: unknown }).__lab = { store: useLab, clock, replay, seekMs, playheadMs, contactAt };
