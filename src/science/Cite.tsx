// Citation chips, claim lists and evidence tags shared by every workspace.
import { SOURCES, sourceHref, type Source } from './sources';
import { CLAIM_KIND_LABEL, type Claim } from '../atlas/content/regions';
import './science.css';

/** The four evidence labels of the studio brief (§12). */
export type EvidenceLabel = 'measured' | 'synthetic' | 'schematic' | 'concept';
export const EVIDENCE_LABEL: Record<EvidenceLabel, { short: string; long: string }> = {
  measured: { short: 'Measured dataset', long: 'Derived from recorded or imaged data (here: MRI-based atlas files, or RTL simulation traces).' },
  synthetic: { short: 'Synthetic quantitative example', long: 'Numbers computed by a stated model from stated parameters and a seed. Not a recording.' },
  schematic: { short: 'Evidence-based schematic', long: 'A drawing that follows published findings but is not to scale and is not data.' },
  concept: { short: 'Conceptual / unvalidated', long: 'A design idea or placeholder. Not implemented and not validated.' },
};

export function EvidenceTag({ kind, title }: { kind: EvidenceLabel; title?: string }) {
  return (
    <span className={`evtag evtag-${kind}`} title={title ?? EVIDENCE_LABEL[kind].long} data-evidence={kind}>
      <span className="evtag-dot" aria-hidden="true" />
      {EVIDENCE_LABEL[kind].short}
    </span>
  );
}

function shortRef(s: Source): string {
  const first = s.authors.split(',')[0].replace(/\s+[A-Z-]+$/, '').trim();
  const many = s.authors.includes(',') || s.authors.includes('et al');
  return `${first}${many ? ' et al.' : ''} ${s.year}`;
}

/** Inline citation chips: "[Penfield et al. 1937]". Unknown ids are shown as an explicit error, never dropped. */
export function Cites({ ids, onOpen }: { ids: string[]; onOpen?: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <span className="cites">
      {ids.map((id) => {
        const s = SOURCES[id];
        if (!s) return <span key={id} className="cite cite-missing" title="This source id is not in the bibliography">missing source: {id}</span>;
        const href = sourceHref(s);
        const label = shortRef(s);
        const title = `${s.authors} (${s.year}). ${s.title}. ${s.venue}.`;
        if (onOpen) return <button key={id} type="button" className="cite" title={title} onClick={() => onOpen(id)}>{label}</button>;
        return href
          ? <a key={id} className="cite" href={href} target="_blank" rel="noreferrer noopener" title={title}>{label}</a>
          : <span key={id} className="cite" title={title}>{label}</span>;
      })}
    </span>
  );
}

export function ClaimList({ claims }: { claims: Claim[] }) {
  if (!claims.length) return <p className="muted">Nothing is asserted here for this region.</p>;
  return (
    <ul className="claims">
      {claims.map((c, i) => (
        <li key={i} className={`claim claim-${c.kind}`}>
          <span className="claim-text">{c.text}</span>
          <span className="claim-meta">
            <span className={`claim-kind kind-${c.kind}`}>{CLAIM_KIND_LABEL[c.kind]}</span>
            <Cites ids={c.sources} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const READING: Record<Source['reading'], string> = {
  'metadata-verified': 'Bibliographic record verified (Crossref); no abstract available, text not read in this build',
  'abstract-excerpt-reviewed': 'Key sentences of the abstract reviewed in this build',
  'abstract-reviewed': 'Abstract read in this build; full text not retrieved',
  'section-reviewed': 'Relevant sections reviewed',
  'fully-reviewed': 'Reviewed in full',
  'not-retrieved': 'Not retrieved; cited as general background only',
};

export function SourceList({ ids }: { ids: string[] }) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return <p className="muted">No sources are attached.</p>;
  return (
    <ol className="sourcelist">
      {uniq.map((id) => {
        const s = SOURCES[id];
        if (!s) return <li key={id} className="cite-missing">missing source: {id}</li>;
        const href = sourceHref(s);
        return (
          <li key={id} data-source-id={id}>
            <span className="src-authors">{s.authors}</span> ({s.year}). <span className="src-title">{s.title}</span>. <span className="src-venue">{s.venue}</span>.{' '}
            {href && <a href={href} target="_blank" rel="noreferrer noopener">{s.doi ? `doi:${s.doi}` : 'link'}</a>}
            <span className="src-reading">{READING[s.reading]}{s.note ? ` — ${s.note}` : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}
