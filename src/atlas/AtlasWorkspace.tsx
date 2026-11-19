// The home screen: the specimen fills the workspace; controls stay quiet around it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlas, TISSUE_LABEL, TISSUE_ORDER, type ColorMode, type ViewName } from './atlasStore';
import { AtlasViewport, SELECT_COLOR, HOVER_COLOR, SPECIMEN, TISSUE_COLORS, type GizmoAxes } from './AtlasScene';
import { AtlasSearch, AtlasTree } from './AtlasTree';
import { RegionInspector } from './RegionInspector';
import { PICK_OPACITY_THRESHOLD, type ClipAxis } from './visibility';
import { EvidenceTag } from '../science/Cite';
import './atlas.css';

/** Anatomical orientation: where Right/Left, Anterior/Posterior, Superior/Inferior point on screen right now. */
function Gizmo({ axes }: { axes: GizmoAxes | null }) {
  if (!axes) return null;
  const R = 26;
  const item = (v: [number, number, number], pos: string, neg: string, cls: string) => [
    { x: v[0] * R, y: -v[1] * R, z: v[2], label: pos, cls },
    { x: -v[0] * R, y: v[1] * R, z: -v[2], label: neg, cls },
  ];
  const tips = [...item(axes.r, 'R', 'L', 'gx'), ...item(axes.a, 'A', 'P', 'gy'), ...item(axes.s, 'S', 'I', 'gz')].sort((a, b) => a.z - b.z);
  return (
    <svg className="atlas-gizmo" viewBox="-44 -44 88 88" role="img"
      aria-label="Orientation: R right, L left, A anterior (front), P posterior (back), S superior (top), I inferior (bottom) of the subject">
      {tips.map((t) => (
        <g key={t.label} className={t.cls} opacity={t.z < 0 ? 0.45 : 1}>
          <line x1="0" y1="0" x2={t.x} y2={t.y} />
          <circle cx={t.x} cy={t.y} r="8.5" />
          <text x={t.x} y={t.y + 3.6} textAnchor="middle">{t.label}</text>
        </g>
      ))}
    </svg>
  );
}

const VIEWS: Array<{ id: ViewName; label: string; title: string }> = [
  { id: 'left', label: 'L', title: 'View from the subject’s left' },
  { id: 'right', label: 'R', title: 'View from the subject’s right' },
  { id: 'superior', label: 'S', title: 'View from above (superior)' },
  { id: 'anterior', label: 'A', title: 'View from the front (anterior)' },
  { id: 'posterior', label: 'P', title: 'View from behind (posterior)' },
  { id: 'inferior', label: 'I', title: 'View from below (inferior)' },
];

const CLIP_AXES: Array<{ id: ClipAxis; label: string; axisName: string; lo: string; hi: string }> = [
  { id: 'none', label: 'Off', axisName: '', lo: '', hi: '' },
  { id: 'x', label: 'Sagittal', axisName: 'left ↔ right', lo: 'L', hi: 'R' },
  { id: 'y', label: 'Coronal', axisName: 'back ↔ front', lo: 'P', hi: 'A' },
  { id: 'z', label: 'Axial', axisName: 'bottom ↔ top', lo: 'I', hi: 'S' },
];

function Legend() {
  const colorMode = useAtlas((s) => s.colorMode);
  const cortexOpacity = useAtlas((s) => s.cortexOpacity);
  const clip = useAtlas((s) => s.clip);
  const vis = useAtlas((s) => s.vis);
  const hemi = useAtlas((s) => s.hemi);
  const tissueOn = useAtlas((s) => s.tissueOn);
  const hidden = Object.values(vis).filter((v) => v === 'hidden').length;
  const faded = Object.values(vis).filter((v) => v === 'faded').length;
  const offTissues = TISSUE_ORDER.filter((t) => !tissueOn[t]);
  const ax = CLIP_AXES.find((a) => a.id === clip.axis)!;
  return (
    <div className="atlas-legend" aria-label="Legend: what the colours and transparency mean right now" data-testid="atlas-legend">
      <div className="legend-row"><span className="sw" style={{ background: HOVER_COLOR }} />Under the pointer</div>
      <div className="legend-row"><span className="sw" style={{ background: SELECT_COLOR }} />Selected</div>
      {colorMode === 'specimen' && <div className="legend-note">Tissue tones are a neutral rendering, not data.</div>}
      {colorMode === 'tissue' && (
        <div className="legend-grid">
          {TISSUE_ORDER.map((t) => <div key={t} className="legend-row"><span className="sw" style={{ background: TISSUE_COLORS[t] }} />{TISSUE_LABEL[t]}</div>)}
        </div>
      )}
      {colorMode === 'source' && <div className="legend-note">Colours are the source atlas’s own per-structure colours (identification only; no quantity is encoded).</div>}
      {cortexOpacity < 1 && (
        <div className="legend-state">Cortex at {Math.round(cortexOpacity * 100)}% opacity{cortexOpacity < PICK_OPACITY_THRESHOLD ? ' — pointer passes through it to deeper structures' : ''}.</div>
      )}
      {faded > 0 && <div className="legend-state">{faded} structures shown as faint context (not selectable).</div>}
      {hidden > 0 && <div className="legend-state">{hidden} structures hidden.</div>}
      {(!hemi.left || !hemi.right) && <div className="legend-state">{!hemi.left && !hemi.right ? 'Both hemispheres hidden' : `${!hemi.left ? 'Left' : 'Right'} hemisphere hidden`}.</div>}
      {offTissues.length > 0 && <div className="legend-state">Layers off: {offTissues.map((t) => TISSUE_LABEL[t]).join(', ')}.</div>}
      {clip.axis !== 'none' && (
        <div className="legend-state">{ax.label} cut at {ax.id === 'x' ? 'R' : ax.id === 'y' ? 'A' : 'S'} = {clip.posMm.toFixed(0)} mm; showing the {clip.keep === '+' ? ax.hi : ax.lo} side. Cut edges show hollow surface shells, not solid tissue.</div>
      )}
    </div>
  );
}

function Toolbar() {
  const st = useAtlas.getState();
  const selectedId = useAtlas((s) => s.selectedId);
  const hemi = useAtlas((s) => s.hemi);
  const cortexOpacity = useAtlas((s) => s.cortexOpacity);
  const clip = useAtlas((s) => s.clip);
  const colorMode = useAtlas((s) => s.colorMode);
  const tissueOn = useAtlas((s) => s.tissueOn);
  const dirty = useAtlas((s) => s.hasOverrides());
  const manifest = useAtlas((s) => s.manifest);
  const [panel, setPanel] = useState<'none' | 'cut' | 'layers'>('none');
  const range = (axis: ClipAxis): [number, number] => {
    if (!manifest || axis === 'none') return [-100, 100];
    const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    let lo = Infinity, hi = -Infinity;
    for (const s of manifest.structures) { lo = Math.min(lo, s.boundsMm[0][k]); hi = Math.max(hi, s.boundsMm[1][k]); }
    return [Math.floor(lo), Math.ceil(hi)];
  };
  const [lo, hi] = range(clip.axis);
  const ax = CLIP_AXES.find((a) => a.id === clip.axis)!;

  return (
    <div className="atlas-toolbar" role="toolbar" aria-label="Atlas view controls">
      <div className="tb-scroll">
      <div className="tb-group">
        <button type="button" className="tb-btn" onClick={() => st.camera({ kind: 'reset' })} title="Reset the view (0)" data-testid="tb-reset">Reset</button>
        <button type="button" className="tb-btn" disabled={!selectedId} onClick={() => st.camera({ kind: 'fit', ids: st.selectionIds() })} title="Fit the selection (F)" data-testid="tb-fit">Fit</button>
        <span className="tb-seg" role="group" aria-label="Standard views">
          {VIEWS.map((v) => <button key={v.id} type="button" className="tb-btn tb-mini" title={v.title} aria-label={v.title} onClick={() => st.camera({ kind: 'view', view: v.id })}>{v.label}</button>)}
        </span>
      </div>
      <div className="tb-group" role="group" aria-label="Hemispheres">
        <span className="tb-label">Hemispheres</span>
        <button type="button" className={`tb-btn tb-toggle${hemi.left ? ' on' : ''}`} aria-pressed={hemi.left} onClick={() => st.setHemi('left', !hemi.left)} title="Show or hide the subject’s left hemisphere" data-testid="tb-hemi-left">Left</button>
        <button type="button" className={`tb-btn tb-toggle${hemi.right ? ' on' : ''}`} aria-pressed={hemi.right} onClick={() => st.setHemi('right', !hemi.right)} title="Show or hide the subject’s right hemisphere" data-testid="tb-hemi-right">Right</button>
      </div>
      <label className="tb-group tb-slider" title="Make the cortex see-through to reveal deeper structures">
        <span className="tb-label">Cortex</span>
        <input type="range" min={0} max={100} step={5} value={Math.round(cortexOpacity * 100)} aria-label="Cortex opacity (percent)" data-testid="tb-cortex"
          onChange={(e) => st.setCortexOpacity(+e.target.value / 100)} />
        <span className="tb-value">{Math.round(cortexOpacity * 100)}%</span>
      </label>
      <div className="tb-group">
        <button type="button" className={`tb-btn tb-toggle${panel === 'cut' || clip.axis !== 'none' ? ' on' : ''}`} aria-expanded={panel === 'cut'} onClick={() => setPanel(panel === 'cut' ? 'none' : 'cut')} data-testid="tb-cut">Cut</button>
        <button type="button" className={`tb-btn tb-toggle${panel === 'layers' ? ' on' : ''}`} aria-expanded={panel === 'layers'} onClick={() => setPanel(panel === 'layers' ? 'none' : 'layers')} data-testid="tb-layers">Layers</button>
        <button type="button" className="tb-btn" disabled={!dirty} onClick={() => st.restoreAll()} title="Show everything again" data-testid="tb-restore">Restore</button>
      </div>
      </div>

      {panel === 'cut' && (
        <div className="tb-pop" role="group" aria-label="Cutaway">
          <div className="tb-pop-row">
            <span className="tb-label">Plane</span>
            {CLIP_AXES.map((a) => (
              <button key={a.id} type="button" className={`tb-btn tb-toggle${clip.axis === a.id ? ' on' : ''}`} aria-pressed={clip.axis === a.id} data-testid={`cut-${a.id}`}
                onClick={() => { const [l, h] = range(a.id); st.setClip({ axis: a.id, posMm: a.id === 'none' ? clip.posMm : Math.round((l + h) / 2) }); }}>{a.label}</button>
            ))}
          </div>
          {clip.axis !== 'none' && (
            <>
              <label className="tb-pop-row">
                <span className="tb-label">{ax.lo}</span>
                <input type="range" min={lo} max={hi} step={1} value={clip.posMm} aria-label={`Cut position along ${ax.axisName}, millimetres`} data-testid="cut-pos"
                  onChange={(e) => st.setClip({ posMm: +e.target.value })} />
                <span className="tb-label">{ax.hi}</span>
                <span className="tb-value">{clip.posMm.toFixed(0)} mm</span>
              </label>
              <div className="tb-pop-row">
                <span className="tb-label">Keep</span>
                <button type="button" className={`tb-btn tb-toggle${clip.keep === '-' ? ' on' : ''}`} aria-pressed={clip.keep === '-'} onClick={() => st.setClip({ keep: '-' })}>{ax.lo} side</button>
                <button type="button" className={`tb-btn tb-toggle${clip.keep === '+' ? ' on' : ''}`} aria-pressed={clip.keep === '+'} onClick={() => st.setClip({ keep: '+' })}>{ax.hi} side</button>
              </div>
              <p className="tb-pop-note">The models are surfaces. A cut therefore shows hollow shells; the interior is not volumetric data.</p>
            </>
          )}
        </div>
      )}
      {panel === 'layers' && (
        <div className="tb-pop" role="group" aria-label="Layers and colouring">
          <div className="tb-pop-grid">
            {TISSUE_ORDER.map((t) => (
              <label key={t} className="tb-check">
                <input type="checkbox" checked={tissueOn[t]} onChange={(e) => st.setTissue(t, e.target.checked)} data-testid={`layer-${t}`} />
                <span className="sw" style={{ background: colorMode === 'tissue' ? TISSUE_COLORS[t] : SPECIMEN[t] }} />{TISSUE_LABEL[t]}
              </label>
            ))}
          </div>
          <div className="tb-pop-row">
            <span className="tb-label">Colour</span>
            {(['specimen', 'tissue', 'source'] as ColorMode[]).map((m) => (
              <button key={m} type="button" className={`tb-btn tb-toggle${colorMode === m ? ' on' : ''}`} aria-pressed={colorMode === m} onClick={() => st.setColorMode(m)} data-testid={`color-${m}`}>
                {m === 'specimen' ? 'Specimen' : m === 'tissue' ? 'By tissue class' : 'Source atlas colours'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AtlasWorkspace() {
  const status = useAtlas((s) => s.status);
  const error = useAtlas((s) => s.error);
  const progress = useAtlas((s) => s.progress);
  const manifest = useAtlas((s) => s.manifest);
  const selectedId = useAtlas((s) => s.selectedId);
  const selectedName = useAtlas((s) => s.nameOf(s.selectedId));
  const hoverName = useAtlas((s) => s.nameOf(s.hoverId));
  const load = useAtlas((s) => s.load);
  const [browse, setBrowse] = useState(false);
  const [axes, setAxes] = useState<GizmoAxes | null>(null);
  const lastAxes = useRef('');
  const onGizmo = useCallback((g: GizmoAxes) => {
    const key = [...g.r, ...g.a, ...g.s].map((v) => v.toFixed(2)).join(',');
    if (key !== lastAxes.current) { lastAxes.current = key; setAxes(g); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={`atlas${selectedId ? ' has-selection' : ''}${browse ? ' browsing' : ''}`} data-testid="atlas-workspace" data-status={status}>
      <div className="atlas-stage">
        {status === 'ready' && <AtlasViewport onGizmo={onGizmo} />}
        {status === 'loading' && (
          <div className="atlas-loading" role="status">
            Loading the atlas… {progress[1] > 0 ? `${progress[0]} / ${progress[1]} structures` : ''}
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

        {status === 'ready' && (
          <>
            <div className="atlas-topleft">
              <AtlasSearch />
              <button type="button" className={`tb-btn tb-toggle${browse ? ' on' : ''}`} aria-expanded={browse} aria-controls="atlas-browser" onClick={() => setBrowse(!browse)} data-testid="browse-toggle">
                Browse
              </button>
            </div>
            {browse && (
              <div id="atlas-browser" className="atlas-browser">
                <AtlasTree />
              </div>
            )}
            {!selectedId && !browse && (
              <p className="atlas-hint" data-testid="atlas-hint">Move over the brain to see what each part is. Click to pin it and read about it.</p>
            )}
            <div className="atlas-bottomleft">
              <Gizmo axes={axes} />
              <Legend />
            </div>
            <div className="atlas-provenance">
              <EvidenceTag kind="measured" title="Surfaces from an MRI-derived, expert-segmented atlas of one volunteer. Simplified for display; see the atlas record of any structure." />
              <span>{manifest?.dataset.name} · simplified for display (modified from the original) · one volunteer · subject space (not MNI) · {manifest?.totals.structures} structures</span>
            </div>
            <Toolbar />
          </>
        )}
      </div>
      {status === 'ready' && <RegionInspector />}
      <div id="atlas-live" className="sr-only" role="status" aria-live="polite">
        {selectedName ? `Selected: ${selectedName}.` : hoverName ? `Pointing at: ${hoverName}.` : ''}
      </div>
    </div>
  );
}
