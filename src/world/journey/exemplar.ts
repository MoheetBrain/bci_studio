// The one reconstructed neuron in the block: loaded from a file made by tools/morph/build-h01-exemplar.mjs, with the
// provenance that file carries. It is STRUCTURE ONLY — branch geometry and calibre of one cell of the H01 release
// (human temporal cortex; CC BY 4.0). No model in this studio computes anything in it, and it is not tissue of the
// precentral gyrus that was entered: it is shown as an exemplar of what a real neuron's arbor looks like.
import { create } from 'zustand';
import type { SkeletonNodes } from '../morph';

export interface ExemplarAsset {
  format: string; what: string;
  provenance: {
    dataset: string; landingPage: string; citation: string; licence: string; licenceUrl: string; licenceStatement: string; collection: string; archive: string; entry: string; entrySha256: string;
    segmentId: string; datasetTags: string[]; species: string; region: string; preparation: string; reconstruction: string;
  };
  labels: { codes: string[]; how: string };
  frame: Record<string, string>;
  changes: string[]; limits: string[];
  counts: { sourceNodes: number; nodes: number; tips: number; dendriteMm: number; axonMm: number; somaRadiusUm: number; extentUm: { x: [number, number]; y: [number, number]; z: [number, number] } };
  nodes: SkeletonNodes;
}
export const EXEMPLAR_ID = 'h01';
export const EXEMPLAR_URL = 'world/h01-exemplar.json';

export const useExemplar = create<{ status: 'idle' | 'loading' | 'ready' | 'error'; asset: ExemplarAsset | null; note: string }>(() => ({ status: 'idle', asset: null, note: '' }));

/** Fetch the asset once. If it cannot be read, the block is drawn without it and the scene says so. */
export function loadExemplar(): void {
  if (useExemplar.getState().status !== 'idle') return;
  useExemplar.setState({ status: 'loading' });
  fetch(`${import.meta.env.BASE_URL}${EXEMPLAR_URL}`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ExemplarAsset>; })
    .then((a) => {
      const n = a?.nodes;
      if (a?.format !== 'hbci-morphology/1' || !n || !Array.isArray(n.x) || n.x.length < 2 || [n.y, n.z, n.r, n.parent, n.label, n.path].some((v) => !Array.isArray(v) || v.length !== n.x.length)) throw new Error('not a morphology file of the expected format');
      useExemplar.setState({ status: 'ready', asset: a });
    })
    .catch((e: unknown) => useExemplar.setState({ status: 'error', note: e instanceof Error ? e.message : String(e) }));
}
