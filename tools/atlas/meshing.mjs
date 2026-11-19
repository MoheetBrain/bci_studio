// Pure mesh utilities for the specimen surface (no I/O). Tested in tests/meshing.test.ts.
//
//   surfaceNets   isosurface of a scalar field at 0 (positive = inside); naive surface nets after M. Lysenko (MIT),
//                 written out here so the build has no extra dependency
//   largestComponent, taubinSmooth, vertexNormals, adjacency

/**
 * @param {Float32Array} field  values on a regular grid, index = x + nx*(y + ny*z); inside is > 0
 * @param {[number, number, number]} dims
 * @returns {{positions: Float32Array, indices: Uint32Array}} vertices in voxel coordinates, triangles wound outward
 */
export function surfaceNets(field, dims) {
  const [nx, ny, nz] = dims;
  const cubeEdges = new Int32Array(24), edgeTable = new Int32Array(256);
  let k = 0;
  for (let i = 0; i < 8; i++) for (let j = 1; j <= 4; j <<= 1) { const p = i ^ j; if (i <= p) { cubeEdges[k++] = i; cubeEdges[k++] = p; } }
  for (let i = 0; i < 256; i++) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) { const a = !!(i & (1 << cubeEdges[j])), b = !!(i & (1 << cubeEdges[j + 1])); if (a !== b) em |= 1 << (j >> 1); }
    edgeTable[i] = em;
  }
  const R = [1, nx + 1, (nx + 1) * (ny + 1)];
  const buf = new Int32Array(R[2] * 2);
  const grid = new Float32Array(8);
  const pos = [], quads = [];
  const x = [0, 0, 0];
  let n = 0, bufNo = 1;
  for (x[2] = 0; x[2] < nz - 1; ++x[2], n += nx, bufNo ^= 1, R[2] = -R[2]) {
    let m = 1 + (nx + 1) * (1 + bufNo * (ny + 1));
    for (x[1] = 0; x[1] < ny - 1; ++x[1], ++n, m += 2) {
      for (x[0] = 0; x[0] < nx - 1; ++x[0], ++n, ++m) {
        let mask = 0, g = 0, idx = n;
        for (let c = 0; c < 2; ++c, idx += nx * (ny - 2)) for (let b = 0; b < 2; ++b, idx += nx - 2) for (let a = 0; a < 2; ++a, ++g, ++idx) {
          const p = field[idx];
          grid[g] = p;
          if (p < 0) mask |= 1 << g;
        }
        if (mask === 0 || mask === 0xff) continue;
        const em = edgeTable[mask];
        let vx = 0, vy = 0, vz = 0, count = 0;
        for (let i = 0; i < 12; ++i) {
          if (!(em & (1 << i))) continue;
          ++count;
          const e0 = cubeEdges[i << 1], e1 = cubeEdges[(i << 1) + 1];
          const g0 = grid[e0], g1 = grid[e1];
          let t = g0 - g1;
          t = Math.abs(t) > 1e-9 ? g0 / t : 0.5;
          const a0 = e0 & 1, b0 = e1 & 1; vx += a0 !== b0 ? (a0 ? 1 - t : t) : (a0 ? 1 : 0);
          const a1 = e0 & 2, b1 = e1 & 2; vy += a1 !== b1 ? (a1 ? 1 - t : t) : (a1 ? 1 : 0);
          const a2 = e0 & 4, b2 = e1 & 4; vz += a2 !== b2 ? (a2 ? 1 - t : t) : (a2 ? 1 : 0);
        }
        const s = 1 / count;
        buf[m] = pos.length / 3;
        pos.push(x[0] + s * vx, x[1] + s * vy, x[2] + s * vz);
        for (let i = 0; i < 3; ++i) {
          if (!(em & (1 << i))) continue;
          const iu = (i + 1) % 3, iv = (i + 2) % 3;
          if (x[iu] === 0 || x[iv] === 0) continue;
          const du = R[iu], dv = R[iv];
          if (mask & 1) quads.push(buf[m], buf[m - du], buf[m - du - dv], buf[m - dv]);
          else quads.push(buf[m], buf[m - dv], buf[m - du - dv], buf[m - du]);
        }
      }
    }
  }
  const positions = Float32Array.from(pos);
  // quads → triangles along the shorter diagonal
  const tri = new Uint32Array((quads.length / 4) * 6);
  const d2 = (a, b) => (positions[a * 3] - positions[b * 3]) ** 2 + (positions[a * 3 + 1] - positions[b * 3 + 1]) ** 2 + (positions[a * 3 + 2] - positions[b * 3 + 2]) ** 2;
  for (let q = 0, t = 0; q < quads.length; q += 4) {
    const a = quads[q], b = quads[q + 1], c = quads[q + 2], d = quads[q + 3];
    if (d2(a, c) <= d2(b, d)) { tri[t++] = a; tri[t++] = b; tri[t++] = c; tri[t++] = a; tri[t++] = c; tri[t++] = d; }
    else { tri[t++] = a; tri[t++] = b; tri[t++] = d; tri[t++] = b; tri[t++] = c; tri[t++] = d; }
  }
  // make the winding outward (positive signed volume) whatever the sign convention produced
  if (signedVolume(positions, tri) < 0) for (let t = 0; t < tri.length; t += 3) { const tmp = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = tmp; }
  return { positions, indices: tri };
}

export function signedVolume(pos, idx) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

export function surfaceArea(pos, idx) {
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    s += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s;
}

/** Vertex adjacency in CSR form: neighbours of v are list[start[v] … start[v+1]). */
export function adjacency(vertexCount, idx) {
  const sets = Array.from({ length: vertexCount }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v] + sets[v].size;
  const list = new Uint32Array(start[vertexCount]);
  for (let v = 0, o = 0; v < vertexCount; v++) for (const n of sets[v]) list[o++] = n;
  return { start, list };
}

/** Keep only the largest connected component; returns compacted arrays and the old→new vertex map. */
export function largestComponent(pos, idx) {
  const nV = pos.length / 3;
  const parent = new Int32Array(nV).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]);
    if (a !== b) parent[b] = a;
    const a2 = find(a);
    if (a2 !== c) parent[c] = a2;
  }
  const size = new Map();
  for (let t = 0; t < idx.length; t += 3) { const r = find(idx[t]); size.set(r, (size.get(r) ?? 0) + 1); }
  let best = -1, bestN = -1;
  for (const [r, n] of size) if (n > bestN) { best = r; bestN = n; }
  const map = new Int32Array(nV).fill(-1);
  const outPos = [];
  const outIdx = new Uint32Array(bestN * 3);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    if (find(idx[t]) !== best) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k];
      if (map[v] < 0) { map[v] = outPos.length / 3; outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      outIdx[o++] = map[v];
    }
  }
  return { positions: Float32Array.from(outPos), indices: outIdx, components: size.size, removedTriangles: idx.length / 3 - bestN };
}

/**
 * Taubin λ|μ smoothing: removes voxel stair-stepping with far less shrinkage than plain Laplacian smoothing.
 * Returns the smoothed copy and the displacement statistics (so the visual smoothing can be reported honestly).
 */
export function taubinSmooth(pos, adj, iterations = 10, lambda = 0.5, mu = -0.53) {
  const n = pos.length / 3;
  let cur = Float32Array.from(pos), tmp = new Float32Array(pos.length);
  const step = (f) => {
    for (let v = 0; v < n; v++) {
      const s = adj.start[v], e = adj.start[v + 1];
      if (e === s) { tmp[v * 3] = cur[v * 3]; tmp[v * 3 + 1] = cur[v * 3 + 1]; tmp[v * 3 + 2] = cur[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let i = s; i < e; i++) { const u = adj.list[i] * 3; x += cur[u]; y += cur[u + 1]; z += cur[u + 2]; }
      const inv = 1 / (e - s);
      tmp[v * 3] = cur[v * 3] + f * (x * inv - cur[v * 3]);
      tmp[v * 3 + 1] = cur[v * 3 + 1] + f * (y * inv - cur[v * 3 + 1]);
      tmp[v * 3 + 2] = cur[v * 3 + 2] + f * (z * inv - cur[v * 3 + 2]);
    }
    const sw = cur; cur = tmp; tmp = sw;
  };
  for (let i = 0; i < iterations; i++) { step(lambda); step(mu); }
  const d = new Float32Array(n);
  let sum = 0, max = 0;
  for (let v = 0; v < n; v++) {
    const dv = Math.hypot(cur[v * 3] - pos[v * 3], cur[v * 3 + 1] - pos[v * 3 + 1], cur[v * 3 + 2] - pos[v * 3 + 2]);
    d[v] = dv; sum += dv; if (dv > max) max = dv;
  }
  const sorted = Float32Array.from(d).sort();
  return { positions: cur, displacement: { mean: sum / n, p95: sorted[Math.floor(n * 0.95)], max } };
}

/** Area-weighted vertex normals (unit length). */
export function vertexNormals(pos, idx) {
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  for (let v = 0; v < nrm.length; v += 3) {
    const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1;
    nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l;
  }
  return nrm;
}

/** 3-D box blur (separable, radius in voxels), in place helper for soft masks. */
export function boxBlur3(src, dims, radius, passes = 2) {
  const [nx, ny, nz] = dims;
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const run = (stride, len, lines) => {
    for (const base of lines()) {
      let acc = 0;
      const w = 2 * radius + 1;
      for (let i = -radius; i <= radius; i++) acc += a[base + Math.min(len - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < len; i++) {
        b[base + i * stride] = acc / w;
        const add = Math.min(len - 1, i + radius + 1), sub = Math.max(0, i - radius);
        acc += a[base + add * stride] - a[base + sub * stride];
      }
    }
    const t = a; a = b; b = t;
  };
  for (let p = 0; p < passes; p++) {
    run(1, nx, function* () { for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) yield nx * (y + ny * z); });
    run(nx, ny, function* () { for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) yield x + nx * ny * z; });
    run(nx * ny, nz, function* () { for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) yield x + nx * y; });
  }
  return a;
}

/**
 * Shading normals: each normal is blended with the mean of its neighbours' normals, `passes` times. Geometry is not
 * touched — this only removes the facet shimmer that decimation leaves in highlights.
 */
export function smoothNormals(normals, adj, passes = 2, weight = 0.6) {
  const n = normals.length / 3;
  let cur = Float32Array.from(normals), next = new Float32Array(normals.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let v = 0; v < n; v++) {
      let x = 0, y = 0, z = 0;
      const a = adj.start[v], b = adj.start[v + 1];
      for (let k = a; k < b; k++) { const u = adj.list[k] * 3; x += cur[u]; y += cur[u + 1]; z += cur[u + 2]; }
      const d = Math.max(1, b - a);
      x = cur[v * 3] * (1 - weight) + (x / d) * weight; y = cur[v * 3 + 1] * (1 - weight) + (y / d) * weight; z = cur[v * 3 + 2] * (1 - weight) + (z / d) * weight;
      const l = Math.hypot(x, y, z) || 1;
      next[v * 3] = x / l; next[v * 3 + 1] = y / l; next[v * 3 + 2] = z / l;
    }
    [cur, next] = [next, cur];
  }
  return cur;
}
