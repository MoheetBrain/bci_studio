// The decoder scene's stepping logic (src/decoder/steps.ts), checked against the real RTL trace it visualises:
// the running sums must end at the RTL's logits for every frame, and the step count must be the RTL's latency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contributions, decide, stateAt, stepsPerFrame, totalSteps, withInput } from '../src/decoder/steps.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trace = JSON.parse(readFileSync(join(root, 'public/artifacts/rtl_trace_v04_real.json'), 'utf8'));
const model = { NO: trace.model.NO, W2: trace.model.W2, b2: trace.model.b2 };
const cycles = trace.latency.engine_start_to_fifo;

test('the trace is the linear, two-output decoder this scene draws, with the latency its formula gives', () => {
  assert.equal(trace.model.linear, 1);
  assert.equal(trace.model.NO, 2);
  assert.equal(trace.profile.num_channels, 8);
  assert.equal(cycles, trace.model.NO * 8 + 2);
  assert.equal(trace.frames.length, trace.inferences.length);
  assert.ok(trace.frames.length >= 16);
  assert.equal(trace.checks.passed, trace.checks.total);
});

test('for every frame the recomputed sums, class and margin equal the RTL’s', () => {
  for (let f = 0; f < trace.frames.length; f++) {
    const inf = trace.inferences[f], x = trace.frames[f].x;
    assert.deepEqual(inf.x, x);
    const d = decide(model, x);
    assert.deepEqual(d.logits, inf.logits, `frame ${f}`);
    assert.equal(d.cls, inf.cls);
    assert.equal(d.margin, inf.margin);
    // …and the end of the stepped timeline agrees with it
    const end = stateAt((f + 1) * stepsPerFrame(cycles) - 0.5, trace.frames.length, cycles, model, x);
    assert.equal(end.frame, f);
    assert.equal(end.phase, 'emit');
    assert.ok(end.complete);
    assert.deepEqual(end.acc, inf.logits);
  }
});

test('the timeline walks latch → 16 multiply-accumulates → decide → emit, one product per clock cycle', () => {
  const x = trace.frames[0].x, S = stepsPerFrame(cycles), n = trace.frames.length;
  assert.equal(S, 20);
  assert.equal(totalSteps(n, cycles), n * 20);
  const s0 = stateAt(0, n, cycles, model, x);
  assert.deepEqual([s0.phase, s0.macsDone, s0.cycle, s0.current], ['latch', 0, 0, null]);
  assert.deepEqual(s0.acc, [model.b2[0], model.b2[1]], 'the sums start at the biases');
  let prev = s0.acc.slice();
  for (let step = 1; step <= 16; step++) {
    const s = stateAt(step, n, cycles, model, x);
    assert.equal(s.phase, 'mac');
    assert.equal(s.cycle, step);
    assert.deepEqual(s.current, { o: Math.floor((step - 1) / 8), k: (step - 1) % 8 });
    assert.equal(s.macsDone, step - 1);
    // exactly the previous product has been added since the last step
    if (step > 1) {
      const o = Math.floor((step - 2) / 8), k = (step - 2) % 8;
      const expect = prev.slice(); expect[o] += model.W2[o][k] * x[k];
      assert.deepEqual(s.acc, expect);
    }
    prev = s.acc.slice();
  }
  assert.equal(stateAt(17, n, cycles, model, x).phase, 'decide');
  assert.equal(stateAt(18, n, cycles, model, x).phase, 'decide');
  assert.equal(stateAt(18, n, cycles, model, x).cycle, 18);
  assert.equal(stateAt(19, n, cycles, model, x).phase, 'emit');
  // frame boundaries and clamping
  assert.equal(stateAt(20, n, cycles, model, x).frame, 1);
  assert.equal(stateAt(-5, n, cycles, model, x).frame, 0);
  assert.equal(stateAt(1e9, n, cycles, model, x).frame, n - 1);
  assert.equal(stateAt(NaN, n, cycles, model, x).step, 0);
});

test('contributions sum to the logits; replacing one input is a software what-if within int8', () => {
  const x = trace.frames[0].x;
  const c = contributions(model, x);
  for (let o = 0; o < 2; o++) assert.equal(c[o].reduce((a: number, b: number) => a + b, model.b2[o]), trace.inferences[0].logits[o]);
  assert.deepEqual(withInput(x, 7, 0).slice(0, 7), x.slice(0, 7));
  assert.equal(withInput(x, 7, 0)[7], 0);
  assert.equal(withInput(x, 0, 999)[0], 127);
  assert.equal(withInput(x, 0, -999)[0], -128);
  assert.deepEqual(withInput(x, 42, 5), x);
  assert.notEqual(withInput(x, 7, 0), x, 'the original frame is never modified');
  // the prediction task of the scene: silencing channel 7 in frame 0 flips the decision
  assert.notEqual(decide(model, withInput(x, 7, 0)).cls, trace.inferences[0].cls);
});
