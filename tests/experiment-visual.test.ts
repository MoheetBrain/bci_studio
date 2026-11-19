// The visual experiment's model and the decoder comparison. Simulated data throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROADBAND_GAIN, CONTACT_GAIN, DEFAULT_VISUAL, DRIVE, LATENCY_S, VIS_RUN_S, VIS_TASK_SEED, driveShape, fitVisual, schedule, simulateVisual, summariseVisual,
} from '../src/experiment/model/visual.ts';
import { motorSession, visualSession } from '../src/experiment/model/session.ts';
import { accuracyUnder, paretoFront, preferred, runBenchmark, withLostChannels, type BenchResult } from '../src/experiment/model/bench.ts';
import { DEFAULT_MOTOR } from '../src/experiment/model/motor.ts';
import { DECODERS } from '../src/experiment/model/decoders.ts';
import { regionNeighbours, regionVertexCounts } from '../src/atlas/neighbours.ts';
import { halfEdgeAdjacency } from '../src/atlas/surfaceFields.ts';

test('picture schedule: balanced kinds, fixed for a seed; the response starts after the latency and decays after the picture goes', () => {
  const s = schedule(VIS_TASK_SEED.calibration, VIS_RUN_S.calibration);
  assert.deepEqual(s, schedule(VIS_TASK_SEED.calibration, VIS_RUN_S.calibration));
  const objects = s.filter((x) => x.kind === 'object').length;
  assert.ok(Math.abs(objects - (s.length - objects)) <= 1);
  const st = s[0];
  assert.equal(driveShape(st, st.onS + LATENCY_S - 0.001), 0);
  assert.ok(driveShape(st, st.onS + LATENCY_S + 0.1) > 0.8);
  assert.ok(driveShape(st, st.offS + LATENCY_S + 0.3) < 0.02);
  assert.ok(DRIVE.object > DRIVE.scrambled && BROADBAND_GAIN > 0);
});

test('the visual run is deterministic; band power rises under driven contacts and not under an undriven one', () => {
  const p = DEFAULT_VISUAL;
  const cal = simulateVisual(p, { mode: 'calibration', taskSeed: VIS_TASK_SEED.calibration, durationS: VIS_RUN_S.calibration });
  const again = simulateVisual(p, { mode: 'calibration', taskSeed: VIS_TASK_SEED.calibration, durationS: VIS_RUN_S.calibration });
  assert.deepEqual(cal.feat, again.feat);
  const mean = (kind: 'object' | 'scrambled', c: number) => {
    let a = 0, n = 0;
    for (const s of cal.stim) { if (s.kind !== kind) continue; const k = Math.round((s.onS + 0.4) / 0.1); a += cal.feat[k * cal.nCh + c]; n++; }
    return a / n;
  };
  assert.ok(mean('object', 0) > 3, `objects raise contact 1 by ${mean('object', 0).toFixed(1)} dB`);
  assert.ok(mean('object', 0) > mean('scrambled', 0) + 1.5, 'intact objects drive it harder than scrambled pictures (put in by hand)');
  // the barely driven contact changes far less — and what change it shows is the other contacts' activity, carried in
  // by the common average that is subtracted from every contact
  assert.ok(CONTACT_GAIN[7] < 0.1 && mean('object', 7) < 0.4 * mean('object', 0), `barely driven contact: ${mean('object', 7).toFixed(2)} dB vs ${mean('object', 0).toFixed(2)} dB`);
  const plain = simulateVisual({ ...p, car: false, artefact: false }, { mode: 'calibration', taskSeed: VIS_TASK_SEED.calibration, durationS: VIS_RUN_S.calibration });
  let a = 0, n = 0;
  for (const st of plain.stim) { if (st.kind !== 'object') continue; a += plain.feat[Math.round((st.onS + 0.4) / 0.1) * plain.nCh + 7]; n++; }
  // its own gain of 0.05 is worth 20·log10(1 + 1.6 × 0.05) ≈ 0.67 dB; that is all it shows without the common average
  assert.ok(a / n < 1.0 && a / n < mean('object', 7), `without the common average: ${(a / n).toFixed(2)} dB, with it: ${mean('object', 7).toFixed(2)} dB`);
});

test('the classifier reports strong pictures, misses weak ones, raises no false alarms, and cannot tell objects apart', () => {
  const s = visualSession(DEFAULT_VISUAL);
  const m = s.summary;
  assert.equal(m.objectsDetected, m.objectsShown, 'every intact object is detected');
  assert.ok(m.scrambledDetected < m.scrambledShown, 'some scrambled pictures are missed');
  assert.ok(m.falseAlarmBins <= 0.05 * m.quietBins);
  assert.ok(m.kindCorrect >= 0.8 * m.detected);
  assert.ok(m.identityCorrect <= 0.6 * m.objects, `which-object is at chance: ${m.identityCorrect} of ${m.objects}`);
  assert.ok(m.meanDelayS! > LATENCY_S && m.meanDelayS! < 0.6);
  // each probability is a logistic of base + the sum of its terms
  const r = s.run, st = r.steps!;
  for (let k = 30; k < 60; k++) for (let o = 0; o < 2; o++) {
    let z = st.base[k * 2 + o];
    for (let j = 0; j < st.nTerm; j++) z += st.contrib[(k * 2 + o) * st.nTerm + j];
    assert.ok(Math.abs(1 / (1 + Math.exp(-z)) - r.decoded[k * 2 + o]) < 1e-5);
  }
});

test('recording conditions matter: hum without referencing, more noise, DC coupling', () => {
  const base = visualSession(DEFAULT_VISUAL).summary;
  const noCar = visualSession({ ...DEFAULT_VISUAL, car: false }).summary;
  assert.ok(noCar.detected < base.detected, `hum left in: ${noCar.detected} vs ${base.detected}`);
  const noisy = visualSession({ ...DEFAULT_VISUAL, noiseUv: 15 }).summary;
  assert.ok(noisy.detected < base.detected);
  const dc = visualSession({ ...DEFAULT_VISUAL, hpHz: 0 });
  assert.ok(dc.run.focus!.clippedFrac > 0.95);
  assert.equal(dc.summary.detected, 0);
  assert.equal(dc.drifted, true);
  assert.equal(visualSession(DEFAULT_VISUAL).drifted, false);
  // refitting under the changed conditions is a different model
  const refit = fitVisual(simulateVisual({ ...DEFAULT_VISUAL, noiseUv: 15 }, { mode: 'calibration', taskSeed: VIS_TASK_SEED.calibration, durationS: VIS_RUN_S.calibration }));
  assert.notDeepEqual(refit.W, visualSession(DEFAULT_VISUAL).model.W);
  void summariseVisual;
});

test('a motor session carries the run, the three live decoders and their scores; drift is reported and changes the scores', () => {
  const a = motorSession(DEFAULT_MOTOR, 'kalman');
  assert.equal(a.decoderId, 'kalman');
  assert.equal(a.run.decoderId, 'kalman');
  assert.deepEqual(a.decoders.map((d) => d.id), ['linear', 'mlp8', 'kalman']);
  assert.equal(a.drifted, false);
  for (const d of a.decoders) assert.equal(d.heldOutNow.r2, d.heldOut.r2);
  const far = motorSession({ ...DEFAULT_MOTOR, nearUm: 110 }, 'linear');
  assert.equal(far.drifted, true);
  assert.ok(far.decoders[0].heldOutNow.r2 < far.decoders[0].heldOut.r2 - 0.2, 'a decoder used under conditions it was not fitted to does worse');
  assert.ok(far.summary.hits <= a.summary.hits);
  // recalibrating = fitting under the new conditions
  const recal = motorSession({ ...DEFAULT_MOTOR, nearUm: 110 }, 'linear', { ...DEFAULT_MOTOR, nearUm: 110 });
  assert.equal(recal.drifted, false);
  assert.ok(recal.decoders[0].heldOutNow.r2 > far.decoders[0].heldOutNow.r2);
  // the display channel does not change what is recorded
  assert.equal(motorSession({ ...DEFAULT_MOTOR, focusCh: 3 }, 'linear').drifted, false);
});

let BENCH: BenchResult | null = null;
test('decoder comparison: every decoder scored the same way; costs are arithmetic; it is reproducible', () => {
  const steps: number[] = [];
  BENCH = runBenchmark((d) => steps.push(d));
  assert.deepEqual(BENCH.rows.map((r) => r.id), DECODERS.map((d) => d.id));
  assert.ok(steps.length > 5 && steps.every((v, i) => i === 0 || v === steps[i - 1] + 1));
  for (const r of BENCH.rows) {
    assert.equal(r.serialCycles, r.cost.macs + r.cost.nonlin + 2);
    assert.equal(r.memoryBytes, (r.cost.params + r.cost.stateWords) * 2);
    assert.equal(r.noise.find((x) => x.noiseUv === 7)!.r2, r.heldOut.r2, 'the reference condition is the held-out score');
    assert.equal(r.lost[0].r2, r.heldOut.r2);
    assert.ok(r.noise.at(-1)!.r2 < r.heldOut.r2 - 0.3, `${r.id} degrades with four times the noise`);
    assert.ok(r.closed.trials > 0);
  }
  const lin = BENCH.rows.find((r) => r.id === 'linear')!;
  assert.equal(lin.serialCycles, 18, 'the 8 → 2 linear decoder: 16 multiply–accumulates + 2');
  const again = runBenchmark();
  assert.deepEqual(again.rows.map((r) => r.heldOut.r2), BENCH.rows.map((r) => r.heldOut.r2));
});

test('changing a constraint changes which decoder is preferred, and the reason is stated', () => {
  const rows = BENCH!.rows;
  const open = { noiseUv: 7, lost: 0, maxCycles: 400, maxBytes: 1000, maxLagMs: 400 };
  const a = preferred(rows, open), b = preferred(rows, { ...open, maxCycles: 30 });
  assert.ok(a.row && b.row);
  assert.equal(a.row!.id, rows.reduce((x, r) => (r.heldOut.r2 > x.heldOut.r2 ? r : x), rows[0]).id, 'with no binding budget the most accurate wins');
  assert.notEqual(a.row!.id, b.row!.id, 'a tight compute budget changes the answer');
  assert.ok(b.row!.serialCycles <= 30);
  assert.ok(b.why.has(a.row!.id) && /cycles/.test(b.why.get(a.row!.id)!));
  const c = preferred(rows, { ...open, maxCycles: 30, lost: 4 });
  assert.ok(c.row && accuracyUnder(c.row, { ...open, lost: 4 }) >= accuracyUnder(b.row!, { ...open, lost: 4 }));
  assert.equal(preferred(rows, { ...open, maxCycles: 5 }).row, null);
  const front = paretoFront(rows, (r) => r.heldOut.r2, (r) => r.serialCycles);
  assert.ok(front.has(rows.find((r) => r.id === 'linear')!), 'the cheapest decoder is always on the frontier');
  assert.ok(!front.has(rows.find((r) => r.id === 'mlp32')!), 'the largest network is dominated on this task');
  const d = withLostChannels({ nCh: 8, nOut: 2, nBins: 1, binMs: 50, counts: new Float32Array(8).fill(1), rates: new Float32Array(8).fill(1), target: new Float32Array(2), valid: new Uint8Array([1]) }, 2);
  assert.deepEqual(Array.from(d.counts), [1, 0, 1, 0, 1, 1, 1, 1]);
});

test('region neighbours are read from vertex labels and mesh edges', () => {
  // a strip of four triangles: vertices 0,1 in region 1; 2,3 in region 2; 4,5 in region 3
  const index = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4];
  const region = Uint8Array.from([1, 1, 2, 2, 3, 3]);
  // the test strip is open, so make the adjacency symmetric by listing both windings
  const adj = halfEdgeAdjacency(6, [...index, ...index.map((_, i) => index[i - (i % 3) + (2 - (i % 3))])]);
  const nb = regionNeighbours(region, adj);
  assert.deepEqual(nb.get(1)!.map((n) => n.region), [2]);
  assert.deepEqual(nb.get(2)!.map((n) => n.region).sort(), [1, 3]);
  assert.equal(nb.get(1)!.some((n) => n.region === 3), false, 'regions 1 and 3 do not touch');
  assert.deepEqual(Array.from(regionVertexCounts(region).subarray(0, 4)), [0, 2, 2, 2]);
});
