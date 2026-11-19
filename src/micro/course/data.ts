// Pure computations behind the "Explore my chip" course. Every function says where its numbers come from:
//   RTL     values read straight from rtl_trace_v03.json / verification.json (Icarus Verilog runs)
//   DERIVED values reconstructed from the RTL trace by a stated rule (e.g. x1 = x of the previous sample
//           of the same channel), never invented
//   DEMO    the independent browser models (lab/model.ts, lab/featureModel.ts) run in the page
// No React here, so the numbers can be checked from node (see the course's final report).
import type { RtlTrace, RtlTraceV03, V03Record, V03Sample, Verification } from '../../artifacts/types';
import { freshState, stepCore, type CoreConfig, type StepResult } from '../../lab/model';
import { stepFeature, type FeatureConfig } from '../../lab/featureModel';

export const NCH = 8;

/** Chip settings used for the RTL runs (rtl_trace_v03.json config), as DEMO configs. */
export function rtlCoreConfig(t: RtlTraceV03): CoreConfig {
  return { threshold: t.config.threshold, hysteresis: t.config.hysteresis, refractory: t.config.refractory, alphaShift: t.config.alpha_shift };
}
export function rtlFeatureConfig(t: RtlTraceV03): FeatureConfig {
  const c = t.config;
  return { b0: c.b0, b1: c.b1, b2: c.b2, a1: c.a1, a2: c.a2, winLog2: c.win_log2, energyShift: c.energy_shift };
}

/** Samples of one channel, in arrival order (RTL). */
export function channelSamples(t: RtlTraceV03, ch: number): V03Sample[] {
  return t.samples.filter((s) => s.ch === ch);
}

// ───────────────────────────────────────── per-channel feature memory (lessons 2–4) ──

export interface FMem {
  /** The sample being processed (RTL). */
  s: V03Sample;
  /** Previous two inputs / outputs of the same channel: DERIVED (x / y logged at the channel's earlier samples). */
  x1: number; x2: number; y1: number; y2: number;
  /** Global indices those history values came from (null = reset value 0, no earlier sample). */
  from1: number | null; from2: number | null;
  /** rd_acc / rd_cnt as logged (RTL, values before this sample's update). */
  acc: number; cnt: number;
  /** y recomputed by the DEMO biquad arithmetic from the five numbers above; equals s.y when the derivation is right. */
  yCheck: number;
  /** The exact weighted sum p and the rounded, saturated result, for the formula display. */
  p: number;
}

/** What u_fstate holds for channel `ch` when its k-th sample (k = 0, 1, …) is read. */
export function featureMemory(t: RtlTraceV03, ch: number, k: number): FMem | null {
  const row = channelSamples(t, ch);
  const s = row[k];
  if (!s) return null;
  const p1 = k >= 1 ? row[k - 1] : null;
  const p2 = k >= 2 ? row[k - 2] : null;
  const x1 = p1?.x ?? 0, x2 = p2?.x ?? 0, y1 = p1?.y ?? 0, y2 = p2?.y ?? 0;
  const c = t.config;
  const p = c.b0 * s.x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
  const yFull = Math.floor((p + 8192) / 16384);
  const yCheck = Math.max(-32768, Math.min(32767, yFull));
  return { s, x1, x2, y1, y2, from1: p1?.i ?? null, from2: p2?.i ?? null, acc: s.acc, cnt: s.cnt, yCheck, p };
}

/**
 * Checks the history derivation over the whole trace: at how many samples does the biquad arithmetic, fed with the
 * DERIVED x1/x2/y1/y2 and the logged x, give exactly the logged RTL y? (One pass, per-channel history.)
 */
export function derivationCheck(t: RtlTraceV03): { agree: number; total: number } {
  const c = t.config;
  const h = Array.from({ length: NCH }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
  let agree = 0;
  for (const s of t.samples) {
    const m = h[s.ch];
    if (!m) continue;
    const p = c.b0 * s.x + c.b1 * m.x1 + c.b2 * m.x2 - c.a1 * m.y1 - c.a2 * m.y2;
    const y = Math.max(-32768, Math.min(32767, Math.floor((p + 8192) / 16384)));
    if (y === s.y) agree++;
    m.x2 = m.x1; m.x1 = s.x; m.y2 = m.y1; m.y1 = s.y;
  }
  return { agree, total: t.samples.length };
}

/** Index of channel ch's sample at or before global sample i (k such that row[k].i <= i). */
export function kAtOrBefore(t: RtlTraceV03, ch: number, i: number): number {
  const row = channelSamples(t, ch);
  let k = 0;
  for (let j = 0; j < row.length; j++) if (row[j].i <= i) k = j;
  return k;
}

export interface MuxEntry {
  ch: number;
  acc: number | null;
  cnt: number | null;
  /** 'rtl' = the entry the mux actually selects at sample i (logged); 'derived' = logged when that channel was next read. */
  kind: 'rtl' | 'derived' | 'unknown';
  /** Global index where the value was logged. */
  at: number | null;
}

/**
 * The eight u_fstate entries (acc, cnt) at the moment sample i is read. The selected channel's values are the
 * logged rd_acc / rd_cnt (RTL). Every other entry is only written when its own channel arrives, so its content at
 * time i equals what was logged at that channel's next sample after i (DERIVED); 'unknown' after the last sample.
 */
export function muxEntries(t: RtlTraceV03, i: number): MuxEntry[] {
  const sel = t.samples[i];
  const out: MuxEntry[] = [];
  for (let ch = 0; ch < NCH; ch++) {
    if (sel && ch === sel.ch) { out.push({ ch, acc: sel.acc, cnt: sel.cnt, kind: 'rtl', at: sel.i }); continue; }
    const nxt = t.samples.find((s) => s.i > i && s.ch === ch);
    out.push(nxt ? { ch, acc: nxt.acc, cnt: nxt.cnt, kind: 'derived', at: nxt.i } : { ch, acc: null, cnt: null, kind: 'unknown', at: null });
  }
  return out;
}

/** Two's-complement bits of a signed value, MSB first. */
export function bits(v: number, w: number): number[] {
  const u = v < 0 ? v + 2 ** w : v;
  return Array.from({ length: w }, (_, k) => Math.floor(u / 2 ** (w - 1 - k)) % 2);
}

// ───────────────────────────────────────── event detector on ch5 (lesson 5) ──

export interface EvRun {
  steps: StepResult[];         // one per ch5 sample (DEMO), i = global index
  events: StepResult[];        // steps with fire = 1
}

/** Run the DEMO event core on the real input samples x of one channel (channel states are independent). */
export function runEventsOnChannel(t: RtlTraceV03, ch: number, cfg: CoreConfig): EvRun {
  const st = freshState()[ch];
  const steps = channelSamples(t, ch).map((s) => stepCore(st, s.i, ch, s.x, cfg));
  return { steps, events: steps.filter((r) => r.fire === 1) };
}

/** RTL EVENT-run records of one channel. */
export function rtlEventRecords(t: RtlTraceV03, ch: number): V03Record[] {
  return t.runs.EVENT.records.filter((r) => r.type === 1 && r.ch === ch);
}

/**
 * The v0.2 RTL trace (rtl_trace.json) logs the event core's internals per sample. Re-run the DEMO model on its input
 * and count samples where residual, armed, refractory count and fire all agree with the RTL.
 */
export function v02Check(t: RtlTrace): { agree: number; total: number; demoEvents: number; rtlEvents: number } {
  const cfg: CoreConfig = { threshold: t.config.threshold, hysteresis: t.config.hysteresis, refractory: t.config.refractory, alphaShift: t.config.alpha_shift };
  const st = freshState();
  let agree = 0, demoEvents = 0;
  for (const s of t.samples) {
    const r = stepCore(st[s.ch], s.i, s.ch, s.x, cfg);
    if (r.res === s.res && r.armed === s.armed && r.refr === s.refr && r.fire === s.fire && r.base === s.base) agree++;
    demoEvents += r.fire;
  }
  return { agree, total: t.samples.length, demoEvents, rtlEvents: t.events.length };
}

export function sameConfig(a: CoreConfig, b: CoreConfig): boolean {
  return a.threshold === b.threshold && a.hysteresis === b.hysteresis && a.refractory === b.refractory && a.alphaShift === b.alphaShift;
}

/** DEMO vs RTL comparison of event timestamps and magnitudes/polarities on one channel. */
export function compareEvents(demo: StepResult[], rtl: V03Record[]) {
  const sameCount = demo.length === rtl.length;
  const allMatch = sameCount && demo.every((d, k) => d.i === rtl[k].ts && ((d.pol << 16) | d.mag) === rtl[k].data);
  return { demo: demo.length, rtl: rtl.length, allMatch };
}

// ───────────────────────────────────────── biquad + energy DEMO (lesson 6) ──

export interface BqStep { n: number; x: number; x1: number; x2: number; y1: number; y2: number; p: number; y: number; ysat: 0 | 1; y2sq: number; done: 0 | 1; energy: number }

/** A DEMO sine of f Hz and amplitude amp at fs, rounded to integers (what an ADC would deliver). */
export function sineInput(fHz: number, amp: number, n: number, fs: number): number[] {
  return Array.from({ length: n }, (_, k) => Math.max(-32768, Math.min(32767, Math.round(amp * Math.sin((2 * Math.PI * fHz * k) / fs)))));
}

/** Run the DEMO feature path (bit-accurate port, verified 4000/4000 against the RTL) over one channel's input. */
export function runFeatureDemo(x: number[], cfg: FeatureConfig): BqStep[] {
  const st = { x1: 0, x2: 0, y1: 0, y2: 0, acc: 0n, cnt: 0, sat: false };
  return x.map((xv, n) => {
    const { x1, x2, y1, y2 } = st;
    const p = cfg.b0 * xv + cfg.b1 * x1 + cfg.b2 * x2 - cfg.a1 * y1 - cfg.a2 * y2;
    const r = stepFeature(st, xv, cfg);
    return { n, x: xv, x1, x2, y1, y2, p, y: r.y, ysat: r.ysat, y2sq: r.y * r.y, done: r.done, energy: r.energy };
  });
}

/** Mean FEATURE energy per channel in an RTL run (FEATURE mode), with the number of windows. */
export function rtlFeatureEnergy(t: RtlTraceV03): { ch: number; mean: number; n: number }[] {
  const out: { ch: number; mean: number; n: number }[] = [];
  for (let ch = 0; ch < NCH; ch++) {
    const r = t.runs.FEATURE.records.filter((q) => q.type === 2 && q.ch === ch);
    out.push({ ch, n: r.length, mean: r.length ? Math.round(r.reduce((a, q) => a + q.data, 0) / r.length) : 0 });
  }
  return out;
}

// ───────────────────────────────────────── records (lesson 7) ──

export const TYPE_NAME = ['RAW', 'EVENT', 'FEATURE'] as const;

/** The overload test numbers, read from verification.json (suite v03_overload_gaps, test ovl_s51.*). */
export interface OverloadFacts {
  name: string;
  status: string;
  /** Per type: generated = emitted + dropped (parsed from the accounting test's detail). */
  acct: { type: string; generated: number; emitted: number; dropped: number }[];
  /** Records lost before an emitted record (sum of seq jumps) and records flagged gap. */
  lost: number | null; flagged: number | null;
  fifoHwm: number | null;
  /** The raw detail strings, shown verbatim under "Show source". */
  raw: { id: string; name: string; status: string; detail?: string }[];
}

export function overloadFacts(v: Verification | null): OverloadFacts | null {
  const suite = v?.suites.find((s) => s.name === 'v03_overload_gaps');
  if (!suite) return null;
  const pick = (suffix: string) => suite.tests.find((x) => x.id === `ovl_s51.${suffix}`);
  const acctT = pick('accounting');
  const acct: OverloadFacts['acct'] = [];
  const re = /(RAW|EVENT|FEATURE) generated (\d+) = emitted (\d+) \+ dropped (\d+)/g;
  let m: RegExpExecArray | null;
  while (acctT?.detail && (m = re.exec(acctT.detail))) acct.push({ type: m[1], generated: +m[2], emitted: +m[3], dropped: +m[4] });
  const gapT = pick('seq_gap');
  const lost = gapT?.detail?.match(/(\d+) records lost/);
  const flagged = gapT?.detail?.match(/(\d+) records flagged gap/);
  const hwm = pick('overload')?.detail?.match(/fifo_hwm (\d+)/);
  const raw = ['accounting', 'seq_gap', 'overload'].map(pick).filter((x): x is NonNullable<typeof x> => !!x);
  return {
    name: acctT?.name ?? suite.name, status: suite.status, acct,
    lost: lost ? +lost[1] : null, flagged: flagged ? +flagged[1] : null, fifoHwm: hwm ? +hwm[1] : null, raw,
  };
}

/** EVENT record data → polarity and magnitude ({15'b0, polarity, magnitude[15:0]}). */
export function decodeEvent(data: number) {
  return { pol: (data >>> 16) & 1, mag: data & 0xffff };
}

// ── educational record-mux model (rules of hbci_record_mux, drawn with a small FIFO) ──
// This is a teaching model of the documented rules (rtl/hbci_readout_core.v lines 434–449), stepped by the learner.
// It is NOT the RTL and has no timing: the real FIFO is 16 deep and the real numbers are in verification.json.

export type RecT = 'RAW' | 'EVENT' | 'FEATURE';
export interface MRec { t: RecT; seq: number; gap: boolean }
export interface MuxState {
  pend: Record<RecT, MRec | null>;
  seq: Record<RecT, number>;
  gapPending: Record<RecT, boolean>;
  drop: Record<RecT, number>;
  fifo: MRec[];
  out: MRec[];
  tick: number;
}
export interface MuxIn { raw: boolean; ev: boolean; ft: boolean; ready: boolean }

export function muxInit(): MuxState {
  return {
    pend: { RAW: null, EVENT: null, FEATURE: null }, seq: { RAW: 0, EVENT: 0, FEATURE: 0 },
    gapPending: { RAW: false, EVENT: false, FEATURE: false }, drop: { RAW: 0, EVENT: 0, FEATURE: 0 },
    fifo: [], out: [], tick: 0,
  };
}

/** One clock edge of the teaching model. Returns the new state and plain-language notes of what happened. */
export function muxStep(s: MuxState, inp: MuxIn, depth: number): { s: MuxState; notes: string[] } {
  const notes: string[] = [];
  const full = s.fifo.length >= depth;
  const valid = s.fifo.length > 0;
  const pop = valid && inp.ready;
  const p = s.pend;
  const mvEv = !!p.EVENT && !full;
  const mvFt = !!p.FEATURE && !p.EVENT && !full;
  const mvRaw = !!p.RAW && !p.EVENT && !p.FEATURE && !full;
  const moved: RecT | null = mvEv ? 'EVENT' : mvFt ? 'FEATURE' : mvRaw ? 'RAW' : null;

  const n: MuxState = {
    pend: { ...p }, seq: { ...s.seq }, gapPending: { ...s.gapPending }, drop: { ...s.drop },
    fifo: [...s.fifo], out: [...s.out], tick: s.tick + 1,
  };
  if (pop) {
    const r = n.fifo.shift()!;
    n.out.push(r);
    notes.push(`Handshake: rec_valid = 1 and rec_ready = 1, so ${r.t} #${r.seq}${r.gap ? ' (gap flag set)' : ''} leaves the chip.`);
  } else if (valid) {
    notes.push('rec_valid = 1 but rec_ready = 0: the receiver is busy, nothing leaves.');
  }
  if (moved) {
    const r = p[moved]!;
    n.fifo.push(r);
    const waiting = (['EVENT', 'FEATURE', 'RAW'] as RecT[]).filter((k) => k !== moved && p[k]);
    notes.push(`Arbiter: ${moved} #${r.seq} moves from its pending register into the FIFO${waiting.length ? ` (it beats ${waiting.join(' and ')}: priority EVENT > FEATURE > RAW)` : ''}.`);
    n.pend[moved] = null;
  } else if ((p.RAW || p.EVENT || p.FEATURE) && full) {
    notes.push(`The FIFO is full (${depth} of ${depth}), so the arbiter cannot move anything this tick.`);
  }
  const gens: [RecT, boolean][] = [['RAW', inp.raw], ['EVENT', inp.ev], ['FEATURE', inp.ft]];
  for (const [k, g] of gens) {
    if (!g) continue;
    const seq = n.seq[k];
    n.seq[k] = seq + 1;
    const stillFull = !!p[k] && moved !== k;
    if (stillFull) {
      n.drop[k] += 1;
      n.gapPending[k] = true;
      notes.push(`A new ${k} record (#${seq}) is generated, but the ${k} pending register is still full: it is DROPPED. drop_${k === 'RAW' ? 'raw' : k === 'EVENT' ? 'event' : 'feature'} = ${n.drop[k]}, and seq #${seq} will be missing.`);
    } else {
      const r: MRec = { t: k, seq, gap: s.gapPending[k] };
      n.pend[k] = r;
      n.gapPending[k] = false;
      notes.push(r.gap
        ? `A new ${k} record (#${seq}) waits in its pending register with flags.gap = 1: it is the first one after a loss.`
        : `A new ${k} record (#${seq}) waits in the ${k} pending register.`);
    }
  }
  if (notes.length === 0) notes.push('Nothing to do this tick.');
  return { s: n, notes };
}
