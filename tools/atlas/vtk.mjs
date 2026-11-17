// Minimal legacy-VTK (binary, DataFile 3.x/4.x) POLYDATA parser: big-endian float32 POINTS, int32 connectivity.
// Handles POLYGONS and TRIANGLE_STRIPS (3D Slicer exports strips). Reads NORMALS when present.
//
// Adapted from glin23/brain-atlas scripts/vtk.mjs (MIT, © 2026 Lee Lin) at commit 65502a7 — see docs/LICENCES.md.
// Changes: degenerate-strip handling kept, explicit errors, returns the triangle count of the source file.
import fs from 'node:fs';

/**
 * @param {string} file
 * @returns {{positions: Float32Array, normals: Float32Array | null, indices: Uint32Array, vertexCount: number, cellKind: string}}
 */
export function parseVtk(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('latin1');
  if (!/^# vtk DataFile/.test(text) || !/\nBINARY\n/.test(text.slice(0, 200)) || !/DATASET POLYDATA/.test(text.slice(0, 300))) {
    throw new Error(`${file}: not a binary legacy-VTK POLYDATA file`);
  }
  const mP = /POINTS\s+(\d+)\s+float\n/.exec(text);
  if (!mP) throw new Error(`${file}: no POINTS section`);
  const nP = +mP[1];
  let off = mP.index + mP[0].length;
  const positions = new Float32Array(nP * 3);
  for (let i = 0; i < nP * 3; i++) positions[i] = buf.readFloatBE(off + i * 4);
  off += nP * 12;
  const mG = /(POLYGONS|TRIANGLE_STRIPS)\s+(\d+)\s+(\d+)\n/.exec(text.slice(off));
  if (!mG) throw new Error(`${file}: no POLYGONS / TRIANGLE_STRIPS section`);
  const cellKind = mG[1];
  const nCell = +mG[2];
  let o = off + mG.index + mG[0].length;
  const tri = [];
  for (let p = 0; p < nCell; p++) {
    const c = buf.readInt32BE(o); o += 4;
    const idx = new Array(c);
    for (let k = 0; k < c; k++) { idx[k] = buf.readInt32BE(o); o += 4; }
    if (cellKind === 'POLYGONS') {
      for (let k = 1; k + 1 < c; k++) tri.push(idx[0], idx[k], idx[k + 1]);
      continue;
    }
    for (let k = 2; k < c; k++) {
      const a = idx[k - 2], b = idx[k - 1], d = idx[k];
      if (a === b || b === d || a === d) continue; // degenerate strip joint
      if (k % 2 === 0) tri.push(a, b, d); else tri.push(b, a, d);
    }
  }
  let normals = null;
  const mN = /NORMALS\s+\S+\s+float\n/.exec(text.slice(o));
  if (mN) {
    const n0 = o + mN.index + mN[0].length;
    normals = new Float32Array(nP * 3);
    for (let i = 0; i < nP * 3; i++) normals[i] = buf.readFloatBE(n0 + i * 4);
  }
  return { positions, normals, indices: new Uint32Array(tri), vertexCount: nP, cellKind };
}
