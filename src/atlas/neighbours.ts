// Which atlas regions border which on the specimen surface. Pure; unit-tested in tests/surface-fields.test.ts.
// ATLAS-DERIVED: read from the label of every surface vertex and the mesh's own edges, nothing else.
import type { Adjacency } from './surfaceFields.ts';

export interface Neighbour {
  /** 1-based region index (into manifest.structures), as stored per vertex. */
  region: number;
  /** Number of mesh edges that cross this border: a proxy for the length of the shared border. */
  edges: number;
}

/** For every region on the surface: its neighbours, longest shared border first. Region 0 (unlabelled) is ignored. */
export function regionNeighbours(region: Uint8Array, adj: Adjacency): Map<number, Neighbour[]> {
  const counts = new Map<number, Map<number, number>>();
  for (let v = 0; v < region.length; v++) {
    const a = region[v];
    if (!a) continue;
    for (let k = adj.start[v]; k < adj.start[v + 1]; k++) {
      const w = adj.list[k];
      const b = region[w];
      if (!b || b === a || w < v) continue;          // each undirected edge once
      for (const [x, y] of [[a, b], [b, a]] as const) {
        let m = counts.get(x);
        if (!m) counts.set(x, (m = new Map()));
        m.set(y, (m.get(y) ?? 0) + 1);
      }
    }
  }
  const out = new Map<number, Neighbour[]>();
  for (const [r, m] of counts) out.set(r, [...m].map(([region, edges]) => ({ region, edges })).sort((p, q) => q.edges - p.edges || p.region - q.region));
  return out;
}

/** Number of surface vertices per region (index 0 = unlabelled). */
export function regionVertexCounts(region: Uint8Array): Uint32Array {
  const n = new Uint32Array(256);
  for (let v = 0; v < region.length; v++) n[region[v]]++;
  return n;
}
