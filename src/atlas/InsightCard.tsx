// The insight card for the selected region: what it is in one sentence, the caveat that matters, and ONE invitation
// to follow a connected process. Everything else (claims, sources, the atlas record) opens on demand.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlas } from './atlasStore';
import { cardFor } from './content/regions';
import { hemisphereLabel } from './visibility';
import { ClaimList, Cites, EvidenceTag, SourceList } from '../science/Cite';
import { useShell } from '../shell/shellStore';
import type { AtlasStructure } from './types';

const fmt = (v: number[]) => v.map((n) => n.toFixed(1)).join(', ');

function Record({ s }: { s: AtlasStructure }) {
  const manifest = useAtlas((st) => st.manifest)!;
  const specimen = useAtlas((st) => st.specimen);
  const lc = s.labelCheck;
  const onSurface = specimen?.meta.regions.verticesPerStructure[s.id] ?? 0;
  return (
    <dl className="rec">
      <dt>App id</dt><dd className="mono">{s.id}</dd>
      <dt>Source id</dt><dd className="mono">{s.sourceId}{s.duplicateSourceIds.length > 0 && <> (also {s.duplicateSourceIds.join(', ')})</>}</dd>
      <dt>Label value</dt><dd className="mono">{s.label ?? '—'}{s.labelName && s.labelName !== s.name ? ` (“${s.labelName}”)` : ''}</dd>
      <dt>RadLex</dt><dd className="mono">{s.radlex ?? 'not given in the source table'}</dd>
      <dt>Side</dt><dd>{hemisphereLabel(s.hemisphere)}</dd>
      <dt>Coordinate space</dt><dd>{manifest.space.name}, {manifest.space.units}. {manifest.space.orientation}. <strong>Not MNI.</strong></dd>
      <dt>Centroid</dt><dd className="mono">R {s.centroidMm[0].toFixed(1)}, A {s.centroidMm[1].toFixed(1)}, S {s.centroidMm[2].toFixed(1)} mm</dd>
      <dt>Extent</dt><dd className="mono">[{fmt(s.boundsMm[0])}] → [{fmt(s.boundsMm[1])}] mm</dd>
      <dt>On the surface</dt>
      <dd>{onSurface > 0
        ? <>Highlighted on the continuous surface through {onSurface.toLocaleString()} vertices whose region id was read from the label volume just beneath them.</>
        : <>Does not reach the outer surface: shown as the atlas’s own model, seen through the surface.</>}</dd>
      <dt>Atlas model</dt>
      <dd>
        <span className="mono">{s.model.file.split('/').pop()}</span><br />
        {s.model.sourceTriangles.toLocaleString()} source triangles → {s.model.triangles.toLocaleString()} shown
        {s.model.decimated ? <> (simplified; max deviation {s.model.decimationErrorMm.toFixed(2)} mm)</> : <> (not simplified)</>}
      </dd>
      <dt>Label-volume check</dt>
      <dd>
        {lc.present
          ? <>{lc.voxels!.toLocaleString()} voxels; model and voxel bounding boxes agree to {lc.bboxMaxDifferenceMm!.toFixed(2)} mm
              {lc.flag && <span className="warn-text"> — exceeds the {manifest.totals.labelBboxToleranceMm} mm tolerance: the model and the label volume disagree in the source itself</span>}</>
          : <span className="warn-text">Not checkable: {lc.note}</span>}
      </dd>
      <dt>Dataset</dt><dd>{manifest.dataset.name}, commit <span className="mono">{manifest.dataset.commit.slice(0, 7)}</span>. {manifest.dataset.licence}. <a href={`${import.meta.env.BASE_URL}${manifest.dataset.licenceFile}`} target="_blank" rel="noreferrer">Licence text</a>. {manifest.dataset.modified} {manifest.dataset.intendedUse}</dd>
    </dl>
  );
}

export function InsightCard() {
  const selectedId = useAtlas((s) => s.selectedId);
  const tree = useAtlas((s) => s.tree);
  const structures = useAtlas((s) => s.structures);
  const members = useAtlas((s) => s.members);
  const hiddenMap = useAtlas((s) => s.hidden);
  const focus = useAtlas((s) => s.focus);
  const viewMode = useAtlas((s) => s.viewMode);
  const dirty = useAtlas((s) => s.hasOverrides());
  const go = useShell((s) => s.go);
  /** Fly into the region, then hand over to the Neurons scene (no flight when motion is reduced). */
  const dive = () => {
    const a = useAtlas.getState();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { go('interface'); return; }
    a.camera({ kind: 'dive', ids: a.selectionIds() });
    document.querySelector('[data-testid="atlas-workspace"]')?.classList.add('diving');
    window.setTimeout(() => { go('interface'); document.querySelector('[data-testid="atlas-workspace"]')?.classList.remove('diving'); }, 760);
  };
  const openResearch = useShell((s) => s.openResearch);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  const node = selectedId ? tree.get(selectedId) : undefined;
  const chain = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    let n = node;
    while (n) { out.push({ id: n.id, name: n.name }); n = n.parentId ? tree.get(n.parentId) : undefined; }
    return out;
  }, [node, tree]);

  // tell the stage how much of its right side this card covers, so the camera composes the brain in what is left
  useEffect(() => {
    const el = ref.current;
    const st = useAtlas.getState();
    if (!el || !node) { st.setInsetRight(0); return; }
    const measure = () => st.setInsetRight(window.innerWidth > 760 ? el.getBoundingClientRect().width + 24 : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); st.setInsetRight(0); };
  }, [node]);
  useEffect(() => { setOpen(false); }, [selectedId]);

  if (!node) return null;
  const st = useAtlas.getState();
  const s = structures.get(node.id);
  const ids = members.get(node.id) ?? (s ? [node.id] : []);
  const isGroup = node.kind === 'group';
  const found = cardFor(chain.map((c) => c.name));
  const card = found?.card;
  const allHidden = ids.length > 0 && ids.every((id) => hiddenMap[id]);
  const allSources = card
    ? [...card.summarySources, ...(card.caution?.sources ?? []), ...[...card.location, ...card.functions, ...card.bci, ...card.limits].flatMap((c) => c.sources)]
    : ['spl-atlas'];
  const cortical = !!card?.journey || s?.tissue === 'cortex';

  return (
    <aside ref={ref} className={`insight${open ? ' open' : ''}`} aria-label="Selected region" data-testid="region-inspector">
      <header className="insight-head">
        <div className="insight-kicker">{isGroup ? `Group · ${ids.length} structures` : s ? hemisphereLabel(s.hemisphere) : ''}</div>
        <h2 data-testid="region-title">{node.name}</h2>
        <button type="button" className="insight-close" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => st.select(null)}>×</button>
      </header>

      <div className="insight-body">
        {card ? (
          <>
            {found!.inherited && <p className="insight-inherit">About the parent region <strong>{found!.inherited}</strong> — nothing more specific is asserted for “{node.name}”.</p>}
            <p className="insight-summary" data-testid="region-summary">{card.summary} <Cites ids={card.summarySources} /></p>
            {card.caution && (
              <details className="insight-caution" data-testid="region-caution" open>
                <summary>{card.caution.title}</summary>
                <p>{card.caution.body}</p>
                <Cites ids={card.caution.sources} />
              </details>
            )}
          </>
        ) : (
          <div className="insight-empty" data-testid="region-no-card">
            <strong>No curated explanation yet.</strong>
            <p>Its name, position and shape come straight from the atlas. Nothing about its function is asserted here, because no reviewed, cited text has been written for it.</p>
          </div>
        )}

        {/* one invitation */}
        {cortical ? (
          <button type="button" className="btn btn-primary insight-go" onClick={dive} data-testid="to-interface">
            <span>See the neurons beneath this surface</span><span aria-hidden="true">→</span>
          </button>
        ) : (
          <button type="button" className="btn btn-primary insight-go" onClick={() => (viewMode === 'slice' ? st.setViewMode('solid') : st.sliceThrough(ids))} data-testid="to-slice" aria-pressed={viewMode === 'slice'}>
            <span>{viewMode === 'slice' ? 'Back to the whole brain' : 'Slice the brain through it'}</span><span aria-hidden="true">→</span>
          </button>
        )}
        {cortical
          ? <p className="insight-note">An illustrative path from this region to neurons, an electrode, the acquisition chain and our chip. Not a placement guide.</p>
          : <p className="insight-note">The cut shows this subject’s MRI with the structure outlined — measured data, not a drawing.</p>}

        <div className="insight-actions" role="group" aria-label="Display actions for this region">
          <button type="button" className="btn" onClick={() => st.camera({ kind: 'fit', ids })} title="Move the camera to this region (F)">Frame</button>
          <button type="button" className={`btn${focus === 'isolate' ? ' on' : ''}`} aria-pressed={focus === 'isolate'} onClick={() => st.setFocus(focus === 'isolate' ? 'none' : 'isolate')} title="Show only this region">Isolate</button>
          {cortical && <button type="button" className={`btn${focus === 'context' ? ' on' : ''}`} aria-pressed={focus === 'context'} onClick={() => st.setFocus(focus === 'context' ? 'none' : 'context')} title="Show this region inside a see-through brain">In context</button>}
          <button type="button" className="btn" onClick={() => st.setHidden(ids, !allHidden)}>{allHidden ? 'Show' : 'Hide'}</button>
          {dirty && <button type="button" className="btn" onClick={() => st.restoreAll()} title="Show everything again">Restore all</button>}
        </div>

        <button type="button" className="insight-more" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="insight-more">
          {open ? 'Hide details' : card ? 'Details, limits and sources' : 'Atlas record and sources'}
        </button>
        {open && (
          <div className="insight-details" data-testid="insight-details">
            <nav className="insight-crumbs" aria-label="Position in the atlas hierarchy">
              {chain.slice(1).reverse().map((c) => (
                <button key={c.id} type="button" className="crumb" onClick={() => st.select(c.id)} title={`Select ${c.name}`}>{c.name}</button>
              ))}
            </nav>
            {card && (
              <>
                <section><h3>What it does</h3><ClaimList claims={card.functions} /></section>
                {card.bci.length > 0 && <section><h3>Why it matters for a BCI</h3><ClaimList claims={card.bci} /></section>}
                <section><h3>Where it is</h3><ClaimList claims={card.location} /></section>
                <section><h3>Limits of this view</h3><ClaimList claims={card.limits} /></section>
              </>
            )}
            <section>
              <h3>Sources ({new Set(allSources).size})</h3>
              <SourceList ids={allSources} />
              <button type="button" className="btn btn-link" onClick={() => openResearch(card ? card.key : node.name)}>Search the local corpus for “{card ? card.key : node.name}”</button>
            </section>
            <section>
              <h3>Atlas record <EvidenceTag kind="measured" title="Shape and name come from an MRI-derived, expert-segmented single-subject atlas." /></h3>
              {s ? <Record s={s} /> : (
                <dl className="rec">
                  <dt>Source id</dt><dd className="mono">#{node.id}</dd>
                  <dt>Members</dt><dd>{ids.length} structures in the source hierarchy under this group.</dd>
                </dl>
              )}
              {isGroup && node.children.length > 0 && (
                <ul className="insight-children">
                  {node.children.map((cid) => (
                    <li key={cid}><button type="button" className="crumb" onClick={() => st.select(cid)} onMouseEnter={() => st.hover(cid, 'tree')} onMouseLeave={() => st.hover(null)}>{tree.get(cid)?.name}</button></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
