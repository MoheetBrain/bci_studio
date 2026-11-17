// Radix-2 FFT magnitude spectrum with a Hann window (for the linked spectrum view).

export function spectrum(x: number[], fs: number): { f: number[]; db: number[]; n: number } {
  let n = 1;
  while (n * 2 <= x.length) n *= 2;
  if (n < 16) return { f: [], db: [], n: 0 };
  const off = Math.floor((x.length - n) / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let mean = 0;
  for (let k = 0; k < n; k++) mean += x[off + k];
  mean /= n;
  for (let k = 0; k < n; k++) re[k] = (x[off + k] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)));
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const f: number[] = [];
  const db: number[] = [];
  for (let k = 1; k < n / 2; k++) {
    f.push((k * fs) / n);
    db.push(20 * Math.log10(Math.hypot(re[k], im[k]) / n + 1e-9));
  }
  return { f, db, n };
}
