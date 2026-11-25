// The timing experiment as it runs in the world: one deterministic recording of the five-cell circuit per set of
// causes, a playhead that moves through it in slow motion, and a history that can be undone.
//
// Three clocks, kept apart:
//   wall time          frames arrive whenever the display draws them;
//   presentation       `speed` model-milliseconds per wall second (slow motion: 5 ms/s is 1/200 of real time);
//   scientific time    the model's own, in steps of 0.05 ms. The run is computed once, off the frame loop, from its
//                      causes; drawing faster or slower only moves the playhead through it.
// Pausing stops the playhead. It never stops the camera.
//
// The scene (runtime arrays), the selection readout and the traces all read the SAME run at the SAME playhead.
import { create } from 'zustand';
import { WORKSHOP_MS, type WorkshopSetup } from '../model/circuits';
import { LIF_DT_MS, ModelClock, type LifRun } from '../model/lif';
import { applyChange, components, keepAsBaseline, newLab, probeRecording, toBaseline, undo, whyTarget, type Lab, type ProbeRecording, type Why } from '../model/journey';
import { PROBE_TIP } from '../model/layout';
import { makeRun } from '../model/workshopRun';
import { rt } from '../runtime';
import { useJourney } from './journeyStore';

/** Presentation speeds, model-ms per wall second. Real time would be 1000. */
export const SPEEDS = [2, 5, 10, 25] as const;
export const slowFactor = (msPerS: number) => `1/${Math.round(1000 / msPerS)}`;
const LOOP_HOLD_S = 1.6;

interface Derived { probe: ProbeRecording; baseProbe: ProbeRecording; why: Why; comp: { a: LifRun; b: LifRun }; baseComp: { a: LifRun; b: LifRun } }
function derive(lab: Lab): Derived {
  const comp = components(lab.setup), same = lab.baseline.recipe.runId === lab.result.recipe.runId;
  const probe = probeRecording(lab.result.run, PROBE_TIP);
  return { probe, baseProbe: same ? probe : probeRecording(lab.baseline.run, PROBE_TIP), why: whyTarget(lab.result, comp), comp, baseComp: same ? comp : components(lab.baseline.recipe.parameters) };
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
  change: (patch: Partial<WorkshopSetup>, restart?: boolean) => void;
  undo: () => void;
  toBaseline: () => void;
  keepBaseline: () => void;
  reset: () => void;
  restore: (history: Array<{ setup: WorkshopSetup; label: string }>, baseline: WorkshopSetup | null) => void;
}

export const clock = new ModelClock(5, LIF_DT_MS);
export const labEng = { hold: 0, dirty: true, lastPush: 0 };
const first = newLab(0);

function commit(lab: Lab, restart = true): void {
  useLab.setState({ lab, ...derive(lab) });
  labEng.dirty = true;
  if (restart) replay();
  // what a later visit needs to come back to this experiment
  useJourney.getState().remember({ history: lab.history.map((h) => ({ setup: h.setup, label: h.label })), baseline: lab.baseline.recipe.parameters });
}

export const useLab = create<LabState>((_set, get) => ({
  lab: first, ...derive(first), focus: 'T', speed: 5, loop: true, paused: false, tMs: 0, watched: 0,
  change: (patch, restart = true) => { const cur = get().lab, next = applyChange(cur, patch); if (next !== cur) commit(next, restart); },
  undo: () => { const cur = get().lab, next = undo(cur); if (next !== cur) commit(next); },
  toBaseline: () => { const cur = get().lab, next = toBaseline(cur); if (next !== cur) commit(next); },
  keepBaseline: () => commit(keepAsBaseline(get().lab), false),
  reset: () => { useLab.setState({ focus: 'T', speed: 5, loop: true, watched: 0 }); commit(newLab(0)); },
  restore: (history, baseline) => {
    if (!history.length) return;
    let lab = newLab(history[0].setup.variant ?? 0);
    for (const h of history.slice(1)) lab = applyChange(lab, h.setup);
    if (baseline) lab = { ...lab, baseline: makeRun(baseline) };
    commit(lab);
  },
}));

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
/** The probe's voltage at the playhead, µV, and how many crossings it has counted so far in this run. */
export function probeNow(): { uV: number; counted: number } {
  const p = useLab.getState().probe, k = Math.min(p.trace.length - 1, clock.step()), t = k * p.dtMs;
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
  // the probe's contact lights when it counts a crossing
  let site = 0;
  if (live) for (const e of st.probe.events) { if (e.ms > t) break; if (t - e.ms < 6 * decay) site = Math.max(site, Math.exp(-(t - e.ms) / decay)); }
  rt.site[0] = site;
  // the readouts outside the canvas are refreshed a few times a second, not every frame
  const now = performance.now();
  if (st.tMs !== t && (now - labEng.lastPush > 110 || clock.paused)) { labEng.lastPush = now; useLab.setState({ tMs: t }); }
}

export const RUN_MS = WORKSHOP_MS;
if (typeof window !== 'undefined') (window as unknown as { __lab?: unknown }).__lab = { store: useLab, clock, replay, seekMs, playheadMs };
