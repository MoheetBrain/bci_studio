import { useEffect, useRef, useState } from 'react';
import { breadcrumb, useScene, type Destination } from '../state/sceneStore';
import { LEVELS } from '../model/types';
import { COMPONENTS } from '../model/components';
import { kindOf, KIND_LABEL, KIND_HELP } from '../model/kind';
import { EvidenceBadge } from './EvidenceBadge';
import { MODES, TEACHING, payload } from '../model/system';
import type { ProcMode } from '../model/types';
import { useV03 } from '../lab/v03Store';
import { startCourse } from '../micro/course/Course';

const MODE_LIST: ProcMode[] = ['EVENT', 'RAW', 'FEATURE', 'HYBRID'];

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const I = {
  sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  left: 'M4 5h16v14H4zM9 5v14',
  right: 'M4 5h16v14H4zM15 5v14',
};

/** Readout mode (cfg_mode) + live payload at the synthetic teaching profile. Advanced bar only. */
function ModeAndPayload() {
  const procMode = useScene((s) => s.procMode);
  const setProcMode = useScene((s) => s.setProcMode);
  const demo = useV03((v) => v.demo);
  const setTab = useV03((v) => v.setTab);
  const goTo = useScene((s) => s.goTo);
  const evRate = demo.records.EVENT.length / (demo.T / TEACHING.sample_rate_hz);
  const p = payload({ channels: TEACHING.num_channels, rateHz: TEACHING.sample_rate_hz, sampleBits: TEACHING.sample_bits, winSamples: 32, eventRateHz: evRate });
  const bps = p[procMode];
  return (
    <div className="mode-pick" data-testid="mode-pick">
      <span>Readout mode</span>
      <div className="seg" title="hbci_readout_core cfg_mode: what the chip sends">
        {MODE_LIST.map((m) => (
          <button key={m} className={procMode === m ? 'on' : ''} onClick={() => setProcMode(m)} title={MODES[m].summary} style={{ ['--mc' as string]: `var(--mode-${m.toLowerCase()})` }}>{m}</button>
        ))}
      </div>
      <button className="payload-chip" onClick={() => { setTab('payload'); goTo('lab'); }} title="Payload at the synthetic teaching profile (8 ch, 2 kS/s, 16 b). Arithmetic, not a measured link rate. Click for the calculator.">
        {bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbit/s` : `${(bps / 1e3).toFixed(1)} kbit/s`}
      </button>
    </div>
  );
}

/** Advanced engineering controls: the full level ladder, readout mode and payload. */
export function AdvancedBar() {
  const level = useScene((s) => s.level);
  const setLevel = useScene((s) => s.setLevel);
  const setAdvanced = useScene((s) => s.setAdvanced);
  const viewEvidence = useScene((s) => s.viewEvidence);
  return (
    <div className="advanced-bar" data-testid="advanced-bar">
      <span style={{ fontWeight: 600, color: 'var(--fg)' }}>Advanced</span>
      <nav className="levels" aria-label="Engineering level">
        {LEVELS.map((l, i) => (
          <span key={l.id} style={{ display: 'contents' }}>
            {i > 0 && <span className="sep">›</span>}
            <button className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)} data-level={l.id}>{l.label}</button>
          </span>
        ))}
      </nav>
      <ModeAndPayload />
      <span className="evidence-bar"><span>This view</span><EvidenceBadge e={viewEvidence} /></span>
      <span className="spacer" />
      <button className="btn sm" onClick={() => setAdvanced(false)}>Hide advanced</button>
    </div>
  );
}

function HelpMenu({ onClose }: { onClose: () => void }) {
  const s = useScene;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; // document listener runs before App's window listener
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const advanced = useScene((x) => x.advanced);
  const reduce = useScene((x) => x.reduceMotionPref);
  const grid = useScene((x) => x.showGrid);
  const policy = useScene((x) => x.labelPolicy);
  return (
    <div className="helpmenu" ref={ref} role="dialog" aria-label="Help">
      <div className="helpmenu-sec">
        <div className="helpmenu-h">Lessons</div>
        <button className="btn primary" onClick={() => { startCourse(0); onClose(); }} data-testid="help-course">Explore my chip (8 short lessons)</button>
        <button className="btn" onClick={() => { s.getState().setLessonStep(0, 'chip'); onClose(); }} data-testid="help-lesson-chip">Which part is the chip?</button>
        <button className="btn" onClick={() => { s.getState().setLessonStep(0, 'sample'); onClose(); }} data-testid="help-lesson-sample">Follow one sample</button>
      </div>
      <div className="helpmenu-sec">
        <div className="helpmenu-h">Navigation</div>
        <div className="helpmenu-row"><span>Rotate</span><kbd>drag</kbd><span className="faint">two-finger drag on a trackpad</span></div>
        <div className="helpmenu-row"><span>Zoom</span><kbd>scroll</kbd><span className="faint">pinch on a trackpad</span></div>
        <div className="helpmenu-row"><span>Pan</span><kbd>right-drag</kbd><span className="faint">or ⌘ + drag</span></div>
        <div className="helpmenu-row"><span>Fit selection</span><kbd>F</kbd><span className="faint">Back</span><kbd>Esc</kbd></div>
      </div>
      <div className="helpmenu-sec">
        <div className="helpmenu-h">View options</div>
        <label className="helpmenu-row"><input type="checkbox" checked={advanced} onChange={(e) => s.getState().setAdvanced(e.target.checked)} /> Advanced engineering controls</label>
        <label className="helpmenu-row"><input type="checkbox" checked={grid} onChange={(e) => s.getState().setShowGrid(e.target.checked)} /> Faint floor grid</label>
        <label className="helpmenu-row"><input type="checkbox" checked={reduce === 'reduce'} onChange={(e) => s.getState().setReduceMotion(e.target.checked ? 'reduce' : 'system')} /> Reduce motion</label>
        <div className="helpmenu-row"><span>Labels</span>
          <span className="modeswitch">
            {(['focus', 'all', 'none'] as const).map((p) => <button key={p} className={policy === p ? 'on' : ''} onClick={() => s.getState().setLabelPolicy(p)}>{p === 'focus' ? 'Selection + neighbours' : p === 'all' ? 'Show all' : 'None'}</button>)}
          </span>
        </div>
      </div>
      <div className="helpmenu-sec">
        <button className="btn" onClick={() => { s.getState().resetWorkspace(); onClose(); }} data-testid="reset-workspace" title="Restores panel sizes, theme, labels and view options. Project data and hardware evidence are untouched.">Reset workspace</button>
      </div>
    </div>
  );
}

export function TopNav() {
  const state = useScene();
  const { level, selectedId, preset, uiMode, theme, panels } = state;
  const dest = state.destination();
  const crumbs = breadcrumb({ level, selectedId, preset });
  const sel = selectedId ? COMPONENTS[selectedId] : null;
  const [help, setHelp] = useState(false);
  const pick = (d: Destination) => state.goTo(d);

  return (
    <div className="topnav">
      <div className="brand" title="Hamiltonian BCI Chip studio · HBCI-02 v0.4: DSP readout core + on-chip AI decoder (RTL, SYNTH); layout only for the v0.2 event core">
        <span className="chip" />
        HBCI-02 Studio <small>v0.4</small>
      </div>
      <nav className="dest" aria-label="Destination">
        <button className={dest === 'chip' && state.labSize === 'collapsed' ? 'on' : dest === 'chip' ? 'on' : ''} onClick={() => pick('chip')} data-testid="dest-chip">My chip</button>
        <button className={dest === 'system' ? 'on' : ''} onClick={() => pick('system')} data-testid="dest-system">System context</button>
        <button className={state.labSize !== 'collapsed' ? 'on' : ''} onClick={() => pick('lab')} data-testid="dest-lab" title="Open the signal drawer">Signal lab</button>
      </nav>
      <div className="crumbs" aria-label="Breadcrumb" data-testid="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <span className="sep">›</span>}
            {i === crumbs.length - 1 ? (
              <span className="cur">{c.label}</span>
            ) : (
              <button onClick={() => { if (c.level) state.setLevel(c.level); if (c.id) state.select(c.id); }}>{c.label}</button>
            )}
          </span>
        ))}
        {sel && (
          <span className={`kind kind-${kindOf(sel)}`} title={KIND_HELP[kindOf(sel)]} style={{ marginLeft: 6 }}>{KIND_LABEL[kindOf(sel)]}</span>
        )}
      </div>
      <div className="spacer" />
      <div className="modeswitch" role="group" aria-label="Learn or inspect" title="Learn: short explanation and one next action. Inspect: source, metrics and traces for the same object.">
        <button className={uiMode === 'learn' ? 'on' : ''} onClick={() => state.setUiMode('learn')} data-testid="mode-learn">Learn</button>
        <button className={uiMode === 'inspect' ? 'on' : ''} onClick={() => state.setUiMode('inspect')} data-testid="mode-inspect" title="Expert: Verilog names first, sources, metrics and traces">Expert</button>
      </div>
      {sel && <span className="evidence-bar" title="Evidence behind the selected object"><EvidenceBadge e={sel.evidence} /></span>}
      <button className={`iconbtn${theme === 'graphite' ? ' on' : ''}`} onClick={() => state.setTheme(theme === 'paper' ? 'graphite' : 'paper')} title={theme === 'paper' ? 'Switch to the graphite (dark) theme' : 'Switch to the paper (light) theme'} aria-label="Toggle theme" data-testid="theme-toggle">
        <Icon d={theme === 'paper' ? I.moon : I.sun} />
      </button>
      <button className={`iconbtn${panels.leftOpen ? '' : ' on'}`} onClick={() => state.setPanels({ leftOpen: !panels.leftOpen })} title={panels.leftOpen ? 'Hide the component tree' : 'Show the component tree'} aria-label="Toggle component tree"><Icon d={I.left} /></button>
      <button className={`iconbtn${panels.rightOpen ? '' : ' on'}`} onClick={() => state.setPanels({ rightOpen: !panels.rightOpen })} title={panels.rightOpen ? 'Hide the inspector' : 'Show the inspector'} aria-label="Toggle inspector"><Icon d={I.right} /></button>
      <div style={{ position: 'relative' }}>
        <button className={`iconbtn${help ? ' on' : ''}`} onClick={() => setHelp((v) => !v)} title="Help, lessons and view options" aria-label="Help" aria-expanded={help} data-testid="help-btn"><Icon d={I.help} /></button>
        {help && <HelpMenu onClose={() => setHelp(false)} />}
      </div>
    </div>
  );
}
