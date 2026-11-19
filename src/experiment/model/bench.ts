// The decoder comparison: every decoder is fitted on the same calibration run and scored on runs it never saw,
// under the calibration's own conditions and under changed ones. All of it is SYNTHETIC teaching data from the motor
// model in motor.ts; the result says how these decoders behave on that model, not which is best for a real implant.
//
// Pure module. Unit-tested in tests/experiment-bench.test.ts.
import { DECODERS, runModel, score, type Cost, type Dataset, type Model, type Score } from './decoders.ts';
import { BIN_MS, DEFAULT_MOTOR, N_CH, RUN_S, TASK_SEED, simulateMotor, summariseClosed, toDataset, type ClosedSummary, type MotorParams } from './motor.ts';
import { FIT_SEED, motorCalibration, motorModel } from './session.ts';

export const BENCH_NOISE_UV = [3.5, 7, 14, 21, 28] as const;
export const BENCH_NEAR_UM = [45, 70, 100] as const;
export const BENCH_LOST = [0, 2, 4] as const;
/** Bytes per stored number assumed for the memory estimate (16-bit fixed point, as in the chip's RTL). */
export const BYTES_PER_WORD = 2;

export interface BenchRow {
  id: string; name: string; family: Model['family']; uses: Model['uses']; blurb: string;
  cost: Cost;
  /** params + state, at BYTES_PER_WORD each. An estimate, not a synthesis result. */
  memoryBytes: number;
  /** Clock cycles per decoded bin on a serial engine with one multiplier: one per multiply–accumulate, one per non-linearity, two of overhead. */
  serialCycles: number;
  /** Multiply–accumulates per second of signal: a proxy for dynamic energy, in arbitrary units. */
  macsPerSecond: number;
  /** How far the decoded velocity trails the intended one on held-out data, ms. */
  lagMs: number;
  heldOut: Score;
  noise: Array<{ noiseUv: number; r2: number }>;
  shift: Array<{ nearUm: number; r2: number }>;
  lost: Array<{ channels: number; r2: number }>;
  closed: ClosedSummary;
  fitMs: number;
}
export interface BenchResult {
  rows: BenchRow[];
  reference: MotorParams;
  trainBins: number; heldOutBins: number; binMs: number;
  fitSeed: number;
  computeMs: number;
}

/** The same dataset with some channels dead (their counts and rates forced to zero). */
export function withLostChannels(d: Dataset, lost: number): Dataset {
  if (lost <= 0) return d;
  const counts = d.counts.slice(), rates = d.rates.slice();
  for (let k = 0; k < d.nBins; k++) for (let c = 0; c < lost; c++) { counts[k * d.nCh + c * 2 + 1] = 0; rates[k * d.nCh + c * 2 + 1] = 0; }
  return { ...d, counts, rates };
}

export function runBenchmark(onProgress?: (done: number, total: number, what: string) => void, reference: MotorParams = DEFAULT_MOTOR): BenchResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const total = 1 + (BENCH_NOISE_UV.length - 1) + (BENCH_NEAR_UM.length - 1) + DECODERS.length;
  let done = 0;
  const tick = (what: string) => onProgress?.(++done, total, what);
  const cal = motorCalibration(reference);
  tick('calibration and held-out run');
  const heldAt = (p: MotorParams) => toDataset(simulateMotor(p, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: RUN_S.heldOut }));
  const noiseSets = BENCH_NOISE_UV.map((n) => { if (n === reference.noiseUv) return cal.heldOut; const d = heldAt({ ...reference, noiseUv: n }); tick(`held-out run at ${n} µV noise`); return d; });
  const shiftSets = BENCH_NEAR_UM.map((u) => { if (u === reference.nearUm) return cal.heldOut; const d = heldAt({ ...reference, nearUm: u }); tick(`held-out run with the electrode at ${u} µm`); return d; });
  const rows: BenchRow[] = DECODERS.map((spec) => {
    const tf = typeof performance !== 'undefined' ? performance.now() : 0;
    const { model, heldOut } = motorModel(reference, spec.id);
    const fitMs = (typeof performance !== 'undefined' ? performance.now() : 0) - tf;
    const r2 = (d: Dataset) => score(runModel(model, d), d).r2;
    const closed = summariseClosed(simulateMotor(reference, { mode: 'closed', taskSeed: TASK_SEED.closed, durationS: RUN_S.closed, model }));
    tick(`${spec.name}: closed-loop run`);
    const c = model.cost;
    return {
      id: spec.id, name: model.name, family: model.family, uses: model.uses, blurb: spec.blurb, cost: c,
      memoryBytes: (c.params + c.stateWords) * BYTES_PER_WORD,
      serialCycles: c.macs + c.nonlin + 2,
      macsPerSecond: (c.macs * 1000) / BIN_MS,
      lagMs: heldOut.lagBins * BIN_MS,
      heldOut,
      noise: BENCH_NOISE_UV.map((n, i) => ({ noiseUv: n, r2: r2(noiseSets[i]) })),
      shift: BENCH_NEAR_UM.map((u, i) => ({ nearUm: u, r2: r2(shiftSets[i]) })),
      lost: BENCH_LOST.map((n) => ({ channels: n, r2: r2(withLostChannels(cal.heldOut, n)) })),
      closed, fitMs,
    };
  });
  const count = (d: Dataset) => d.valid.reduce((a, v) => a + v, 0);
  void N_CH;
  return { rows, reference, trainBins: count(cal.train), heldOutBins: count(cal.heldOut), binMs: BIN_MS, fitSeed: FIT_SEED, computeMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
}

/** Which rows are not beaten on both axes by another row (higher `good`, lower `cost`). */
export function paretoFront<T>(rows: T[], good: (r: T) => number, cost: (r: T) => number): Set<T> {
  const out = new Set<T>();
  for (const a of rows) {
    let dominated = false;
    for (const b of rows) if (b !== a && good(b) >= good(a) && cost(b) <= cost(a) && (good(b) > good(a) || cost(b) < cost(a))) { dominated = true; break; }
    if (!dominated) out.add(a);
  }
  return out;
}

export interface Constraints {
  /** Which recording condition the accuracy is read at. */
  noiseUv: number;
  /** Channels assumed lost. */
  lost: number;
  maxCycles: number;
  maxBytes: number;
  maxLagMs: number;
}
/** Accuracy of a row under the chosen recording condition (the worse of the noise and lost-channel readings). */
export function accuracyUnder(r: BenchRow, c: Constraints): number {
  const n = r.noise.find((x) => x.noiseUv === c.noiseUv)?.r2 ?? r.heldOut.r2;
  const l = r.lost.find((x) => x.channels === c.lost)?.r2 ?? r.heldOut.r2;
  return Math.min(n, l);
}
/** The decoder to prefer under the constraints: the most accurate one that fits every budget, or null if none does. */
export function preferred(rows: BenchRow[], c: Constraints): { row: BenchRow | null; feasible: BenchRow[]; why: Map<string, string> } {
  const why = new Map<string, string>();
  const feasible = rows.filter((r) => {
    const fails: string[] = [];
    if (r.serialCycles > c.maxCycles) fails.push(`${r.serialCycles} cycles > ${c.maxCycles}`);
    if (r.memoryBytes > c.maxBytes) fails.push(`${r.memoryBytes} bytes > ${c.maxBytes}`);
    if (r.lagMs > c.maxLagMs) fails.push(`${r.lagMs} ms lag > ${c.maxLagMs}`);
    if (fails.length) why.set(r.id, fails.join('; '));
    return !fails.length;
  });
  let row: BenchRow | null = null;
  for (const r of feasible) if (!row || accuracyUnder(r, c) > accuracyUnder(row, c) + 1e-9 || (Math.abs(accuracyUnder(r, c) - accuracyUnder(row, c)) <= 1e-9 && r.serialCycles < row.serialCycles)) row = r;
  return { row, feasible, why };
}
