// Minimal NRRD0004 reader for the SPL volumes (type short or float, 3-D, gzip, little-endian, space LPS).
// Returns the voxel array and the voxel-index → RAS-millimetre affine derived from the header (nothing assumed).
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const vec = (s) => s.replace(/[()]/g, '').split(',').map(Number);

/** @param {string} file */
export function readNrrd(file) {
  const buf = fs.readFileSync(file);
  const end = buf.indexOf('\n\n');
  if (end < 0) throw new Error(`${file}: NRRD header terminator not found`);
  const header = {};
  for (const line of buf.subarray(0, end).toString('latin1').split('\n')) {
    if (line.startsWith('#') || line.startsWith('NRRD')) continue;
    const i = line.indexOf(':');
    if (i > 0) header[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^=/, '').trim();
  }
  if (header.dimension !== '3') throw new Error(`${file}: expected a 3-D volume`);
  const isFloat = header.type === 'float';
  if (!isFloat && header.type !== 'short' && header.type !== 'unsigned short') throw new Error(`${file}: unsupported type ${header.type}`);
  if (header.endian !== 'little') throw new Error(`${file}: unsupported endian ${header.endian}`);
  if (header.encoding !== 'gzip' && header.encoding !== 'gz') throw new Error(`${file}: unsupported encoding ${header.encoding}`);
  const space = header.space;
  if (space !== 'left-posterior-superior' && space !== 'right-anterior-superior') throw new Error(`${file}: unsupported space ${space}`);
  const sizes = header.sizes.split(/\s+/).map(Number);
  const dirs = header['space directions'].split(/\s+/).map(vec);
  const origin = vec(header['space origin']);
  const raw = gunzipSync(buf.subarray(end + 2));
  const n = sizes[0] * sizes[1] * sizes[2];
  const bytes = isFloat ? 4 : 2;
  if (raw.byteLength !== n * bytes) throw new Error(`${file}: ${raw.byteLength} bytes, expected ${n * bytes}`);
  // copy so the typed array is aligned whatever the gunzip buffer's offset is
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * bytes);
  const data = isFloat ? new Float32Array(ab) : new Int16Array(ab);
  // LPS → RAS flips the first two world axes.
  const f = space === 'left-posterior-superior' ? [-1, -1, 1] : [1, 1, 1];
  const toRas = (i, j, k) => [0, 1, 2].map((a) => f[a] * (origin[a] + i * dirs[0][a] + j * dirs[1][a] + k * dirs[2][a]));
  // inverse: RAS mm → continuous voxel index (the direction matrix of these volumes is a signed permutation × spacing)
  const cols = [0, 1, 2].map((axis) => [0, 1, 2].map((a) => f[a] * dirs[axis][a]));
  const o = [0, 1, 2].map((a) => f[a] * origin[a]);
  const toVoxel = (r, a, s) => {
    const d = [r - o[0], a - o[1], s - o[2]];
    return cols.map((c) => (d[0] * c[0] + d[1] * c[1] + d[2] * c[2]) / (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]));
  };
  for (let x = 0; x < 3; x++) for (let y = x + 1; y < 3; y++) {
    if (Math.abs(cols[x][0] * cols[y][0] + cols[x][1] * cols[y][1] + cols[x][2] * cols[y][2]) > 1e-9) throw new Error(`${file}: non-orthogonal space directions`);
  }
  return { header, sizes, data, toRas, toVoxel, spaceDirections: dirs, origin, space };
}

/**
 * Per-label voxel count, centroid and bounding box in RAS millimetres (voxel centres).
 * @returns {Map<number, {voxels: number, centroid: number[], min: number[], max: number[]}>}
 */
export function labelStats(vol) {
  const [nx, ny, nz] = vol.sizes;
  const acc = new Map();
  let p = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, p++) {
    const v = vol.data[p];
    if (v === 0) continue;
    let a = acc.get(v);
    if (!a) { a = { voxels: 0, sum: [0, 0, 0], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; acc.set(v, a); }
    const r = vol.toRas(i, j, k);
    a.voxels++;
    for (let c = 0; c < 3; c++) { a.sum[c] += r[c]; if (r[c] < a.min[c]) a.min[c] = r[c]; if (r[c] > a.max[c]) a.max[c] = r[c]; }
  }
  const out = new Map();
  for (const [v, a] of acc) out.set(v, { voxels: a.voxels, centroid: a.sum.map((s) => s / a.voxels), min: a.min, max: a.max });
  return out;
}
