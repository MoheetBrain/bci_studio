// The chip facts shown by the studio must be exactly what the RTL snapshot contains: instance names, source lines,
// which modules are actually part of the chip top, which suites exercised them — and what is NOT in the RTL at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from '../src/journey/stages.ts';
import { SOURCES } from '../src/science/sources.ts';
import type { ChipHierarchy } from '../src/chipmap/useHierarchy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = () => JSON.parse(readFileSync(join(root, 'public/artifacts/chip_hierarchy.json'), 'utf8')) as ChipHierarchy;
const h = read();
const snapshot = JSON.parse(readFileSync(join(root, 'chip/SNAPSHOT.json'), 'utf8'));
const paths = new Set(h.instances.map((i) => i.path));
const leaf = (name: string) => h.instances.filter((i) => i.name === name);

test('snapshot integrity: every chip/ file matches the hash recorded at import, and the RTL hash is the recorded one', () => {
  for (const [rel, sha] of Object.entries(snapshot.files as Record<string, string>)) {
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'chip', rel))).digest('hex'), sha, `chip/${rel} was modified after the snapshot`);
  }
  const hh = createHash('sha256');
  for (const f of readdirSync(join(root, 'chip/rtl')).filter((n) => n.endsWith('.v')).sort()) hh.update(readFileSync(join(root, 'chip/rtl', f)));
  assert.equal(hh.digest('hex'), snapshot.rtlSha256);
  assert.equal(h.source.commit, snapshot.commit);
  assert.match(h.source.commit, /^207285f/);
});

test('the committed hierarchy is exactly what the extractor produces from the snapshot', () => {
  const before = readFileSync(join(root, 'public/artifacts/chip_hierarchy.json'), 'utf8');
  execFileSync(process.execPath, [join(root, 'tools/chip/extract-hierarchy.mjs')], { stdio: 'ignore' });
  assert.equal(readFileSync(join(root, 'public/artifacts/chip_hierarchy.json'), 'utf8'), before, 'chip_hierarchy.json is stale: run npm run chip:extract');
});

test('every instance is where the artifact says it is: the source line names that module and instance', () => {
  for (const i of h.instances) {
    const lines = readFileSync(join(root, 'chip', i.file), 'utf8').split('\n');
    assert.ok(lines[i.line - 1].includes(i.name), `${i.path}: ${i.file}:${i.line} does not mention ${i.name}`);
    // the module name appears on that line or within the preceding parameter list
    const window = lines.slice(Math.max(0, i.line - 30), i.line).join('\n');
    assert.ok(window.includes(i.module), `${i.path}: module ${i.module} not found near ${i.file}:${i.line}`);
    const mod = h.modules.find((m) => m.name === i.module);
    assert.ok(mod, `${i.path}: module ${i.module} missing from the module list`);
    assert.match(readFileSync(join(root, 'chip', mod!.file), 'utf8').split('\n')[mod!.lineStart - 1], new RegExp(`\\bmodule\\s+${i.module}\\b`));
  }
});

test('the instance names in the brief exist in source, with these exact module types', () => {
  const expect: Record<string, string> = {
    u_state: 'hbci_channel_state', u_baseline: 'hbci_baseline_ema', u_threshold: 'hbci_threshold_detector', u_refractory: 'hbci_refractory_ctrl',
    u_timestamp: 'hbci_timestamp', u_packer: 'hbci_event_packer', u_fstate: 'hbci_feature_state', u_biquad: 'hbci_biquad',
    u_energy: 'hbci_band_energy', u_records: 'hbci_record_mux',
  };
  for (const [name, mod] of Object.entries(expect)) {
    const found = leaf(name);
    assert.equal(found.length, 1, `${name}: expected exactly one instance, found ${found.length}`);
    assert.equal(found[0].module, mod);
  }
  // u_state and u_fstate are different things in different cores
  assert.equal(leaf('u_state')[0].parentModule, 'hbci_event_core');
  assert.equal(leaf('u_fstate')[0].parentModule, 'hbci_readout_core');
  assert.equal(h.top, 'hbci02_chip_top');
});

test('what is NOT in the RTL: no analogue front end, ADC, electrode, radio or stimulator module exists', () => {
  for (const m of h.modules) {
    assert.doesNotMatch(m.name, /afe|adc|amplif|electrode|radio|wireless|telemetry|stim|lna|pga/i, `${m.name} looks like hardware the studio says is not implemented`);
  }
  // the only "mux" in the design is the digital record arbiter
  assert.deepEqual(h.modules.filter((m) => /mux/i.test(m.name)).map((m) => m.name), ['hbci_record_mux']);
  // modules present in source but not part of the chip top are reported as such
  assert.deepEqual(h.modules.filter((m) => !m.inChipTop).map((m) => m.name).sort(), ['hbci_onchip_mlp', 'hbci_v04_digital_top']);
  assert.deepEqual(h.modules.find((m) => m.name === 'hbci_onchip_mlp')!.suites, [], 'the experimental MLP has no executed suite in the recorded verification');
});

test('tested behaviour: every module in the chip top is covered by at least one executed, passing suite', () => {
  assert.equal(h.suites.length, 31);
  assert.ok(h.suites.every((s) => s.status === 'pass' && s.errors === 0), 'a recorded suite is not passing');
  assert.ok(h.suites.every((s) => s.duts.length > 0 && s.linkBasis !== 'none'));
  for (const m of h.modules.filter((x) => x.inChipTop)) assert.ok(m.suites.length > 0, `${m.name} has no linked suite`);
  assert.equal(h.verification.lint.warnings, 0);
});

test('journey stages only name blocks that exist, and keep external hardware out of the "implemented" column', () => {
  const byId = Object.fromEntries(STAGES.map((s) => [s.id, s]));
  for (const s of STAGES) {
    for (const p of s.chipInstances ?? []) assert.ok(paths.has(p), `stage ${s.id} names ${p}, which is not in the RTL hierarchy`);
    for (const id of s.sources) assert.ok(SOURCES[id], `stage ${s.id}: unknown source ${id}`);
    assert.ok(s.assumptions.length > 0, `stage ${s.id} states no assumptions`);
    if (s.realisation !== 'chip-rtl') assert.equal(s.chipInstances, undefined, `stage ${s.id} is not implemented but lists chip instances`);
  }
  for (const id of ['electrode', 'routing', 'afe', 'amux', 'adc']) assert.equal(byId[id].realisation, 'external', `${id} must not be shown as implemented`);
  for (const id of ['digital', 'decoder']) assert.equal(byId[id].realisation, 'chip-rtl');
  // three different "multiplexers" are three different stages, each warning against the other two
  assert.ok(byId.routing.notToBeConfusedWith && byId.amux.notToBeConfusedWith && byId.digital.notToBeConfusedWith);
  assert.ok(byId.digital.chipInstances!.some((p) => p.endsWith('/u_records')));
  assert.ok(!(byId.routing.chipInstances ?? []).length && !(byId.amux.chipInstances ?? []).length);
  assert.deepEqual(STAGES.map((s) => s.id), ['source', 'electrode', 'routing', 'afe', 'amux', 'adc', 'digital', 'decoder']);
});
