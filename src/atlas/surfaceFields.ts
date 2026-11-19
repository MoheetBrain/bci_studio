// Smooth per-vertex fields on the specimen surface. Pure functions (typed arrays in, typed arrays out), unit-tested
// in tests/surface-fields.test.ts.
//
// A region id is a per-vertex label, so a border drawn straight from the labels follows the triangle edges and looks
// like a saw. Instead, an indicator (1 inside, 0 outside) is relaxed over the mesh for a few passes and the border
// is drawn at its 0.5 contour, which is smooth. Only how a border is DRAWN changes; which region a point belongs to
// is still decided by the label of its nearest vertex.

export interface Adjacency { start: Uint32Array; list: Uint32Array }

/**
 * Neighbours of every vertex in CSR form, from the outgoing half-edges of each triangle. On a closed, consistently
 * wound surface every neighbour appears exactly once.
 */
export function halfEdgeAdjacency(vertexCount: number, index: ArrayLike<number>): Adjacency {
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < index.length; i++) start[index[i] + 1]++;
  for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v];
  const fill = start.slice(0, vertexCount);
  const list = new Uint32Array(index.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    list[fill[a]++] = b; list[fill[b]++] = c; list[fill[c]++] = a;
  }
  return { start, list };
}

/** One relaxation pass: each value moves half-way to the mean of its neighbours. */
function relax(src: Float32Array, dst: Float32Array, adj: Adjacency): void {
  const { start, list } = adj;
  for (let v = 0; v < src.length; v++) {
    const a = start[v], b = start[v + 1];
    if (b === a) { dst[v] = src[v]; continue; }
    let sum = 0;
    for (let i = a; i < b; i++) sum += src[list[i]];
    dst[v] = 0.5 * src[v] + 0.5 * (sum / (b - a));
  }
}

/**
 * Smoothed selection mask, 0–255 per vertex. `selected[r]` is non-zero for every selected region index (the same
 * 1-based index the vertices carry). Returns all zeros when nothing on the surface is selected.
 */
export function selectionField(region: Uint8Array, selected: Uint8Array, adj: Adjacency, passes = 3, out?: Uint8Array): Uint8Array {
  const n = region.length;
  const res = out ?? new Uint8Array(n);
  let a = new Float32Array(n), any = false;
  for (let v = 0; v < n; v++) if (selected[region[v]]) { a[v] = 1; any = true; }
  if (!any) { res.fill(0); return res; }
  let b = new Float32Array(n);
  for (let p = 0; p < passes; p++) { relax(a, b, adj); [a, b] = [b, a]; }
  for (let v = 0; v < n; v++) res[v] = Math.round(a[v] * 255);
  return res;
}

/**
 * Give every region a class 0 … maxClasses-1 so that regions sharing a border get different classes (greedy
 * colouring in smallest-last order). Returns the class per region index and how many pairs of neighbouring regions
 * could not be separated (0 in practice; a clash only means one border line is not drawn).
 */
export function colourRegions(region: Uint8Array, adj: Adjacency, maxClasses = 8): { classOf: Uint8Array; classes: number; clashes: number } {
  const N = 256;
  const nb: Array<Set<number>> = Array.from({ length: N }, () => new Set<number>());
  const present = new Uint8Array(N);
  for (let v = 0; v < region.length; v++) {
    const r = region[v];
    present[r] = 1;
    for (let i = adj.start[v]; i < adj.start[v + 1]; i++) { const q = region[adj.list[i]]; if (q !== r) { nb[r].add(q); nb[q].add(r); } }
  }
  // smallest-last ordering: repeatedly remove the node of least remaining degree; colour in reverse
  const deg = nb.map((s) => s.size);
  const removed = new Uint8Array(N);
  const order: number[] = [];
  const nodes: number[] = [];
  for (let r = 0; r < N; r++) if (present[r]) nodes.push(r);
  for (let k = 0; k < nodes.length; k++) {
    let best = -1;
    for (const r of nodes) if (!removed[r] && (best < 0 || deg[r] < deg[best])) best = r;
    removed[best] = 1; order.push(best);
    for (const q of nb[best]) if (!removed[q]) deg[q]--;
  }
  const classOf = new Uint8Array(N).fill(255);
  let classes = 0, clashes = 0;
  for (let k = order.length - 1; k >= 0; k--) {
    const r = order[k];
    let used = 0;
    for (const q of nb[r]) if (classOf[q] !== 255) used |= 1 << classOf[q];
    let c = 0;
    while (c < maxClasses && (used >> c) & 1) c++;
    if (c >= maxClasses) { c = maxClasses - 1; clashes++; }
    classOf[r] = c;
    classes = Math.max(classes, c + 1);
  }
  for (let r = 0; r < N; r++) if (classOf[r] === 255) classOf[r] = 0;
  return { classOf, classes, clashes };
}

/**
 * Eight smoothed class-membership fields, interleaved (8 bytes per vertex). The border between two regions is where
 * the two largest fields are equal.
 */
export function parcelFields(region: Uint8Array, classOf: Uint8Array, adj: Adjacency, passes = 2): Uint8Array {
  const n = region.length;
  const out = new Uint8Array(n * 8);
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let c = 0; c < 8; c++) {
    let any = false;
    for (let v = 0; v < n; v++) { const on = classOf[region[v]] === c; a[v] = on ? 1 : 0; any ||= on; }
    if (!any) continue;
    for (let p = 0; p < passes; p++) { relax(a, b, adj); [a, b] = [b, a]; }
    for (let v = 0; v < n; v++) out[v * 8 + c] = Math.round(a[v] * 255);
  }
  return out;
}
