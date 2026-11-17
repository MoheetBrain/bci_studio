// v0.3 representation lab state: one channel + one interval shared by every linked view.
// Sources: DEMO (featureModel.ts, browser) or RTL (rtl_trace_v03.json, actual Icarus values).
import { create } from 'zustand';
import type { RtlTraceV03, V03Record } from '../artifacts/types';
import type { ProcMode } from '../model/types';
import { DEFAULT_FEATURE, FS, NUM_CH, runReadout, teachingScenario, type DemoRecord } from './featureModel';
import { useScene } from '../state/sceneStore';
import type { CoreConfig } from './model';

export type LabTab = 'signals' | 'repr' | 'payload' | 'loop' | 'experiment' | 'ai';

export interface ChannelView {
  x: number[];          // input codes, per-channel sample index t
  y: number[];          // filtered (biquad) output
  ysat: number[];
  acc: number[];        // energy accumulator before this sample
  cnt: number[];
  done: number[];
  gi: number[];         // global sample index for each t
}
export interface ReprData {
  source: 'demo' | 'rtl';
  fs: number;
  T: number;
  channels: ChannelView[];
  /** feature records per channel: { t (window end), energy, sat } */
  energy: { t: number; e: number; sat: boolean; seq: number }[][];
  events: { t: number; pol: number; mag: number; seq: number }[][];
  records: Record<ProcMode, (DemoRecord | V03Record)[]>;
  stats: Partial<Record<ProcMode, { drops: number; recordBits: number }>>;
  truth: { channels: { ch: number; description: string }[]; bursts: { ch: number; t0: number; t1: number; fHz: number }[]; spikes: { ch: number; t: number }[] };
  config: { core: CoreConfig; feature: typeof DEFAULT_FEATURE };
}

const CORE: CoreConfig = { threshold: 600, hysteresis: 150, refractory: 8, alphaShift: 5 };

function buildDemo(T: number, noise: number, seed: number, injected: { ch: number; t: number }[]): ReprData {
  const { x, truth } = teachingScenario(T, noise, seed, injected);
  const run = runReadout(x, CORE, DEFAULT_FEATURE);
  const channels: ChannelView[] = Array.from({ length: NUM_CH }, (_, ch) => {
    const s = Array.from({ length: T }, (_, t) => run.samples[t * NUM_CH + ch]);
    return { x: s.map((v) => v.x), y: s.map((v) => v.y), ysat: s.map((v) => v.ysat), acc: s.map((v) => v.acc), cnt: s.map((v) => v.cnt), done: s.map((v) => v.done), gi: s.map((v) => v.i) };
  });
  const energy = Array.from({ length: NUM_CH }, () => [] as ReprData['energy'][number]);
  for (const r of run.records.FEATURE) energy[r.ch].push({ t: Math.floor(r.ts / NUM_CH), e: r.data, sat: (r.flags & 1) === 1, seq: r.seq });
  const events = Array.from({ length: NUM_CH }, () => [] as ReprData['events'][number]);
  for (const r of run.records.EVENT) events[r.ch].push({ t: Math.floor(r.ts / NUM_CH), pol: (r.data >> 16) & 1, mag: r.data & 0xffff, seq: r.seq });
  return {
    source: 'demo', fs: FS, T, channels, energy, events, records: run.records, stats: {},
    truth: { channels: truth.channels, bursts: truth.bursts.map((b) => ({ ch: b.ch, t0: b.t0, t1: b.t1, fHz: b.fHz })), spikes: truth.spikes.map((s) => ({ ch: s.ch, t: s.t })) },
    config: { core: CORE, feature: DEFAULT_FEATURE },
  };
}

/** Adapt the RTL trace without recomputing anything. */
export function buildRtl(tr: RtlTraceV03): ReprData {
  const channels: ChannelView[] = Array.from({ length: tr.profile.num_channels }, () => ({ x: [], y: [], ysat: [], acc: [], cnt: [], done: [], gi: [] }));
  const tOf = new Map<number, { ch: number; t: number }>();
  for (const s of tr.samples) {
    const c = channels[s.ch];
    tOf.set(s.i, { ch: s.ch, t: c.x.length });
    c.x.push(s.x); c.y.push(s.y); c.ysat.push(s.ysat); c.acc.push(s.acc); c.cnt.push(s.cnt); c.done.push(s.done); c.gi.push(s.i);
  }
  const t = (i: number) => tOf.get(i)?.t ?? 0;
  const energy = channels.map(() => [] as ReprData['energy'][number]);
  for (const r of tr.runs.FEATURE.records) if (r.type === 2) energy[r.ch].push({ t: t(r.ts), e: r.data, sat: (r.flags & 1) === 1, seq: r.seq });
  const events = channels.map(() => [] as ReprData['events'][number]);
  for (const r of tr.runs.EVENT.records) if (r.type === 1) events[r.ch].push({ t: t(r.ts), pol: (r.data >> 16) & 1, mag: r.data & 0xffff, seq: r.seq });
  const stats: ReprData['stats'] = {};
  (['EVENT', 'RAW', 'FEATURE', 'HYBRID'] as ProcMode[]).forEach((m) => {
    const st = tr.runs[m].stats;
    stats[m] = { drops: st.drop_raw + st.drop_event + st.drop_feature, recordBits: st.record_bits };
  });
  return {
    source: 'rtl', fs: tr.profile.sample_rate_hz, T: Math.max(...channels.map((c) => c.x.length)), channels, energy, events,
    records: { EVENT: tr.runs.EVENT.records, RAW: tr.runs.RAW.records, FEATURE: tr.runs.FEATURE.records, HYBRID: tr.runs.HYBRID.records },
    stats,
    truth: {
      channels: tr.ground_truth.channels,
      bursts: tr.ground_truth.bursts.map((b) => ({ ch: b.ch, t0: t(b.i0), t1: t(b.i1), fHz: b.f_hz })),
      spikes: tr.ground_truth.spikes.map((s) => ({ ch: s.ch, t: t(s.i) })),
    },
    config: {
      core: { threshold: tr.config.threshold, hysteresis: tr.config.hysteresis, refractory: tr.config.refractory, alphaShift: tr.config.alpha_shift },
      feature: { b0: tr.config.b0, b1: tr.config.b1, b2: tr.config.b2, a1: tr.config.a1, a2: tr.config.a2, winLog2: tr.config.win_log2, energyShift: tr.config.energy_shift },
    },
  };
}

/** Data-flow stages per mode for one sample (component ids lit in 3D and the block diagram). */
export function v03Flow(mode: ProcMode, emits: { feature: boolean; event: boolean }): string[][] {
  const tail = ['rtl.u_records'];
  switch (mode) {
    case 'RAW': return [['rtl.readout'], ['rtl.raw_path'], tail];
    case 'FEATURE': return [['rtl.readout'], ['rtl.u_fstate'], ['rtl.u_biquad'], ['rtl.u_energy'], ...(emits.feature ? [tail] : [])];
    case 'HYBRID': return [['rtl.readout'], ['rtl.raw_path', 'rtl.u_fstate'], ['rtl.raw_path', 'rtl.u_biquad'], ['rtl.raw_path', 'rtl.u_energy'], tail];
    case 'EVENT': return [['rtl.readout'], ['rtl.core', 'rtl.u_state'], ['rtl.core', 'rtl.u_baseline'], ['rtl.core', 'rtl.u_threshold'], ['rtl.core', 'rtl.u_refractory'], ...(emits.event ? [['rtl.core', 'rtl.u_packer'], tail] : [])];
  }
}

interface V03State {
  tab: LabTab;
  source: 'demo' | 'rtl';
  ch: number;
  t0: number;
  t1: number;
  sel: number | null;           // selected per-channel sample index
  noise: number;
  seed: number;
  injected: { ch: number; t: number }[];
  demo: ReprData;
  flowStage: number | null;
  setTab: (t: LabTab) => void;
  setSource: (s: 'demo' | 'rtl') => void;
  setCh: (c: number) => void;
  setInterval: (a: number, b: number) => void;
  select: (t: number | null) => void;
  setNoise: (n: number) => void;
  injectBurst: () => void;
  setFlowStage: (n: number | null) => void;
}

const DEMO_T = 500;

export const useV03 = create<V03State>((set, get) => ({
  tab: 'repr',
  source: 'demo',
  ch: 1,
  t0: 120,
  t1: 376,
  sel: null,
  noise: 120,
  seed: 2026,
  injected: [],
  demo: buildDemo(DEMO_T, 120, 2026, []),
  flowStage: null,
  setTab: (t) => set({ tab: t }),
  setSource: (s) => set({ source: s, sel: null }),
  setCh: (c) => set({ ch: c, sel: null }),
  setInterval: (a, b) => {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.max(lo + 16, Math.max(a, b));
    set({ t0: Math.round(lo), t1: Math.round(hi) });
  },
  select: (t) => set({ sel: t }),
  setNoise: (n) => set({ noise: n, demo: buildDemo(DEMO_T, n, get().seed, get().injected) }),
  injectBurst: () => {
    const s = get();
    const t = Math.min(DEMO_T - 70, Math.max(0, Math.round((s.t0 + s.t1) / 2) - 30));
    const injected = [...s.injected, { ch: s.ch, t }];
    set({ injected, source: 'demo', demo: buildDemo(DEMO_T, s.noise, s.seed, injected), sel: t + 30 });
  },
  setFlowStage: (n) => {
    set({ flowStage: n });
    if (n === null) useScene.getState().setActiveBlocks([], null);
  },
}));
