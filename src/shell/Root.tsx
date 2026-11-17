// Application shell: the brain atlas is the home screen; the journey bar leads from it to the neural interface,
// the acquisition chain, our chip and the research corpus. The selected region is shown on every screen.
import { lazy, Suspense, useEffect } from 'react';
import { useShell, WORKSPACES, type Workspace } from './shellStore';
import { useAtlas } from '../atlas/atlasStore';
import { AtlasWorkspace } from '../atlas/AtlasWorkspace';
import { applyDocumentPrefs, loadPrefs } from '../state/prefs';
import './shell.css';

const InterfaceWorkspace = lazy(() => import('../neuro/InterfaceWorkspace'));
const SignalWorkspace = lazy(() => import('../journey/SignalWorkspace'));
const ChipWorkspace = lazy(() => import('../chipmap/ChipWorkspace'));
const ResearchWorkspace = lazy(() => import('../research/ResearchWorkspace'));

function RegionChip() {
  const name = useAtlas((s) => s.nameOf(s.selectedId));
  const status = useAtlas((s) => s.status);
  const workspace = useShell((s) => s.workspace);
  const go = useShell((s) => s.go);
  const back = () => {
    go('brain');
    const st = useAtlas.getState();
    if (st.selectedId) requestAnimationFrame(() => st.camera({ kind: 'fit', ids: st.selectionIds() }));
  };
  if (status !== 'ready') return <span className="region-chip region-chip-empty">Atlas {status === 'error' ? 'unavailable' : 'loading…'}</span>;
  if (!name) {
    return workspace === 'brain'
      ? <span className="region-chip region-chip-empty" data-testid="region-chip">No region selected</span>
      : <button type="button" className="region-chip region-chip-empty" onClick={back} data-testid="region-chip">No region selected — choose one in the brain</button>;
  }
  return (
    <button type="button" className="region-chip" onClick={back} title="Return to this region in the brain" data-testid="region-chip">
      <span className="region-chip-dot" aria-hidden="true" />
      <span className="region-chip-label">Region</span>
      <span className="region-chip-name">{name}</span>
      {workspace !== 'brain' && <span className="region-chip-back">Back to brain ↩</span>}
    </button>
  );
}

export default function Root() {
  const workspace = useShell((s) => s.workspace);
  const go = useShell((s) => s.go);
  const load = useAtlas((s) => s.load);

  useEffect(() => { applyDocumentPrefs(loadPrefs()); void load(); }, [load]);

  const pane = (w: Workspace, node: React.ReactNode) => workspace === w && (
    <div className="shell-pane" data-workspace={w}>
      <Suspense fallback={<div className="shell-loading" role="status">Loading…</div>}>{node}</Suspense>
    </div>
  );

  return (
    <div className="shell" data-workspace={workspace}>
      <header className="shell-bar">
        <div className="shell-brand">
          <span className="shell-mark" aria-hidden="true" />
          <span>Hamiltonian Interface</span>
          <small>BCI Studio</small>
        </div>
        <nav className="shell-nav" aria-label="Journey from brain to chip">
          {WORKSPACES.map((w, i) => (
            <span key={w.id} className="shell-step-wrap">
              {i > 0 && <span className="shell-arrow" aria-hidden="true">→</span>}
              <button
                type="button"
                className={`shell-step${workspace === w.id ? ' current' : ''}`}
                aria-current={workspace === w.id ? 'page' : undefined}
                title={w.hint}
                onClick={() => go(w.id)}
                data-testid={`nav-${w.id}`}
              >
                <span className="shell-step-n" aria-hidden="true">{w.step}</span>
                {w.label}
              </button>
            </span>
          ))}
        </nav>
        <RegionChip />
      </header>
      <main className="shell-main">
        {/* The atlas stays mounted so the camera, selection and display state survive every view change. */}
        <div className="shell-pane" data-workspace="brain" style={{ display: workspace === 'brain' ? undefined : 'none' }}>
          <AtlasWorkspace />
        </div>
        {pane('interface', <InterfaceWorkspace />)}
        {pane('signal', <SignalWorkspace />)}
        {pane('chip', <ChipWorkspace />)}
        {pane('research', <ResearchWorkspace />)}
      </main>
      <footer className="shell-foot">
        Educational and research software. Not a medical device, not a surgical planner, and it controls no stimulation.
      </footer>
    </div>
  );
}
