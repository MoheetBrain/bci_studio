// The Hodgkin–Huxley membrane model (src/neuro/model/hh.ts) against its textbook behaviour, and the electrode
// teaching model built on it (src/neuro/model/column.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firingRateHz, HH, rates, sampleAt, simulateHH, steady } from '../src/neuro/model/hh.ts';
import { load } from './helpers/bundle.ts';

// column.ts reuses the Signal scene's spike template, which lives in a bundler-style module
const { amplitudeUv, axonPulses, buildColumn, DEFAULT_COLUMN, layoutCells, NOISE_RMS_UV } = await load<typeof import('../src/neuro/model/column.ts')>('src/neuro/model/column.ts');

const run = (I: number, T = 120) => simulateHH({ currentUaCm2: I, onMs: 10, offMs: T - 15, durationMs: T });

test('at rest nothing happens: the membrane stays at −65 mV and the gates at their steady state', () => {
  const r = run(0);
  assert.equal(r.spikesMs.length, 0);
  for (let i = 0; i < r.v.length; i += 50) assert.ok(Math.abs(r.v[i] - HH.rest) < 0.05, `v = ${r.v[i]} at sample ${i}`);
  const s = steady(HH.rest);
  // textbook resting values
  assert.ok(Math.abs(s.m - 0.0529) < 0.001 && Math.abs(s.h - 0.5961) < 0.001 && Math.abs(s.n - 0.3177) < 0.001, JSON.stringify(s));
  // the leak reversal makes the net current at rest zero
  const net = HH.gNa * s.m ** 3 * s.h * (HH.rest - HH.ENa) + HH.gK * s.n ** 4 * (HH.rest - HH.EK) + HH.gL * (HH.rest - HH.EL);
  assert.ok(Math.abs(net) < 0.01, `net resting current ${net}`);
});

test('rate functions are finite and continuous at their removable singularities', () => {
  for (const v of [-40, -55]) {
    const a = rates(v - 1e-7), b = rates(v), c = rates(v + 1e-7);
    for (const k of ['am', 'an'] as const) { assert.ok(Number.isFinite(b[k])); assert.ok(Math.abs(a[k] - b[k]) < 1e-5 && Math.abs(c[k] - b[k]) < 1e-5); }
  }
  assert.ok(Math.abs(rates(-40).am - 1) < 1e-9);
  assert.ok(Math.abs(rates(-55).an - 0.1) < 1e-9);
});

test('a strong current step produces all-or-nothing action potentials of the textbook size', () => {
  const r = run(10);
  assert.ok(r.spikesMs.length >= 5, `${r.spikesMs.length} spikes`);
  let peak = -Infinity, trough = Infinity;
  for (const v of r.v) { peak = Math.max(peak, v); trough = Math.min(trough, v); }
  assert.ok(peak > 25 && peak < 50, `peak ${peak} mV`);                   // overshoot towards E_Na, never beyond it
  assert.ok(trough < -70 && trough > HH.EK, `trough ${trough} mV`);        // after-hyperpolarisation towards E_K
  for (let i = 0; i < r.v.length; i++) for (const g of [r.m[i], r.h[i], r.n[i]]) assert.ok(g >= 0 && g <= 1);
  // repetitive firing at 10 µA/cm² is close to 70 spikes per second in this model
  const f = firingRateHz(r);
  assert.ok(f > 60 && f < 78, `${f} Hz`);
});

test('threshold behaviour: a weak step gives at most one spike, a stronger one fires repeatedly, and rate grows with current', () => {
  assert.equal(run(1).spikesMs.length, 0);
  assert.ok(run(4).spikesMs.length <= 1, 'below the repetitive-firing threshold');
  const f8 = firingRateHz(run(8, 200)), f12 = firingRateHz(run(12, 200)), f20 = firingRateHz(run(20, 200));
  assert.ok(f8 > 40 && f12 > f8 && f20 > f12, `${f8} < ${f12} < ${f20}`);
});

test('the integration is deterministic and converged', () => {
  const a = run(10), b = run(10);
  assert.deepEqual(a.spikesMs, b.spikesMs);
  assert.deepEqual(Array.from(a.v.subarray(0, 500)), Array.from(b.v.subarray(0, 500)));
  assert.equal(a.perMs, 50);
  assert.equal(a.v.length, 120 * 50 + 1);
  // interpolation between stored samples
  assert.ok(Math.abs(sampleAt(a.v, a.perMs, 0) - HH.rest) < 1e-3);
  assert.ok(Math.abs(sampleAt(a.v, a.perMs, 0.01) - (a.v[0] + a.v[1]) / 2) < 1e-6);
  // out-of-range inputs are clamped rather than propagated
  assert.equal(simulateHH({ currentUaCm2: 1e9, onMs: 0, offMs: 10, durationMs: 50 }).params.currentUaCm2, 30);
  assert.equal(simulateHH({ currentUaCm2: NaN, onMs: 0, offMs: 10, durationMs: NaN }).params.durationMs, 100);
});

test('electrode model: spike size follows the stated 1/distance rule; noise and background units do not depend on it', () => {
  assert.equal(amplitudeUv(30), 120);
  assert.equal(amplitudeUv(60), 60);
  const near = buildColumn({ ...DEFAULT_COLUMN, distanceUm: 30 }), far = buildColumn({ ...DEFAULT_COLUMN, distanceUm: 120 });
  const trough = (a: Float32Array) => { let m = 0; for (const v of a) m = Math.min(m, v); return -m; };
  assert.ok(Math.abs(trough(near.focusUv) - 120) < 1e-3);
  assert.ok(Math.abs(trough(far.focusUv) - 30) < 1e-3);
  assert.ok(Math.abs(near.snr - 120 / NOISE_RMS_UV) < 1e-9 && Math.abs(far.snr - 30 / NOISE_RMS_UV) < 1e-9);
  // the nearest neuron's spikes are the membrane model's, wherever the electrode is
  assert.deepEqual(near.hh.spikesMs, far.hh.spikesMs);
  // the contact trace is reproducible, and its noise has the stated size
  const again = buildColumn({ ...DEFAULT_COLUMN, distanceUm: 30 });
  assert.deepEqual(Array.from(near.electrodeUv.subarray(0, 400)), Array.from(again.electrodeUv.subarray(0, 400)));
  // the noise has the stated size, has no offset, and does not depend on where the electrode is
  let sq = 0, sum = 0;
  for (const v of near.noiseUv) { sq += v * v; sum += v; }
  assert.ok(Math.abs(Math.sqrt(sq / near.noiseUv.length) - NOISE_RMS_UV) < 0.25, `noise rms ${Math.sqrt(sq / near.noiseUv.length)} µV`);
  assert.ok(Math.abs(sum / near.noiseUv.length) < 0.3);
  assert.deepEqual(Array.from(near.noiseUv.subarray(0, 300)), Array.from(far.noiseUv.subarray(0, 300)));
  // with the neuron silent the contact still hears its neighbours
  const quiet = buildColumn({ ...DEFAULT_COLUMN, currentUaCm2: 0 });
  assert.equal(quiet.hh.spikesMs.length, 0);
  assert.ok(quiet.focusUv.every((v) => v === 0));
  let diff = 0;
  for (let i = 0; i < quiet.electrodeUv.length; i++) diff = Math.max(diff, Math.abs(quiet.electrodeUv[i] - quiet.noiseUv[i]));
  assert.ok(diff > 5, 'background units contribute');
});

test('the cell layout is fixed, the focus neuron sits at the origin, and axon pulses run from soma to tip', () => {
  const a = layoutCells(120), b = layoutCells(120);
  assert.deepEqual(a, b);
  assert.deepEqual(a[0].soma, [0, 0, 0]);
  assert.equal(a[0].spikesMs.length, 0);
  assert.ok(a.length >= 8);
  for (const c of a.slice(1)) assert.ok(c.spikesMs.every((t, i, arr) => t >= 0 && t < 120 && (i === 0 || t - arr[i - 1] >= 3)), 'refractory gap');
  assert.deepEqual(axonPulses([10], 400, 9.9), []);
  assert.deepEqual(axonPulses([10], 400, 10), [0]);
  assert.ok(Math.abs(axonPulses([10], 400, 10.5)[0] - 0.5) < 1e-9);
  assert.deepEqual(axonPulses([10], 400, 11.1), []);
});
