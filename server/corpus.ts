// Local full-text retrieval over the source corpus (SQLite FTS5, BM25). Used by the dev/preview server plugin and
// by the tests. This is keyword retrieval: it returns passages with exact locations. It is not an answer generator.
//
// Safety properties (tested in tests/corpus.test.ts):
//   • the database is opened read-only, and the only inputs are a query string, a limit and a numeric chunk id —
//     there is no path parameter, so the service cannot be steered to another file;
//   • the user's text never reaches FTS5 as syntax: every token is quoted, operators and column filters are inert;
//   • retrieved text is returned as data (with [[ ]] markers around matched terms) and is never executed or followed.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

export interface Hit {
  chunkId: number;
  docId: string;
  title: string;
  kind: string;
  visibility: 'public' | 'private';
  reading: string;
  heading: string;
  /** Exact location: a repository path with a line range, or a page, or a card anchor. */
  loc: string;
  lineStart: number | null;
  lineEnd: number | null;
  page: number | null;
  /** Passage with [[matched]] terms marked. */
  snippet: string;
  /** BM25 rank (lower is better; negative numbers, as SQLite reports them). */
  score: number;
  matchedTerms: number;
  /** For "A versus B" questions: which side this passage answers. */
  side?: 'both' | 'a' | 'b';
}

export interface SearchResult {
  query: string;
  /** The tokens actually searched for (after sanitising). */
  terms: string[];
  /**
   * 'all'  every term found in one passage;  'any'  relaxed because no passage holds all terms;
   * 'comparison'  an "A versus B" question, answered with passages for each side;  'none'  nothing found.
   */
  mode: 'all' | 'any' | 'comparison' | 'none';
  hits: Hit[];
  /** Largest share of the query's terms found together in one passage (0…1). */
  coverage: number;
  /** For comparisons: the two sides and whether the corpus has anything on each. */
  sides?: Array<{ terms: string[]; found: boolean }>;
  /** True when the corpus cannot support this query (no passage, or only scattered partial matches): the caller must say so rather than answer. */
  unsupported: boolean;
}

// Function words, plus "question scaffolding" words that describe the question rather than its subject.
const STOP = new Set(('a an and are as at be been by can do does for from has have how in is it its of on one only or our same the there this to was what '
  + 'which why with kind kinds type types sort sorts many much').split(' '));
// Domain abbreviations ↔ their expansions (either may appear in the sources). Stemming already merges
// multiplexer / multiplexing / multiplexed, so one spelling per concept is enough.
const SYNONYMS: Record<string, string[]> = {
  mux: ['multiplexer'], multiplexer: ['mux'], multiplexers: ['mux'], muxes: ['multiplexer', 'mux'],
  afe: ['analogue front end', 'analog front end'],
  adc: ['analogue to digital converter', 'analog to digital converter'],
  m1: ['primary motor cortex'], s1: ['primary somatosensory cortex'],
  lfp: ['local field potential', 'field potential'], ecog: ['electrocorticographic', 'electrocorticography'],
  bci: ['brain computer interface'], rtl: ['verilog'],
};

/** Turn free text into safe FTS5 terms: letters, digits and underscores only; each will be quoted. */
export function tokenize(query: string): string[] {
  const out: string[] = [];
  for (const raw of String(query).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (!raw || raw.length > 40) continue;
    if (STOP.has(raw) || raw === 'vs' || raw === 'versus') continue;
    if (!out.includes(raw)) out.push(raw);
    if (out.length >= 12) break;
  }
  return out;
}
const quote = (t: string) => `"${t.replace(/"/g, '')}"`;
/** One term as an FTS5 expression: itself, or an OR-group with its domain synonyms. Everything is quoted. */
const group = (t: string) => (SYNONYMS[t] ? `(${[t, ...SYNONYMS[t]].map(quote).join(' OR ')})` : quote(t));

/** Split "A versus B" / "difference between A and B" into its two sides. */
export function comparisonSides(query: string): [string, string] | null {
  const q = String(query);
  const m = /^(.*?)\b(?:vs\.?|versus|compared (?:to|with))\b(.*)$/i.exec(q) ?? /^.*?\bdifference between\b(.*?)\band\b(.*)$/i.exec(q);
  if (!m) return null;
  return tokenize(m[1]).length && tokenize(m[2]).length ? [m[1], m[2]] : null;
}

type Row = Omit<Hit, 'matchedTerms'> & { hlText: string; hlHead: string };

export class Corpus {
  private db: DatabaseSync;
  constructor(file: string) {
    if (!existsSync(file)) throw new Error(`corpus index not found at ${file}`);
    this.db = new DatabaseSync(file, { readOnly: true });
  }

  status(): { documents: number; chunks: number; builtAt: string | null } {
    const d = this.db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number };
    const c = this.db.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number };
    const m = this.db.prepare("SELECT value FROM meta WHERE key = 'builtAt'").get() as { value: string } | undefined;
    return { documents: d.n, chunks: c.n, builtAt: m?.value ?? null };
  }

  private run(expr: string, terms: string[], lim: number): Hit[] {
    // A term counts as matched in a passage when a highlighted word shares its stem prefix (porter stemming is on).
    const all = terms.map((t) => [t, ...(SYNONYMS[t] ?? []).flatMap((s) => s.split(' '))]);
    const matched = (hl: string) => {
      const words = [...hl.matchAll(/\[\[([^\]]+)\]\]/g)].flatMap((m) => m[1].toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(Boolean);
      return all.filter((alts) => alts.some((t) => t.split('_').filter(Boolean).every((part) => words.some((w) => w.startsWith(part.slice(0, Math.min(4, part.length))))))).length;
    };
    const rows = this.db.prepare(`
      SELECT chunks.rowid AS chunkId, chunks.doc_id AS docId, d.title AS title, d.kind AS kind, d.visibility AS visibility, d.reading AS reading,
             chunks.heading AS heading, chunks.loc AS loc, chunks.line_start AS lineStart, chunks.line_end AS lineEnd, chunks.page AS page,
             snippet(chunks, 0, '[[', ']]', ' … ', 40) AS snippet, bm25(chunks, 1.0, 3.0) AS score,
             highlight(chunks, 0, '[[', ']]') AS hlText, highlight(chunks, 1, '[[', ']]') AS hlHead
      FROM chunks JOIN documents d ON d.id = chunks.doc_id
      WHERE chunks MATCH ? ORDER BY score LIMIT ?`).all(expr, lim) as unknown as Row[];
    return rows.map(({ hlText, hlHead, ...h }) => ({ ...h, matchedTerms: matched(`${hlText} ${hlHead}`) }));
  }

  /** All terms in one passage if possible, otherwise any term; `coverage` says how complete the best passage is. */
  private basic(terms: string[], lim: number): { mode: 'all' | 'any' | 'none'; hits: Hit[]; coverage: number } {
    if (!terms.length) return { mode: 'none', hits: [], coverage: 0 };
    const cols = '{text heading} : '; // search the passage text and its heading only
    let hits = this.run(cols + terms.map(group).join(' AND '), terms, lim);
    let mode: 'all' | 'any' | 'none' = 'all';
    if (!hits.length && terms.length > 1) { hits = this.run(cols + terms.map(group).join(' OR '), terms, lim); mode = 'any'; }
    if (!hits.length) mode = 'none';
    return { mode, hits, coverage: hits.length ? Math.max(...hits.map((h) => h.matchedTerms)) / terms.length : 0 };
  }

  search(query: string, limit = 12): SearchResult {
    const q = String(query).slice(0, 300);
    const terms = tokenize(q);
    const lim = Math.max(1, Math.min(50, Math.floor(Number(limit)) || 12));
    if (!terms.length) return { query: q, terms, mode: 'none', hits: [], coverage: 0, unsupported: true };

    // "A versus B": no single passage need mention both, so retrieve each side as well and interleave.
    const sides = comparisonSides(q);
    if (sides) {
      const [ta, tb] = [tokenize(sides[0]), tokenize(sides[1])];
      const both = this.basic(terms, lim), a = this.basic(ta, lim), b = this.basic(tb, lim);
      const okA = a.mode !== 'none' && a.coverage >= 0.6, okB = b.mode !== 'none' && b.coverage >= 0.6;
      const lists: Array<[Hit[], 'both' | 'a' | 'b']> = [[both.mode === 'all' ? both.hits : [], 'both'], [okA ? a.hits : [], 'a'], [okB ? b.hits : [], 'b']];
      const seen = new Set<number>();
      const hits: Hit[] = [];
      for (let i = 0; hits.length < lim && lists.some(([l]) => i < l.length); i++) {
        for (const [l, side] of lists) {
          const h = l[i];
          if (h && !seen.has(h.chunkId) && hits.length < lim) { seen.add(h.chunkId); hits.push({ ...h, side }); }
        }
      }
      return {
        query: q, terms, mode: hits.length ? 'comparison' : 'none', hits, coverage: okA && okB ? 1 : okA || okB ? 0.5 : 0,
        sides: [{ terms: ta, found: okA }, { terms: tb, found: okB }],
        // a comparison is supported only if the corpus has something on BOTH sides
        unsupported: !(okA && okB),
      };
    }

    const r = this.basic(terms, lim);
    // "Unsupported" = the corpus has nothing, or the best passage matches fewer than 60 % of what was asked.
    return { query: q, terms, mode: r.mode, hits: r.hits, coverage: r.coverage, unsupported: r.hits.length === 0 || (r.mode === 'any' && r.coverage < 0.6) };
  }

  /** Full text of one chunk, by numeric id. */
  chunk(id: number): { chunkId: number; docId: string; title: string; heading: string; loc: string; text: string } | null {
    if (!Number.isInteger(id) || id < 1) return null;
    const r = this.db.prepare('SELECT chunks.rowid AS chunkId, chunks.doc_id AS docId, d.title AS title, chunks.heading AS heading, chunks.loc AS loc, chunks.text AS text FROM chunks JOIN documents d ON d.id = chunks.doc_id WHERE chunks.rowid = ?').get(id);
    return (r as ReturnType<Corpus['chunk']>) ?? null;
  }

  close() { this.db.close(); }
}
