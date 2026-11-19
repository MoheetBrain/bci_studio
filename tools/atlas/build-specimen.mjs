// A seamless outer surface of THIS atlas's brain, extracted from the atlas's own T1 MRI (same volunteer, same
// scanner space), with every vertex labelled from the atlas's authoritative label volume.
//
//   node tools/atlas/build-specimen.mjs [--f 0.55] [--triangles 460000] [--smooth 8]
//   → public/atlas/spl-nac/specimen.bin, specimen.json, slices-t1.bin.gz, slices-region.bin.gz
//
// Why: the atlas's per-structure models are separate closed shells, so drawn together they show seams that are not
// anatomy. This surface is one continuous sheet — the intensity boundary between brain tissue and the surrounding
// fluid in the MRI — so sulci appear where the scan shows them.
//
// What is measured and what is not:
//   • shape        an isosurface of the T1 image inside a soft mask grown 1.5 mm around the labelled brain; then
//                  Taubin-smoothed and decimated (displacements are recorded in specimen.json). It is NOT a FreeSurfer
//                  pial surface and has not been validated as one.
//   • region ids   read from hncma-atlas.nrrd just beneath each vertex. No registration is involved: image, labels and
//                  models share one space (checked per structure in the atlas build).
//   • occlusion    a baked rendering aid, not data.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { readNrrd } from './nrrd.mjs';
import { adjacency, boxBlur3, largestComponent, signedVolume, surfaceArea, surfaceNets, smoothNormals, taubinSmooth, vertexNormals } from './meshing.mjs';
import { bakeAO, buildBvh, smoothScalar } from './ao.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = path.resolve(ROOT, args.src ?? 'reference/spl-brain-atlas');
const OUT = path.resolve(ROOT, 'public/atlas/spl-nac');
const P = {
  thresholdFraction: +(args.f ?? 0.55),   // isosurface level between ventricular fluid (0) and cortical grey matter (1)
  maskGrowVoxels: 2,                       // soft mask = labelled brain grown by this many 0.75 mm voxels
  coreErodeVoxels: 3,                      // tissue deeper than this is forced "inside" (no internal cavities)
  fieldBlurRadius: +(args.blur ?? 1),
  taubinIterations: +(args.smooth ?? 8),
  targetTriangles: +(args.triangles ?? 460000),
  simplifyError: 0.0006,
  normalSmoothPasses: 2,
  borderTidyPasses: 2,
  ao: { rays: 40, maxDistMm: 22, biasMm: 0.25 },
  labelProbeMm: [0.5, 1.0, 1.6, 2.3, 3.2],
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${s}`);

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const t1File = 'slicer/volumes/imaging/A1_grayT1.nrrd', labFile = 'slicer/volumes/labels/hncma-atlas.nrrd';
if (!fs.existsSync(path.join(SRC, t1File))) throw new Error(`${t1File} not found under ${SRC} (add it to the sparse checkout; see docs/ATLAS_PROVENANCE.md)`);
const T1 = readNrrd(path.join(SRC, t1File));
const LAB = readNrrd(path.join(SRC, labFile));
const [nx, ny, nz] = T1.sizes;
const NV = nx * ny * nz;
log(`T1 ${T1.sizes.join('×')} @ ${Math.hypot(...T1.spaceDirections[0]).toFixed(2)} mm; labels ${LAB.sizes.join('×')}`);

// affine helpers (both volumes are axis-aligned; use their own headers, never assume they share a grid)
const affine = (fn) => { const o = fn(0, 0, 0); return { o, d: [fn(1, 0, 0), fn(0, 1, 0), fn(0, 0, 1)].map((p) => p.map((v, k) => v - o[k])) }; };
const A = affine(T1.toRas);
const ras = (i, j, k) => [0, 1, 2].map((c) => A.o[c] + i * A.d[0][c] + j * A.d[1][c] + k * A.d[2][c]);
const [lx, ly, lz] = LAB.sizes;
const labelAtRas = (r, a, s) => {
  const v = LAB.toVoxel(r, a, s);
  const i = Math.round(v[0]), j = Math.round(v[1]), k = Math.round(v[2]);
  return i < 0 || j < 0 || k < 0 || i >= lx || j >= ly || k >= lz ? 0 : LAB.data[i + lx * (j + ly * k)];
};
// label volume resampled (nearest) onto the T1 grid, incrementally
const L = affine((i, j, k) => LAB.toVoxel(...T1.toRas(i, j, k)));
const lab = new Int16Array(NV);
for (let k = 0, p = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, p++) {
  const a = Math.round(L.o[0] + i * L.d[0][0] + j * L.d[1][0] + k * L.d[2][0]);
  const b = Math.round(L.o[1] + i * L.d[0][1] + j * L.d[1][1] + k * L.d[2][1]);
  const c = Math.round(L.o[2] + i * L.d[0][2] + j * L.d[1][2] + k * L.d[2][2]);
  if (a >= 0 && b >= 0 && c >= 0 && a < lx && b < ly && c < lz) lab[p] = LAB.data[a + lx * (b + ly * c)];
}

// structures by label value
const regionOfLabel = new Map();   // label → 1-based index into manifest.structures
manifest.structures.forEach((s, i) => { if (s.label != null && !regionOfLabel.has(s.label)) regionOfLabel.set(s.label, i + 1); });
const tissueOfLabel = new Map(manifest.structures.map((s) => [s.label, s.tissue]));
const isBrain = (v) => regionOfLabel.has(v);

// 1 · masks ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const morph = (src, iterations, grow) => {
  let a = Uint8Array.from(src), b = new Uint8Array(NV);
  const sx = 1, sy = nx, sz = nx * ny;
  for (let it = 0; it < iterations; it++) {
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1, p = 1 + nx * (j + ny * k); i < nx - 1; i++, p++) {
      const any = a[p - sx] | a[p + sx] | a[p - sy] | a[p + sy] | a[p - sz] | a[p + sz];
      const all = a[p - sx] & a[p + sx] & a[p - sy] & a[p + sy] & a[p - sz] & a[p + sz];
      b[p] = grow ? (a[p] | any) : (a[p] & all);
    }
    const t = a; a = b; b = t;
  }
  return a;
};
const tissue = new Uint8Array(NV);
for (let p = 0; p < NV; p++) tissue[p] = isBrain(lab[p]) ? 1 : 0;
const grown = morph(tissue, P.maskGrowVoxels, true);
const core = morph(tissue, P.coreErodeVoxels, false);
const soft = boxBlur3(Float32Array.from(grown), T1.sizes, 1, 2);

// 2 · intensity statistics from the labels (so the level is derived from this scan, not typed in) ──────────────
const acc = { gm: [0, 0], wm: [0, 0], csf: [0, 0] };
for (let p = 0; p < NV; p++) {
  const v = lab[p];
  const t = tissueOfLabel.get(v);
  const cls = t === 'cortex' ? 'gm' : t === 'white-matter' ? 'wm' : (v === 4 || v === 43) ? 'csf' : null;
  if (cls) { acc[cls][0] += T1.data[p]; acc[cls][1]++; }
}
const mean = Object.fromEntries(Object.entries(acc).map(([k, [s, n]]) => [k, s / n]));
const level = mean.csf + P.thresholdFraction * (mean.gm - mean.csf);
log(`T1 means: fluid ${mean.csf.toFixed(1)}, grey ${mean.gm.toFixed(1)}, white ${mean.wm.toFixed(1)} → level ${level.toFixed(1)} (fraction ${P.thresholdFraction})`);

// 3 · scalar field: > 0 inside ───────────────────────────────────────────────────────────────────────────────────
let field = new Float32Array(NV);
const span = mean.gm - mean.csf;
for (let p = 0; p < NV; p++) {
  let f = T1.data[p] * soft[p] - level;
  const v = lab[p];
  if (core[p] || tissueOfLabel.get(v) === 'ventricle') f = Math.max(f, 0.6 * span);   // no cavities inside the brain
  field[p] = f;
}
if (P.fieldBlurRadius > 0) field = boxBlur3(field, T1.sizes, P.fieldBlurRadius, 1);

// 4 · isosurface → mm → largest component → smooth → decimate ────────────────────────────────────────────────────
let { positions, indices } = surfaceNets(field, T1.sizes);
log(`surface nets: ${positions.length / 3} vertices, ${indices.length / 3} triangles`);
for (let v = 0; v < positions.length; v += 3) {
  const r = ras(positions[v], positions[v + 1], positions[v + 2]);
  positions[v] = r[0]; positions[v + 1] = r[1]; positions[v + 2] = r[2];
}
if (signedVolume(positions, indices) < 0) for (let t = 0; t < indices.length; t += 3) { const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp; }
const lc = largestComponent(positions, indices);
positions = lc.positions; indices = lc.indices;
log(`largest of ${lc.components} components kept (${lc.removedTriangles} stray triangles removed)`);
const rawArea = surfaceArea(positions, indices);
const sm = taubinSmooth(positions, adjacency(positions.length / 3, indices), P.taubinIterations);
positions = sm.positions;
log(`Taubin ×${P.taubinIterations}: mean move ${sm.displacement.mean.toFixed(3)} mm, 95th pct ${sm.displacement.p95.toFixed(3)} mm, max ${sm.displacement.max.toFixed(2)} mm`);

await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const before = indices.length / 3;
const [simplified, simErr] = MeshoptSimplifier.simplify(indices, positions, 3, P.targetTriangles * 3, P.simplifyError);
const simErrMm = simErr * MeshoptSimplifier.getScale(positions, 3);
{
  const [remap, count] = MeshoptSimplifier.compactMesh(simplified);
  const np = new Float32Array(count * 3);
  for (let o = 0; o < remap.length; o++) { const n = remap[o]; if (n !== 0xffffffff) { np[n * 3] = positions[o * 3]; np[n * 3 + 1] = positions[o * 3 + 1]; np[n * 3 + 2] = positions[o * 3 + 2]; } }
  positions = np; indices = simplified;
}
const nVert = positions.length / 3;
log(`decimated ${before} → ${indices.length / 3} triangles (${nVert} vertices), error ≤ ${simErrMm.toFixed(3)} mm`);
const normals = vertexNormals(positions, indices);
const adj = adjacency(nVert, indices);
// shading normals only (geometry, label probing and occlusion keep the true normals)
const shadeNormals = smoothNormals(normals, adj, P.normalSmoothPasses, 0.6);

// 5 · region id per vertex, from the label volume just beneath the surface ──────────────────────────────────────
const region = new Uint8Array(nVert);
let viaWhite = 0;
for (let v = 0; v < nVert; v++) {
  let white = 0, found = 0;
  for (const d of P.labelProbeMm) {
    const l = labelAtRas(positions[v * 3] - normals[v * 3] * d, positions[v * 3 + 1] - normals[v * 3 + 1] * d, positions[v * 3 + 2] - normals[v * 3 + 2] * d);
    const idx = regionOfLabel.get(l);
    if (!idx) continue;
    const t = tissueOfLabel.get(l);
    if (t === 'white-matter' || t === 'ventricle') { if (!white) white = idx; continue; }
    found = idx; break;
  }
  if (!found && white) { found = white; viaWhite++; }
  region[v] = found;
}
const unlabelledRaw = region.reduce((a, r) => a + (r === 0 ? 1 : 0), 0);
// fill gaps and remove single-vertex speckle by neighbour majority (two passes); a vertex with no labelled
// neighbour stays unlabelled and is simply not selectable
for (let pass = 0; pass < 3; pass++) {
  const next = Uint8Array.from(region);
  for (let v = 0; v < nVert; v++) {
    const count = new Map();
    for (let i = adj.start[v]; i < adj.start[v + 1]; i++) { const r = region[adj.list[i]]; if (r) count.set(r, (count.get(r) ?? 0) + 1); }
    let best = 0, bestN = 0;
    for (const [r, n] of count) if (n > bestN) { best = r; bestN = n; }
    const deg = adj.start[v + 1] - adj.start[v];
    if (region[v] === 0 && best) next[v] = best;
    else if (region[v] && best && best !== region[v] && (count.get(region[v]) ?? 0) === 0 && bestN >= deg - 1) next[v] = best;
  }
  region.set(next);
}
const unlabelled = region.reduce((a, r) => a + (r === 0 ? 1 : 0), 0);

// Tidy the borders. The label volume is a 1 mm grid, so a border read from it runs across the mesh as a voxel
// staircase. A neighbour-majority vote (a vertex changes only when more than half of its ring disagrees with it)
// straightens the staircase; it moves a border by at most about one mesh edge per pass and is reported below.
const beforeTidy = Uint8Array.from(region);
for (let pass = 0; pass < P.borderTidyPasses; pass++) {
  const next = Uint8Array.from(region);
  for (let v = 0; v < nVert; v++) {
    if (!region[v]) continue;
    const a = adj.start[v], b = adj.start[v + 1];
    const count = new Map();
    for (let i = a; i < b; i++) { const r = region[adj.list[i]]; if (r) count.set(r, (count.get(r) ?? 0) + 1); }
    let best = 0, bestN = 0;
    for (const [r, n] of count) if (n > bestN) { best = r; bestN = n; }
    if (best && best !== region[v] && bestN * 2 > b - a) next[v] = best;
  }
  region.set(next);
}
let tidied = 0;
for (let v = 0; v < nVert; v++) if (region[v] !== beforeTidy[v]) tidied++;

// Border band: 1 where a vertex touches another region, relaxed over the neighbourhood so that it interpolates
// into a soft band a few millimetres wide (used to draw region borders and the rim of a selection).
let band = new Float32Array(nVert);
for (let v = 0; v < nVert; v++) {
  for (let i = adj.start[v]; i < adj.start[v + 1]; i++) if (region[adj.list[i]] !== region[v]) { band[v] = 1; break; }
}
for (let pass = 0; pass < 2; pass++) {
  const next = new Float32Array(nVert);
  for (let v = 0; v < nVert; v++) {
    let sum = 0; const a = adj.start[v], b = adj.start[v + 1];
    for (let i = a; i < b; i++) sum += band[adj.list[i]];
    next[v] = Math.max(band[v] * (pass === 0 ? 1 : 0.85), 0.5 * band[v] + 0.5 * (b > a ? sum / (b - a) : 0));
  }
  band = next;
}
const regionVertices = new Map();
for (const r of region) if (r) regionVertices.set(r, (regionVertices.get(r) ?? 0) + 1);
log(`regions: ${regionVertices.size} structures reach the surface; unlabelled ${unlabelledRaw} → ${unlabelled} of ${nVert} vertices; ${viaWhite} labelled through white matter; ${tidied} border vertices tidied (${(100 * tidied / nVert).toFixed(2)} %)`);

// hemisphere flag: from the structure, else from the fitted mid-sagittal plane
const pl = manifest.space.midSagittalPlane;
const flags = new Uint8Array(nVert);
for (let v = 0; v < nVert; v++) {
  const s = region[v] ? manifest.structures[region[v] - 1] : null;
  const side = positions[v * 3] - (pl.a + pl.b * positions[v * 3 + 1] + pl.c * positions[v * 3 + 2]);
  const h = s && s.hemisphere !== 'midline' ? s.hemisphere : Math.abs(side) < 1.5 ? 'midline' : side < 0 ? 'left' : 'right';
  flags[v] = h === 'left' ? 1 : h === 'right' ? 2 : 0;
}

// 6 · baked occlusion ───────────────────────────────────────────────────────────────────────────────────────────
const bvh = buildBvh(positions, indices);
let ao = bakeAO(positions, normals, bvh, { rays: P.ao.rays, maxDist: P.ao.maxDistMm, bias: P.ao.biasMm });
ao = smoothScalar(ao, adj, 2);
log(`occlusion baked (${P.ao.rays} rays, ${P.ao.maxDistMm} mm): mean ${(ao.reduce((a, b) => a + b, 0) / nVert).toFixed(3)}`);

const finalArea = surfaceArea(positions, indices);   // before the index buffer is reordered for encoding

// 7 · pack (same quantisation frame as the atlas chunks) ─────────────────────────────────────────────────────────
const q = manifest.quantisation;
const STRIDE = 12; // i16 x y z · i8 nx ny nz · u8 occlusion · u8 region · u8 (hemisphere in bits 0–1, border band in bits 2–7)
const [remapV] = MeshoptEncoder.reorderMesh(indices, true, true);
const vtx = new Uint8Array(nVert * STRIDE), dv = new DataView(vtx.buffer);
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < nVert; v++) {
  const o = remapV[v] * STRIDE;
  for (let k = 0; k < 3; k++) {
    const qv = Math.round((positions[v * 3 + k] - q.offsetMm[k]) / q.scaleMm);
    if (Math.abs(qv) > 32767) throw new Error('specimen vertex outside the quantisation range');
    dv.setInt16(o + k * 2, qv, true);
    dv.setInt8(o + 6 + k, Math.max(-127, Math.min(127, Math.round(shadeNormals[v * 3 + k] * 127))));
    lo[k] = Math.min(lo[k], positions[v * 3 + k]); hi[k] = Math.max(hi[k], positions[v * 3 + k]);
  }
  vtx[o + 9] = Math.max(0, Math.min(255, Math.round(ao[v] * 255)));
  vtx[o + 10] = region[v];
  vtx[o + 11] = flags[v] | (Math.max(0, Math.min(63, Math.round(band[v] * 63))) << 2);
}
const encV = MeshoptEncoder.encodeVertexBuffer(vtx, nVert, STRIDE);
const encI = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), indices.length, 4);
const bin = Buffer.concat([Buffer.from(encV), Buffer.from(encI)]);
fs.writeFileSync(path.join(OUT, 'specimen.bin'), bin);

// 8 · slice volumes: the MRI and the region ids on one RAS-aligned 1 mm grid, cropped to the brain ───────────────
const margin = 8;
const b0 = [0, 1, 2].map((k) => Math.floor(Math.min(...manifest.structures.map((s) => s.boundsMm[0][k]))) - margin);
const b1 = [0, 1, 2].map((k) => Math.ceil(Math.max(...manifest.structures.map((s) => s.boundsMm[1][k]))) + margin);
const sd = b1.map((v, k) => v - b0[k] + 1);
const near = morph(tissue, 6, true);                      // within 4.5 mm of labelled brain
const t1Slice = new Uint8Array(sd[0] * sd[1] * sd[2]), regSlice = new Uint8Array(t1Slice.length);
const hiWin = mean.wm * 1.25;
const tri = (x, y, z) => {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return [0, 0];
  const fx = x - i, fy = y - j, fz = z - k, p = i + nx * (j + ny * k);
  const d = T1.data, sx = 1, sy = nx, sz = nx * ny;
  const c00 = d[p] * (1 - fx) + d[p + sx] * fx, c10 = d[p + sy] * (1 - fx) + d[p + sy + sx] * fx;
  const c01 = d[p + sz] * (1 - fx) + d[p + sz + sx] * fx, c11 = d[p + sz + sy] * (1 - fx) + d[p + sz + sy + sx] * fx;
  const nearP = Math.round(x) + nx * (Math.round(y) + ny * Math.round(z));
  return [(c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz, near[nearP]];
};
for (let z = 0, p = 0; z < sd[2]; z++) for (let y = 0; y < sd[1]; y++) for (let x = 0; x < sd[0]; x++, p++) {
  const R = b0[0] + x, Aa = b0[1] + y, S = b0[2] + z;
  const v = T1.toVoxel(R, Aa, S);
  const [val, inMask] = tri(v[0], v[1], v[2]);
  t1Slice[p] = inMask ? Math.max(1, Math.min(255, Math.round((val / hiWin) * 255))) : 0;
  regSlice[p] = regionOfLabel.get(labelAtRas(R, Aa, S)) ?? 0;
}
const gzT1 = gzipSync(t1Slice, { level: 9 }), gzReg = gzipSync(regSlice, { level: 9 });
fs.writeFileSync(path.join(OUT, 'slices-t1.bin.gz'), gzT1);
fs.writeFileSync(path.join(OUT, 'slices-region.bin.gz'), gzReg);

const meta = {
  format: 'hbci-specimen/1',
  generatedBy: 'tools/atlas/build-specimen.mjs',
  dataset: { id: manifest.dataset.id, commit: manifest.dataset.commit, licence: manifest.dataset.licence },
  source: {
    image: { file: t1File, sha256: sha256(fs.readFileSync(path.join(SRC, t1File))), sizes: T1.sizes, voxelMm: Math.hypot(...T1.spaceDirections[0]), space: T1.space },
    labels: { file: labFile, sha256: sha256(fs.readFileSync(path.join(SRC, labFile))) },
  },
  what: 'One continuous outer surface of the atlas subject’s brain: the T1 intensity boundary between tissue and fluid, inside a soft mask grown around the labelled brain. A modified, derived rendering surface — not the atlas’s original models and not a validated pial surface.',
  parameters: P,
  intensity: { fluid: +mean.csf.toFixed(2), grey: +mean.gm.toFixed(2), white: +mean.wm.toFixed(2), level: +level.toFixed(2) },
  mesh: {
    file: 'specimen.bin', bytes: bin.length, sha256: sha256(bin), vertexStride: STRIDE, vertexCount: nVert, indexCount: indices.length,
    vertexBytes: encV.byteLength, indexBytes: encI.byteLength, triangles: indices.length / 3,
    boundsMm: [lo.map((v) => +v.toFixed(2)), hi.map((v) => +v.toFixed(2))],
    surfaceAreaMm2: Math.round(finalArea), surfaceAreaBeforeSmoothingMm2: Math.round(rawArea),
    smoothingDisplacementMm: { mean: +sm.displacement.mean.toFixed(3), p95: +sm.displacement.p95.toFixed(3), max: +sm.displacement.max.toFixed(2) },
    decimationErrorMm: +simErrMm.toFixed(3),
    layout: 'int16 x,y,z (× quantisation.scaleMm + offsetMm → RAS mm) · int8 normal · uint8 occlusion · uint8 region (0 = none, else 1-based index into manifest.structures) · uint8 flags (bits 0-1: 1 left, 2 right; bits 2-7: border band 0–63, a rendering aid)',
  },
  regions: {
    structuresOnSurface: regionVertices.size, unlabelledVertices: unlabelled, unlabelledFraction: +(unlabelled / nVert).toFixed(4), labelledThroughWhiteMatter: viaWhite,
    borderTidy: { passes: P.borderTidyPasses, changedVertices: tidied, changedFraction: +(tidied / nVert).toFixed(4), rule: 'a vertex takes the region held by more than half of its neighbours' },
    verticesPerStructure: Object.fromEntries([...regionVertices].sort((a, b) => a[0] - b[0]).map(([r, n]) => [manifest.structures[r - 1].id, n])),
    structureCount: manifest.structures.length,
  },
  slices: {
    note: 'T1 image (8-bit, windowed 0…1.25 × mean white matter, shown only within 4.5 mm of labelled brain) and region ids on a RAS-aligned 1 mm grid. Index = x + nx·(y + ny·z); RAS = originMm + (x, y, z).',
    originMm: b0, dims: sd, voxelMm: 1,
    t1: { file: 'slices-t1.bin.gz', bytes: gzT1.length, rawBytes: t1Slice.length, sha256: sha256(gzT1) },
    region: { file: 'slices-region.bin.gz', bytes: gzReg.length, rawBytes: regSlice.length, sha256: sha256(gzReg) },
  },
};
fs.writeFileSync(path.join(OUT, 'specimen.json'), JSON.stringify(meta, null, 1));
log(`specimen.bin ${(bin.length / 1e6).toFixed(2)} MB · slices ${(gzT1.length / 1e6).toFixed(2)} + ${(gzReg.length / 1e6).toFixed(2)} MB · area ${(meta.mesh.surfaceAreaMm2 / 100).toFixed(0)} cm²`);
