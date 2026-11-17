// Toolbar overlay for the 3D viewport. A small primary row (Fit · Separate/Assemble · Isolate ·
// Reset · Help · More ▾), a contextual row per level (preset + loop, cfg_mode, Open package),
// the selection bar, and two popovers: More (every other control) and Help (navigation, keys,
// lessons). Every control is bound to the shared scene store (or the 3D view store).
import { useEffect, useRef, type ReactNode } from 'react';
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';
import { useView } from '../three/viewStore';
import type { LabelPolicy } from '../state/prefs';
import { InspectionBanner, IsolationBanner, LoopStrip, ModeSwitcher, PresetToggle, SelectionBar } from './ViewportPanels';
import './ui.css';

const ICONS: Record<string, ReactNode> = {
  assemble: <path d="M3 8h4M13 8H9M8 3v4M8 13V9" />,
  explode: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M12 12l-2-2M12 4l-2 2M4 12l2-2" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  play: <path d="M5 3.5l7 4.5-7 4.5z" />,
  isolate: <><circle cx="8" cy="8" r="2.5" /><circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" /></>,
  xray: <><rect x="3" y="3" width="10" height="10" rx="2" strokeDasharray="2 1.5" /><rect x="6" y="6" width="4" height="4" /></>,
  ghost: <><rect x="2.5" y="5" width="6" height="6" rx="1" opacity=".45" /><rect x="7.5" y="5" width="6" height="6" rx="1" /></>,
  labels: <path d="M3 4h7l3 4-3 4H3z" />,
  path: <path d="M2 11c3 0 3-6 6-6s3 6 6 6" />,
  fit: <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />,
  reset: <path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.2M3 2.5V5h2.5" />,
  lid: <path d="M3 10h10M4 10V7h8v3M6 5h4" />,
  help: <><circle cx="8" cy="8" r="6" /><path d="M6.2 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.8.6-.8 1.2M8 11.4v.1" /></>,
  more: <path d="M4 6.5l4 3 4-3" />,
  grid: <path d="M3 3h10v10H3zM3 6.3h10M3 9.6h10M6.3 3v10M9.6 3v10" />,
  move: <path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" />,
  view: <><rect x="2.5" y="4" width="11" height="8" rx="1.5" /><path d="M2.5 8h11" /></>,
};

function Btn({
  icon, label, on, onClick, title, disabled, testid, cls,
}: { icon: string; label: string; on?: boolean; onClick: () => void; title: string; disabled?: boolean; testid?: string; cls?: string }) {
  return (
    <button className={`tb3d-btn${on ? ' on' : ''}${cls ? ` ${cls}` : ''}`} onClick={onClick} title={title} disabled={disabled} aria-pressed={on} data-testid={testid}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        {ICONS[icon]}
      </svg>
      <span>{label}</span>
    </button>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="tb3d-prow">
      <span className="tb3d-prow-k">{title}</span>
      <span className="tb3d-prow-b">{children}</span>
    </div>
  );
}

const LABEL_POLICIES: { id: LabelPolicy; label: string; title: string }[] = [
  { id: 'focus', label: 'Focus', title: 'Only the selected part and its immediate neighbours (at most 4 labels)' },
  { id: 'all', label: 'All', title: 'Every part on this level' },
  { id: 'none', label: 'None', title: 'No labels' },
];

/** More ▾ popover: everything that is not a primary action. */
function MorePanel() {
  const level = useScene((s) => s.level);
  const explode = useScene((s) => s.explode);
  const paused = useScene((s) => s.paused);
  const xray = useScene((s) => s.xray);
  const ghost = useScene((s) => s.ghostOthers);
  const path = useScene((s) => s.highlightPath);
  const showGrid = useScene((s) => s.showGrid);
  const labelPolicy = useScene((s) => s.labelPolicy);
  const inspection = useScene((s) => s.inspectionMode);
  const selectedId = useScene((s) => s.selectedId);
  const exposeDie = useView((s) => s.exposeDie);
  const lidOpacity = useView((s) => s.lidOpacity);
  const lidLift = useView((s) => s.lidLift);
  const S = useScene.getState;
  return (
    <div className="tb3d-panel" role="group" aria-label="More view controls" data-testid="more-panel">
      <Row title="Assembly">
        <label className="tb3d-slider" title="Separate the parts along their assembly axes to see how they stack. The gaps are illustrative, not real distances.">
          <span>Separate assembly</span>
          <input type="range" min={0} max={1} step={0.001} value={explode} onChange={(e) => S().setExplode(parseFloat(e.target.value))} aria-label="Separate assembly" data-testid="explode-slider" />
          <output>{Math.round(explode * 100)}%</output>
        </label>
        <Btn icon={paused ? 'play' : 'pause'} label={paused ? 'Resume' : 'Pause'} testid="btn-pause" on={paused} onClick={() => S().togglePause()} title={paused ? 'Resume the assembly animation and the moving highlights' : 'Pause the assembly animation and the moving highlights'} />
      </Row>
      <Row title="View">
        <Btn icon="view" label="Top" onClick={() => S().requestView('top')} title="Look straight down at the whole level" testid="btn-view-top" />
        <Btn icon="view" label="Front" onClick={() => S().requestView('front')} title="Look at the whole level from the front" testid="btn-view-front" />
        <Btn icon="view" label="Iso" onClick={() => S().requestView('iso')} title="The level’s standard three-quarter view" testid="btn-view-iso" />
        <Btn icon="fit" label="Fit all" onClick={() => S().requestView('fitAll')} title="Frame the whole level from the current direction" testid="btn-fit-all" />
        <Btn icon="grid" label="Grid" on={showGrid} onClick={() => S().setShowGrid(!showGrid)} title="Faint floor grid under the model (0.5 unit cells; not a scale reference)" testid="btn-grid" />
      </Row>
      <Row title="Labels">
        <div className="seg" role="radiogroup" aria-label="Label policy">
          {LABEL_POLICIES.map((p) => (
            <button key={p.id} role="radio" aria-checked={labelPolicy === p.id} className={`seg-btn${labelPolicy === p.id ? ' on' : ''}`} title={p.title} onClick={() => S().setLabelPolicy(p.id)} data-testid={`labels-${p.id}`}>
              {p.label}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Visibility">
        <Btn icon="xray" label="Translucent casing" testid="btn-xray" on={xray} onClick={() => S().toggle('xray')} title="Make housings and lids translucent so internal parts show through" />
        <Btn icon="ghost" label="Fade others" testid="btn-ghost" on={ghost} onClick={() => S().toggle('ghostOthers')} title={selectedId ? 'Fade every part except the selection to ~15% opacity' : 'Fade non-selected parts (select a part to see the effect)'} />
        <Btn icon="path" label="Signal path" testid="btn-path" on={path} onClick={() => S().toggle('highlightPath')} title="Show the signal chain through the selection, upstream and downstream (whole chain when nothing is selected)" />
      </Row>
      {level === 'package' && (
        <Row title="Package">
          <Btn icon="lid" label={exposeDie ? 'Close package' : 'Open package'} testid="btn-expose" on={exposeDie} onClick={() => useView.getState().toggleExposeDie()} title="Lift the lid away and make it translucent to show the silicon die and bond wires" />
          <label className="tb3d-slider" title="Lid opacity">
            <span>Lid opacity</span>
            <input type="range" min={0} max={1} step={0.01} value={lidOpacity} onChange={(e) => useView.getState().setLidOpacity(parseFloat(e.target.value))} aria-label="Lid opacity" data-testid="lid-opacity" />
            <output>{Math.round(lidOpacity * 100)}%</output>
          </label>
          <label className="tb3d-slider" title="Lid lift">
            <span>Lid lift</span>
            <input type="range" min={0} max={1} step={0.01} value={lidLift} onChange={(e) => useView.getState().setLidLift(parseFloat(e.target.value))} aria-label="Lid lift" data-testid="lid-lift" />
            <output>{Math.round(lidLift * 100)}%</output>
          </label>
        </Row>
      )}
      <Row title="Tools">
        <Btn icon="move" label="Move for inspection" testid="btn-inspect" on={inspection} onClick={() => S().setInspectionMode(!inspection)} title="Drag the selected part aside to look at it. Presentation only: connectivity, layout and evidence do not change." />
      </Row>
    </div>
  );
}

/** Help popover: navigation hints (mouse and Mac trackpad), keys and the guided lessons. */
function HelpPanel() {
  const S = useScene.getState;
  const close = () => useView.getState().setPanel(null);
  return (
    <div className="tb3d-panel help" role="group" aria-label="Help" data-testid="help-panel">
      <div className="tb3d-help-cols">
        <div>
          <div className="tb3d-help-h">Mouse</div>
          <ul>
            <li><b>Left-drag</b> orbit</li>
            <li><b>Right-drag</b> pan (or <kbd>⇧</kbd>/<kbd>⌘</kbd> + drag)</li>
            <li><b>Scroll</b> zoom</li>
            <li><b>Click</b> select · <b>double-click</b> explore inside</li>
          </ul>
        </div>
        <div>
          <div className="tb3d-help-h">Mac trackpad</div>
          <ul>
            <li><b>One-finger drag</b> orbit</li>
            <li><b>Two-finger scroll</b> zoom</li>
            <li><b>⇧ + drag</b> pan</li>
            <li><b>Pinch</b> fast zoom</li>
          </ul>
        </div>
        <div>
          <div className="tb3d-help-h">Keys</div>
          <ul>
            <li><kbd>F</kbd> fit the selection</li>
            <li><kbd>Esc</kbd> back one level</li>
          </ul>
          <div className="tb3d-help-h">Recover</div>
          <ul>
            <li>Lost? <b>Reset</b> returns to the level’s home view; the cube (top right) sets a direction.</li>
          </ul>
        </div>
      </div>
      <div className="tb3d-help-h">Guided lessons</div>
      <div className="tb3d-help-lessons">
        <button className="btn sm" onClick={() => { close(); S().setLessonStep(0, 'chip'); }} data-testid="lesson-chip">
          Lesson: Which part is the chip?
        </button>
        <button className="btn sm" onClick={() => { close(); S().setLessonStep(0, 'sample'); }} data-testid="lesson-sample">
          Lesson: Follow one sample
        </button>
      </div>
    </div>
  );
}

export function Toolbar3D() {
  const level = useScene((s) => s.level);
  const explode = useScene((s) => s.explode);
  const mode = useScene((s) => s.mode);
  const isolateId = useScene((s) => s.isolateId);
  const selectedId = useScene((s) => s.selectedId);
  const preset = useScene((s) => s.preset);
  const exposeDie = useView((s) => s.exposeDie);
  const panel = useView((s) => s.panel);
  const S = useScene.getState;
  const selName = selectedId ? COMPONENTS[selectedId]?.name : null;
  const root = useRef<HTMLDivElement>(null);
  const lvl3d = level === 'system' || level === 'package' || level === 'die' ? level : 'system';

  // Popovers close on an outside click or Esc (Esc is swallowed so the app does not also go Back).
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) useView.getState().setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      useView.getState().setPanel(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [panel]);

  const separated = mode === 'exploding' || (mode === 'idle' && explode > 0.5);
  const toggleAssembly = () => {
    if (mode !== 'idle') return S().setMode(mode === 'exploding' ? 'assembling' : 'exploding');
    S().setMode(explode > 0.5 ? 'assembling' : 'exploding');
  };
  const togglePanel = (p: 'more' | 'help') => useView.getState().setPanel(panel === p ? null : p);

  return (
    <div className="tb3d" ref={root} role="toolbar" aria-label="3D view controls" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tb3d-row">
        <div className="tb3d-group">
          <Btn icon="fit" label="Fit" testid="btn-fit" onClick={() => S().requestFit()} title={selName ? `Frame “${selName}” (F)` : 'Frame the whole level (F)'} />
          <Btn
            icon={separated ? 'assemble' : 'explode'}
            label={separated ? 'Assemble' : 'Separate'}
            testid="btn-assembly"
            on={mode !== 'idle'}
            onClick={toggleAssembly}
            title={separated ? 'Animate every part back into its assembled position' : 'Separate the assembly along its assembly axes (gaps are illustrative, not real distances)'}
          />
          <Btn
            icon="isolate"
            label="Isolate"
            testid="btn-isolate"
            on={!!isolateId}
            disabled={!isolateId && !selectedId}
            onClick={() => S().isolate(isolateId ? null : selectedId)}
            title={isolateId ? `Show everything again (isolating ${COMPONENTS[isolateId]?.name ?? isolateId})` : selName ? `Show only “${selName}” and its sub-parts` : 'Select a part to isolate it'}
          />
          <Btn icon="reset" label="Reset" testid="btn-reset" onClick={() => S().requestReset()} title="Return the camera to this level’s home view" />
        </div>
        <div className="tb3d-group">
          <Btn icon="help" label="Help" testid="btn-help" on={panel === 'help'} onClick={() => togglePanel('help')} title="Navigation, keys and guided lessons" />
          <Btn icon="more" label="More" testid="btn-more" on={panel === 'more'} onClick={() => togglePanel('more')} title="Views, labels, visibility, package lid, inspection" cls="more" />
        </div>
      </div>
      {panel === 'more' && <MorePanel />}
      {panel === 'help' && <HelpPanel />}
      {lvl3d === 'system' && (
        <div className="tb3d-row sub">
          <PresetToggle />
          {preset === 'bench' ? <LoopStrip /> : <span className="tb3d-note">Conceptual architecture · layers separate vertically · no physical dimensions</span>}
        </div>
      )}
      {lvl3d === 'die' && (
        <div className="tb3d-row sub">
          <ModeSwitcher />
        </div>
      )}
      {lvl3d === 'package' && (
        <div className="tb3d-row sub">
          <Btn icon="lid" label={exposeDie ? 'Close package' : 'Open package'} testid="btn-expose-row" on={exposeDie} onClick={() => useView.getState().toggleExposeDie()} title="Lift the lid away and make it translucent to show the silicon die and bond wires (different from Separate: this opens one package)" />
          <span className="tb3d-note">Separate = pull the parts apart · Open package = lift this lid</span>
        </div>
      )}
      <SelectionBar level={lvl3d} />
      <IsolationBanner />
      <InspectionBanner />
    </div>
  );
}
