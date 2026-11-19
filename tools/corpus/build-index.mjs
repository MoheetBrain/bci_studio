// Build the local source corpus index (SQLite FTS5) and the source inventory.
//
//   node tools/corpus/build-index.mjs            → corpus/index.sqlite  (gitignored: may contain private text)
//                                                 → public/corpus/manifest.json (committed: titles, hashes, counts — no text)
//
// Sources, each with a stable document id, a sha256 and exact locations (path + line range, or page):
//   project documents  chip/README.md, chip/BUILD_STATUS.md, chip/docs/*.md       (line-ranged chunks under their headings)
//   RTL                one chunk per module from chip_hierarchy.json + file header comments (file:line ranges)
//   studio cards       region cards and journey stages (the curated, cited explanations)
//   studio documents   docs/*.md of this repository
//   private abstracts  corpus/private/abstracts/*.txt   (PubMed abstracts; never committed)
//   private inbox      corpus/private/inbox/*.{md,txt}  (the user's own papers/books as text; form feeds = page breaks)
//
// PDFs are not parsed here. Convert first (e.g. `pdftotext book.pdf corpus/private/inbox/book.txt`); pdftotext writes a
// form feed between pages, which this script turns into page numbers.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_CARDS } from '../../src/atlas/content/regions.ts';
import { STAGES } from '../../src/journey/stages.ts';
import { SOURCES } from '../../src/science/sources.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const OUT = join(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'corpus/index.sqlite');
const WRITE_MANIFEST = !args.includes('--no-manifest');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const rel = (p) => relative(root, p);

// How far each document was actually READ during this build (not merely indexed). Anything not listed is "indexed".
// Kept honest by hand; see docs/SOURCE_AUDIT.md.
const READING = {
  'chip/README.md': 'fully-reviewed',
  'chip/docs/AFE_ADC_DECISION.md': 'fully-reviewed',
  'chip/docs/RESEARCH_AUDIT.md': 'excerpt-reviewed',
  'chip/docs/PHYSICAL.md': 'excerpt-reviewed',
  'chip/docs/UI_REFERENCE_NOTES.md': 'excerpt-reviewed',
};

const docs = [];
const chunks = [];
const addDoc = (d) => { docs.push({ licence: null, note: null, reading: 'indexed', visibility: 'public', ...d, chunks: 0 }); return docs[docs.length - 1]; };
const addChunk = (doc, c) => { if (!c.text.trim()) return; chunks.push({ docId: doc.id, heading: '', lineStart: null, lineEnd: null, page: null, ...c, text: c.text.trim() }); doc.chunks++; };

/** Markdown / text → chunks under their heading path, each with an exact line range (and page, if form feeds exist). */
function chunkText(doc, text, path) {
  const lines = text.split('\n');
  const heads = [];
  let buf = [], start = 1, page = text.includes('\f') ? 1 : null, bufPage = page, fence = false;
  const flush = (end) => {
    const body = buf.join('\n').trim();
    if (body) addChunk(doc, { text: body, heading: heads.filter(Boolean).join(' › '), loc: `${path}:${start}-${end}`, lineStart: start, lineEnd: end, page: bufPage });
    buf = []; start = end + 1; bufPage = page;
  };
  lines.forEach((raw, i) => {
    const n = i + 1;
    let line = raw;
    if (line.includes('\f')) { flush(n - 1); page += (line.match(/\f/g) ?? []).length; bufPage = page; line = line.replace(/\f/g, ''); start = n; }
    if (/^```/.test(line)) fence = !fence;
    const h = !fence && /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(n - 1); heads.length = h[1].length - 1; heads[h[1].length - 1] = h[2].trim(); start = n; buf.push(line); return; }
    buf.push(line);
    const size = buf.reduce((a, l) => a + l.length + 1, 0);
    if (!fence && size > 1100 && (line.trim() === '' || size > 2200)) flush(n);
  });
  flush(lines.length);
}

// 1 · project documents ─────────────────────────────────────────────────────────────────────────────────────────
const snapshot = JSON.parse(readFileSync(join(root, 'chip/SNAPSHOT.json'), 'utf8'));
for (const f of ['chip/README.md', 'chip/BUILD_STATUS.md', ...readdirSync(join(root, 'chip/docs')).filter((n) => n.endsWith('.md')).sort().map((n) => `chip/docs/${n}`)]) {
  const text = readFileSync(join(root, f), 'utf8');
  const title = (/^#\s+(.*)$/m.exec(text)?.[1] ?? f).trim();
  const doc = addDoc({ id: `chip:${f.slice(5)}`, title, kind: 'project document', path: f, sha256: sha(text), bytes: Buffer.byteLength(text), reading: READING[f] ?? 'indexed',
    licence: 'Hamiltonian Interface (project-internal)', note: `chip repository snapshot ${snapshot.commit.slice(0, 7)}` });
  chunkText(doc, text, f);
}

// 2 · RTL: one chunk per module (from the mechanically extracted hierarchy) ─────────────────────────────────────
const h = JSON.parse(readFileSync(join(root, 'public/artifacts/chip_hierarchy.json'), 'utf8'));
for (const file of h.source.files) {
  const text = readFileSync(join(root, 'chip', file), 'utf8');
  const doc = addDoc({ id: `rtl:${file.slice(4)}`, title: `${file} (Verilog)`, kind: 'RTL source', path: `chip/${file}`, sha256: sha(text), bytes: Buffer.byteLength(text),
    reading: 'parsed-in-full; excerpts reviewed', licence: 'Hamiltonian Interface (project-internal)', note: `chip repository snapshot ${snapshot.commit.slice(0, 7)}` });
  for (const m of h.modules.filter((x) => x.file === file)) {
    const insts = h.instances.filter((i) => i.module === m.name).map((i) => i.path.split('/').slice(1).join('/'));
    const body = [
      `module ${m.name}`,
      m.doc,
      insts.length ? `Instantiated in the chip as: ${insts.join(', ')}.` : `Not instantiated under ${h.top}.`,
      m.instances.length ? `Contains instances: ${m.instances.map((i) => `${i.name} (${i.module})`).join(', ')}.` : '',
      `Ports: ${m.ports.map((p) => p.name).join(', ')}.`,
      m.suites.length ? `Exercised by executed suites: ${m.suites.join(', ')}.` : 'No executed suite in the recorded verification exercises this module.',
    ].filter(Boolean).join('\n');
    // instance names are primary identifiers in this codebase, so they go in the (weighted) heading
    const names = [...new Set(h.instances.filter((i) => i.module === m.name).map((i) => i.name))];
    addChunk(doc, { text: body, heading: `module ${m.name}${names.length ? ` (instance ${names.join(', ')})` : ''}`, loc: `chip/${m.file}:${m.lineStart}-${m.lineEnd}`, lineStart: m.lineStart, lineEnd: m.lineEnd });
  }
}

// 3 · studio cards (curated, cited explanations) ────────────────────────────────────────────────────────────────
const cite = (ids) => (ids.length ? ` [${ids.map((id) => { const s = SOURCES[id]; return s ? `${s.authors.split(',')[0]} ${s.year}` : id; }).join('; ')}]` : '');
{
  const src = readFileSync(join(root, 'src/atlas/content/regions.ts'), 'utf8');
  const doc = addDoc({ id: 'card:regions', title: 'Region cards (studio)', kind: 'studio card', path: 'src/atlas/content/regions.ts', sha256: sha(src), bytes: Buffer.byteLength(src), reading: 'authored in this build' });
  for (const c of REGION_CARDS) {
    const sec = (name, claims) => claims.length && addChunk(doc, { heading: `${c.key} › ${name}`, loc: `src/atlas/content/regions.ts#${c.key}/${name}`, text: claims.map((x) => `${x.text}${cite(x.sources)} (${x.kind})`).join('\n') });
    addChunk(doc, { heading: `${c.key} › summary`, loc: `src/atlas/content/regions.ts#${c.key}/summary`, text: `${c.key}: ${c.summary}${cite(c.summarySources)}${c.caution ? `\n${c.caution.title}. ${c.caution.body}${cite(c.caution.sources)}` : ''}` });
    sec('where it is', c.location); sec('what it does', c.functions); sec('BCI relevance', c.bci); sec('limits', c.limits);
  }
}
{
  const src = readFileSync(join(root, 'src/journey/stages.ts'), 'utf8');
  const doc = addDoc({ id: 'card:stages', title: 'Signal-journey stages (studio)', kind: 'studio card', path: 'src/journey/stages.ts', sha256: sha(src), bytes: Buffer.byteLength(src), reading: 'authored in this build' });
  for (const s of STAGES) {
    addChunk(doc, { heading: s.title, loc: `src/journey/stages.ts#${s.id}`, text: [
      `${s.title} (${s.realisation === 'chip-rtl' ? 'implemented in our RTL' : s.realisation === 'external' ? 'external hardware, not implemented in our repository' : s.realisation}).`,
      s.purpose, `Input: ${s.input}`, `Output: ${s.output}`, s.notToBeConfusedWith ?? '', ...s.assumptions,
      s.chipInstances ? `Chip instances: ${s.chipInstances.map((p) => p.split('/').slice(1).join('/')).join(', ')}.` : '',
    ].filter(Boolean).join('\n') + cite(s.sources) });
  }
}

// 4 · this repository's documents ───────────────────────────────────────────────────────────────────────────────
// (SOURCE_AUDIT.md and HANDOVER.md describe the corpus and its evaluation themselves, so they are left out of it)
const META_DOCS = new Set(['SOURCE_AUDIT.md', 'HANDOVER.md']);
for (const n of existsSync(join(root, 'docs')) ? readdirSync(join(root, 'docs')).filter((x) => x.endsWith('.md') && !META_DOCS.has(x)).sort() : []) {
  const f = `docs/${n}`, text = readFileSync(join(root, f), 'utf8');
  const doc = addDoc({ id: `studio:${n}`, title: (/^#\s+(.*)$/m.exec(text)?.[1] ?? n).trim(), kind: 'studio document', path: f, sha256: sha(text), bytes: Buffer.byteLength(text), reading: 'authored in this build' });
  chunkText(doc, text, f);
}

// 5 · private material (never committed) ────────────────────────────────────────────────────────────────────────
const absDir = join(root, 'corpus/private/abstracts');
for (const n of existsSync(absDir) ? readdirSync(absDir).filter((x) => x.endsWith('.txt')).sort() : []) {
  const id = n.replace(/\.txt$/, ''), text = readFileSync(join(absDir, n), 'utf8'), s = SOURCES[id];
  const doc = addDoc({ id: `abs:${id}`, title: s ? `${s.title} (abstract)` : id, kind: 'published abstract', path: rel(join(absDir, n)), sha256: sha(text), bytes: Buffer.byteLength(text), visibility: 'private',
    reading: s?.reading ?? 'indexed', licence: 'Publisher / PubMed abstract — local use only', note: s?.doi ? `doi:${s.doi}` : null });
  addChunk(doc, { heading: 'Abstract', loc: `${rel(join(absDir, n))}:1-${text.split('\n').length}`, lineStart: 1, lineEnd: text.split('\n').length, text });
}
const inbox = join(root, 'corpus/private/inbox');
for (const n of existsSync(inbox) ? readdirSync(inbox).filter((x) => /\.(md|txt)$/.test(x)).sort() : []) {
  const text = readFileSync(join(inbox, n), 'utf8');
  const doc = addDoc({ id: `user:${n}`, title: n, kind: 'user-supplied source', path: rel(join(inbox, n)), sha256: sha(text), bytes: Buffer.byteLength(text), visibility: 'private', reading: 'indexed', licence: 'unknown — local use only' });
  chunkText(doc, text, rel(join(inbox, n)));
}

// write the database ────────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(dirname(OUT), { recursive: true });
for (const f of [OUT, `${OUT}-journal`, `${OUT}-wal`, `${OUT}-shm`]) rmSync(f, { force: true });
const db = new DatabaseSync(OUT);
db.exec(`
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE documents(id TEXT PRIMARY KEY, title TEXT, kind TEXT, path TEXT, sha256 TEXT, bytes INTEGER, licence TEXT, visibility TEXT, reading TEXT, note TEXT, n_chunks INTEGER);
  CREATE VIRTUAL TABLE chunks USING fts5(text, heading, doc_id UNINDEXED, loc UNINDEXED, line_start UNINDEXED, line_end UNINDEXED, page UNINDEXED, tokenize = 'porter unicode61');
`);
const builtAt = new Date().toISOString();
db.prepare('INSERT INTO meta VALUES (?, ?)').run('builtAt', builtAt);
db.prepare('INSERT INTO meta VALUES (?, ?)').run('chipCommit', snapshot.commit);
const insD = db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const insC = db.prepare('INSERT INTO chunks(text, heading, doc_id, loc, line_start, line_end, page) VALUES (?,?,?,?,?,?,?)');
db.exec('BEGIN');
for (const d of docs) insD.run(d.id, d.title, d.kind, d.path, d.sha256, d.bytes, d.licence, d.visibility, d.reading, d.note, d.chunks);
for (const c of chunks) insC.run(c.text, c.heading, c.docId, c.loc, c.lineStart, c.lineEnd, c.page);
db.exec('COMMIT');
db.close();

if (WRITE_MANIFEST) {
  const notes = JSON.parse(readFileSync(join(root, 'corpus/inventory-notes.json'), 'utf8'));
  mkdirSync(join(root, 'public/corpus'), { recursive: true });
  writeFileSync(join(root, 'public/corpus/manifest.json'), JSON.stringify({
    generatedBy: 'tools/corpus/build-index.mjs', builtAt, chipCommit: snapshot.commit,
    retrieval: 'SQLite FTS5 (porter stemming), BM25 ranking, heading weighted ×3. Keyword retrieval only: no embeddings and no language model.',
    documents: docs.map(({ id, title, kind, path, sha256, bytes, licence, visibility, reading, note, chunks: n }) => ({ id, title, kind, path, sha256, bytes, licence, visibility, reading, note, chunks: n })),
    totals: { documents: docs.length, chunks: chunks.length, private: docs.filter((d) => d.visibility === 'private').length },
    ...notes,
  }, null, 1));
}
const byKind = {};
for (const d of docs) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
console.log(`${docs.length} documents, ${chunks.length} chunks → ${rel(OUT)} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`);
console.log('  ' + Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(' · '));
