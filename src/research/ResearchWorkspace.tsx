// Research: search the local source corpus and read the evidence, with exact locations.
// This is keyword retrieval (SQLite FTS5) served by the local dev/preview server. It shows passages; it does not
// generate answers. When the corpus cannot support a query, the screen says so.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from '../shell/shellStore';
import { useAtlas } from '../atlas/atlasStore';
import { cardFor } from '../atlas/content/regions';
import { SOURCES } from '../science/sources';
import { SourceList } from '../science/Cite';
import { JourneyRail } from '../kit/kit';
import './research.css';

interface Hit {
  chunkId: number; docId: string; title: string; kind: string; visibility: 'public' | 'private'; reading: string; heading: string; loc: string;
  lineStart: number | null; lineEnd: number | null; page: number | null; snippet: string; score: number; matchedTerms: number; side?: 'both' | 'a' | 'b';
}
interface SearchResult { query: string; terms: string[]; mode: 'all' | 'any' | 'comparison' | 'none'; hits: Hit[]; coverage: number; sides?: Array<{ terms: string[]; found: boolean }>; unsupported: boolean }
interface Manifest {
  builtAt: string; chipCommit: string; retrieval: string;
  documents: Array<{ id: string; title: string; kind: string; path: string; sha256: string; bytes: number; licence: string | null; visibility: string; reading: string; note: string | null; chunks: number }>;
  totals: { documents: number; chunks: number; private: number };
  searchedLocations: string[];
  missing: Array<{ what: string; status: string; detail: string }>;
  answering: { modelConfigured: boolean; statement: string };
}

const READING_LABEL: Record<string, string> = {
  indexed: 'Indexed only — not read in this build',
  'excerpt-reviewed': 'Excerpts reviewed',
  'fully-reviewed': 'Read in full',
  'abstract-reviewed': 'Abstract read; full text not retrieved',
  'abstract-excerpt-reviewed': 'Key sentences of the abstract reviewed',
  'metadata-verified': 'Bibliographic record verified only',
  'authored in this build': 'Written in this build',
  'parsed-in-full; excerpts reviewed': 'Parsed in full by script; excerpts reviewed',
};
const SUGGESTED = ['motor cortex', 'AFE versus ADC', 'MUX types', 'u_state versus u_fstate', 'implemented versus conceptual hardware', 'has the chip been fabricated'];

/** Render "[[matched]]" markers as <mark>. The passage is inserted as text, never as HTML. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[\[[\s\S]*?\]\])/g);
  return <>{parts.map((p, i) => (p.startsWith('[[') && p.endsWith(']]') ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>))}</>;
}

function Passage({ hit, sides }: { hit: Hit; sides?: SearchResult['sides'] }) {
  const [full, setFull] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && full === null) {
      try {
        const r = await fetch(`/api/corpus/chunk?id=${hit.chunkId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setFull(((await r.json()) as { text: string }).text);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    }
  };
  const sideLabel = hit.side && sides ? (hit.side === 'both' ? 'mentions both' : `about: ${sides[hit.side === 'a' ? 0 : 1].terms.join(' ')}`) : null;
  return (
    <li className="hit" data-testid="hit" data-doc={hit.docId}>
      <div className="hit-head">
        <span className={`rs-kind rs-kind-${hit.kind.replace(/\s+/g, '-')}`}>{hit.kind}</span>
        {hit.visibility === 'private' && <span className="priv" title="Stored only on this computer; not part of the repository or any bundle">local only</span>}
        {sideLabel && <span className="side">{sideLabel}</span>}
        <strong className="hit-title">{hit.title}</strong>
      </div>
      {hit.heading && <div className="hit-heading">{hit.heading}</div>}
      <p className="hit-snip"><Marked text={hit.snippet} /></p>
      <div className="hit-foot">
        <span className="mono loc" data-testid="hit-loc" title="Exact location of this passage">{hit.loc}{hit.page !== null ? ` · page ${hit.page}` : ''}</span>
        <span className="muted">{READING_LABEL[hit.reading] ?? hit.reading}</span>
        <button type="button" className="btn-link inline" onClick={toggle} aria-expanded={open}>{open ? 'Hide passage' : 'Show the whole passage'}</button>
      </div>
      {open && (err ? <p className="warn-text">Could not load the passage ({err}).</p> : full === null ? <p className="muted">Loading…</p> : <pre className="passage" data-testid="passage">{full}</pre>)}
    </li>
  );
}

export default function ResearchWorkspace() {
  const handed = useShell((s) => s.researchQuery);
  const go = useShell((s) => s.go);
  const regionId = useAtlas((s) => s.selectedId);
  const tree = useAtlas((s) => s.tree);
  const [q, setQ] = useState(handed);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [service, setService] = useState<{ state: 'checking' | 'ready' | 'unavailable'; detail?: string; documents?: number; chunks?: number }>({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestErr, setManifestErr] = useState<string | null>(null);
  const seq = useRef(0);

  // the selected region, and the sources its card rests on
  const region = useMemo(() => {
    const node = regionId ? tree.get(regionId) : undefined;
    if (!node) return null;
    const chain: string[] = [];
    let n: typeof node | undefined = node;
    while (n) { chain.push(n.name); n = n.parentId ? tree.get(n.parentId) : undefined; }
    const card = cardFor(chain)?.card ?? null;
    const ids = card ? [...new Set([...card.summarySources, ...(card.caution?.sources ?? []), ...[...card.location, ...card.functions, ...card.bci, ...card.limits].flatMap((c) => c.sources)])].filter((id) => SOURCES[id]) : [];
    return { name: node.name, key: card?.key ?? null, sources: ids };
  }, [regionId, tree]);

  useEffect(() => {
    let live = true;
    fetch('/api/corpus/status').then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!live) return;
      if (r.ok) setService({ state: 'ready', documents: body.documents, chunks: body.chunks });
      else setService({ state: 'unavailable', detail: body.error ?? `HTTP ${r.status}` });
    }).catch(() => { if (live) setService({ state: 'unavailable', detail: 'The local search service is not running. It is part of the development and preview servers (npm run dev / npm run preview); a plain static copy of the site has no search.' }); });
    fetch(`${import.meta.env.BASE_URL}corpus/manifest.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((m) => { if (live) setManifest(m as Manifest); }).catch((e) => { if (live) setManifestErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  const run = async (text: string) => {
    const query = text.trim();
    setQ(text);
    if (!query) { setResult(null); return; }
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await fetch(`/api/corpus/search?q=${encodeURIComponent(query)}&limit=12`);
      const body = await r.json();
      if (mine !== seq.current) return;
      if (!r.ok) { setService({ state: 'unavailable', detail: body.error ?? `HTTP ${r.status}` }); setResult(null); } else setResult(body as SearchResult);
    } catch {
      if (mine === seq.current) { setService({ state: 'unavailable', detail: 'The local search service did not answer.' }); setResult(null); }
    } finally { if (mine === seq.current) setBusy(false); }
  };
  useEffect(() => { if (handed && service.state === 'ready') void run(handed); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [handed, service.state]);

  const byKind = useMemo(() => {
    const m = new Map<string, Manifest['documents']>();
    for (const d of manifest?.documents ?? []) m.set(d.kind, [...(m.get(d.kind) ?? []), d]);
    return [...m.entries()];
  }, [manifest]);

  return (
    <div className="page research cine" data-testid="research-workspace">
      <div className="page-inner">
        <header>
          <h1>Research</h1>
          <p className="lede">Search the sources this studio rests on — the project’s documents, the chip’s RTL, the curated explanations and the abstracts of the cited papers — and read the passages with their exact locations.</p>
          <p className="rs-note" role="note" data-testid="no-model">
            <strong>Passages, not answers.</strong> {manifest?.answering.statement ?? 'No language-model provider is configured; nothing on this screen is generated.'}
          </p>
        </header>

        <section className="card" aria-label="Search the corpus">
          <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. AFE versus ADC, u_state versus u_fstate, motor cortex" aria-label="Search the local source corpus" data-testid="research-q" disabled={service.state === 'unavailable'} />
            <button type="submit" className="btn btn-primary" disabled={service.state !== 'ready' || busy} data-testid="research-go">Search</button>
          </form>
          <div className="suggest" role="group" aria-label="Example searches">
            {[...(region?.key ? [region.key] : []), ...SUGGESTED].map((s) => <button key={s} type="button" className="btn" onClick={() => void run(s)} disabled={service.state !== 'ready'}>{s}</button>)}
          </div>
          <p className="svc" data-testid="svc" data-state={service.state}>
            {service.state === 'checking' && 'Checking the local search service…'}
            {service.state === 'ready' && <>Local index: {service.documents} documents, {service.chunks} passages. {manifest?.retrieval}</>}
            {service.state === 'unavailable' && <span className="warn-text"><strong>Search is unavailable.</strong> {service.detail} The source inventory below is still shown.</span>}
          </p>

          {result && (
            <div className="results" data-testid="results" data-unsupported={result.unsupported} data-mode={result.mode}>
              {result.unsupported ? (
                <div className="unsupported" role="status" data-testid="unsupported">
                  <strong>The local corpus does not support this query.</strong>{' '}
                  {result.hits.length === 0
                    ? <>No passage contains {result.terms.length ? <>“{result.terms.join(' ')}”</> : 'any searchable term'}. Nothing is asserted.</>
                    : result.mode === 'comparison'
                      ? <>It has material on {result.sides!.filter((s) => s.found).map((s) => `“${s.terms.join(' ')}”`).join(' and ') || 'neither side'} but nothing on {result.sides!.filter((s) => !s.found).map((s) => `“${s.terms.join(' ')}”`).join(' and ')}.</>
                      : <>No passage holds more than {Math.round(result.coverage * 100)} % of the terms together. The passages below are only the closest partial matches — do not read them as an answer.</>}
                </div>
              ) : (
                <p className="found" role="status">
                  {result.hits.length} passage{result.hits.length > 1 ? 's' : ''} for “{result.terms.join(' ')}”
                  {result.mode === 'any' && <> — no single passage contains every term; these contain most of them</>}
                  {result.mode === 'comparison' && <> — a comparison: passages for each side are interleaved</>}.
                </p>
              )}
              <ol className="hits">{result.hits.map((h) => <Passage key={h.chunkId} hit={h} sides={result.sides} />)}</ol>
            </div>
          )}
        </section>

        {region && (
          <section className="card" aria-label="Sources for the selected region" data-testid="region-sources">
            <h2>Sources behind “{region.name}”</h2>
            {region.sources.length
              ? <SourceList ids={region.sources} />
              : <p className="muted">No curated explanation exists for this region yet, so there are no sources to list beyond the atlas itself.</p>}
            <button type="button" className="btn" onClick={() => go('brain')} data-testid="research-back">← Back to {region.name} in the brain</button>
          </section>
        )}

        <section className="card" aria-label="Source inventory" data-testid="inventory">
          <h2>Source inventory</h2>
          {manifestErr && <p className="warn-text" role="alert">The source inventory could not be loaded ({manifestErr}). Run <code>npm run corpus:build</code>.</p>}
          {manifest && (
            <>
              <p className="muted">{manifest.totals.documents} documents, {manifest.totals.chunks} passages; {manifest.totals.private} stored on this computer only. Index built {manifest.builtAt.slice(0, 16).replace('T', ' ')} UTC. Looked in: {manifest.searchedLocations.join('; ')}.</p>
              {byKind.map(([kind, docs]) => (
                <details key={kind} open={kind === 'project document'}>
                  <summary>{kind} ({docs.length})</summary>
                  <table className="inv">
                    <thead><tr><th>Document</th><th>Where</th><th>How far it was read</th><th>Passages</th></tr></thead>
                    <tbody>
                      {docs.map((d) => (
                        <tr key={d.id}>
                          <td>{d.title}{d.visibility === 'private' && <span className="priv"> local only</span>}</td>
                          <td className="mono">{d.path}</td>
                          <td>{READING_LABEL[d.reading] ?? d.reading}</td>
                          <td className="num">{d.chunks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
              <h3>Not available — and therefore not used</h3>
              <ul className="missing" data-testid="missing">
                {manifest.missing.map((m) => <li key={m.what}><strong>{m.what}</strong> <span className="st-miss">{m.status}</span><br /><span className="muted">{m.detail}</span></li>)}
              </ul>
            </>
          )}
        </section>
        <JourneyRail prev={{ to: 'decoder', label: 'Back to the decoder', cue: '8 → 2' }} next={{ to: 'brain', label: 'Start again at the whole brain', cue: '15 cm' }} />
      </div>
    </div>
  );
}
