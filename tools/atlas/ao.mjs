// Baked ambient occlusion: how much of the sky each surface point can "see". A pure rendering aid (it makes folds
// read as folds); it is computed from geometry only and is not anatomical data.
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export function buildBvh(positions, indices) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  return new MeshBVH(g);
}

// Fixed, well-spread cosine-weighted directions (Hammersley), in the local frame with +z along the normal.
function hemisphere(n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let bits = i, r = 0, f = 0.5;
    while (bits) { if (bits & 1) r += f; bits >>= 1; f *= 0.5; }
    const u = (i + 0.5) / n, phi = 2 * Math.PI * r;
    const st = Math.sqrt(u), ct = Math.sqrt(1 - u);
    out[i * 3] = st * Math.cos(phi); out[i * 3 + 1] = st * Math.sin(phi); out[i * 3 + 2] = ct;
  }
  return out;
}

/**
 * @param {Float32Array} positions receivers
 * @param {Float32Array} normals   unit normals of the receivers
 * @param {MeshBVH} bvh            occluders
 * @returns {Float32Array} per-vertex openness in 0…1 (1 = unoccluded)
 */
export function bakeAO(positions, normals, bvh, { rays = 32, maxDist = 20, bias = 0.2 } = {}) {
  const n = positions.length / 3;
  const dirs = hemisphere(rays);
  const ao = new Float32Array(n);
  const ray = new Ray();
  const N = new Vector3(), T = new Vector3(), B = new Vector3();
  for (let v = 0; v < n; v++) {
    N.set(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
    if (Math.abs(N.x) < 0.9) T.set(1, 0, 0); else T.set(0, 1, 0);
    T.crossVectors(N, T).normalize();
    B.crossVectors(N, T);
    // deterministic per-vertex rotation of the sample set (decorrelates neighbours without randomness)
    const rot = ((v * 2654435761) >>> 0) / 4294967296 * 2 * Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
    ray.origin.set(positions[v * 3] + N.x * bias, positions[v * 3 + 1] + N.y * bias, positions[v * 3 + 2] + N.z * bias);
    let occ = 0;
    for (let i = 0; i < rays; i++) {
      const lx = dirs[i * 3] * cr - dirs[i * 3 + 1] * sr, ly = dirs[i * 3] * sr + dirs[i * 3 + 1] * cr, lz = dirs[i * 3 + 2];
      ray.direction.set(T.x * lx + B.x * ly + N.x * lz, T.y * lx + B.y * ly + N.y * lz, T.z * lx + B.z * ly + N.z * lz);
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, maxDist);
      if (hit) { const k = 1 - hit.distance / maxDist; occ += k * k; }
    }
    ao[v] = 1 - occ / rays;
  }
  return ao;
}

/** Average with neighbours (removes sampling speckle). */
export function smoothScalar(values, adj, passes = 1) {
  let a = Float32Array.from(values), b = new Float32Array(values.length);
  for (let p = 0; p < passes; p++) {
    for (let v = 0; v < a.length; v++) {
      let s = a[v] * 2, w = 2;
      for (let i = adj.start[v]; i < adj.start[v + 1]; i++) { s += a[adj.list[i]]; w++; }
      b[v] = s / w;
    }
    const t = a; a = b; b = t;
  }
  return a;
}
