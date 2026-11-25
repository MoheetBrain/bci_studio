// The chrome every toy shares: a small persistent HUD around the 3D view, the transport of the scientific clock,
// on-screen equivalents of every key, and three panels that open on demand (controls, what-am-I-looking-at, runs).
// The world keeps most of the screen; the instrument below it is the toy's own.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShell } from '../shell/shellStore';
import { ACTIONS, DEFAULT_KEYS, keyName, rebind, saveKeys, type Action } from './bindings';
import { ACTION_LABEL, controller } from './controller';
import { SPEEDS_UM_S, changeSpeedLevel, projectPoint, type V3 } from './flight';
import { perf } from './perf';
import { rt, type SceneSpec } from './runtime';
import { WorldCanvas } from './WorldCanvas';
import { TOYS, useWorld, type Quality } from './worldStore';
import './world.css';

export type SourceClass = 'measured-data' | 'derived-anatomy' | 'published-model' | 'synthetic-observation' | 'illustrative' | 'hypothesis';
export const CLASS_LABEL: Record<SourceClass, string> = {
  'measured-data': 'MEASURED DATA', 'derived-anatomy': 'DERIVED ANATOMY', 'published-model': 'PUBLISHED MODEL', 'synthetic-observation': 'SYNTHETIC OBSERVATION', illustrative: 'ILLUSTRATIVE', hypothesis: 'HYPOTHESIS',
};
export interface ModelCard { what: string; cls: SourceClass; text: string; limits: string; source?: { label: string; href: string } }
export interface Transport { onPause: () => void; onStep: () => void; stepLabel?: string; onReplay: () => void; replayLabel?: string; onCompare?: () => void; comparing?: boolean; compareLabel?: string; onReset: () => void }
export interface RunsIO { get: () => string; put: (text: string) => boolean }

/** Size a canvas to its box at the screen's pixel density and return a context that draws in CSS pixels. */
export function fitCanvas(cv: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function ClassChip({ cls }: { cls: SourceClass }) { return <span className={`w-class w-class-${cls}`} data-class={cls}><i aria-hidden="true" />{CLASS_LABEL[cls]}</span>; }

function Key({ a }: { a: Action }) { return <kbd>{keyName(controller.keys[a])}</kbd>; }

function Hold({ a, children, label }: { a: Action; children: ReactNode; label: string }) {
  const up = () => controller.hold(a, false);
  return (
    <button type="button" className="w-pad-btn" aria-label={label} title={`${label} (${keyName(controller.keys[a])})`} data-testid={`pad-${a}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); controller.hold(a, true); }} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); controller.hold(a, true); } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') up(); }} onBlur={up}>
      {children}
    </button>
  );
}

function ControlsPanel({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState(controller.keys), [waiting, setWaiting] = useState<Action | null>(null), [msg, setMsg] = useState('');
  const quality = useWorld((s) => s.quality), reduced = useWorld((s) => s.reducedMotion);
  const apply = (k: Record<Action, string>) => { controller.setKeys(k); saveKeys(k); setKeys(k); };
  const listen = (a: Action) => {
    setWaiting(a); setMsg('');
    controller.captureKey = (code) => {
      controller.captureKey = null; setWaiting(null);
      if (!code) return;
      const next = rebind(controller.keys, a, code);
      if (!next) { setMsg(`${keyName(code)} is kept for the browser or for leaving a mode.`); return; }
      apply(next);
    };
  };
  useEffect(() => () => { controller.captureKey = null; }, []);
  return (
    <div className="w-panel" role="dialog" aria-label="Controls" data-testid="panel-controls">
      <header><h2>Controls</h2><button type="button" className="w-x" onClick={onClose} aria-label="Close">×</button></header>
      <p className="w-fine">Every key has a button on screen. Click a key to change it; arrow keys always move as well. Keys do nothing while you type in a field.</p>
      <div className="w-keys">
        {(['Move', 'Look at', 'Model', 'Other'] as const).map((g) => (
          <section key={g}><h3>{g}</h3>
            {ACTIONS.filter((a) => a.group === g).map((a) => (
              <div key={a.id} className="w-key-row"><span>{a.label}</span>
                <button type="button" className={`w-keycap${waiting === a.id ? ' waiting' : ''}`} onClick={() => listen(a.id)} data-testid={`key-${a.id}`} aria-label={`${a.label}: ${keyName(keys[a.id])}. Click to change.`}>{waiting === a.id ? 'press a key…' : keyName(keys[a.id])}</button>
              </div>
            ))}
          </section>
        ))}
      </div>
      {msg && <p className="w-warn" role="status">{msg}</p>}
      <ul className="w-fine w-list">
        <li><b>Mouse look:</b> press <Key a="capture" /> or the “Mouse look” button; <kbd>Esc</kbd> gives the mouse back. Without it, drag the scene to look around.</li>
        <li><b>Select:</b> click a cell or a connection (with mouse look on, whatever is under the centre mark). A drag never selects.</li>
        <li><b>Wheel:</b> travel speed while flying; distance while focused.</li>
      </ul>
      <div className="w-row">
        <label className="w-check"><input type="checkbox" checked={reduced} onChange={(e) => useWorld.setState({ reducedMotion: e.target.checked })} data-testid="reduced-motion" /> Reduce motion (no camera glides)</label>
        <label>Detail <select value={quality} onChange={(e) => useWorld.setState({ quality: e.target.value as Quality })} data-testid="quality"><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low</option></select></label>
        <button type="button" className="w-btn" onClick={() => apply({ ...DEFAULT_KEYS })} data-testid="keys-default">Default keys</button>
      </div>
      <p className="w-fine">Detail changes how the scene is drawn (pixel density, backdrop cells). It never changes a model’s time step or a recording’s sample rate.</p>
    </div>
  );
}

function ModelPanel({ cards, legend, onClose }: { cards: ModelCard[]; legend?: string; onClose: () => void }) {
  return (
    <div className="w-panel" role="dialog" aria-label="What am I looking at" data-testid="panel-model">
      <header><h2>What am I looking at?</h2><button type="button" className="w-x" onClick={onClose} aria-label="Close">×</button></header>
      <p className="w-fine">A representative circuit — a different model from the human atlas you may have come from. It is not the cells at any atlas location. Each thing on screen is one of these:</p>
      {legend && <p className="w-fine" data-testid="legend"><b>Reading the scene:</b> {legend}</p>}
      {cards.map((c) => (
        <section key={c.what} className="w-card">
          <h3>{c.what} <ClassChip cls={c.cls} /></h3>
          <p>{c.text}</p>
          <p className="w-limits"><b>Leaves out:</b> {c.limits}</p>
          {c.source && <p className="w-fine"><a href={c.source.href} target="_blank" rel="noreferrer">{c.source.label} ↗</a></p>}
        </section>
      ))}
    </div>
  );
}

function RunsPanel({ runs, onClose }: { runs: RunsIO; onClose: () => void }) {
  const [text, setText] = useState(() => runs.get()), [incoming, setIncoming] = useState(''), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => { try { const ok = runs.put(incoming); setMsg({ ok, text: ok ? 'Replayed: the result is identical to the file’s.' : 'Replayed, but the result does not match the file’s fingerprint.' }); setText(runs.get()); } catch (e) { setMsg({ ok: false, text: `Could not read that: ${e instanceof Error ? e.message : String(e)}` }); } };
  const save = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = `neuroverse-run-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  return (
    <div className="w-panel" role="dialog" aria-label="Save or replay this run" data-testid="panel-runs">
      <header><h2>This run, as a file</h2><button type="button" className="w-x" onClick={onClose} aria-label="Close">×</button></header>
      <p className="w-fine">The model, its revision, the seed, the time step and every command with its time. Anyone with this build gets the same result, and the fingerprint proves it.</p>
      <textarea readOnly value={text} rows={9} aria-label="The current run as JSON" data-testid="run-export" />
      <div className="w-row">
        <button type="button" className="w-btn" onClick={() => { setText(runs.get()); void navigator.clipboard?.writeText(runs.get()).catch(() => undefined); }} data-testid="run-copy">Refresh &amp; copy</button>
        <button type="button" className="w-btn" onClick={save} data-testid="run-save">Save as a file</button>
      </div>
      <textarea value={incoming} onChange={(e) => setIncoming(e.target.value)} rows={5} placeholder="Paste a saved run here" aria-label="A saved run to replay" data-testid="run-import" />
      <div className="w-row"><button type="button" className="w-btn primary" onClick={load} disabled={!incoming.trim()} data-testid="run-load">Replay this run</button>{msg && <span className={msg.ok ? 'w-ok' : 'w-warn'} role="status" data-testid="run-msg" data-ok={msg.ok ? '1' : '0'}>{msg.text}</span>}</div>
    </div>
  );
}

function Notice() {
  const notice = useWorld((s) => s.notice);
  const [show, setShow] = useState(false);
  useEffect(() => { if (!notice) return; setShow(true); const t = setTimeout(() => setShow(false), 4200); return () => clearTimeout(t); }, [notice]);
  return <div className={`w-notice${show && notice ? ' on' : ''}`} role="status" aria-live="polite" data-testid="world-notice">{notice?.text}</div>;
}

export function WorldFrame({ spec, tag, scene, instrument, transport, model, runs, legend, contextSwitch, line, tools }: {
  spec: SceneSpec; tag?: (id: string) => string; scene?: ReactNode; instrument: ReactNode; transport: Transport; model: ModelCard[]; runs?: RunsIO; legend?: string;
  /** One sentence about what the model just did, in its own numbers. */
  line?: ReactNode;
  /** Small toy controls that sit beside the transport. */
  tools?: ReactNode;
  /** Toy C only: the Explore / Pilot switch. */
  contextSwitch?: ReactNode;
}) {
  const toyId = useWorld((s) => s.toy), ctl = useWorld((s) => s.ctl), panel = useWorld((s) => s.panel), setPanel = useWorld((s) => s.setPanel);
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered), running = useWorld((s) => s.running), paused = useWorld((s) => s.paused);
  const reduced = useWorld((s) => s.reducedMotion);
  const toy = TOYS.find((t) => t.id === toyId), go = useShell((s) => s.go);
  const [moved, setMoved] = useState(false);
  const specRef = useRef(spec); specRef.current = spec;

  useEffect(() => { controller.reducedMotion = reduced; }, [reduced]);
  useEffect(() => {
    controller.onChange = (v) => { useWorld.setState({ ctl: v }); if (v.moving || v.captured) setMoved(true); };
    controller.onInput = (t) => perf.input(t);
    controller.onPick = (hit) => rt.onPick?.(hit);
    controller.onRefused = () => useWorld.getState().say('The browser did not hand over the mouse (this window may not be in front, or capture is not available here). Dragging the scene still looks around.');
    const focusSel = () => { const s = useWorld.getState().selected, sp = specRef.current, c = s?.kind === 'cell' ? sp.cells.find((x) => x.id === s.id) : null; if (c) controller.focus(c.pos, c.radius, c.label); else useWorld.getState().say('Select a cell first: click one, or choose it from the list'); };
    controller.actions.focus = focusSel;
    controller.actions.overview = () => { if (controller.orbitLabel === 'Overview') controller.returnToFlight(); else controller.overview(specRef.current.overview); };
    controller.actions.help = () => useWorld.getState().setPanel(useWorld.getState().panel === 'controls' ? null : 'controls');
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || controller.captureKey) return;
      const w = useWorld.getState();
      if (w.panel) { w.setPanel(null); return; }
      if (controller.mode === 'orbit') { controller.returnToFlight(); return; }
      if (w.selected) w.select(null);
    };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); controller.onChange = null; controller.onInput = null; controller.onPick = null; controller.onRefused = null; delete controller.actions.focus; delete controller.actions.overview; delete controller.actions.help; };
  }, []);

  // A button clicked with the MOUSE must not keep the keyboard: otherwise the next Space would press that button again
  // instead of pausing the model. A button reached with Tab keeps the focus and behaves as buttons do (detail is 0 for
  // a click that came from the keyboard).
  const giveKeysBack = (e: React.MouseEvent) => { if (e.detail > 0) { const b = (e.target as HTMLElement).closest('button'); if (b && document.activeElement === b) b.blur(); } };
  const selCell = selected?.kind === 'cell' ? spec.cells.find((c) => c.id === selected.id) : null;
  const aim = hovered ? (hovered.kind === 'cell' ? spec.cells.find((c) => c.id === hovered.id)?.label : `connection ${hovered.id.replace('>', ' → ')}`) : null;
  const speed = (by: number) => { changeSpeedLevel(controller.s, by); useWorld.setState({ ctl: controller.view() }); };
  return (
    <div className={`world${ctl.captured ? ' captured' : ''}`} onClick={giveKeysBack} data-testid="world" data-toy={toyId ?? ''} data-mode={ctl.mode} data-context={ctl.context} data-captured={ctl.captured ? '1' : '0'} data-paused={paused ? '1' : '0'} data-cutaway={ctl.cutaway ? '1' : '0'}>
      <div className="world-view" data-testid="world-view">
        <WorldCanvas spec={spec} tag={tag}>{scene}</WorldCanvas>
        {ctl.captured && <div className="w-reticle" aria-hidden="true" data-testid="reticle"><i /></div>}
        <div className="w-vignette" aria-hidden="true" />
      </div>

      <header className="w-top">
        <div className="w-where">
          <button type="button" className="w-btn ghost" onClick={() => useWorld.getState().setToy(null)} data-testid="world-back" title="Back to the three toys">‹ Toys</button>
          <nav aria-label="Where you are" className="w-crumbs" data-testid="world-crumbs">
            <span>Neural world</span><span>Representative circuit <ClassChip cls="illustrative" /></span><b>{toy ? `Toy ${toy.letter} · ${toy.name}` : ''}</b>
          </nav>
        </div>
        <div className="w-right">
          <button type="button" className={`w-btn${ctl.orbitLabel === 'Overview' ? ' on' : ''}`} onClick={() => controller.act('overview')} data-testid="btn-overview">Overview <Key a="overview" /></button>
          <button type="button" className={`w-btn${panel === 'model' ? ' on' : ''}`} onClick={() => setPanel(panel === 'model' ? null : 'model')} data-testid="btn-model">What is this?</button>
          {runs && <button type="button" className={`w-btn${panel === 'runs' ? ' on' : ''}`} onClick={() => setPanel(panel === 'runs' ? null : 'runs')} data-testid="btn-runs">Save / replay</button>}
          <button type="button" className={`w-btn${panel === 'controls' ? ' on' : ''}`} onClick={() => setPanel(panel === 'controls' ? null : 'controls')} data-testid="btn-controls">Controls <Key a="help" /></button>
          <button type="button" className="w-btn ghost" onClick={() => go('brain')} data-testid="classic" title="The atlas, the experiment, the chip and the decoder trace are all still here">Classic studio</button>
        </div>
      </header>

      <div className="w-status" data-testid="world-running"><span className={`w-dot${paused ? ' paused' : ''}`} aria-hidden="true" /><span>{running || 'Getting ready…'}</span><b>{paused ? 'model paused' : 'model running'}</b></div>

      <div className="w-mid">
        {ctl.mode === 'orbit' ? (
          <div className="w-pill" data-testid="mode-pill" role="status">
            <span>{ctl.orbitLabel === 'Overview' ? 'Overview of the circuit' : <>Focused on <b>{ctl.orbitLabel}</b></>} · drag to orbit, wheel for distance</span>
            <button type="button" className="w-btn primary" onClick={() => controller.returnToFlight()} data-testid="btn-return">Return <Key a="return" /></button>
            <button type="button" className="w-btn" onClick={() => controller.flyFromHere()} data-testid="btn-fly-here">Fly from here</button>
          </div>
        ) : ctl.context === 'pilot' ? null : !moved ? (
          <div className="w-pill hint" data-testid="first-hint">Drag to look · <Key a="forward" /><Key a="left" /><Key a="back" /><Key a="right" /> to fly, <Key a="up" /><Key a="down" /> up and down · <Key a="brake" /> to brake · click a cell to select it</div>
        ) : null}
        {ctl.cutaway && <div className="w-pill cut" data-testid="cutaway" role="status">Display cutaway: tissue this close is faded so you can see. Nothing in the model changed.</div>}
        <Notice />
      </div>

      <aside className="w-left" aria-label="Movement and selection">
        {contextSwitch}
        <div className="w-pad" role="group" aria-label="Move the observation rig">
          <span /><Hold a="forward" label="Forward">↑</Hold><span /><Hold a="up" label="Up">⤒</Hold>
          <Hold a="left" label="Left">←</Hold><Hold a="back" label="Back">↓</Hold><Hold a="right" label="Right">→</Hold><Hold a="down" label="Down">⤓</Hold>
          <Hold a="brake" label="Brake">Brake</Hold>
          <button type="button" className={`w-pad-btn wide${ctl.captured ? ' on' : ''}`} onClick={() => controller.act('capture')} data-testid="btn-capture" title="Turn with the mouse; Esc gives it back">{ctl.captured ? 'Mouse look on' : 'Mouse look'} <Key a="capture" /></button>
        </div>
        <div className="w-speed" data-testid="speed"><button type="button" className="w-mini" onClick={() => speed(-1)} aria-label="Slower">−</button><span>{SPEEDS_UM_S[ctl.speedLevel]} µm/s</span><button type="button" className="w-mini" onClick={() => speed(1)} aria-label="Faster">+</button></div>
        <div className="w-sel">
          <label><span>Go to</span>
            <select value={selCell?.id ?? ''} onChange={(e) => { const c = spec.cells.find((x) => x.id === e.target.value); useWorld.getState().select(c ? { kind: 'cell', id: c.id } : null); if (c) { rt.onPick?.({ kind: 'cell', id: c.id, t: 0 }); controller.focus(c.pos, c.radius, c.label); } }} data-testid="goto" aria-label="Select a cell and look at it">
              <option value="">a cell…</option>{spec.cells.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <button type="button" className="w-btn" disabled={!selCell} onClick={() => controller.act('focus')} data-testid="btn-focus">Focus <Key a="focus" /></button>
        </div>
        <div className="w-aim" data-testid="aim">{selected ? <>Selected: <b>{selCell?.label ?? `connection ${selected.id.replace('>', ' → ')}`}</b></> : aim ? <>Under the {ctl.captured ? 'centre mark' : 'pointer'}: {aim}</> : 'Nothing selected'}</div>
      </aside>

      <section className="w-bottom" aria-label="Instrument">
        <div className="w-transport" role="group" aria-label="Scientific clock" data-testid="transport">
          <button type="button" className="w-btn primary" onClick={transport.onPause} data-testid="t-pause">{paused ? 'Run' : 'Pause'} <Key a="pause" /></button>
          <button type="button" className="w-btn" onClick={transport.onStep} data-testid="t-step" title={transport.stepLabel}>Step <Key a="step" /></button>
          <button type="button" className="w-btn" onClick={transport.onReplay} data-testid="t-replay">{transport.replayLabel ?? 'Replay'}</button>
          {transport.onCompare && <button type="button" className={`w-btn${transport.comparing ? ' on' : ''}`} onClick={transport.onCompare} data-testid="t-compare" title="Keep what is shown now so that the next result can be read against it on the same axes">{transport.compareLabel ?? 'Compare'}</button>}
          <button type="button" className="w-btn" onClick={transport.onReset} data-testid="t-reset">Reset</button>
          <div className="w-line" data-testid="world-line" aria-live="polite">{line}</div>
          {tools}
        </div>
        {instrument}
      </section>

      {panel === 'controls' && <ControlsPanel onClose={() => setPanel(null)} />}
      {panel === 'model' && <ModelPanel cards={model} legend={legend} onClose={() => setPanel(null)} />}
      {panel === 'runs' && runs && <RunsPanel runs={runs} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** Test and inspection hooks (read-only views of the controller, plus where a scene point is on screen). */
function screenOf(p: V3): { x: number; y: number; visible: boolean } {
  const cv = document.querySelector('[data-testid="world-view"] canvas'), r = cv?.getBoundingClientRect(), s = controller.s;
  if (!r) return { x: 0, y: 0, visible: false };
  const q = projectPoint(s.pos, s.yaw, s.pitch, controller.fovY, controller.aspect, p);
  return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height, visible: q.front && Math.abs(q.x) < 1 && Math.abs(q.y) < 1 };
}
if (typeof window !== 'undefined') (window as unknown as { __world?: unknown }).__world = { controller, rt, store: useWorld, perf, labels: ACTION_LABEL, screenOf, defaultKeys: DEFAULT_KEYS };
