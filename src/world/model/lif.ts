// A small current-based leaky integrate-and-fire (LIF) circuit, stepped deterministically on a fixed grid.
//
// PUBLISHED COMPUTATIONAL MODEL (Gerstner, Kistler, Naud & Paninski, Neuronal Dynamics, §1.3: eq. 1.5 passive
// membrane, eq. 1.12 threshold, eq. 1.13 reset). What is computed here:
//
//     C_m dV/dt = −g_L (V − E_L) + I_bias + I_e(t) + I_i(t)
//
//   · V crossing V_th from below is a spike EVENT; V is then set to V_reset. No action-potential shape is computed.
//   · A connection delivers, `delay` after the sender's spike, a current that jumps by w and decays exponentially:
//     excitatory (w > 0) into I_e with time constant τ_e, inhibitory (w < 0) into I_i with τ_i.
//
// Units, used everywhere in this file: ms · mV · nF · µS · nA   (nA / µS = mV,  nF / µS = ms).
//
// Declared numerical rules (these are choices of this implementation, not of the source):
//   grid        every event lives on a grid of dt (default 0.05 ms). Between grid points the membrane equation is
//               advanced with its exact solution for exponentially decaying currents, so there is no integration error
//               for the sub-threshold dynamics; only event times are quantised.
//   threshold   tested at grid points. The reported spike time is linearly interpolated inside the step.
//   reset       applied at the grid point that follows the crossing. An absolute refractory period (an ADDED rule, not
//               part of §1.3's basic model) then holds V at V_reset for round(t_ref / dt) steps.
//   refractory  currents that arrive during the refractory period are not lost: they accumulate and decay as usual,
//               and act on V once the period ends.
//   ordering    all deliveries due at a grid point are summed before any cell is advanced, and every cell is advanced
//               from the same grid-point state. Delays are at least one step. The result therefore does not depend on
//               the order in which cells or connections are listed.
//   background  optional Poisson-like input: at each step a cell receives one excitatory kick with probability
//               rate·dt, drawn from a counter-based hash of (seed, cell, step) — no hidden generator state, so a
//               checkpoint needs nothing but the arrays below.
//
// NOT modelled: spike shape, ion channels, dendrites, conduction along an axon (a delay is one number), short-term
// plasticity, extracellular fields. Weights and delays are model parameters, not measured synapses.
//
// Pure module: no DOM, no three.js. Unit-tested in tests/world-lif.test.ts.

export const LIF_DT_MS = 0.05;
export const LIF_REVISION = 'lif-cuba-exp-1';
export const LIF_INTEGRATOR = 'exact propagator on a fixed grid; grid-point threshold with linear interpolation of spike time';
export const LIF_RNG = 'hash3-v1 (counter-based, 32-bit)';
export const LIF_UNITS = { time: 'ms', voltage: 'mV', capacitance: 'nF', conductance: 'µS', current: 'nA', position: 'µm' } as const;

export interface LifCellDef {
  id: string;
  label: string;
  kind: 'exc' | 'inh';
  /** Membrane capacitance, nF. */
  cm: number;
  /** Leak conductance, µS. */
  gl: number;
  /** Resting (leak reversal) potential, mV. */
  el: number;
  /** Threshold, mV. */
  vth: number;
  /** Reset potential, mV. */
  vreset: number;
  /** Absolute refractory period, ms. */
  trefMs: number;
  /** Decay time constants of the excitatory and inhibitory synaptic currents, ms. */
  tauE: number;
  tauI: number;
  /** Constant injected current, nA. */
  ibias?: number;
  /** Background input: mean kicks per second and the size of each kick, nA. */
  bgRateHz?: number;
  bgW?: number;
  /** Position of the soma in the scene, µm. */
  pos: [number, number, number];
}
export interface LifConnDef { id: string; from: string; to: string; /** Peak current, nA (negative = inhibitory). */ w: number; delayMs: number; enabled?: boolean }
export interface LifInputDef { id: string; label: string; to: string; /** Peak current of one pulse, nA. */ w: number }
export interface LifCircuit { id: string; revision: string; dt: number; seed: number; cells: LifCellDef[]; conns: LifConnDef[]; inputs: LifInputDef[] }

/** Bounds on everything a command may change. */
export const LIF_LIMITS = { gl: [0.004, 0.08], vth: [-66, -40], ibias: [-1.5, 2.5], w: [-8, 8] } as const;

export type LifCommandKind = 'pulse' | 'connection' | 'weight' | 'cell-gl' | 'cell-vth' | 'cell-bias' | 'cell-on';
/** One scientific command: applied at the start of step `atStep`, before deliveries; ties are broken by `seq`. */
export interface LifCommand { seq: number; atStep: number; kind: LifCommandKind; target: string; value: number }

export interface LifState {
  step: number;
  v: Float64Array; ie: Float64Array; ii: Float64Array; refr: Int32Array;
  // parameters a command may change (so that a checkpoint carries them)
  gl: Float64Array; vth: Float64Array; ibias: Float64Array; cellOn: Uint8Array;
  connOn: Uint8Array; connW: Float64Array; inputW: Float64Array;
  /** Deliveries on their way: arrival step, target cell, current jump (nA), connection index. */
  pending: Array<{ step: number; to: number; w: number; conn: number }>;
  spikes: Int32Array;
}

/** Well-mixed 32-bit hash of three integers. */
export function hash3(a: number, b: number, c: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0; h ^= h >>> 13;
  h = Math.imul(h ^ (c + 0x165667b1), 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2f) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

export function createState(c: LifCircuit, v0?: Record<string, number>): LifState {
  const n = c.cells.length;
  return {
    step: 0,
    v: Float64Array.from(c.cells, (x) => v0?.[x.id] ?? x.el), ie: new Float64Array(n), ii: new Float64Array(n), refr: new Int32Array(n),
    gl: Float64Array.from(c.cells, (x) => x.gl), vth: Float64Array.from(c.cells, (x) => x.vth), ibias: Float64Array.from(c.cells, (x) => x.ibias ?? 0),
    cellOn: new Uint8Array(n).fill(1),
    connOn: Uint8Array.from(c.conns, (x) => (x.enabled === false ? 0 : 1)), connW: Float64Array.from(c.conns, (x) => x.w), inputW: Float64Array.from(c.inputs, (x) => x.w),
    pending: [], spikes: new Int32Array(n),
  };
}
export function cloneState(s: LifState): LifState {
  return {
    step: s.step, v: s.v.slice(), ie: s.ie.slice(), ii: s.ii.slice(), refr: s.refr.slice(), gl: s.gl.slice(), vth: s.vth.slice(), ibias: s.ibias.slice(),
    cellOn: s.cellOn.slice(), connOn: s.connOn.slice(), connW: s.connW.slice(), inputW: s.inputW.slice(), pending: s.pending.map((p) => ({ ...p })), spikes: s.spikes.slice(),
  };
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** Checks a command against the circuit; returns the reason it is not acceptable, or null. */
export function commandProblem(c: LifCircuit, cmd: LifCommand): string | null {
  if (!Number.isInteger(cmd.atStep) || cmd.atStep < 0) return 'atStep must be a whole step ≥ 0';
  if (!Number.isFinite(cmd.value)) return 'value must be a finite number';
  switch (cmd.kind) {
    case 'pulse': return c.inputs.some((i) => i.id === cmd.target) ? null : `no input "${cmd.target}"`;
    case 'connection': return c.conns.some((k) => k.id === cmd.target) ? null : `no connection "${cmd.target}"`;
    case 'weight': return c.conns.some((k) => k.id === cmd.target) || c.inputs.some((i) => i.id === cmd.target) ? null : `no connection or input "${cmd.target}"`;
    case 'cell-gl': case 'cell-vth': case 'cell-bias': case 'cell-on': return c.cells.some((x) => x.id === cmd.target) ? null : `no cell "${cmd.target}"`;
    default: return `unknown command "${String((cmd as { kind: string }).kind)}"`;
  }
}

function applyCommand(c: LifCircuit, s: LifState, cmd: LifCommand): void {
  const cell = () => c.cells.findIndex((x) => x.id === cmd.target);
  switch (cmd.kind) {
    case 'pulse': {
      const i = c.inputs.findIndex((x) => x.id === cmd.target);
      if (i < 0) return;
      const to = c.cells.findIndex((x) => x.id === c.inputs[i].to), w = s.inputW[i];
      if (to >= 0) { if (w >= 0) s.ie[to] += w; else s.ii[to] += w; }
      return;
    }
    case 'connection': { const k = c.conns.findIndex((x) => x.id === cmd.target); if (k >= 0) s.connOn[k] = cmd.value ? 1 : 0; return; }
    case 'weight': {
      const k = c.conns.findIndex((x) => x.id === cmd.target);
      if (k >= 0) { s.connW[k] = clamp(cmd.value, LIF_LIMITS.w); return; }
      const i = c.inputs.findIndex((x) => x.id === cmd.target);
      if (i >= 0) s.inputW[i] = clamp(cmd.value, LIF_LIMITS.w);
      return;
    }
    case 'cell-gl': { const i = cell(); if (i >= 0) s.gl[i] = clamp(cmd.value, LIF_LIMITS.gl); return; }
    case 'cell-vth': { const i = cell(); if (i >= 0) s.vth[i] = clamp(cmd.value, LIF_LIMITS.vth); return; }
    case 'cell-bias': { const i = cell(); if (i >= 0) s.ibias[i] = clamp(cmd.value, LIF_LIMITS.ibias); return; }
    case 'cell-on': { const i = cell(); if (i >= 0) s.cellOn[i] = cmd.value ? 1 : 0; return; }
  }
}

/** Sorted copy of a command list: by step, then by sequence number. */
export const sortCommands = (cmds: readonly LifCommand[]): LifCommand[] => cmds.slice().sort((a, b) => a.atStep - b.atStep || a.seq - b.seq);

export interface StepSink {
  /** A cell crossed threshold during the step that ends at `step`; `tMs` is interpolated inside it. */
  spike?: (cell: number, tMs: number, step: number) => void;
  /** A spike was put on a connection: it leaves at `emitStep` and arrives at `arriveStep`. */
  sent?: (conn: number, emitStep: number, arriveStep: number) => void;
}

/**
 * Advance the circuit to `toStep`. `cmds` must be sorted (sortCommands); `cursor` says how many of them have already
 * been applied and the new count is returned. Splitting one advance into many gives exactly the same arrays.
 */
export function advance(c: LifCircuit, s: LifState, toStep: number, cmds: readonly LifCommand[], cursor: number, sink?: StepSink): number {
  const n = c.cells.length, dt = c.dt, idOf = new Map(c.cells.map((x, i) => [x.id, i]));
  const fromIdx = c.conns.map((k) => idOf.get(k.from) ?? -1), toIdx = c.conns.map((k) => idOf.get(k.to) ?? -1);
  const delaySteps = c.conns.map((k) => Math.max(1, Math.round(k.delayMs / dt)));
  const refSteps = c.cells.map((x) => Math.max(0, Math.round(x.trefMs / dt)));
  const dE = c.cells.map((x) => Math.exp(-dt / x.tauE)), dI = c.cells.map((x) => Math.exp(-dt / x.tauI));
  // propagators depend on g_L, which a command may change: recomputed lazily per cell
  const glSeen = new Float64Array(n).fill(NaN), pm = new Float64Array(n), pe = new Float64Array(n), pi = new Float64Array(n);
  const kernel = (tauM: number, tauS: number, cm: number) => {
    const a = 1 / tauM - 1 / tauS;
    return Math.abs(a) < 1e-9 ? (dt / cm) * Math.exp(-dt / tauM) : (Math.exp(-dt / tauS) - Math.exp(-dt / tauM)) / (a * cm);
  };
  while (s.step < toStep) {
    const k = s.step;
    while (cursor < cmds.length && cmds[cursor].atStep <= k) { if (cmds[cursor].atStep === k) applyCommand(c, s, cmds[cursor]); cursor++; }
    // deliveries due now
    if (s.pending.length) {
      let keep = 0;
      for (let q = 0; q < s.pending.length; q++) {
        const p = s.pending[q];
        if (p.step === k) { if (p.w >= 0) s.ie[p.to] += p.w; else s.ii[p.to] += p.w; }
        else s.pending[keep++] = p;
      }
      s.pending.length = keep;
    }
    for (let i = 0; i < n; i++) {
      const x = c.cells[i];
      if (x.bgRateHz && x.bgW && hash3(c.seed, i, k) / 4294967296 < (x.bgRateHz * dt) / 1000) s.ie[i] += x.bgW;
    }
    for (let i = 0; i < n; i++) {
      const x = c.cells[i], ie = s.ie[i], ii = s.ii[i];
      s.ie[i] = ie * dE[i]; s.ii[i] = ii * dI[i];
      if (!s.cellOn[i]) { s.v[i] = x.el; s.refr[i] = 0; continue; }
      if (s.refr[i] > 0) { s.v[i] = x.vreset; s.refr[i]--; continue; }
      if (glSeen[i] !== s.gl[i]) {
        glSeen[i] = s.gl[i];
        const tauM = x.cm / s.gl[i];
        pm[i] = Math.exp(-dt / tauM); pe[i] = kernel(tauM, x.tauE, x.cm); pi[i] = kernel(tauM, x.tauI, x.cm);
      }
      const v0 = s.v[i];
      const v1 = x.el + (v0 - x.el) * pm[i] + (s.ibias[i] / s.gl[i]) * (1 - pm[i]) + ie * pe[i] + ii * pi[i];
      if (v1 >= s.vth[i]) {
        const f = v1 > v0 ? Math.max(0, Math.min(1, (s.vth[i] - v0) / (v1 - v0))) : 0;
        s.spikes[i]++;
        sink?.spike?.(i, (k + f) * dt, k + 1);
        s.v[i] = x.vreset; s.refr[i] = refSteps[i];
        for (let q = 0; q < c.conns.length; q++) {
          if (fromIdx[q] !== i || !s.connOn[q] || toIdx[q] < 0) continue;
          s.pending.push({ step: k + 1 + delaySteps[q], to: toIdx[q], w: s.connW[q], conn: q });
          sink?.sent?.(q, k + 1, k + 1 + delaySteps[q]);
        }
      } else s.v[i] = v1;
    }
    s.step = k + 1;
  }
  return cursor;
}

export interface LifRun {
  circuit: LifCircuit;
  commands: LifCommand[];
  nSteps: number;
  dt: number;
  /** Membrane potential of every cell at every grid point (nSteps + 1 values), mV. */
  v: Float64Array[];
  /** Spike times of every cell, ms. */
  spikes: number[][];
  /** Every spike that travelled along a connection: when it left and when it arrived, ms. */
  sent: Array<{ conn: number; emitMs: number; arriveMs: number }>;
  /** States saved every `checkpointEvery` steps (index i is step i × checkpointEvery). */
  checkpoints: LifState[];
  checkpointEvery: number;
  final: LifState;
}

/** Run a circuit for nSteps from rest (or from `from`, a checkpoint) and keep everything. */
export function simulate(c: LifCircuit, commands: readonly LifCommand[], nSteps: number, opts: { checkpointEvery?: number; v0?: Record<string, number> } = {}): LifRun {
  const cmds = sortCommands(commands), every = Math.max(1, opts.checkpointEvery ?? 200), s = createState(c, opts.v0), n = c.cells.length;
  const v = c.cells.map(() => new Float64Array(nSteps + 1)), spikes: number[][] = c.cells.map(() => []), sent: LifRun['sent'] = [], checkpoints: LifState[] = [];
  const sink: StepSink = { spike: (i, t) => spikes[i].push(t), sent: (conn, a, b) => sent.push({ conn, emitMs: a * c.dt, arriveMs: b * c.dt }) };
  for (let i = 0; i < n; i++) v[i][0] = s.v[i];
  let cursor = 0;
  for (let k = 0; k < nSteps; k++) {
    if (k % every === 0) checkpoints.push(cloneState(s));
    cursor = advance(c, s, k + 1, cmds, cursor, sink);
    for (let i = 0; i < n; i++) v[i][k + 1] = s.v[i];
  }
  return { circuit: c, commands: cmds, nSteps, dt: c.dt, v, spikes, sent, checkpoints, checkpointEvery: every, final: s };
}

/** A short fingerprint of a state: two runs with the same digest ended in the same arrays, bit for bit. */
export function digestState(s: LifState): string {
  let h = 0x811c9dc5;
  const eat = (buf: ArrayBufferView) => { const b = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength); for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } };
  eat(Int32Array.of(s.step)); eat(s.v); eat(s.ie); eat(s.ii); eat(s.refr); eat(s.gl); eat(s.vth); eat(s.ibias); eat(s.cellOn); eat(s.connOn); eat(s.connW); eat(s.inputW); eat(s.spikes);
  for (const p of s.pending) eat(Float64Array.of(p.step, p.to, p.w, p.conn));
  return h.toString(16).padStart(8, '0');
}

/** Closed-form voltage of an isolated cell under a constant current (the analytical reference used by the tests). */
export function analyticConstant(cell: { cm: number; gl: number; el: number }, v0: number, i0: number, tMs: number): number {
  const tau = cell.cm / cell.gl, vInf = cell.el + i0 / cell.gl;
  return vInf + (v0 - vInf) * Math.exp(-tMs / tau);
}
/** Closed-form deflection (mV) at time t after one exponential current of peak w arrives at a resting cell. */
export function analyticPsp(cell: { cm: number; gl: number }, w: number, tauS: number, tMs: number): number {
  if (tMs <= 0) return 0;
  const tauM = cell.cm / cell.gl, a = 1 / tauM - 1 / tauS;
  return Math.abs(a) < 1e-9 ? (w / cell.cm) * tMs * Math.exp(-tMs / tauM) : ((w / cell.cm) * (Math.exp(-tMs / tauS) - Math.exp(-tMs / tauM))) / a;
}

/**
 * The scientific clock: how far the model should have advanced after some wall-clock time, at a playback rate given
 * in model milliseconds per wall second. Rendering faster or slower changes how often this is asked, never the answer
 * for a given elapsed time; the model itself always moves in whole steps of dt.
 */
export class ModelClock {
  /** Model time owed, ms. */
  modelMs = 0;
  paused = false;
  msPerSecond: number;
  dt: number;
  constructor(msPerSecond: number, dt: number) { this.msPerSecond = msPerSecond; this.dt = dt; }
  /** Add one presentation frame of `wallSeconds`; returns the step the model should now be at. */
  tick(wallSeconds: number): number {
    if (!this.paused && wallSeconds > 0) this.modelMs += Math.min(wallSeconds, 0.25) * this.msPerSecond;
    return this.step();
  }
  step(): number { return Math.floor(this.modelMs / this.dt + 1e-9); }
  seek(step: number): void { this.modelMs = step * this.dt; }
}
