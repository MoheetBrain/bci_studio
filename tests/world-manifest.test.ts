// The model and asset manifest (src/world/manifest.ts) must describe the code that is actually there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, manifestFor } from '../src/world/manifest.ts';
import { LIF_REVISION } from '../src/world/model/lif.ts';
import { fieldCircuit, workshopCircuit } from '../src/world/model/circuits.ts';
import { PILOT_REVISION, PilotSession } from '../src/world/model/pilot.ts';
import { FieldRun } from '../src/world/model/fieldRun.ts';
import { makeRun } from '../src/world/model/workshopRun.ts';
import { defaultSetup } from '../src/world/model/circuits.ts';
import { existsSync } from 'node:fs';
import { root } from './helpers/bundle.ts';
import { join } from 'node:path';

const by = (id: string) => MANIFEST.find((m) => m.id === id)!;

test('manifest: revisions are the ones the models and their exported runs carry', () => {
  assert.equal(by('lif').revision, LIF_REVISION);
  assert.equal(by('workshop').revision, workshopCircuit(0).revision);
  assert.equal(by('field').revision, fieldCircuit(1).circuit.revision);
  assert.equal(by('pilot').revision, PILOT_REVISION);
  assert.equal(makeRun(defaultSetup(0)).recipe.modelRevision, by('workshop').revision);
  assert.equal(new FieldRun(1).export().modelRevision, by('field').revision);
  assert.equal(new PilotSession(1).export().modelRevision, by('pilot').revision);
});

test('manifest: every entry says what it assumes, what it leaves out, where it comes from and how far it was read; nothing claims expert review', () => {
  for (const m of MANIFEST) {
    assert.ok(m.what.length > 40 && m.units.length > 0, m.id);
    assert.ok(m.omits.length >= 1 && m.sources.length >= 1 && m.sources.every((s) => s.read.length > 0), `${m.id}: omissions and reading level`);
    if (m.kind === 'model') assert.ok(m.assumptions.length >= 1 && m.verified.length >= 3, `${m.id}: assumptions and checks`);
    assert.ok(!/expert-reviewed$/.test(m.review) || m.review.startsWith('code-tested; not'), m.id);
    for (const f of m.files) assert.ok(existsSync(join(root, f)), `${m.id}: ${f} exists`);
  }
  for (const toy of ['A', 'B', 'C', 'W'] as const) {
    const mine = manifestFor(toy);
    assert.ok(mine.some((m) => m.kind === 'model') && mine.some((m) => m.cls === 'illustrative'), `${toy} has a model and names its illustration`);
  }
  // nothing in the three prototype toys is measured data or derived anatomy, and the manifest must not say otherwise
  for (const toy of ['A', 'B', 'C'] as const) assert.ok(manifestFor(toy).every((m) => m.cls !== 'measured-data' && m.cls !== 'derived-anatomy'));
  // the integrated world has exactly two pieces of anatomy — one reconstructed neuron (structure only) and the atlas
  // surface with its labels — and both are DATA, kept apart from every model and from the way they are drawn; nothing
  // anywhere is presented as a measured recording
  const anatomy = MANIFEST.filter((m) => m.cls === 'derived-anatomy');
  assert.deepEqual(anatomy.map((m) => [m.id, m.kind]), [['h01-exemplar', 'data'], ['atlas-surface', 'data']]);
  const h01 = MANIFEST.find((m) => m.id === 'h01-exemplar')!;
  assert.ok(h01.omits.some((o) => /No electrical model/.test(o)) && h01.omits.some((o) => /temporal cortex, not the precentral gyrus/.test(o)), 'the reconstructed neuron says what it is not');
  assert.ok(h01.assumptions.some((a) => /CC BY 4\.0/.test(a)), 'and under which licence it is used');
  assert.ok(MANIFEST.every((m) => m.cls !== 'measured-data'));
  assert.equal(MANIFEST.find((m) => m.id === 'brain-look')!.cls, 'illustrative');
  // the world uses the circuit, the probe and the decoder task; the ten-cell field of the dropped Toy A is not in it
  assert.deepEqual(manifestFor('W').map((m) => m.id).sort(), ['atlas-surface', 'brain-look', 'cells', 'contact', 'craft', 'h01-exemplar', 'lif', 'pilot', 'workshop']);
});
