// The five-part brief of a region (anatomy · function · BCI relevance · signal expectations · what we don't know)
// and the BCI controls that go with it. Shown inside the brain scene's insight card.
//
// Three depths of content, never blurred together:
//   • a full dossier (two regions in this build) — reviewed, cited text;
//   • an older summary card — its claims are sorted into the same five parts;
//   • nothing curated — the atlas-derived anatomy only, and an explicit "not written yet" for the rest.
import { useMemo, useState } from 'react';
import { useAtlas } from '../atlas/atlasStore';
import { bestSiteOf } from '../atlas/AtlasScene';
import { regionNeighbours, regionVertexCounts } from '../atlas/neighbours';
import type { RegionCard, Claim } from '../atlas/content/regions';
import type { AtlasStructure } from '../atlas/types';
import { ClaimList } from '../science/Cite';
import { useShell } from '../shell/shellStore';
import { BRIEF_SECTIONS, dossierFor, EBRAINS_VIEWER, type BriefSection } from './content/dossiers';
import { experimentFor, useImplant } from './implantStore';
import { Prov } from './Prov';
import './experiment.css';

/** Atlas-derived facts about a structure's place on the surface. Computed once per atlas, from labels and mesh edges. */
function useSurfaceFacts(s: AtlasStructure | undefined) {
  const specimen = useAtlas((st) => st.specimen);
  const manifest = useAtlas((st) => st.manifest);
  const tables = useMemo(() => (specimen ? { nb: regionNeighbours(specimen.region, specimen.adj), counts: regionVertexCounts(specimen.region) } : null), [specimen]);
  return useMemo(() => {
    if (!s || !specimen || !manifest || !tables) return null;
    const r = manifest.structures.findIndex((x) => x.id === s.id) + 1;
    const n = tables.counts[r];
    if (!r || !n) return null;
    const neighbours = (tables.nb.get(r) ?? []).map((x) => ({ ...x, s: manifest.structures[x.region - 1] }));
    const total = neighbours.reduce((a, x) => a + x.edges, 0) || 1;
    const areaCm2 = (specimen.meta.mesh.surfaceAreaMm2 * (n / specimen.region.length)) / 100;
    return { neighbours: neighbours.map((x) => ({ id: x.s.id, name: x.s.name, share: x.edges / total })), areaCm2, vertices: n };
  }, [s, specimen, manifest, tables]);
}

export function RegionBrief({ s, card, lobe }: { s: AtlasStructure | undefined; card: RegionCard | undefined; lobe: string | null }) {
  const [tab, setTab] = useState<BriefSection>('anatomy');
  const st = useAtlas.getState();
  const dossier = dossierFor(s?.name);
  const facts = useSurfaceFacts(s);

  // atlas-derived anatomy, the same for every region that reaches the surface
  const derived: Claim[] = [];
  if (s && facts) {
    derived.push({ text: `On this volunteer’s surface the label covers about ${facts.areaCm2 < 10 ? facts.areaCm2.toFixed(1) : Math.round(facts.areaCm2)} cm² of the rendered surface${lobe ? `, in the ${lobe.replace(/^(left|right) /, '')}` : ''} (${s.hemisphere === 'midline' ? 'midline' : `subject’s ${s.hemisphere}`}).`, kind: 'observed', sources: ['spl-atlas'] });
  }
  const sections: Record<BriefSection, Claim[]> = dossier
    ? { anatomy: [...dossier.anatomy, ...derived], function: dossier.function, bci: dossier.bci, signals: dossier.signals, unknowns: dossier.unknowns }
    : card
      ? { anatomy: [...card.location, ...derived], function: card.functions, bci: card.bci, signals: [], unknowns: card.limits }
      : { anatomy: derived, function: [], bci: [], signals: [], unknowns: [] };
  const empty: Record<BriefSection, string> = {
    anatomy: 'This structure does not reach the outer surface, so no surface facts are derived for it. Its atlas record is under the details below.',
    function: 'No reviewed, cited text about this region’s function has been written yet. Nothing is inferred from its position or shape.',
    bci: 'No reviewed account of recordings or stimulation in this region has been written yet. The studio makes no claim about what a BCI could do here.',
    signals: 'No reviewed signal expectations for this region. The atlas contains anatomy only — it says nothing about what an electrode here would record.',
    unknowns: 'Everything about this region’s function is outside what this build asserts. One volunteer’s anatomy; no functional map.',
  };

  return (
    <section className="brief" aria-label="Region brief" data-testid="region-brief" data-depth={dossier ? 'dossier' : card ? 'card' : 'atlas-only'}>
      {dossier && (
        <p className="brief-relation" data-testid="brief-relation"><strong>{dossier.title}.</strong> {dossier.relation}</p>
      )}
      <div className="brief-tabs" role="tablist" aria-label="What is known about this region">
        {BRIEF_SECTIONS.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={tab === b.id} className={`brief-tab${tab === b.id ? ' on' : ''}${sections[b.id].length ? '' : ' none'}`} title={b.hint} onClick={() => setTab(b.id)} data-testid={`brief-tab-${b.id}`}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="brief-panel" role="tabpanel" data-testid={`brief-panel-${tab}`}>
        {sections[tab].length > 0 ? <ClaimList claims={sections[tab]} /> : <p className="brief-none">{empty[tab]}</p>}
        {tab === 'anatomy' && facts && facts.neighbours.length > 0 && (
          <div className="brief-neighbours" data-testid="brief-neighbours">
            <div className="brief-sub">Borders on the surface <Prov kind="atlas" /></div>
            <ul>
              {facts.neighbours.slice(0, 7).map((n) => (
                <li key={n.id}>
                  <button type="button" className="crumb" onClick={() => { st.select(n.id); st.camera({ kind: 'fit', ids: st.idsOf(n.id) }); }} onMouseEnter={() => st.hover(n.id, 'tree')} onMouseLeave={() => st.hover(null)}>{n.name}</button>
                  <span className="brief-share" title="Share of this region’s border on the surface">{Math.max(1, Math.round(n.share * 100))} %</span>
                </li>
              ))}
            </ul>
            <p className="brief-fine">Counted from the label of every surface vertex and the mesh’s own edges. Sulci are separate atlas structures and are not on this list.</p>
          </div>
        )}
        {tab === 'anatomy' && dossier && (
          <p className="brief-fine">
            Cytoarchitectonic maps to compare with: <strong>{dossier.ebrains.areas}</strong> in the{' '}
            <a href={EBRAINS_VIEWER} target="_blank" rel="noreferrer noopener">EBRAINS atlas viewer</a>. {dossier.ebrains.note}
          </p>
        )}
      </div>
    </section>
  );
}

/** Attach / move / remove the virtual BCI on the selected region, and start its experiment. */
export function BciActions({ s }: { s: AtlasStructure }) {
  const placement = useImplant((x) => x.placement);
  const placing = useImplant((x) => x.placing);
  const go = useShell((x) => x.go);
  const here = placement?.regionId === s.id;
  const kind = experimentFor(s.name);
  const dossier = dossierFor(s.name);

  const attachHere = () => {
    const site = bestSiteOf(s.id);
    if (!site) return;
    useImplant.getState().attach(site);
    const a = useAtlas.getState();
    a.camera({ kind: 'fit', ids: a.idsOf(s.id) });
  };
  const start = () => {
    const a = useAtlas.getState();
    const stage = document.querySelector('[data-testid="atlas-workspace"]');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { go('experiment'); return; }
    a.camera({ kind: 'dive', ids: a.idsOf(s.id) });
    stage?.classList.add('diving');
    window.setTimeout(() => { go('experiment'); stage?.classList.remove('diving'); }, 760);
  };

  if (!here) {
    return (
      <div className="bci-actions" data-testid="bci-actions" data-attached="no">
        <button type="button" className="btn btn-primary insight-go" onClick={attachHere} data-testid="bci-attach-here">
          <span>{placement ? 'Move the BCI to this region' : 'Attach the BCI to this region'}</span><span aria-hidden="true">＋</span>
        </button>
        <p className="insight-note">
          Places the virtual device on an exposed point of this region. {kind ? 'A simulated experiment is available here.' : 'It will attach, but no experiment has been written for this region yet.'} Educational simulator — not a placement guide.
        </p>
      </div>
    );
  }
  return (
    <div className="bci-actions" data-testid="bci-actions" data-attached="yes">
      <div className="bci-status" data-testid="bci-status">
        <span className="bci-dot" aria-hidden="true" />
        <span><strong>Virtual BCI attached here</strong><br />
          <span className="mono">R {placement!.pointRasMm[0].toFixed(1)} · A {placement!.pointRasMm[1].toFixed(1)} · S {placement!.pointRasMm[2].toFixed(1)} mm</span> · 8 recording sites</span>
        <Prov kind="illustrative" title="The device is a generic concept drawing. Its position is a real point of this volunteer's atlas surface." />
      </div>
      {kind ? (
        <button type="button" className="btn btn-primary insight-go" onClick={start} data-testid="bci-start">
          <span>Start experiment</span><span aria-hidden="true">→</span>
        </button>
      ) : (
        <div className="bci-noexp" data-testid="bci-no-experiment">
          <strong>No experiment for this region yet.</strong>
          <p>The studio will not invent what this cortex would do or what an electrode here would record. Experiments exist for the precentral gyrus (movement) and the lateral occipital gyrus (vision).</p>
          <div className="bci-row">
            {(['precentral gyrus', 'lateral occipital gyrus'] as const).map((k) => {
              const side = s.hemisphere === 'right' ? 'right' : 'left';
              const a = useAtlas.getState();
              const target = [...a.structures.values()].find((x) => x.name === `${side} ${k}`);
              return target ? (
                <button key={k} type="button" className="btn" data-testid={`bci-goto-${k.split(' ')[0]}`} onClick={() => {
                  const site = bestSiteOf(target.id);
                  if (!site) return;
                  useImplant.getState().attach(site);
                  a.select(target.id); a.camera({ kind: 'fit', ids: [target.id] });
                }}>Move to the {k}</button>
              ) : null;
            })}
          </div>
        </div>
      )}
      {kind && dossier && <p className="insight-note">{dossier.experimentBlurb} Everything recorded there is <strong>simulated</strong>.</p>}
      <div className="bci-row">
        <button type="button" className={`btn${placing ? ' on' : ''}`} onClick={() => (placing ? useImplant.getState().cancel() : useImplant.getState().begin())} data-testid="bci-move" aria-pressed={placing}>{placing ? 'Cancel move' : 'Move'}</button>
        <button type="button" className="btn" onClick={() => useImplant.getState().remove()} data-testid="bci-remove">Remove</button>
      </div>
    </div>
  );
}
