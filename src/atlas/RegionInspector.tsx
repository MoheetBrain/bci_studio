// Inspector for the selected atlas region: a short cited explanation first, detail on demand, and the atlas record
// (ids, coordinate space, geometry provenance) always available.
import { useMemo } from 'react';
import { useAtlas } from './atlasStore';
import { cardFor } from './content/regions';
import { hemisphereLabel } from './visibility';
import { ClaimList, Cites, EvidenceTag, SourceList } from '../science/Cite';
import { useShell } from '../shell/shellStore';
import type { AtlasStructure } from './types';

const fmt = (v: number[]) => v.map((n) => n.toFixed(1)).join(', ');

function Record({ s }: { s: AtlasStructure }) {
  const manifest = useAtlas((st) => st.manifest)!;
  const lc = s.labelCheck;
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
      <dt>Geometry</dt>
      <dd>
        <span className="mono">{s.model.file.split('/').pop()}</span><br />
        {s.model.sourceTriangles.toLocaleString()} source triangles → {s.model.triangles.toLocaleString()} shown
        {s.model.decimated ? <> (simplified; max deviation {s.model.decimationErrorMm.toFixed(2)} mm)</> : <> (not simplified)</>}
      </dd>
      <dt>Label-volume check</dt>
      <dd>
        {lc.present
          ? <>{lc.voxels!.toLocaleString()} voxels; mesh and voxel bounding boxes agree to {lc.bboxMaxDifferenceMm!.toFixed(2)} mm
              {lc.flag && <span className="warn-text"> — exceeds the {manifest.totals.labelBboxToleranceMm} mm tolerance: the model and the label volume disagree in the source itself</span>}</>
          : <span className="warn-text">Not checkable: {lc.note}</span>}
      </dd>
      <dt>Dataset</dt><dd>{manifest.dataset.name}, commit <span className="mono">{manifest.dataset.commit.slice(0, 7)}</span>. {manifest.dataset.licence}. <a href={`${import.meta.env.BASE_URL}${manifest.dataset.licenceFile}`} target="_blank" rel="noreferrer">Licence text</a>. {manifest.dataset.modified} {manifest.dataset.intendedUse}</dd>
    </dl>
  );
}

export function RegionInspector() {
  const selectedId = useAtlas((s) => s.selectedId);
  const tree = useAtlas((s) => s.tree);
  const structures = useAtlas((s) => s.structures);
  const members = useAtlas((s) => s.members);
  const vis = useAtlas((s) => s.vis);
  const dirty = useAtlas((s) => s.hasOverrides());
  const go = useShell((s) => s.go);
  const openResearch = useShell((s) => s.openResearch);

  const node = selectedId ? tree.get(selectedId) : undefined;
  const chain = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    let n = node;
    while (n) { out.push({ id: n.id, name: n.name }); n = n.parentId ? tree.get(n.parentId) : undefined; }
    return out;
  }, [node, tree]);

  if (!node) return null;
  const st = useAtlas.getState();
  const s = structures.get(node.id);
  const ids = members.get(node.id) ?? (s ? [node.id] : []);
  const isGroup = node.kind === 'group';
  const found = cardFor(chain.map((c) => c.name));
  const card = found?.card;
  const allHidden = ids.length > 0 && ids.every((id) => vis[id] === 'hidden');
  const allSources = card
    ? [...card.summarySources, ...(card.caution?.sources ?? []), ...[...card.location, ...card.functions, ...card.bci, ...card.limits].flatMap((c) => c.sources)]
    : ['spl-atlas'];
  const canJourney = !!card?.journey || (s?.tissue === 'cortex');

  return (
    <aside className="atlas-inspector" aria-label="Selected region" data-testid="region-inspector">
      <header className="insp-head">
        <div className="insp-kicker">{isGroup ? `Group · ${ids.length} structures` : s ? hemisphereLabel(s.hemisphere) : ''}</div>
        <h2 data-testid="region-title">{node.name}</h2>
        <nav className="insp-crumbs" aria-label="Position in the atlas hierarchy">
          {chain.slice(1).reverse().map((c) => (
            <button key={c.id} type="button" className="crumb" onClick={() => st.select(c.id)} title={`Select ${c.name}`}>{c.name}</button>
          ))}
        </nav>
        <button type="button" className="insp-close" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => st.select(null)}>×</button>
      </header>

      <div className="insp-actions" role="group" aria-label="Display actions for this region">
        <button type="button" className="btn" onClick={() => st.camera({ kind: 'fit', ids })} title="Move the camera to this region (F)">Fit</button>
        <button type="button" className="btn" onClick={() => st.isolate(node.id)} title="Hide everything else">Isolate</button>
        <button type="button" className="btn" onClick={() => st.showContext(node.id)} title="Keep everything else as a faint ghost">Show in context</button>
        <button type="button" className="btn" onClick={() => st.setVis(ids, allHidden ? undefined : 'hidden')}>{allHidden ? 'Show' : 'Hide'}</button>
        <button type="button" className="btn" onClick={() => st.restoreAll()} disabled={!dirty} title="Show everything again">Restore all</button>
      </div>

      <div className="insp-body">
        {card ? (
          <>
            {found!.inherited && <p className="insp-inherit">Explanation for the parent region <strong>{found!.inherited}</strong>; nothing more specific is asserted for “{node.name}”.</p>}
            <p className="insp-summary" data-testid="region-summary">{card.summary} <Cites ids={card.summarySources} /></p>
            {card.caution && (
              <div className="insp-caution" role="note" data-testid="region-caution">
                <strong>{card.caution.title}</strong>
                <p>{card.caution.body}</p>
                <Cites ids={card.caution.sources} />
              </div>
            )}
            <details open>
              <summary>What it does</summary>
              <ClaimList claims={card.functions} />
            </details>
            <details open={card.bci.length > 0}>
              <summary>Why it matters for a BCI</summary>
              <ClaimList claims={card.bci} />
            </details>
            <details>
              <summary>Where it is</summary>
              <ClaimList claims={card.location} />
            </details>
            <details>
              <summary>Limits of this view</summary>
              <ClaimList claims={card.limits} />
            </details>
          </>
        ) : (
          <div className="insp-empty" data-testid="region-no-card">
            <strong>No curated explanation yet.</strong>
            <p>This structure’s name, position and shape come straight from the atlas. Nothing about its function is asserted here, because no reviewed, cited text has been written for it.</p>
          </div>
        )}

        {canJourney && (
          <div className="insp-journey">
            <button type="button" className="btn btn-primary" onClick={() => go('interface')} data-testid="to-interface">
              Place an illustrative electrode here →
            </button>
            <span className="muted">Follows this region to neurons, an electrode contact, the acquisition chain and our chip.</span>
          </div>
        )}

        <details>
          <summary>Sources ({new Set(allSources).size})</summary>
          <SourceList ids={allSources} />
          <button type="button" className="btn btn-link" onClick={() => openResearch(card ? card.key : node.name)}>Search the local corpus for “{card ? card.key : node.name}”</button>
        </details>

        <details>
          <summary>Atlas record</summary>
          <div className="insp-evidence"><EvidenceTag kind="measured" title="Shape and name come from an MRI-derived, expert-segmented single-subject atlas." /></div>
          {s ? <Record s={s} /> : (
            <dl className="rec">
              <dt>Source id</dt><dd className="mono">#{node.id}</dd>
              <dt>Members</dt><dd>{ids.length} structures in the source hierarchy under this group.</dd>
            </dl>
          )}
          {isGroup && node.children.length > 0 && (
            <ul className="insp-children">
              {node.children.map((cid) => (
                <li key={cid}><button type="button" className="crumb" onClick={() => st.select(cid)} onMouseEnter={() => st.hover(cid, 'tree')} onMouseLeave={() => st.hover(null)}>{tree.get(cid)?.name}</button></li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </aside>
  );
}
