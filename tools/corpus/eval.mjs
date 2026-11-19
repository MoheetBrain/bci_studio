// Evaluate keyword retrieval on the held-out question set (tests/corpus-eval.json).
//   node tools/corpus/eval.mjs [--write]     → prints the report; --write saves docs/evidence/retrieval-eval.txt
// Exported `evaluate` is also used by tests/corpus.test.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function evaluate(corpus, { hasPrivate, file = 'tests/corpus-eval.json' }) {
  const set = JSON.parse(readFileSync(join(root, file), 'utf8'));
  const rows = set.questions.map((q) => {
    const r = corpus.search(q.q, 10);
    const top = r.hits.slice(0, set.k).map((h) => h.docId);
    if (q.unanswerable) return { ...q, kind: 'unanswerable', pass: r.unsupported, skipped: false, top, mode: r.mode, coverage: r.coverage };
    if (q.private && !hasPrivate) return { ...q, kind: 'answerable', pass: null, skipped: true, top, mode: r.mode, coverage: r.coverage };
    const expect = q.expect.filter((id) => hasPrivate || !id.startsWith('abs:'));
    const rank = r.hits.findIndex((h) => expect.includes(h.docId));
    return { ...q, kind: 'answerable', pass: !r.unsupported && rank >= 0 && rank < set.k, skipped: false, rank: rank < 0 ? null : rank + 1, top, mode: r.mode, coverage: r.coverage };
  });
  const ans = rows.filter((r) => r.kind === 'answerable' && !r.skipped), un = rows.filter((r) => r.kind === 'unanswerable');
  return {
    set: set.set, file, k: set.k, rows,
    answerable: { n: ans.length, hit: ans.filter((r) => r.pass).length, top1: ans.filter((r) => r.rank === 1).length, skipped: rows.filter((r) => r.skipped).length },
    unanswerable: { n: un.length, refused: un.filter((r) => r.pass).length },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { Corpus } = await import('../../server/corpus.ts');
  const file = join(root, 'corpus/index.sqlite');
  if (!existsSync(file)) { console.error('corpus/index.sqlite not found — run npm run corpus:build'); process.exit(2); }
  const corpus = new Corpus(file);
  const hasPrivate = existsSync(join(root, 'corpus/private/abstracts/index.json'));
  const st = corpus.status();
  const lines = [
    `# Retrieval evaluation — ${new Date().toISOString()}`,
    `Index: ${st.documents} documents, ${st.chunks} passages (built ${st.builtAt}). Private abstracts present: ${hasPrivate}.`,
    'Method: SQLite FTS5 keyword retrieval (porter stemming, BM25, heading ×3), domain synonyms, and per-side retrieval for "A versus B" questions.',
    'No embeddings and no language model. Results are passages with locations, not answers.',
  ];
  let ok = true;
  for (const file of ['tests/corpus-heldout.json', 'tests/corpus-eval.json']) {
    const e = evaluate(corpus, { hasPrivate, file });
    if (e.set === 'development') ok &&= e.answerable.hit === e.answerable.n && e.unanswerable.refused === e.unanswerable.n;
    lines.push('', `## ${e.set.toUpperCase()} set (${file})`,
      e.set === 'held-out' ? 'Written after the retrieval rules were frozen; never used to adjust them.' : 'Visible during development; a perfect score here is expected and proves little.',
      `Answerable: expected document in the top ${e.k}: ${e.answerable.hit}/${e.answerable.n}  (top-1: ${e.answerable.top1}/${e.answerable.n}; skipped for missing private material: ${e.answerable.skipped})`,
      `Unanswerable correctly reported as unsupported: ${e.unanswerable.refused}/${e.unanswerable.n}`, '',
      ...e.rows.map((r) => `${r.skipped ? '–' : r.pass ? '✓' : '✗'} ${r.kind === 'unanswerable' ? '[unanswerable] ' : ''}${r.q}\n    ${r.kind === 'unanswerable' ? `mode ${r.mode}, coverage ${r.coverage.toFixed(2)}` : `rank ${r.rank ?? '—'}, mode ${r.mode}`}; top ${e.k}: ${r.top.join(', ') || '(none)'}`));
  }
  lines.push('', 'Semantic (embedding) retrieval was NOT added: no measurement here shows it would beat this baseline, and the brief asks for it only on that evidence.');
  console.log(lines.join('\n'));
  if (process.argv.includes('--write')) { mkdirSync(join(root, 'docs/evidence'), { recursive: true }); writeFileSync(join(root, 'docs/evidence/retrieval-eval.txt'), lines.join('\n') + '\n'); }
  corpus.close();
  process.exit(ok ? 0 : 1);
}
