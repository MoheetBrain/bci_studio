// v0.4 on-chip AI pipeline state: which stream (recorded or synthetic) and which frame of rtl_trace_v04(.real).json
// the studio follows. Shared by the lab view, the signal inspector (v0.4 net values), the inspector and the decoder
// lesson. Nothing here is evidence.
import { create } from 'zustand';
import type { RtlTraceV04 } from '../artifacts/types';
import { useArtifacts } from '../artifacts/load';

export type V04Stream = 'real' | 'synthetic';

interface V04State {
  /** Which trace file: the recorded stream (rtl_trace_v04_real.json) when it exists, or the synthetic teaching run. */
  stream: V04Stream;
  /** Index into trace.frames[] (not the frame_id). */
  frame: number;
  /** Which channel's window is expanded in the samples panel. */
  ch: number;
  setStream: (s: V04Stream) => void;
  setFrame: (i: number) => void;
  setCh: (c: number) => void;
}

export const useV04 = create<V04State>((set) => ({
  stream: 'real',
  frame: 0,
  ch: 1,
  setStream: (s) => set({ stream: s, frame: 0 }),
  setFrame: (i) => set({ frame: Math.max(0, Math.round(i)) }),
  setCh: (c) => set({ ch: Math.max(0, Math.min(7, Math.round(c))) }),
}));

/** The v0.4 trace the studio is following: the chosen stream when it exists, else whichever is loaded. */
export function pickTraceV04(a: { traceV04: RtlTraceV04 | null; traceV04Synth: RtlTraceV04 | null }, stream: V04Stream): { trace: RtlTraceV04 | null; file: string | null } {
  const real = a.traceV04 && a.traceV04 !== a.traceV04Synth ? a.traceV04 : null;
  const synth = a.traceV04Synth;
  const t = stream === 'synthetic' ? (synth ?? real) : (real ?? synth);
  return { trace: t, file: t ? (t === real ? 'rtl_trace_v04_real.json' : 'rtl_trace_v04.json') : null };
}

export function useTraceV04(): { trace: RtlTraceV04 | null; file: string | null; hasReal: boolean; hasSynth: boolean } {
  const traceV04 = useArtifacts((a) => a.traceV04);
  const traceV04Synth = useArtifacts((a) => a.traceV04Synth);
  const stream = useV04((s) => s.stream);
  const r = pickTraceV04({ traceV04, traceV04Synth }, stream);
  return { ...r, hasReal: !!traceV04 && traceV04 !== traceV04Synth, hasSynth: !!traceV04Synth };
}
