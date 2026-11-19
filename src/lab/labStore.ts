// Signal laboratory state. DEMO mode recomputes the browser model whenever parameters change.
// RTL mode plays the prerecorded Icarus trace and never alters it.
import { create } from 'zustand';
import type { RtlTrace } from '../artifacts/types';
import {
  NUM_CH, compression, generate, runCore, score, stepCore, freshState,
  type CoreConfig, type CoreEvent, type GenParams, type Score, type Spike, type StepResult,
} from './model';
import { useScene } from '../state/sceneStore';

export type LabMode = 'demo' | 'rtl';

export interface LabData {
  source: LabMode;
  cfg: CoreConfig;
  steps: StepResult[];          // indexed by global sample index i
  events: CoreEvent[];
  spikes: Spike[];              // ground truth (t = per-channel sample index)
  chT: number[];                // per global index: that channel's sample index t
  perCh: { i: number[]; x: number[]; baseInt: number[] }[];
  N: number;                    // total samples
  T: number;                    // samples per channel (max)
  score: Score;
}

export interface CrossCheck { compared: number; agree: number; firstMismatch: number | null }

/** Data-flow animation stages (component ids highlighted in 3D / block diagram). */
export const FLOW_STAGES: { key: string; label: string; ids: string[] }[] = [
  { key: 'channel', label: 'Electrode → AFE → ADC', ids: ['sys.electrode_array', 'sys.flex_interconnect', 'sys.connector', 'sys.afe', 'sys.adc'] },
  { key: 'input', label: 'Sample accepted', ids: ['sys.hbci01', 'pkg.die', 'die.pads', 'rtl.core'] },
  { key: 'state', label: 'Read channel state', ids: ['sys.hbci01', 'rtl.u_state'] },
  { key: 'baseline', label: 'Baseline subtraction', ids: ['sys.hbci01', 'rtl.u_baseline'] },
  { key: 'threshold', label: 'Threshold decision', ids: ['sys.hbci01', 'rtl.u_threshold'] },
  { key: 'refractory', label: 'Hysteresis / refractory', ids: ['sys.hbci01', 'rtl.u_refractory'] },
  { key: 'timestamp', label: 'Timestamp', ids: ['sys.hbci01', 'rtl.u_timestamp'] },
  { key: 'packet', label: 'Event packet out', ids: ['sys.hbci01', 'rtl.u_packer', 'sys.comms'] },
];

export interface FlowState { step: StepResult; stage: number }

interface LabState {
  mode: LabMode;
  cfg: CoreConfig;
  gen: GenParams;
  injected: Spike[];
  cursor: number;               // last processed global sample index (-1 = none)
  playing: boolean;
  speed: number;                // samples per second
  selectedCh: number | null;
  pauseOnEvent: boolean;
  breakOnCh: number | null;     // pause at the next event on this channel (after an injection)
  flow: FlowState | null;
  demo: LabData;
  rtl: LabData | null;
  crossCheck: CrossCheck | null;

  setMode: (m: LabMode) => void;
  setCfg: (p: Partial<CoreConfig>) => void;
  setGen: (p: Partial<GenParams>) => void;
  inject: () => void;
  clearInjected: () => void;
  setCursor: (i: number) => void;
  step: (d: number) => void;
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (v: number) => void;
  selectCh: (ch: number | null) => void;
  togglePauseOnEvent: () => void;
  startFlow: (s: StepResult) => void;
  advanceFlow: () => void;
  stopFlow: () => void;
  attachTrace: (t: RtlTrace | null) => void;
}

const DEFAULT_CFG: CoreConfig = { threshold: 600, hysteresis: 150, refractory: 8, alphaShift: 5 };
const DEFAULT_GEN: GenParams = { seed: 20261019, samplesPerChannel: 600, noise: 130, spikeRate: 1.2 };

function buildDemo(cfg: CoreConfig, gen: GenParams, injected: Spike[]): LabData {
  const stim = generate(gen, injected);
  const run = runCore(stim.x, cfg);
  const T = gen.samplesPerChannel;
  const chT = run.steps.map((s) => Math.floor(s.i / NUM_CH));
  const perCh = Array.from({ length: NUM_CH }, (_, ch) => ({
    i: Array.from({ length: T }, (_, t) => t * NUM_CH + ch),
    x: stim.x[ch],
    baseInt: Array.from({ length: T }, (_, t) => run.steps[t * NUM_CH + ch].baseInt),
  }));
  return {
    source: 'demo', cfg, steps: run.steps, events: run.events, spikes: stim.spikes, chT, perCh,
    N: run.steps.length, T, score: score(run.events, stim.spikes),
  };
}

/** Adapt the RTL trace (actual Icarus values) to the lab's data shape. Nothing is recomputed. */
function buildRtl(tr: RtlTrace): LabData {
  const cfg: CoreConfig = {
    threshold: tr.config.threshold, hysteresis: tr.config.hysteresis,
    refractory: tr.config.refractory, alphaShift: tr.config.alpha_shift,
  };
  const counts = new Array(NUM_CH).fill(0);
  const chT: number[] = [];
  const perCh = Array.from({ length: NUM_CH }, () => ({ i: [] as number[], x: [] as number[], baseInt: [] as number[] }));
  const steps: StepResult[] = tr.samples.map((s) => {
    const t = counts[s.ch]++;
    chT[s.i] = t;
    const baseInt = Math.floor(s.base / 256);
    perCh[s.ch].i.push(s.i);
    perCh[s.ch].x.push(s.x);
    perCh[s.ch].baseInt.push(baseInt);
    return {
      i: s.i, ch: s.ch, x: s.x, base: s.base, baseInt, res: s.res, mag: s.mag, pol: s.res < 0 ? 1 : 0,
      above: s.above, rearm: s.rearm, armed: s.armed, refr: s.refr, primed: s.primed, fire: s.fire,
      // Next-state values are not logged by the testbench; shown as unknown (-1).
      baseNext: -1, armedNext: s.armed, refrNext: -1,
    } as StepResult;
  });
  const idxToT = (i: number) => chT[i] ?? 0;
  const events: CoreEvent[] = tr.events.map((e) => ({ i: e.i, ch: e.ch, t: idxToT(e.i), ts: e.ts, pol: e.pol, mag: e.mag }));
  const spikes: Spike[] = tr.ground_truth.map((g) => ({ ch: g.ch, t: idxToT(g.i), amp: g.amp }));
  return {
    source: 'rtl', cfg, steps, events, spikes, chT, perCh,
    N: steps.length, T: Math.max(...counts), score: score(events, spikes),
  };
}

/** Run the DEMO model on the RTL stimulus and compare every sample with the RTL's own values. */
function crossCheck(tr: RtlTrace): CrossCheck {
  const st = freshState();
  const cfg: CoreConfig = {
    threshold: tr.config.threshold, hysteresis: tr.config.hysteresis,
    refractory: tr.config.refractory, alphaShift: tr.config.alpha_shift,
  };
  let agree = 0;
  let first: number | null = null;
  for (const s of tr.samples) {
    const r = stepCore(st[s.ch], s.i, s.ch, s.x, cfg);
    const ok = r.base === s.base && r.res === s.res && r.fire === s.fire && r.refr === s.refr && r.armed === s.armed;
    if (ok) agree++;
    else if (first === null) first = s.i;
  }
  return { compared: tr.samples.length, agree, firstMismatch: first };
}

export const useLab = create<LabState>((set, get) => ({
  mode: 'demo',
  cfg: DEFAULT_CFG,
  gen: DEFAULT_GEN,
  injected: [],
  cursor: 0,
  playing: false,
  speed: 240,
  selectedCh: null,
  pauseOnEvent: false,
  breakOnCh: null,
  flow: null,
  demo: buildDemo(DEFAULT_CFG, DEFAULT_GEN, []),
  rtl: null,
  crossCheck: null,

  setMode: (m) => {
    if (m === 'rtl' && !get().rtl) return;
    get().stopFlow();
    set({ mode: m, cursor: 0, playing: false, breakOnCh: null });
  },
  setCfg: (p) => {
    if (get().mode !== 'demo') return; // never alter the recorded RTL trace
    const cfg = { ...get().cfg, ...p };
    set({ cfg, demo: buildDemo(cfg, get().gen, get().injected) });
  },
  setGen: (p) => {
    if (get().mode !== 'demo') return;
    const gen = { ...get().gen, ...p };
    set({ gen, demo: buildDemo(get().cfg, gen, get().injected) });
  },
  inject: () => {
    const s = get();
    if (s.mode !== 'demo') return;
    const ch = s.selectedCh ?? 0;
    const tNow = Math.floor(Math.max(0, s.cursor) / NUM_CH);
    const t = Math.min(s.gen.samplesPerChannel - 6, tNow + 6);
    const injected = [...s.injected, { ch, t, amp: 1800, injected: true }];
    set({
      injected,
      demo: buildDemo(s.cfg, s.gen, injected),
      playing: true,
      breakOnCh: ch,
      cursor: Math.max(0, t * NUM_CH - 3 * NUM_CH),
    });
  },
  clearInjected: () => {
    const s = get();
    set({ injected: [], demo: buildDemo(s.cfg, s.gen, []) });
  },
  setCursor: (i) => {
    const d = currentData(get());
    set({ cursor: Math.max(0, Math.min(d.N - 1, Math.round(i))) });
  },
  step: (dlt) => {
    const s = get();
    const d = currentData(s);
    const i = Math.max(0, Math.min(d.N - 1, s.cursor + dlt));
    set({ cursor: i, playing: false });
    s.startFlow(d.steps[i]);
  },
  togglePlay: () => {
    const s = get();
    const d = currentData(s);
    if (!s.playing && s.cursor >= d.N - 1) set({ cursor: 0 });
    set({ playing: !s.playing });
  },
  setPlaying: (v) => set({ playing: v }),
  setSpeed: (v) => set({ speed: v }),
  selectCh: (ch) => set({ selectedCh: ch }),
  togglePauseOnEvent: () => set({ pauseOnEvent: !get().pauseOnEvent }),
  startFlow: (step) => {
    set({ flow: { step, stage: 0 } });
    useScene.getState().setActiveBlocks(FLOW_STAGES[0].ids, step.ch);
  },
  advanceFlow: () => {
    const f = get().flow;
    if (!f) return;
    // Non-firing samples stop after the decision stages.
    const last = f.step.fire ? FLOW_STAGES.length - 1 : 5;
    if (f.stage >= last) {
      get().stopFlow();
      return;
    }
    const stage = f.stage + 1;
    set({ flow: { ...f, stage } });
    useScene.getState().setActiveBlocks(FLOW_STAGES[stage].ids, f.step.ch);
  },
  stopFlow: () => {
    set({ flow: null });
    useScene.getState().setActiveBlocks([], null);
  },
  attachTrace: (t) => {
    if (!t) return;
    set({ rtl: buildRtl(t), crossCheck: crossCheck(t) });
  },
}));

export function currentData(s: Pick<LabState, 'mode' | 'demo' | 'rtl'>): LabData {
  return s.mode === 'rtl' && s.rtl ? s.rtl : s.demo;
}

/** Live statistics up to the cursor. */
export function liveStats(d: LabData, cursor: number) {
  const evs = d.events.filter((e) => e.i <= cursor);
  const samples = Math.max(0, cursor + 1);
  const tMax = cursor >= 0 ? d.chT[cursor] ?? 0 : 0;
  // Events may fire up to the match window before a spike's trough, so match against spikes
  // slightly ahead of the cursor, but only count a spike as missed once its window has passed.
  const cand = d.spikes.filter((s) => s.t <= tMax + 3);
  const sc = score(evs, cand);
  const misses = cand.filter((s, j) => !sc.spikeHit[j] && s.t < tMax - 3).length;
  return { samples, events: evs.length, ...compression(samples, evs.length), hits: sc.hits, misses, fp: sc.falsePositives };
}
