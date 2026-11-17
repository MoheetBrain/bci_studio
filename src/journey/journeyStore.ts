// State of the signal-journey lesson. Three different "times" are kept apart on purpose:
//   • stageIndex      — where the learner is in the explanation (instructional sequence; no physical meaning);
//   • tMs             — signal time inside the simulated window (the playhead over the waveforms);
//   • sample index n  — derived from tMs and the sample rate: the chip's own timestamp for a sample.
// Playback speed converts wall-clock seconds into signal milliseconds. None of these is a hardware clock cycle.
import { create } from 'zustand';
import { DEFAULT_PARAMS, runChain, validateParams, type ChainParams, type ChainResult } from './model/chain';
import { STAGES } from './stages';

export type Zoom = 'all' | '40' | '8';
export type PresetId = 'spikes' | 'gamma' | 'aliasing' | 'saturation' | 'coarse';

export const PRESETS: Array<{ id: PresetId; label: string; blurb: string; params: ChainParams; stage: string; zoom: Zoom; tMs: number }> = [
  { id: 'spikes', label: 'Spikes at 30 kS/s', blurb: 'Three neurons near one contact; the chip’s threshold detector picks out the two closest.', params: DEFAULT_PARAMS, stage: 'source', zoom: 'all', tMs: 0 },
  {
    id: 'gamma', label: 'Gamma-band burst at 2 kS/s', blurb: 'A slower field signal sampled at the rate the chip’s band-pass was designed for; band energy rises during the burst.',
    params: { ...DEFAULT_PARAMS, durationMs: 400, units: [{ distanceUm: 120, rateHz: 15 }], backgroundUvRms: 5, lfpUvPk: 80, lfpHz: 9, gammaUvPk: 120, gammaHz: 100, gammaStartMs: 150, gammaEndMs: 300,
      gain: 1000, hpHz: 1, lpHz: 500, fsHz: 2000, core: { ...DEFAULT_PARAMS.core, threshold: 0 } },
    stage: 'digital', zoom: 'all', tMs: 0,
  },
  {
    id: 'aliasing', label: 'Aliasing', blurb: 'A 7 kHz tone, a 10 kS/s converter and a low-pass set too wide: the tone reappears at 3 kHz. Lower the low-pass corner to remove it.',
    params: { ...DEFAULT_PARAMS, units: [{ distanceUm: 60, rateHz: 0 }], backgroundUvRms: 2, lfpUvPk: 0, interfererUvPk: 200, interfererHz: 7000, lpHz: 20000, hpHz: 100, fsHz: 10000, core: { ...DEFAULT_PARAMS.core, threshold: 0 } },
    stage: 'adc', zoom: '8', tMs: 50,
  },
  {
    id: 'saturation', label: 'Amplifier saturation', blurb: 'High-pass switched off: the 25 mV electrode offset is amplified 400× and the output sits on the rail. Raise the high-pass corner to recover.',
    params: { ...DEFAULT_PARAMS, hpHz: 0 }, stage: 'afe', zoom: 'all', tMs: 0,
  },
  {
    id: 'coarse', label: 'Coarse quantisation', blurb: 'Six bits and low gain: one code step is larger than the smaller spikes.',
    params: { ...DEFAULT_PARAMS, bits: 6, gain: 100, core: { ...DEFAULT_PARAMS.core, threshold: 2048 } }, stage: 'adc', zoom: '40', tMs: 30,
  },
];

interface JourneyState {
  params: ChainParams;
  result: ChainResult;
  errors: string[];
  preset: PresetId | null;
  stageIndex: number;
  tMs: number;
  playing: boolean;
  /** Signal milliseconds advanced per wall-clock second. */
  speed: number;
  zoom: Zoom;
  setParams: (patch: Partial<ChainParams>) => void;
  setCore: (patch: Partial<ChainParams['core']>) => void;
  setUnitDistance: (index: number, distanceUm: number) => void;
  applyPreset: (id: PresetId) => void;
  setStage: (index: number) => void;
  stepStage: (dir: 1 | -1) => void;
  seek: (tMs: number) => void;
  setPlaying: (p: boolean) => void;
  restart: () => void;
  setSpeed: (s: number) => void;
  setZoom: (z: Zoom) => void;
}

function compute(prev: JourneyState | null, params: ChainParams): Pick<JourneyState, 'params' | 'result' | 'errors'> {
  const errors = validateParams(params);
  // Invalid input never reaches the model: keep showing the last valid result and say what is wrong.
  if (errors.length && prev) return { params, result: prev.result, errors };
  return { params, result: runChain(params), errors: [] };
}

export const useJourney = create<JourneyState>((set, get) => ({
  ...compute(null, DEFAULT_PARAMS),
  preset: 'spikes',
  stageIndex: 0,
  tMs: 0,
  playing: false,
  speed: 20,
  zoom: 'all',
  setParams: (patch) => set((s) => ({ ...compute(s, { ...s.params, ...patch }), preset: null, tMs: Math.min(s.tMs, patch.durationMs ?? s.params.durationMs) })),
  setCore: (patch) => set((s) => ({ ...compute(s, { ...s.params, core: { ...s.params.core, ...patch } }), preset: null })),
  setUnitDistance: (index, distanceUm) => set((s) => {
    const units = s.params.units.map((u, i) => (i === index ? { ...u, distanceUm } : u));
    return { ...compute(s, { ...s.params, units }), preset: null };
  }),
  applyPreset: (id) => {
    const p = PRESETS.find((x) => x.id === id)!;
    set((s) => ({ ...compute(s, p.params), preset: id, stageIndex: Math.max(0, STAGES.findIndex((st) => st.id === p.stage)), zoom: p.zoom, tMs: p.tMs, playing: false }));
  },
  setStage: (index) => set({ stageIndex: Math.max(0, Math.min(STAGES.length - 1, index)) }),
  stepStage: (dir) => get().setStage(get().stageIndex + dir),
  seek: (tMs) => set((s) => ({ tMs: Math.max(0, Math.min(s.params.durationMs, Number.isFinite(tMs) ? tMs : 0)) })),
  setPlaying: (playing) => set((s) => ({ playing, tMs: playing && s.tMs >= s.params.durationMs - 1e-6 ? 0 : s.tMs })),
  restart: () => set({ tMs: 0, playing: false }),
  setSpeed: (speed) => set({ speed }),
  setZoom: (zoom) => set({ zoom }),
}));
