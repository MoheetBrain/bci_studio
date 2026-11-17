// Verify the bibliography against Crossref: every DOI must resolve, and the registered title, year, volume and first
// page must agree with what the studio prints. Needs network. Usage: node scripts/check-sources.mjs [--write]
// Exit code 1 on any mismatch. With --write the report is saved to docs/evidence/sources-check.txt.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SOURCES } from '../src/science/sources.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const norm = (s) => s.normalize('NFKD').replace(/<[^>]+>/g, '').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
let bad = 0, checked = 0;

say(`# Bibliography check against Crossref — ${new Date().toISOString()}`);
for (const s of Object.values(SOURCES)) {
  if (!s.doi) { say(`-  ${s.id}: no DOI (${s.kind}); not checkable here`); continue; }
  let msg;
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(s.doi)}`, { headers: { 'User-Agent': 'bci-studio-source-check/1.0' } });
    if (!res.ok) { say(`✗  ${s.id}: DOI ${s.doi} → HTTP ${res.status}`); bad++; continue; }
    msg = (await res.json()).message;
  } catch (e) {
    say(`✗  ${s.id}: request failed (${e.message})`); bad++; continue;
  }
  checked++;
  const title = (msg.title?.[0] ?? '') + (msg.subtitle?.[0] ? ' ' + msg.subtitle[0] : '');
  const years = [msg['published-print'], msg['published-online'], msg.issued, msg.published].map((d) => d?.['date-parts']?.[0]?.[0]).filter(Boolean);
  const a = norm(s.title), b = norm(title);
  const titleOk = a === b || b.startsWith(a) || a.startsWith(norm(msg.title?.[0] ?? '')) || (s.registryTitle !== undefined && norm(s.registryTitle) === b);
  const yearOk = years.includes(s.year);
  const vol = /(\d+)\(/.exec(s.venue)?.[1] ?? /\s(\d+):/.exec(s.venue)?.[1];
  const volOk = !vol || !msg.volume || String(msg.volume) === vol;
  const firstPage = /:([0-9a-z]+)[–-]?/i.exec(s.venue)?.[1];
  const page = String(msg.page ?? msg['article-number'] ?? '');
  const pageOk = !firstPage || !page || page.toLowerCase().startsWith(firstPage.toLowerCase());
  const family = msg.author?.[0]?.family ?? '';
  const authorOk = !family || norm(s.authors).startsWith(norm(family).split(' ').pop());
  const ok = titleOk && yearOk && volOk && pageOk && authorOk;
  if (!ok) bad++;
  say(`${ok ? '✓' : '✗'}  ${s.id}: ${s.doi}`);
  if (!ok) {
    if (!titleOk) say(`     title    studio: ${s.title}\n              crossref: ${title}`);
    if (!yearOk) say(`     year     studio: ${s.year}  crossref: ${years.join('/')}`);
    if (!volOk) say(`     volume   studio: ${vol}  crossref: ${msg.volume}`);
    if (!pageOk) say(`     page     studio: ${firstPage}  crossref: ${page}`);
    if (!authorOk) say(`     author   studio: ${s.authors}  crossref first author: ${family}`);
  }
}
say(`\n${checked} DOIs checked, ${bad} problem(s).`);
if (process.argv.includes('--write')) {
  mkdirSync(join(root, 'docs/evidence'), { recursive: true });
  writeFileSync(join(root, 'docs/evidence/sources-check.txt'), lines.join('\n') + '\n');
}
process.exit(bad ? 1 : 0);
