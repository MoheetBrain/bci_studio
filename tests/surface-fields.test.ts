// Smoothed surface fields (src/atlas/surfaceFields.ts) and the meshing helpers the specimen is built with
// (tools/atlas/meshing.mjs), checked on shapes whose answers are known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourRegions, halfEdgeAdjacency, parcelFields, selectionField } from '../src/atlas/surfaceFields.ts';
// @ts-expect-error — plain .mjs build helper without type declarations
import { adjacency, largestComponent, signedVolume, smoothNormals, surfaceArea, surfaceNets, taubinSmooth, vertexNormals } from '../tools/atlas/meshing.mjs';

/** A closed sphere mesh by surface nets, radius r voxels, in a cubic grid. */
function sphere(r: number, n = 40) {
  const field = new Float32Array(n * n * n), c = (n - 1) / 2;
  for (let z = 0, p = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, p++) field[p] = r - Math.hypot(x - c, y - c, z - c);
  const m = surfaceNets(field, [n, n, n]);
  if (signedVolume(m.positions, m.indices) < 0) for (let t = 0; t < m.indices.length; t += 3) { const k = m.indices[t + 1]; m.indices[t + 1] = m.indices[t + 2]; m.indices[t + 2] = k; }
  return { ...m, centre: c };
}

test('surface nets: a sphere comes out closed, with the right volume and area', () => {
  const r = 12, { positions, indices } = sphere(r);
  const vol = signedVolume(positions, indices), area = surfaceArea(positions, indices);
  assert.ok(Math.abs(vol / ((4 / 3) * Math.PI * r ** 3) - 1) < 0.03, `volume off by ${(vol / ((4 / 3) * Math.PI * r ** 3) - 1) * 100} %`);
  assert.ok(Math.abs(area / (4 * Math.PI * r * r) - 1) < 0.08, `area off by ${(area / (4 * Math.PI * r * r) - 1) * 100} %`);
  // closed and manifold: every directed edge has exactly one opposite
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) { const a = indices[t + k], b = indices[t + ((k + 1) % 3)]; edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1); }
  for (const [e, n] of edges) { const [a, b] = e.split('>'); assert.equal(n, 1); assert.equal(edges.get(`${b}>${a}`), 1); }
  // Euler characteristic of a sphere
  assert.equal(positions.length / 3 - edges.size / 2 + indices.length / 3, 2);
});

test('Taubin smoothing removes the voxel staircase without shrinking the shape', () => {
  const r = 12, { positions, indices } = sphere(r);
  const adj = adjacency(positions.length / 3, indices);
  const sm = taubinSmooth(positions, adj, 8);
  const v0 = signedVolume(positions, indices), v1 = signedVolume(sm.positions, indices);
  assert.ok(Math.abs(v1 / v0 - 1) < 0.01, `volume changed by ${(v1 / v0 - 1) * 100} %`);
  assert.ok(sm.displacement.max < 0.6, `a vertex moved ${sm.displacement.max} voxels`);
  // radial scatter gets smaller
  const scatter = (p: Float32Array) => { let s = 0; const c = 19.5; for (let v = 0; v < p.length; v += 3) s += (Math.hypot(p[v] - c, p[v + 1] - c, p[v + 2] - c) - r) ** 2; return Math.sqrt(s / (p.length / 3)); };
  assert.ok(scatter(sm.positions) < scatter(positions));
});

test('normals point outwards, stay unit length, and smoothing them does not flip any', () => {
  const { positions, indices, centre } = sphere(10);
  const n = vertexNormals(positions, indices), adj = adjacency(positions.length / 3, indices);
  const s = smoothNormals(n, adj, 2, 0.6);
  for (let v = 0; v < positions.length; v += 3) {
    const out = [positions[v] - centre, positions[v + 1] - centre, positions[v + 2] - centre], l = Math.hypot(...out);
    const dot = (a: Float32Array) => (a[v] * out[0] + a[v + 1] * out[1] + a[v + 2] * out[2]) / l;
    assert.ok(dot(n) > 0.9 && dot(s) > 0.95);
    assert.ok(Math.abs(Math.hypot(s[v], s[v + 1], s[v + 2]) - 1) < 1e-5);
  }
});

test('largestComponent drops stray pieces', () => {
  const a = sphere(10), b = sphere(3);
  const off = a.positions.length / 3;
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions); positions.set(b.positions.map((v: number) => v + 100), a.positions.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices); indices.set(b.indices.map((i: number) => i + off), a.indices.length);
  const lc = largestComponent(positions, indices);
  assert.equal(lc.components, 2);
  assert.equal(lc.indices.length, a.indices.length);
  assert.equal(lc.positions.length, a.positions.length);
});

test('half-edge adjacency lists every neighbour exactly once on a closed surface', () => {
  const { positions, indices } = sphere(8);
  const n = positions.length / 3, adj = halfEdgeAdjacency(n, indices), ref = adjacency(n, indices);
  for (let v = 0; v < n; v++) {
    const mine = [...adj.list.subarray(adj.start[v], adj.start[v + 1])].sort((x, y) => x - y);
    const theirs = [...ref.list.subarray(ref.start[v], ref.start[v + 1])].sort((x: number, y: number) => x - y);
    assert.deepEqual(mine, theirs);
  }
});

test('selection field: 1 deep inside, 0 far outside, and its 0.5 contour sits on the label border', () => {
  const { positions, indices, centre } = sphere(14);
  const n = positions.length / 3, adj = halfEdgeAdjacency(n, indices);
  // two regions split by the plane x = centre
  const region = new Uint8Array(n);
  for (let v = 0; v < n; v++) region[v] = positions[v * 3] < centre ? 1 : 2;
  const flags = new Uint8Array(256); flags[1] = 1;
  const f = selectionField(region, flags, adj, 3);
  for (let v = 0; v < n; v++) {
    const dx = positions[v * 3] - centre;
    if (dx < -5) assert.equal(f[v], 255);
    if (dx > 5) assert.equal(f[v], 0);
    // the smoothed mask never contradicts the label by more than the border width
    if (region[v] === 1) assert.ok(f[v] >= 110, `inside vertex at ${dx} has ${f[v]}`); else assert.ok(f[v] <= 145, `outside vertex at ${dx} has ${f[v]}`);
  }
  // nothing selected → all zeros, and the buffer passed in is reused
  const out = new Uint8Array(n).fill(9);
  assert.equal(selectionField(region, new Uint8Array(256), adj, 3, out), out);
  assert.ok(out.every((x) => x === 0));
});

test('region classes: neighbours always differ, and the two strongest class fields cross at a border', () => {
  const { positions, indices, centre } = sphere(14);
  const n = positions.length / 3, adj = halfEdgeAdjacency(n, indices);
  // eight regions: the octants
  const region = new Uint8Array(n);
  for (let v = 0; v < n; v++) region[v] = 1 + (positions[v * 3] > centre ? 1 : 0) + (positions[v * 3 + 1] > centre ? 2 : 0) + (positions[v * 3 + 2] > centre ? 4 : 0);
  const { classOf, classes, clashes } = colourRegions(region, adj);
  assert.equal(clashes, 0);
  assert.ok(classes <= 8);
  for (let v = 0; v < n; v++) for (let i = adj.start[v]; i < adj.start[v + 1]; i++) {
    const q = adj.list[i];
    if (region[q] !== region[v]) assert.notEqual(classOf[region[q]], classOf[region[v]]);
  }
  const f = parcelFields(region, classOf, adj, 2);
  for (let v = 0; v < n; v++) {
    const w = f.subarray(v * 8, v * 8 + 8);
    // the vertex's own class is the strongest (or tied) field there
    assert.ok(w[classOf[region[v]]] >= Math.max(...w) - 40);
    let border = false;
    for (let i = adj.start[v]; i < adj.start[v + 1]; i++) if (region[adj.list[i]] !== region[v]) border = true;
    const sorted = [...w].sort((a, b) => b - a);
    if (!border && Math.min(Math.abs(positions[v * 3] - centre), Math.abs(positions[v * 3 + 1] - centre), Math.abs(positions[v * 3 + 2] - centre)) > 5) assert.equal(sorted[0] - sorted[1], 255);
    if (border) assert.ok(sorted[0] - sorted[1] < 200);
  }
});
