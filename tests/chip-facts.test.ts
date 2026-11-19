// The hand-written framing of the "Our chip" map (src/chipmap/chipFacts.ts) is checked against the snapshot:
// record paths may only name instances that exist; every "not implemented" statement must quote its document verbatim;
// the recorded model-vs-RTL check results must be passing and belong to this snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPTUAL, DIGITAL_PATHS, MILESTONES } from '../src/chipmap/chipFacts.ts';
import type { ChipHierarchy } from '../src/chipmap/useHierarchy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const h = json('public/artifacts/chip_hierarchy.json') as ChipHierarchy;
const paths = new Set([h.top, ...h.instances.map((i) => i.path)]);

test('record paths name only instances that exist under the chip top', () => {
  for (const p of DIGITAL_PATHS) {
    assert.ok(p.instances.length > 0);
    for (const i of p.instances) assert.ok(paths.has(i), `path "${p.id}" names ${i}, which is not in the RTL hierarchy`);
  }
  const used = new Set(DIGITAL_PATHS.flatMap((p) => p.instances));
  // every instance of the chip appears in at least one path (nothing in the design is left unexplained)
  for (const i of h.instances) assert.ok(used.has(i.path), `${i.path} is in the chip but in no path of the map`);
});

test('every "not implemented" statement quotes its project document verbatim', () => {
  for (const c of CONCEPTUAL) {
    const file = join(root, 'chip', c.doc);
    assert.ok(existsSync(file), `${c.id}: chip/${c.doc} is missing`);
    assert.ok(readFileSync(file, 'utf8').includes(c.quote), `${c.id}: "${c.quote}" is not in chip/${c.doc}`);
  }
  assert.ok(CONCEPTUAL.some((c) => c.id === 'afe') && CONCEPTUAL.some((c) => c.id === 'adc') && CONCEPTUAL.some((c) => c.id === 'electrodes'));
});

test('milestones: nothing beyond place-and-route is claimed', () => {
  const reached = MILESTONES.filter((m) => m.reached).map((m) => m.id);
  assert.deepEqual(reached, ['rtl', 'sim', 'synth', 'layout']);
  for (const id of ['fab', 'measured', 'bio']) assert.equal(MILESTONES.find((m) => m.id === id)!.reached, false);
  const files = json('public/artifacts/manifest.json').files as string[];
  assert.ok(files.includes('synth_stats.json'), 'synthesis artifact missing but the map says "synthesised"');
  assert.ok(files.some((f) => /^layout_v04\/.*\.gds\.gz$/.test(f)), 'layout artifact missing but the map says "placed and routed"');
  assert.match(readFileSync(join(root, 'chip/docs/PHYSICAL.md'), 'utf8'), /has not been fabricated or measured\./);
});

test('recorded model-vs-RTL checks: all passing, for this snapshot, and each path that claims a check has one', () => {
  const checks = json('public/artifacts/studio_checks.json');
  assert.equal(checks.chipCommit, json('chip/SNAPSHOT.json').commit);
  assert.ok(checks.results.length === 3 && checks.results.every((r: { passed: boolean }) => r.passed), 'a recorded check is failing: run npm run check:rtl');
  const ids = new Set(checks.results.map((r: { id: string }) => r.id));
  for (const p of DIGITAL_PATHS) if (p.check) assert.ok(ids.has(p.check), `path ${p.id} cites ${p.check}, which was not executed`);
  const out = checks.results.flatMap((r: { output: string[] }) => r.output).join('\n');
  assert.match(out, /3200\/3200 samples agree/);
  assert.match(out, /4000\/4000 samples agree/);
  assert.match(out, /32\/32 inferences agree/);
});
