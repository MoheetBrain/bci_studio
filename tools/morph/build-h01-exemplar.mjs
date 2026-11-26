// Builds the one reconstructed neuron the world shows: a proofread cell of the H01 release, as a compact skeleton.
//
//   node tools/morph/build-h01-exemplar.mjs
//
// SOURCE   H01 release (Shapson-Coe et al., Science 2024, doi:10.1126/science.adk4858): one cubic millimetre of HUMAN
//          TEMPORAL cortex, removed at surgery, imaged by serial-section electron microscopy and segmented. "All
//          released datasets are licensed under a Creative Commons Attribution 4.0 License"
//          (https://h01-release.storage.googleapis.com/data.html, read 2026-11-25).
// WHAT     "104 proofread cells: 104 manually traced and proofread cells", published as SWC reconstructions in one
//          60 MB archive. This tool reads the archive's DIRECTORY and then ONE entry of it by HTTP byte range (about
//          0.6 MB), so the rest is never downloaded.
// WHICH    Cell 2252715458, which the dataset's own segment properties tag "L2", "pyramidal", "neuron".
// UNITS    Found from the data, not assumed: x and y are voxels of 32 nm, z is sections of 33 nm (the volume's `info`
//          gives 128973 × 89100 × 5293 voxels at 32 × 32 × 33 nm, which contains the coordinates; a soma is about as
//          wide in x and y as it is deep in z only at about that scale); radius is in nanometres.
// LABELS   The SWC "type" column carries the release's subcompartment classes on some nodes. Code 3 sits on the widest
//          nodes (the cell body); code 5 on a short stretch 11–53 µm from the body, and what lies beyond it is code 0
//          — so 5 is read as axon initial segment, 0 as axon, 1 as dendrite. Unlabelled nodes take the label of the
//          node before them on the way out from the body. These are the dataset's automatic labels as read here: an
//          inference about its coding, checked against the data but not against documentation.
// CHANGES  (CC BY asks that changes be stated.) Coordinates are converted to micrometres and expressed in the cell's
//          own frame: origin at the cell body; +y towards the middle of its dendrites, within the plane of the
//          sections (taken as "towards the surface" for display — the release's layer annotation was not used); z
//          across the sections. The few nodes inside the cell body are merged into one. Each unbranched stretch is
//          simplified to within TOL micrometres. Nothing is added, smoothed or mirrored.
//
// What this is NOT: precentral gyrus (it is temporal cortex), a cell of the atlas volunteer, or a cell with any
// electrical model in this studio. The sample is a slab about 175 µm thick: branches end where they left it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ARCHIVE = 'https://storage.googleapis.com/h01-release/data/20210601/proofread_104/skeletons/104_proofread_neurons_swc.zip';
const SEGMENT = '2252715458', ENTRY = `${SEGMENT}.0.swc`;
const TAGS = ['L2', 'pyramidal', 'neuron'];                 // from proofread_104/segment_properties/info, read 2026-11-25
const NM = { x: 32, y: 32, z: 33 }, TOL_UM = 0.18;
const cache = join(root, 'tools/morph/.cache'), out = join(root, 'public/world/h01-exemplar.json');

async function range(a, b) {
  const r = await fetch(ARCHIVE, { headers: { Range: `bytes=${a}-${b}`, 'User-Agent': 'bci-studio-asset-build/1.0' } });
  if (r.status !== 206) throw new Error(`range request returned HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function fetchEntry() {
  const file = join(cache, ENTRY);
  if (existsSync(file)) return { bytes: readFileSync(file), fetched: 0, archiveBytes: null };
  const head = await fetch(ARCHIVE, { method: 'HEAD', headers: { 'User-Agent': 'bci-studio-asset-build/1.0' } });
  const size = +head.headers.get('content-length');
  const tail = await range(size - 70000, size - 1), eocd = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (eocd < 0) throw new Error('zip end record not found');
  const cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16), cd = await range(cdOff, cdOff + cdSize - 1);
  let p = 0, hit = null;
  while (p < cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), nlen = cd.readUInt16LE(p + 28), elen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), off = cd.readUInt32LE(p + 42);
    if (cd.toString('utf8', p + 46, p + 46 + nlen) === ENTRY) hit = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  if (!hit) throw new Error(`${ENTRY} is not in the archive`);
  const lh = await range(hit.off, hit.off + 29), start = hit.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const raw = await range(start, start + hit.csize - 1), bytes = hit.method === 8 ? inflateRawSync(raw) : raw;
  mkdirSync(cache, { recursive: true }); writeFileSync(file, bytes);
  return { bytes, fetched: 70000 + cdSize + 30 + hit.csize, archiveBytes: size };
}

const { bytes, fetched, archiveBytes } = await fetchEntry();
const sha256 = createHash('sha256').update(bytes).digest('hex');
const N = new Map();
for (const line of bytes.toString('utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const f = line.trim().split(/\s+/);
  N.set(+f[0], { t: +f[1], p: [(+f[2] * NM.x) / 1000, (+f[3] * NM.y) / 1000, (+f[4] * NM.z) / 1000], r: +f[5] / 1000, par: +f[6] });
}
const adj = new Map([...N.keys()].map((k) => [k, []]));
for (const [i, n] of N) if (N.has(n.par)) { adj.get(i).push(n.par); adj.get(n.par).push(i); }
// the cell body: the widest node
let soma = -1;
for (const [i, n] of N) if (soma < 0 || n.r > N.get(soma).r) soma = i;
// walk out from the body
const order = [soma], par = new Map([[soma, -1]]), kids = new Map([...N.keys()].map((k) => [k, []])), path = new Map([[soma, 0]]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
for (let q = 0; q < order.length; q++) {
  const i = order[q];
  for (const j of adj.get(i)) if (!par.has(j)) { par.set(j, i); kids.get(i).push(j); path.set(j, path.get(i) + dist(N.get(i).p, N.get(j).p)); order.push(j); }
}
if (order.length !== N.size) throw new Error('the skeleton is not one tree');
// labels: 0 axon · 1 dendrite · 2 axon initial segment · 3 cell body (the release's codes 0, 1, 5, 3), carried outwards
const CODE = new Map([[0, 0], [1, 1], [5, 2], [3, 3]]), label = new Map();
for (const i of order) { const c = CODE.get(N.get(i).t); label.set(i, c != null ? c : par.get(i) < 0 ? 3 : label.get(par.get(i))); }
// a node labelled "cell body" away from the body is a classifier slip: outside the body's own radius it is dendrite
const S = N.get(soma).p, R = N.get(soma).r;
for (const i of order) if (label.get(i) === 3 && dist(N.get(i).p, S) > R * 1.6) label.set(i, par.get(i) >= 0 && label.get(par.get(i)) !== 3 ? label.get(par.get(i)) : 1);
// check the reading of the codes: beyond the axon initial segment the labelled nodes must be axon
{ const ais = order.filter((i) => N.get(i).t === 5), seen = new Set(ais), stack = [...ais]; let ax = 0, de = 0;
  while (stack.length) for (const j of kids.get(stack.pop())) if (!seen.has(j)) { seen.add(j); stack.push(j); if (N.get(j).t === 0) ax++; else if (N.get(j).t === 1) de++; }
  if (!(ais.length >= 5 && ax > 20 * Math.max(1, de))) throw new Error(`label check failed: ${ais.length} initial-segment nodes, ${ax} axon and ${de} dendrite labels beyond them`); }

// the cell's frame
const dend = order.filter((i) => label.get(i) === 1);
const c = [0, 1, 2].map((k) => dend.reduce((a, i) => a + N.get(i).p[k], 0) / dend.length - S[k]);
const un = Math.hypot(c[0], c[1]), Y = [c[0] / un, c[1] / un, 0], Z = [0, 0, 1], X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
const local = (p) => { const d = [p[0] - S[0], p[1] - S[1], p[2] - S[2]]; return [d[0] * X[0] + d[1] * X[1] + d[2] * X[2], d[0] * Y[0] + d[1] * Y[1] + d[2] * Y[2], d[0] * Z[0] + d[1] * Z[1] + d[2] * Z[2]]; };

// merge the nodes inside the body into the body; then simplify every unbranched stretch
const inBody = (i) => i === soma || label.get(i) === 3;
const outParent = new Map();                       // nearest ancestor that is kept as a "key" candidate (outside the body, or the body)
for (const i of order) { if (i === soma) continue; let a = par.get(i); while (a !== soma && inBody(a)) a = par.get(a); outParent.set(i, a); }
const kept = order.filter((i) => !inBody(i) || i === soma), childCount = new Map(kept.map((i) => [i, 0]));
for (const i of kept) if (i !== soma) childCount.set(outParent.get(i), childCount.get(outParent.get(i)) + 1);
const isKey = (i) => i === soma || childCount.get(i) !== 1 || label.get(i) !== label.get(outParent.get(i));
const keep = new Set([soma]);
for (const tip of kept) {
  if (!isKey(tip) || tip === soma) continue;
  // the stretch from this key node back to the previous key node
  const chain = [tip]; let a = outParent.get(tip);
  while (!isKey(a)) { chain.push(a); a = outParent.get(a); }
  chain.push(a); chain.reverse();
  const pts = chain.map((i) => N.get(i).p), stack = [[0, chain.length - 1]];
  keep.add(chain[0]); keep.add(chain[chain.length - 1]);
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const A = pts[lo], B = pts[hi], ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    let worst = -1, wd = 0;
    for (let k = lo + 1; k < hi; k++) {
      const ap = [pts[k][0] - A[0], pts[k][1] - A[1], pts[k][2] - A[2]], u = L2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0;
      const d = Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1], ap[2] - u * ab[2]);
      // a marked change of calibre is kept as well, so that tapering survives
      const rr = N.get(chain[k]).r, rl = N.get(chain[lo]).r + (N.get(chain[hi]).r - N.get(chain[lo]).r) * u, score = Math.max(d, Math.abs(rr - rl) * 0.8);
      if (score > wd) { wd = score; worst = k; }
    }
    if (wd > TOL_UM) { keep.add(chain[worst]); stack.push([lo, worst], [worst, hi]); }
  }
}
const final = kept.filter((i) => keep.has(i)), index = new Map(final.map((i, k) => [i, k]));
const parentOf = (i) => { let a = outParent.get(i); while (!keep.has(a)) a = outParent.get(a); return a; };
const r2 = (v, d) => +v.toFixed(d);
const nodes = { x: [], y: [], z: [], r: [], parent: [], label: [], path: [] };
for (const i of final) {
  const q = local(N.get(i).p);
  nodes.x.push(r2(q[0], 2)); nodes.y.push(r2(q[1], 2)); nodes.z.push(r2(q[2], 2)); nodes.r.push(r2(i === soma ? R : N.get(i).r, 3));
  nodes.parent.push(i === soma ? -1 : index.get(parentOf(i))); nodes.label.push(i === soma ? 3 : label.get(i)); nodes.path.push(r2(path.get(i), 1));
}
const cable = (L) => final.reduce((a, i, k) => (i !== soma && nodes.label[k] === L ? a + dist(N.get(i).p, N.get(parentOf(i)).p) : a), 0);
const tips = final.filter((i) => i !== soma && !final.some((j) => j !== soma && parentOf(j) === i)).length;
const ext = (k) => [Math.min(...nodes[k]), Math.max(...nodes[k])];
const asset = {
  format: 'hbci-morphology/1',
  what: 'One reconstructed human neuron: the skeleton (branch geometry and calibre) of a proofread cell of the H01 release, simplified.',
  provenance: {
    dataset: 'H01 release: a cubic millimetre of human temporal cortex, serial-section electron microscopy, automated segmentation',
    landingPage: 'https://h01-release.storage.googleapis.com/data.html',
    citation: 'Shapson-Coe A, Januszewski M, Berger DR, et al. A petavoxel fragment of human cerebral cortex reconstructed at nanoscale resolution. Science 384, eadk4858 (2024). doi:10.1126/science.adk4858',
    licence: 'Creative Commons Attribution 4.0 (CC BY 4.0)', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenceStatement: 'All released datasets are licensed under a Creative Commons Attribution 4.0 License. (data page, read 2026-11-25)',
    collection: '104 proofread cells: 104 manually traced and proofread cells', archive: ARCHIVE, entry: ENTRY, entrySha256: sha256,
    segmentId: SEGMENT, datasetTags: TAGS,
    species: 'human', region: 'temporal cortex (not the precentral gyrus)', preparation: 'tissue removed at surgery to reach an epileptic focus; fixed; imaged in a slab about 175 µm thick',
    reconstruction: 'automated segmentation of the electron-microscopy volume, then manual tracing and proofreading by the dataset’s authors; skeletonised by them',
  },
  units: { source: 'x, y: 32 nm voxels · z: 33 nm sections · radius: nm', here: 'micrometres' },
  frame: { origin: 'the cell body', y: 'from the cell body towards the mean position of the dendrites, within the plane of the sections; used as “towards the cortical surface” for display', z: 'across the sections (the slab’s thin direction)', note: 'The release’s cortical-layer annotation was not used to orient the cell.' },
  labels: { codes: ['axon', 'dendrite', 'axon initial segment', 'cell body'], how: 'The release’s subcompartment classes where a node carries one (codes 0, 1, 5, 3 as read from the data), carried outwards from the cell body to unlabelled nodes. Automatic labels; not verified here.' },
  changes: [`converted to micrometres and rotated into the cell’s own frame`, 'the nodes inside the cell body merged into one', `each unbranched stretch simplified to within ${TOL_UM} µm (and 0.8 × that for calibre)`],
  limits: ['Not precentral gyrus, not the atlas volunteer, not connected to any model cell.', 'No electrical model is attached to it in this studio.', 'The sample is a slab: branches end where they left it.', 'Calibre is the skeleton’s radius estimate; membrane texture is not in the data.'],
  counts: { sourceNodes: N.size, nodes: final.length, tips, dendriteMm: r2(cable(1) / 1000, 2), axonMm: r2((cable(0) + cable(2)) / 1000, 2), somaRadiusUm: r2(R, 2), extentUm: { x: ext('x'), y: ext('y'), z: ext('z') } },
  nodes,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(asset));
console.log(`${ENTRY}: ${N.size} nodes → ${final.length} (${tips} tips), dendrite ${asset.counts.dendriteMm} mm, axon ${asset.counts.axonMm} mm, cell body radius ${asset.counts.somaRadiusUm} µm`);
console.log(`extent µm  x ${ext('x')}  y ${ext('y')}  z ${ext('z')}`);
console.log(`source sha256 ${sha256}; ${fetched ? `fetched ${(fetched / 1e6).toFixed(2)} MB of the ${(archiveBytes / 1e6).toFixed(1)} MB archive` : 'read from the local cache'}`);
console.log(`wrote ${out} (${(JSON.stringify(asset).length / 1024).toFixed(0)} kB)`);
