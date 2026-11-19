// SPL/NAC brain atlas → studio atlas assets (public/atlas/spl-nac/).
//
//   node tools/atlas/build-atlas.mjs [--src reference/spl-brain-atlas] [--out public/atlas/spl-nac]
//
// Deterministic: same source commit + same parameters → byte-identical chunks (the manifest records sha256 of every
// input model and output chunk). Nothing anatomical is invented here: names, hierarchy, label values and colours come
// from slicer/atlasStructure.json and labelinfo/*.tsv; geometry comes from slicer/models/*.vtk.
//
// What is changed, and recorded in the manifest:
//   • triangle decimation (meshoptimizer simplify, per-structure achieved error in mm is stored);
//   • int16 position / int8 normal quantisation (step ≈ 3 µm) and meshoptimizer stream encoding;
//   • NOTHING is re-centred, rotated or mirrored: decoded positions are the source's RAS millimetres.
//
// Pipeline structure adapted from glin23/brain-atlas scripts/convert.mjs + atlas-tree.mjs (MIT, © 2026 Lee Lin).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { parseVtk } from './vtk.mjs';
import { readNrrd, labelStats } from './nrrd.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = path.resolve(ROOT, args.src ?? 'reference/spl-brain-atlas');
const OUT = path.resolve(ROOT, args.out ?? 'public/atlas/spl-nac');

// ---- parameters (all recorded in the manifest) ------------------------------------------------------------------
const PARAMS = {
  ratio: 0.25,            // target fraction of source triangles for ordinary structures
  whiteMatterRatio: 0.08, // the two cerebral white-matter shells are large and mostly hidden
  minTriangles: 400,      // structures at or below this are not decimated at all
  maxRelativeError: 0.002, // meshoptimizer target_error (fraction of the mesh extent)
  maxBoundsDriftMm: 0.5,  // a decimation level is rejected if it moves the structure's bounding box by more than this
  positionRangeMm: 100,   // int16 full scale, relative to quantisation.offsetMm
};
const STRIDE = 12; // i16 x y z · i8 nx ny nz · 3 pad bytes

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const round = (v, d = 3) => +v.toFixed(d);

// ---- source hierarchy -------------------------------------------------------------------------------------------
function loadTree() {
  const atlas = JSON.parse(fs.readFileSync(path.join(SRC, 'slicer/atlasStructure.json'), 'utf8'));
  const byId = new Map(atlas.map((n) => [n['@id'], n]));
  const meta = new Map(
    fs.readFileSync(path.join(SRC, 'labelinfo/brain-atlas-labels-with-metadata.tsv'), 'utf8')
      .split(/\r\n|\r|\n/).slice(1).map((l) => l.split('\t')).filter((c) => c.length >= 4)
      .map((c) => [+c[0], { label: c[1], radlex: c[3] || null, radlexStructure: c[4] || null }]),
  );
  const modelOf = (n) => {
    for (const s of n.sourceSelector ?? []) {
      const d = byId.get(s.dataSource);
      if (d?.source?.endsWith('.vtk')) return d.source;
    }
    return null;
  };
  const labelOf = (n) => n.sourceSelector?.find((s) => s['@type']?.includes('LabelMapSelector'))?.dataKey ?? null;
  const groups = [];
  const structures = [];
  const seenStructure = new Map();
  const seenGroup = new Set();
  const walk = (id, parentId, pathNames) => {
    const n = byId.get(id);
    if (!n) throw new Error(`dangling member ${id}`);
    const name = n.annotation?.name;
    if (!name) throw new Error(`${id}: no annotation.name`);
    const file = modelOf(n);
    if (file) {
      // The source lists a few structures twice (same node, or two nodes sharing one model file). Keep one entry.
      const prev = seenStructure.get(file);
      if (prev) { prev.alsoIn.push(parentId); if (id !== prev.sourceId) prev.duplicateSourceIds.push(id); return; }
      const label = labelOf(n);
      const s = { sourceId: id, name, parentId, path: pathNames, file, label, radlex: meta.get(label)?.radlex ?? null,
        labelName: meta.get(label)?.label ?? null, color: n.renderOption?.color ?? null, alsoIn: [], duplicateSourceIds: [] };
      seenStructure.set(file, s);
      structures.push(s);
    }
    if (n.member?.length) {
      if (seenGroup.has(id)) throw new Error(`group ${id} reached twice`);
      seenGroup.add(id);
      groups.push({ sourceId: id, name, parentId, color: n.renderOption?.color ?? null });
      for (const c of n.member) walk(c, id, [...pathNames, name]);
    }
  };
  walk('#Brain', null, []);
  return { groups, structures };
}

/** left | right | midline — from the structure's own name, else the nearest ancestor that states a side. */
function hemisphereOf(name, pathNames) {
  for (const s of [name, ...[...pathNames].reverse()]) {
    const m = /\b(left|right)\b/.exec(s);
    if (m) return m[1];
  }
  return 'midline';
}

/** Display class used for default tinting, the legend and chunking. Every structure must map to exactly one. */
function tissueClassOf(name, pathNames) {
  const p = pathNames.join('/');
  if (/ventricle|aqueduct/.test(name)) return 'ventricle';
  if (/ sulcus$/.test(name)) return 'sulcus';
  if (/^white matter of (left|right) cerebral hemisphere$/.test(name)) return 'white-matter';
  if (/cerebellum/.test(p) || /cerebell/.test(name)) return 'cerebellum';
  if (/rhombencephalon|midbrain/.test(p)) return 'brainstem';
  if (/diencephalon/.test(p)) return 'diencephalon';
  if (/subcortex of (left|right) cerebral hemisphere/.test(p)) return 'basal-nuclei';
  if (/hippocampus$|amygdala$/.test(name) && !/parahippocampal/.test(name)) return 'medial-temporal';
  if (/telencephalon$|septum of telencephalon/.test(p)) return 'commissure';
  if (/(left|right) cerebral hemisphere/.test(p)) return 'cortex';
  throw new Error(`no tissue class for "${p}/${name}"`);
}
const CHUNK_OF = { cortex: 'cortex', sulcus: 'cortex', 'white-matter': 'white-matter', cerebellum: 'hindbrain', brainstem: 'hindbrain',
  diencephalon: 'deep', 'basal-nuclei': 'deep', 'medial-temporal': 'deep', commissure: 'deep', ventricle: 'deep' };
const CHUNK_ORDER = ['cortex', 'hindbrain', 'deep', 'white-matter'];

// ---- geometry helpers -------------------------------------------------------------------------------------------
function meshStats(pos, idx) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < min[k]) min[k] = pos[i]; if (pos[i] > max[k]) max[k] = pos[i]; }
  let area = 0; const c = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    area += ar;
    for (let k = 0; k < 3; k++) c[k] += ar * (pos[a + k] + pos[b + k] + pos[d + k]) / 3;
  }
  return { min, max, area, centroid: area > 0 ? c.map((v) => v / area) : [0, 1, 2].map((k) => (min[k] + max[k]) / 2) };
}

// ---- main -------------------------------------------------------------------------------------------------------
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const t0 = Date.now();
if (!fs.existsSync(path.join(SRC, 'slicer/atlasStructure.json'))) throw new Error(`SPL atlas not found at ${SRC} (see docs/ATLAS_PROVENANCE.md)`);
const sourceCommit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD']).toString().trim();
const sourceDate = execFileSync('git', ['-C', SRC, 'log', '-1', '--format=%cI']).toString().trim();
const { groups, structures } = loadTree();

// Label volume: voxel statistics per label value, in the same RAS-mm frame as the models (identity transform in
// slicer/transforms/LinearTransform_3.tfm; verified below structure by structure).
const labelFile = 'slicer/volumes/labels/hncma-atlas.nrrd';
const vol = readNrrd(path.join(SRC, labelFile));
const lstats = labelStats(vol);

// Pass 1: parse + decimate (RAS mm kept).
let trisBefore = 0;
const parts = structures.map((s) => {
  const file = path.join(SRC, 'slicer', s.file);
  const bytes = fs.readFileSync(file);
  const g = parseVtk(file);
  if (!g.normals) throw new Error(`${s.name}: VTK has no normals`);
  const srcTris = g.indices.length / 3;
  trisBefore += srcTris;
  const tissue = tissueClassOf(s.name, s.path);
  const srcStats = meshStats(g.positions, g.indices);
  let indices = g.indices, errMm = 0, usedRatio = 1;
  const ratio = tissue === 'white-matter' ? PARAMS.whiteMatterRatio : PARAMS.ratio;
  const decimate = tissue !== 'sulcus' && srcTris > PARAMS.minTriangles;
  if (decimate) {
    // Thin or branching structures can lose their extremities when decimated. Accept a level only if the outline
    // (bounding box) moved by less than PARAMS.maxBoundsDriftMm; otherwise retry gentler, finally keep the source mesh.
    for (const r of [ratio, 0.5, 0.75, 1]) {
      if (r >= 1) { indices = new Uint32Array(g.indices); errMm = 0; usedRatio = 1; break; }
      const target = Math.max(PARAMS.minTriangles, Math.floor(srcTris * r)) * 3;
      const [simplified, err] = MeshoptSimplifier.simplify(g.indices, g.positions, 3, target, PARAMS.maxRelativeError);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const vi of simplified) for (let k = 0; k < 3; k++) { const v = g.positions[vi * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
      const drift = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(lo[k] - srcStats.min[k]), Math.abs(hi[k] - srcStats.max[k])]));
      if (drift <= PARAMS.maxBoundsDriftMm) { indices = simplified; errMm = err * MeshoptSimplifier.getScale(g.positions, 3); usedRatio = r; break; }
    }
  } else {
    indices = new Uint32Array(g.indices);
  }
  const [remap, count] = MeshoptSimplifier.compactMesh(indices);
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  for (let o = 0; o < remap.length; o++) {
    const n = remap[o];
    if (n === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) { pos[n * 3 + k] = g.positions[o * 3 + k]; nrm[n * 3 + k] = g.normals[o * 3 + k]; }
  }
  return { s, tissue, pos, nrm, indices, count, srcTris, srcStats, errMm, decimated: decimate && usedRatio < 1, usedRatio, fileSha: sha256(bytes), fileBytes: bytes.length };
});

// One quantisation frame for everything.
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const { srcStats } of parts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], srcStats.min[k]); hi[k] = Math.max(hi[k], srcStats.max[k]); }
const offsetMm = lo.map((v, k) => round((v + hi[k]) / 2, 2));
const scaleMm = PARAMS.positionRangeMm / 32767;

// Mid-sagittal plane of THIS subject in scanner coordinates. The head is not perfectly aligned to the scanner axes, so
// the plane is fitted (least squares, x = a + b·y + c·z) to the midpoints of every left/right pair; it is used only to
// *check* left/right naming and is reported in the manifest. Nothing is re-aligned.
const centroidOf = (p) => (p.s.label != null && lstats.get(p.s.label) ? lstats.get(p.s.label).centroid : p.srcStats.centroid);
const byName = new Map(parts.map((p) => [p.s.name, p]));
const mids = [];
for (const p of parts) {
  if (!/\bleft\b/.test(p.s.name)) continue;
  const twin = byName.get(p.s.name.replace(/\bleft\b/g, 'right'));
  if (!twin) continue;
  const a = centroidOf(p), b = centroidOf(twin);
  mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}
function fitPlane(pts) {
  // normal equations for x = a + b·y + c·z
  const n = pts.length; let sy = 0, sz = 0, sx = 0, syy = 0, szz = 0, syz = 0, sxy = 0, sxz = 0;
  for (const [x, y, z] of pts) { sx += x; sy += y; sz += z; syy += y * y; szz += z * z; syz += y * z; sxy += x * y; sxz += x * z; }
  const A = [[n, sy, sz], [sy, syy, syz], [sz, syz, szz]], B = [sx, sxy, sxz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)));
  const [a, b, c] = [0, 1, 2].map((k) => det(col(k)) / D);
  const rms = Math.sqrt(pts.reduce((acc, [x, y, z]) => acc + (x - (a + b * y + c * z)) ** 2, 0) / n);
  return { a, b, c, rms };
}
const plane = fitPlane(mids);
const midX = (pt) => plane.a + plane.b * pt[1] + plane.c * pt[2];

const chunks = CHUNK_ORDER.map((name) => ({ name, buffers: [], bytes: 0 }));
const outStructures = [];
let triangles = 0;
const problems = [];
const warnings = []; // disagreements inside the source itself (model vs label volume): reported, never hidden
const LABEL_BBOX_TOLERANCE_MM = 3;
for (const p of parts) {
  const { s } = p;
  const chunkIndex = CHUNK_ORDER.indexOf(CHUNK_OF[p.tissue]);
  const chunk = chunks[chunkIndex];
  const [remap] = MeshoptEncoder.reorderMesh(p.indices, true, true);
  const vtx = new Uint8Array(p.count * STRIDE), dv = new DataView(vtx.buffer);
  const qpos = new Float32Array(p.count * 3);
  for (let v = 0; v < p.count; v++) {
    const o = remap[v] * STRIDE;
    for (let k = 0; k < 3; k++) {
      const q = Math.round((p.pos[v * 3 + k] - offsetMm[k]) / scaleMm);
      if (Math.abs(q) > 32767) throw new Error(`${s.name}: coordinate outside the quantisation range`);
      dv.setInt16(o + k * 2, q, true);
      dv.setInt8(o + 6 + k, Math.max(-127, Math.min(127, Math.round(p.nrm[v * 3 + k] * 127))));
      qpos[remap[v] * 3 + k] = q * scaleMm + offsetMm[k];
    }
  }
  const st = meshStats(qpos, p.indices);
  const drift = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(st.min[k] - p.srcStats.min[k]), Math.abs(st.max[k] - p.srcStats.max[k])]));
  const encV = MeshoptEncoder.encodeVertexBuffer(vtx, p.count, STRIDE);
  const encI = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength), p.indices.length, 4);

  const hemisphere = hemisphereOf(s.name, s.path);
  // Label-volume agreement (independent of the model files): voxel bounding box vs mesh bounding box.
  const ls = s.label != null ? lstats.get(s.label) : undefined;
  let labelCheck;
  if (!ls) {
    labelCheck = { present: false, note: `label ${s.label} has no voxels in ${labelFile} (surface-only structure in the source)` };
  } else {
    const centreDist = Math.hypot(...[0, 1, 2].map((k) => (ls.min[k] + ls.max[k]) / 2 - (p.srcStats.min[k] + p.srcStats.max[k]) / 2));
    const boundsDiff = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(ls.min[k] - p.srcStats.min[k]), Math.abs(ls.max[k] - p.srcStats.max[k])]));
    labelCheck = { present: true, voxels: ls.voxels, voxelCentroidMm: ls.centroid.map((v) => round(v, 2)), bboxCentreDistanceMm: round(centreDist, 2), bboxMaxDifferenceMm: round(boundsDiff, 2) };
    if (boundsDiff > LABEL_BBOX_TOLERANCE_MM) {
      labelCheck.flag = 'source-discrepancy';
      warnings.push(`${s.name}: mesh bbox differs from label-${s.label} voxel bbox by ${boundsDiff.toFixed(2)} mm`);
    }
  }
  const cpt = ls ? ls.centroid : p.srcStats.centroid;
  const sideX = cpt[0] - midX(cpt);
  if (hemisphere === 'left' && sideX > 0) problems.push(`${s.name}: named left but centroid is ${sideX.toFixed(1)} mm right of the fitted mid-sagittal plane`);
  if (hemisphere === 'right' && sideX < 0) problems.push(`${s.name}: named right but centroid is ${(-sideX).toFixed(1)} mm left of the fitted mid-sagittal plane`);

  outStructures.push({
    id: s.sourceId.slice(1),
    sourceId: s.sourceId,
    name: s.name,
    label: s.label,
    labelName: s.labelName,
    radlex: s.radlex,
    hemisphere,
    tissue: p.tissue,
    parentId: s.parentId.slice(1),
    alsoIn: s.alsoIn.map((g) => g.slice(1)),
    duplicateSourceIds: s.duplicateSourceIds,
    path: s.path,
    sourceColor: s.color,
    model: {
      file: `slicer/${s.file}`, sha256: p.fileSha, bytes: p.fileBytes,
      sourceTriangles: p.srcTris, triangles: p.indices.length / 3, vertices: p.count,
      decimated: p.decimated, decimationRatio: p.usedRatio, decimationErrorMm: round(p.errMm, 4), boundsDriftMm: round(drift, 4),
    },
    chunk: chunkIndex,
    vertexOffset: chunk.bytes, vertexBytes: encV.byteLength,
    indexOffset: chunk.bytes + encV.byteLength, indexBytes: encI.byteLength,
    vertexCount: p.count, indexCount: p.indices.length,
    boundsMm: [st.min.map((v) => round(v)), st.max.map((v) => round(v))],
    centroidMm: st.centroid.map((v) => round(v, 2)),
    surfaceAreaMm2: round(st.area, 1),
    labelCheck,
    midlineOffsetMm: round(sideX, 2),
  });
  chunk.buffers.push(Buffer.from(encV), Buffer.from(encI));
  chunk.bytes += encV.byteLength + encI.byteLength;
  triangles += p.indices.length / 3;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const outChunks = chunks.map((c) => {
  const raw = Buffer.concat(c.buffers);
  const file = `chunk-${c.name}.bin`;
  fs.writeFileSync(path.join(OUT, file), raw);
  return { name: c.name, file, bytes: raw.length, sha256: sha256(raw) };
});

const present = outStructures.filter((s) => s.labelCheck.present);
const manifest = {
  format: 'hbci-atlas/1',
  dataset: {
    id: 'spl-nac-2017',
    name: 'SPL/NAC (SPL-PNL) Brain Atlas',
    repository: 'https://github.com/mhalle/spl-brain-atlas',
    commit: sourceCommit,
    commitDate: sourceDate,
    landingPage: 'https://www.openanatomy.org/atlas-pages/atlas-spl-nac-brain.html',
    citation: 'Halle M, Talos I-F, Jakab M, Makris N, Meier D, Wald L, Fischl B, Kikinis R. Multi-modality MRI-based Atlas of the Brain. Surgical Planning Laboratory, Brigham and Women’s Hospital; 2017.',
    licence: '3D Slicer License (Contribution and Software License Agreement v1.0), per the repository LICENSE.md',
    licenceUrl: 'https://github.com/Slicer/Slicer/blob/main/License.txt',
    licenceFile: 'atlas/LICENSE-3D-Slicer.txt',
    modified: 'This is a MODIFIED version of the atlas, not the original: meshes were decimated, quantised and re-encoded for display (see transforms).',
    intendedUse: 'Per the licence: designed for research purposes only; clinical applications are neither recommended nor advised.',
    subject: 'One healthy adult volunteer (single-subject MRI). Not a population average and not a clinical reference.',
    acknowledgement: 'NIH P41 EB015902, P41 RR013218, R01 MH050740; Google Research Grant (from the atlas README).',
  },
  space: {
    name: 'SPL/NAC subject space (scanner RAS)',
    units: 'mm',
    orientation: 'RAS: +x = subject right, +y = anterior, +z = superior',
    notStandardised: 'This is NOT MNI / Talairach space. Coordinates are meaningful only within this subject’s atlas.',
    labelVolume: { file: labelFile, sizes: vol.sizes, space: vol.space, spaceDirections: vol.spaceDirections, origin: vol.origin },
    modelToLabelTransform: 'identity (slicer/transforms/LinearTransform_3.tfm); checked per structure in labelCheck',
    midSagittalPlane: {
      model: 'x = a + b*y + c*z (RAS mm), least-squares fit to the midpoints of all left/right structure pairs',
      a: round(plane.a, 3), b: round(plane.b, 5), c: round(plane.c, 5), pairs: mids.length, rmsMm: round(plane.rms, 2),
      yawDeg: round(Math.atan(plane.b) * 180 / Math.PI, 2), rollDeg: round(Math.atan(plane.c) * 180 / Math.PI, 2),
      note: 'The subject’s mid-sagittal plane is tilted relative to the scanner axes. A "sagittal" cut at constant R is a scanner-axis plane, not exactly this anatomical midline.',
    },
  },
  transforms: [
    { step: 'decimation', tool: 'meshoptimizer 0.22.0 simplify', params: PARAMS, note: 'per-structure achieved error in model.decimationErrorMm' },
    { step: 'quantisation', positions: 'int16', normals: 'int8', offsetMm, scaleMm, note: 'decoded = int16 * scaleMm + offsetMm (RAS mm)' },
    { step: 'encoding', tool: 'meshoptimizer vertex/index codecs', vertexStride: STRIDE },
  ],
  display: { note: 'Viewer-only transform, never written back: three.js (x, y, z) = (R, S, −A) × 0.001 m/mm.' },
  quantisation: { offsetMm, scaleMm, vertexStride: STRIDE },
  generatedBy: 'tools/atlas/build-atlas.mjs',
  totals: {
    structures: outStructures.length, groups: groups.length, sourceTriangles: trisBefore, triangles,
    labelChecked: present.length,
    labelBboxToleranceMm: LABEL_BBOX_TOLERANCE_MM,
    labelDiscrepancies: outStructures.filter((s) => s.labelCheck.flag).map((s) => s.id),
    labelCheckMaxBboxDifferenceMm: Math.max(...present.map((s) => s.labelCheck.bboxMaxDifferenceMm)),
    maxDecimationErrorMm: Math.max(...outStructures.map((s) => s.model.decimationErrorMm)),
  },
  chunks: outChunks,
  groups: groups.map((g) => ({ id: g.sourceId.slice(1), sourceId: g.sourceId, name: g.name, parentId: g.parentId ? g.parentId.slice(1) : null, sourceColor: g.color })),
  structures: outStructures,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));

const MB = (n) => (n / 1e6).toFixed(2) + ' MB';
console.log(`source ${sourceCommit.slice(0, 7)} · ${outStructures.length} structures in ${groups.length} groups · ${trisBefore.toLocaleString()} → ${triangles.toLocaleString()} triangles · ${Date.now() - t0} ms`);
for (const c of outChunks) console.log(`  ${c.name.padEnd(13)} ${MB(c.bytes).padStart(9)}  sha256 ${c.sha256.slice(0, 12)}…`);
console.log(`  manifest      ${MB(fs.statSync(path.join(OUT, 'manifest.json')).size).padStart(9)}`);
const byTissue = {};
for (const s of outStructures) byTissue[s.tissue] = (byTissue[s.tissue] ?? 0) + 1;
console.log('  tissue classes:', JSON.stringify(byTissue));
console.log(`  label volume: ${present.length}/${outStructures.length} structures have voxels; max bbox difference ${manifest.totals.labelCheckMaxBboxDifferenceMm} mm`);
console.log(`  mid-sagittal plane: x = ${round(plane.a, 2)} + ${round(plane.b, 4)}·y + ${round(plane.c, 4)}·z  (yaw ${round(Math.atan(plane.b) * 180 / Math.PI, 2)}°, roll ${round(Math.atan(plane.c) * 180 / Math.PI, 2)}°, rms ${round(plane.rms, 2)} mm over ${mids.length} pairs)`);
console.log(`  max decimation error ${manifest.totals.maxDecimationErrorMm} mm`);
if (warnings.length) { console.log(`\n${warnings.length} source discrepancy warning(s) (recorded as labelCheck.flag):`); for (const w of warnings) console.log('  ! ' + w); }
if (problems.length) { console.log(`\n${problems.length} PROBLEM(S):`); for (const p of problems) console.log('  ✗ ' + p); process.exitCode = 1; }
