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
  for (const toy of ['A', 'B', 'C'] as const) {
    const mine = manifestFor(toy);
    assert.ok(mine.some((m) => m.kind === 'model') && mine.some((m) => m.cls === 'illustrative'), `toy ${toy} has a model and names its illustration`);
  }
  // nothing in the toys is measured data or derived anatomy, and the manifest must not say otherwise
  assert.ok(MANIFEST.every((m) => m.cls !== 'measured-data' && m.cls !== 'derived-anatomy'));
});
