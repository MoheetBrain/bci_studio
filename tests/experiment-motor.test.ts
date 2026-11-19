// The motor experiment's model: spike template, recording chain, detector, decoders and the closed loop.
// Everything here is simulated; the tests pin down that the simulation does what its documentation says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasFrequency, butterLP2, biquadMag, codeBits, lsbOf, madSigma, quantise, solve } from '../src/experiment/model/dsp.ts';
import { spikeTemplate } from '../src/experiment/model/template.ts';
import {
  BIN_MS, CAL_S, DEFAULT_MOTOR, GRID_HZ, N_CH, NEAR0_UM, REF_AMP_UV, REF_DIST_UM, RUN_S, TASK_SEED, UNITS_PER_CH,
  layoutUnits, simulateMotor, summariseClosed, toDataset, unitAmpUv, unitRate, type MotorRun,
} from '../src/experiment/model/motor.ts';
import { DECODERS, decoderSpec, runModel, score, type Model } from '../src/experiment/model/decoders.ts';

const cal = (p = DEFAULT_MOTOR, record = false) => simulateMotor(p, { mode: 'calibration', taskSeed: TASK_SEED.calibration, durationS: RUN_S.calibration }, record);
const short = (p = DEFAULT_MOTOR, record = false) => simulateMotor(p, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: 6 }, record);
const nearEvents = (r: MotorRun) => { let n = 0; for (let e = 0; e < r.events.n; e++) if (r.events.unit[e] >= 0 && r.units[r.events.unit[e]].rank === 0) n++; return n; };
let CAL: MotorRun | null = null, MODELS: Record<string, Model> | null = null;
const calOnce = () => (CAL ??= cal());
const modelsOnce = () => (MODELS ??= Object.fromEntries(DECODERS.map((d) => [d.id, d.fit(toDataset(calOnce()), 5)])));

test('dsp blocks: quantiser, codes, alias folding, filter gain, robust sigma, linear solve', () => {
  assert.equal(quantise(0.5, 8, 1), 64);
  assert.equal(quantise(2, 8, 1), 127);
  assert.equal(quantise(-2, 8, 1), -128);
  assert.equal(lsbOf(12, 1), 1 / 2048);
  assert.equal(codeBits(-1, 8), '11111111');
  assert.equal(codeBits(5, 8), '00000101');
  assert.equal(aliasFrequency(7000, 10000), 3000);
  assert.equal(aliasFrequency(4000, 10000), 4000);
  const lp = butterLP2(1000, 30000);
  assert.ok(Math.abs(biquadMag(lp, 1000, 30000) - Math.SQRT1_2) < 0.01, '−3 dB at the corner');
  assert.ok(biquadMag(lp, 10, 30000) > 0.999 && biquadMag(lp, 10000, 30000) < 0.02);
  const x = Float32Array.from({ length: 20001 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
  assert.ok(madSigma(x) > 0);
  assert.deepEqual(solve([[2, 0], [0, 4]], [[2], [4]]).map((r) => Math.round(r[0] * 1e9) / 1e9), [1, 1]);
});

test('the spike template is one Hodgkin–Huxley action potential, and the extracellular shape is its negative derivative', () => {
  const t = spikeTemplate(GRID_HZ);
  const peak = Math.max(...t.vmMv);
  assert.ok(peak > 90 && peak < 120, `action potential rises ${peak.toFixed(1)} mV above rest`);
  assert.ok(Math.abs(Math.min(...t.ec) + 1) < 1e-6, 'unit negative peak');
  assert.ok(Math.max(...t.ec) > 0.1 && Math.max(...t.ec) < 0.6, 'a smaller positive phase follows');
  assert.equal(t.ec[t.ecPeak], Math.min(...t.ec));
  assert.ok(Math.abs(t.ec[t.ec.length - 1]) < 1e-3, 'returns to zero');
  // the negative extracellular peak coincides with the steepest rise of the membrane potential
  let steep = 0, at = 0;
  for (let i = 1; i < t.vmMv.length; i++) { const d = t.vmMv[i] - t.vmMv[i - 1]; if (d > steep) { steep = d; at = i; } }
  assert.ok(Math.abs(at - t.ecPeak) <= 2);
});

test('units: fixed layout, cosine tuning with a speed term, 1 / distance amplitude', () => {
  const u = layoutUnits();
  assert.equal(u.length, N_CH * UNITS_PER_CH);
  assert.deepEqual(layoutUnits(), u, 'same tissue every time');
  const a = u[0];
  const along = unitRate(a, Math.cos(a.prefRad), Math.sin(a.prefRad)), against = unitRate(a, -Math.cos(a.prefRad), -Math.sin(a.prefRad));
  assert.ok(Math.abs(along - (a.baseHz + a.speedHz + a.modHz)) < 1e-9);
  assert.ok(Math.abs(against - Math.max(0, a.baseHz + a.speedHz - a.modHz)) < 1e-9);
  assert.equal(unitRate(a, 0, 0), a.baseHz);
  assert.ok(Math.abs(unitAmpUv(a, NEAR0_UM) - (REF_AMP_UV * REF_DIST_UM) / a.dist0Um) < 1e-9);
  assert.ok(unitAmpUv(a, NEAR0_UM + 60) < unitAmpUv(a, NEAR0_UM) * 0.6);
});

test('a run is deterministic, and the seed changes it', () => {
  const a = short(), b = short(), c = short({ ...DEFAULT_MOTOR, seed: 12 });
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(a.events.t, b.events.t);
  assert.notDeepEqual(a.counts, c.counts);
  assert.equal(a.nBins, 6000 / BIN_MS);
});

test('counts are exactly the threshold crossings, and nothing is detected before the noise estimate exists', () => {
  const r = short(DEFAULT_MOTOR, true);
  const recount = new Float32Array(r.nBins * N_CH);
  for (let e = 0; e < r.events.n; e++) { assert.ok(r.events.t[e] >= CAL_S); recount[Math.floor((r.events.t[e] * 1000) / BIN_MS + 1e-6) * N_CH + r.events.ch[e]]++; }
  assert.deepEqual(recount, r.counts);
  // every crossing on the recorded channel is a downward crossing of that channel's threshold in the stored trace
  const f = r.focus!;
  let checked = 0;
  for (let e = 0; e < r.events.n; e++) {
    if (r.events.ch[e] !== f.ch) continue;
    const s = Math.round(r.events.t[e] * f.fsHz);
    assert.ok(f.outUv[s] < -r.thresholdUv[f.ch] && f.outUv[s - 1] >= -r.thresholdUv[f.ch]);
    checked++;
  }
  assert.ok(checked > 20);
  assert.ok(Math.abs(r.thresholdUv[0] - DEFAULT_MOTOR.threshK * r.sigmaUv[0]) < 1e-4);
});

test('the detector finds the near neurons at the reference placement and loses them as the electrode moves away', () => {
  const ref = short(), far = short({ ...DEFAULT_MOTOR, nearUm: 150 });
  const trueNear = ref.units.filter((u) => u.rank === 0).reduce((a, u) => a + ref.spikeT[u.id].filter((t) => t >= CAL_S).length, 0);
  assert.ok(nearEvents(ref) > 0.85 * trueNear, `${nearEvents(ref)} of ${trueNear} near spikes detected`);
  assert.ok(nearEvents(far) < 0.35 * nearEvents(ref), `far: ${nearEvents(far)} vs ${nearEvents(ref)}`);
  // the neurons themselves fired the same spikes: only the recording changed
  assert.deepEqual(ref.spikeT[0], far.spikeT[0]);
});

test('more noise raises the noise estimate in proportion and hides spikes', () => {
  const a = short(), b = short({ ...DEFAULT_MOTOR, noiseUv: 21 });
  const ratio = b.sigmaUv[0] / a.sigmaUv[0];
  assert.ok(ratio > 2.2 && ratio < 3.4, `sigma ratio ${ratio.toFixed(2)} for 3× the noise`);
  assert.ok(nearEvents(b) < 0.75 * nearEvents(a));
});

test('front end and converter limits: DC coupling saturates, few bits lose the spikes, a slow converter loses them too', () => {
  const dc = short({ ...DEFAULT_MOTOR, hpHz: 0 }, true);
  assert.ok(dc.focus!.clippedFrac > 0.95, 'the electrode offset times the gain exceeds the amplifier’s swing');
  assert.equal(dc.events.n, 0);
  const ok = short(DEFAULT_MOTOR, true);
  assert.ok(ok.focus!.clippedFrac < 0.001);
  // 4 bits: one step is 125 mV at the converter, i.e. 250 µV at the electrode — an 80 µV spike rounds to zero
  const coarse = short({ ...DEFAULT_MOTOR, bits: 4 });
  assert.ok(nearEvents(coarse) < 0.3 * nearEvents(ok), `4 bit: ${nearEvents(coarse)} vs ${nearEvents(ok)}`);
  const slow = short({ ...DEFAULT_MOTOR, fsHz: 2000 });
  assert.ok(nearEvents(slow) < 0.8 * nearEvents(ok), `2 kS/s: ${nearEvents(slow)} vs ${nearEvents(ok)}`);
});

test('common-mode transients cause false detections on every contact unless the common average is removed', () => {
  const withCar = short({ ...DEFAULT_MOTOR, artefact: true, car: true }), noCar = short({ ...DEFAULT_MOTOR, artefact: true, car: false });
  const near = (r: MotorRun, t: number) => { const s = new Set<number>(); for (let e = 0; e < r.events.n; e++) if (r.events.unit[e] < 0 && Math.abs(r.events.t[e] - t - 0.0006) < 0.0012) s.add(r.events.ch[e]); return s.size; };
  assert.ok(noCar.artefactT.length >= 3);
  const hitNo = noCar.artefactT.reduce((a, t) => a + near(noCar, t), 0), hitCar = withCar.artefactT.reduce((a, t) => a + near(withCar, t), 0);
  assert.ok(hitNo >= noCar.artefactT.length * 6, `without CAR: ${hitNo} false crossings over ${noCar.artefactT.length} transients`);
  assert.ok(hitCar <= hitNo * 0.15, `with CAR: ${hitCar}`);
  assert.equal(short({ ...DEFAULT_MOTOR, artefact: false }).artefactT.length, 0);
});

test('decoders: fitted on calibration, scored on a run they never saw; costs are what the arithmetic says', () => {
  const m = modelsOnce();
  const held = toDataset(simulateMotor(DEFAULT_MOTOR, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: RUN_S.heldOut }));
  const r2 = Object.fromEntries(Object.entries(m).map(([id, mod]) => [id, score(runModel(mod, held), held).r2]));
  for (const [id, v] of Object.entries(r2)) assert.ok(v > 0.4 && v < 0.95, `${id}: held-out R² ${v.toFixed(3)}`);
  assert.deepEqual(m.linear.cost, { macs: 16, nonlin: 0, params: 34, stateWords: 0, historyBins: 0 });
  assert.equal(m.mlp8.cost.macs, 8 * 8 + 8 * 2);
  assert.equal(m.mlp8.cost.nonlin, 8);
  assert.equal(m.kalman.cost.macs, 2 * 2 + 2 * 8);
  assert.equal(m.kalman.cost.stateWords, 2);
  assert.equal(m.wiener5.cost.historyBins, 4);
  // fitting is deterministic
  assert.deepEqual(decoderSpec('mlp8').fit(toDataset(calOnce()), 5).view, m.mlp8.view);
  // every output is base + the sum of its terms
  for (const mod of Object.values(m)) {
    const s = mod.init();
    for (let k = 40; k < 60; k++) {
      const o = mod.step(s, { counts: held.counts.subarray(k * 8, k * 8 + 8), rates: held.rates.subarray(k * 8, k * 8 + 8) });
      for (let j = 0; j < 2; j++) assert.ok(Math.abs(o.y[j] - (o.base[j] + o.contrib[j].reduce((a, v) => a + v, 0))) < 1e-9, `${mod.id} output ${j}`);
    }
  }
});

test('closed loop: the decoded velocity moves the cursor to the targets, and every decoded value can be taken apart', () => {
  const m = modelsOnce();
  const r = simulateMotor(DEFAULT_MOTOR, { mode: 'closed', taskSeed: TASK_SEED.closed, durationS: RUN_S.closed, model: m.linear }, true);
  const s = summariseClosed(r);
  assert.ok(s.hits >= 5 && s.hits === s.trials, `${s.hits} of ${s.trials} targets reached`);
  assert.ok(s.meanTimeS! > 0.5 && s.meanTimeS! < 3.5);
  const st = r.steps!;
  assert.equal(st.contribOf, 'channel');
  for (let k = 0; k < r.nBins; k++) {
    if (!r.valid[k]) { assert.equal(r.decoded[k * 2], 0); continue; }
    for (let o = 0; o < 2; o++) {
      let sum = st.base[k * 2 + o];
      for (let j = 0; j < st.nTerm; j++) sum += st.contrib[(k * 2 + o) * st.nTerm + j];
      assert.ok(Math.abs(sum - r.decoded[k * 2 + o]) < 1e-5);
    }
  }
  // a run without a working detector goes nowhere
  const dead = simulateMotor({ ...DEFAULT_MOTOR, hpHz: 0 }, { mode: 'closed', taskSeed: TASK_SEED.closed, durationS: RUN_S.closed, model: m.linear });
  assert.ok(summariseClosed(dead).hits < s.hits);
});
