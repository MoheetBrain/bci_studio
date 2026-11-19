// Fetch the PubMed abstract of every bibliography entry that has a DOI, into corpus/private/abstracts/ (gitignored:
// abstracts are publishers' text and stay on this machine). Used (a) to check studio statements against the abstract
// and (b) as searchable local evidence. Needs network. Usage: node tools/corpus/fetch-abstracts.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../../src/science/sources.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'corpus/private/abstracts');
mkdirSync(out, { recursive: true });
const E = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'abstract-fetch/1.0' } });
    if (res.ok) return res;
    await sleep(1200 * (i + 1));
  }
  throw new Error(`failed: ${url}`);
};

const index = [];
for (const s of Object.values(SOURCES)) {
  if (!s.doi) continue;
  const file = join(out, `${s.id}.txt`);
  let pmid = null, status = 'no-pubmed-record', words = 0;
  try {
    const found = await (await get(`${E}/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(s.doi)}%5Bdoi%5D`)).json();
    pmid = found.esearchresult?.idlist?.[0] ?? null;
    await sleep(400);
    if (pmid) {
      const xml = await (await get(`${E}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmid}`)).text();
      const parts = [...xml.matchAll(/<AbstractText(?:\s+Label="([^"]*)")?[^>]*>([\s\S]*?)<\/AbstractText>/g)]
        .map((m) => (m[1] ? `${m[1]}: ` : '') + m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).trim());
      const text = parts.join('\n\n');
      words = text ? text.split(/\s+/).length : 0;
      status = text ? 'abstract' : 'pubmed-record-without-abstract';
      if (text) {
        writeFileSync(file, `# ${s.title}\n${s.authors} (${s.year}). ${s.venue}. doi:${s.doi}. PMID ${pmid}.\nSource: PubMed abstract (retrieved ${new Date().toISOString().slice(0, 10)}).\n\n## Abstract\n${text}\n`);
      }
      await sleep(400);
    }
  } catch (e) {
    status = `error: ${e.message}`;
  }
  index.push({ id: s.id, doi: s.doi, pmid, status, words, file: existsSync(file) && status === 'abstract' ? `corpus/private/abstracts/${s.id}.txt` : null });
  console.log(`${status === 'abstract' ? '✓' : '·'} ${s.id.padEnd(16)} ${String(pmid ?? '—').padEnd(9)} ${status}${words ? ` (${words} words)` : ''}`);
}
writeFileSync(join(out, 'index.json'), JSON.stringify({ retrieved: new Date().toISOString(), entries: index }, null, 2));
console.log(`\n${index.filter((i) => i.status === 'abstract').length}/${index.length} abstracts stored in corpus/private/abstracts/ (not committed).`);
