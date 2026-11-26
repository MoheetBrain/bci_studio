// Toy B — Time workshop. Change a cause in a five-cell LIF circuit, replay, and compare.
//
// The run is an immutable recording of the model for one set of causes (two stimulus times, which connections are
// on, the target's leak, any extra pulses). Changing a cause computes a NEW run (well under a millisecond) with the
// old one as its parent; playing, pausing, stepping and scrubbing only move a playhead inside the recording. The 3D
// scene and the timeline read the same run at the same playhead, so what glows is what the trace shows.
import { useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { controller } from '../controller';
import { WORKSHOP_MS, defaultSetup, workshopCircuit, type WorkshopSetup } from '../model/circuits';
import { LIF_DT_MS, LIF_LIMITS, ModelClock } from '../model/lif';
import { exportRun, firingEdge, importRun, makeRun, type WorkshopResult } from '../model/workshopRun';
import { rt, type SceneSpec } from '../runtime';
import { selectionOf, useWorld } from '../worldStore';
import { WorldFrame, fitCanvas, type ModelCard } from '../WorldFrame';

const SPEEDS = [2, 5, 10, 25];
const T_COLOR = '#FFD9A8', BASE_COLOR = '#8FB7FF';
const f1 = (v: number) => v.toFixed(1).replace('-', '−');
const tauOf = (gl: number, cm = 0.25) => cm / gl;

interface Goal { id: string; text: string; done: (s: WS) => boolean }
const GOALS: Goal[] = [
  { id: 'fire', text: 'Make the target cell T fire.', done: (s) => s.result.firedMs != null },
  { id: 'edge', text: 'Find the edge: the largest delay of B after A at which T still fires. Press “Mark the edge” when you are within half a millisecond.', done: (s) => !!s.edge?.ok },
  { id: 'inhibit', text: 'Switch the connection I → T on. Now make T fire again.', done: (s) => s.result.firedMs != null && s.connOn('I>T') },
];

interface WS {
  setup: WorkshopSetup;
  result: WorkshopResult;
  baseline: WorkshopResult | null;
  focus: string;
  speed: number;
  goal: number;
  goalsDone: boolean[];
  challenge: boolean;
  edge: { gap: number; truth: number | null; ok: boolean } | null;
  /** Predict-first: the outcome of a new condition is hidden until the player has said what they expect. */
  predict: { answer: boolean | null; right: boolean | null } | null;
  tally: { right: number; total: number };
  imported: string | null;
  connOn: (id: string) => boolean;
  change: (patch: Partial<WorkshopSetup>, restart?: boolean) => void;
  pin: () => void;
  reset: () => void;
  newCondition: () => void;
  answer: (yes: boolean) => void;
  markEdge: () => void;
}

const clock = new ModelClock(5, LIF_DT_MS);
const eng = { canvas: null as HTMLCanvasElement | null, dirty: true, lastStep: -1, lastLine: 0 };
const restart = (atMs = 0) => { clock.seek(Math.round(atMs / LIF_DT_MS)); clock.paused = false; eng.dirty = true; useWorld.setState({ paused: false }); };
const settle = (s: WS): Partial<WS> => { const goalsDone = GOALS.map((g, i) => s.goalsDone[i] || g.done(s)); return { goalsDone }; };

export const useWorkshop = create<WS>((set, get) => ({
  setup: defaultSetup(0), result: makeRun(defaultSetup(0)), baseline: null, focus: 'T', speed: 5, goal: 0, goalsDone: GOALS.map(() => false), challenge: false,
  edge: null, predict: null, tally: { right: 0, total: 0 }, imported: null,
  connOn: (id) => { const s = get(), c = workshopCircuit(s.setup.variant).conns.find((k) => k.id === id); return s.setup.conn[id] ?? c?.enabled !== false; },
  change: (patch, again = true) => {
    const s = get(), setup = { ...s.setup, ...patch }, result = makeRun(setup, s.result.recipe.runId);
    set({ setup, result, edge: null, imported: null });
    if (get().challenge) set(settle(get()));
    if (again) restart(0); else eng.dirty = true;
  },
  pin: () => { const s = get(); set({ baseline: s.baseline?.recipe.runId === s.result.recipe.runId ? null : s.result }); eng.dirty = true; },
  reset: () => { const v = get().setup.variant, setup = defaultSetup(v); set({ setup, result: makeRun(setup), baseline: null, edge: null, predict: null, imported: null }); restart(0); },
  newCondition: () => {
    const s = get(), variant = (s.setup.variant % 997) + 1 + Math.floor(Math.random() * 7), setup: WorkshopSetup = { ...defaultSetup(variant), aMs: s.setup.aMs, bMs: s.setup.bMs, conn: { ...s.setup.conn } };
    set({ setup, result: makeRun(setup), baseline: null, edge: null, predict: { answer: null, right: null }, imported: null });
    clock.seek(0); clock.paused = true; eng.dirty = true; useWorld.setState({ paused: true });
  },
  answer: (yes) => {
    const s = get(), fired = s.result.firedMs != null, right = yes === fired;
    set({ predict: { answer: yes, right }, tally: { right: s.tally.right + (right ? 1 : 0), total: s.tally.total + 1 } });
    restart(0);
  },
  markEdge: () => {
    const s = get(), w = firingEdge({ ...s.setup, extra: [] }), gap = s.result.gapMs ?? NaN, truth = w ? w.hi : null;
    const ok = truth != null && s.result.firedMs != null && gap > 0 && Math.abs(gap - truth) <= 0.5;
    set({ edge: { gap, truth, ok } }); if (get().challenge) set(settle(get()));
  },
}));

function specOf(variant: number): SceneSpec {
  const c = workshopCircuit(variant);
  return {
    key: 'workshop',
    cells: c.cells.map((x) => ({ id: x.id, label: x.label, pos: x.pos, radius: x.kind === 'inh' ? 7.6 : 9.2, tint: x.id === 'A' || x.id === 'B' ? 'input' : x.kind === 'inh' ? 'inh' : 'exc', shape: x.kind === 'inh' ? 'multipolar' : 'pyramidal' })),
    links: c.conns.map((k) => ({ id: k.id, from: k.from, to: k.to, inhibitory: k.w < 0 })),
    home: { pos: [28, 46, 318], lookAt: [26, 4, 0] },
    overview: { pivot: [24, 20, 0], dist: 560, az: 0.42, el: 0.3 },
  };
}

/** One sentence about what the run just showed, in the model's own numbers. */
function sentence(r: WorkshopResult, base: WorkshopResult | null, hidden: boolean): string {
  if (hidden) return 'New numbers for this circuit. Say what you expect before you look.';
  const gap = r.gapMs, how = gap == null ? 'With one input only' : gap === 0 ? 'A and B together' : `B ${f1(Math.abs(gap))} ms ${gap > 0 ? 'after' : 'before'} A`;
  const now = r.firedMs != null
    ? `${how}: T reached threshold and fired at ${f1(r.firedMs)} ms${r.followerMs != null ? `; D followed at ${f1(r.followerMs)} ms` : ''}.`
    : `${how}: T peaked at ${f1(r.peakMv)} mV, ${f1(r.thresholdMv - r.peakMv)} mV short of its ${f1(r.thresholdMv)} mV threshold.`;
  if (!base || base.recipe.runId === r.recipe.runId) return now;
  return `${now} Baseline: T ${base.firedMs != null ? `fired at ${f1(base.firedMs)} ms` : `stayed ${f1(base.thresholdMv - base.peakMv)} mV short`}.`;
}

function frame(wall: number): void {
  const st = useWorkshop.getState(), r = st.result.run, c = r.circuit, hidden = !!st.predict && st.predict.answer == null;
  clock.msPerSecond = st.speed;
  let k = Math.min(r.nSteps, clock.tick(wall));
  if (k >= r.nSteps && !clock.paused) { clock.paused = true; clock.seek(r.nSteps); k = r.nSteps; useWorld.setState({ paused: true }); }
  const t = k * r.dt, decay = Math.max(0.5, 0.16 * st.speed);
  for (let i = 0; i < c.cells.length; i++) {
    const x = c.cells[i], v = r.v[i][k];
    rt.act[i] = hidden ? 0 : Math.max(0, Math.min(1, (v - x.el) / (r.final.vth[i] - x.el)));
    let last = -1e9;
    for (const s of r.spikes[i]) { if (s <= t) last = s; else break; }
    rt.flash[i] = hidden ? 0 : t - last < 6 * decay ? Math.exp(-(t - last) / decay) : 0;
    rt.dim[i] = 0;
  }
  c.conns.forEach((q, i) => { rt.linkOn[i] = st.connOn(q.id) ? 1 : 0; });
  rt.pulses.length = 0;
  if (!hidden) for (const s of r.sent) if (s.emitMs <= t && t < s.arriveMs) rt.pulses.push({ link: s.conn, u: (t - s.emitMs) / (s.arriveMs - s.emitMs) });
  if (k !== eng.lastStep || eng.dirty) { eng.lastStep = k; eng.dirty = false; draw(k); }
  const now = performance.now();
  if (now - eng.lastLine > 160) {
    eng.lastLine = now;
    const line = `LIF circuit · run ${st.result.recipe.runId.split('-').pop()}${st.baseline && st.baseline.recipe.runId !== st.result.recipe.runId ? ' vs baseline' : ''} · t = ${t.toFixed(2)} ms of ${WORKSHOP_MS} · ${st.speed} model-ms per second`;
    if (useWorld.getState().running !== line) useWorld.setState({ running: line });
  }
}

// ── the timeline instrument ─────────────────────────────────────────────────────────────────────────────────────
const PAD_L = 64, PAD_R = 14, LANE_H = 22, V_LO = -78, V_HI = -47;
const xOf = (ms: number, w: number) => PAD_L + (ms / WORKSHOP_MS) * (w - PAD_L - PAD_R);
const msOf = (x: number, w: number) => Math.max(0, Math.min(WORKSHOP_MS, ((x - PAD_L) / (w - PAD_L - PAD_R)) * WORKSHOP_MS));

function draw(k: number): void {
  const cv = eng.canvas;
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv), st = useWorkshop.getState(), r = st.result.run, c = r.circuit, hidden = !!st.predict && st.predict.answer == null;
  const fi = Math.max(0, c.cells.findIndex((x) => x.id === st.focus)), cell = c.cells[fi], t = k * r.dt;
  const top = LANE_H + 2, bot = h - 46, yOf = (mv: number) => top + ((V_HI - mv) / (V_HI - V_LO)) * (bot - top);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
  // time grid
  ctx.strokeStyle = 'rgba(150,185,245,.12)'; ctx.fillStyle = '#8FA0BF'; ctx.lineWidth = 1; ctx.textAlign = 'center';
  for (let ms = 0; ms <= WORKSHOP_MS; ms += 10) { const x = Math.round(xOf(ms, w)) + 0.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - 14); ctx.stroke(); ctx.fillText(`${ms}`, x, h - 6); }
  ctx.textAlign = 'right'; ctx.fillText('time, ms', PAD_L - 8, h - 6);
  // the causes: stimulus times
  ctx.textAlign = 'right'; ctx.fillStyle = '#B4C0D8'; ctx.fillText('inputs', PAD_L - 8, LANE_H / 2 + 1);
  const tick = (ms: number | null, label: string, col: string, dashed = false) => {
    if (ms == null) return;
    const x = xOf(ms, w);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, LANE_H); ctx.stroke(); ctx.setLineDash([]);
    if (!dashed) { ctx.beginPath(); ctx.arc(x, 7, 5.5, 0, 6.3); ctx.fill(); ctx.fillStyle = '#0B0817'; ctx.textAlign = 'center'; ctx.fillText(label, x, 7.5); }
  };
  if (st.baseline && st.baseline.recipe.runId !== st.result.recipe.runId) { tick(st.baseline.recipe.parameters.aMs, 'A', BASE_COLOR, true); tick(st.baseline.recipe.parameters.bMs, 'B', BASE_COLOR, true); }
  tick(st.setup.aMs, 'A', '#F1B58F'); tick(st.setup.bMs, 'B', '#F6DCA6');
  for (const e of st.setup.extra) { const x = xOf(e.ms, w); ctx.fillStyle = e.input === 'inA' ? '#F1B58F' : '#F6DCA6'; ctx.beginPath(); ctx.moveTo(x, LANE_H); ctx.lineTo(x - 4, LANE_H - 8); ctx.lineTo(x + 4, LANE_H - 8); ctx.fill(); }
  // voltage axis
  ctx.textAlign = 'right'; ctx.fillStyle = '#8FA0BF';
  for (const mv of [-70, -60, -50]) { const y = Math.round(yOf(mv)) + 0.5; ctx.strokeStyle = 'rgba(150,185,245,.10)'; ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(w - PAD_R, y); ctx.stroke(); ctx.fillText(`${mv}`.replace('-', '−'), PAD_L - 8, y); }
  ctx.save(); ctx.translate(11, (top + bot) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(`${cell.id} · mV`, 0, 0); ctx.restore();
  const vth = r.final.vth[fi], yT = yOf(vth);
  ctx.strokeStyle = 'rgba(255,123,138,.8)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(PAD_L, yT); ctx.lineTo(w - PAD_R, yT); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#FF9CA8'; ctx.textAlign = 'left'; ctx.fillText('threshold', PAD_L + 6, yT - 8);
  const trace = (run: typeof r, i: number, col: string, upTo: number, width: number, dash: number[] = []) => {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
    const v = run.v[i], stepPx = Math.max(1, Math.floor(run.nSteps / (w - PAD_L - PAD_R) / 2));
    for (let s = 0; s <= upTo; s += stepPx) { const x = xOf(s * run.dt, w), y = yOf(Math.max(V_LO, Math.min(V_HI, v[s]))); if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    // spikes are events, not waveforms: mark each with a stem above the threshold line
    for (const sp of run.spikes[i]) { if (sp > upTo * run.dt) break; const x = xOf(sp, w); ctx.beginPath(); ctx.moveTo(x, yOf(run.final.vth[i])); ctx.lineTo(x, top + 2); ctx.stroke(); }
  };
  if (hidden) { ctx.fillStyle = '#B4C0D8'; ctx.textAlign = 'center'; ctx.fillText('outcome hidden until you have made your prediction', (PAD_L + w - PAD_R) / 2, (top + bot) / 2); }
  else {
    if (st.baseline && st.baseline.recipe.runId !== st.result.recipe.runId) {
      const bi = st.baseline.run.circuit.cells.findIndex((x) => x.id === st.focus);
      if (bi >= 0) { trace(st.baseline.run, bi, BASE_COLOR, st.baseline.run.nSteps, 1.4, [4, 3]); ctx.fillStyle = BASE_COLOR; ctx.textAlign = 'right'; ctx.fillText('- - baseline', w - PAD_R - 4, top + 8); }
    }
    trace(r, fi, 'rgba(255,217,168,.33)', r.nSteps, 1.2);
    trace(r, fi, T_COLOR, k, 2.2);
  }
  // spike events of all five cells on one labelled row (a spike is an event; each carries its cell's letter)
  const yE = h - 27;
  ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'right'; ctx.fillText('spikes', PAD_L - 8, yE);
  const marks: Array<{ x: number; id: string; past: boolean }> = [];
  c.cells.forEach((x, i) => { if (hidden && x.id !== 'A' && x.id !== 'B') return; for (const sp of r.spikes[i]) marks.push({ x: xOf(sp, w), id: x.id, past: sp <= t }); });
  marks.sort((p, q) => p.x - q.x);
  let lastX = -99, lift = 0;
  for (const m of marks) {
    lift = m.x - lastX < 11 ? (lift ? 0 : 1) : 0; lastX = m.x;
    ctx.globalAlpha = m.past ? 1 : 0.35; ctx.strokeStyle = ctx.fillStyle = m.id === st.focus ? T_COLOR : '#DDE5F5'; ctx.lineWidth = 1.6; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(m.x, yE + 2); ctx.lineTo(m.x, yE + 8); ctx.stroke(); ctx.fillText(m.id, m.x, yE - 4 - lift * 9);
  }
  ctx.globalAlpha = 1;
  // playhead
  const xp = xOf(t, w);
  ctx.strokeStyle = '#7FE7FF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xp, 2); ctx.lineTo(xp, h - 14); ctx.stroke();
}

function Timeline() {
  const ref = useRef<HTMLCanvasElement | null>(null), drag = useRef<null | 'a' | 'b' | 't'>(null);
  useEffect(() => {
    eng.canvas = ref.current; eng.dirty = true;
    const ro = new ResizeObserver(() => { eng.dirty = true; });
    if (ref.current) ro.observe(ref.current);
    return () => { ro.disconnect(); eng.canvas = null; };
  }, []);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = at(e), ms = Math.round(msOf(p.x, p.w) * 4) / 4;
    if (d === 't') { clock.seek(Math.round(ms / LIF_DT_MS)); eng.dirty = true; }
    else useWorkshop.getState().change(d === 'a' ? { aMs: Math.min(50, ms) } : { bMs: Math.min(50, ms) }, false);
  };
  return (
    <canvas
      ref={ref} className="wk-timeline" data-testid="wk-timeline" role="img"
      aria-label="Timeline: stimulus times of inputs A and B, the membrane potential of the chosen cell with its threshold, and the spikes of all five cells. Drag A or B to move a stimulus; drag elsewhere to move the playhead."
      onPointerDown={(e) => {
        const p = at(e), s = useWorkshop.getState().setup;
        const near = (ms: number | null) => ms != null && Math.abs(xOf(ms, p.w) - p.x) < 9;
        drag.current = p.y <= LANE_H + 4 && near(s.bMs) ? 'b' : p.y <= LANE_H + 4 && near(s.aMs) ? 'a' : 't';
        if (drag.current === 't') { clock.paused = true; useWorld.setState({ paused: true }); }
        e.currentTarget.setPointerCapture(e.pointerId); move(e);
      }}
      onPointerMove={move}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d === 'a' || d === 'b') restart(0); }}
    />
  );
}

function Num({ id, label, value, min, max, step, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="wd-num">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} data-testid={`${id}-range`} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} data-testid={`${id}-num`} />
      <em>{unit}</em>
    </label>
  );
}

function Instrument() {
  const s = useWorkshop();
  const sel = useWorld((w) => w.selected);
  const c = workshopCircuit(s.setup.variant), T = c.cells.find((x) => x.id === 'T')!;
  const gl = s.setup.glT ?? T.gl;
  const link = sel?.kind === 'link' ? c.conns.find((k) => k.id === sel.id) : null, cell = sel?.kind === 'cell' ? c.cells.find((x) => x.id === sel.id) : null;
  return (
    <div className="wd-inst" data-testid="workshop" data-fired={s.result.firedMs != null ? '1' : '0'} data-run={s.result.recipe.runId} data-digest={s.result.digest} data-variant={s.setup.variant}>
      <div className="wd-causes">
        <div className="wd-head">Causes you can change</div>
        <Num id="wk-a" label="Stimulus A" value={s.setup.aMs ?? 0} min={0} max={50} step={0.25} unit="ms" onChange={(v) => s.change({ aMs: v })} />
        <Num id="wk-b" label="Stimulus B" value={s.setup.bMs ?? 0} min={0} max={50} step={0.25} unit="ms" onChange={(v) => s.change({ bMs: v })} />
        <Num id="wk-tau" label="T’s leak τ" value={+tauOf(gl).toFixed(1)} min={6} max={30} step={0.5} unit="ms" onChange={(v) => s.change({ glT: Math.max(LIF_LIMITS.gl[0], Math.min(LIF_LIMITS.gl[1], 0.25 / v)) })} />
        <label className="wd-check"><input type="checkbox" checked={s.connOn('I>T')} onChange={(e) => s.change({ conn: { ...s.setup.conn, 'I>T': e.target.checked } })} data-testid="wk-inhibit" /> Connection I → T (inhibition) on</label>
      </div>
      <div className="wd-main">
        <Timeline />
        {(link || cell) && (
          <div className="wd-sub">
            {link && <span className="wd-sel" data-testid="wk-link-info">{link.from} → {link.to}: {link.w < 0 ? 'inhibits' : 'excites'}, peak {f1(link.w)} nA, delay {link.delayMs.toFixed(2)} ms
              <button type="button" className="wd-btn" onClick={() => s.change({ conn: { ...s.setup.conn, [link.id]: !s.connOn(link.id) } })} data-testid="wk-link-toggle">{s.connOn(link.id) ? 'Disconnect' : 'Connect'}</button></span>}
            {cell && <span className="wd-sel" data-testid="wk-cell-info">{cell.label}: rest {f1(cell.el)} mV, threshold {f1(cell.vth)} mV, τ {f1(tauOf(cell.id === 'T' ? gl : cell.gl, cell.cm))} ms, refractory {cell.trefMs} ms</span>}
          </div>
        )}
      </div>
      <div className="wd-side">
        {s.predict ? (
          <div className="wd-card" data-testid="wk-predict">
            <div className="wd-head">Predict first · condition {s.setup.variant}</div>
            {s.predict.answer == null ? (
              <>
                <p>The circuit has new numbers. With B {f1(Math.abs(s.result.gapMs ?? 0))} ms {(s.result.gapMs ?? 0) >= 0 ? 'after' : 'before'} A{s.connOn('I>T') ? ' and inhibition on' : ''}, will T fire?</p>
                <div className="wd-row"><button type="button" className="wd-btn primary" onClick={() => s.answer(true)} data-testid="wk-predict-yes">It will fire</button><button type="button" className="wd-btn primary" onClick={() => s.answer(false)} data-testid="wk-predict-no">It will not</button></div>
              </>
            ) : (
              <p data-testid="wk-predict-result" data-right={s.predict.right ? '1' : '0'}>{s.predict.right ? 'As you predicted.' : 'Not what you predicted — look at why.'} Predictions right so far: {s.tally.right} of {s.tally.total}.</p>
            )}
            {s.predict.answer != null && <button type="button" className="wd-btn" onClick={() => useWorkshop.setState({ predict: null })}>Carry on with this circuit</button>}
          </div>
        ) : s.challenge ? (
          <div className="wd-card" data-testid="wk-challenge" data-goal={GOALS[s.goal].id} data-done={s.goalsDone[s.goal] ? '1' : '0'}>
            <div className="wd-head">Challenge {s.goal + 1} of {GOALS.length} {s.goalsDone[s.goal] ? '· done ✓' : ''}</div>
            <p>{GOALS[s.goal].text}</p>
            {GOALS[s.goal].id === 'edge' && <button type="button" className="wd-btn primary" onClick={s.markEdge} data-testid="wk-mark-edge">Mark the edge</button>}
            {s.edge && GOALS[s.goal].id === 'edge' && <p data-testid="wk-edge-result" data-ok={s.edge.ok ? '1' : '0'}>{s.edge.ok ? `Yes: the model’s edge is ${f1(s.edge.truth ?? 0)} ms.` : s.result.firedMs == null ? 'T does not fire at this delay, so the edge is earlier.' : (s.edge.gap ?? 0) <= 0 ? 'Put B after A to look for this edge.' : 'T still fires later than this. Keep going.'}</p>}
            <div className="wd-row">
              <button type="button" className="wd-btn" disabled={s.goal === 0} onClick={() => useWorkshop.setState({ goal: s.goal - 1, edge: null })}>Back</button>
              <button type="button" className="wd-btn" disabled={s.goal === GOALS.length - 1} onClick={() => useWorkshop.setState({ goal: s.goal + 1, edge: null })} data-testid="wk-next-goal">Next</button>
              <button type="button" className="wd-btn" onClick={() => useWorkshop.setState({ challenge: false })}>Close</button>
            </div>
          </div>
        ) : (
          <div className="wd-card">
            <div className="wd-head">Try it your way</div>
            <div className="wd-row">
              <button type="button" className="wd-btn" onClick={() => useWorkshop.setState({ challenge: true, goal: 0, goalsDone: GOALS.map(() => false), edge: null })} data-testid="wk-challenge-open">Optional challenge</button>
              <button type="button" className="wd-btn" onClick={s.newCondition} title="The same circuit with different numbers: predict, then test" data-testid="wk-new-condition">New condition</button>
            </div>
            <p className="wd-fine">{s.tally.total ? `Predictions right: ${s.tally.right} of ${s.tally.total}. ` : ''}{s.imported ?? 'Nothing is locked. Drag A or B on the timeline, or click a connection in the scene.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Line() {
  const s = useWorkshop();
  return <span data-testid="wk-sentence">{sentence(s.result, s.baseline, !!s.predict && s.predict.answer == null)}</span>;
}
/** Add a stimulus at the playhead: a new run that shares everything before that moment with its parent. */
function pulseNow(input: 'inA' | 'inB'): void {
  const s = useWorkshop.getState(), ms = Math.round(clock.step() * LIF_DT_MS * 20) / 20;
  s.change({ extra: [...s.setup.extra, { input, ms }].slice(-16) }, false);
  clock.paused = false; useWorld.setState({ paused: false });
  useWorld.getState().say(`Pulse on ${input === 'inA' ? 'A' : 'B'} at ${ms.toFixed(1)} ms: a new run that shares everything before it`);
}
function Tools() {
  const focus = useWorkshop((s) => s.focus), speed = useWorkshop((s) => s.speed), variant = useWorkshop((s) => s.setup.variant), paused = useWorld((w) => w.paused);
  return (
    <div className="wd-tools">
      <span className="wd-pick"><span className="wd-lab">At the playhead</span>
        <button type="button" className="wd-btn" onClick={() => pulseNow('inA')} disabled={!paused} title="Pause first; then add a stimulus on A at the playhead" data-testid="wk-pulse-a">Pulse A</button>
        <button type="button" className="wd-btn" onClick={() => pulseNow('inB')} disabled={!paused} title="Pause first; then add a stimulus on B at the playhead" data-testid="wk-pulse-b">Pulse B</button>
      </span>
      <span className="wd-pick">Trace
        {workshopCircuit(variant).cells.map((x) => <button key={x.id} type="button" className={`wd-chip${focus === x.id ? ' on' : ''}`} onClick={() => { useWorkshop.setState({ focus: x.id }); eng.dirty = true; }} data-testid={`wk-focus-${x.id}`} aria-label={`Show the trace of ${x.label}`}>{x.id}</button>)}
      </span>
      <label className="wd-speed">Playback
        <select value={speed} onChange={(e) => useWorkshop.setState({ speed: +e.target.value })} data-testid="wk-speed">{SPEEDS.map((v) => <option key={v} value={v}>{v} ms / s</option>)}</select>
      </label>
    </div>
  );
}

const MODEL: ModelCard[] = [
  { what: 'Membrane potentials, spikes and delays', cls: 'published-model', text: 'A current-based leaky integrate-and-fire circuit: C·dV/dt = −g_L(V − E_L) + I(t), threshold, reset, 2 ms refractory period, exponentially decaying synaptic currents with a fixed delay per connection. Units ms · mV · nF · µS · nA; grid 0.05 ms; the sub-threshold solution is exact between grid points.', limits: 'A spike is an event: its shape is not computed. No ion channels, dendrites or conduction along an axon. Every weight, delay and time constant is a chosen parameter, not a measurement. The refractory rule is an addition to the basic model.', source: { label: 'Gerstner, Kistler, Naud & Paninski, Neuronal Dynamics §1.3–1.4', href: 'https://neuronaldynamics.epfl.ch/online/Ch1.S3.html' } },
  { what: 'The bead moving along a connection', cls: 'illustrative', text: 'Shows that an event is on its way for the connection’s delay. Its position is (time since the spike) ÷ delay.', limits: 'Not a voltage travelling along an axon: the model has one number per connection.' },
  { what: 'Cell shapes and their arrangement', cls: 'illustrative', text: 'Generated shapes at a consistent scale. Body positions are the model’s own coordinates (µm).', limits: 'Not reconstructions, and not the cells of any atlas region.' },
];

export default function WorkshopToy() {
  const variant = useWorkshop((s) => s.setup.variant), pin = useWorkshop((s) => s.pin), reset = useWorkshop((s) => s.reset);
  const comparing = useWorkshop((s) => !!s.baseline);
  const spec = useMemo(() => specOf(variant), [variant]);
  useEffect(() => {
    rt.frame = frame;
    rt.onPick = (hit) => { useWorld.getState().select(selectionOf(hit)); if (hit?.kind === 'cell') { useWorkshop.setState({ focus: hit.id }); eng.dirty = true; } };
    restart(0);
    return () => { rt.frame = null; rt.onPick = null; };
  }, []);
  const pause = () => { if (clock.step() >= useWorkshop.getState().result.run.nSteps) { restart(0); return; } clock.paused = !clock.paused; useWorld.setState({ paused: clock.paused }); };
  const step = () => { clock.paused = true; clock.seek(Math.min(useWorkshop.getState().result.run.nSteps, clock.step() + 5)); eng.dirty = true; useWorld.setState({ paused: true }); };
  useEffect(() => { controller.actions.pause = pause; controller.actions.step = step; controller.actions.tool = () => useWorkshop.getState().pin(); return () => { delete controller.actions.pause; delete controller.actions.step; delete controller.actions.tool; }; });
  const runs = {
    get: () => JSON.stringify(exportRun(useWorkshop.getState().result), null, 1),
    put: (text: string) => { const { result, matches } = importRun(JSON.parse(text)); useWorkshop.setState({ setup: result.recipe.parameters, result, baseline: null, edge: null, predict: null, imported: matches ? `Imported run replayed: same result (digest ${result.digest}).` : `Imported run replayed, but the result differs from the file’s digest (${result.digest}).` }); restart(0); return matches; },
  };
  return (
    <WorldFrame
      spec={spec} model={MODEL} runs={runs} instrument={<Instrument />} line={<Line />} tools={<Tools />}
      tag={(id) => ({ A: 'you stimulate this', B: 'you stimulate this', I: 'inhibitory', T: 'does it fire?', D: 'fires if T does' } as Record<string, string>)[id] ?? ''}
      transport={{ onPause: pause, onStep: step, stepLabel: 'Step 0.25 ms', onReplay: () => restart(0), onCompare: pin, comparing, compareLabel: comparing ? 'Compare: clear' : 'Compare: keep run', onReset: reset }}
      legend="Peach bodies: input cells. Pink: excitatory. Violet, round: inhibitory. A bead ending excites; a flat bar inhibits."
    />
  );
}

if (typeof window !== 'undefined') (window as unknown as { __workshop?: unknown }).__workshop = { store: useWorkshop, clock, firingEdge };
