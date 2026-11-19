// Decoders: maps from binned neural features to an output (here a 2-D velocity). Three families are implemented —
// a linear baseline, a small multilayer perceptron, and lightweight temporal models (Kalman filter, lagged linear
// filter). Each one reports its own cost, so they can be compared on more than accuracy.
//
// To add a decoder (convolutional, recurrent, spiking …): write a DecoderSpec whose fit() returns a Model with a
// stateful step() and an honest cost(), and add it to DECODERS. Nothing else in the app needs to change.
//
// Pure module: no DOM. Deterministic for a given seed. Unit-tested in tests/experiment-decoders.test.ts.
import { inverse, matadd, matmul, solve, transpose, zeros, type Mat } from './dsp.ts';
import { gaussian, mulberry32 } from './rng.ts';

/** One time bin of features, as every decoder receives it. */
export interface Features {
  /** Threshold crossings counted in the bin, per channel. */
  counts: ArrayLike<number>;
  /** Smoothed firing-rate estimate per channel, spikes per second. */
  rates: ArrayLike<number>;
}

export interface Dataset {
  nCh: number; nOut: number; nBins: number; binMs: number;
  counts: Float32Array;    // nBins × nCh
  rates: Float32Array;     // nBins × nCh
  target: Float32Array;    // nBins × nOut
  /** 1 where the bin may be used for fitting / scoring (after the detector has its thresholds). */
  valid: Uint8Array;
}

export interface Cost {
  /** Multiply–accumulate operations per decoded bin. */
  macs: number;
  /** Non-linear function evaluations per decoded bin (tanh …). */
  nonlin: number;
  /** Stored parameters (weights, biases, gains). */
  params: number;
  /** Numbers that must be kept between bins. */
  stateWords: number;
  /** Bins of past input the decoder needs before its output is meaningful. */
  historyBins: number;
}

export interface StepOut {
  /** Decoded output (velocity x, y; 1 = full speed). */
  y: number[];
  /** The decoder's uncertainty about each output, one standard deviation (see `uncertainty` for what it is). */
  sd: number[];
  /** The part of each output that does not come from this bin's terms: a bias, or (Kalman) the carried-over state. */
  base: number[];
  /** The terms that are added to `base` to give each output: contrib[o][j]. Their meaning is `contribOf`. */
  contrib: number[][];
  /** What each term is: one recording channel, or one hidden unit of a network. */
  contribOf: 'channel' | 'hidden';
  /** Hidden-unit activations (MLP). */
  hidden?: number[];
  /** The inputs as the decoder saw them after its own normalisation. */
  inputs: number[];
}

export interface Model {
  id: string;
  name: string;
  family: 'linear' | 'mlp' | 'temporal';
  /** Which feature it consumes. */
  uses: 'rates' | 'counts';
  cost: Cost;
  /** What `sd` means for this model. */
  uncertainty: string;
  /** A fresh state for a new recording. */
  init: () => DecoderState;
  step: (state: DecoderState, f: Features) => StepOut;
  /** Numbers for display (weights, gains …), plain arrays so that they can cross a worker boundary. */
  view: Record<string, unknown>;
}
export type DecoderState = { x: number[]; hist?: number[][] };

export interface DecoderSpec {
  id: string;
  name: string;
  family: Model['family'];
  blurb: string;
  fit: (train: Dataset, seed: number) => Model;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
function rowsOf(d: Dataset, what: 'rates' | 'counts'): { X: number[][]; Y: number[][] } {
  const src = what === 'rates' ? d.rates : d.counts;
  const X: number[][] = [], Y: number[][] = [];
  for (let k = 0; k < d.nBins; k++) {
    if (!d.valid[k]) continue;
    X.push(Array.from(src.subarray(k * d.nCh, (k + 1) * d.nCh)));
    Y.push(Array.from(d.target.subarray(k * d.nOut, (k + 1) * d.nOut)));
  }
  return { X, Y };
}
function standardiser(X: number[][]): { mu: number[]; sd: number[] } {
  const n = X.length, m = X[0].length, mu = new Array<number>(m).fill(0), sd = new Array<number>(m).fill(0);
  for (const r of X) for (let j = 0; j < m; j++) mu[j] += r[j] / n;
  for (const r of X) for (let j = 0; j < m; j++) sd[j] += (r[j] - mu[j]) ** 2 / n;
  return { mu, sd: sd.map((v) => Math.sqrt(v) || 1) };
}
const zscore = (x: ArrayLike<number>, mu: number[], sd: number[]) => mu.map((m, j) => (x[j] - m) / sd[j]);
/** Standard deviation of the residuals per output, on the last fifth of the rows (kept out of the fit). */
function splitRows<T>(a: T[]): { fit: T[]; held: T[] } { const n = Math.floor(a.length * 0.8); return { fit: a.slice(0, n), held: a.slice(n) }; }
function residualSd(pred: number[][], Y: number[][]): number[] {
  const nOut = Y[0].length, out = new Array<number>(nOut).fill(0);
  for (let i = 0; i < Y.length; i++) for (let o = 0; o < nOut; o++) out[o] += (pred[i][o] - Y[i][o]) ** 2 / Math.max(1, Y.length);
  return out.map(Math.sqrt);
}
/** Ridge regression with an unpenalised bias: returns W (nOut × nIn) and b. */
function ridge(X: number[][], Y: number[][], lambda: number): { W: number[][]; b: number[] } {
  const n = X.length, m = X[0].length;
  const Xa = X.map((r) => [...r, 1]);
  const XtX = matmul(transpose(Xa), Xa);
  for (let j = 0; j < m; j++) XtX[j][j] += lambda * n;
  const B = solve(XtX, matmul(transpose(Xa), Y));           // (m+1) × nOut
  const W = transpose(B.slice(0, m)), b = B[m];
  return { W, b };
}

// ── 1 · linear baseline ─────────────────────────────────────────────────────────────────────────────────────────
function fitLinear(train: Dataset): Model {
  const { X, Y } = rowsOf(train, 'rates');
  const { mu, sd } = standardiser(X);
  const Z = X.map((r) => zscore(r, mu, sd));
  const zs = splitRows(Z), ys = splitRows(Y);
  const probe = ridge(zs.fit, ys.fit, 1e-3);
  const res = residualSd(zs.held.map((z) => probe.W.map((w, o) => w.reduce((a, v, j) => a + v * z[j], probe.b[o]))), ys.held);
  const { W, b } = ridge(Z, Y, 1e-3);
  const nIn = mu.length, nOut = b.length;
  return {
    id: 'linear', name: 'Linear', family: 'linear', uses: 'rates',
    cost: { macs: nIn * nOut, nonlin: 0, params: nIn * nOut + nOut + 2 * nIn, stateWords: 0, historyBins: 0 },
    uncertainty: 'Spread of this decoder’s errors on calibration bins it was not fitted to (one standard deviation). The same for every bin.',
    init: () => ({ x: [] }),
    step: (_s, f) => {
      const z = zscore(f.rates, mu, sd);
      const contrib = W.map((w) => w.map((v, j) => v * z[j]));
      return { y: contrib.map((c, o) => c.reduce((a, v) => a + v, b[o])), sd: res, base: b.slice(), contrib, contribOf: 'channel', inputs: z };
    },
    view: { W, b, mu, sd, res },
  };
}

// ── 2 · small multilayer perceptron ─────────────────────────────────────────────────────────────────────────────
function fitMlp(train: Dataset, seed: number, hidden: number): Model {
  const { X, Y } = rowsOf(train, 'rates');
  const { mu, sd } = standardiser(X);
  const Z = X.map((r) => zscore(r, mu, sd));
  const zs = splitRows(Z), ys = splitRows(Y);
  const nIn = mu.length, nOut = Y[0].length, H = hidden;
  const g = gaussian(mulberry32(seed));
  // parameters in one flat vector: W1 (H×nIn), b1 (H), W2 (nOut×H), b2 (nOut)
  const nP = H * nIn + H + nOut * H + nOut;
  const th = new Float64Array(nP);
  for (let i = 0; i < H * nIn; i++) th[i] = g() * Math.sqrt(1 / nIn);
  for (let i = 0; i < nOut * H; i++) th[H * nIn + H + i] = g() * Math.sqrt(1 / H);
  const oW1 = 0, ob1 = H * nIn, oW2 = ob1 + H, ob2 = oW2 + nOut * H;
  const forward = (p: Float64Array, z: number[], h: number[]) => {
    for (let i = 0; i < H; i++) { let a = p[ob1 + i]; for (let j = 0; j < nIn; j++) a += p[oW1 + i * nIn + j] * z[j]; h[i] = Math.tanh(a); }
    const y = new Array<number>(nOut);
    for (let o = 0; o < nOut; o++) { let a = p[ob2 + o]; for (let i = 0; i < H; i++) a += p[oW2 + o * H + i] * h[i]; y[o] = a; }
    return y;
  };
  const loss = (p: Float64Array, A: number[][], B: number[][]) => { const h = new Array<number>(H); let e = 0; for (let n = 0; n < A.length; n++) { const y = forward(p, A[n], h); for (let o = 0; o < nOut; o++) e += (y[o] - B[n][o]) ** 2; } return e / Math.max(1, A.length * nOut); };
  // full-batch Adam, fixed number of epochs, keep the parameters that did best on the held-out fifth
  const m = new Float64Array(nP), v = new Float64Array(nP), grad = new Float64Array(nP), h = new Array<number>(H);
  let best = th.slice(), bestLoss = loss(th, zs.held, ys.held);
  const lr = 0.02, b1 = 0.9, b2 = 0.999, wd = 1e-4, N = zs.fit.length;
  for (let ep = 1; ep <= 400; ep++) {
    grad.fill(0);
    for (let n = 0; n < N; n++) {
      const z = zs.fit[n], y = forward(th, z, h);
      const dh = new Array<number>(H).fill(0);
      for (let o = 0; o < nOut; o++) {
        const d = (2 * (y[o] - ys.fit[n][o])) / (N * nOut);
        grad[ob2 + o] += d;
        for (let i = 0; i < H; i++) { grad[oW2 + o * H + i] += d * h[i]; dh[i] += d * th[oW2 + o * H + i]; }
      }
      for (let i = 0; i < H; i++) {
        const da = dh[i] * (1 - h[i] * h[i]);
        grad[ob1 + i] += da;
        for (let j = 0; j < nIn; j++) grad[oW1 + i * nIn + j] += da * z[j];
      }
    }
    for (let i = 0; i < nP; i++) {
      const gi = grad[i] + wd * th[i];
      m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      th[i] -= (lr * (m[i] / (1 - b1 ** ep))) / (Math.sqrt(v[i] / (1 - b2 ** ep)) + 1e-8);
    }
    if (ep % 10 === 0) { const l = loss(th, zs.held, ys.held); if (l < bestLoss) { bestLoss = l; best = th.slice(); } }
  }
  const P = best;
  const hh = new Array<number>(H);
  const res = residualSd(zs.held.map((z) => forward(P, z, hh)), ys.held);
  return {
    id: `mlp${H}`, name: `MLP · ${H} hidden`, family: 'mlp', uses: 'rates',
    cost: { macs: nIn * H + H * nOut, nonlin: H, params: nP + 2 * nIn, stateWords: 0, historyBins: 0 },
    uncertainty: 'Spread of this decoder’s errors on calibration bins it was not fitted to (one standard deviation). The network itself gives no uncertainty.',
    init: () => ({ x: [] }),
    step: (_s, f) => {
      const z = zscore(f.rates, mu, sd), hid = new Array<number>(H);
      const y = forward(P, z, hid);
      const contrib = Array.from({ length: nOut }, (_, o) => hid.map((hv, i) => P[oW2 + o * H + i] * hv));
      return { y, sd: res, base: Array.from(P.subarray(ob2, ob2 + nOut)), contrib, contribOf: 'hidden', hidden: hid, inputs: z };
    },
    view: { hidden: H, W1: Array.from({ length: H }, (_, i) => Array.from(P.subarray(oW1 + i * nIn, oW1 + (i + 1) * nIn))), b1: Array.from(P.subarray(ob1, ob1 + H)), W2: Array.from({ length: nOut }, (_, o) => Array.from(P.subarray(oW2 + o * H, oW2 + (o + 1) * H))), b2: Array.from(P.subarray(ob2, ob2 + nOut)), mu, sd, res },
  };
}

// ── 3a · Kalman filter (velocity state; steady-state gain) ──────────────────────────────────────────────────────
function fitKalman(train: Dataset): Model {
  const nCh = train.nCh, nOut = train.nOut;
  // consecutive valid bins
  const Xs: number[][] = [], Ys: number[][] = [], X0: number[][] = [], X1: number[][] = [];
  const mu = new Array<number>(nCh).fill(0);
  let n = 0;
  for (let k = 0; k < train.nBins; k++) if (train.valid[k]) { n++; for (let c = 0; c < nCh; c++) mu[c] += train.counts[k * nCh + c]; }
  for (let c = 0; c < nCh; c++) mu[c] /= Math.max(1, n);
  for (let k = 0; k < train.nBins; k++) {
    if (!train.valid[k]) continue;
    const x = Array.from(train.target.subarray(k * nOut, (k + 1) * nOut));
    Xs.push(x); Ys.push(Array.from({ length: nCh }, (_, c) => train.counts[k * nCh + c] - mu[c]));
    if (k > 0 && train.valid[k - 1]) { X0.push(Array.from(train.target.subarray((k - 1) * nOut, k * nOut))); X1.push(x); }
  }
  const lsq = (A: number[][], B: number[][], lam: number) => {             // B ≈ A · Mᵀ  → M (cols(B) × cols(A))
    const AtA = matmul(transpose(A), A);
    for (let i = 0; i < AtA.length; i++) AtA[i][i] += lam;
    return transpose(solve(AtA, matmul(transpose(A), B)));
  };
  const cov = (R: number[][]) => { const m = R[0].length, C = zeros(m, m); for (const r of R) for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) C[i][j] += (r[i] * r[j]) / R.length; return C; };
  const A = lsq(X0, X1, 1e-6);                                              // nOut × nOut
  const Wc = cov(X1.map((x, i) => x.map((v, o) => v - A[o].reduce((a, w, j) => a + w * X0[i][j], 0))));
  const C = lsq(Xs, Ys, 1e-6);                                              // nCh × nOut
  const Q = cov(Ys.map((y, i) => y.map((v, c) => v - C[c].reduce((a, w, j) => a + w * Xs[i][j], 0))));
  for (let c = 0; c < nCh; c++) Q[c][c] += 1e-6;
  // iterate the Riccati recursion to the steady-state gain
  let P: Mat = cov(Xs), K: Mat = zeros(nOut, nCh);
  const Ct = transpose(C), At = transpose(A);
  for (let it = 0; it < 200; it++) {
    const Pm = matadd(matmul(matmul(A, P), At), Wc);
    const S = matadd(matmul(matmul(C, Pm), Ct), Q);
    K = matmul(matmul(Pm, Ct), inverse(S));
    const I_KC = matadd(Array.from({ length: nOut }, (_, i) => Array.from({ length: nOut }, (_, j) => (i === j ? 1 : 0))), matmul(K, C), -1);
    P = matmul(I_KC, Pm);
  }
  const KC = matmul(K, C);
  const M = matmul(matadd(Array.from({ length: nOut }, (_, i) => Array.from({ length: nOut }, (_, j) => (i === j ? 1 : 0))), KC, -1), A);
  const sd = P.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  return {
    id: 'kalman', name: 'Kalman filter', family: 'temporal', uses: 'counts',
    cost: { macs: nOut * nOut + nOut * nCh, nonlin: 0, params: nOut * nOut + nOut * nCh + nCh, stateWords: nOut, historyBins: 0 },
    uncertainty: 'The filter’s own posterior standard deviation at steady state: how sure its linear-Gaussian model says it is. It is right only as far as that model is.',
    init: () => ({ x: new Array<number>(nOut).fill(0) }),
    step: (s, f) => {
      const y = Array.from({ length: nCh }, (_, c) => f.counts[c] - mu[c]);
      const carry = M.map((row) => row.reduce((a, w, j) => a + w * s.x[j], 0));
      const contrib = K.map((row) => row.map((w, c) => w * y[c]));
      const x = carry.map((v, o) => v + contrib[o].reduce((a, w) => a + w, 0));
      s.x = x;
      return { y: x.slice(), sd, base: carry, contrib, contribOf: 'channel', inputs: y };
    },
    view: { A, C, K, M, mu, sd, W: Wc, Qdiag: Q.map((r, i) => r[i]) },
  };
}

// ── 3b · lagged linear ("Wiener") filter ────────────────────────────────────────────────────────────────────────
function fitWiener(train: Dataset, lags: number): Model {
  const nCh = train.nCh, nOut = train.nOut;
  const X: number[][] = [], Y: number[][] = [];
  for (let k = lags - 1; k < train.nBins; k++) {
    let ok = true;
    for (let l = 0; l < lags; l++) if (!train.valid[k - l]) { ok = false; break; }
    if (!ok) continue;
    const row: number[] = [];
    for (let l = 0; l < lags; l++) for (let c = 0; c < nCh; c++) row.push(train.counts[(k - l) * nCh + c]);
    X.push(row); Y.push(Array.from(train.target.subarray(k * nOut, (k + 1) * nOut)));
  }
  const { mu, sd } = standardiser(X);
  const Z = X.map((r) => zscore(r, mu, sd));
  const zs = splitRows(Z), ys = splitRows(Y);
  const probe = ridge(zs.fit, ys.fit, 1e-2);
  const res = residualSd(zs.held.map((z) => probe.W.map((w, o) => w.reduce((a, v, j) => a + v * z[j], probe.b[o]))), ys.held);
  const { W, b } = ridge(Z, Y, 1e-2);
  const nIn = nCh * lags;
  return {
    id: `wiener${lags}`, name: `Lagged linear · ${lags} bins`, family: 'temporal', uses: 'counts',
    cost: { macs: nIn * nOut, nonlin: 0, params: nIn * nOut + nOut + 2 * nIn, stateWords: nCh * (lags - 1), historyBins: lags - 1 },
    uncertainty: 'Spread of this decoder’s errors on calibration bins it was not fitted to (one standard deviation). The same for every bin.',
    init: () => ({ x: [], hist: [] }),
    step: (s, f) => {
      const now = Array.from({ length: nCh }, (_, c) => f.counts[c]);
      const hist = s.hist!;
      hist.unshift(now);
      if (hist.length > lags) hist.pop();
      const row: number[] = [];
      for (let l = 0; l < lags; l++) for (let c = 0; c < nCh; c++) row.push(hist[l]?.[c] ?? mu[l * nCh + c]);
      const z = zscore(row, mu, sd);
      // one term per channel: its weights over all lags
      const contrib = W.map((w) => Array.from({ length: nCh }, (_, c) => { let a = 0; for (let l = 0; l < lags; l++) a += w[l * nCh + c] * z[l * nCh + c]; return a; }));
      return { y: contrib.map((c, o) => c.reduce((a, v) => a + v, b[o])), sd: res, base: b.slice(), contrib, contribOf: 'channel', inputs: z.slice(0, nCh) };
    },
    view: { lags, mu, sd, res },
  };
}

export const DECODERS: DecoderSpec[] = [
  { id: 'linear', name: 'Linear', family: 'linear', blurb: 'One weighted sum per output, on smoothed firing rates. The baseline every other decoder has to beat.', fit: (d) => fitLinear(d) },
  { id: 'mlp8', name: 'MLP · 8 hidden', family: 'mlp', blurb: 'A small multilayer perceptron: one hidden layer of 8 tanh units, on the same smoothed rates.', fit: (d, s) => fitMlp(d, s, 8) },
  { id: 'kalman', name: 'Kalman filter', family: 'temporal', blurb: 'A lightweight temporal model: it assumes velocity changes smoothly and weighs each new bin of spike counts against its own prediction.', fit: (d) => fitKalman(d) },
  { id: 'wiener5', name: 'Lagged linear · 5 bins', family: 'temporal', blurb: 'A linear filter over the last five bins of spike counts.', fit: (d) => fitWiener(d, 5) },
  { id: 'mlp32', name: 'MLP · 32 hidden', family: 'mlp', blurb: 'The same network with 32 hidden units: four times the arithmetic.', fit: (d, s) => fitMlp(d, s, 32) },
];
export const decoderSpec = (id: string): DecoderSpec => DECODERS.find((d) => d.id === id) ?? DECODERS[0];
/** The three decoders offered in the live experiment. */
export const LIVE_DECODERS = ['linear', 'mlp8', 'kalman'] as const;

// ── scoring ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Score {
  /** Coefficient of determination over all outputs, on valid bins. Can be negative. */
  r2: number;
  /** Pearson correlation between decoded and intended, averaged over outputs. */
  corr: number;
  /** Bins by which the decoded signal lags the intended one (the shift that maximises their correlation). */
  lagBins: number;
  n: number;
}

/** Run a model over a dataset (open loop) and return its outputs per bin (nBins × nOut). */
export function runModel(model: Model, d: Dataset): Float32Array {
  const out = new Float32Array(d.nBins * d.nOut), s = model.init();
  for (let k = 0; k < d.nBins; k++) {
    const y = model.step(s, { counts: d.counts.subarray(k * d.nCh, (k + 1) * d.nCh), rates: d.rates.subarray(k * d.nCh, (k + 1) * d.nCh) }).y;
    for (let o = 0; o < d.nOut; o++) out[k * d.nOut + o] = y[o];
  }
  return out;
}

export function score(pred: Float32Array, d: Dataset): Score {
  const nOut = d.nOut;
  let n = 0;
  const mean = new Array<number>(nOut).fill(0);
  for (let k = 0; k < d.nBins; k++) if (d.valid[k]) { n++; for (let o = 0; o < nOut; o++) mean[o] += d.target[k * nOut + o]; }
  if (!n) return { r2: 0, corr: 0, lagBins: 0, n: 0 };
  for (let o = 0; o < nOut; o++) mean[o] /= n;
  let sse = 0, sst = 0;
  for (let k = 0; k < d.nBins; k++) if (d.valid[k]) for (let o = 0; o < nOut; o++) { sse += (pred[k * nOut + o] - d.target[k * nOut + o]) ** 2; sst += (d.target[k * nOut + o] - mean[o]) ** 2; }
  const corrAt = (lag: number) => {
    let acc = 0;
    for (let o = 0; o < nOut; o++) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, m = 0;
      for (let k = Math.max(0, lag); k < d.nBins; k++) {
        if (!d.valid[k] || !d.valid[k - lag]) continue;
        const a = pred[k * nOut + o], b = d.target[(k - lag) * nOut + o];
        sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; m++;
      }
      const den = Math.sqrt((saa - (sa * sa) / m) * (sbb - (sb * sb) / m));
      acc += den > 0 ? (sab - (sa * sb) / m) / den : 0;
    }
    return acc / nOut;
  };
  let lagBins = 0, best = -Infinity;
  for (let lag = 0; lag <= 12; lag++) { const c = corrAt(lag); if (c > best + 1e-9) { best = c; lagBins = lag; } }
  return { r2: sst > 0 ? 1 - sse / sst : 0, corr: corrAt(0), lagBins, n };
}
