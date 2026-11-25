// The LIF circuit of the Neuroverse toys against closed-form references, plus the properties the toys rely on:
// order-independence, timestep refinement, checkpoint replay, frame-rate independence, and a recording model that
// depends on contact position and nothing else. Tolerances are derived from the method, not fitted to the output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIF_DT_MS, ModelClock, advance, analyticConstant, analyticPsp, cloneState, commandProblem, createState, digestState, simulate, sortCommands,
  type LifCellDef, type LifCircuit, type LifCommand,
} from '../src/world/model/lif.ts';
import { WORKSHOP_MS, defaultSetup, fieldCircuit, firingWindow, runWorkshop, workshopCircuit, workshopCommands } from '../src/world/model/circuits.ts';
import { OBS, ampAtUv, contactTrace, detect, distUm, noiseAt, type Vec3 } from '../src/world/model/observe.ts';
import { FieldRun } from '../src/world/model/fieldRun.ts';

const CELL: LifCellDef = { id: 'x', label: 'x', kind: 'exc', cm: 0.25, gl: 1 / 60, el: -70, vth: -54, vreset: -70, trefMs: 2, tauE: 2, tauI: 4, pos: [0, 0, 0] };
const one = (over: Partial<LifCellDef> = {}, dt = LIF_DT_MS): LifCircuit => ({ id: 't', revision: 't', dt, seed: 1, cells: [{ ...CELL, ...over }], conns: [], inputs: [{ id: 'in', label: 'in', to: 'x', w: 1.7 }] });
const TAU = CELL.cm / CELL.gl;   // 15 ms
const maxAbs = (a: ArrayLike<number>, f: (i: number) => number) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - f(i))); return m; };

test('LIF: a cell at rest stays at rest, and a displaced one decays exponentially with τ = C/g_L', () => {
  const rest = simulate(one(), [], 2000);
  assert.equal(maxAbs(rest.v[0], () => CELL.el), 0);
  assert.equal(rest.spikes[0].length, 0);
  const c = one(), r = simulate(c, [], 2000, { v0: { x: -60 } });
  // the propagator is the exact solution, so only rounding separates the model from the formula
  assert.ok(maxAbs(r.v[0], (i) => analyticConstant(CELL, -60, 0, i * c.dt)) < 1e-10);
  assert.ok(Math.abs(r.v[0][Math.round(TAU / c.dt)] - (CELL.el + 10 / Math.E)) < 1e-9, 'one time constant → 1/e of the displacement');
});

test('LIF: constant positive and negative currents follow V∞ + (V0 − V∞)·e^(−t/τ) and settle at E_L + I/g_L', () => {
  for (const i0 of [0.2, -0.3]) {
    const c = one({ ibias: i0, vth: 0 }), r = simulate(c, [], 6000);
    assert.ok(maxAbs(r.v[0], (i) => analyticConstant(CELL, CELL.el, i0, i * c.dt)) < 1e-9, `I = ${i0} nA`);
    assert.ok(Math.abs(r.v[0][6000] - (CELL.el + i0 / CELL.gl)) < 1e-6);
  }
});

test('LIF: threshold time under a constant current matches τ·ln((V∞ − E_L)/(V∞ − V_th)); a sub-threshold asymptote never fires', () => {
  const i0 = 0.4, vInf = CELL.el + i0 / CELL.gl;                          // −46 mV: above threshold
  const exact = TAU * Math.log((vInf - CELL.el) / (vInf - CELL.vth));
  const c = one({ ibias: i0, trefMs: 0 }), r = simulate(c, [], 1200);
  // linear interpolation of a smooth curve over one step: |ΔV| ≤ h²·|V″|/8 and V″ = −V′/τ, so |Δt| ≤ h²/(8τ)
  const bound = (c.dt * c.dt) / (8 * TAU);
  assert.ok(Math.abs(r.spikes[0][0] - exact) <= bound * 1.01, `first spike ${r.spikes[0][0]} vs ${exact} (bound ${bound})`);
  // just below threshold for ever: V∞ = −54.6 mV
  const sub = simulate(one({ ibias: (CELL.vth - 0.6 - CELL.el) * CELL.gl }), [], 20000);
  assert.equal(sub.spikes[0].length, 0);
  assert.ok(Math.abs(sub.v[0][20000] - (CELL.vth - 0.6)) < 1e-6);
});

test('LIF: reset and refractory period — V sits at V_reset for exactly t_ref, and the firing period is t_ref + charging time', () => {
  const i0 = 0.4, vInf = CELL.el + i0 / CELL.gl, c = one({ ibias: i0, trefMs: 2, vreset: -66 }), r = simulate(c, [], 4000);
  const sp = r.spikes[0];
  assert.ok(sp.length >= 4);
  const k = Math.ceil(sp[0] / c.dt), refN = Math.round(2 / c.dt);
  for (let j = 0; j <= refN; j++) assert.equal(r.v[0][k + j], -66, `step ${j} after the spike`);
  assert.ok(r.v[0][k + refN + 1] > -66, 'integration resumes after the refractory period');
  const period = 2 + TAU * Math.log((vInf - -66) / (vInf - CELL.vth));
  // the reset waits for the next grid point, so each interval may be up to one step long
  for (let j = 1; j < sp.length; j++) assert.ok(sp[j] - sp[j - 1] - period >= -1e-9 && sp[j] - sp[j - 1] - period <= c.dt + 1e-9, `interval ${sp[j] - sp[j - 1]} vs ${period}`);
  // input that arrives during the refractory period still acts afterwards
  const late = simulate(one({ ibias: 0 }), [{ seq: 0, atStep: 100, kind: 'pulse', target: 'in', value: 1 }, { seq: 1, atStep: 100, kind: 'pulse', target: 'in', value: 1 }, { seq: 2, atStep: 100, kind: 'pulse', target: 'in', value: 1 }], 600);
  assert.equal(late.spikes[0].length, 1);
  const after = Math.ceil(late.spikes[0][0] / LIF_DT_MS) + Math.round(2 / LIF_DT_MS) + 20;
  assert.ok(late.v[0][after] > CELL.vreset + 0.5, 'the remaining synaptic current depolarises the cell once it may integrate again');
});

const pair = (w: number, delayMs: number, enabled = true): LifCircuit => ({
  id: 'pair', revision: 't', dt: LIF_DT_MS, seed: 1,
  cells: [{ ...CELL, id: 'a' }, { ...CELL, id: 'b', vth: 0 }],
  conns: [{ id: 'a>b', from: 'a', to: 'b', w, delayMs, enabled }],
  inputs: [{ id: 'in', label: 'in', to: 'a', w: 6 }],
});

test('LIF: one connection — nothing before the delay, then exactly the closed-form potential, with the sign of the weight', () => {
  for (const w of [1.7, -2.2]) {
    const c = pair(w, 3), r = simulate(c, [{ seq: 0, atStep: 40, kind: 'pulse', target: 'in', value: 1 }], 1600);
    assert.equal(r.spikes[0].length, 1);
    const emit = Math.ceil(r.spikes[0][0] / c.dt), arrive = emit + Math.round(3 / c.dt);
    assert.deepEqual(r.sent, [{ conn: 0, emitMs: emit * c.dt, arriveMs: arrive * c.dt }]);
    for (let k = 0; k <= arrive; k++) assert.equal(r.v[1][k], CELL.el, `no effect before the delay (step ${k})`);
    const tauS = w > 0 ? CELL.tauE : CELL.tauI;
    assert.ok(maxAbs(r.v[1].subarray(arrive), (i) => CELL.el + analyticPsp(CELL, w, tauS, i * c.dt)) < 1e-9);
    const peak = r.v[1].reduce((m, x) => (Math.abs(x - CELL.el) > Math.abs(m - CELL.el) ? x : m), CELL.el);
    assert.equal(Math.sign(peak - CELL.el), Math.sign(w));
  }
  // disconnected: the receiver never moves
  const off = simulate(pair(1.7, 3, false), [{ seq: 0, atStep: 40, kind: 'pulse', target: 'in', value: 1 }], 800);
  assert.equal(maxAbs(off.v[1], () => CELL.el), 0);
  assert.equal(off.sent.length, 0);
  // switching it off by command, after the spike has left, does not recall the spike already on its way
  const c = pair(1.7, 3), late = simulate(c, [{ seq: 0, atStep: 40, kind: 'pulse', target: 'in', value: 1 }, { seq: 1, atStep: 70, kind: 'connection', target: 'a>b', value: 0 }], 800);
  assert.ok(Math.max(...late.v[1]) > CELL.el + 5);
});

test('LIF: the result does not depend on the order in which cells, connections or simultaneous commands are listed', () => {
  const c = workshopCircuit(0), setup = { ...defaultSetup(0), aMs: 12, bMs: 12, conn: { 'I>T': true } };
  const a = simulate(c, workshopCommands(c, setup), 1200);
  const perm = [3, 0, 4, 2, 1];
  const shuffled: LifCircuit = { ...c, cells: perm.map((i) => c.cells[i]), conns: c.conns.slice().reverse(), inputs: c.inputs.slice().reverse() };
  const b = simulate(shuffled, workshopCommands(c, setup).reverse().map((x, i) => ({ ...x, seq: x.atStep === 0 ? x.seq : 100 - i })), 1200);
  perm.forEach((orig, now) => { assert.deepEqual(Array.from(b.v[now]), Array.from(a.v[orig])); assert.deepEqual(b.spikes[now], a.spikes[orig]); });
  // two inputs arriving at the same grid point add
  const both = simulate(one({ vth: 0 }), [{ seq: 0, atStep: 20, kind: 'pulse', target: 'in', value: 1 }, { seq: 1, atStep: 20, kind: 'pulse', target: 'in', value: 1 }], 400);
  const single = simulate(one({ vth: 0 }), [{ seq: 0, atStep: 20, kind: 'pulse', target: 'in', value: 1 }], 400);
  assert.ok(maxAbs(both.v[0], (i) => CELL.el + 2 * (single.v[0][i] - CELL.el)) < 1e-10);
});

test('LIF: halving the timestep moves a synaptically driven spike by less than one old step, and the error keeps shrinking', () => {
  const spikeAt = (dt: number) => {
    const c: LifCircuit = { ...one({}, dt), inputs: [{ id: 'in', label: 'in', to: 'x', w: 1.7 }] };
    const st = (ms: number) => Math.round(ms / dt);
    return simulate(c, [{ seq: 0, atStep: st(5), kind: 'pulse', target: 'in', value: 1 }, { seq: 1, atStep: st(8), kind: 'pulse', target: 'in', value: 1 }], st(40)).spikes[0][0];
  };
  const ref = spikeAt(0.0005), errs = [0.1, 0.05, 0.025, 0.0125].map((dt) => Math.abs(spikeAt(dt) - ref));
  assert.ok(Number.isFinite(ref));
  errs.forEach((e, i) => assert.ok(e <= [0.1, 0.05, 0.025, 0.0125][i], `dt ${[0.1, 0.05, 0.025, 0.0125][i]}: error ${e}`));
  assert.ok(errs[3] < errs[0], `errors ${errs.join(', ')}`);
  // the sub-threshold curve itself is exact at every dt: a single EPSP peak is the same at 0.1 and 0.0125 ms
  const peak = (dt: number) => Math.max(...simulate(one({ vth: 0 }, dt), [{ seq: 0, atStep: Math.round(5 / dt), kind: 'pulse', target: 'in', value: 1 }], Math.round(40 / dt)).v[0].filter((_, i) => i % Math.round(0.1 / dt) === 0));
  assert.ok(Math.abs(peak(0.1) - peak(0.0125)) < 1e-9);
});

test('LIF: restoring a checkpoint and replaying the command log reproduces the run bit for bit; a counterfactual shares its past', () => {
  const c = workshopCircuit(0), setup = { ...defaultSetup(0), aMs: 12, bMs: 16 }, cmds = sortCommands(workshopCommands(c, setup));
  const full = simulate(c, cmds, 1200, { checkpointEvery: 100 });
  for (const at of [0, 300, 700]) {
    const s = cloneState(full.checkpoints[at / 100]);
    advance(c, s, 1200, cmds, cmds.filter((x) => x.atStep < at).length);
    assert.equal(digestState(s), digestState(full.final), `from the checkpoint at step ${at}`);
  }
  // chunked stepping is the same as one call
  const s = createState(c); let cursor = 0;
  for (let k = 7; k < 1200; k += 7) cursor = advance(c, s, k, cmds, cursor);
  advance(c, s, 1200, cmds, cursor);
  assert.equal(digestState(s), digestState(full.final));
  // an extra pulse at step 500 changes nothing before step 500
  const child = simulate(c, [...cmds, { seq: 99, atStep: 500, kind: 'pulse', target: 'inB', value: 1 }], 1200);
  for (let i = 0; i < c.cells.length; i++) assert.deepEqual(Array.from(child.v[i].subarray(0, 501)), Array.from(full.v[i].subarray(0, 501)));
  assert.notEqual(digestState(child.final), digestState(full.final));
});

test('scientific clock: 30, 60 and 120 frames per second reach the same model state; pausing stops the model, not the frames', () => {
  const c = workshopCircuit(0), cmds = sortCommands(workshopCommands(c, { ...defaultSetup(0), aMs: 12, bMs: 16 }));
  const MARK = 600;
  const play = (fps: number) => {
    const clock = new ModelClock(10, c.dt), s = createState(c); let cursor = 0, atMark = '';
    for (let f = 0; f < fps * 4; f++) {
      const want = Math.min(1200, clock.tick(1 / fps));
      if (s.step < MARK && want >= MARK) { cursor = advance(c, s, MARK, cmds, cursor); atMark = digestState(s); }
      cursor = advance(c, s, want, cmds, cursor);
    }
    return { step: s.step, atMark };
  };
  const a = play(30), b = play(60), d = play(120);
  // the clock only ever asks for whole steps; summing frame times differently may differ by one step at the very end
  assert.ok(Math.abs(a.step - b.step) <= 1 && Math.abs(b.step - d.step) <= 1, `${a.step} ${b.step} ${d.step}`);
  assert.ok(a.step >= 799 && a.step <= 801, 'four seconds at 10 model-ms per second is 40 ms = 800 steps');
  const oneShot = createState(c); advance(c, oneShot, MARK, cmds, 0);
  assert.equal(a.atMark, digestState(oneShot)); assert.equal(b.atMark, a.atMark); assert.equal(d.atMark, a.atMark);
  const clock = new ModelClock(10, c.dt);
  clock.tick(0.5); const before = clock.step();
  clock.paused = true; for (let f = 0; f < 120; f++) clock.tick(1 / 60);
  assert.equal(clock.step(), before);
  clock.paused = false; clock.tick(0.1);
  assert.ok(clock.step() > before);
});

test('commands are validated against the circuit and clamped to the stated bounds', () => {
  const c = workshopCircuit(0);
  assert.equal(commandProblem(c, { seq: 0, atStep: 0, kind: 'pulse', target: 'inA', value: 1 }), null);
  assert.match(commandProblem(c, { seq: 0, atStep: 0, kind: 'pulse', target: 'nope', value: 1 })!, /no input/);
  assert.match(commandProblem(c, { seq: 0, atStep: 1.5, kind: 'pulse', target: 'inA', value: 1 })!, /whole step/);
  assert.match(commandProblem(c, { seq: 0, atStep: 0, kind: 'cell-gl', target: 'T', value: NaN })!, /finite/);
  const r = simulate(c, [{ seq: 0, atStep: 0, kind: 'cell-gl', target: 'T', value: 99 }, { seq: 1, atStep: 0, kind: 'weight', target: 'A>T', value: -99 }], 10);
  assert.equal(r.final.gl[3], 0.08);
  assert.equal(r.final.connW[0], -8);
});

test('Time workshop: one input is not enough, two close together are, and the window is what the model says it is', () => {
  const c = workshopCircuit(0), T = 3, D = 4;
  const only = runWorkshop({ ...defaultSetup(0), bMs: null });
  assert.equal(only.spikes[T].length, 0);
  assert.ok(Math.abs(Math.max(...only.v[T]) - CELL.el - 9.98) < 0.05, 'one input moves the target about 10 mV of the 16 mV it needs');
  assert.equal(runWorkshop(defaultSetup(0)).spikes[T].length, 0, 'the default 12 ms gap is just too wide');
  const close = runWorkshop({ ...defaultSetup(0), aMs: 10, bMs: 14 });
  assert.equal(close.spikes[T].length, 1);
  assert.equal(close.spikes[D].length, 1, 'the follower fires after the target');
  assert.ok(close.spikes[D][0] - close.spikes[T][0] > 2 && close.spikes[D][0] - close.spikes[T][0] < 6);
  const open = firingWindow(defaultSetup(0))!, shut = firingWindow({ ...defaultSetup(0), conn: { 'I>T': true } })!;
  assert.ok(open.lo < -8 && open.hi > 8 && Math.abs(open.lo + open.hi) < 0.6, `symmetric window ${JSON.stringify(open)}`);
  // with the inhibitory path on, A's own inhibition follows A: only "B first" still works
  assert.ok(shut.hi < 0 && shut.lo > open.lo && shut.hi - shut.lo < (open.hi - open.lo) / 2, `window with inhibition ${JSON.stringify(shut)}`);
  // a leakier target forgets the first input sooner: the window narrows
  const leaky = firingWindow({ ...defaultSetup(0), glT: 1 / 40 })!;
  assert.ok(leaky.hi - leaky.lo < open.hi - open.lo - 4, `leaky window ${JSON.stringify(leaky)}`);
  // every variant keeps the task possible and differs from the reference
  for (const v of [1, 2, 3, 4, 5, 6]) {
    const cv = workshopCircuit(v), o = firingWindow(defaultSetup(v), cv), s = firingWindow({ ...defaultSetup(v), conn: { 'I>T': true } }, cv);
    assert.ok(o && s && s.hi - s.lo >= 1.5, `variant ${v}: ${JSON.stringify(o)} ${JSON.stringify(s)}`);
    assert.notDeepEqual(cv.cells[T].gl, c.cells[T].gl);
  }
  assert.equal(Math.round(WORKSHOP_MS / c.dt), 1200);
});

test('recording model: spike size follows the stated 1/distance rule from the contact position; noise is a pure function of the sample', () => {
  assert.equal(ampAtUv(30), 120);
  assert.equal(ampAtUv(60), 60);
  assert.equal(ampAtUv(5), ampAtUv(15), 'the floor');
  const cells: Vec3[] = [[0, 0, 0], [200, 0, 0]], spikes = [[10], [20]];
  const at = (pos: Vec3, noNoise = true) => contactTrace({ cells, spikes, placements: [{ atStep: 0, pos }], seed: 3, slot: 1, fromStep: 0, n: 800, dtMs: LIF_DT_MS, noNoise });
  const near0 = at([30, 0, 0]), near1 = at([170, 0, 0]);
  const trough = (a: Float32Array, ms: number) => -a[Math.round(ms / LIF_DT_MS)];
  assert.ok(Math.abs(trough(near0, 10) - 120) < 1e-3 && Math.abs(trough(near0, 20) - ampAtUv(170)) < 1e-3);
  assert.ok(Math.abs(trough(near1, 20) - 120) < 1e-3 && Math.abs(trough(near1, 10) - ampAtUv(170)) < 1e-3);
  assert.equal(distUm([30, 0, 0], cells[1]), 170);
  // the same stretch asked for in two pieces is the same numbers
  const whole = at([30, 0, 0], false);
  const part = contactTrace({ cells, spikes, placements: [{ atStep: 0, pos: [30, 0, 0] }], seed: 3, slot: 1, fromStep: 300, n: 200, dtMs: LIF_DT_MS });
  assert.deepEqual(Array.from(part), Array.from(whole.subarray(300, 500)));
  // noise: zero mean, unit variance, different per contact
  let m = 0, v = 0; const N = 40000;
  for (let k = 0; k < N; k++) { const x = noiseAt(3, 1, k); m += x; v += x * x; }
  assert.ok(Math.abs(m / N) < 0.02 && Math.abs(v / N - 1) < 0.03, `mean ${m / N} var ${v / N}`);
  assert.notEqual(noiseAt(3, 1, 5), noiseAt(3, 2, 5));
  // nothing is recorded before the contact is placed, and moving it changes later spikes only
  const moved = contactTrace({ cells, spikes, placements: [{ atStep: 300, pos: [30, 0, 0] }], seed: 3, slot: 1, fromStep: 0, n: 800, dtMs: LIF_DT_MS, noNoise: true });
  assert.equal(Math.abs(trough(moved, 10)), 0);
  assert.ok(Math.abs(trough(moved, 20) - ampAtUv(170)) < 1e-3);
  // the detector finds the big spike and reports its depth
  const ev = detect(whole);
  assert.ok(ev.some((e) => Math.abs(e.i * LIF_DT_MS - 10) < 0.2 && Math.abs(e.ampUv - 120) < 4 * OBS.noiseUv));
});

test('Instrument-flight field: one driver, a wave that stops when the driver is silenced, and an exact rewind', () => {
  for (const seed of [1, 2, 3]) {
    const { circuit, truth } = fieldCircuit(seed), n = Math.round(600 / circuit.dt);
    const free = simulate(circuit, [], n);
    const drv = free.spikes[truth.driver];
    assert.ok(drv.length >= 12 && drv.length <= 30, `driver fires ${drv.length} times in 600 ms`);
    const iv = drv.slice(1).map((t, i) => t - drv[i]);
    assert.ok(Math.max(...iv) - Math.min(...iv) <= circuit.dt + 1e-9, 'the driver is regular');
    for (const f of truth.followers) assert.ok(Math.abs(free.spikes[f].length - drv.length) <= 1, `follower ${f} follows one for one`);
    // each follower fires AFTER the driver in every wave
    for (const f of truth.followers) assert.ok(free.spikes[f][0] > drv[0]);
    const cut = simulate(circuit, [{ seq: 0, atStep: 0, kind: 'cell-on', target: circuit.cells[truth.driver].id, value: 0 }], n);
    assert.equal(cut.spikes[truth.driver].length, 0);
    for (const f of truth.followers) assert.equal(cut.spikes[f].length, 0, 'no driver, no wave');
    for (const i of truth.independents) assert.deepEqual(cut.spikes[i], free.spikes[i], 'independent cells do not care');
    // silencing a follower stops at most its own branch
    const mid = simulate(circuit, [{ seq: 0, atStep: 0, kind: 'cell-on', target: circuit.cells[truth.followers[0]].id, value: 0 }], n);
    assert.equal(mid.spikes[truth.driver].length, drv.length);
  }
  assert.notEqual(fieldCircuit(1).truth.driver === fieldCircuit(4).truth.driver && fieldCircuit(1).truth.driver === fieldCircuit(5).truth.driver, true, 'the driver depends on the seed');
});

test('live field run: camera-free by construction; rewind replays the same spikes; a command while replaying starts a child run; export → import matches', () => {
  const run = new FieldRun(2);
  run.advanceTo(3000);
  run.place(1, [0, 0, 0]);
  run.advanceTo(5000);
  const victim = run.circuit.cells[run.truth.driver].id;
  run.issue('cell-on', victim, 0);
  run.advanceTo(9000);
  const digest = run.digest(), spikes = JSON.stringify(run.spikes), id = run.runId;
  const trace = Array.from(run.trace(1, 1200).uv);
  // go back 250 ms and come forward again: identical
  const back = run.rewind(250);
  assert.ok(back <= 4000 && back % 200 === 0);
  assert.equal(run.replaying, true);
  run.advanceTo(9000);
  assert.equal(run.replaying, false);
  assert.equal(run.digest(), digest);
  assert.equal(JSON.stringify(run.spikes), spikes);
  assert.deepEqual(Array.from(run.trace(1, 1200).uv), trace);
  assert.equal(run.runId, id, 'watching the past again is the same run');
  // export, import, compare
  const x = JSON.parse(JSON.stringify(run.export()));
  const again = FieldRun.import(x);
  assert.equal(again.matches, true);
  assert.equal(again.run.silenced(run.truth.driver), true);
  x.commands[0].value = 1;
  assert.equal(FieldRun.import(x).matches, false, 'a changed command is noticed');
  // a new command during replay: a child run whose later history is gone
  run.rewind(250);
  run.advanceTo(run.step + 100);
  run.issue('cell-on', victim, 1);
  assert.notEqual(run.runId, id);
  assert.equal(run.parentRunId, id);
  assert.equal(run.head, run.step);
  run.advanceTo(9000);
  assert.notEqual(run.digest(), digest);
  // a contact that has not been placed records nothing
  assert.equal(Math.max(...new FieldRun(2).trace(2, 100).uv), -Infinity);
});
