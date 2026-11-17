// Signal-journey model (src/journey/model/chain.ts): units, known numeric outputs, clipping, quantisation, aliasing,
// deterministic replay, exact scrubbing, and agreement of the digital stage with the RTL-checked chip models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers/bundle.ts';

type Chain = typeof import('../src/journey/model/chain.ts');
type Lab = typeof import('../src/lab/model.ts');
type Feat = typeof import('../src/lab/featureModel.ts');
const C = await load<Chain>('src/journey/model/chain.ts');
const L = await load<Lab>('src/lab/model.ts');
const F = await load<Feat>('src/lab/featureModel.ts');
const D = C.DEFAULT_PARAMS;

/** A silent source: no neurons firing, no background, no field potential, no amplifier noise, tiny electrode resistance. */
const quiet = (over: Partial<typeof D> = {}) => ({
  ...D, units: [{ distanceUm: 50, rateHz: 0 }], backgroundUvRms: 0, lfpUvPk: 0, gammaUvPk: 0, interfererUvPk: 0,
  afeNoiseUvRms: 0, electrodeResistanceKohm: 1, electrodeOffsetMv: 0, durationMs: 100, ...over,
});
const goertzel = (x: ArrayLike<number>, fs: number, f: number) => {
  let re = 0, im = 0;
  for (let n = 0; n < x.length; n++) { re += x[n] * Math.cos((2 * Math.PI * f * n) / fs); im -= x[n] * Math.sin((2 * Math.PI * f * n) / fs); }
  return (2 * Math.hypot(re, im)) / x.length;
};
const rms = (x: ArrayLike<number>) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };

test('defaults are valid; non-finite and out-of-range inputs are rejected with a message', () => {
  assert.deepEqual(C.validateParams(D), []);
  for (const bad of [
    { gain: Number.NaN }, { gain: Infinity }, { gain: 0 }, { fsHz: 12345 }, { bits: 3 }, { bits: 12.5 }, { vrefV: -1 }, { lpHz: 0 },
    { durationMs: 1e9 }, { units: [] }, { units: [{ distanceUm: Number.NaN, rateHz: 10 }] }, { seed: 1.5 }, { gammaStartMs: 90, gammaEndMs: 10 },
    { core: { ...D.core, threshold: -1 } }, { core: { ...D.core, alphaShift: 16 } },
  ]) {
    const p = { ...D, ...bad } as typeof D;
    assert.ok(C.validateParams(p).length > 0, `accepted ${JSON.stringify(bad)}`);
    assert.throws(() => C.runChain(p), /invalid chain parameters/);
  }
});

test('deterministic replay: same parameters → identical numbers; another seed → different numbers', () => {
  const a = C.runChain(D), b = C.runChain({ ...D, units: D.units.map((u) => ({ ...u })) });
  assert.equal(C.fingerprint(a), C.fingerprint(b));
  assert.deepEqual(Array.from(a.adc.code.subarray(0, 200)), Array.from(b.adc.code.subarray(0, 200)));
  assert.deepEqual(a.digital.events, b.digital.events);
  assert.notEqual(C.fingerprint(C.runChain({ ...D, seed: D.seed + 1 })), C.fingerprint(a));
  // Golden fingerprint of the default lesson: any change to the model's numbers must be deliberate.
  assert.equal(C.fingerprint(a), GOLDEN_DEFAULT, 'default-parameter output changed; update GOLDEN_DEFAULT only if the model change is intended');
});
const GOLDEN_DEFAULT = '3554936b';

test('sampling: sample count, grid step and Nyquist follow the sample rate exactly', () => {
  for (const fsHz of C.SAMPLE_RATES_HZ) {
    const r = C.runChain(quiet({ fsHz }));
    assert.equal(r.adc.step, C.ANALOG_RATE_HZ / fsHz);
    assert.ok(Number.isInteger(r.adc.step));
    assert.equal(r.adc.count, (100 / 1000) * fsHz);
    assert.equal(r.derived.nyquistHz, fsHz / 2);
    assert.equal(r.derived.rawBitsPerS, fsHz * 16);
  }
});

test('ADC code convention: mid-tread rounding, two\'s-complement range, left-aligned 16-bit sample', () => {
  // DC-coupled, 1 mV offset × gain 100 = 0.100 V at the ADC. ±1.0 V full scale, 8 bits → LSB = 2/256 V = 7.8125 mV.
  const r = C.runChain(quiet({ hpHz: 0, electrodeOffsetMv: 1, gain: 100, swingV: 2, vrefV: 1, bits: 8, lpHz: 1000, fsHz: 10000 }));
  assert.equal(r.derived.lsbV, 2 / 256);
  assert.ok(Math.abs(r.derived.lsbInputUv - 78.125) < 1e-9, 'input-referred LSB = 7.8125 mV / 100 = 78.125 µV');
  assert.ok(Math.abs(r.derived.quantNoiseInputUvRms - 78.125 / Math.sqrt(12)) < 1e-9);
  // 0.100 V / 7.8125 mV = 12.8 → rounds to 13 (mid-tread); every sample, since the input is constant.
  assert.ok(Array.from(r.adc.code).every((c) => c === 13), `codes: ${Array.from(r.adc.code.subarray(0, 8))}`);
  assert.ok(Array.from(r.adc.sample16).every((s) => s === 13 * 256), '8-bit code is left-aligned into the 16-bit sample');
  assert.equal(r.derived.adcClipFraction, 0);
  assert.ok(Math.abs(r.derived.dcOffsetAtOutputV - 0.1) < 1e-12);
  // one more bit halves the LSB
  const r9 = C.runChain(quiet({ hpHz: 0, electrodeOffsetMv: 1, gain: 100, swingV: 2, vrefV: 1, bits: 9, lpHz: 1000, fsHz: 10000 }));
  assert.equal(r9.derived.lsbV, r.derived.lsbV / 2);
  assert.ok(Array.from(r9.adc.code).every((c) => c === 26));
});

test('clipping: the amplifier saturates at its swing and the ADC clamps at its rails, both flagged', () => {
  // 10 mV offset × 1000 = 10 V: far beyond the ±0.6 V swing.
  const hi = C.runChain(quiet({ hpHz: 0, electrodeOffsetMv: 10, gain: 1000, swingV: 0.6, vrefV: 0.5, bits: 12 }));
  assert.equal(hi.derived.afeClipFraction, 1);
  assert.ok(Array.from(hi.analog.afeV).every((v) => Math.abs(v - 0.6) < 1e-6));
  assert.ok(Array.from(hi.adc.code).every((c) => c === 2047), 'positive rail = 2^(N-1) − 1');
  assert.equal(hi.derived.adcClipFraction, 1);
  assert.ok(Array.from(hi.adc.clipped).every((c) => c === 1));
  const lo = C.runChain(quiet({ hpHz: 0, electrodeOffsetMv: -10, gain: 1000, swingV: 0.6, vrefV: 0.5, bits: 12 }));
  assert.ok(Array.from(lo.adc.code).every((c) => c === -2048), 'negative rail = −2^(N-1)');
  assert.ok(Array.from(lo.adc.sample16).every((s) => s === -32768));
  // The same electrode offset is harmless once the amplifier is AC-coupled (high-pass on).
  const ac = C.runChain(quiet({ hpHz: 300, electrodeOffsetMv: 10, gain: 1000, swingV: 0.6, vrefV: 0.5, bits: 12 }));
  assert.equal(ac.derived.afeClipFraction, 0);
  assert.equal(ac.derived.dcOffsetAtOutputV, 0);
  assert.ok(Math.abs(ac.adc.code[ac.adc.count - 1]) <= 1);
});

test('filter and noise formulas: corner gain, Johnson noise, alias folding', () => {
  assert.ok(Math.abs(C.afeMagnitude(7500, 0, 7500) - Math.SQRT1_2) < 1e-12, '−3.01 dB at the low-pass corner');
  assert.ok(Math.abs(C.afeMagnitude(300, 300, 1e9) - Math.SQRT1_2) < 1e-9, '−3.01 dB at the high-pass corner');
  assert.ok(Math.abs(20 * Math.log10(C.afeMagnitude(75000, 0, 7500)) + 40) < 0.01, '2nd order: −40 dB one decade above the corner');
  // √(4 k T R B) for 1 MΩ, 10 kHz, 300 K = 12.87 µV
  assert.ok(Math.abs(C.thermalNoiseV(1e6, 1e4, 300) * 1e6 - 12.872) < 0.001);
  assert.equal(C.aliasFrequency(7000, 10000), 3000);
  assert.equal(C.aliasFrequency(17000, 30000), 13000);
  assert.equal(C.aliasFrequency(4000, 10000), 4000);
  assert.equal(C.aliasFrequency(10000, 10000), 0);
  assert.equal(C.aliasFrequency(23000, 10000), 3000);
});

test('aliasing demonstration: a 7 kHz tone sampled at 10 kS/s shows up at 3 kHz unless the anti-alias filter removes it', () => {
  const tone = { interfererUvPk: 200, interfererHz: 7000, fsHz: 10000, gain: 400, bits: 16, hpHz: 1 } as const;
  const wide = C.runChain(quiet({ ...tone, lpHz: 20000 }));
  assert.equal(wide.derived.interferer!.aliasHz, 3000);
  assert.equal(wide.derived.interferer!.aliased, true);
  const lsbUv = wide.derived.lsbInputUv;
  const at3k = goertzel(wide.adc.code, 10000, 3000) * lsbUv, at1k = goertzel(wide.adc.code, 10000, 1000) * lsbUv;
  // The filter passes 7 kHz almost unchanged (|H| at 7 kHz with a 20 kHz corner), so ≈ 200 µV appears at 3 kHz.
  assert.ok(Math.abs(at3k - 200 * C.afeMagnitude(7000, 1, 20000)) < 4, `alias amplitude ${at3k.toFixed(1)} µV`);
  assert.ok(at1k < 2, `nothing at 1 kHz (${at1k.toFixed(2)} µV)`);
  const narrow = C.runChain(quiet({ ...tone, lpHz: 1000 }));
  const filtered = goertzel(narrow.adc.code, 10000, 3000) * narrow.derived.lsbInputUv;
  assert.ok(narrow.derived.interferer!.attenuationDb < -30);
  assert.ok(filtered < at3k / 30, `anti-alias filter leaves ${filtered.toFixed(2)} µV of ${at3k.toFixed(1)} µV`);
  // Below Nyquist the tone is represented at its true frequency.
  const ok = C.runChain(quiet({ ...tone, interfererHz: 2000, lpHz: 20000 }));
  assert.equal(ok.derived.interferer!.aliased, false);
  assert.equal(ok.derived.interferer!.aliasHz, 2000);
});

test('input-referred noise: the simulated in-band noise matches √(thermal² + amplifier²)', () => {
  const p = quiet({ afeNoiseUvRms: 3, electrodeResistanceKohm: 500, hpHz: 1, gain: 1000, lpHz: 7500, swingV: 2.5, vrefV: 2.5, durationMs: 400, fsHz: 30000 });
  const r = C.runChain(p);
  const thermal = C.thermalNoiseV(500e3, 1.11 * 7500) * 1e6;
  assert.ok(Math.abs(r.derived.electrodeThermalUvRms - thermal) < 1e-9);
  assert.ok(Math.abs(r.derived.inputNoiseUvRms - Math.hypot(thermal, 3)) < 1e-9);
  const measured = rms(Array.from(r.analog.afeV, (v) => (v / 1000) * 1e6));
  assert.ok(Math.abs(measured - r.derived.inputNoiseUvRms) / r.derived.inputNoiseUvRms < 0.08, `measured ${measured.toFixed(2)} µV vs ${r.derived.inputNoiseUvRms.toFixed(2)} µV`);
});

test('source model: spike amplitude follows the stated 1/distance rule; the trace is a sum over several neurons', () => {
  const r = C.runChain(D);
  D.units.forEach((u, i) => assert.ok(Math.abs(r.derived.unitAmplitudeUv[i] - (D.spikeUvAtRef * D.refDistanceUm) / u.distanceUm) < 1e-9));
  assert.ok(new Set(r.truth.map((s) => s.unit)).size >= 2, 'more than one neuron contributes spikes');
  assert.ok(r.truth.every((s, i) => i === 0 || s.tMs >= r.truth[i - 1].tMs));
  // Membrane potential (mV, intracellular) and electrode potential (µV, extracellular) differ by orders of magnitude and in sign.
  const s0 = r.truth.find((s) => s.unit === 0)!;
  const i0 = Math.round((s0.tMs / 1000) * C.ANALOG_RATE_HZ);
  let vmMax = -Infinity;
  for (let i = i0 - 100; i < i0 + 300; i++) vmMax = Math.max(vmMax, r.analog.vmMv[i]);
  assert.ok(vmMax > 0 && vmMax < 45, `membrane potential peaks near +30 mV (got ${vmMax.toFixed(1)})`);
  assert.ok(C.extracellularTemplate(0) < -0.95 && C.extracellularTemplate(0.45) > 0.2, 'the extracellular spike is a negative phase followed by a smaller positive one');
  assert.equal(r.analog.vmMv[0], C.RESTING_MV);
});

test('default lesson: most spikes above threshold are detected, with few false events', () => {
  const r = C.runChain(D);
  const d = r.derived.detection;
  assert.ok(d.trueSpikes >= 10, `only ${d.trueSpikes} spikes in the default window`);
  assert.ok(d.detectable >= 3, `threshold ${r.derived.thresholdInputUv.toFixed(1)} µV leaves ${d.detectable} detectable spikes`);
  assert.ok(d.hits >= 0.75 * d.detectable, `${d.hits} hits of ${d.detectable} detectable`);
  assert.ok(d.falsePositives <= Math.max(1, 0.25 * r.digital.events.length), `${d.falsePositives} false events of ${r.digital.events.length}`);
  assert.equal(r.derived.afeClipFraction, 0);
  assert.equal(r.derived.adcClipFraction, 0);
  assert.equal(r.derived.eventBitsPerS, (r.digital.events.length * 52) / 0.2);
  assert.ok(r.derived.eventBitsPerS < r.derived.rawBitsPerS / 20, 'event output is far smaller than raw (and lossy)');
});

test('digital stage is exactly the RTL-checked chip model applied to the ADC samples', () => {
  const r = C.runChain(D);
  const cs = L.freshState()[0];
  const fs = F.freshFeature();
  for (let n = 0; n < r.adc.count; n++) {
    const a = L.stepCore(cs, n, 0, r.adc.sample16[n], D.core);
    const f = F.stepFeature(fs, r.adc.sample16[n], F.DEFAULT_FEATURE);
    assert.equal(r.digital.baseline[n], a.baseInt, `baseline at n=${n}`);
    assert.equal(r.digital.residual[n], a.res);
    assert.equal(r.digital.fire[n], a.fire);
    assert.equal(r.digital.y[n], f.y);
  }
  assert.equal(r.digital.events.length, Array.from(r.digital.fire).reduce((a, b) => a + b, 0));
});

test('FEATURE path: pass band scales with the sample rate; a gamma burst raises window energy at the design rate', () => {
  assert.deepEqual(C.runChain(quiet({ fsHz: 2000 })).derived.featureBandHz, [70, 150]);
  assert.deepEqual(C.runChain(quiet({ fsHz: 30000 })).derived.featureBandHz, [1050, 2250]);
  const r = C.runChain(quiet({ fsHz: 2000, lpHz: 500, hpHz: 1, gain: 1000, durationMs: 400, gammaUvPk: 120, gammaHz: 100, gammaStartMs: 150, gammaEndMs: 300, backgroundUvRms: 4, afeNoiseUvRms: 2.4 }));
  assert.equal(r.derived.featureWindowMs, 16);
  const inside = r.digital.windows.filter((w) => w.tMs > 190 && w.tMs < 270).map((w) => w.energy);
  const outside = r.digital.windows.filter((w) => w.tMs > 40 && w.tMs < 130).map((w) => w.energy);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(inside.length >= 3 && outside.length >= 3);
  assert.ok(mean(inside) > 20 * Math.max(1, mean(outside)), `burst energy ${mean(inside).toFixed(0)} vs baseline ${mean(outside).toFixed(0)}`);
});

test('scrubbing: the state at an instant is recomputed exactly, in any order, and is clamped to the window', () => {
  const r = C.runChain(D);
  const a = C.stateAt(r, 61.37), far = C.stateAt(r, 180), again = C.stateAt(r, 61.37);
  assert.deepEqual(again, a, 'returning to the same instant gives the same numbers');
  assert.notDeepEqual(far, a);
  // sample timestamp n is ⌊t · fs⌋ on the ADC's own clock, independent of how the playhead got there
  assert.equal(a.n, Math.floor((Math.floor((61.37 / 1000) * C.ANALOG_RATE_HZ)) / r.adc.step));
  assert.equal(a.code, r.adc.code[a.n]);
  assert.equal(a.baseline, r.digital.baseline[a.n]);
  assert.equal(a.eventsSoFar, r.digital.events.filter((e) => e.n <= a.n).length);
  assert.ok(far.eventsSoFar >= a.eventsSoFar);
  // a fresh run reproduces the same state (recomputation, not a stored animation)
  assert.deepEqual(C.stateAt(C.runChain(D), 61.37), a);
  assert.equal(C.stateAt(r, -5).tMs, 0);
  assert.equal(C.stateAt(r, 1e9).tMs, D.durationMs);
  assert.equal(C.stateAt(r, Number.NaN).tMs, 0);
});
