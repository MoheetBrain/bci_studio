// Atlas search and curated content: names, synonyms (with their caveats), and card/source integrity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchAtlas } from '../src/atlas/search.ts';
import { REGION_CARDS, cardFor, cardKey } from '../src/atlas/content/regions.ts';
import { SYNONYMS } from '../src/atlas/content/synonyms.ts';
import { SOURCES } from '../src/science/sources.ts';
import type { AtlasManifest, TreeNode } from '../src/atlas/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'public/atlas/spl-nac/manifest.json'), 'utf8')) as AtlasManifest;
const nodes: TreeNode[] = [
  ...manifest.groups.map((g) => ({ id: g.id, name: g.name, kind: 'group' as const, parentId: g.parentId, children: [] })),
  ...manifest.structures.map((s) => ({ id: s.id, name: s.name, kind: 'structure' as const, parentId: s.parentId, children: [] })),
];
const names = new Set(nodes.map((n) => cardKey(n.name)));

test('search by name: exact and prefix matches rank first', () => {
  const hits = searchAtlas('left precentral gyrus', nodes);
  assert.equal(hits[0].id, 'left_precentral_gyrus');
  const pre = searchAtlas('precentral', nodes).map((h) => h.id);
  assert.ok(pre.includes('left_precentral_gyrus') && pre.includes('right_precentral_gyrus'));
  assert.ok(searchAtlas('hippoc', nodes).some((h) => h.id === 'left_hippocampus'));
});

test('search by synonym: "M1" finds the precentral gyri and carries the caveat', () => {
  const hits = searchAtlas('M1', nodes);
  const pre = hits.filter((h) => /precentral_gyrus$/.test(h.id));
  assert.equal(pre.length, 2);
  for (const h of pre) {
    assert.equal(h.via, 'M1');
    assert.match(h.note ?? '', /not identical/);
  }
  assert.ok(searchAtlas('motor cortex', nodes).some((h) => h.id === 'left_precentral_gyrus'));
  assert.ok(searchAtlas('rolandic', nodes).some((h) => h.id === 'left_central_sulcus'));
});

test('search: nothing matches nonsense or an empty query; results are bounded', () => {
  assert.deepEqual(searchAtlas('', nodes), []);
  assert.deepEqual(searchAtlas('   ', nodes), []);
  assert.deepEqual(searchAtlas('zzzqqq', nodes), []);
  assert.ok(searchAtlas('left', nodes).length <= 30);
});

test('no structure in the atlas is named after a functional area', () => {
  for (const n of nodes) assert.doesNotMatch(n.name, /\b(primary motor cortex|M1|motor cortex|somatosensory cortex)\b/i, n.name);
});

test('every synonym key and every card key names something that exists in this atlas', () => {
  for (const key of Object.keys(SYNONYMS)) assert.ok(names.has(key), `synonym key "${key}" matches no atlas name`);
  for (const c of REGION_CARDS) assert.ok(names.has(c.key), `card key "${c.key}" matches no atlas name`);
});

test('cards: every statement is typed and every cited source exists; published findings always cite something', () => {
  for (const c of REGION_CARDS) {
    assert.ok(c.summary.length > 20 && c.summarySources.length > 0, `${c.key}: summary without sources`);
    const claims = [...c.location, ...c.functions, ...c.bci, ...c.limits];
    assert.ok(c.limits.length > 0, `${c.key}: no limitations stated`);
    for (const id of [...c.summarySources, ...(c.caution?.sources ?? []), ...claims.flatMap((x) => x.sources)]) {
      assert.ok(SOURCES[id], `${c.key}: unknown source "${id}"`);
    }
    for (const cl of claims) {
      assert.ok(['observed', 'background', 'assumption', 'hypothesis'].includes(cl.kind));
      if (cl.kind === 'background' || cl.kind === 'observed') assert.ok(cl.sources.length > 0, `${c.key}: uncited ${cl.kind} statement: ${cl.text.slice(0, 50)}…`);
    }
  }
});

test('the motor card keeps gyrus and M1 apart', () => {
  const found = cardFor(['left precentral gyrus', 'left frontal lobe']);
  assert.ok(found && found.inherited === null);
  const card = found!.card;
  assert.ok(card.caution, 'the precentral gyrus card must carry the gyrus ≠ M1 caution');
  assert.match(card.caution!.title, /≠/);
  assert.match(card.caution!.body, /cell architecture/);
  assert.match(card.caution!.body, /bounded approximation/);
  assert.ok(card.caution!.sources.includes('geyer1996') && card.caution!.sources.includes('rademacher2001'));
  assert.equal(card.journey, true);
});

test('cardFor inherits from the nearest ancestor and says so; unknown regions get no card', () => {
  const lob = cardFor(['left-V', 'medial hemispheric zone', 'left hemisphere of cerebellum', 'cerebellum', 'metencephalon']);
  assert.equal(lob?.card.key, 'cerebellum');
  assert.equal(lob?.inherited, 'cerebellum');
  assert.equal(cardFor(['left insula', 'left cerebral hemisphere', 'telencephalon']), null);
});

test('bibliography: unique ids, a year, and a DOI or URL for everything except books', () => {
  for (const [id, s] of Object.entries(SOURCES)) {
    assert.equal(s.id, id);
    assert.ok(s.year >= 1900 && s.year <= 2026);
    if (s.kind === 'journal-article') assert.match(s.doi ?? '', /^10\.\d{4,}\//, `${id}: journal article without a DOI`);
    assert.doesNotMatch(s.venue + (s.note ?? ''), /\bp\.\s*\d|\bpp\.\s*\d/, `${id}: page citation without a retrieved text`);
  }
});
