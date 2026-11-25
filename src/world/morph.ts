// Cell shapes for the representative circuit.
//
// ILLUSTRATIVE REPRESENTATION. These are generated shapes — a body, branching dendrites, a thin axon — drawn at a
// consistent scale (bodies ~18 µm across, dendrites a few hundred µm) so the scene reads as tissue. They are not
// reconstructions of real neurons, they are not the cells at any atlas location, and no model in this app computes
// anything along them: the LIF cells are single points. The positions of the BODIES are the models' own coordinates.
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { mulberry32 } from '../experiment/model/rng';
import type { SceneCell } from './runtime';

interface Build { pos: number[]; nor: number[]; cell: number[]; kind: number[]; along: number[]; tip: number[]; idx: number[] }
const newBuild = (): Build => ({ pos: [], nor: [], cell: [], kind: [], along: [], tip: [], idx: [] });
export interface Detail { somaU: number; somaV: number; radial: number; segPer100: number; branches: number }
export const FOREGROUND: Detail = { somaU: 36, somaV: 24, radial: 9, segPer100: 13, branches: 1 };
export const BACKDROP: Detail = { somaU: 12, somaV: 8, radial: 4, segPer100: 4, branches: 0.5 };

function soma(b: Build, c: Vector3, r: number, tall: number, taper: boolean, cell: number, d: Detail, ph: number): void {
  const base = b.pos.length / 3;
  for (let v = 0; v <= d.somaV; v++) {
    const lat = (v / d.somaV) * Math.PI, sy = Math.cos(lat), sr = Math.sin(lat);
    for (let u = 0; u <= d.somaU; u++) {
      const lon = (u / d.somaU) * 2 * Math.PI, dx = sr * Math.cos(lon), dz = sr * Math.sin(lon);
      // a pyramidal body narrows towards the apical dendrite
      const narrow = taper && sy > 0 ? 1 - 0.38 * sy * sy : 1, bump = 1 + 0.045 * Math.sin(5 * lon + ph) * Math.sin(4 * lat + ph * 1.7);
      const x = dx * r * narrow * bump, y = sy * r * tall * bump, z = dz * r * narrow * bump;
      b.pos.push(c.x + x, c.y + y, c.z + z);
      const nx = dx / narrow, ny = sy / tall, nz = dz / narrow, n = Math.hypot(nx, ny, nz) || 1;
      b.nor.push(nx / n, ny / n, nz / n); b.cell.push(cell); b.kind.push(0); b.along.push(0); b.tip.push(0);
    }
  }
  const w = d.somaU + 1;
  for (let v = 0; v < d.somaV; v++) for (let u = 0; u < d.somaU; u++) { const a = base + v * w + u, q = a + w; b.idx.push(a, a + 1, q, a + 1, q + 1, q); }
}

/**
 * A tapering tube through points (Catmull–Rom), closed at the tip. `a0`…`a1`: how far from the body it runs (0…1).
 * A `terminal` tube is the last stretch of a branch: the material lets it thin out towards its tip.
 */
function tube(b: Build, pts: Vector3[], r0: number, r1: number, cell: number, kind: number, a0: number, a1: number, d: Detail, terminal = false): void {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  const segs = Math.max(3, Math.round((len / 100) * d.segPer100)), base = b.pos.length / 3, R = d.radial;
  const at = (t: number, out: Vector3) => {
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c = (k: 'x' | 'y' | 'z') => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u * u * u);
    return out.set(c('x'), c('y'), c('z'));
  };
  const p = new Vector3(), q = new Vector3(), tan = new Vector3(), nrm = new Vector3(1, 0, 0), bin = new Vector3();
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    at(t, p); at(Math.min(1, t + 0.01), q); tan.copy(q).sub(at(Math.max(0, t - 0.01), q)).normalize();
    // carry the frame along the curve: remove the tangent's part from the previous normal
    nrm.addScaledVector(tan, -nrm.dot(tan));
    if (nrm.lengthSq() < 1e-6) { nrm.set(Math.abs(tan.x) > 0.9 ? 0 : 1, Math.abs(tan.x) > 0.9 ? 1 : 0, 0); nrm.addScaledVector(tan, -nrm.dot(tan)); }
    nrm.normalize(); bin.crossVectors(tan, nrm);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j < R; j++) {
      const a = (j / R) * 2 * Math.PI, cx = Math.cos(a), sx = Math.sin(a), nx = nrm.x * cx + bin.x * sx, ny = nrm.y * cx + bin.y * sx, nz = nrm.z * cx + bin.z * sx;
      b.pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r); b.nor.push(nx, ny, nz); b.cell.push(cell); b.kind.push(kind); b.along.push(a0 + (a1 - a0) * t); b.tip.push(terminal ? t : 0);
    }
  }
  for (let s = 0; s < segs; s++) for (let j = 0; j < R; j++) { const a = base + s * R + j, n = base + s * R + ((j + 1) % R); b.idx.push(a, n, a + R, n, n + R, a + R); }
  // tip
  const tip = b.pos.length / 3; at(1, p);
  b.pos.push(p.x, p.y, p.z); b.nor.push(tan.x, tan.y, tan.z); b.cell.push(cell); b.kind.push(kind); b.along.push(a1); b.tip.push(terminal ? 1 : 0);
  for (let j = 0; j < R; j++) b.idx.push(base + segs * R + j, base + segs * R + ((j + 1) % R), tip);
}

function branch(b: Build, from: Vector3, dir: Vector3, len: number, r0: number, r1: number, cell: number, kind: number, a0: number, d: Detail, rnd: () => number, fork: boolean): void {
  const bend = new Vector3((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.5);
  const mid = from.clone().addScaledVector(dir, len * 0.5).addScaledVector(bend, len * 0.3), end = from.clone().addScaledVector(dir, len).addScaledVector(bend, len * 0.55);
  const a1 = Math.min(1, a0 + len / 260);
  // a little meander between the control points, so that no branch is a clean arc
  const wob = (p: Vector3, k: number) => p.add(new Vector3((rnd() - 0.5) * len * k, (rnd() - 0.5) * len * k, (rnd() - 0.5) * len * k));
  if (!fork) {
    const pts = d.branches >= 1 ? [from, wob(from.clone().lerp(mid, 0.5), 0.07), mid, wob(mid.clone().lerp(end, 0.5), 0.09), end] : [from, mid, end];
    tube(b, pts, r0, r1, cell, kind, a0, a1, d, true);
    return;
  }
  const split = from.clone().lerp(end, 0.55).addScaledVector(bend, len * 0.12);
  tube(b, [from, mid.clone().lerp(from, 0.3), split], r0, (r0 + r1) / 2, cell, kind, a0, (a0 + a1) / 2, d);
  for (const s of [-1, 1]) {
    const side = new Vector3(dir.z, (rnd() - 0.5) * 0.6, -dir.x).multiplyScalar(s * (0.45 + rnd() * 0.35)).add(dir).normalize();
    const c1 = split.clone().addScaledVector(side, len * 0.3), c2 = split.clone().addScaledVector(side, len * 0.62).addScaledVector(bend, len * 0.2);
    tube(b, [split, wob(c1, 0.05), c2], (r0 + r1) / 2, r1 * 0.8, cell, kind, (a0 + a1) / 2, a1, d, true);
    // a second-order twig on some of them (foreground detail only)
    if (d.branches >= 1 && rnd() < 0.5) {
      const tw = new Vector3((rnd() - 0.5), (rnd() - 0.5) * 0.7, (rnd() - 0.5)).add(side).normalize();
      tube(b, [c1, c1.clone().addScaledVector(tw, len * 0.16), c1.clone().addScaledVector(tw, len * 0.34).addScaledVector(bend, len * 0.08)], r1 * 0.85, r1 * 0.55, cell, kind, (a0 + a1) / 2, a1, d, true);
    }
  }
}

function buildCell(b: Build, c: SceneCell, index: number, d: Detail, seed: number): void {
  const rnd = mulberry32(seed), C = new Vector3(c.pos[0], c.pos[1], c.pos[2]), r = c.radius, some = (p: number) => rnd() < p * d.branches;
  if (c.shape === 'pyramidal') {
    soma(b, C, r, 1.22, true, index, d, rnd() * 6);
    // apical dendrite: up towards the surface, with oblique branches and a tuft
    const n = 5, H = 190 + rnd() * 130, trunk = [C.clone().add(new Vector3(0, r * 1.05, 0))];
    for (let k = 1; k <= n; k++) trunk.push(trunk[k - 1].clone().add(new Vector3((rnd() - 0.5) * 24, H / n, (rnd() - 0.5) * 24)));
    tube(b, trunk, r * 0.36, 1.0, index, 1, 0.04, 0.75, d);
    for (let k = 1; k <= 3; k++) {
      if (!some(0.85)) continue;
      const az = rnd() * 2 * Math.PI, dir = new Vector3(Math.cos(az), 0.35 + rnd() * 0.5, Math.sin(az)).normalize();
      branch(b, trunk[k], dir, 45 + rnd() * 55, 1.15, 0.42, index, 1, 0.2 + k * 0.12, d, rnd, d.branches >= 1 && rnd() < 0.4);
    }
    for (let k = 0; k < 3; k++) { const az = (k / 3) * 2 * Math.PI + rnd(), dir = new Vector3(Math.cos(az) * 0.8, 0.75, Math.sin(az) * 0.8).normalize(); branch(b, trunk[n], dir, 45 + rnd() * 45, 0.95, 0.4, index, 1, 0.75, d, rnd, false); }
    // basal dendrites
    const nb = d.branches >= 1 ? 4 + Math.floor(rnd() * 2.2) : 3;
    for (let k = 0; k < nb; k++) {
      const az = (k / nb) * 2 * Math.PI + rnd() * 0.8, el = -0.15 - rnd() * 0.75, dir = new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      branch(b, C.clone().addScaledVector(dir, r * 0.85), dir, 60 + rnd() * 55, 1.7, 0.48, index, 1, 0.05, d, rnd, d.branches >= 1 && rnd() < 0.75);
    }
    // axon: thin, straight down
    const ax = [C.clone().add(new Vector3(0, -r * 1.1, 0))];
    for (let k = 1; k <= 3; k++) ax.push(ax[k - 1].clone().add(new Vector3((rnd() - 0.5) * 16, -(40 + rnd() * 22), (rnd() - 0.5) * 16)));
    tube(b, ax, 1.0, 0.5, index, 2, 0.05, 0.7, d, true);
  } else {
    soma(b, C, r, 1.0, false, index, d, rnd() * 6);
    const nd = d.branches >= 1 ? 6 + Math.floor(rnd() * 2.5) : 4;
    for (let k = 0; k < nd; k++) {
      const u = rnd() * 2 - 1, az = rnd() * 2 * Math.PI, s = Math.sqrt(1 - u * u), dir = new Vector3(s * Math.cos(az), u, s * Math.sin(az));
      branch(b, C.clone().addScaledVector(dir, r * 0.85), dir, 48 + rnd() * 55, 1.3, 0.42, index, 1, 0.05, d, rnd, d.branches >= 1 && rnd() < 0.7);
    }
  }
}

function finish(b: Build): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3));
  g.setAttribute('aCell', new BufferAttribute(new Float32Array(b.cell), 1));
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(b.kind), 1));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(b.along), 1));
  g.setAttribute('aTip', new BufferAttribute(new Float32Array(b.tip), 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/** One geometry for the cells a toy's model owns. Vertex attribute aCell = index into `cells`. */
export function buildForeground(cells: readonly SceneCell[], seed = 1): BufferGeometry {
  const b = newBuild();
  cells.forEach((c, i) => buildCell(b, c, i, FOREGROUND, 7000 + seed * 131 + i * 17));
  return finish(b);
}

/**
 * The backdrop: cells that are simply there, in a shell around the circuit (never closer than `clear` µm to its
 * centre), at reduced detail. They take part in nothing. Returns the geometry and the body positions (for tests).
 */
export function buildBackdrop(count: number, clear: number, reach: number, seed = 4242): { geometry: BufferGeometry; bodies: Array<[number, number, number]> } {
  const b = newBuild(), rnd = mulberry32(seed), bodies: Array<[number, number, number]> = [];
  let guard = 0;
  while (bodies.length < count && guard++ < count * 40) {
    const x = (rnd() * 2 - 1) * reach, y = (rnd() * 2 - 1) * reach * 0.62, z = (rnd() * 2 - 1) * reach;
    if (Math.hypot(x, y * 1.4, z) < clear) continue;
    if (bodies.some((p) => Math.hypot(p[0] - x, p[1] - y, p[2] - z) < 46)) continue;
    bodies.push([x, y, z]);
    buildCell(b, { id: '', label: '', pos: [x, y, z], radius: 7.5 + rnd() * 3, tint: 'far', shape: rnd() < 0.8 ? 'pyramidal' : 'multipolar' }, -1, BACKDROP, 90000 + bodies.length * 13);
  }
  return { geometry: finish(b), bodies };
}

/** A curved path from one cell body to another (for drawing a connection). Leaves from below the sender, as an axon does. */
export function linkPath(from: SceneCell, to: SceneCell, bow = 0.16): Vector3[] {
  const a = new Vector3(...from.pos), z = new Vector3(...to.pos), dir = z.clone().sub(a), len = dir.length();
  dir.normalize();
  const start = a.clone().add(new Vector3(0, -from.radius * 0.9, 0)).addScaledVector(dir, from.radius * 0.5), end = z.clone().addScaledVector(dir, -to.radius * 1.02);
  const side = new Vector3(dir.z, 0.6, -dir.x).normalize();
  const m1 = start.clone().lerp(end, 0.3).addScaledVector(side, -len * bow).add(new Vector3(0, -len * 0.1, 0)), m2 = start.clone().lerp(end, 0.72).addScaledVector(side, -len * bow * 0.6);
  return [start, m1, m2, end];
}

export interface Box { min: [number, number, number]; max: [number, number, number] }

/**
 * Backdrop cells scattered through a block of tissue, never nearer than a sphere's radius to any of the `avoid`
 * points (the model's own cells, the electrodes) and never on top of each other. They take part in nothing.
 */
export function buildBackdropBlock(count: number, box: Box, avoid: ReadonlyArray<{ p: readonly number[]; r: number }>, seed = 4242): { geometry: BufferGeometry; bodies: Array<[number, number, number]> } {
  const b = newBuild(), rnd = mulberry32(seed), bodies: Array<[number, number, number]> = [];
  let guard = 0;
  while (bodies.length < count && guard++ < count * 60) {
    const x = box.min[0] + rnd() * (box.max[0] - box.min[0]), y = box.min[1] + rnd() * (box.max[1] - box.min[1]), z = box.min[2] + rnd() * (box.max[2] - box.min[2]);
    if (avoid.some((a) => Math.hypot(a.p[0] - x, a.p[1] - y, a.p[2] - z) < a.r)) continue;
    if (bodies.some((p) => Math.hypot(p[0] - x, p[1] - y, p[2] - z) < 52)) continue;
    bodies.push([x, y, z]);
    buildCell(b, { id: '', label: '', pos: [x, y, z], radius: 7.5 + rnd() * 3, tint: 'far', shape: rnd() < 0.8 ? 'pyramidal' : 'multipolar' }, -1, BACKDROP, 90000 + bodies.length * 13);
  }
  return { geometry: finish(b), bodies };
}

/** Fine fibres (line segments) wandering through a block: the grain of the tissue between the cells. Scenery. */
export function buildFibres(count: number, box: Box, seed = 99): BufferGeometry {
  const rnd = mulberry32(seed), pos: number[] = [], sd: number[] = [], SEG = 7;
  for (let i = 0; i < count; i++) {
    let x = box.min[0] + rnd() * (box.max[0] - box.min[0]), y = box.min[1] + rnd() * (box.max[1] - box.min[1]), z = box.min[2] + rnd() * (box.max[2] - box.min[2]);
    // most fibres run roughly up-and-down (as apical dendrites and descending axons do), some across
    const across = rnd() < 0.3;
    let dx = (rnd() - 0.5) * (across ? 2 : 0.5), dy = across ? (rnd() - 0.5) * 0.5 : rnd() < 0.5 ? 1 : -1, dz = (rnd() - 0.5) * (across ? 2 : 0.5);
    const s = rnd(), step = 16 + rnd() * 20;
    for (let k = 0; k < SEG; k++) {
      const n = Math.hypot(dx, dy, dz) || 1, nx = x + (dx / n) * step, ny = y + (dy / n) * step, nz = z + (dz / n) * step;
      pos.push(x, y, z, nx, ny, nz); sd.push(s, s);
      x = nx; y = ny; z = nz;
      dx += (rnd() - 0.5) * 0.7; dy += (rnd() - 0.5) * 0.5; dz += (rnd() - 0.5) * 0.7;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(sd), 1));
  g.computeBoundingSphere();
  return g;
}

/** Specks suspended between the cells (points). Scenery: they make movement readable in empty stretches. */
export function buildMotes(count: number, box: Box, seed = 7): BufferGeometry {
  const rnd = mulberry32(seed), pos = new Float32Array(count * 3), sd = new Float32Array(count);
  for (let i = 0; i < count; i++) { for (let k = 0; k < 3; k++) pos[i * 3 + k] = box.min[k] + rnd() * (box.max[k] - box.min[k]); sd[i] = rnd(); }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new BufferAttribute(sd, 1));
  g.computeBoundingSphere();
  return g;
}
