// The Decoder pilot's model: a feature-level surrogate of the motor chain. These tests state how far the surrogate is
// from the full chain it stands in for, and pin down the properties the toy's claims rest on: the cursor is moved by
// the decoder and by nothing else, evaluation data are never fitting data, and a run can be replayed exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PEAK_KEPT, PILOT_BASE, PILOT_DECODERS, PILOT_THRESH_K, PilotSession, detectProb, detectorNoiseUv, falseRateHz, genBin, intentCode, intentOf, phi, scriptedDataset, scriptedIntent,
  type PilotFault,
} from '../src/world/model/pilot.ts';
import { DEFAULT_MOTOR, N_CH, RUN_S, TASK_SEED, simulateMotor, toDataset } from '../src/experiment/model/motor.ts';
import { decoderSpec, runModel, score, type Dataset } from '../src/experiment/model/decoders.ts';

const THR = PILOT_THRESH_K * detectorNoiseUv(PILOT_BASE.noiseUv);
const meanCounts = (d: Dataset) => Array.from({ length: N_CH }, (_, ch) => { let a = 0, n = 0; for (let k = 0; k < d.nBins; k++) if (d.valid[k]) { a += d.counts[k * N_CH + ch]; n++; } return a / n; });
/** An idealised player: pushes toward the target in one of eight directions, slowly when close. */
function play(s: PilotSession, bins: number): { hits: number; misses: number } {
  const h0 = s.hits, m0 = s.misses;
  for (let k = 0; k < bins; k++) {
    const dx = s.target[0] - s.cursor[0], dy = s.target[1] - s.cursor[1], d = Math.hypot(dx, dy);
    s.step(d < 0.1 ? 0 : intentCode(Math.abs(dx) > 0.38 * d ? Math.sign(dx) : 0, Math.abs(dy) > 0.38 * d ? Math.sign(dy) : 0, d < 0.3));
  }
  return { hits: s.hits - h0, misses: s.misses - m0 };
}

test('detector stand-in: probabilities behave, and its noise level and threshold are those of the full chain to within 10 %', () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-7 && Math.abs(phi(1.96) - 0.975) < 1e-4 && Math.abs(phi(-1.96) - 0.025) < 1e-4);
  assert.ok(PEAK_KEPT > 0.2 && PEAK_KEPT < 0.6, `the filters keep ${PEAK_KEPT} of the spike peak`);
  const sigma = detectorNoiseUv(7);
  assert.ok(detectProb(80, THR, sigma) > 0.99 && detectProb(25, THR, sigma) < 0.05, 'near units are counted, far ones are not');
  assert.ok(detectProb(40, THR, sigma) > detectProb(35, THR, sigma));
  assert.ok(falseRateHz(THR, sigma) < 0.2, 'noise alone almost never crosses a 4.5 σ threshold');
  assert.ok(falseRateHz(THR, detectorNoiseUv(17.5)) > 100, 'unless the noise has risen and the threshold has not');
  const full = simulateMotor(DEFAULT_MOTOR, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: 6 });
  for (let ch = 0; ch < N_CH; ch++) {
    assert.ok(Math.abs(sigma / full.sigmaUv[ch] - 1) < 0.1, `σ ${sigma} vs the chain's ${full.sigmaUv[ch]}`);
    assert.ok(Math.abs(THR / full.thresholdUv[ch] - 1) < 0.1, `threshold ${THR} vs the chain's ${full.thresholdUv[ch]}`);
  }
});

test('surrogate vs full chain (criteria fixed beforehand): counts per contact within ±30 %, linear held-out R² within ±0.12', () => {
  const fullTrain = toDataset(simulateMotor(DEFAULT_MOTOR, { mode: 'calibration', taskSeed: TASK_SEED.calibration, durationS: RUN_S.calibration }));
  const fullHeld = toDataset(simulateMotor(DEFAULT_MOTOR, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: RUN_S.heldOut }));
  const thr = new Array<number>(N_CH).fill(THR);
  const surTrain = scriptedDataset(101, 20, PILOT_BASE, thr), surHeld = scriptedDataset(202, 10, PILOT_BASE, thr);
  const mf = meanCounts(fullTrain), ms = meanCounts(surTrain);
  mf.forEach((f, ch) => assert.ok(Math.abs(ms[ch] / f - 1) <= 0.3, `contact ${ch + 1}: surrogate ${ms[ch].toFixed(2)} vs chain ${f.toFixed(2)} counts per bin`));
  const r2 = (train: Dataset, held: Dataset, id: string) => score(runModel(decoderSpec(id).fit(train, 5), held), held).r2;
  const full = r2(fullTrain, fullHeld, 'linear'), sur = r2(surTrain, surHeld, 'linear');
  assert.ok(Math.abs(full - sur) <= 0.12, `linear held-out R²: chain ${full.toFixed(3)}, surrogate ${sur.toFixed(3)}`);
  assert.ok(sur > 0.45 && full > 0.45);
});

test('the population generator is a pure function of (stream, bin); intent codes round-trip', () => {
  const thr = new Array<number>(N_CH).fill(THR), a = new Float32Array(N_CH), b = new Float32Array(N_CH);
  genBin(9, 40, 1, 0, PILOT_BASE, thr, new Float64Array(24).fill(-1), a);
  for (let k = 0; k < 40; k++) genBin(9, k, 0, 1, PILOT_BASE, thr, new Float64Array(24).fill(-1), b);
  genBin(9, 40, 1, 0, PILOT_BASE, thr, new Float64Array(24).fill(-1), b);
  assert.deepEqual(Array.from(a), Array.from(b));
  genBin(10, 40, 1, 0, PILOT_BASE, thr, new Float64Array(24).fill(-1), b);
  assert.notDeepEqual(Array.from(a), Array.from(b));
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (const slow of [false, true]) {
    const v = intentOf(intentCode(x, y, slow)), n = Math.hypot(x, y);
    if (!n) { assert.deepEqual(v, [0, 0]); continue; }
    assert.ok(Math.abs(v[0] - ((slow ? 0.45 : 1) * x) / n) < 1e-9 && Math.abs(v[1] - ((slow ? 0.45 : 1) * y) / n) < 1e-9);
  }
  // the scripted task rests between reaches and goes out and back
  assert.deepEqual(scriptedIntent(3, 0.05), [0, 0]);
  const out = scriptedIntent(3, 0.8), back = scriptedIntent(3, 2.4);
  assert.ok(Math.hypot(...out) > 0.9 && Math.abs(out[0] + back[0]) < 1e-9 && Math.abs(out[1] + back[1]) < 1e-9);
});

test('the cursor is moved by the decoder and by nothing else', () => {
  // no decoder fitted: whatever is intended, the cursor does not move (the ghost does)
  const raw = new PilotSession(7);
  for (let k = 0; k < 40; k++) raw.step(1);
  assert.deepEqual(raw.cursor, [0, 0]);
  assert.ok(raw.ghost[0] > 1);
  // every contact lost: the decoder sees the same zeros whatever is intended, so two different intents give one path
  const path = (code: number) => { const s = new PilotSession(7); s.calibrate(); s.cond = { ...s.cond, lost: [0, 1, 2, 3, 4, 5, 6, 7] }; const p: number[] = []; for (let k = 0; k < 60; k++) p.push(...s.step(code).cursor); return p; };
  assert.deepEqual(path(1), path(5));
  // contacts working: opposite intents take the cursor to opposite sides, and decoded ≠ intended
  const go = (code: number) => { const s = new PilotSession(7); s.calibrate(); let snap = s.step(code); for (let k = 0; k < 30; k++) snap = s.step(code); return snap; };
  const east = go(1), west = go(5);
  assert.ok(east.cursor[0] > 0.4 && west.cursor[0] < -0.4, `${east.cursor[0]} / ${west.cursor[0]}`);
  assert.notDeepEqual(east.decoded, east.intent);
  assert.ok(Number.isNaN(east.fit), 'a constant intent has no variance to explain');
  // steering in changing directions: the fit is good; with every contact lost it is not
  const wiggle = (lost: boolean) => { const s = new PilotSession(7); s.calibrate(); if (lost) s.cond = { ...s.cond, lost: [0, 1, 2, 3, 4, 5, 6, 7] }; let snap = s.step(0); for (let k = 0; k < 200; k++) snap = s.step(1 + (Math.floor(k / 12) % 8)); return snap.fit; };
  assert.ok(wiggle(false) > 0.3 && wiggle(true) < 0.05, `fit ${wiggle(false)} with contacts, ${wiggle(true)} without`);
});

test('calibration: fitting, held-out and evaluation data come from three different seeds; a stopped calibration changes nothing', () => {
  const s = new PilotSession(7);
  const g = s.calibrateSteps();
  g.next(); g.next(); g.next();          // stop while the first decoder is being fitted
  assert.equal(s.calibration, null);
  for (let k = 0; k < 10; k++) s.step(1);
  assert.deepEqual(s.cursor, [0, 0], 'no decoder was put in place');
  const c = s.calibrate();
  assert.ok(new Set([c.trainSeed, c.heldOutSeed, s.evaluation!.evalSeed]).size === 3);
  assert.equal(c.trainBins, 20 * 32 - 10);
  assert.equal(c.heldOutBins, 10 * 32 - 10);
  for (const d of PILOT_DECODERS) assert.ok(c.scores[d].r2 > 0.45 && c.scores[d].r2 < 0.85, `${d} held-out R² ${c.scores[d].r2}`);
  const e1 = s.evaluation!, e2 = s.evaluate()!;
  assert.notEqual(e1.evalSeed, e2.evalSeed, 'every evaluation draws fresh reaches');
  assert.ok(Math.abs(e1.scores.linear.r2 - e2.scores.linear.r2) < 0.15);
  assert.deepEqual(c.thresholdsUv, new Array(N_CH).fill(THR));
});

test('three ways to break the loop, and two ways back that the model supports', () => {
  const after = (f: PilotFault, dec: 'linear' | 'kalman') => { const s = new PilotSession(7); s.calibrate(); s.setDecoder(dec); const base = play(s, 600).hits; s.fault(f); const now = s.evaluation!.scores; const broken = play(s, 600).hits; return { s, base, broken, now }; };
  // lost contacts: the Kalman filter keeps working where the linear decoder does not — switching decoder is a way back
  const lostLin = after('lost', 'linear'), lostKal = after('lost', 'kalman');
  assert.ok(lostLin.base >= 15 && lostLin.broken <= lostLin.base / 3, `linear ${lostLin.base} → ${lostLin.broken} targets`);
  assert.ok(lostKal.broken >= lostKal.base / 2, `Kalman ${lostKal.base} → ${lostKal.broken} targets`);
  assert.ok(lostLin.now.kalman.r2 > lostLin.now.linear.r2 + 0.1, 'and the evaluation says so before anyone tries');
  // … and recalibrating on the remaining contacts is the other
  lostLin.s.calibrate();
  assert.ok(play(lostLin.s, 600).hits >= lostLin.base * 0.8);
  assert.deepEqual(lostLin.s.calibration!.cond.lost, [0, 3, 5]);
  // drift: recalibration restores the held-out score
  const drift = after('drift', 'linear');
  assert.ok(drift.now.linear.r2 < drift.s.calibration!.scores.linear.r2 - 0.15);
  const before = drift.s.calibration!.scores.linear.r2;
  drift.s.calibrate();
  assert.ok(drift.s.calibration!.scores.linear.r2 > before - 0.1);
  // noise: the fixed thresholds let noise through; recalibration helps but cannot bring back what the noise buried
  const noise = after('noise', 'linear');
  assert.ok(noise.now.linear.r2 < 0 && noise.broken <= 2, `R² ${noise.now.linear.r2}, ${noise.broken} targets`);
  noise.s.calibrate();
  const rec = noise.s.calibration!.scores.linear.r2;
  assert.ok(rec > 0.1 && rec < before - 0.15, `recalibrated under noise: R² ${rec}`);
  assert.ok(noise.s.calibration!.thresholdsUv[0] > THR * 2, 'the thresholds were re-estimated');
});

test('a pilot run exports and replays exactly, calibrations and faults included', () => {
  const s = new PilotSession(11);
  s.calibrate(); play(s, 200);
  s.fault('lost'); play(s, 120);
  s.setDecoder('kalman'); play(s, 120);
  s.calibrate(); s.centre(); play(s, 100);
  const x = JSON.parse(JSON.stringify(s.export()));
  assert.equal(x.bins, 540);
  assert.deepEqual(x.commands.map((c: { kind: string }) => c.kind), ['calibrate', 'fault', 'decoder', 'calibrate', 'centre']);
  const again = PilotSession.import(x);
  assert.equal(again.matches, true);
  assert.deepEqual(again.session.cursor, s.cursor);
  assert.equal(again.session.hits, s.hits);
  x.intents[50] = (x.intents[50] + 1) % 9;
  x.intents[51] = (x.intents[51] + 3) % 9;
  assert.equal(PilotSession.import(x).matches, false);
  assert.throws(() => PilotSession.import({ ...x, modelRevision: 'other' }), /revision/);
});
