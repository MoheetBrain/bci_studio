// State of the Experiment scene: which experiment the attached device supports, the recording parameters, the latest
// simulated session, and which stage and representation are on screen. The timeline position lives in the scene.
import { create } from 'zustand';
import type { BenchResult } from './model/bench';
import { DEFAULT_MOTOR, clampMotor, type MotorParams } from './model/motor';
import type { ExpKind, MotorSession, Session, VisualSession } from './model/session';
import { DEFAULT_VISUAL, clampVisual, type VisualParams } from './model/visual';
import { simulate, type Progress } from './simClient';

export type Mode = 'cinematic' | 'math' | 'engineering';
export const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'cinematic', label: 'Cinematic', hint: 'The mechanism, shown' },
  { id: 'math', label: 'Physics & maths', hint: 'Equations, units and the live numbers in them' },
  { id: 'engineering', label: 'Engineering', hint: 'Blocks, interfaces, budgets and trade-offs' },
];
export const STAGES = [
  { n: 1, id: 'tissue', label: 'Tissue', sub: 'cells and contacts' },
  { n: 2, id: 'neuron', label: 'Neuron', sub: 'membrane and spike' },
  { n: 3, id: 'electrode', label: 'Electrode', sub: 'what the contact sees' },
  { n: 4, id: 'frontend', label: 'Front end', sub: 'filter and gain' },
  { n: 5, id: 'adc', label: 'ADC', sub: 'samples and bits' },
  { n: 6, id: 'dsp', label: 'DSP', sub: 'clean-up and features' },
  { n: 7, id: 'decoder', label: 'Decoder', sub: 'features to prediction' },
  { n: 8, id: 'output', label: 'Output', sub: 'result and feedback' },
] as const;

const MODE_KEY = 'hbci.exp.mode';
const storedMode = (): Mode => { try { const v = localStorage.getItem(MODE_KEY); if (v === 'cinematic' || v === 'math' || v === 'engineering') return v; } catch { /* unavailable */ } return 'cinematic'; };

interface ExpState {
  kind: ExpKind | null;
  motor: MotorParams; motorCalib: MotorParams; decoderId: string;
  visual: VisualParams; visualCalib: VisualParams;
  session: Session | null;
  status: 'idle' | 'computing' | 'ready' | 'error';
  error: string | null;
  /** Bumped by every new result, so views can tell "the numbers changed". */
  resultNonce: number;
  stage: number;
  mode: Mode;
  view: 'signal' | 'lab';
  /** The guided tour is running: stages advance by themselves. */
  follow: boolean;
  bench: BenchResult | null; benchStatus: 'idle' | 'computing' | 'ready' | 'error'; benchProgress: Progress | null;

  setKind: (k: ExpKind | null) => void;
  setMotor: (patch: Partial<MotorParams>) => void;
  setVisual: (patch: Partial<VisualParams>) => void;
  setDecoder: (id: string) => void;
  /** Refit the decoders on a calibration run recorded under the current conditions. */
  recalibrate: () => void;
  resetParams: () => void;
  setStage: (n: number) => void;
  setMode: (m: Mode) => void;
  setView: (v: 'signal' | 'lab') => void;
  setFollow: (f: boolean) => void;
  run: () => void;
  runBench: () => void;
}

let want = 0, timer = 0;

export const useExperiment = create<ExpState>((set, get) => ({
  kind: null,
  motor: DEFAULT_MOTOR, motorCalib: DEFAULT_MOTOR, decoderId: 'linear',
  visual: DEFAULT_VISUAL, visualCalib: DEFAULT_VISUAL,
  session: null, status: 'idle', error: null, resultNonce: 0,
  stage: 1, mode: storedMode(), view: 'signal', follow: false,
  bench: null, benchStatus: 'idle', benchProgress: null,

  setKind: (k) => { if (get().kind === k) return; set({ kind: k, session: null, status: 'idle', stage: 1, follow: false }); if (k) get().run(); },
  setMotor: (patch) => { set((s) => ({ motor: clampMotor({ ...s.motor, ...patch }) })); schedule(); },
  setVisual: (patch) => { set((s) => ({ visual: clampVisual({ ...s.visual, ...patch }) })); schedule(); },
  setDecoder: (id) => { set({ decoderId: id }); schedule(0); },
  recalibrate: () => { set((s) => (s.kind === 'visual' ? { visualCalib: s.visual } : { motorCalib: s.motor })); schedule(0); },
  resetParams: () => { set({ motor: DEFAULT_MOTOR, motorCalib: DEFAULT_MOTOR, visual: DEFAULT_VISUAL, visualCalib: DEFAULT_VISUAL, decoderId: 'linear' }); schedule(0); },
  setStage: (n) => set({ stage: Math.max(1, Math.min(8, Math.round(n))) }),
  setMode: (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* unavailable */ } set({ mode: m }); },
  setView: (v) => set({ view: v, follow: false }),
  setFollow: (f) => set({ follow: f }),

  run: () => {
    const s = get();
    if (!s.kind) return;
    const mine = ++want;
    set({ status: 'computing', error: null });
    const req = s.kind === 'motor'
      ? simulate<MotorSession>({ kind: 'motor', params: s.motor, decoderId: s.decoderId, calib: s.motorCalib })
      : simulate<VisualSession>({ kind: 'visual', params: s.visual, calib: s.visualCalib });
    req.then(
      (session) => { if (mine === want && get().kind === session.kind) set((st) => ({ session, status: 'ready', resultNonce: st.resultNonce + 1 })); },
      (e: Error) => { if (mine === want) set({ status: 'error', error: e.message }); },
    );
  },
  runBench: () => {
    if (get().benchStatus === 'computing') return;
    set({ benchStatus: 'computing', benchProgress: null });
    simulate<BenchResult>({ kind: 'bench' }, (p) => set({ benchProgress: p })).then(
      (bench) => set({ bench, benchStatus: 'ready', benchProgress: null }),
      () => set({ benchStatus: 'error', benchProgress: null }),
    );
  },
}));

/** Recompute shortly after the last change (sliders fire many changes while they are dragged). */
function schedule(delayMs = 160) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => useExperiment.getState().run(), delayMs);
}
