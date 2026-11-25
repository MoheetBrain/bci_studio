// The decoder control task as it runs in the world.
//
//   your keys → SYNTHETIC intended velocity → 24 model units → counts at 8 contacts → the fitted decoder → the cursor
//
// The cursor is moved by the decoder's output and by nothing else (tests/world-journey.test.ts, world-pilot.test.ts).
// This is the FEATURE-LEVEL surrogate of model/pilot.ts: waveforms, amplifier, ADC and the sample-by-sample detector
// of the full chain are bypassed. The full chain is still the Experiment scene of the studio.
//
// A DIFFERENT MODEL from the five-cell circuit. Nothing computed there feeds anything here; what the two share is one
// rule only — a contact counts a spike when its size at the contact crosses a threshold set from the noise.
//
// The session lives in a worker; this file asks it for one 50 ms bin at a time, in real time, and writes what the
// scene and the instruments show. While the task is not the running model nothing is asked of it.
import { create } from 'zustand';
import { controller } from '../controller';
import { PILOT_BIN_MS, PILOT_CH, PILOT_UNITS, intentCode, type PilotDecoderId, type PilotFault, type PilotSnapshot } from '../model/pilot';
import { PilotHost, type PilotInfo, type PilotProgress, type PilotReq } from '../pilotHost';
import { rt } from '../runtime';
import { useJourney } from './journeyStore';

export const UNIT0 = 5;           // the population's units follow the five circuit cells in the scene's arrays
const BIN_S = PILOT_BIN_MS / 1000, HIST = 160, TRAIL = 80;

interface TaskState {
  status: 'off' | 'starting' | 'calibrating' | 'ready' | 'error';
  progress: PilotProgress | null;
  info: PilotInfo | null;
  /** Refreshed a few times a second for the readouts (the scene reads every bin directly). */
  snap: PilotSnapshot | null;
  last: { hit: boolean; timeS: number; efficiency: number } | null;
  paused: boolean;
  offThread: boolean;
  note: string | null;
  /** Hits at the moment the last fault was applied (so "did control come back?" can be answered from the task itself). */
  hitsAtFault: number | null;
  /** What was done since the last fault: the route's recovery step needs one of these to have helped. */
  recovery: 'none' | 'decoder' | 'recalibrated' | 'restored';
}
export const useTask = create<TaskState>(() => ({ status: 'off', progress: null, info: null, snap: null, last: null, paused: false, offThread: true, note: null, hitsAtFault: null, recovery: 'none' }));

export const task = {
  host: null as PilotHost | null, acc: 0, inflight: false, stepOnce: false,
  prev: null as PilotSnapshot | null, cur: null as PilotSnapshot | null, arrived: 0, shown: 0,
  /** Intended and decoded velocity of the last HIST bins (x, y, x, y per bin), and the two cursor trails. */
  hist: new Float32Array(HIST * 4), histN: 0, trailD: [] as number[], trailI: [] as number[],
  uRate: new Float32Array(PILOT_UNITS.length),
};
export const TASK_HIST = HIST;
const call = (req: PilotReq, progress?: (p: PilotProgress) => void) => task.host!.call(req, progress);

function clearTraces(): void {
  task.prev = task.cur = null; task.histN = 0; task.trailD.length = 0; task.trailI.length = 0; task.uRate.fill(0);
  useTask.setState({ snap: null, last: null });
}

export async function calibrate(say?: (text: string) => void): Promise<void> {
  if (!task.host || useTask.getState().status === 'calibrating') return;
  const again = !!useTask.getState().info?.calibration;
  useTask.setState({ status: 'calibrating', progress: { done: 0, total: 5, what: 'Starting' } });
  try {
    const r = await call({ op: 'calibrate' }, (progress) => useTask.setState({ progress }));
    useTask.setState({ status: 'ready', progress: null, info: r.info ?? useTask.getState().info, ...(again && !r.cancelled && useTask.getState().hitsAtFault != null ? { recovery: 'recalibrated' as const } : {}) });
    say?.(r.cancelled ? 'Calibration stopped: the decoders are the ones you had before.' : again ? 'Recalibrated under the present conditions: thresholds re-estimated, every decoder refitted on fresh scripted reaches and scored on others.' : 'Calibrated: every decoder was fitted on scripted reaches and scored on others it never saw.');
  } catch (e) { useTask.setState({ status: 'error', note: e instanceof Error ? e.message : String(e) }); }
}
export function cancelCalibration(): void { void task.host?.call({ op: 'cancel' }); }

async function command(req: PilotReq): Promise<void> {
  if (useTask.getState().status !== 'ready') return;
  const r = await call(req);
  if (r.info) useTask.setState({ info: r.info });
}
export async function applyFault(f: PilotFault): Promise<void> {
  const hits = task.cur?.hits ?? useTask.getState().info?.hits ?? 0;
  await command({ op: 'fault', fault: f });
  useTask.setState({ hitsAtFault: hits, recovery: 'none' });
  if (f === 'lost') useJourney.getState().tick('disrupt');
}
export async function clearFaults(): Promise<void> { const had = useTask.getState().hitsAtFault != null; await command({ op: 'clear' }); if (had) useTask.setState({ recovery: 'restored' }); }
export async function setDecoder(id: PilotDecoderId): Promise<void> { const had = useTask.getState().hitsAtFault != null; await command({ op: 'decoder', id }); if (had) useTask.setState({ recovery: 'decoder' }); }
export async function evaluate(): Promise<void> { await command({ op: 'evaluate' }); }
export async function centre(): Promise<void> { await command({ op: 'centre' }); }

/** Start the worker and fit the decoders (about a second, off the drawing thread). Safe to call more than once. */
export async function startTask(seed = 7): Promise<void> {
  if (task.host) return;
  task.host = new PilotHost(); task.acc = 0; task.inflight = false;
  clearTraces();
  useTask.setState({ status: 'starting', info: null, note: null, offThread: task.host.offThread, hitsAtFault: null, recovery: 'none', paused: false });
  try {
    const r = await call({ op: 'new', seed });
    useTask.setState({ info: r.info ?? null, status: 'ready' });
    await calibrate();
  } catch (e) { useTask.setState({ status: 'error', note: e instanceof Error ? e.message : String(e) }); }
}
/** A new session from the same seed: the task's own complete reset (decoders are fitted again from the same data). */
export async function resetTask(): Promise<void> { stopTask(); await startTask(7); }
export function stopTask(): void { task.host?.dispose(); task.host = null; clearTraces(); useTask.setState({ status: 'off', info: null }); rt.site.fill(0, 1); }

export function setTaskPaused(p: boolean): void { useTask.setState({ paused: p }); }
export function taskStep(): void { useTask.setState({ paused: true }); task.stepOnce = true; }

/** Replays the whole session from its command log in the worker and reports whether the cursor path is identical. */
export async function verifyReplay(): Promise<{ bins: number; matches: boolean } | null> {
  if (useTask.getState().status !== 'ready') return null;
  const x = await call({ op: 'export' });
  if (!x.data) return null;
  const r = await call({ op: 'import', data: x.data });
  if (r.info) useTask.setState({ info: r.info });
  return { bins: x.data.bins, matches: !!r.matches };
}

function onSnap(s: PilotSnapshot): void {
  task.prev = task.cur; task.cur = s; task.arrived = performance.now(); task.shown = 0;
  const k = task.histN % HIST;
  task.hist[k * 4] = s.intent[0]; task.hist[k * 4 + 1] = s.intent[1]; task.hist[k * 4 + 2] = s.decoded[0]; task.hist[k * 4 + 3] = s.decoded[1]; task.histN++;
  if (s.ended) { task.trailD.length = 0; task.trailI.length = 0; }
  task.trailD.push(s.cursor[0], s.cursor[1]); task.trailI.push(s.ghost[0], s.ghost[1]);
  if (task.trailD.length > TRAIL * 2) { task.trailD.splice(0, 2); task.trailI.splice(0, 2); }
  const per = new Float32Array(PILOT_UNITS.length);
  for (const sp of s.spikes) per[sp.unit]++;
  for (let i = 0; i < per.length; i++) task.uRate[i] += 0.2 * (per[i] / BIN_S - task.uRate[i]);
  if (s.ended || s.bin % 4 === 0) useTask.setState(s.ended ? { snap: s, last: s.ended } : { snap: s });
  // the route's steps are ticked by what the task itself reports
  const j = useJourney.getState(), st = useTask.getState();
  if (!j.beats.engineer && s.hits >= 2) j.tick('engineer');
  if (!j.beats.recover && st.hitsAtFault != null && st.recovery !== 'none' && s.hits >= st.hitsAtFault + 2) j.tick('recover');
}

/**
 * Once per drawn frame. `live` = the task is the running model. The intended velocity is read from the controller
 * only in the Pilot context; in every other context it is zero, whatever keys are held.
 */
export function taskFrame(wall: number, live: boolean): void {
  const st = useTask.getState();
  if (live && st.status === 'ready' && task.host && !task.inflight) {
    if (!st.paused) task.acc = Math.min(0.1, task.acc + wall);
    if (task.acc >= BIN_S || task.stepOnce) {
      task.acc = task.stepOnce ? 0 : task.acc - BIN_S; task.stepOnce = false; task.inflight = true;
      const a = controller.pilotAxes();
      void call({ op: 'step', code: intentCode(a.x, a.y, a.slow) }).then((r) => { if (r.snap) onSnap(r.snap); }).catch(() => undefined).finally(() => { task.inflight = false; });
    }
  }
  // the scene replays each 50 ms bin as it arrives: a spike flashes at its own time inside the bin
  const cur = task.cur, fade = Math.exp(-wall / 0.07);
  for (let i = 0; i < PILOT_UNITS.length; i++) {
    rt.flash[UNIT0 + i] = live ? rt.flash[UNIT0 + i] * fade : 0;
    rt.act[UNIT0 + i] = live ? Math.min(1, task.uRate[i] / 70) * 0.5 : 0;
    rt.dim[UNIT0 + i] = live ? 0 : 0.5;
  }
  for (let c = 0; c < PILOT_CH; c++) rt.site[1 + c] = live ? rt.site[1 + c] * fade : 0;
  if (live && cur && !st.paused) {
    const frac = Math.min(1, (performance.now() - task.arrived) / PILOT_BIN_MS), tShow = cur.tS - BIN_S + frac * BIN_S;
    while (task.shown < cur.spikes.length && cur.spikes[task.shown].tS <= tShow) { const sp = cur.spikes[task.shown++]; rt.flash[UNIT0 + sp.unit] = 0.55; if (sp.counted) rt.site[1 + PILOT_UNITS[sp.unit].ch] = 1; }
  }
}

if (typeof window !== 'undefined') (window as unknown as { __task?: unknown }).__task = { store: useTask, task };
