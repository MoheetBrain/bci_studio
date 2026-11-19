// Integrity of the shipped atlas assets (public/atlas/spl-nac): hashes, decodability, index ranges, finite
// coordinates, recorded bounds, hemisphere naming, label mapping and hierarchy. Runs without the source atlas.
// When reference/spl-brain-atlas is present, the source model hashes are re-checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer';
import type { AtlasManifest } from '../src/atlas/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/atlas/spl-nac');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as AtlasManifest;
const chunks = manifest.chunks.map((c) => new Uint8Array(readFileSync(join(dir, c.file))));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const byId = new Map(manifest.structures.map((s) => [s.id, s]));
const groups = new Map(manifest.groups.map((g) => [g.id, g]));

test('manifest identifies its dataset, release, licence and coordinate space', () => {
  assert.equal(manifest.format, 'hbci-atlas/1');
  assert.match(manifest.dataset.commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.dataset.repository, 'https://github.com/mhalle/spl-brain-atlas');
  assert.match(manifest.dataset.licence, /3D Slicer License/);
  assert.equal(manifest.space.units, 'mm');
  assert.match(manifest.space.orientation, /^RAS/);
  assert.match(manifest.space.notStandardised, /NOT MNI/);
});

test('chunk files match the recorded size and sha256', () => {
  manifest.chunks.forEach((c, i) => {
    assert.equal(chunks[i].byteLength, c.bytes, c.file);
    assert.equal(sha(chunks[i]), c.sha256, c.file);
  });
});

test('every structure decodes: valid indices, finite coordinates, recorded bounds and counts', async () => {
  await MeshoptDecoder.ready;
  const q = manifest.quantisation;
  let triangles = 0;
  for (const s of manifest.structures) {
    const chunk = chunks[s.chunk];
    const vtx = new Uint8Array(s.vertexCount * q.vertexStride);
    MeshoptDecoder.decodeVertexBuffer(vtx, s.vertexCount, q.vertexStride, chunk.subarray(s.vertexOffset, s.vertexOffset + s.vertexBytes));
    const idxB = new Uint8Array(s.indexCount * 4);
    MeshoptDecoder.decodeIndexBuffer(idxB, s.indexCount, 4, chunk.subarray(s.indexOffset, s.indexOffset + s.indexBytes));
    const idx = new Uint32Array(idxB.buffer);
    assert.equal(s.indexCount % 3, 0, `${s.id}: index count not a multiple of 3`);
    assert.equal(s.indexCount / 3, s.model.triangles, `${s.id}: triangle count`);
    assert.equal(s.vertexCount, s.model.vertices, `${s.id}: vertex count`);
    let maxIdx = 0;
    for (const i of idx) if (i > maxIdx) maxIdx = i;
    assert.ok(maxIdx < s.vertexCount, `${s.id}: index ${maxIdx} out of range`);
    const dv = new DataView(vtx.buffer);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < s.vertexCount; v++) {
      let nn = 0;
      for (let k = 0; k < 3; k++) {
        const p = dv.getInt16(v * q.vertexStride + k * 2, true) * q.scaleMm + q.offsetMm[k];
        assert.ok(Number.isFinite(p), `${s.id}: non-finite coordinate`);
        if (p < lo[k]) lo[k] = p; if (p > hi[k]) hi[k] = p;
        const n = dv.getInt8(v * q.vertexStride + 6 + k) / 127;
        nn += n * n;
      }
      assert.ok(nn > 0.5 && nn < 1.5, `${s.id}: vertex ${v} normal length² ${nn.toFixed(2)}`);
    }
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(lo[k] - s.boundsMm[0][k]) < 0.01 && Math.abs(hi[k] - s.boundsMm[1][k]) < 0.01, `${s.id}: bounds differ from manifest`);
      assert.ok(s.centroidMm[k] >= lo[k] - 1e-6 && s.centroidMm[k] <= hi[k] + 1e-6, `${s.id}: centroid outside its bounds`);
    }
    // Simplification must not move the outline: recorded drift vs the source mesh and the achieved error stay small.
    assert.ok(s.model.boundsDriftMm <= 0.51, `${s.id}: bounds drift ${s.model.boundsDriftMm} mm`);
    assert.ok(s.model.decimationErrorMm <= 0.5, `${s.id}: decimation error ${s.model.decimationErrorMm} mm`);
    assert.ok(s.model.triangles <= s.model.sourceTriangles, `${s.id}: more triangles than the source`);
    triangles += s.model.triangles;
  }
  assert.equal(triangles, manifest.totals.triangles);
  assert.equal(manifest.structures.length, manifest.totals.structures);
});

test('ids are unique and stable; source ids, label values and model files are retained', () => {
  assert.equal(byId.size, manifest.structures.length, 'duplicate structure id');
  const files = new Set(manifest.structures.map((s) => s.model.file));
  assert.equal(files.size, manifest.structures.length, 'two structures share a model file');
  for (const s of manifest.structures) {
    assert.equal(s.sourceId, `#${s.id}`);
    assert.ok(Number.isInteger(s.label), `${s.id}: no label value`);
    assert.match(s.model.file, new RegExp(`^slicer/models/Model_${s.label}_`), `${s.id}: model file does not carry its label value`);
    assert.match(s.model.sha256, /^[0-9a-f]{64}$/);
  }
});

test('hierarchy: one root, every parent resolves, no cycles, path matches the ancestors', () => {
  const roots = manifest.groups.filter((g) => g.parentId === null);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].name, 'Brain');
  for (const g of manifest.groups) {
    const seen = new Set<string>();
    let cur: typeof g | undefined = g;
    while (cur?.parentId) { assert.ok(!seen.has(cur.id), `cycle at ${cur.id}`); seen.add(cur.id); cur = groups.get(cur.parentId); assert.ok(cur, `${g.id}: dangling parent`); }
  }
  for (const s of manifest.structures) {
    const names: string[] = [];
    let g = groups.get(s.parentId);
    assert.ok(g, `${s.id}: parent group ${s.parentId} missing`);
    while (g) { names.unshift(g.name); g = g.parentId ? groups.get(g.parentId) : undefined; }
    assert.deepEqual(s.path, names, `${s.id}: path does not match the group chain`);
  }
});

test('left / right naming agrees with geometry (RAS: left is −x of the fitted mid-sagittal plane)', () => {
  const pl = manifest.space.midSagittalPlane;
  // The subject is not aligned to the scanner axes; the fitted plane must still be close to x = 0 and a good fit.
  assert.ok(Math.abs(pl.a) < 6 && Math.abs(pl.yawDeg) < 10 && Math.abs(pl.rollDeg) < 10, `implausible mid-sagittal plane ${JSON.stringify(pl)}`);
  assert.ok(pl.pairs > 80 && pl.rmsMm < 3, `poor mid-sagittal fit: ${pl.pairs} pairs, rms ${pl.rmsMm} mm`);
  let left = 0, right = 0;
  for (const s of manifest.structures) {
    const x = s.midlineOffsetMm;
    if (s.hemisphere === 'left') { left++; assert.ok(x < 0, `${s.name}: named left, centroid ${x.toFixed(1)} mm right of the mid-sagittal plane`); }
    if (s.hemisphere === 'right') { right++; assert.ok(x > 0, `${s.name}: named right, centroid ${(-x).toFixed(1)} mm left of the mid-sagittal plane`); }
    if (s.hemisphere === 'midline') assert.ok(Math.abs(x) < 6, `${s.name}: unpaired structure ${x.toFixed(1)} mm off the mid-sagittal plane`);
  }
  assert.ok(left > 100 && right > 100);
  // Every left structure has a right counterpart, of the same tissue class, mirrored across the plane.
  for (const s of manifest.structures) {
    if (s.hemisphere !== 'left' || !/\bleft\b/.test(s.name)) continue;
    const twin = manifest.structures.find((t) => t.name === s.name.replace(/\bleft\b/g, 'right'));
    assert.ok(twin, `no right counterpart for "${s.name}"`);
    assert.equal(twin!.tissue, s.tissue);
    assert.ok(Math.abs(twin!.midlineOffsetMm + s.midlineOffsetMm) < 12, `${s.name}: pair is not mirror-symmetric (${s.midlineOffsetMm} / ${twin!.midlineOffsetMm} mm)`);
  }
});

test('motor-region landmarks: label values and anatomical order around the central sulcus', () => {
  for (const [side, label] of [['left', 1024], ['right', 2024]] as const) {
    const pre = byId.get(`${side}_precentral_gyrus`)!;
    const post = byId.get(`${side}_postcentral_gyrus`)!;
    const cs = byId.get(`${side}_central_sulcus`)!;
    const para = byId.get(`${side}_paracentral_lobule`)!;
    assert.ok(pre && post && cs && para, `${side}: motor-region structures missing`);
    assert.equal(pre.label, label);
    assert.equal(post.label, label - 2);
    assert.equal(para.label, label - 7);
    assert.equal(pre.tissue, 'cortex');
    assert.equal(cs.tissue, 'sulcus');
    assert.equal(pre.name, `${side} precentral gyrus`, 'the gyrus must not be renamed to a functional area');
    // Anterior is +y: precentral gyrus lies in front of the central sulcus, the postcentral gyrus behind it.
    assert.ok(pre.centroidMm[1] > cs.centroidMm[1], `${side}: precentral gyrus is not anterior to the central sulcus`);
    assert.ok(post.centroidMm[1] < cs.centroidMm[1], `${side}: postcentral gyrus is not posterior to the central sulcus`);
    // The paracentral lobule is the medial continuation: closer to the midline and superior.
    assert.ok(Math.abs(para.centroidMm[0]) < Math.abs(pre.centroidMm[0]) / 3, `${side}: paracentral lobule is not medial`);
    assert.ok(para.centroidMm[2] > pre.centroidMm[2], `${side}: paracentral lobule is not superior to the gyrus centroid`);
    // Independent agreement with the label volume.
    assert.equal(pre.labelCheck.present, true);
    assert.ok(pre.labelCheck.bboxMaxDifferenceMm! < 1.5, `${side} precentral gyrus: mesh vs voxel bbox ${pre.labelCheck.bboxMaxDifferenceMm} mm`);
    assert.equal(cs.labelCheck.present, false, 'sulcus surfaces have no voxels in the label volume');
  }
});

test('label-volume cross-check: coverage and the known source discrepancies are exactly as documented', () => {
  const checked = manifest.structures.filter((s) => s.labelCheck.present);
  assert.equal(checked.length, manifest.totals.labelChecked);
  assert.ok(checked.length >= 230);
  const notChecked = manifest.structures.filter((s) => !s.labelCheck.present);
  assert.ok(notChecked.every((s) => s.tissue === 'sulcus'), 'only sulcus surfaces may lack label voxels');
  const flagged = manifest.structures.filter((s) => s.labelCheck.flag).map((s) => s.id).sort();
  assert.deepEqual(flagged, ['left_fornix_of_forebrain', 'right_fornix_of_forebrain', 'right_pulvinar', 'white_matter_of_right_cerebral_hemisphere'].sort());
  assert.deepEqual([...manifest.totals.labelDiscrepancies].sort(), flagged);
});

test('source model hashes still match the reference clone (skipped when it is absent)', { skip: !existsSync(join(root, 'reference/spl-brain-atlas/slicer/models')) }, () => {
  for (const s of manifest.structures) {
    const f = join(root, 'reference/spl-brain-atlas', s.model.file);
    assert.equal(sha(new Uint8Array(readFileSync(f))), s.model.sha256, s.model.file);
  }
});
