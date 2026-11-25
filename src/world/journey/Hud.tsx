// The overlay around the world: where you are, what is running, what is selected, and the one thing worth doing
// next. Compact on purpose — the world keeps the screen. Everything longer opens on demand.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAtlas } from '../../atlas/atlasStore';
import { NEAR0_UM, unitAmpUv } from '../../experiment/model/motor';
import { useShell, type Workspace } from '../../shell/shellStore';
import { ACTIONS, DEFAULT_KEYS, keyName, rebind, saveKeys, type Action } from '../bindings';
import { controller } from '../controller';
import { SPEEDS_UM_S, changeSpeedLevel } from '../flight';
import { MANIFEST } from '../manifest';
import { workshopCircuit } from '../model/circuits';
import { changesBetween } from '../model/journey';
import { OBS } from '../model/observe';
import { PILOT_TARGET_RADIUS, PILOT_UNITS, detectProb, detectorNoiseUv } from '../model/pilot';
import { useWorld, type Quality } from '../worldStore';
import { ClassChip, fitCanvas } from '../WorldFrame';
import { ENTRY_ID, brain } from './BrainStage';
import { cellNow, probeNow, replay, slowFactor, useLab } from './circuitLab';
import { SPEC, isContact, isUnit } from './CortexStage';
import { DECODER_NAME, DecoderPicker, LevelSwitch } from './Dock';
import { task, useTask } from './decoderTask';
import { BEATS, nextBeat, useJourney, type BeatId } from './journeyStore';

const f1 = (v: number) => v.toFixed(1).replace('-', '−');
const Key = ({ a }: { a: Action }) => <kbd>{keyName(controller.keys[a])}</kbd>;
export interface HudActions { enter: () => void; leave: () => void; resume: () => void; goStation: (s: 'circuit' | 'array') => void; pilot: () => void; select: (kind: 'cell' | 'site' | 'link', id: string, focus?: boolean) => void }

/** Drawing the frame loop asks for (the cursor's workspace). */
export const hud = { draw: null as null | (() => void) };

// ── where you are ───────────────────────────────────────────────────────────────────────────────────────────────
function Where({ act }: { act: HudActions }) {
  const place = useJourney((s) => s.place), entry = useJourney((s) => s.entry), station = useJourney((s) => s.station), setPanel = useWorld((s) => s.setPanel);
  const inCortex = place === 'cortex' || place === 'entering';
  return (
    <nav className="j-where" aria-label="Where you are" data-testid="where">
      <button type="button" className={`j-crumb${inCortex ? '' : ' here'}`} onClick={() => inCortex && act.leave()} disabled={!inCortex} data-testid="crumb-brain" title={inCortex ? 'Back out to the whole brain. Your experiment stays as it is.' : undefined}>Brain</button>
      {inCortex && <><i aria-hidden="true">›</i><span className="j-crumb" data-testid="crumb-region">{entry?.name ?? 'left precentral gyrus'}</span><i aria-hidden="true">›</i><button type="button" className="j-crumb here" onClick={() => act.goStation(station === 'circuit' ? 'array' : 'circuit')} data-testid="crumb-station" title="Go to the other part of this block">{station === 'circuit' ? 'Cortical circuit' : 'Electrode array'}</button></>}
      <button type="button" className="j-source" onClick={() => setPanel('model')} data-testid="source-chip" title="What is measured, what is a model and what is illustration here">
        <ClassChip cls={inCortex ? 'illustrative' : 'derived-anatomy'} /><span>{inCortex ? 'tissue · models run inside it' : 'one volunteer’s MRI · atlas labels'}</span>
      </button>
    </nav>
  );
}

/** One line: which model is running, at what model time and how slowed down. */
function Running() {
  const place = useJourney((s) => s.place), station = useJourney((s) => s.station), owner = useJourney((s) => s.owner);
  const lab = useLab(), st = useTask(), ctx = useWorld((s) => s.ctl.context);
  if (place !== 'cortex') return null;
  const circuit = station === 'circuit', paused = circuit ? lab.paused : st.paused;
  const text = circuit
    ? <>Five-cell circuit · replaying two input events · <b>{lab.tMs.toFixed(1)} ms</b> of 60 · slow motion ×{slowFactor(lab.speed)} · run {lab.lab.history.length}</>
    : st.status !== 'ready' ? <>Decoder task · {st.status === 'calibrating' ? `calibrating (${st.progress?.what ?? '…'})` : st.status}</>
    : <>Decoder task · real time · bin <b>{st.snap?.bin ?? 0}</b> · {DECODER_NAME[st.info?.decoderId ?? 'linear']} · {ctx === 'pilot' ? 'your keys are the intent' : 'intent is zero until you take the controls'}</>;
  return (
    <div className="j-running" data-testid="running" data-paused={paused ? '1' : '0'} data-station={station}>
      <span className={`j-dot${paused ? ' paused' : ''}`} aria-hidden="true" /><span>{text}</span><b>{paused ? 'model paused — you can still move' : 'model running'}</b>
      <span className={`j-owner ${owner}`} data-testid="owner" data-owner={owner} title="Who the keyboard belongs to right now">{owner === 'pilot' ? 'Keys: your intent' : owner === 'interface' ? 'Keys: this control · Esc returns them' : 'Keys: fly'}</span>
    </div>
  );
}

// ── the next step of the route ──────────────────────────────────────────────────────────────────────────────────
function Guide({ act }: { act: HudActions }) {
  const j = useJourney(), beat = nextBeat(j), done = BEATS.filter((b) => j.beats[b.id]).length;
  const say = useWorld((s) => s.say);
  if (!j.guide || j.place === 'entering' || j.place === 'leaving') return null;
  const button: Partial<Record<BeatId, [string, () => void]>> = {
    enter: ['Go in →', act.enter],
    change: ['Select B', () => act.select('cell', 'B', true)],
    compare: ['Open the trace', () => j.set({ level: 'understand' })],
    record: ['Show me the probe', () => act.select('site', 'probe', true)],
    engineer: [j.station === 'array' ? 'Take the controls' : 'Go to the array', () => (j.station === 'array' ? act.pilot() : act.goStation('array'))],
    return: ['Back to the brain', act.leave],
  };
  const all = !beat && !!j.beats.return;
  if (!beat && !all) return j.place === 'brain' && j.visited ? <div className="j-guide" data-testid="guide" data-beat="back"><p>Nothing in there was lost. Go back in and try another change — the inhibitory connection, or a later B.</p></div> : null;
  const b = beat ? button[beat.id] : undefined;
  return (
    <div className="j-guide" data-testid="guide" data-beat={beat?.id ?? 'done'} role="status">
      <span className="j-steps" aria-label={`${done} of ${BEATS.length} steps of the route done`}>{BEATS.map((x) => <i key={x.id} className={j.beats[x.id] ? 'done' : x.id === beat?.id ? 'now' : ''} />)}</span>
      <p>{all ? 'That is the whole route. Nothing is locked: switch the inhibitory connection on (select the violet cell I) and find a timing that still fires — or see how late B can come.' : beat!.prompt}</p>
      {b && <button type="button" className="j-btn primary" onClick={b[1]} data-testid="guide-act">{b[0]}</button>}
      <button type="button" className="j-x" onClick={() => { j.set({ guide: false }); say('Guide hidden. It can be switched back on under Controls.'); }} aria-label="Hide the guide" title="Hide the guide" data-testid="guide-hide">×</button>
    </div>
  );
}

// ── what is selected ────────────────────────────────────────────────────────────────────────────────────────────
function Nudge({ which }: { which: 'aMs' | 'bMs' }) {
  const s = useLab(), v = s.lab.setup[which] ?? 0, base = s.lab.baseline.recipe.parameters[which];
  const set = (ms: number) => s.change({ [which]: Math.max(0, Math.min(50, Math.round(ms * 4) / 4)) });
  return (
    <div className="j-cause" data-testid={`cause-${which}`}>
      <span>Fires at <b>{f1(v)} ms</b>{base != null && base !== v ? <em> (baseline {f1(base)})</em> : null}</span>
      <div className="j-nudge" role="group" aria-label="Change when this input fires">
        <button type="button" className="j-btn" onClick={() => set(v - 4)} data-testid={`${which}-earlier4`} title="4 ms earlier">« 4</button>
        <button type="button" className="j-btn" onClick={() => set(v - 1)} data-testid={`${which}-earlier`} title="1 ms earlier">‹ 1 ms</button>
        <button type="button" className="j-btn" onClick={() => set(v + 1)} data-testid={`${which}-later`} title="1 ms later">1 ms ›</button>
        <button type="button" className="j-btn" onClick={() => set(v + 4)} data-testid={`${which}-later4`} title="4 ms later">4 »</button>
      </div>
      <input type="range" min={0} max={50} step={0.25} value={v} onChange={(e) => s.change({ [which]: +e.target.value }, false)} onPointerUp={replay} onKeyUp={replay} aria-label="When this input fires, in milliseconds" data-testid={`${which}-range`} />
    </div>
  );
}

function Card({ act }: { act: HudActions }) {
  const sel = useWorld((s) => s.selected), select = useWorld((s) => s.select), level = useJourney((s) => s.level);
  const lab = useLab(), st = useTask();
  if (!sel) return null;
  const c = workshopCircuit(0), close = <button type="button" className="j-x" onClick={() => select(null)} aria-label="Clear the selection" data-testid="card-close">×</button>;
  const focusBtn = <button type="button" className="j-btn" onClick={() => controller.act('focus')} data-testid="card-focus">Look at it <Key a="focus" /></button>;
  let body: ReactNode = null, title = '', chip: ReactNode = null;
  if (sel.kind === 'link') {
    const k = c.conns.find((q) => q.id === sel.id);
    if (!k) return null;
    const on = lab.lab.setup.conn[k.id] ?? k.enabled !== false;
    title = `Connection ${k.from} → ${k.to}`; chip = <ClassChip cls="published-model" />;
    body = (
      <>
        <p>{k.w < 0 ? 'Inhibits' : 'Excites'}: each spike of {k.from} delivers a current of {f1(Math.abs(k.w))} nA at its peak to {k.to}, {k.delayMs.toFixed(1)} ms later. It is <b>{on ? 'connected' : 'disconnected'}</b>.</p>
        <div className="j-row"><button type="button" className="j-btn primary" onClick={() => lab.change({ conn: { ...lab.lab.setup.conn, [k.id]: !on } })} data-testid="card-toggle">{on ? 'Disconnect it' : 'Connect it'}</button></div>
        <p className="j-fine">The bead you see travelling marks the delay. No voltage is computed along the fibre.</p>
      </>
    );
  } else if (sel.kind === 'site' && sel.id === 'probe') {
    const now = probeNow(), p = lab.probe, others = Math.max(...Object.entries(p.ampsUv).filter(([k]) => k !== 'T').map(([, v]) => v));
    title = 'Recording probe'; chip = <ClassChip cls="synthetic-observation" />;
    body = (
      <>
        <p>Voltage at its tip now: <b data-testid="probe-uv">{now.uV.toFixed(0).replace('-', '−')} µV</b> — outside the cells, a thousand times smaller than what happens inside one.</p>
        <p>Counted so far in this run: <b data-testid="probe-count">{now.counted}</b> of {p.events.length} crossing{p.events.length === 1 ? '' : 's'} of its −{p.thresholdUv.toFixed(0)} µV threshold. T is {p.ampsUv.T.toFixed(0)} µV here; the other four at most {others.toFixed(0)} µV.</p>
        <div className="j-row">{focusBtn}{level === 'observe' && <button type="button" className="j-btn primary" onClick={() => useJourney.getState().set({ level: 'understand' })} data-testid="card-trace">Show its trace</button>}</div>
        <p className="j-fine">A generated signal: each model spike adds one fixed waveform, sized by 120 µV × 30 µm ÷ distance, plus {OBS.noiseUv} µV of noise. Not a recording.</p>
      </>
    );
  } else if (sel.kind === 'site' && isContact(sel.id)) {
    const ch = +sel.id.slice(2) - 1, i = st.info, lost = !!i?.cond.lost.includes(ch), thr = i?.calibration?.thresholdsUv[ch];
    title = `Array contact ${ch + 1}`; chip = <ClassChip cls="published-model" />;
    body = (
      <>
        <p>{lost ? <b>Lost: it delivers nothing.</b> : <>Counted rate now: <b>{(st.snap?.rates[ch] ?? 0).toFixed(0)} spikes/s</b> (smoothed over 250 ms).</>} {thr != null && <>Threshold {thr.toFixed(1)} µV, set at calibration; noise at the detector {detectorNoiseUv(i!.cond.noiseUv).toFixed(1)} µV.</>}</p>
        <p className="j-fine">Three model units belong to this contact. Only its count per 50 ms reaches the decoder.</p>
        <div className="j-row">{focusBtn}<button type="button" className="j-btn primary" onClick={() => act.goStation('array')} data-testid="card-task">Run the decoder task here</button></div>
      </>
    );
  } else if (sel.kind === 'cell' && isUnit(sel.id)) {
    const u = PILOT_UNITS[+sel.id.slice(1)], i = st.info, amp = unitAmpUv(u, NEAR0_UM), thr = i?.calibration?.thresholdsUv[u.ch];
    const p = thr != null ? detectProb(amp, thr, detectorNoiseUv(i!.cond.noiseUv)) : null, deg = ((((u.prefRad * 180) / Math.PI) % 360) + 360) % 360;
    title = `Population unit ${u.id + 1}`; chip = <ClassChip cls="published-model" />;
    body = (
      <>
        <p>Fires most for intended movement towards <b>{deg.toFixed(0)}°</b> (0° = right, 90° = up). {u.dist0Um.toFixed(0)} µm from contact {u.ch + 1}, so its spike is <b>{amp.toFixed(0)} µV</b> there{p != null ? <> — counted with probability {p.toFixed(2)}{i!.cond.lost.includes(u.ch) ? ' (but the contact is lost)' : ''}</> : null}.</p>
        <p className="j-fine">One of 24 units of a tuning model (rate = base + speed × (k + m·cos(direction − preferred))). Not one of the five circuit cells, and not connected to them.</p>
        <div className="j-row">{focusBtn}</div>
      </>
    );
  } else if (sel.kind === 'cell') {
    const x = c.cells.find((q) => q.id === sel.id), now = cellNow(sel.id);
    if (!x || !now) return null;
    const inh = lab.lab.setup.conn['I>T'] ?? false, gap = now.thresholdMv - now.vMv, frac = Math.max(0, Math.min(1, (now.vMv - now.restMv) / (now.thresholdMv - now.restMv)));
    title = x.label; chip = <ClassChip cls="published-model" />;
    body = (
      <>
        <p>Inside it now: <b data-testid="cell-v">{f1(now.vMv)} mV</b> · threshold {f1(now.thresholdMv)} mV · {now.spikes ? <>fired at {f1(now.lastSpikeMs!)} ms</> : gap > 0.05 ? <>{f1(gap)} mV to go</> : 'at threshold'}</p>
        <div className="j-meter" aria-hidden="true"><i style={{ width: `${frac * 100}%` }} /><b /></div>
        {x.id === 'A' && <><p className="j-fine">An input cell: you decide when it fires. It excites T — and the inhibitory cell I.</p><Nudge which="aMs" /></>}
        {x.id === 'B' && <><p className="j-fine">An input cell: you decide when it fires. It excites T.</p><Nudge which="bMs" /></>}
        {x.id === 'T' && <p className="j-fine">The cell both inputs reach. One input lifts it about 10 mV and the lift leaks away with a time constant of {(x.cm / (lab.lab.setup.glT ?? x.gl)).toFixed(0)} ms; it needs 16 mV to fire.</p>}
        {x.id === 'T' && level === 'inspect' && (
          <label className="j-cause">T’s membrane time constant <b>{(x.cm / (lab.lab.setup.glT ?? x.gl)).toFixed(1)} ms</b>
            <input type="range" min={6} max={30} step={0.5} value={+(x.cm / (lab.lab.setup.glT ?? x.gl)).toFixed(1)} onChange={(e) => lab.change({ glT: Math.max(0.004, Math.min(0.08, x.cm / +e.target.value)) }, false)} onPointerUp={replay} onKeyUp={replay} data-testid="tau-range" aria-label="T's membrane time constant in milliseconds" />
          </label>
        )}
        {x.id === 'I' && <><p className="j-fine">Inhibitory. A makes it fire; its connection onto T is <b>{inh ? 'on' : 'off'}</b>.</p><div className="j-row"><button type="button" className="j-btn primary" onClick={() => lab.change({ conn: { ...lab.lab.setup.conn, 'I>T': !inh } })} data-testid="card-inhibit">{inh ? 'Switch I → T off' : 'Switch I → T on'}</button></div></>}
        {x.id === 'D' && <p className="j-fine">Driven by T alone: it fires 2 ms after T does, and not otherwise.</p>}
        <div className="j-row">{focusBtn}</div>
      </>
    );
  }
  return (
    <aside className="j-card" aria-label="Selected" data-testid="card" data-sel={`${sel.kind}:${sel.id}`}>
      <header><h2>{title}</h2>{chip}{close}</header>
      {body}
    </aside>
  );
}

/** The selected region of the whole brain, in the atlas's own terms. */
function RegionCard({ act }: { act: HudActions }) {
  const r = useJourney((s) => s.region), go = useShell((s) => s.go);
  if (!r) return null;
  const pre = /precentral gyrus/.test(r.name);
  return (
    <aside className="j-card" aria-label="Selected region" data-testid="region-card" data-region={r.id}>
      <header><h2>{r.name.replace(/^./, (m) => m.toUpperCase())}</h2><span className="w-class w-class-derived-anatomy"><i aria-hidden="true" />ATLAS LABEL</span><button type="button" className="j-x" onClick={() => useJourney.setState({ region: null })} aria-label="Clear the selection">×</button></header>
      {r.group && <p className="j-fine">{r.group}</p>}
      {pre
        ? <p>The atlas labels this fold from its sulci. Primary motor cortex (area 4) lies within it, mostly on the wall of the central sulcus behind — but its borders differ from brain to brain and the atlas does not contain them.</p>
        : <p>The atlas names this region; this build has no circuit to enter here. The first journey starts in the left precentral gyrus.</p>}
      <div className="j-row">
        {r.enterable
          ? <button type="button" className="j-btn primary" onClick={act.enter} data-testid="region-enter">Go into the cortex here →</button>
          : <button type="button" className="j-btn primary" onClick={() => { brain.api?.face(ENTRY_ID); useJourney.setState({ region: null }); }} data-testid="region-show">Show me the way in</button>}
        <button type="button" className="j-btn" onClick={() => { useAtlas.getState().select(r.id); go('brain'); }} data-testid="region-atlas" title="Slices, hierarchy, sources and the region’s record in the classic studio">Open in the atlas</button>
      </div>
    </aside>
  );
}

// ── the decoded cursor ──────────────────────────────────────────────────────────────────────────────────────────
function CursorPanel() {
  const ref = useRef<HTMLCanvasElement | null>(null), ctx = useWorld((s) => s.ctl.context);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    hud.draw = () => {
      const { ctx: g, w, h } = fitCanvas(cv), cur = task.cur, prev = task.prev ?? cur, R = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2, sc = R / 1.15;
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(16,12,36,.82)'; g.beginPath(); g.arc(cx, cy, R, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(160,160,235,.45)'; g.lineWidth = 1; g.stroke();
      g.strokeStyle = 'rgba(160,160,235,.18)'; g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      if (!cur || !prev) return;
      const f = Math.min(1, (performance.now() - task.arrived) / 50), mix = (a: number, b: number) => a + (b - a) * f;
      const P = (x: number, y: number): [number, number] => [cx + x * sc, cy - y * sc];
      for (const [src, col, dash] of [[task.trailI, 'rgba(143,183,255,.7)', [3, 3]], [task.trailD, '#FFD9A8', []]] as Array<[number[], string, number[]]>) {
        g.strokeStyle = col; g.setLineDash(dash); g.lineWidth = 1.4; g.beginPath();
        for (let k = 0; k < src.length / 2; k++) { const [x, y] = P(src[k * 2], src[k * 2 + 1]); if (k === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke(); g.setLineDash([]);
      }
      const [tx, ty] = P(cur.target[0], cur.target[1]);
      g.strokeStyle = '#6BE3A3'; g.lineWidth = 2; g.beginPath(); g.arc(tx, ty, PILOT_TARGET_RADIUS * sc, 0, 6.3); g.stroke();
      // between two bins the cursor is drawn on the straight line joining them (it moves at constant velocity within a bin)
      const [gx, gy] = P(mix(prev.ghost[0], cur.ghost[0]), mix(prev.ghost[1], cur.ghost[1]));
      g.strokeStyle = '#8FB7FF'; g.lineWidth = 1.6; g.beginPath(); g.arc(gx, gy, 6, 0, 6.3); g.stroke();
      const [px, py] = P(mix(prev.cursor[0], cur.cursor[0]), mix(prev.cursor[1], cur.cursor[1]));
      g.fillStyle = '#FFD9A8'; g.beginPath(); g.arc(px, py, 5, 0, 6.3); g.fill();
    };
    return () => { hud.draw = null; };
  }, []);
  return (
    <aside className="j-cursor" aria-label="The decoded cursor" data-testid="cursor-panel" data-context={ctx}>
      <header><h2>Cursor</h2><span className="j-fine">moved by the decoder’s output only</span></header>
      <canvas ref={ref} role="img" aria-label="The cursor's workspace: the filled dot is moved by the decoded velocity; the hollow ring is where your intended velocity alone would have taken it; the green ring is the target." data-testid="cursor-canvas" />
      <p className="j-fine"><i className="dot gold" /> decoded cursor <i className="dot ring" /> your intent alone <i className="dot green" /> target</p>
      <DecoderPicker />
    </aside>
  );
}

// ── moving ──────────────────────────────────────────────────────────────────────────────────────────────────────
function Hold({ a, children, label }: { a: Action; children: ReactNode; label: string }) {
  const up = () => controller.hold(a, false);
  return (
    <button type="button" className="j-pad-btn" aria-label={label} title={`${label} (${keyName(controller.keys[a])})`} data-testid={`pad-${a}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); controller.hold(a, true); }} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); controller.hold(a, true); } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') up(); }} onBlur={up}>
      {children}
    </button>
  );
}
function Move({ act }: { act: HudActions }) {
  const ctl = useWorld((s) => s.ctl), sel = useWorld((s) => s.selected), station = useJourney((s) => s.station);
  // open by default where there is room for it; the player's own choice is remembered
  const [pad, setPad] = useState(() => { try { const v = localStorage.getItem('hbci.world.pad'); return v == null ? window.innerHeight >= 800 : v !== '0'; } catch { return true; } });
  const togglePad = () => { const v = !pad; setPad(v); try { localStorage.setItem('hbci.world.pad', v ? '1' : '0'); } catch { /* not remembered */ } };
  const speed = (by: number) => { changeSpeedLevel(controller.s, by); useWorld.setState({ ctl: controller.view() }); };
  const pilot = ctl.context === 'pilot';
  return (
    <aside className="j-move" aria-label={pilot ? 'Your intended velocity' : 'Move the observer'} data-testid="move">
      <button type="button" className="j-padtoggle" onClick={togglePad} aria-expanded={pad} data-testid="pad-toggle">{pilot ? 'Your intent' : 'Move'} <span>{pilot ? 'W A S D' : 'W A S D · E Q · drag to look'}</span> <i>{pad ? '▾' : '▸'}</i></button>
      {pad && <div className="j-pad" role="group" aria-label={pilot ? 'Intended direction' : 'Fly'}>
        <span /><Hold a="forward" label={pilot ? 'Intend up' : 'Forward'}>↑</Hold><span />{pilot ? <span /> : <Hold a="up" label="Up">⤒</Hold>}
        <Hold a="left" label={pilot ? 'Intend left' : 'Left'}>←</Hold><Hold a="back" label={pilot ? 'Intend down' : 'Back'}>↓</Hold><Hold a="right" label={pilot ? 'Intend right' : 'Right'}>→</Hold>{pilot ? <span /> : <Hold a="down" label="Down">⤓</Hold>}
      </div>}
      {pilot ? <p className="j-aim" data-testid="move-note">These keys are your <b>intent</b> now. The observer stays put. <kbd>Esc</kbd> gives them back.</p> : pad && (
        <>
          <div className="j-row tight">
            <Hold a="brake" label="Brake">Brake</Hold>
            <button type="button" className={`j-pad-btn wide${ctl.captured ? ' on' : ''}`} onClick={() => controller.act('capture')} data-testid="btn-capture" title="Turn by moving the mouse; Esc gives the pointer back. Dragging the scene does the same without capturing it.">{ctl.captured ? 'Mouse look on' : 'Mouse look'} <Key a="capture" /></button>
          </div>
          <div className="j-row tight j-speed" data-testid="speed"><button type="button" className="j-mini" onClick={() => speed(-1)} aria-label="Slower">−</button><span>{SPEEDS_UM_S[ctl.speedLevel]} µm/s</span><button type="button" className="j-mini" onClick={() => speed(1)} aria-label="Faster">+</button></div>
        </>
      )}
      <label className="j-goto"><span>Go to</span>
        <select value="" onChange={(e) => { const v = e.target.value; if (v === 'circuit' || v === 'array') act.goStation(v); else if (v === 'overview') controller.act('overview'); else if (v) act.select(v === 'probe' || /^ch\d$/.test(v) ? 'site' : 'cell', v, true); (e.target as HTMLSelectElement).blur(); }} data-testid="goto" aria-label="Go to a place in this block, or select a cell or an electrode contact">
          <option value="">a place…</option>
          <option value="circuit">The five-cell circuit{station === 'circuit' ? ' (here)' : ''}</option>
          <option value="array">The electrode array{station === 'array' ? ' (here)' : ''}</option>
          <option value="probe">The probe beside T</option>
          {workshopCircuit(0).cells.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          <optgroup label="Array contacts">{Array.from({ length: 8 }, (_, ch) => <option key={ch} value={`ch${ch + 1}`}>Contact {ch + 1}</option>)}</optgroup>
          <option value="overview">Overview of the whole block</option>
        </select>
      </label>
      {ctl.mode === 'orbit' && (
        <div className="j-row tight" data-testid="mode-pill">
          <button type="button" className="j-btn primary" onClick={() => controller.returnToFlight()} data-testid="btn-return">Return <Key a="return" /></button>
          <button type="button" className="j-btn" onClick={() => controller.flyFromHere()} data-testid="btn-fly-here">Fly from here</button>
        </div>
      )}
      <p className="j-aim" data-testid="aim">{ctl.mode === 'orbit' ? <>{ctl.orbitLabel === 'Overview' ? 'Overview' : <>Looking at <b>{ctl.orbitLabel}</b></>} · drag to orbit</> : sel ? <>Selected: <b>{labelOf(sel.kind, sel.id)}</b></> : 'Click something to select it'}</p>
    </aside>
  );
}
export function labelOf(kind: string, id: string): string {
  if (kind === 'link') return `connection ${id.replace('>', ' → ')}`;
  return (kind === 'site' ? SPEC.sites?.find((s) => s.id === id)?.label : SPEC.cells.find((c) => c.id === id)?.label) ?? id;
}

// ── panels on demand ────────────────────────────────────────────────────────────────────────────────────────────
function ControlsPanel({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState(controller.keys), [waiting, setWaiting] = useState<Action | null>(null), [msg, setMsg] = useState('');
  const quality = useWorld((s) => s.quality), reduced = useWorld((s) => s.reducedMotion), j = useJourney();
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
    <div className="j-panel" role="dialog" aria-label="Controls" data-testid="panel-controls">
      <header><h2>Controls</h2><button type="button" className="j-x" onClick={onClose} aria-label="Close">×</button></header>
      <ul className="j-list">
        <li><b>Look:</b> drag the scene. Or press <Key a="capture" /> for mouse look (a centre mark appears; <kbd>Esc</kbd> gives the pointer back).</li>
        <li><b>Select:</b> click a cell, a connection or an electrode tip — with mouse look on, whatever is under the centre mark. A drag never selects, and the click that starts mouse look selects nothing.</li>
        <li><b>Wheel:</b> glide along your line of sight; while looking at one thing, move nearer or further.</li>
        <li><b>Keys</b> act while the world has the keyboard. A slider or list you are using keeps the keys; click the scene or press <kbd>Esc</kbd> to take them back.</li>
      </ul>
      <div className="j-keys">
        {(['Move', 'Look at', 'Model', 'Other'] as const).map((g) => (
          <section key={g}><h3>{g}</h3>
            {ACTIONS.filter((a) => a.group === g).map((a) => (
              <div key={a.id} className="j-key-row"><span>{a.label}</span>
                <button type="button" className={`j-keycap${waiting === a.id ? ' waiting' : ''}`} onClick={() => listen(a.id)} data-testid={`key-${a.id}`} data-takes-focus aria-label={`${a.label}: ${keyName(keys[a.id])}. Click to change.`}>{waiting === a.id ? 'press a key…' : keyName(keys[a.id])}</button>
              </div>
            ))}
          </section>
        ))}
      </div>
      {msg && <p className="j-warn" role="status">{msg}</p>}
      <div className="j-row">
        <label className="j-check"><input type="checkbox" checked={reduced} onChange={(e) => useWorld.setState({ reducedMotion: e.target.checked })} data-testid="reduced-motion" /> Reduce motion (cuts instead of glides)</label>
        <label className="j-check"><input type="checkbox" checked={j.dragLooks} onChange={(e) => j.set({ dragLooks: e.target.checked })} data-testid="drag-looks" /> Dragging turns the view (instead of pulling the scene)</label>
      </div>
      <div className="j-row">
        <label>Turn rate <input type="range" min={0.5} max={2} step={0.1} value={j.lookScale} onChange={(e) => j.set({ lookScale: +e.target.value })} data-testid="look-scale" aria-label="Turn rate" /> ×{j.lookScale.toFixed(1)}</label>
        <label>Detail <select value={quality} onChange={(e) => useWorld.setState({ quality: e.target.value as Quality })} data-testid="quality"><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low</option></select></label>
      </div>
      <div className="j-row">
        <label className="j-check"><input type="checkbox" checked={j.guide} onChange={(e) => j.set({ guide: e.target.checked })} data-testid="guide-toggle" /> Show the route’s next step</label>
        <button type="button" className="j-btn" onClick={() => apply({ ...DEFAULT_KEYS })} data-testid="keys-default">Default keys</button>
      </div>
      <p className="j-fine">Detail changes how the scene is drawn (pixel density, scenery). It never changes a model’s time step.</p>
    </div>
  );
}

const READ = (id: string) => MANIFEST.find((m) => m.id === id)!;
function Entry({ id }: { id: string }) {
  const m = READ(id);
  return (
    <section className="j-entry" data-testid={`entry-${id}`}>
      <h3>{m.name} <ClassChip cls={m.cls} /></h3>
      <p>{m.what}</p>
      <p className="j-fine"><b>Units:</b> {m.units} · <b>revision</b> {m.revision}</p>
      <details><summary>Assumptions, what it leaves out, sources</summary>
        <ul className="j-list">{m.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="j-fine"><b>Leaves out:</b> {m.omits.join(' ')}</p>
        {m.sources.map((s) => <p key={s.label} className="j-fine">{s.href ? <a href={s.href} target="_blank" rel="noreferrer">{s.label} ↗</a> : s.label}{s.read !== 'n/a' && <> — read: {s.read}</>}</p>)}
        {m.verified.length > 0 && <p className="j-fine"><b>Checked in code:</b> {m.verified.join('; ')}. {m.review}.</p>}
      </details>
    </section>
  );
}
function InspectPanel({ onClose }: { onClose: () => void }) {
  const place = useJourney((s) => s.place), station = useJourney((s) => s.station), go = useShell((s) => s.go);
  const manifest = useAtlas((s) => s.manifest), lab = useLab((s) => s.lab);
  const c = workshopCircuit(0), brainPlace = place === 'brain' || place === 'leaving';
  return (
    <div className="j-panel wide" role="dialog" aria-label="What is this, exactly?" data-testid="panel-model">
      <header><h2>{brainPlace ? 'What this brain is' : station === 'circuit' ? 'The circuit, exactly' : 'The decoder task, exactly'}</h2><button type="button" className="j-x" onClick={onClose} aria-label="Close">×</button></header>
      {brainPlace ? (
        <>
          <Entry id="atlas-surface" />
          {manifest && <p className="j-fine">{manifest.dataset.name}. {manifest.dataset.subject} Licence: {manifest.dataset.licence}</p>}
          <Entry id="brain-look" />
          <p className="j-fine">Going in: the atlas ends at the surface. The tissue you enter is an illustration with models running in it — a different thing from the atlas, drawn at a different scale. No cell in it comes from this brain.</p>
        </>
      ) : station === 'circuit' ? (
        <>
          <p className="j-eq">C · dV/dt = −g<sub>L</sub>(V − E<sub>L</sub>) + I<sub>e</sub>(t) + I<sub>i</sub>(t) &nbsp;·&nbsp; spike when V ≥ V<sub>th</sub>, then V → E<sub>L</sub> for the refractory period</p>
          <table className="j-table" data-testid="params">
            <thead><tr><th>Cell</th><th>C, nF</th><th>τ = C/g<sub>L</sub>, ms</th><th>E<sub>L</sub>, mV</th><th>V<sub>th</sub>, mV</th><th>refractory, ms</th></tr></thead>
            <tbody>{c.cells.map((x) => <tr key={x.id}><td>{x.id}</td><td>{x.cm}</td><td>{(x.cm / (x.id === 'T' ? lab.setup.glT ?? x.gl : x.gl)).toFixed(1)}</td><td>{x.el}</td><td>{x.vth}</td><td>{x.trefMs}</td></tr>)}</tbody>
          </table>
          <table className="j-table">
            <thead><tr><th>Connection</th><th>peak current, nA</th><th>delay, ms</th><th>current decays in, ms</th><th>now</th></tr></thead>
            <tbody>{c.conns.map((k) => <tr key={k.id}><td>{k.from} → {k.to}</td><td>{f1(k.w)}</td><td>{k.delayMs}</td><td>{k.w < 0 ? 4 : 2}</td><td>{(lab.setup.conn[k.id] ?? k.enabled !== false) ? 'connected' : 'off'}</td></tr>)}</tbody>
          </table>
          <p className="j-fine">Run {lab.history.length}: fingerprint {lab.result.digest}; {changesBetween(lab.baseline.recipe.parameters, lab.setup).length ? `differs from the baseline in: ${changesBetween(lab.baseline.recipe.parameters, lab.setup).map((x) => x.what.toLowerCase()).join(', ')}` : 'this is the baseline'}. Nothing in this circuit is random; the probe’s noise is a fixed function of its seed and the sample number.</p>
          <Entry id="lif" /><Entry id="workshop" /><Entry id="contact" /><Entry id="cells" />
        </>
      ) : (
        <>
          <p className="j-eq">rate = base + speed × (k + m · cos(direction − preferred)) &nbsp;→&nbsp; Poisson spikes &nbsp;→&nbsp; counted with probability Φ((κ·a − θ)/σ) &nbsp;→&nbsp; decoder</p>
          <Entry id="pilot" />
          <p className="j-fine"><b>What carries over from the circuit:</b> one rule — a contact counts a spike when its size at the contact crosses a threshold set from the noise. Nothing computed in the five-cell circuit feeds the decoder; the 24 units are a different model.</p>
          <p className="j-fine"><b>Bypassed here:</b> waveform synthesis, amplifier, ADC, band-pass, common reference and the sample-by-sample detector. The whole chain, stage by stage, with the chip that implements its digital half:</p>
          <div className="j-row">
            <button type="button" className="j-btn" onClick={() => go('experiment')} data-testid="open-experiment">Full recording chain (Experiment)</button>
            <button type="button" className="j-btn" onClick={() => go('signal')} data-testid="open-signal">Electrode → ADC</button>
            <button type="button" className="j-btn" onClick={() => go('chip')} data-testid="open-chip">The chip, traced to RTL</button>
            <button type="button" className="j-btn" onClick={() => go('decoder')} data-testid="open-decoder">Decoder on the chip</button>
          </div>
          <Entry id="cells" />
        </>
      )}
    </div>
  );
}

const STUDIO: Array<[Workspace, string, string]> = [
  ['brain', 'Atlas', 'regions, slices, sources'], ['experiment', 'Experiment', 'the full recording chain'], ['interface', 'Neurons', 'Hodgkin–Huxley'],
  ['signal', 'Signal', 'electrode → ADC'], ['chip', 'Chip', 'traced to RTL'], ['decoder', 'Decoder', 'on the chip'], ['research', 'Research', 'the source corpus'],
];
function StudioMenu({ onClose }: { onClose: () => void }) {
  const go = useShell((s) => s.go);
  return (
    <div className="j-menu" role="menu" aria-label="The classic studio" data-testid="studio-menu">
      {STUDIO.map(([id, name, what]) => <button key={id} type="button" role="menuitem" onClick={() => { onClose(); go(id); }} data-testid={`studio-${id}`}><b>{name}</b><span>{what}</span></button>)}
      <button type="button" role="menuitem" onClick={() => { onClose(); location.hash = '#/world/dev'; }} data-testid="studio-dev"><b>Prototype lab</b><span>the three earlier toys</span></button>
    </div>
  );
}

function Notice() {
  const notice = useWorld((s) => s.notice);
  const [show, setShow] = useState(false);
  useEffect(() => { if (!notice) return; setShow(true); const t = setTimeout(() => setShow(false), 5200); return () => clearTimeout(t); }, [notice]);
  return <div className={`j-notice${show && notice ? ' on' : ''}`} role="status" aria-live="polite" data-testid="notice">{notice?.text}</div>;
}

/** The one-time statement that the array is a different model from the circuit. */
function Declaration({ onOk }: { onOk: () => void }) {
  return (
    <div className="j-declare" role="dialog" aria-label="A different model from here" data-testid="declare">
      <h2>A different model from here</h2>
      <p>The five-cell circuit cannot carry a direction: a decoder needs many cells. Around this array are <b>24 model units</b>, each firing more for one direction of intended movement, recorded by <b>8 contacts</b>.</p>
      <p>What carries over from the probe is one rule — <b>a contact counts a spike when it crosses a threshold</b>. Nothing computed in the circuit feeds the decoder, and the circuit’s replay stops while this task runs.</p>
      <p className="j-fine">Your keys will stand in for an intended movement. Nothing here reads a brain.</p>
      <button type="button" className="j-btn primary" onClick={onOk} data-testid="declare-ok">Understood — show me the task</button>
    </div>
  );
}

export function Hud({ act, studio, setStudio }: { act: HudActions; studio: boolean; setStudio: (v: boolean) => void }) {
  const place = useJourney((s) => s.place), station = useJourney((s) => s.station), declared = useJourney((s) => s.declared), resume = useJourney((s) => s.resume), visited = useJourney((s) => s.visited);
  const panel = useWorld((s) => s.panel), setPanel = useWorld((s) => s.setPanel), captured = useWorld((s) => s.ctl.captured), cutaway = useWorld((s) => s.ctl.cutaway);
  const inCortex = place === 'cortex';
  return (
    <>
      <header className="j-top">
        <div className="j-left"><Where act={act} /><Running /></div>
        <div className="j-right">
          {inCortex && <LevelSwitch />}
          <button type="button" className={`j-btn${panel === 'model' ? ' on' : ''}`} onClick={() => setPanel(panel === 'model' ? null : 'model')} data-testid="btn-model" title="Equations, parameters, units, sources — and what is measured versus drawn">What is this?</button>
          {inCortex && <button type="button" className={`j-btn${panel === 'controls' ? ' on' : ''}`} onClick={() => setPanel(panel === 'controls' ? null : 'controls')} data-testid="btn-controls">Controls <Key a="help" /></button>}
          <button type="button" className={`j-btn ghost${studio ? ' on' : ''}`} onClick={() => setStudio(!studio)} aria-haspopup="menu" aria-expanded={studio} data-testid="btn-studio">Studio ▾</button>
          {studio && <StudioMenu onClose={() => setStudio(false)} />}
        </div>
      </header>

      {place === 'brain' && (
        <div className="j-cta" data-testid="cta">
          <h1>Hamiltonian Neuroverse</h1>
          <div className="j-row centre">
            {visited && resume
              ? <><button type="button" className="j-btn hero" onClick={act.resume} data-testid="resume">Return to where you were →</button><button type="button" className="j-btn" onClick={act.enter} data-testid="enter">Enter from the surface</button></>
              : <button type="button" className="j-btn hero" onClick={act.enter} data-testid="enter">Enter the left precentral gyrus →</button>}
          </div>
        </div>
      )}
      {place === 'brain' && <RegionCard act={act} />}

      {inCortex && <Move act={act} />}
      {inCortex && station === 'circuit' && <Card act={act} />}
      {inCortex && station === 'array' && <div className="j-rightcol"><CursorPanel /><Card act={act} /></div>}
      {inCortex && captured && <div className="j-reticle" aria-hidden="true" data-testid="reticle"><i /></div>}
      {inCortex && cutaway && <div className="j-cut" role="status" data-testid="cutaway">Display cutaway: tissue this close is faded so you can see. Nothing in a model changed.</div>}
      {inCortex && station === 'array' && !declared && <Declaration onOk={() => useJourney.getState().set({ declared: true })} />}

      <div className="j-mid"><Notice /><Guide act={act} /></div>

      {panel === 'controls' && <ControlsPanel onClose={() => setPanel(null)} />}
      {panel === 'model' && <InspectPanel onClose={() => setPanel(null)} />}
    </>
  );
}

