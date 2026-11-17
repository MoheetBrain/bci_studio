// Procedural geometry helpers (no external CAD).
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Curve,
  ExtrudeGeometry,
  Path,
  Shape,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function roundedRectShape(w: number, d: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2, d / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedRectPath(w: number, d: number, r: number): Path {
  const p = new Path();
  const x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2, d / 2);
  // holes must wind opposite to the outer shape
  p.moveTo(x + r, y);
  p.quadraticCurveTo(x, y, x, y + r);
  p.lineTo(x, y + d - r);
  p.quadraticCurveTo(x, y + d, x + r, y + d);
  p.lineTo(x + w - r, y + d);
  p.quadraticCurveTo(x + w, y + d, x + w, y + d - r);
  p.lineTo(x + w, y + r);
  p.quadraticCurveTo(x + w, y, x + w - r, y);
  p.lineTo(x + r, y);
  return p;
}

/** Rounded slab lying in XZ, from y = 0 to y = h (bevelled edges). */
export function roundedSlab(w: number, d: number, h: number, r: number, bevel = 0.02): BufferGeometry {
  const b = Math.min(bevel, h / 3);
  const g = new ExtrudeGeometry(roundedRectShape(w - 2 * b, d - 2 * b, Math.max(0.001, r - b)), {
    depth: h - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  g.computeVertexNormals();
  return g;
}

/** Rounded rectangular wall ring (a shell without top or bottom), y = 0..h. */
export function roundedRing(w: number, d: number, r: number, wall: number, h: number): BufferGeometry {
  const s = roundedRectShape(w, d, r);
  s.holes.push(roundedRectPath(w - 2 * wall, d - 2 * wall, Math.max(0.01, r - wall)));
  const g = new ExtrudeGeometry(s, {
    depth: h - 0.02,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 12,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.01, 0);
  return g;
}

/** Flat Archimedean spiral in XZ (for the inductive coil). */
export class SpiralCurve extends Curve<Vector3> {
  constructor(private r0: number, private r1: number, private turns: number, private y = 0) {
    super();
  }
  getPoint(t: number, target = new Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    const r = this.r0 + (this.r1 - this.r0) * t;
    return target.set(Math.cos(a) * r, this.y, Math.sin(a) * r);
  }
}

/** Points on a quadratic arc from a to b lifted by `lift` along +Y. */
export function arcPoints(a: Vector3, b: Vector3, lift: number, n = 24, out: number[] = []): number[] {
  out.length = 0;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + lift, mz = (a.z + b.z) / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(
      u * u * a.x + 2 * u * t * mx + t * t * b.x,
      u * u * a.y + 2 * u * t * my + t * t * b.y,
      u * u * a.z + 2 * u * t * mz + t * t * b.z,
    );
  }
  return out;
}

/**
 * Ribbon along a polyline in 3D: width along `side` (perpendicular to the tangent in the plane
 * spanned with `side`), thickness along the derived normal. Writes into an existing geometry.
 */
export function writeRibbon(
  geo: BufferGeometry,
  pts: Vector3[],
  width: number,
  thick: number,
  side = new Vector3(0, 0, 1),
  lateralOffset = 0,
  normalOffset = 0,
) {
  const n = pts.length;
  const vCount = n * 4;
  let pos = geo.getAttribute('position') as BufferAttribute | undefined;
  if (!pos || pos.count !== vCount) {
    pos = new BufferAttribute(new Float32Array(vCount * 3), 3);
    geo.setAttribute('position', pos);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 4, b = (i + 1) * 4;
      // top (0,1), bottom (2,3), sides
      idx.push(a + 0, b + 0, a + 1, a + 1, b + 0, b + 1);
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      idx.push(a + 0, a + 2, b + 0, a + 2, b + 2, b + 0);
      idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
    }
    // end caps
    const e = (n - 1) * 4;
    idx.push(0, 1, 2, 1, 3, 2, e + 0, e + 2, e + 1, e + 1, e + 2, e + 3);
    geo.setIndex(idx);
  }
  const arr = pos.array as Float32Array;
  const t = new Vector3(), nrm = new Vector3(), w = new Vector3(), p = new Vector3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    nrm.crossVectors(side, t).normalize(); // thickness direction
    w.crossVectors(t, nrm).normalize(); // width direction (≈ side)
    p.copy(pts[i]).addScaledVector(w, lateralOffset).addScaledVector(nrm, normalOffset);
    const hw = width / 2, ht = thick / 2;
    const o = i * 12;
    arr[o + 0] = p.x + w.x * hw + nrm.x * ht; arr[o + 1] = p.y + w.y * hw + nrm.y * ht; arr[o + 2] = p.z + w.z * hw + nrm.z * ht;
    arr[o + 3] = p.x - w.x * hw + nrm.x * ht; arr[o + 4] = p.y - w.y * hw + nrm.y * ht; arr[o + 5] = p.z - w.z * hw + nrm.z * ht;
    arr[o + 6] = p.x + w.x * hw - nrm.x * ht; arr[o + 7] = p.y + w.y * hw - nrm.y * ht; arr[o + 8] = p.z + w.z * hw - nrm.z * ht;
    arr[o + 9] = p.x - w.x * hw - nrm.x * ht; arr[o + 10] = p.y - w.y * hw - nrm.y * ht; arr[o + 11] = p.z - w.z * hw - nrm.z * ht;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

/** Flat Manhattan strips (copper traces) merged into one geometry. Points are [x, z] pairs. */
export function stripGeometry(polylines: [number, number][][], width: number, thick: number, y: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) {
      const [x0, z0] = pl[i];
      const [x1, z1] = pl[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 1e-5) continue;
      const g = new BoxGeometry(len + width, thick, width);
      g.rotateY(-Math.atan2(dz, dx));
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      parts.push(g);
    }
  }
  if (parts.length === 0) return new BufferGeometry();
  const merged = mergeGeometries(parts, false) ?? new BufferGeometry();
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Polyline length helpers for pulses travelling along routes. */
export interface Route {
  pts: Vector3[];
  cum: number[];
  length: number;
}
export function makeRoute(pts: Vector3[]): Route {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, length: cum[cum.length - 1] };
}
export function routePoint(r: Route, u: number, out: Vector3): Vector3 {
  const d = Math.min(Math.max(u, 0), 1) * r.length;
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < d) i++;
  const seg = r.cum[i] - r.cum[i - 1] || 1;
  return out.copy(r.pts[i - 1]).lerp(r.pts[i], (d - r.cum[i - 1]) / seg);
}

/** Round tube along a polyline, written in place (no reallocation when the point count is stable). */
export function writeTube(geo: BufferGeometry, pts: Vector3[], radius: number, radial = 6) {
  const n = pts.length;
  const vCount = n * radial;
  let pos = geo.getAttribute('position') as BufferAttribute | undefined;
  if (!pos || pos.count !== vCount) {
    pos = new BufferAttribute(new Float32Array(vCount * 3), 3);
    geo.setAttribute('position', pos);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
        idx.push(a, c, b, b, c, d);
      }
    geo.setIndex(idx);
  }
  const arr = pos.array as Float32Array;
  const t = new Vector3(), nrm = new Vector3(), bin = new Vector3();
  const up = new Vector3(0, 1, 0), ax = new Vector3(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    nrm.crossVectors(t, Math.abs(t.y) > 0.95 ? ax : up).normalize();
    bin.crossVectors(t, nrm).normalize();
    for (let j = 0; j < radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const c = Math.cos(ang) * radius, s = Math.sin(ang) * radius;
      const o = (i * radial + j) * 3;
      arr[o] = pts[i].x + nrm.x * c + bin.x * s;
      arr[o + 1] = pts[i].y + nrm.y * c + bin.y * s;
      arr[o + 2] = pts[i].z + nrm.z * c + bin.z * s;
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

/** Rectangle outline as Manhattan strips (x0..x1, z0..z1). */
export function rectOutline(x0: number, x1: number, z0: number, z1: number, width: number, thick: number, y: number) {
  return stripGeometry([[[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]], width, thick, y);
}

/** Dashed rectangle outline (strips with gaps), for "not implemented" or grouping regions. */
export function dashedRectOutline(x0: number, x1: number, z0: number, z1: number, dash: number, gap: number, width: number, thick: number, y: number) {
  const segs: [number, number][][] = [];
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      segs.push([[ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len], [ax + ((bx - ax) * e) / len, az + ((bz - az) * e) / len]]);
    }
  };
  edge(x0, z0, x1, z0);
  edge(x1, z0, x1, z1);
  edge(x1, z1, x0, z1);
  edge(x0, z1, x0, z0);
  return stripGeometry(segs, width, thick, y);
}

/** HBCI-02 package laminate width at System level (hero part; the package level scales from it). */
export const CHIP_W = 1.45;
