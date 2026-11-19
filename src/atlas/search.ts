// Atlas search: structure / group names plus a small synonym table. Pure (no React, no DOM); tested in
// tests/atlas-search.test.ts.
import { SYNONYMS } from './content/synonyms.ts';
import { cardKey } from './content/regions.ts';
import type { TreeNode } from './types.ts';

function norm(s: string) { return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

export interface SearchHit { id: string; name: string; via: string | null; note: string | null; kind: 'group' | 'structure'; score: number }

/** Rank: exact name > name prefix > word prefix > synonym > substring. Pure; tested in tests/atlas-search.test.ts. */
export function searchAtlas(query: string, nodes: Iterable<TreeNode>, limit = 30): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const out: SearchHit[] = [];
  for (const n of nodes) {
    const name = norm(n.name);
    let score = 0, via: string | null = null, note: string | null = null;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 60;
    else if (name.includes(q)) score = 40;
    const syn = SYNONYMS[cardKey(n.name)];
    if (syn) {
      for (const s of syn.terms) {
        const t = norm(s);
        const sc = t === q ? 75 : t.startsWith(q) ? 55 : t.includes(q) ? 35 : 0;
        if (sc > score) { score = sc; via = s; note = syn.note ?? null; }
      }
    }
    if (score > 0) out.push({ id: n.id, name: n.name, via, note, kind: n.kind, score: score - (n.kind === 'group' ? 1 : 0) });
  }
  out.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}
