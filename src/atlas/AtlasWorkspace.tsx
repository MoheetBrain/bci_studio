// The brain stage: the specimen is the hero; chrome is sparse and sits at the edges.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlas, VIEW_MODES, type ViewName } from './atlasStore';
import { AtlasViewport, type GizmoAxes, type Look } from './AtlasScene';
import { InsightCard } from './InsightCard';
import type { ClipAxis } from './visibility';
import { EvidenceTag } from '../science/Cite';
import { experimentFor, useImplant } from '../experiment/implantStore';
import { useShell } from '../shell/shellStore';
import './atlas.css';

/** Anatomical orientation: where the subject's right / front / top point on screen right now. */
function Gizmo({ axes }: { axes: GizmoAxes | null }) {
  if (!axes) return null;
  const R = 24;
  const item = (v: [number, number, number], pos: string, neg: string, cls: string) => [
    { x: v[0] * R, y: -v[1] * R, z: v[2], label: pos, cls },
    { x: -v[0] * R, y: v[1] * R, z: -v[2], label: neg, cls },
  ];
  const tips = [...item(axes.r, 'R', 'L', 'gx'), ...item(axes.a, 'A', 'P', 'gy'), ...item(axes.s, 'S', 'I', 'gz')].sort((a, b) => a.z - b.z);
  return (
    <svg className="atlas-gizmo" viewBox="-40 -40 80 80" role="img"
      aria-label="Orientation of the subject: R right, L left, A anterior (front), P posterior (back), S superior (top), I inferior (bottom)">
      <title>Subject orientation — R right · L left · A front · P back · S top · I bottom</title>
      {tips.map((t) => (
        <g key={t.label} className={t.cls} opacity={t.z < 0 ? 0.4 : 1}>
          <line x1="0" y1="0" x2={t.x} y2={t.y} />
          <circle cx={t.x} cy={t.y} r="7.5" />
          <text x={t.x} y={t.y + 3.2} textAnchor="middle">{t.label}</text>
        </g>
      ))}
    </svg>
  );
}

const VIEWS: Array<{ id: ViewName; label: string }> = [
  { id: 'left', label: 'Left side' }, { id: 'right', label: 'Right side' }, { id: 'anterior', label: 'Front' },
  { id: 'posterior', label: 'Back' }, { id: 'superior', label: 'Top' }, { id: 'inferior', label: 'Underside' },
];
const PLANES: Array<{ id: Exclude<ClipAxis, 'none'>; label: string; lo: string; hi: string; coord: string }> = [
  { id: 'x', label: 'Sagittal', lo: 'left', hi: 'right', coord: 'R' },
  { id: 'y', label: 'Coronal', lo: 'back', hi: 'front', coord: 'A' },
  { id: 'z', label: 'Axial', lo: 'bottom', hi: 'top', coord: 'S' },
];

function ViewMenu({ axes }: { axes: GizmoAxes | null }) {
  const st = useAtlas.getState();
  const hemi = useAtlas((s) => s.hemi);
  const dirty = useAtlas((s) => s.hasOverrides());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="stage-corner bl" ref={ref}>
      {open && (
        <div className="view-pop" role="group" aria-label="Views and hemispheres" data-testid="view-pop">
          <div className="pop-title">Look from</div>
          <div className="view-grid">
            {VIEWS.map((v) => <button key={v.id} type="button" className="chip-btn" onClick={() => st.camera({ kind: 'view', view: v.id })} data-testid={`view-${v.id}`}>{v.label}</button>)}
          </div>
          <div className="pop-title">Hemispheres</div>
          <div className="view-grid two">
            <button type="button" className={`chip-btn${hemi.left ? ' on' : ''}`} aria-pressed={hemi.left} onClick={() => st.setHemi('left', !hemi.left)} data-testid="tb-hemi-left">Left</button>
            <button type="button" className={`chip-btn${hemi.right ? ' on' : ''}`} aria-pressed={hemi.right} onClick={() => st.setHemi('right', !hemi.right)} data-testid="tb-hemi-right">Right</button>
          </div>
          <div className="view-grid two">
            <button type="button" className="chip-btn" onClick={() => st.camera({ kind: 'reset' })} data-testid="tb-reset">Reset view</button>
            <button type="button" className="chip-btn" disabled={!dirty} onClick={() => st.restoreAll()} data-testid="tb-restore">Restore all</button>
          </div>
          <p className="pop-note">Left and right always mean the subject’s own left and right.</p>
        </div>
      )}
      <button type="button" className="gizmo-btn" aria-expanded={open} aria-label="Views, hemispheres and reset" title="Views, hemispheres and reset" onClick={() => setOpen(!open)} data-testid="view-menu">
        <Gizmo axes={axes} />
        <span>View</span>
      </button>
    </div>
  );
}

function ModeBar() {
  const st = useAtlas.getState();
  const viewMode = useAtlas((s) => s.viewMode);
  const clip = useAtlas((s) => s.clip);
  const slices = useAtlas((s) => s.slices);
  const plane = PLANES.find((p) => p.id === clip.axis);
  const [lo, hi] = st.axisRange(clip.axis);
  return (
    <div className="stage-corner bc">
      {viewMode === 'slice' && plane && (
        <div className="slice-bar" role="group" aria-label="Slice plane" data-testid="slice-bar">
          <div className="seg" role="group" aria-label="Plane">
            {PLANES.map((p) => (
              <button key={p.id} type="button" className={`seg-btn${clip.axis === p.id ? ' on' : ''}`} aria-pressed={clip.axis === p.id} data-testid={`cut-${p.id}`}
                onClick={() => st.setCut(p.id)}>{p.label}</button>
            ))}
          </div>
          <label className="slice-pos">
            <span>{plane.lo}</span>
            <input type="range" min={lo} max={hi} step={1} value={clip.posMm} aria-label={`Slice position from ${plane.lo} to ${plane.hi}, in millimetres`} data-testid="cut-pos" onChange={(e) => st.setClip({ posMm: +e.target.value })} />
            <span>{plane.hi}</span>
            <output className="mono">{plane.coord} {clip.posMm} mm</output>
          </label>
          <button type="button" className="chip-btn" onClick={() => st.setClip({ keep: clip.keep === '-' ? '+' : '-' })} data-testid="cut-flip" title="Show the other side of the cut">Flip</button>
          <span className="slice-state" role="status" data-testid="slice-state">
            {slices.status === 'loading' && 'Loading the MRI…'}
            {slices.status === 'error' && <span className="warn-text">The MRI could not be loaded ({slices.error}); the cut shows the surface shell only.</span>}
            {slices.status === 'ready' && <>The cut face shows this subject’s T1 MRI (measured). Hover it to name what is under the pointer.</>}
          </span>
        </div>
      )}
      <div className="seg modes" role="group" aria-label="How the brain is drawn">
        {VIEW_MODES.map((m) => (
          <button key={m.id} type="button" className={`seg-btn${viewMode === m.id ? ' on' : ''}`} aria-pressed={viewMode === m.id} title={m.hint} onClick={() => st.setViewMode(m.id)} data-testid={`mode-${m.id}`}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}

/** Add, move, find or remove the virtual BCI. The device itself is handled in the 3D scene. */
function BciBar() {
  const placement = useImplant((s) => s.placement);
  const placing = useImplant((s) => s.placing);
  const preview = useImplant((s) => s.preview);
  const name = useAtlas((s) => s.nameOf(placement?.regionId ?? null));
  const go = useShell((s) => s.go);
  const begin = () => {
    // placing needs the solid, uncut surface under the pointer
    const a = useAtlas.getState();
    if (a.hasOverrides()) a.restoreAll();
    useImplant.getState().begin();
  };
  useEffect(() => {
    if (!placing) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') useImplant.getState().cancel(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [placing]);
  if (placing) {
    return (
      <div className="stage-corner tl" data-testid="bci-bar" data-state="placing">
        <div className="bci-pill placing" role="status">
          <span>{preview ? (preview.compatible ? <>Click to attach on the <b>highlighted region</b></> : <>This spot cannot be used — move onto the cortex</>) : <>Move over the brain, then <b>click to attach</b>. Drag to turn the brain.</>}</span>
          <button type="button" className="btn" onClick={() => useImplant.getState().cancel()} data-testid="bci-cancel">Cancel <kbd>Esc</kbd></button>
        </div>
      </div>
    );
  }
  if (!placement) {
    return (
      <div className="stage-corner tl" data-testid="bci-bar" data-state="none">
        <button type="button" className="bci-add" onClick={begin} data-testid="bci-add" title="Pick up a virtual brain–computer interface and attach it to the cortex">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="9" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="9" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" opacity=".7" /><path d="M9 15.5v5M12 15.8v6M15 15.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          Add BCI
        </button>
        <button type="button" className="bci-add world-enter" onClick={() => go('world')} data-testid="enter-world" title="Leave the atlas for a representative circuit you can fly through and experiment on">
          Enter the neural world →
        </button>
      </div>
    );
  }
  const a = useAtlas.getState();
  const kind = experimentFor(name);
  return (
    <div className="stage-corner tl" data-testid="bci-bar" data-state="attached">
      <div className="bci-pill">
        <button type="button" className="linkish" onClick={() => { a.select(placement.regionId); a.camera({ kind: 'fit', ids: a.idsOf(placement.regionId) }); }} data-testid="bci-chip" title="Go to the device">
          BCI on <b>{name ?? 'an unknown region'}</b>
        </button>
        {kind && <button type="button" className="btn btn-primary" onClick={() => go('experiment')} data-testid="bci-bar-start">Start experiment</button>}
        <button type="button" className="btn" onClick={begin} data-testid="bci-bar-move">Move</button>
        <button type="button" className="btn" onClick={() => useImplant.getState().remove()} data-testid="bci-bar-remove" aria-label="Remove the BCI">Remove</button>
      </div>
    </div>
  );
}

function About({ onClose }: { onClose: () => void }) {
  const manifest = useAtlas((s) => s.manifest)!;
  const specimen = useAtlas((s) => s.specimen)!;
  const m = specimen.meta;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="sheet-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="About this brain" data-testid="about-sheet">
        <header><h2>About this brain</h2><button type="button" className="insight-close" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="sheet-body">
          <section>
            <h3>What is measured <EvidenceTag kind="measured" /></h3>
            <p><strong>The shape.</strong> One volunteer’s brain from the {manifest.dataset.name}. The surface you see is the boundary between tissue and fluid in that atlas’s own T1 MRI ({m.source.image.voxelMm} mm voxels), smoothed by {m.mesh.smoothingDisplacementMm.mean.toFixed(2)} mm on average (at most {m.mesh.smoothingDisplacementMm.max.toFixed(2)} mm) and simplified to {m.mesh.triangles.toLocaleString()} triangles. It is a derived rendering surface, not a validated pial surface.</p>
            <p><strong>The regions.</strong> {m.regions.structuresOnSurface} of the atlas’s {manifest.totals.structures} structures reach the surface; every surface vertex takes its region from the atlas’s label volume directly beneath it. Borders were then tidied by a neighbour-majority vote ({(m.regions.borderTidy.changedFraction * 100).toFixed(1)} % of vertices changed) and are drawn as smoothed contours, so a border line is accurate to about a millimetre, not to a voxel. Structures inside are the atlas’s own models. Image, labels and models share one scanner space, so no registration is involved.</p>
            <p><strong>The slice.</strong> The cut face shows the same T1 image, masked to within 4.5 mm of labelled brain.</p>
          </section>
          <section>
            <h3>What is rendering, not data</h3>
            <p>The pink tissue colour, the lighting, the soft highlights, the fine surface grain and the shading in the folds are a visual treatment. They are not histology, blood supply or activity. Nothing on this stage shows neural activity.</p>
          </section>
          <section>
            <h3>Limits</h3>
            <p>One person’s anatomy in scanner space — not a population average and not MNI space. Region borders are the atlas’s anatomical labels, not functional areas. {manifest.dataset.intendedUse} Educational and research software: not a medical device, not a surgical planner, and it controls no stimulation.</p>
          </section>
          <section>
            <h3>Source and licence</h3>
            <p>{manifest.dataset.citation}</p>
            <p>Repository commit <span className="mono">{manifest.dataset.commit.slice(0, 7)}</span>. {manifest.dataset.licence}. {manifest.dataset.modified} <a href={`${import.meta.env.BASE_URL}${manifest.dataset.licenceFile}`} target="_blank" rel="noreferrer">Read the licence</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function lookFromUrl(): Look {
  const m = /[?&]look=(tissue|pbr|legacy)\b/.exec(typeof location === 'undefined' ? '' : location.search + location.hash);
  return (m?.[1] as Look) ?? 'tissue';
}

export function AtlasWorkspace() {
  const status = useAtlas((s) => s.status);
  const error = useAtlas((s) => s.error);
  const progress = useAtlas((s) => s.progress);
  const selectedId = useAtlas((s) => s.selectedId);
  const insetRight = useAtlas((s) => s.insetRight);
  const selectedName = useAtlas((s) => s.nameOf(s.selectedId));
  const hoverName = useAtlas((s) => s.nameOf(s.hoverId));
  const viewMode = useAtlas((s) => s.viewMode);
  const shell = useAtlas((s) => s.shell());
  const hiddenCount = useAtlas((s) => Object.keys(s.hidden).length);
  const hemi = useAtlas((s) => s.hemi);
  const load = useAtlas((s) => s.load);
  const [axes, setAxes] = useState<GizmoAxes | null>(null);
  const [about, setAbout] = useState(false);
  const [look] = useState(lookFromUrl);
  const placing = useImplant((s) => s.placing);
  const lastAxes = useRef('');
  const onGizmo = useCallback((g: GizmoAxes) => {
    const key = [...g.r, ...g.a, ...g.s].map((v) => v.toFixed(2)).join(',');
    if (key !== lastAxes.current) { lastAxes.current = key; setAxes(g); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // what the current picture means, in words — only what differs from the plain specimen
  const notes: string[] = [];
  if (viewMode === 'xray') notes.push('X-ray: the surface is see-through; the solid bodies inside are the atlas’s models.');
  else if (shell === 'ghost') notes.push('The surface is drawn see-through so the selection inside can be seen.');
  if (shell === 'hidden') notes.push('Isolated: only the selection is drawn.');
  if (viewMode === 'parcels') notes.push('Lines mark where one atlas region ends and the next begins. The tints only tell neighbours apart; they mean nothing else.');
  if (hiddenCount > 0) notes.push(`${hiddenCount} structure${hiddenCount > 1 ? 's' : ''} hidden.`);
  if (!hemi.left || !hemi.right) notes.push(`${!hemi.left && !hemi.right ? 'Both hemispheres' : !hemi.left ? 'Left hemisphere' : 'Right hemisphere'} hidden.`);

  return (
    <div className={`stage cine look-${look}${selectedId ? ' has-selection' : ''}${placing ? ' placing' : ''}`} style={{ '--inset-right': `${insetRight}px` } as React.CSSProperties} data-testid="atlas-workspace" data-status={status}>
      <div className="stage-bg" aria-hidden="true"><i className="hud tl" /><i className="hud tr" /><i className="hud bl" /><i className="hud br" /></div>
      {status === 'ready' && <AtlasViewport onGizmo={onGizmo} look={look} />}
      {status === 'loading' && (
        <div className="atlas-loading" role="status">
          <span className="loading-ring" aria-hidden="true" />
          Preparing the brain{progress[1] > 0 ? ` · ${progress[0]} / ${progress[1]} structures` : '…'}
        </div>
      )}
      {status === 'error' && (
        <div className="atlas-fallback" role="alert" data-testid="atlas-error">
          <strong>The atlas data could not be loaded.</strong>
          <p>{error?.message}{error?.detail ? ` (${error.detail})` : ''}</p>
          <p>No substitute brain is shown. Rebuild the assets with <code>npm run atlas:build</code> or check that <code>public/atlas/spl-nac/</code> is being served.</p>
          <button type="button" className="btn" onClick={() => { useAtlas.setState({ status: 'idle' }); void load(); }}>Retry</button>
        </div>
      )}

      {status === 'ready' && look === 'tissue' && (
        <>
          {!selectedId && viewMode === 'solid' && !placing && <p className="stage-hint" data-testid="atlas-hint">Move over the brain to name its parts. Click one to explore it — or add a BCI and attach it.</p>}
          <BciBar />
          {notes.length > 0 && <div className="stage-notes" role="status" data-testid="atlas-legend">{notes.map((n) => <span key={n}>{n}</span>)}</div>}
          <ViewMenu axes={axes} />
          <ModeBar />
          <div className="stage-corner br">
            <button type="button" className="ghost-btn" onClick={() => setAbout(true)} data-testid="about-open">About this brain</button>
          </div>
          <InsightCard />
          {about && <About onClose={() => setAbout(false)} />}
        </>
      )}
      <div id="atlas-live" className="sr-only" role="status" aria-live="polite">
        {selectedName ? `Selected: ${selectedName}.` : hoverName ? `Pointing at: ${hoverName}.` : ''}
      </div>
    </div>
  );
}
