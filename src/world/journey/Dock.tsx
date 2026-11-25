// The dock under the world: one transport for whichever model is running, one sentence that says what the model
// just did in its own numbers, and (from the "Understand" level up) the traces linked to the scene.
//
// Nothing here is a second simulation. The circuit traces are drawn from the same run and playhead the scene reads;
// the decoder scope is drawn from the same snapshots that move the cursor.
import { useEffect, useRef, type ReactNode } from 'react';
import { WORKSHOP_MS } from '../model/circuits';
import { compareSentence, changesBetween, outcomeSentence, probeSentence, whySentence } from '../model/journey';
import { LIF_DT_MS } from '../model/lif';
import { PILOT_CH, PILOT_DECODERS, PILOT_FAULTS, condKey, type PilotDecoderId } from '../model/pilot';
import { useWorld } from '../worldStore';
import { fitCanvas } from '../WorldFrame';
import { SPEEDS, clock, labEng, replay, seekMs, setPaused, slowFactor, stepOnce, togglePause, useLab } from './circuitLab';
import { TASK_HIST, applyFault, calibrate, cancelCalibration, clearFaults, resetTask, setDecoder, setTaskPaused, task, taskStep, useTask, verifyReplay } from './decoderTask';
import { useJourney, type Level } from './journeyStore';

const r2 = (v: number | undefined) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(2).replace('-', '−'));
export const DECODER_NAME: Record<string, string> = { linear: 'Linear', kalman: 'Kalman filter', mlp8: 'Small network' };

/** Drawing functions the frame loop calls (set by the mounted canvases). */
export const dock = { draw: null as null | (() => void) };

// ── circuit: inputs, membrane potential, probe voltage, spikes — one time axis ──────────────────────────────────
const PAD_L = 106, PAD_R = 14, LANE = 20, V_LO = -78, V_HI = -47, T_COL = '#FFD9A8', BASE_COL = '#8FB7FF', PROBE_COL = '#F4B3FF';
const xOf = (ms: number, w: number) => PAD_L + (ms / WORKSHOP_MS) * (w - PAD_L - PAD_R);
const msOf = (x: number, w: number) => Math.max(0, Math.min(WORKSHOP_MS, ((x - PAD_L) / (w - PAD_L - PAD_R)) * WORKSHOP_MS));

function drawCircuit(cv: HTMLCanvasElement): void {
  const { ctx, w, h } = fitCanvas(cv), st = useLab.getState(), lab = st.lab, r = lab.result.run, c = r.circuit;
  const k = Math.min(r.nSteps, clock.step()), t = k * r.dt, differs = lab.baseline.recipe.runId !== lab.result.recipe.runId && changesBetween(lab.baseline.recipe.parameters, lab.setup).length > 0;
  const fi = Math.max(0, c.cells.findIndex((x) => x.id === st.focus)), cell = c.cells[fi];
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
  // lanes: inputs | membrane potential | probe | spikes | axis
  const vTop = LANE + 3, spikesY = h - 26, probeH = Math.max(24, Math.min(44, (h - 70) * 0.3)), probeBot = spikesY - 11, probeTop = probeBot - probeH, vBot = probeTop - 8;
  const yV = (mv: number) => vTop + ((V_HI - mv) / (V_HI - V_LO)) * (vBot - vTop);
  // time grid
  ctx.lineWidth = 1; ctx.textAlign = 'center';
  for (let ms = 0; ms <= WORKSHOP_MS; ms += 10) { const x = Math.round(xOf(ms, w)) + 0.5; ctx.strokeStyle = 'rgba(150,185,245,.11)'; ctx.beginPath(); ctx.moveTo(x, vTop); ctx.lineTo(x, h - 14); ctx.stroke(); ctx.fillStyle = '#8FA0BF'; ctx.fillText(`${ms}`, x, h - 6); }
  ctx.textAlign = 'left'; ctx.fillStyle = '#8FA0BF'; ctx.fillText('model ms', 6, h - 6);
  // the causes: when each input fires
  ctx.textAlign = 'left'; ctx.fillStyle = '#B4C0D8'; ctx.fillText('inputs fire at', 6, LANE / 2 + 1);
  const tick = (ms: number | null, label: string, col: string, dashed = false) => {
    if (ms == null) return;
    const x = xOf(ms, w);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, LANE); ctx.stroke(); ctx.setLineDash([]);
    if (!dashed) { ctx.beginPath(); ctx.arc(x, 8, 6.5, 0, 6.3); ctx.fill(); ctx.fillStyle = '#0B0817'; ctx.textAlign = 'center'; ctx.fillText(label, x, 8.5); }
  };
  if (differs) { tick(lab.baseline.recipe.parameters.aMs, 'A', BASE_COL, true); tick(lab.baseline.recipe.parameters.bMs, 'B', BASE_COL, true); }
  tick(lab.setup.aMs, 'A', '#F1B58F'); tick(lab.setup.bMs, 'B', '#F6DCA6');
  // membrane potential of the chosen cell (mV, inside the cell)
  ctx.textAlign = 'right'; ctx.fillStyle = '#8FA0BF';
  for (const mv of [-70, -60, -50]) { const y = Math.round(yV(mv)) + 0.5; if (y > vBot || y < vTop) continue; ctx.strokeStyle = 'rgba(150,185,245,.09)'; ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(w - PAD_R, y); ctx.stroke(); ctx.fillText(`${mv}`.replace('-', '−'), PAD_L - 8, y); }
  ctx.textAlign = 'left'; ctx.fillStyle = T_COL; ctx.fillText(`inside ${cell.id}`, 6, (vTop + vBot) / 2 - 7); ctx.fillStyle = '#8FA0BF'; ctx.fillText('mV', 6, (vTop + vBot) / 2 + 7);
  const vth = r.final.vth[fi], yT = yV(vth);
  ctx.strokeStyle = 'rgba(255,123,138,.8)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(PAD_L, yT); ctx.lineTo(w - PAD_R, yT); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#FF9CA8'; ctx.textAlign = 'left'; ctx.fillText('threshold', PAD_L + 6, yT - 8);
  const trace = (v: ArrayLike<number>, spikes: readonly number[] | null, col: string, upTo: number, width: number, dash: number[] = []) => {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
    const stepPx = Math.max(1, Math.floor(r.nSteps / (w - PAD_L - PAD_R) / 2));
    for (let s = 0; s <= upTo; s += stepPx) { const x = xOf(s * r.dt, w), y = yV(Math.max(V_LO, Math.min(V_HI, v[s]))); if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    // a spike is an event, not a waveform: a stem from the threshold line to the top of the lane
    if (spikes) for (const sp of spikes) { if (sp > upTo * r.dt) break; const x = xOf(sp, w); ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x, vTop + 2); ctx.stroke(); }
  };
  if (differs) {
    const bi = lab.baseline.run.circuit.cells.findIndex((x) => x.id === st.focus);
    if (bi >= 0) { trace(lab.baseline.run.v[bi], lab.baseline.run.spikes[bi], BASE_COL, r.nSteps, 1.4, [4, 3]); ctx.fillStyle = BASE_COL; ctx.textAlign = 'right'; ctx.fillText('- - baseline', w - PAD_R - 4, vTop + 8); }
  }
  // what each input contributes on its own (the one-input runs behind the explanation) — only for the target cell
  if (cell.id === 'T') {
    trace(st.comp.a.v[fi], null, 'rgba(241,181,143,.55)', r.nSteps, 1, [2, 3]);
    trace(st.comp.b.v[fi], null, 'rgba(246,220,166,.55)', r.nSteps, 1, [2, 3]);
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(246,220,166,.8)'; ctx.fillText('· · A alone, B alone', w - PAD_R - 4, vTop + (differs ? 21 : 8));
  }
  trace(r.v[fi], r.spikes[fi], 'rgba(255,217,168,.30)', r.nSteps, 1.2);
  trace(r.v[fi], r.spikes[fi], T_COL, k, 2.3);
  // the probe: voltage OUTSIDE the cells, at the probe's tip (µV) — a synthetic observation of the same run
  const p = st.probe, lim = 130, yP = (uv: number) => probeTop + ((30 + Math.max(-lim, Math.min(30, uv)) * -1) / (lim + 30)) * probeH;
  ctx.fillStyle = 'rgba(244,179,255,.05)'; ctx.fillRect(PAD_L, probeTop - 3, w - PAD_L - PAD_R, probeH + 6);
  ctx.textAlign = 'left'; ctx.fillStyle = PROBE_COL; ctx.fillText('at the probe', 6, (probeTop + probeBot) / 2 - 7); ctx.fillStyle = '#8FA0BF'; ctx.fillText('µV', 6, (probeTop + probeBot) / 2 + 7);
  ctx.textAlign = 'right'; ctx.fillStyle = '#8FA0BF'; ctx.fillText('0', PAD_L - 8, yP(0)); ctx.fillText(`−${lim}`, PAD_L - 8, yP(-lim) - 2);
  const yTh = yP(-p.thresholdUv);
  ctx.strokeStyle = 'rgba(255,123,138,.7)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(PAD_L, yTh); ctx.lineTo(w - PAD_R, yTh); ctx.stroke(); ctx.setLineDash([]);
  const probeTrace = (tr: Float32Array, col: string, upTo: number, width: number) => {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.beginPath();
    for (let s = 0; s <= upTo; s++) { const x = xOf(s * p.dtMs, w), y = yP(tr[s]); if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  };
  if (differs) probeTrace(st.baseProbe.trace, 'rgba(143,183,255,.5)', st.baseProbe.trace.length - 1, 1);
  probeTrace(p.trace, 'rgba(244,179,255,.28)', p.trace.length - 1, 1);
  probeTrace(p.trace, PROBE_COL, Math.min(p.trace.length - 1, k), 1.3);
  for (const e of p.events) { if (e.ms > t) break; const x = xOf(e.ms, w); ctx.fillStyle = '#FFE0AE'; ctx.beginPath(); ctx.moveTo(x, probeBot + 5); ctx.lineTo(x - 4, probeBot + 11); ctx.lineTo(x + 4, probeBot + 11); ctx.fill(); }
  // spike events of all five cells on one labelled row
  ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'left'; ctx.fillText('spikes', 6, spikesY + 4);
  const marks: Array<{ x: number; id: string; past: boolean }> = [];
  c.cells.forEach((x, i) => { for (const sp of r.spikes[i]) marks.push({ x: xOf(sp, w), id: x.id, past: sp <= t }); });
  marks.sort((a, b) => a.x - b.x);
  let lastX = -99, lift = 0;
  for (const m of marks) {
    lift = m.x - lastX < 11 ? (lift ? 0 : 1) : 0; lastX = m.x;
    ctx.globalAlpha = m.past ? 1 : 0.35; ctx.strokeStyle = ctx.fillStyle = m.id === st.focus ? T_COL : '#DDE5F5'; ctx.lineWidth = 1.6; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(m.x, spikesY + 8); ctx.lineTo(m.x, spikesY + 13); ctx.stroke(); ctx.fillText(m.id, m.x, spikesY + 1 - lift * 9);
  }
  ctx.globalAlpha = 1;
  // playhead
  const xp = xOf(t, w);
  ctx.strokeStyle = '#7FE7FF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xp, 2); ctx.lineTo(xp, h - 14); ctx.stroke();
}

function CircuitTrace() {
  const ref = useRef<HTMLCanvasElement | null>(null), drag = useRef<null | 'a' | 'b' | 't'>(null), last = useRef(-1);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    dock.draw = () => { const k = clock.step(); if (k !== last.current || labEng.dirty) { last.current = k; labEng.dirty = false; drawCircuit(cv); } };
    labEng.dirty = true;
    const ro = new ResizeObserver(() => { labEng.dirty = true; });
    ro.observe(cv);
    return () => { ro.disconnect(); dock.draw = null; };
  }, []);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = at(e), ms = Math.round(msOf(p.x, p.w) * 4) / 4;
    if (d === 't') seekMs(ms);
    else useLab.getState().change(d === 'a' ? { aMs: Math.min(50, ms) } : { bMs: Math.min(50, ms) }, false);
  };
  return (
    <canvas
      ref={ref} className="jd-trace" data-testid="trace" role="img"
      aria-label="Linked traces of the run in the scene: when inputs A and B fire; the membrane potential inside the chosen cell with its threshold, in millivolts; the voltage at the probe outside the cells, in microvolts; and the spikes of all five cells. Drag A or B to change when that input fires; drag elsewhere to move through the recording."
      onPointerDown={(e) => {
        const p = at(e), s = useLab.getState().lab.setup, near = (ms: number | null) => ms != null && Math.abs(xOf(ms, p.w) - p.x) < 10;
        drag.current = p.y <= LANE + 5 && near(s.bMs) ? 'b' : p.y <= LANE + 5 && near(s.aMs) ? 'a' : 't';
        if (drag.current === 't') setPaused(true);
        e.currentTarget.setPointerCapture(e.pointerId); move(e);
      }}
      onPointerMove={move}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d === 'a' || d === 'b') replay(); }}
    />
  );
}

// ── decoder: velocity in and out, what each contact reports, and how the decoder added it up ────────────────────
const CH_COL = ['#7FE7FF', '#8CFFB5', '#FFD08A', '#F4B3FF', '#9FD0FF', '#FF9CA8', '#C3F58A', '#E9B8FF'];
function drawScope(cv: HTMLCanvasElement): void {
  const { ctx, w, h } = fitCanvas(cv), cur = task.cur, info = useTask.getState().info;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
  // wide: velocity traces | contact bars | sum, side by side. Narrow: traces on top, bars and sum underneath.
  const narrow = w < 560, hT = narrow ? Math.round(h * 0.52) : h, yB = narrow ? hT + 6 : 0, hB = h - yB;
  const sumW = narrow ? Math.min(120, w * 0.36) : Math.min(170, w * 0.2), barsW = narrow ? w - sumW - 16 : Math.min(220, w * 0.26), x0 = 74, x1 = narrow ? w - 8 : w - barsW - sumW - 40, n = Math.min(TASK_HIST, task.histN);
  (['x', 'y'] as const).forEach((axis, a) => {
    const top = 14 + a * ((hT - 32) / 2), bot = top + (hT - 32) / 2 - 6, mid = (top + bot) / 2, y = (v: number) => mid - Math.max(-1.3, Math.min(1.3, v)) * ((bot - top) / 2.6);
    ctx.fillStyle = '#B4C0D8'; ctx.textAlign = 'left'; ctx.fillText(`velocity ${axis}`, 4, mid - 7); ctx.fillStyle = '#8FA0BF'; ctx.fillText(axis === 'x' ? '→ right' : '↑ up', 4, mid + 7);
    ctx.strokeStyle = 'rgba(150,185,245,.16)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y(0)); ctx.lineTo(x1, y(0)); ctx.stroke();
    for (const [off, col, dash, lw] of [[0, '#8FB7FF', [5, 4], 1.4], [2, '#FFD9A8', [], 1.9]] as Array<[number, string, number[], number]>) {
      ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < n; i++) { const k = (task.histN - n + i) % TASK_HIST, px = x1 - ((n - 1 - i) / (TASK_HIST - 1)) * (x1 - x0), py = y(task.hist[k * 4 + off + a]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineWidth = 1;
  });
  ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'center';
  for (let s = 0; s <= 8; s += narrow ? 4 : 2) ctx.fillText(s === 0 ? 'now' : `−${s} s`, x1 - (s / 8) * (x1 - x0) - (s === 0 && narrow ? 10 : 0), hT - 6);
  ctx.textAlign = 'left'; ctx.fillStyle = '#8FB7FF'; ctx.fillText(narrow ? '- - intended' : '- - intended (your keys)', x0 + 4, 6); ctx.fillStyle = '#FFD9A8'; ctx.fillText(narrow ? '— decoded' : '— decoded (moves the cursor)', x0 + (narrow ? 104 : 178), 6);
  // what each contact reports: the decoder's only input
  const bx = narrow ? 6 : x1 + 22, bw = (barsW - 8) / PILOT_CH, base = h - 20, top = yB + 20;
  ctx.fillStyle = '#B4C0D8'; ctx.textAlign = 'left'; ctx.fillText(narrow ? 'rate per contact' : 'counted rate per contact, spikes/s', bx, yB + 6);
  for (let c = 0; c < PILOT_CH; c++) {
    const x = bx + c * bw, lost = !!info?.cond.lost.includes(c), r = cur ? cur.rates[c] : 0, hh = Math.min(1, r / 90) * (base - top);
    ctx.fillStyle = 'rgba(150,185,245,.10)'; ctx.fillRect(x + 2, top, bw - 4, base - top);
    if (lost) { ctx.strokeStyle = '#FF9CA8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 3, top + 2); ctx.lineTo(x + bw - 3, base - 2); ctx.moveTo(x + bw - 3, top + 2); ctx.lineTo(x + 3, base - 2); ctx.stroke(); }
    else { ctx.fillStyle = CH_COL[c]; ctx.fillRect(x + 2, base - hh, bw - 4, hh); }
    ctx.fillStyle = lost ? '#FF9CA8' : '#8FA0BF'; ctx.textAlign = 'center'; ctx.fillText(lost ? '✕' : `${c + 1}`, x + bw / 2, h - 8);
  }
  // how the decoder added it up in this bin: its own base and per-contact terms, tip to tail = the decoded velocity
  const sx = w - sumW, cx = sx + sumW / 2, cy = yB + (hB + 8) / 2, R = Math.min(sumW, hB - 30) / 2 - 4, sc = R / 1.25;
  ctx.textAlign = 'left'; ctx.fillStyle = '#B4C0D8'; ctx.fillText(narrow ? 'the sum' : 'how the decoder adds it up', sx, yB + 6);
  ctx.strokeStyle = 'rgba(150,185,245,.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.3); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  if (cur && cur.termOf === 'channel' && cur.terms.length === 2) {
    let px = cx + cur.base[0] * sc, py = cy - cur.base[1] * sc;
    ctx.strokeStyle = '#8FA0BF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    for (let c = 0; c < PILOT_CH; c++) {
      const nx = px + cur.terms[0][c] * sc, ny = py - cur.terms[1][c] * sc;
      ctx.strokeStyle = CH_COL[c]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      px = nx; py = ny;
    }
    ctx.fillStyle = '#FFD9A8'; ctx.beginPath(); ctx.arc(cx + cur.decoded[0] * sc, cy - cur.decoded[1] * sc, 4, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#8FB7FF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx + cur.intent[0] * sc, cy - cur.intent[1] * sc, 5.5, 0, 6.3); ctx.stroke();
  } else if (cur) {
    ctx.fillStyle = '#FFD9A8'; ctx.beginPath(); ctx.arc(cx + cur.decoded[0] * sc, cy - cur.decoded[1] * sc, 4, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#8FB7FF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx + cur.intent[0] * sc, cy - cur.intent[1] * sc, 5.5, 0, 6.3); ctx.stroke();
    ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'center'; ctx.fillText(cur.termOf === 'hidden' ? 'not a sum over contacts' : 'no decoder fitted', cx, h - 8);
  }
}
function Scope() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { const cv = ref.current; if (!cv) return; dock.draw = () => drawScope(cv); return () => { dock.draw = null; }; }, []);
  return <canvas ref={ref} className="jd-trace scope" data-testid="scope" role="img" aria-label="Intended and decoded velocity over the last eight seconds; the smoothed spike rate each of the eight contacts reports; and the decoder's own base and per-contact terms added tip to tail to give the decoded velocity." />;
}

// ── the dock ────────────────────────────────────────────────────────────────────────────────────────────────────
export function LevelSwitch() {
  const level = useJourney((s) => s.level), set = useJourney((s) => s.set);
  const opt: Array<[Level, string, string]> = [['observe', 'Observe', 'The scene and one sentence'], ['understand', 'Understand', 'Add the linked traces'], ['inspect', 'Inspect', 'Equations, parameters, units and sources']];
  return (
    <div className="j-seg" role="group" aria-label="How much explanation to show" data-testid="level">
      {opt.map(([id, label, title]) => <button key={id} type="button" className={level === id ? 'on' : ''} aria-pressed={level === id} title={title} onClick={() => set({ level: id })} data-testid={`level-${id}`}>{label}</button>)}
    </div>
  );
}

function CircuitDock() {
  const s = useLab(), level = useJourney((j) => j.level);
  const lab = s.lab, changed = changesBetween(lab.baseline.recipe.parameters, lab.setup), atEnd = s.tMs >= WORKSHOP_MS - LIF_DT_MS;
  const sentence = outcomeSentence(lab.result);
  return (
    <>
      <div className="jd-row" role="group" aria-label="Playback of the five-cell circuit" data-testid="transport">
        <button type="button" className="j-btn primary" onClick={replay} data-testid="t-replay" title="Play the same recording again from 0 ms. Nothing is recomputed and nothing is random.">↺ Replay the two inputs</button>
        <button type="button" className="j-btn" onClick={togglePause} data-testid="t-pause" aria-pressed={s.paused}>{s.paused ? (atEnd ? '▶ Play again' : '▶ Resume') : '❚❚ Pause'} <kbd>Space</kbd></button>
        <button type="button" className="j-btn" onClick={stepOnce} data-testid="t-step" title="Advance the model by a quarter of a millisecond">Step ¼ ms <kbd>.</kbd></button>
        <label className="jd-speed" title="How slowly model time is shown. Real time would be 1000 ms per second.">Slow motion
          <select value={s.speed} onChange={(e) => useLab.setState({ speed: +e.target.value })} data-testid="t-speed">{SPEEDS.map((v) => <option key={v} value={v}>×{slowFactor(v)}</option>)}</select>
        </label>
        <label className="jd-check"><input type="checkbox" checked={s.loop} onChange={(e) => useLab.setState({ loop: e.target.checked })} data-testid="t-loop" /> repeat</label>
        <span className="jd-time" data-testid="t-time" data-paused={s.paused ? '1' : '0'}><b>{s.tMs.toFixed(1)}</b> / {WORKSHOP_MS} ms {s.paused ? '· paused' : `· ×${slowFactor(s.speed)}`}</span>
        <span className="jd-gap" />
        <button type="button" className="j-btn" disabled={!changed.length} onClick={s.toBaseline} data-testid="t-baseline" title="Put every cause back to the baseline’s. Can be undone.">Back to baseline</button>
        <button type="button" className="j-btn opt" disabled={!changed.length} onClick={s.keepBaseline} data-testid="t-keep" title="Compare later runs with this one instead">Set as baseline</button>
        <button type="button" className="j-btn" disabled={lab.history.length < 2} onClick={s.undo} data-testid="t-undo">↶ Undo</button>
        <button type="button" className="j-btn" onClick={s.reset} data-testid="t-reset" title="The circuit as you found it: causes, baseline, history and playback">Reset</button>
      </div>
      <div className={`jd-body${level !== 'observe' ? ' open' : ''}`}>
        <div className="jd-say" data-testid="say" aria-live="polite" data-fired={lab.result.firedMs != null ? '1' : '0'} data-run={lab.history.length} data-digest={lab.result.digest} data-changes={changed.map((c) => c.key).join(',')}>
          <p className="jd-main"><span className="jd-run">Run {lab.history.length}{changed.length ? '' : ' · baseline'}</span> {sentence}</p>
          {level !== 'observe' && <p className="jd-why" data-testid="say-why"><b>Why.</b> {whySentence(s.why)}</p>}
          {level !== 'observe' && changed.length > 0 && <p className="jd-why extra" data-testid="say-compare"><b>Compared.</b> {compareSentence(lab)}</p>}
          {level !== 'observe' && <p className="jd-why extra" data-testid="say-probe"><b>Outside.</b> {probeSentence(s.probe)}</p>}
        </div>
        {level !== 'observe' && (
          <div className="jd-traces">
            <div className="jd-pick" role="group" aria-label="Whose membrane potential to show">
              {lab.result.run.circuit.cells.map((x) => <button key={x.id} type="button" className={`j-chip${s.focus === x.id ? ' on' : ''}`} onClick={() => { useLab.setState({ focus: x.id }); labEng.dirty = true; }} data-testid={`focus-${x.id}`} title={`Show the membrane potential of ${x.label}`} aria-label={`Show the membrane potential of ${x.label}`}>{x.id}</button>)}
            </div>
            <CircuitTrace />
          </div>
        )}
      </div>
    </>
  );
}

function ArrayDock({ onPilot }: { onPilot: () => void }) {
  const st = useTask(), level = useJourney((j) => j.level), ctx = useWorld((w) => w.ctl.context), say = useWorld((w) => w.say);
  const i = st.info, cal = i?.calibration, ev = i?.evaluation, snap = st.snap, busy = st.status !== 'ready', lost = !!i && i.cond.lost.length > 0;
  const changed = !!cal && !!i && condKey(cal.cond) !== condKey(i.cond), faulted = !!i && condKey(i.cond) !== '7||0';
  let line: ReactNode;
  if (st.status === 'error') line = `The task stopped: ${st.note}`;
  else if (!cal) line = st.status === 'calibrating' ? `Calibrating: ${st.progress?.what ?? ''}. Scripted reaches are simulated; your keys are not used.` : 'No decoder is fitted yet, so the cursor cannot move.';
  else if (st.status === 'calibrating') line = `Recalibrating under the present conditions: ${st.progress?.what ?? ''}.`;
  else {
    const now = ev?.scores[i!.decoderId]?.r2, was = cal.scores[i!.decoderId]?.r2;
    const best = ev ? PILOT_DECODERS.slice().sort((a, b) => (ev.scores[b]?.r2 ?? -9) - (ev.scores[a]?.r2 ?? -9))[0] : null;
    line = ctx === 'pilot' ? <>You have the controls: keys → intended velocity → 24 model units → 8 contacts → <b>{DECODER_NAME[i!.decoderId]}</b> → cursor.</> : <>Take the controls to steer. {DECODER_NAME[i!.decoderId]} is fitted (R² {r2(was)} on reaches it never saw).</>;
    if (changed) line = <>{line} Conditions changed since calibration: {DECODER_NAME[i!.decoderId]} now scores {r2(now)}{best && best !== i!.decoderId && (ev!.scores[best]?.r2 ?? -9) > (now ?? -9) + 0.1 ? <>; {DECODER_NAME[best]} scores {r2(ev!.scores[best]?.r2)}</> : null}.</>;
  }
  return (
    <>
      <div className="jd-row" role="group" aria-label="The decoder control task" data-testid="transport">
        <button type="button" className={`j-btn primary${ctx === 'pilot' ? ' on' : ''}`} disabled={busy || !cal} onClick={onPilot} data-testid="t-pilot" title="Your movement keys become a synthetic intended velocity. The observer stays where it is.">{ctx === 'pilot' ? 'Release the controls' : '▶ Take the controls'} <kbd>P</kbd></button>
        <button type="button" className="j-btn" onClick={() => setTaskPaused(!st.paused)} data-testid="t-pause" aria-pressed={st.paused}>{st.paused ? '▶ Resume' : '❚❚ Pause'} <kbd>Space</kbd></button>
        <button type="button" className="j-btn" onClick={taskStep} data-testid="t-step" title="Advance the task by one 50 ms bin">Step 50 ms <kbd>.</kbd></button>
        <span className="jd-time" data-testid="t-time" data-paused={st.paused ? '1' : '0'}>bin <b>{snap?.bin ?? i?.bin ?? 0}</b> · {(((snap?.bin ?? 0) * 50) / 1000).toFixed(1)} s · {st.paused ? 'paused' : 'real time'}</span>
        <span className="jd-gap" />
        {lost
          ? <button type="button" className="j-btn" disabled={busy} onClick={() => void clearFaults().then(() => say('Contacts restored. The decoders are still the ones from the last calibration.'))} data-testid="t-restore">Restore the contacts</button>
          : <button type="button" className="j-btn warn" disabled={busy || !cal} onClick={() => void applyFault('lost').then(() => say(PILOT_FAULTS.lost.what))} data-testid="t-fault-lost" title={PILOT_FAULTS.lost.what}>Lose 3 contacts</button>}
        {st.status === 'calibrating'
          ? <button type="button" className="j-btn warn" onClick={cancelCalibration} data-testid="t-cancel">Stop calibrating</button>
          : <button type="button" className={`j-btn${changed ? ' primary' : ''}`} disabled={busy} onClick={() => void calibrate(say)} data-testid="t-calibrate" title="Re-estimates the detection thresholds and refits every decoder on new scripted reaches (simulated; your keys are not used), then scores them on other reaches.">Recalibrate</button>}
        <button type="button" className="j-btn" disabled={busy} onClick={() => void verifyReplay().then((r) => r && say(r.matches ? `Replayed all ${r.bins} bins from the command log: the cursor path is identical.` : 'Replayed from the log, but the path differs — this should not happen.'))} data-testid="t-verify" title="Run the whole session again from its log of commands and key states, and compare the cursor path">Replay &amp; verify</button>
        <button type="button" className="j-btn" onClick={() => void resetTask()} data-testid="t-reset" title="A new session from the same seed">Reset</button>
      </div>
      <div className="jd-body">
        <div className="jd-say" data-testid="say" aria-live="polite" data-status={st.status} data-context={ctx} data-decoder={i?.decoderId ?? ''} data-cond={i ? condKey(i.cond) : ''} data-calibration={cal?.id ?? 0} data-bin={snap?.bin ?? 0} data-hits={snap?.hits ?? i?.hits ?? 0}>
          <p className="jd-main"><span className="jd-run">Decoder task</span> {line}</p>
          {level !== 'observe' && (
            <div className="jd-chainrow">
              <ol className="jd-chain" aria-label="The signal chain of this task" data-testid="chain">
                <li>24 model units</li><li>8 contacts</li><li className="bypassed" title="Waveform, amplifier, ADC, band-pass, reference and sample-by-sample detector are replaced by a statistical stand-in here. The full chain runs in Studio › Experiment.">front end · ADC · filter · detector <em>approximated</em></li><li>counts per 50 ms</li><li>fitted decoder</li><li>cursor velocity</li>
              </ol>
              <span className="jd-fine">Break it another way:
                <button type="button" className="j-link" disabled={busy || !cal} onClick={() => void applyFault('noise').then(() => say(PILOT_FAULTS.noise.what))} data-testid="t-fault-noise">noise</button>
                <button type="button" className="j-link" disabled={busy || !cal} onClick={() => void applyFault('drift').then(() => say(PILOT_FAULTS.drift.what))} data-testid="t-fault-drift">tuning drift</button>
                {faulted && <button type="button" className="j-link" disabled={busy} onClick={() => void clearFaults().then(() => say('Conditions are back to the reference.'))} data-testid="t-clear">undo all faults</button>}
              </span>
            </div>
          )}
        </div>
        {level !== 'observe' && <Scope />}
      </div>
    </>
  );
}

/** Which fitted decoder moves the cursor, with each one's score — shown beside the cursor it drives. */
export function DecoderPicker() {
  const st = useTask(), say = useWorld((w) => w.say);
  const i = st.info, cal = i?.calibration, ev = i?.evaluation, snap = st.snap, busy = st.status !== 'ready';
  return (
    <div className="jd-decoders" role="group" aria-label="Which fitted decoder moves the cursor" data-testid="decoders">
      {PILOT_DECODERS.map((d) => (
        <button key={d} type="button" className={`j-chip wide${i?.decoderId === d ? ' on' : ''}`} disabled={busy || !cal} onClick={() => void setDecoder(d as PilotDecoderId).then(() => say(`${DECODER_NAME[d]} now moves the cursor. It is the one fitted at the last calibration: nothing was refitted.`))} data-testid={`dec-${d}`} title="R² on held-out reaches when fitted → on fresh reaches under the present conditions, without refitting">
          {DECODER_NAME[d]} <em data-testid={`r2-${d}`}>{r2(cal?.scores[d]?.r2)} → {r2(ev?.scores[d]?.r2)}</em>
        </button>
      ))}
      <p className="j-fine" data-testid="task-score">R² when fitted → now. Targets reached <b>{snap?.hits ?? 0}</b>{snap?.misses ? `, timed out ${snap.misses}` : ''}{st.last ? ` · last ${st.last.hit ? `${st.last.timeS.toFixed(1)} s` : 'timed out'}` : ''} · tracking R² {snap && Number.isFinite(snap.fit) ? snap.fit.toFixed(2).replace('-', '−') : '–'}</p>
    </div>
  );
}

export function Dock({ onPilot }: { onPilot: () => void }) {
  const station = useJourney((s) => s.station), level = useJourney((s) => s.level);
  return (
    <section className="j-dock" aria-label="Experiment" data-testid="dock" data-station={station} data-level={level}>
      {station === 'circuit' ? <CircuitDock /> : <ArrayDock onPilot={onPilot} />}
    </section>
  );
}

