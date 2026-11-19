// Viewport overlay panels for the 3D levels: selection bar, isolation / inspection banners, the
// "die inside the package" note, the first-visit hint toast, preset toggle, READ–COMPUTE–FEEDBACK
// loop strip, die processing-mode switcher, cortical legend + watermark, die note and the FPS meter.
import { useEffect, useState } from 'react';
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';
import { KIND_LABEL, kindOf } from '../model/kind';
import { BISC, LOOP, LOOP_COMPONENT, MODES } from '../model/system';
import type { Evidence, Level, Preset, ProcMode } from '../model/types';
import { frameStats, useView } from '../three/viewStore';
import { useDieLayout } from '../three/dieLayout';
import { MODE_COLOR, PROC_MODES } from '../three/modes';
import { useTheme3D } from '../three/theme';
import { focusIds } from '../three/labels';
import { exploreTarget, selectAndNavigate } from './nav';

const PRESETS: { id: Preset; label: string; title: string }[] = [
  { id: 'bench', label: 'Bench prototype', title: 'The modular bench assembly and the READ–COMPUTE–FEEDBACK loop' },
  { id: 'cortical', label: 'Thin cortical candidate', title: 'A conceptual future architecture: a thin film on the cortical surface. Not engineered, not manufactured.' },
];

export function PresetToggle() {
  const preset = useScene((s) => s.preset);
  return (
    <div className="seg" role="radiogroup" aria-label="System preset" data-testid="preset-toggle">
      <span className="seg-k">Preset</span>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={preset === p.id}
          className={`seg-btn${preset === p.id ? ' on' : ''}`}
          title={p.title}
          data-preset={p.id}
          onClick={() => preset !== p.id && useScene.getState().setPreset(p.id)}
        >
          {p.label}
          {p.id === 'cortical' && <em className="seg-tag">CONCEPT</em>}
        </button>
      ))}
    </div>
  );
}

/** Loop stage → the registry component that represents it (the decoder is the on-chip block since v0.4). */
const LOOP_TARGET: Record<string, string> = LOOP_COMPONENT;
const LOOP_SHORT: Record<string, string> = {
  'loop.read': 'READ',
  'loop.chip': 'CHIP',
  'loop.decoder': 'DECODER',
  'loop.llm': 'LLM',
  'loop.feedback': 'FEEDBACK',
};
const READ_IDS = ['sys.electrode_array', 'sys.flex_interconnect', 'sys.connector', 'sys.afe', 'sys.adc'];

export function LoopStrip() {
  const sel = useScene((s) => s.selectedId);
  return (
    <div className="loopstrip" aria-label="READ–COMPUTE–FEEDBACK loop" data-testid="loop-strip">
      {LOOP.map((st, i) => {
        const target = LOOP_TARGET[st.id];
        const on = sel === target || (st.id === 'loop.read' && !!sel && READ_IDS.includes(sel)) || (st.id === 'loop.decoder' && !!sel && sel.startsWith('rtl.ai'));
        const ev = (st.status as Evidence) ?? 'CONCEPT';
        return (
          <span key={st.id} className="loopstrip-item">
            {i > 0 && <span className="loopstrip-arrow">→</span>}
            <button
              className={`loopstrip-btn${on ? ' on' : ''}${st.implemented ? '' : ' notimpl'}`}
              title={`${st.name} · ${st.status}${st.implemented ? (st.id === 'loop.decoder' ? ' · on the chip (RTL)' : '') : ' · not implemented'}\n${st.note}`}
              data-loop={st.id}
              onClick={() => {
                const c = COMPONENTS[target];
                if (c) selectAndNavigate(c);
              }}
            >
              <i className={`ev-dot ev-${ev}`} />
              {LOOP_SHORT[st.id] ?? st.name}
            </button>
          </span>
        );
      })}
      <span className="loopstrip-arrow" title="The loop closes back at the person">↺</span>
    </div>
  );
}

export function ModeSwitcher() {
  const mode = useScene((s) => s.procMode);
  useTheme3D();
  const info = MODES[mode];
  return (
    <div className="modesw" data-testid="mode-switcher">
      <div className="seg" role="radiogroup" aria-label="Readout processing mode (cfg_mode)">
        <span className="seg-k">cfg_mode</span>
        {PROC_MODES.map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            className={`seg-btn mode-btn${mode === m ? ' on' : ''}`}
            style={{ ['--mc' as string]: MODE_COLOR[m] }}
            title={`${m} (cfg_mode = ${MODES[m].code}): ${MODES[m].summary}`}
            data-mode={m}
            onClick={() => useScene.getState().setProcMode(m as ProcMode)}
          >
            {m}
          </button>
        ))}
      </div>
      <span className="modesw-sum">
        <b style={{ color: MODE_COLOR[mode] }}>{info.records.join(' + ')}</b> records · {info.summary}
      </span>
    </div>
  );
}

/** The current selection with its kind, evidence and the primary actions (Explore inside, Fit, Isolate). */
export function SelectionBar({ level }: { level: Level }) {
  const selectedId = useScene((s) => s.selectedId);
  const isolateId = useScene((s) => s.isolateId);
  const c = selectedId ? COMPONENTS[selectedId] : null;
  if (!c) return null;
  const target = exploreTarget(c.id, level);
  const kind = kindOf(c);
  const S = useScene.getState;
  return (
    <div className="vp-selbar" data-testid="selection-bar">
      <span className={`kind kind-${kind}`}>{KIND_LABEL[kind]}</span>
      <b className="vp-selname" title={c.name}>{c.name}</b>
      <i className={`ev-dot ev-${c.evidence}`} title={c.evidence} />
      <span className="vp-selsp" />
      {target && (
        <button className="btn sm primary" onClick={() => S().enter(target.id)} title={`Open ${target.what} (double-click does the same)`} data-testid="btn-explore">
          Explore inside ▸
        </button>
      )}
      <button
        className={`btn sm${isolateId === c.id ? ' on' : ''}`}
        onClick={() => S().isolate(isolateId === c.id ? null : c.id)}
        title={isolateId === c.id ? 'Show every part again' : `Show only “${c.name}” and its sub-parts`}
      >
        {isolateId === c.id ? 'Show all' : 'Isolate'}
      </button>
    </div>
  );
}

/** "Isolating: <name> · Show all" while a subtree is isolated. */
export function IsolationBanner() {
  const isolateId = useScene((s) => s.isolateId);
  if (!isolateId) return null;
  const name = COMPONENTS[isolateId]?.name ?? isolateId;
  return (
    <div className="vp-banner" role="status" data-testid="isolation-banner">
      <span>
        Isolating: <b>{name}</b>
      </span>
      <button className="btn sm" onClick={() => useScene.getState().showAll()} data-testid="btn-show-all">
        Show all
      </button>
    </div>
  );
}

/** "Move for inspection" banner with Reset position / Reset all / Undo / Done. */
export function InspectionBanner() {
  const on = useScene((s) => s.inspectionMode);
  const offsets = useScene((s) => s.inspectionOffsets);
  const selectedId = useScene((s) => s.selectedId);
  const undo = useView((s) => s.inspectionUndo);
  const n = Object.keys(offsets).length;
  const S = useScene.getState;
  if (!on) {
    if (n === 0) return null;
    return (
      <div className="vp-banner soft" role="status" data-testid="inspection-chip">
        <span>
          {n} part{n === 1 ? '' : 's'} moved for inspection (presentation only)
        </span>
        <button className="btn sm" onClick={() => S().resetInspectionOffsets()}>
          Reset all
        </button>
      </div>
    );
  }
  const canResetThis = !!selectedId && !!offsets[selectedId];
  return (
    <div className="vp-banner insp" role="status" data-testid="inspection-banner">
      <span>
        <b>Move for inspection</b> — drag the arrows to move the selected part. Presentation only — moving a part does not change connectivity, layout or evidence.
      </span>
      <span className="vp-banner-actions">
        <button className="btn sm" disabled={!canResetThis} onClick={() => selectedId && S().setInspectionOffset(selectedId, null)} title="Put the selected part back">
          Reset position
        </button>
        <button className="btn sm" disabled={n === 0} onClick={() => S().resetInspectionOffsets()} title="Put every moved part back">
          Reset all
        </button>
        <button
          className="btn sm"
          disabled={undo.length === 0}
          onClick={() => {
            const u = useView.getState().popInspectionUndo();
            if (u) S().setInspectionOffset(u.id, u.prev);
          }}
          title="Undo the last move"
        >
          Undo
        </button>
        <button className="btn sm primary" onClick={() => S().setInspectionMode(false)} title="Leave the inspection sandbox (moved parts stay until reset)">
          Done
        </button>
      </span>
    </div>
  );
}

/** Package level: the die callout cannot be shown while the lid hides the die. */
export function DieOccludedNote() {
  const occluded = useView((s) => s.dieOccluded);
  const wanted = useScene((s) => s.labelPolicy === 'all' || s.selectedId === 'pkg.die' || focusIds(s.selectedId, s.level).includes('pkg.die'));
  const exposeDie = useView((s) => s.exposeDie);
  if (!occluded || !wanted) return null;
  return (
    <div className="vp-card vp-note-card" data-testid="die-occluded-note">
      <b>Silicon die is inside the package</b> — the lid hides it.
      <div style={{ marginTop: 6 }}>
        <button className="btn sm primary" onClick={() => !exposeDie && useView.getState().toggleExposeDie()} data-testid="btn-open-package">
          Open package
        </button>
      </div>
    </div>
  );
}

/** Dismissible first-visit navigation hint. */
export function HintToast() {
  const dismissed = useScene((s) => s.hintDismissed);
  if (dismissed) return null;
  return (
    <div className="hint-toast" role="status" data-testid="hint-toast">
      <span>
        Drag to orbit · scroll to zoom · right-drag (or <kbd>⇧</kbd>+drag) to pan · click a part to select · <kbd>F</kbd> fit · <kbd>Esc</kbd> back
      </span>
      <button className="btn sm" onClick={() => useScene.getState().dismissHint()} data-testid="hint-dismiss">
        Got it
      </button>
    </div>
  );
}

export function CorticalLegend() {
  return (
    <div className="vp-card cx-legend" data-testid="cortical-legend">
      <div className="cx-legend-h">Sites ≠ recording channels ≠ processing channels</div>
      <ul>
        <li>
          <i className="sw sw-site" /> <b>Electrode sites</b> <span>illustrative grid (not a design)</span>
        </li>
        <li>
          <i className="sw sw-rec" /> <b>Recording channels</b> <span>a multiplexed subset of sites, read in turn (cycling)</span>
        </li>
        <li>
          <i className="sw sw-proc" /> <b>Processing channels</b> <span>HBCI-02 implements 8 (RTL)</span>
        </li>
      </ul>
      <div className="cx-ref">
        <span className="cx-ref-k">External scale reference, not HBCI-02</span>
        BISC 2025: <b>{BISC.electrode_sites.toLocaleString('en-GB')}</b> electrode sites · <b>{BISC.simultaneous_recording_channels.toLocaleString('en-GB')}</b> simultaneous recording channels
        <span className="faint"> ({BISC.source.replace(' (title)', '')})</span>
      </div>
      <div className="faint cx-nodim">No physical dimensions are shown: this geometry has none.</div>
    </div>
  );
}

export function Watermark() {
  return (
    <div className="vp-watermark" aria-hidden data-testid="concept-watermark">
      CONCEPT — not engineered, not manufactured
    </div>
  );
}

export function DieNote() {
  const layout = useDieLayout();
  const v3 = layout.v03Source === 'estimate' ? 'v0.3 blocks: est. until synthesised' : 'v0.3 blocks: synth_stats.json';
  const v4 = layout.v04Source === 'estimate' ? 'v0.4 blocks: est.' : 'v0.4 blocks: synth_stats.json';
  return (
    <div className="vp-card vp-note-card" data-testid="die-note">
      <b>Block identity: RTL · Placement: CONCEPT</b> (this map is a reading aid, not the floorplan: genuine layouts are on the Physical layout level)
      <div className="faint">
        Areas ≈ ∝ generic cell counts, clamped (event core: {layout.eventSource === 'synth_stats.json' ? 'synth' : 'snapshot'} · {v3} · {v4}
        {layout.topCells ? ` · hbci02_digital_top ${layout.topCells} cells, of which decoder ${layout.aiCells ?? '?'}` : ''}). Lit frames = paths that generate records in this mode; the decoder frame is lit in every mode; FIFO slots are illustrative.
      </div>
    </div>
  );
}

/** Measured frame rate of this canvas in this browser. Not a smoothness claim. */
export function FpsMeter({ active }: { active: boolean }) {
  const [v, setV] = useState<{ fps: number; ms: number; state: 'ok' | 'throttled' | 'hidden' | 'idle' }>({ fps: 0, ms: 0, state: 'idle' });
  useEffect(() => {
    const read = () => {
      if (!active) return setV({ fps: 0, ms: 0, state: 'idle' });
      const now = performance.now();
      const { times, n, i } = frameStats;
      const len = times.length;
      const win: number[] = [];
      for (let k = 0; k < n; k++) {
        const t = times[(i - 1 - k + len) % len];
        if (now - t > 2000) break;
        win.push(t);
      }
      const hidden = document.visibilityState === 'hidden';
      if (win.length < 2) return setV({ fps: win.length ? 0.5 : 0, ms: 0, state: hidden ? 'hidden' : 'throttled' });
      const span = win[0] - win[win.length - 1];
      const fps = ((win.length - 1) * 1000) / Math.max(1, span);
      const iv = win.slice(0, -1).map((t, k) => t - win[k + 1]).sort((a, b) => a - b);
      const med = iv[Math.floor(iv.length / 2)];
      const stale = now - frameStats.last > 600;
      setV({ fps, ms: med, state: hidden ? 'hidden' : stale || med > 100 ? 'throttled' : 'ok' });
    };
    read();
    const id = window.setInterval(read, 500);
    document.addEventListener('visibilitychange', read);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', read);
    };
  }, [active]);
  const label = v.state === 'hidden' ? 'page hidden' : v.state === 'throttled' ? 'throttled / hidden' : v.state === 'idle' ? 'canvas idle' : 'measured in this browser';
  return (
    <div className={`vp-fps ${v.state}`} title="Frames per second computed from real frame timestamps of this canvas over the last 2 s. It reports what this browser rendered; it is not a performance claim." data-testid="fps-meter">
      <b>{v.state === 'idle' ? '—' : v.fps >= 10 ? Math.round(v.fps) : v.fps.toFixed(1)}</b> fps
      {v.state === 'ok' && <span className="vp-fps-ms">{v.ms.toFixed(1)} ms</span>}
      <span className="vp-fps-k">{label}</span>
    </div>
  );
}
