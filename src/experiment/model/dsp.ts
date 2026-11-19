// Small, explicit signal-processing blocks shared by the experiment models. Pure; unit-tested in tests/experiment-*.test.ts.
export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** 2nd-order Butterworth low-pass (bilinear transform). */
export function butterLP2(fc: number, fs: number): Biquad {
  const k = Math.tan((Math.PI * Math.min(fc, fs * 0.49)) / fs), q = Math.SQRT1_2;
  const n = 1 / (1 + k / q + k * k);
  return { b0: k * k * n, b1: 2 * k * k * n, b2: k * k * n, a1: 2 * (k * k - 1) * n, a2: (1 - k / q + k * k) * n };
}
/** 2nd-order Butterworth high-pass (bilinear transform). */
export function butterHP2(fc: number, fs: number): Biquad {
  const k = Math.tan((Math.PI * Math.min(fc, fs * 0.49)) / fs), q = Math.SQRT1_2;
  const n = 1 / (1 + k / q + k * k);
  return { b0: n, b1: -2 * n, b2: n, a1: 2 * (k * k - 1) * n, a2: (1 - k / q + k * k) * n };
}
/** 2nd-order notch at f0 with quality factor q. */
export function notch(f0: number, q: number, fs: number): Biquad {
  const w = (2 * Math.PI * f0) / fs, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return { b0: 1 / a0, b1: (-2 * Math.cos(w)) / a0, b2: 1 / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - al) / a0 };
}
/** |H(f)| of a biquad at frequency f. */
export function biquadMag(c: Biquad, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
/** Filter a whole array with one biquad (direct form I), starting from rest. */
export function runBiquad(c: Biquad, x: ArrayLike<number>): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** |H(f)| of the analogue front end: 1st-order high-pass (0 = DC-coupled) · 2nd-order Butterworth low-pass. */
export function afeMagnitude(f: number, hpHz: number, lpHz: number): number {
  const hp = hpHz <= 0 ? 1 : (f / hpHz) / Math.sqrt(1 + (f / hpHz) ** 2);
  return hp / Math.sqrt(1 + (f / lpHz) ** 4);
}

/** Frequency at which a tone of f appears after sampling at fs (folded into 0 … fs/2). */
export function aliasFrequency(f: number, fs: number): number {
  const m = ((f % fs) + fs) % fs;
  return m > fs / 2 ? fs - m : m;
}

/** Ideal mid-tread quantiser: ±vref full scale, two's-complement code clamped at the rails. */
export function quantise(v: number, bits: number, vref: number): number {
  const half = 2 ** (bits - 1), lsb = vref / half;
  return Math.max(-half, Math.min(half - 1, Math.round(v / lsb)));
}
export const lsbOf = (bits: number, vref: number) => vref / 2 ** (bits - 1);
/** Two's-complement bit string of a code. */
export function codeBits(code: number, bits: number): string {
  return ((code + 2 ** bits) % 2 ** bits).toString(2).padStart(bits, '0');
}

/** Robust noise estimate: median(|x|) / 0.6745 (the spike-detection estimator of Quiroga et al. 2004). */
export function madSigma(x: ArrayLike<number>, n = x.length): number {
  if (n <= 0) return 0;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.abs(x[i]);
  a.sort();
  const med = n % 2 ? a[(n - 1) / 2] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
  return med / 0.6745;
}

// ── tiny dense linear algebra (row-major number[][]) ──────────────────────────────────────────────────────────────
export type Mat = number[][];
export const zeros = (r: number, c: number): Mat => Array.from({ length: r }, () => new Array<number>(c).fill(0));
export const eye = (n: number): Mat => zeros(n, n).map((row, i) => { row[i] = 1; return row; });
export const transpose = (a: Mat): Mat => a[0].map((_, j) => a.map((row) => row[j]));
export function matmul(a: Mat, b: Mat): Mat {
  const out = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i++) for (let k = 0; k < b.length; k++) { const v = a[i][k]; if (v !== 0) for (let j = 0; j < b[0].length; j++) out[i][j] += v * b[k][j]; }
  return out;
}
export const matadd = (a: Mat, b: Mat, s = 1): Mat => a.map((row, i) => row.map((v, j) => v + s * b[i][j]));
/** Solve A·X = B by Gauss–Jordan elimination with partial pivoting. Throws on a singular matrix. */
export function solve(a: Mat, b: Mat): Mat {
  const n = a.length, m = b[0].length;
  const M = a.map((row, i) => [...row, ...b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('singular matrix');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = c; j < n + m; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f !== 0) for (let j = c; j < n + m; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(n));
}
export const inverse = (a: Mat): Mat => solve(a, eye(a.length));
