// The journey's experiment logic (src/world/model/journey.ts, layout.ts) and the decoder's routing.
// What these tests pin down is what the integrated world claims on screen:
//   · replaying a run is the same run; undo and reset really restore the earlier state;
//   · a comparison differs from its baseline by exactly the declared cause, with the same probe noise;
//   · the explanation of "why T did or did not fire" adds up, because the numbers come from runs;
//   · membrane potential (mV) and probe voltage (µV) are different things with different sizes;
//   · the cursor is moved by the fitted decoder's own terms, and by nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSHOP_MS, defaultSetup, runWorkshop, workshopCommands, workshopCircuit } from '../src/world/model/circuits.ts';
import { applyChange, changesBetween, compareSentence, components, keepAsBaseline, newLab, outcomeSentence, probeRecording, probeSentence, toBaseline, undo, whySentence, whyTarget } from '../src/world/model/journey.ts';
import { ARRAY_PITCH_UM, ARRAY_TIPS, BLOCK, HOME, PROBE_AXIS, PROBE_TIP, UNIT_POS, arrayView, minSomaGap, probeAmplitudes } from '../src/world/model/layout.ts';
import { OBS, distUm } from '../src/world/model/observe.ts';
import { PILOT_UNITS, PilotSession, intentCode } from '../src/world/model/pilot.ts';
import { VMAX, BIN_MS } from '../src/experiment/model/motor.ts';
import { makeRun } from '../src/world/model/workshopRun.ts';

test('layout: only the target cell is large at the probe; every unit sits at its model’s own distance from its own tip', () => {
  const a = probeAmplitudes(0), thr = OBS.threshK * OBS.noiseUv;
  assert.ok(a.T > 3 * thr, `T is ${a.T.toFixed(0)} µV at the probe, well above the ${thr} µV threshold`);
  for (const id of ['A', 'B', 'I', 'D']) assert.ok(a[id] < thr - 1.5 * OBS.noiseUv, `${id} is ${a[id].toFixed(1)} µV: at least 1.5 σ below the threshold`);
  PILOT_UNITS.forEach((u, i) => {
    assert.ok(Math.abs(distUm(UNIT_POS[i], ARRAY_TIPS[u.ch]) - u.dist0Um) < 1e-9, 'drawn distance = model distance');
    // the population model counts a unit only at its own contact: the drawing must not put a counted unit nearer another tip
    if (u.rank === 0) ARRAY_TIPS.forEach((t, ch) => { if (ch !== u.ch) assert.ok(distUm(UNIT_POS[i], t) > u.dist0Um, `unit ${i} is nearest its own tip`); });
  });
  assert.equal(ARRAY_TIPS.length, 8);
  assert.ok(Math.abs(distUm(ARRAY_TIPS[0], ARRAY_TIPS[1]) - ARRAY_PITCH_UM) < 1e-9);
  assert.ok(minSomaGap() > 22, `no two bodies overlap (closest pair ${minSomaGap().toFixed(1)} µm apart)`);
  // the probe's shank does not run through a cell body
  for (const c of workshopCircuit(0).cells) {
    const d = [c.pos[0] - PROBE_TIP[0], c.pos[1] - PROBE_TIP[1], c.pos[2] - PROBE_TIP[2]], t = Math.max(0, d[0] * PROBE_AXIS[0] + d[1] * PROBE_AXIS[1] + d[2] * PROBE_AXIS[2]);
    assert.ok(Math.hypot(d[0] - t * PROBE_AXIS[0], d[1] - t * PROBE_AXIS[1], d[2] - t * PROBE_AXIS[2]) > 22, `${c.id} is clear of the probe`);
  }
  // everything, and both working views, lie inside the block the rig may fly in
  const inside = (p: readonly number[]) => p.every((v, k) => v > BLOCK.min[k] && v < BLOCK.max[k]);
  assert.ok([...UNIT_POS, ...ARRAY_TIPS, HOME.pos, PROBE_TIP].every(inside));
  for (const [aspect, covered] of [[1.6, 0.2], [1.25, 0.3], [2.2, 0]] as const) assert.ok(inside(arrayView(aspect, (58 * Math.PI) / 180, covered).pos), `array view at aspect ${aspect}`);
});

test('replay: the same causes give the same run, bit for bit; nothing about a run depends on how often it was asked for', () => {
  const s = { ...defaultSetup(0), bMs: 14 };
  const a = makeRun(s), b = makeRun(s);
  assert.equal(a.digest, b.digest);
  assert.deepEqual(Array.from(a.run.v[3]), Array.from(b.run.v[3]));
  assert.deepEqual(a.run.spikes, b.run.spikes);
  const pa = probeRecording(a.run, PROBE_TIP), pb = probeRecording(b.run, PROBE_TIP);
  assert.deepEqual(Array.from(pa.trace), Array.from(pb.trace), 'the probe recording of a replay is identical, noise included');
  assert.equal(a.run.nSteps, Math.round(WORKSHOP_MS / a.run.dt));
});

test('intervention: moving B 8 ms earlier is ONE declared change, and it is what makes the target fire', () => {
  let lab = newLab(0);
  assert.equal(lab.result.firedMs, null, 'as found (B 12 ms after A) the target stays silent');
  assert.equal(changesBetween(lab.baseline.recipe.parameters, lab.setup).length, 0);
  lab = applyChange(lab, { bMs: 14 });
  const ch = changesBetween(lab.baseline.recipe.parameters, lab.setup);
  assert.deepEqual(ch.map((c) => c.key), ['bMs']);
  assert.equal(ch[0].from, '22 ms'); assert.equal(ch[0].to, '14 ms');
  assert.ok(lab.result.firedMs != null && lab.result.followerMs != null && lab.result.followerMs > lab.result.firedMs, 'T fires and D follows it');
  // the two command logs differ in that one pulse time and nothing else
  const c = workshopCircuit(0), k0 = workshopCommands(c, lab.baseline.recipe.parameters), k1 = workshopCommands(c, lab.setup);
  assert.equal(k0.length, k1.length);
  const diff = k0.filter((x, i) => JSON.stringify([x.kind, x.target, x.value, x.atStep]) !== JSON.stringify([k1[i].kind, k1[i].target, k1[i].value, k1[i].atStep]));
  assert.equal(diff.length, 1); assert.equal(diff[0].target, 'inB');
  assert.equal(lab.result.recipe.parentRunId, lab.baseline.recipe.runId);
  assert.match(compareSentence(lab), /when input b fires \(22 ms → 14 ms\).*stayed .* short; now it fires/);
  assert.equal(applyChange(lab, { bMs: 14 }), lab, 'asking for the value it already has is not a new run');
});

test('same seed: baseline and changed run share the probe’s noise sample by sample — the difference between them is spikes only', () => {
  const base = makeRun(defaultSetup(0)), moved = makeRun({ ...defaultSetup(0), bMs: 14 });
  const p0 = probeRecording(base.run, PROBE_TIP), p1 = probeRecording(moved.run, PROBE_TIP);
  // before either run's second input, nothing differs between them at all
  const until = Math.floor(14 / base.run.dt) - 40;
  for (let i = 0; i < until; i++) assert.equal(p0.trace[i], p1.trace[i]);
  // with the same spikes removed, what is left is the same noise
  const quiet = makeRun({ ...defaultSetup(0), aMs: null, bMs: null });
  const n = probeRecording(quiet.run, PROBE_TIP).trace;
  let sum = 0, sq = 0;
  for (const v of n) { sum += v; sq += v * v; }
  assert.ok(Math.abs(sum / n.length) < 0.6 && Math.abs(Math.sqrt(sq / n.length) - OBS.noiseUv) < 0.5, 'noise alone: zero mean, 6 µV rms');
  assert.equal(probeRecording(quiet.run, PROBE_TIP).events.length, 0, 'noise alone does not cross the threshold in this stretch');
});

test('membrane potential and probe voltage are different quantities: millivolts inside one cell, microvolts outside all of them', () => {
  const fired = makeRun({ ...defaultSetup(0), bMs: 14 }), p = probeRecording(fired.run, PROBE_TIP), t = fired.run.circuit.cells.findIndex((c) => c.id === 'T');
  const swing = Math.max(...fired.run.v[t]) - Math.min(...fired.run.v[t]);
  assert.ok(swing > 10 && swing < 40, `T’s membrane potential moves by ${swing.toFixed(1)} mV`);
  const big = p.events.filter((e) => e.cell === 'T');
  assert.equal(big.length, 1, 'the probe counts T’s spike once');
  assert.ok(Math.abs(big[0].ms - fired.firedMs!) < 0.3, 'at the time the model says T fired');
  assert.ok(big[0].ampUv > 80 && big[0].ampUv < 140, `${big[0].ampUv.toFixed(0)} µV: about a thousandth of a millivolt-scale membrane event`);
  assert.match(probeSentence(p), /counted \d+ threshold crossing.*T’s spike/);
  // without T's spike the probe has nothing large to count
  const silent = probeRecording(makeRun(defaultSetup(0)).run, PROBE_TIP);
  assert.equal(silent.events.filter((e) => e.cell === 'T').length, 0);
  assert.ok(silent.events.every((e) => e.ampUv < 45), 'whatever it counts without T is small');
});

test('why: the explanation adds up — one-input runs superpose exactly while the target has not fired', () => {
  for (const patch of [{}, { bMs: 14 }, { bMs: 30 }, { conn: { 'I>T': true } }, { conn: { 'I>T': true }, bMs: 7 }]) {
    const r = makeRun({ ...defaultSetup(0), ...patch }), w = whyTarget(r);
    assert.ok(Math.abs(w.residualMv) < 1e-3, `rest + A’s part + B’s part is T’s potential (off by ${w.residualMv} mV)`);
    assert.equal(w.fired, r.firedMs != null);
    if (!w.fired) assert.ok(Math.abs(w.shortMv - (r.thresholdMv - r.peakMv)) < 1e-6);
    else assert.ok(w.vMv <= w.thresholdMv && w.thresholdMv - w.vMv < 3, 'read just before the crossing');
    assert.ok(whySentence(w).length > 40 && outcomeSentence(r).length > 30);
  }
  // as found: A's input has mostly leaked away by the time B's arrives — which is the mechanism the journey teaches
  const w = whyTarget(makeRun(defaultSetup(0)));
  assert.ok(w.peakA.mv > 9 && w.fromA < w.peakA.mv * 0.6, `A peaked at ${w.peakA.mv.toFixed(1)} mV; ${w.fromA.toFixed(1)} mV was left`);
  assert.match(whySentence(w), /leaked away/);
  // with inhibition on, A's own path pulls the target down at the time that matters
  const inh = whyTarget(makeRun({ ...defaultSetup(0), conn: { 'I>T': true }, bMs: 14 }));
  assert.equal(inh.fired, false);
  const c = components({ ...defaultSetup(0), conn: { 'I>T': true }, bMs: 14 });
  assert.equal(c.a.spikes[c.a.circuit.cells.findIndex((x) => x.id === 'I')].length, 1, 'in the A-only run, A makes I fire');
});

test('history: undo returns to the earlier run (same fingerprint); back-to-baseline and reset restore everything', () => {
  let lab = newLab(0);
  const d0 = lab.result.digest;
  lab = applyChange(lab, { bMs: 14 });
  const d1 = lab.result.digest;
  lab = applyChange(lab, { conn: { 'I>T': true } });
  assert.equal(lab.history.length, 3);
  assert.notEqual(lab.result.digest, d1);
  lab = undo(lab);
  assert.equal(lab.result.digest, d1); assert.equal(lab.setup.bMs, 14); assert.deepEqual(lab.setup.conn, {});
  lab = undo(lab);
  assert.equal(lab.result.digest, d0); assert.equal(lab.history.length, 1);
  assert.equal(undo(lab), lab, 'nothing before the first run');
  lab = applyChange(applyChange(lab, { bMs: 9 }), { glT: 1 / 40 });
  lab = toBaseline(lab);
  assert.equal(lab.result.digest, d0, 'the baseline’s causes give the baseline’s result');
  assert.equal(changesBetween(lab.baseline.recipe.parameters, lab.setup).length, 0);
  // a new baseline is compared against from then on
  lab = keepAsBaseline(applyChange(lab, { bMs: 14 }));
  assert.equal(compareSentence(lab), 'This is the baseline run.');
  const fresh = newLab(0);
  assert.equal(fresh.result.digest, d0); assert.equal(fresh.history.length, 1); assert.equal(fresh.baseline.digest, d0);
  // set-ups in the history are copies: changing the lab later does not rewrite the past
  const h = applyChange(newLab(0), { conn: { 'I>T': true } });
  h.setup.conn['I>T'] = false;
  assert.equal(h.history[1].setup.conn['I>T'], true);
});

test('decoder routing: the cursor moves by the active decoder’s own base + terms, bin after bin — for both recovery routes', () => {
  const dtS = BIN_MS / 1000;
  for (const id of ['linear', 'kalman'] as const) {
    const s = new PilotSession(7);
    const still = s.step(intentCode(1, 0, false));
    assert.deepEqual([still.cursor, still.decoded, still.termOf], [[0, 0], [0, 0], 'none'], 'no fitted decoder: the keys move nothing');
    s.calibrate(); s.setDecoder(id);
    let prev: [number, number] = [s.cursor[0], s.cursor[1]], moved = 0;
    for (let k = 0; k < 120; k++) {
      const snap = s.step(intentCode(k % 40 < 20 ? 1 : -1, k % 60 < 30 ? 1 : 0, false));
      assert.equal(snap.termOf, 'channel');
      assert.equal(snap.terms.length, 2); assert.equal(snap.terms[0].length, 8);
      for (let o = 0; o < 2; o++) {
        const sum = snap.terms[o].reduce((a, v) => a + v, snap.base[o]);
        assert.ok(Math.abs(sum - snap.decoded[o]) < 1e-9, `${id}: base + per-contact terms = decoded velocity`);
        const want = Math.max(-1.15, Math.min(1.15, prev[o] + snap.decoded[o] * VMAX * dtS));
        if (!snap.ended) assert.ok(Math.abs(snap.cursor[o] - want) < 1e-9, `${id}: cursor step = decoded velocity × bin`);
      }
      moved += Math.hypot(snap.cursor[0] - prev[0], snap.cursor[1] - prev[1]);
      prev = [snap.cursor[0], snap.cursor[1]];
    }
    assert.ok(moved > 0.5, 'and it did move');
    // a lost contact contributes nothing a spike could have caused: its term no longer varies with the population
    s.fault('lost');
    const a = s.step(intentCode(1, 0, false)), b = s.step(intentCode(-1, 0, false));
    for (const ch of [0, 3, 5]) assert.equal(a.counts[ch] + b.counts[ch], 0, `contact ${ch + 1} delivers no counts`);
  }
});
