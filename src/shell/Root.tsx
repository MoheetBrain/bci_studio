// Application shell. One dark stage; a slim dock of scenes ordered by physical scale; the selected brain region is
// carried through every scene and one click returns to it. The brain stays mounted so its camera and state survive.
import { lazy, Suspense, useEffect } from 'react';
import { useShell, WORKSPACES, type Workspace } from './shellStore';
import { useAtlas } from '../atlas/atlasStore';
import { AtlasWorkspace } from '../atlas/AtlasWorkspace';
import { AtlasSearch, AtlasTree } from '../atlas/AtlasTree';
import { applyDocumentPrefs, loadPrefs } from '../state/prefs';
import './shell.css';

const InterfaceWorkspace = lazy(() => import('../neuro/InterfaceWorkspace'));
const SignalWorkspace = lazy(() => import('../journey/SignalWorkspace'));
const ChipWorkspace = lazy(() => import('../chipmap/ChipWorkspace'));
const DecoderWorkspace = lazy(() => import('../decoder/DecoderWorkspace'));
const ResearchWorkspace = lazy(() => import('../research/ResearchWorkspace'));

function RegionChip() {
  const name = useAtlas((s) => s.nameOf(s.selectedId));
  const status = useAtlas((s) => s.status);
  const workspace = useShell((s) => s.workspace);
  const go = useShell((s) => s.go);
  const setPalette = useShell((s) => s.setPalette);
  const back = () => {
    go('brain');
    const st = useAtlas.getState();
    if (st.selectedId) requestAnimationFrame(() => st.camera({ kind: 'fit', ids: st.selectionIds() }));
  };
  if (status !== 'ready') return <span className="region-chip region-chip-empty" data-testid="region-chip">{status === 'error' ? 'Atlas unavailable' : 'Loading…'}</span>;
  if (!name) {
    return <button type="button" className="region-chip region-chip-empty" onClick={() => setPalette(true)} data-testid="region-chip" title="Find a region (⌘K)">No region selected</button>;
  }
  return (
    <button type="button" className="region-chip" onClick={back} title="Return to this region in the brain" data-testid="region-chip">
      <span className="region-chip-dot" aria-hidden="true" />
      <span className="region-chip-name">{name}</span>
      {workspace !== 'brain' && <span className="region-chip-back">Back to brain ↩</span>}
    </button>
  );
}

/** Region finder: search by name or synonym, or browse the atlas hierarchy. Opens with ⌘K, Ctrl-K or "/". */
function Finder() {
  const open = useShell((s) => s.paletteOpen);
  const setPalette = useShell((s) => s.setPalette);
  const go = useShell((s) => s.go);
  const ready = useAtlas((s) => s.status === 'ready');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPalette(!useShell.getState().paletteOpen); }
      else if (e.key === '/' && !typing && !useShell.getState().paletteOpen) { e.preventDefault(); setPalette(true); }
      else if (e.key === 'Escape' && useShell.getState().paletteOpen) { e.stopPropagation(); setPalette(false); useAtlas.getState().hover(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setPalette]);
  if (!open || !ready) return null;
  const picked = () => { setPalette(false); go('brain'); };
  return (
    <div className="finder-scrim cine" onPointerDown={(e) => { if (e.target === e.currentTarget) { setPalette(false); useAtlas.getState().hover(null); } }}>
      <div className="finder" role="dialog" aria-modal="true" aria-label="Find a region" data-testid="finder">
        <AtlasSearch onPicked={picked} autoFocus />
        <div className="finder-browse">
          <div className="finder-title">Browse the atlas hierarchy <span>↑ ↓ move · → open · Enter choose</span></div>
          <AtlasTree onPicked={picked} />
        </div>
        <div className="finder-foot"><span>Names and hierarchy are the source atlas’s own.</span><kbd>Esc</kbd></div>
      </div>
    </div>
  );
}

export default function Root() {
  const workspace = useShell((s) => s.workspace);
  const go = useShell((s) => s.go);
  const setPalette = useShell((s) => s.setPalette);
  const load = useAtlas((s) => s.load);

  useEffect(() => { applyDocumentPrefs(loadPrefs()); void load(); }, [load]);

  const pane = (w: Workspace, node: React.ReactNode) => workspace === w && (
    <div className="shell-pane" data-workspace={w}>
      <Suspense fallback={<div className="shell-loading cine" role="status">Loading…</div>}>{node}</Suspense>
    </div>
  );

  return (
    <div className="shell" data-workspace={workspace}>
      <header className="shell-bar cine">
        <button type="button" className="shell-brand" onClick={() => go('brain')} title="Hamiltonian Interface — BCI Studio">
          <span className="shell-mark" aria-hidden="true" />
          <span className="shell-word">Hamiltonian</span>
          <small>BCI Studio</small>
        </button>
        <nav className="dock" aria-label="Scenes, from the whole brain down to the chip">
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`dock-item${workspace === w.id ? ' current' : ''}`}
              aria-current={workspace === w.id ? 'page' : undefined}
              title={w.hint}
              onClick={() => go(w.id)}
              data-testid={`nav-${w.id}`}
            >
              <span className="dock-label">{w.label}</span>
              <span className="dock-scale" aria-hidden="true">{w.scale}</span>
            </button>
          ))}
        </nav>
        <div className="shell-right">
          <RegionChip />
          <button type="button" className="find-btn" onClick={() => setPalette(true)} aria-label="Find a region" title="Find a region (⌘K or /)" data-testid="find-open">
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span>Find a region</span><kbd>⌘K</kbd>
          </button>
        </div>
      </header>
      <main className="shell-main">
        <div className="shell-pane" data-workspace="brain" style={{ display: workspace === 'brain' ? undefined : 'none' }}>
          <AtlasWorkspace />
        </div>
        {pane('interface', <InterfaceWorkspace />)}
        {pane('signal', <SignalWorkspace />)}
        {pane('chip', <ChipWorkspace />)}
        {pane('decoder', <DecoderWorkspace />)}
        {pane('research', <ResearchWorkspace />)}
      </main>
      <Finder />
    </div>
  );
}
