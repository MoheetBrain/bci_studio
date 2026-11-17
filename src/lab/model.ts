// DEMO signal model: a deterministic synthetic 8-channel generator and a bit-accurate
// TypeScript port of the HBCI-02 detection algorithm. This is an independent frontend
// model (evidence: DEMO). The RTL itself is only shown in RTL Trace Mode.

export const NUM_CH = 8;
export const PACKET_BITS = 3 + 32 + 1 + 16; // channel + timestamp + polarity + magnitude
export const SAMPLE_BITS = 16;

export interface CoreConfig {
  threshold: number;   // 0..65535, 0 disables detection
  hysteresis: number;  // 0..65535
  refractory: number;  // 0..255
  alphaShift: number;  // 0..15
}

export interface ChannelState {
  base: number;   // Q16.8 raw integer
  refr: number;
  armed: boolean;
  primed: boolean;
}

/** Everything the core computes for one accepted sample (mirrors TraceSample). */
export interface StepResult {
  i: number;
  ch: number;
  x: number;
  base: number;      // stored baseline before update (Q16.8 raw)
  baseInt: number;   // floor(base / 256)
  res: number;
  mag: number;
  pol: 0 | 1;
  above: 0 | 1;
  rearm: 0 | 1;
  armed: 0 | 1;      // before update
  refr: number;      // before update
  primed: 0 | 1;     // before update
  fire: 0 | 1;
  baseNext: number;
  armedNext: 0 | 1;
  refrNext: number;
}

export function freshState(): ChannelState[] {
  return Array.from({ length: NUM_CH }, () => ({ base: 0, refr: 0, armed: true, primed: false }));
}

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

/** One accepted sample through the core. Bit-accurate with rtl/hbci_event_core.v. */
export function stepCore(st: ChannelState, i: number, ch: number, x: number, cfg: CoreConfig): StepResult {
  const baseInt = st.base >> 8; // arithmetic shift = floor
  const res = st.primed ? x - baseInt : 0;
  const sampleQ = x * 256;
  const errQ = sampleQ - st.base;
  const stepQ = errQ >> cfg.alphaShift;
  const baseNext = st.primed ? st.base + stepQ : sampleQ;

  const mag = Math.abs(res);
  const pol: 0 | 1 = res < 0 ? 1 : 0;
  const enable = cfg.threshold !== 0;
  const above = enable && mag >= cfg.threshold;
  const rearmLevel = cfg.hysteresis >= cfg.threshold ? 1 : cfg.threshold - cfg.hysteresis;
  const rearm = mag < rearmLevel;
  const refrActive = st.refr !== 0;
  const fire = st.primed && enable && st.armed && !refrActive && above;
  const armedNext = fire ? false : st.armed || rearm;
  const refrNext = fire ? cfg.refractory : refrActive ? st.refr - 1 : 0;

  const r: StepResult = {
    i, ch, x, base: st.base, baseInt, res, mag, pol,
    above: above ? 1 : 0, rearm: rearm ? 1 : 0,
    armed: st.armed ? 1 : 0, refr: st.refr, primed: st.primed ? 1 : 0,
    fire: fire ? 1 : 0, baseNext, armedNext: armedNext ? 1 : 0, refrNext,
  };
  st.base = baseNext;
  st.armed = armedNext;
  st.refr = refrNext;
  st.primed = true;
  return r;
}

// ───────────────────────────────────────────── synthetic generator ──

export interface Spike { ch: number; t: number; amp: number; injected?: boolean }

export interface GenParams {
  seed: number;
  samplesPerChannel: number;
  noise: number;        // noise standard deviation in ADC codes
  spikeRate: number;    // expected spikes per channel per 100 samples
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Biphasic extracellular spike shape (negative first), sampled over 7 samples. */
const SPIKE_SHAPE = [0.15, -0.55, -1.0, -0.35, 0.3, 0.22, 0.08];

export interface Stimulus {
  /** x[ch][t] in ADC codes. */
  x: number[][];
  spikes: Spike[];
}

export function generate(p: GenParams, injected: Spike[]): Stimulus {
  const rnd = mulberry32(p.seed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() + rnd() + rnd() - 3) * 1.414; // ~N(0,1)
  const x: number[][] = [];
  const spikes: Spike[] = [];
  for (let ch = 0; ch < NUM_CH; ch++) {
    const offset = (rnd() - 0.5) * 1600;
    const driftAmp = 120 + rnd() * 260;
    const driftPer = 180 + rnd() * 320;
    const phase = rnd() * Math.PI * 2;
    const row: number[] = new Array(p.samplesPerChannel);
    for (let t = 0; t < p.samplesPerChannel; t++) {
      row[t] = offset + driftAmp * Math.sin((2 * Math.PI * t) / driftPer + phase) + gauss() * p.noise;
    }
    // Background spikes at deterministic random times with a minimum spacing.
    let t = 20 + Math.floor(rnd() * 30);
    while (t < p.samplesPerChannel - 10) {
      if (rnd() < p.spikeRate / 10) {
        const amp = 380 + rnd() * 1500;
        spikes.push({ ch, t, amp });
      }
      t += 10 + Math.floor(rnd() * 12);
    }
    x.push(row);
  }
  for (const s of injected) spikes.push({ ...s, injected: true });
  for (const s of spikes) {
    const row = x[s.ch];
    SPIKE_SHAPE.forEach((k, j) => {
      const tt = s.t + j - 2; // trough of the shape lands at s.t
      if (tt >= 0 && tt < row.length) row[tt] += k * s.amp;
    });
  }
  for (const row of x) for (let t = 0; t < row.length; t++) row[t] = clamp16(row[t]);
  spikes.sort((a, b) => a.t - b.t || a.ch - b.ch);
  return { x, spikes };
}

// ───────────────────────────────────────────── run + scoring ──

export interface CoreEvent { i: number; ch: number; t: number; ts: number; pol: 0 | 1; mag: number }

export interface RunResult {
  steps: StepResult[];        // indexed by global sample index i = t * NUM_CH + ch
  events: CoreEvent[];
}

/** Run the core over a round-robin stream: i = t * NUM_CH + ch. */
export function runCore(x: number[][], cfg: CoreConfig): RunResult {
  const st = freshState();
  const T = x[0]?.length ?? 0;
  const steps: StepResult[] = new Array(T * NUM_CH);
  const events: CoreEvent[] = [];
  for (let t = 0; t < T; t++) {
    for (let ch = 0; ch < NUM_CH; ch++) {
      const i = t * NUM_CH + ch;
      const r = stepCore(st[ch], i, ch, x[ch][t], cfg);
      steps[i] = r;
      if (r.fire) events.push({ i, ch, t, ts: i, pol: r.pol, mag: r.mag });
    }
  }
  return { steps, events };
}

export interface Score {
  hits: number;
  misses: number;
  falsePositives: number;
  eventMatch: Map<number, number>;   // event index → spike index (or -1)
  spikeHit: boolean[];
}

/** Match events to ground-truth spikes on the same channel within ±window samples of that channel. */
export function score(events: CoreEvent[], spikes: Spike[], window = 3): Score {
  const used = new Array(spikes.length).fill(false);
  const eventMatch = new Map<number, number>();
  let fp = 0;
  events.forEach((e, k) => {
    let best = -1;
    let bestD = Infinity;
    spikes.forEach((s, j) => {
      if (used[j] || s.ch !== e.ch) return;
      const d = Math.abs(s.t - e.t);
      if (d <= window && d < bestD) { best = j; bestD = d; }
    });
    if (best >= 0) used[best] = true;
    else fp++;
    eventMatch.set(k, best);
  });
  const hits = used.filter(Boolean).length;
  return { hits, misses: spikes.length - hits, falsePositives: fp, eventMatch, spikeHit: used };
}

export function compression(samples: number, events: number) {
  const rawBits = samples * SAMPLE_BITS;
  const eventBits = events * PACKET_BITS;
  return { rawBits, eventBits, ratio: eventBits > 0 ? rawBits / eventBits : Infinity };
}
