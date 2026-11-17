// Loads generated artifacts once and caches them. Missing files resolve to null.
import { create } from 'zustand';
import type { LayoutSummary, Manifest, RtlModules, RtlTrace, RtlTraceV03, RtlTraceV04, Schematics, Sky130Stats, SynthStats, Verification } from './types';

export interface ArtifactState {
  loaded: boolean;
  manifest: Manifest | null;
  verification: Verification | null;
  modules: RtlModules | null;
  synth: SynthStats | null;
  schematics: Schematics | null;
  trace: RtlTrace | null;
  sky130: Sky130Stats | null;
  /** Genuine place-and-route summary; null until `make layout` has produced it. */
  layout: LayoutSummary | null;
  /** v0.3 readout-core trace (make artifacts); null until generated. */
  traceV03: RtlTraceV03 | null;
  sky130V03: Sky130Stats | null;
  /** v0.4 (HBCI-02) integrated-top trace: rtl_trace_v04_real.json when it exists, else rtl_trace_v04.json. */
  traceV04: RtlTraceV04 | null;
  /** The synthetic teaching run (rtl_trace_v04.json), kept separately so the studio can switch streams. */
  traceV04Synth: RtlTraceV04 | null;
  /** Which v0.4 trace file is loaded (the real recording takes precedence over the synthetic teaching run). */
  traceV04File: 'rtl_trace_v04_real.json' | 'rtl_trace_v04.json' | null;
  /** SKY130 HD mapping of hbci02_digital_top (SYNTH). */
  sky130V04: Sky130Stats | null;
  /** Genuine v0.3 readout-core place-and-route (hbci_readout_core) under artifacts/layout_v03/: LAYOUT for v0.3 only. */
  layoutV03: LayoutSummary | null;
  /** Genuine v0.4 place-and-route (hbci02_chip_top) under artifacts/layout_v04/; null until the flow has published it. */
  layoutV04: LayoutSummary | null;
  load: () => Promise<void>;
}

async function getJson<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}artifacts/${name}`, { cache: 'no-cache' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const useArtifacts = create<ArtifactState>((set, get) => ({
  loaded: false,
  manifest: null,
  verification: null,
  modules: null,
  synth: null,
  schematics: null,
  trace: null,
  sky130: null,
  layout: null,
  traceV03: null,
  sky130V03: null,
  traceV04: null,
  traceV04Synth: null,
  traceV04File: null,
  sky130V04: null,
  layoutV03: null,
  layoutV04: null,
  load: async () => {
    if (get().loaded) return;
    const [manifest, verification, modules, synth, schematics, trace, sky130, layout, traceV03, sky130V03, v04real, v04synth, sky130V04, layoutV04raw, layoutV03raw] = await Promise.all([
      getJson<Manifest>('manifest.json'),
      getJson<Verification>('verification.json'),
      getJson<RtlModules>('rtl_modules.json'),
      getJson<SynthStats>('synth_stats.json'),
      getJson<Schematics>('schematics.json'),
      getJson<RtlTrace>('rtl_trace.json'),
      getJson<Sky130Stats>('sky130_stats.json'),
      getJson<LayoutSummary>('layout/layout_summary.json'),
      getJson<RtlTraceV03>('rtl_trace_v03.json'),
      getJson<Sky130Stats>('sky130_stats_v03.json'),
      getJson<RtlTraceV04>('rtl_trace_v04_real.json'),
      getJson<RtlTraceV04>('rtl_trace_v04.json'),
      getJson<Sky130Stats>('sky130_stats_v04.json'),
      getJson<LayoutSummary>('layout_v04/layout_summary.json'),
      getJson<LayoutSummary>('layout_v03/layout_summary.json'),
    ]);
    // Only a completed run with a rendered GDS counts as a genuine layout.
    const isGenuine = (l: LayoutSummary | null) => !!l && l.evidence === 'LAYOUT' && l.status === 'complete' && l.images.length > 0;
    const genuine = isGenuine(layout) ? layout : null;
    const genuineV04 = isGenuine(layoutV04raw) ? layoutV04raw : null;
    const genuineV03 = isGenuine(layoutV03raw) ? layoutV03raw : null;
    const v04 = v04real && Array.isArray(v04real.frames) ? v04real : v04synth && Array.isArray(v04synth.frames) ? v04synth : null;
    const traceV04File = v04 ? (v04 === v04real ? 'rtl_trace_v04_real.json' : 'rtl_trace_v04.json') : null;
    set({ loaded: true, manifest, verification, modules, synth, schematics, trace, sky130, layout: genuine, traceV03, sky130V03, traceV04: v04, traceV04Synth: v04synth && Array.isArray(v04synth.frames) ? v04synth : null, traceV04File, sky130V04, layoutV03: genuineV03, layoutV04: genuineV04 });
  },
}));

export async function fetchText(path: string): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}artifacts/${path}`, { cache: 'no-cache' });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}
