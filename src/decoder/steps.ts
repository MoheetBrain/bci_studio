// The decoder scene's timeline: which frame, and which clock cycle of the decoder engine inside that frame.
//
// One frame takes `cycles` engine clock cycles in the RTL (the trace's latency.engine_start_to_fifo; 18 for the
// shipped linear model: NO·8 multiply-accumulates + 2). The scene adds one step before (the frame's eight features
// are latched) and one after (the prediction sits in the FIFO), so a frame is cycles + 2 timeline steps.
//
// The running sums are recomputed here from the RTL's own inputs (x, weights, biases); only their final values are
// in the trace, and the scene shows whether they agree. The ORDER of the multiply-accumulates is drawn output by
// output, input by input — the count per frame is the RTL's, the order within it is this scene's presentation.
// Pure module, unit-tested in tests/decoder-steps.test.ts.

export interface LinearModel { NO: number; W2: number[][]; b2: number[] }

export type Phase = 'latch' | 'mac' | 'decide' | 'emit';

export interface StepState {
  frame: number;
  /** 0 … stepsPerFrame − 1 within the frame. */
  step: number;
  /** Engine clock cycle within the frame (1 … cycles), or 0 before the engine starts / after it has finished. */
  cycle: number;
  phase: Phase;
  /** Number of multiply-accumulates finished. */
  macsDone: number;
  /** The multiply-accumulate in progress: output o, input k. */
  current: { o: number; k: number } | null;
  /** Running sum per output after `macsDone` products (bias included from the start). */
  acc: number[];
  /** True once every product has been added, i.e. the sums are the logits. */
  complete: boolean;
}

export const stepsPerFrame = (cycles: number) => cycles + 2;
export const totalSteps = (frames: number, cycles: number) => frames * stepsPerFrame(cycles);

/** Scene state at timeline position t (in steps). */
export function stateAt(t: number, frames: number, cycles: number, m: LinearModel, x: readonly number[]): StepState {
  const S = stepsPerFrame(cycles), inputs = x.length, macs = m.NO * inputs;
  const tt = Math.max(0, Math.min(totalSteps(frames, cycles) - 1e-9, Number.isFinite(t) ? t : 0));
  const frame = Math.min(frames - 1, Math.floor(tt / S));
  const step = Math.min(S - 1, Math.floor(tt - frame * S));
  let phase: Phase, macsDone: number, current: StepState['current'] = null, cycle = 0;
  if (step === 0) { phase = 'latch'; macsDone = 0; }
  else if (step <= macs) { phase = 'mac'; macsDone = step - 1; current = { o: Math.floor((step - 1) / inputs), k: (step - 1) % inputs }; cycle = step; }
  else if (step <= cycles) { phase = 'decide'; macsDone = macs; cycle = step; }
  else { phase = 'emit'; macsDone = macs; }
  const acc: number[] = [];
  for (let o = 0; o < m.NO; o++) {
    let s = m.b2[o] ?? 0;
    const upTo = Math.max(0, Math.min(inputs, macsDone - o * inputs));
    for (let k = 0; k < upTo; k++) s += (m.W2[o]?.[k] ?? 0) * (x[k] ?? 0);
    acc.push(s);
  }
  return { frame, step, cycle, phase, macsDone, current, acc, complete: macsDone >= macs };
}

/** W[o][k] · x[k] for every output and input. */
export function contributions(m: LinearModel, x: readonly number[]): number[][] {
  return Array.from({ length: m.NO }, (_, o) => x.map((v, k) => (m.W2[o]?.[k] ?? 0) * v));
}

/** Logits, winning class and margin of the linear decoder (same arithmetic as the RTL's linear path). */
export function decide(m: LinearModel, x: readonly number[]): { logits: number[]; cls: number; margin: number } {
  const logits = contributions(m, x).map((row, o) => row.reduce((a, b) => a + b, m.b2[o] ?? 0));
  let cls = 0;
  for (let o = 1; o < logits.length; o++) if (logits[o] > logits[cls]) cls = o;
  const others = logits.filter((_, o) => o !== cls);
  return { logits, cls, margin: logits[cls] - (others.length ? Math.max(...others) : 0) };
}

/** The same frame with one input replaced (a software what-if; int8 range enforced). */
export function withInput(x: readonly number[], ch: number, value: number): number[] {
  const out = x.slice();
  if (ch >= 0 && ch < out.length) out[ch] = Math.max(-128, Math.min(127, Math.round(Number.isFinite(value) ? value : 0)));
  return out;
}
