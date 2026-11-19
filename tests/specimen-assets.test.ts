// Integrity of the specimen surface and slice volumes (public/atlas/spl-nac/specimen.*, slices-*): hashes, decoding,
// closedness, and — most importantly — that the surface really is in register with the atlas: region ids on the
// surface must sit where the atlas's own model of that region sits, and left must be the subject's left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer';
import type { AtlasManifest, SpecimenMeta } from '../src/atlas/types.ts';
import { regionAt } from '../src/atlas/visibility.ts';
import { colourRegions, halfEdgeAdjacency } from '../src/atlas/surfaceFields.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/atlas/spl-nac');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as AtlasManifest;
const meta = JSON.parse(readFileSync(join(dir, 'specimen.json'), 'utf8')) as SpecimenMeta;
const bin = new Uint8Array(readFileSync(join(dir, meta.mesh.file)));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

await MeshoptDecoder.ready;
const m = meta.mesh, q = manifest.quantisation;
const vtx = new Uint8Array(m.vertexCount * m.vertexStride);
MeshoptDecoder.decodeVertexBuffer(vtx, m.vertexCount, m.vertexStride, bin.subarray(0, m.vertexBytes));
const index = new Uint32Array(m.indexCount);
MeshoptDecoder.decodeIndexBuffer(new Uint8Array(index.buffer), m.indexCount, 4, bin.subarray(m.vertexBytes, m.vertexBytes + m.indexBytes));
const dv = new DataView(vtx.buffer);
const pos = new Float32Array(m.vertexCount * 3), region = new Uint8Array(m.vertexCount), side = new Uint8Array(m.vertexCount);
for (let v = 0; v < m.vertexCount; v++) {
  const o = v * m.vertexStride;
  for (let k = 0; k < 3; k++) pos[v * 3 + k] = dv.getInt16(o + k * 2, true) * q.scaleMm + q.offsetMm[k];
  region[v] = vtx[o + 10]; side[v] = vtx[o + 11] & 3;
}

test('specimen metadata names its source, licence, parameters and what it is', () => {
  assert.equal(meta.format, 'hbci-specimen/1');
  assert.equal(meta.dataset.commit, manifest.dataset.commit);
  assert.match(meta.what, /derived rendering surface/);
  assert.match(meta.what, /not a validated pial surface/);
  assert.equal(meta.source.image.voxelMm, 0.75);
  assert.match(meta.source.image.sha256, /^[0-9a-f]{64}$/);
  assert.match(meta.source.labels.sha256, /^[0-9a-f]{64}$/);
});

test('specimen.bin matches the recorded size and sha256, and decodes to the recorded counts', () => {
  assert.equal(bin.byteLength, m.bytes);
  assert.equal(sha(bin), m.sha256);
  assert.equal(m.vertexBytes + m.indexBytes, m.bytes);
  assert.equal(m.indexCount, m.triangles * 3);
  for (let i = 0; i < index.length; i++) assert.ok(index[i] < m.vertexCount);
});

test('the surface is one closed, consistently wound sheet inside its recorded bounds', () => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < m.vertexCount; v++) for (let k = 0; k < 3; k++) { const c = pos[v * 3 + k]; assert.ok(Number.isFinite(c)); lo[k] = Math.min(lo[k], c); hi[k] = Math.max(hi[k], c); }
  for (let k = 0; k < 3; k++) { assert.ok(Math.abs(lo[k] - m.boundsMm[0][k]) < 0.02); assert.ok(Math.abs(hi[k] - m.boundsMm[1][k]) < 0.02); }
  // Closed: every directed edge is matched by the opposite one. Surface nets and decimation leave a handful of
  // pinched (non-manifold) edges, so this is measured and bounded rather than assumed to be exactly zero.
  const edges = new Map<number, number>();
  let vol = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const key = x * m.vertexCount + y; edges.set(key, (edges.get(key) ?? 0) + 1); }
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2], cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let open = 0, pinched = 0;
  for (const [key, n] of edges) {
    const x = Math.floor(key / m.vertexCount), y = key % m.vertexCount;
    const back = edges.get(y * m.vertexCount + x) ?? 0;
    if (back === 0) open++;
    if (n > 1) pinched++;
  }
  assert.equal(open, 0, `${open} edges have no opposite (holes in the surface)`);
  // measured at build time: about 0.2 % of edges are pinched (where two folds touch); they do not open the surface
  assert.ok(pinched / edges.size < 5e-3, `${pinched} of ${edges.size} directed edges are shared by more than two triangles`);
  // a human brain: roughly 1.0 – 1.6 litres enclosed by this surface
  assert.ok(vol > 0.9e6 && vol < 1.7e6, `enclosed volume ${(vol / 1e6).toFixed(2)} l`);
});

test('every vertex has a region; counts per structure are as recorded', () => {
  const count = new Map<number, number>();
  for (const r of region) { assert.ok(r <= manifest.structures.length); count.set(r, (count.get(r) ?? 0) + 1); }
  assert.equal(count.get(0) ?? 0, meta.regions.unlabelledVertices);
  assert.equal(count.size - (count.has(0) ? 1 : 0), meta.regions.structuresOnSurface);
  for (const [r, n] of count) if (r) assert.equal(meta.regions.verticesPerStructure[manifest.structures[r - 1].id], n);
  assert.ok(meta.regions.unlabelledFraction < 0.01);
  assert.ok(meta.regions.borderTidy.changedFraction < 0.05, 'border tidying must stay a small correction');
});

test('registration: surface vertices of a region lie on that region’s own atlas model', () => {
  // For every region with a meaningful patch of surface, the patch must sit inside the atlas model's bounding box
  // (grown by 4 mm: the surface is the outer boundary, the model a 1 mm label shell, and borders were tidied).
  let checked = 0, worst = 0;
  const lo = new Map<number, number[]>(), hi = new Map<number, number[]>(), n = new Map<number, number>();
  for (let v = 0; v < m.vertexCount; v++) {
    const r = region[v]; if (!r) continue;
    if (!lo.has(r)) { lo.set(r, [Infinity, Infinity, Infinity]); hi.set(r, [-Infinity, -Infinity, -Infinity]); }
    const s = manifest.structures[r - 1], a = lo.get(r)!, b = hi.get(r)!;
    n.set(r, (n.get(r) ?? 0) + 1);
    for (let k = 0; k < 3; k++) {
      const c = pos[v * 3 + k]; a[k] = Math.min(a[k], c); b[k] = Math.max(b[k], c);
      worst = Math.max(worst, s.boundsMm[0][k] - c, c - s.boundsMm[1][k]);
    }
  }
  for (const [r, cnt] of n) {
    if (cnt < 200) continue;
    const s = manifest.structures[r - 1], a = lo.get(r)!, b = hi.get(r)!;
    for (let k = 0; k < 3; k++) {
      assert.ok(a[k] >= s.boundsMm[0][k] - 4 && b[k] <= s.boundsMm[1][k] + 4, `${s.id}: surface patch [${a[k].toFixed(1)}, ${b[k].toFixed(1)}] vs model [${s.boundsMm[0][k]}, ${s.boundsMm[1][k]}] on axis ${k}`);
    }
    checked++;
  }
  assert.ok(checked > 120, `only ${checked} regions were large enough to check`);
  assert.ok(worst < 4.5, `worst overshoot ${worst.toFixed(2)} mm`);
});

test('left is the subject’s left: hemisphere flags agree with the structure and with the mid-sagittal plane', () => {
  const pl = manifest.space.midSagittalPlane;
  let wrong = 0, sided = 0;
  for (let v = 0; v < m.vertexCount; v++) {
    const r = region[v], s = r ? manifest.structures[r - 1] : null;
    if (s && s.hemisphere !== 'midline') assert.equal(side[v], s.hemisphere === 'left' ? 1 : 2);
    if (!side[v]) continue;
    sided++;
    const d = pos[v * 3] - (pl.a + pl.b * pos[v * 3 + 1] + pl.c * pos[v * 3 + 2]);
    if (Math.abs(d) > 6 && (d < 0) !== (side[v] === 1)) wrong++;
  }
  assert.ok(sided > m.vertexCount * 0.8);
  assert.ok(wrong / sided < 0.002, `${wrong} of ${sided} sided vertices lie more than 6 mm on the wrong side of the mid-plane`);
});

test('motor landmarks on the surface: precentral gyrus in front of postcentral, on both sides', () => {
  const centroid = (id: string) => {
    const r = manifest.structures.findIndex((s) => s.id === id) + 1;
    assert.ok(r > 0, id);
    let x = 0, y = 0, z = 0, c = 0;
    for (let v = 0; v < m.vertexCount; v++) if (region[v] === r) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; c++; }
    assert.ok(c > 1000, `${id} has only ${c} surface vertices`);
    return [x / c, y / c, z / c];
  };
  for (const h of ['left', 'right']) {
    const pre = centroid(`${h}_precentral_gyrus`), post = centroid(`${h}_postcentral_gyrus`);
    assert.ok(pre[1] > post[1] + 5, `${h}: precentral A ${pre[1].toFixed(1)} should be anterior to postcentral A ${post[1].toFixed(1)}`);
    assert.ok(h === 'left' ? pre[0] < -15 : pre[0] > 15, `${h} precentral gyrus at R ${pre[0].toFixed(1)}`);
    assert.ok(pre[2] > 20, 'the precentral gyrus lies on the upper convexity');
  }
});

test('region classes for the border lines separate every pair of neighbouring regions', () => {
  const adj = halfEdgeAdjacency(m.vertexCount, index);
  const { classes, clashes } = colourRegions(region, adj);
  assert.equal(clashes, 0);
  assert.ok(classes <= 8, `${classes} classes`);
});

test('slice volumes: recorded hashes and sizes; the region volume agrees with the surface labels', () => {
  const s = meta.slices, n = s.dims[0] * s.dims[1] * s.dims[2];
  const t1gz = new Uint8Array(readFileSync(join(dir, s.t1.file))), rgz = new Uint8Array(readFileSync(join(dir, s.region.file)));
  assert.equal(sha(t1gz), s.t1.sha256); assert.equal(sha(rgz), s.region.sha256);
  const t1 = new Uint8Array(gunzipSync(t1gz)), reg = new Uint8Array(gunzipSync(rgz));
  assert.equal(t1.length, n); assert.equal(reg.length, n);
  for (const r of reg) assert.ok(r <= manifest.structures.length);
  const vol = { dims: s.dims, originMm: s.originMm, region: reg, t1 };
  // a structure's centroid falls in a voxel of that structure, for big compact deep structures
  for (const id of ['left_thalamus', 'right_thalamus', 'left_putamen', 'right_putamen']) {
    const i = manifest.structures.findIndex((x) => x.id === id);
    if (i < 0) continue;
    const at = regionAt(vol, manifest.structures[i].centroidMm);
    assert.equal(at.region, i + 1, `${id}: voxel at the centroid is region ${at.region}`);
    assert.ok(at.t1 > 0, 'the MRI is present inside the brain');
  }
  // one millimetre beneath a sample of surface vertices, the volume holds brain, and mostly the same region
  let same = 0, inBrain = 0, tried = 0;
  const nrm = (v: number, k: number) => dv.getInt8(v * m.vertexStride + 6 + k) / 127;
  for (let v = 0; v < m.vertexCount; v += 97) {
    if (!region[v]) continue;
    tried++;
    const p: [number, number, number] = [pos[v * 3] - 1.5 * nrm(v, 0), pos[v * 3 + 1] - 1.5 * nrm(v, 1), pos[v * 3 + 2] - 1.5 * nrm(v, 2)];
    const at = regionAt(vol, p);
    if (at.t1 > 0) inBrain++;
    if (at.region === region[v]) same++;
  }
  assert.ok(inBrain / tried > 0.99, `${inBrain}/${tried} probes hit the MRI`);
  assert.ok(same / tried > 0.80, `${same}/${tried} probes agree with the surface label`);
});
