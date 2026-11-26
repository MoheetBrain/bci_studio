// Toy C — Decoder pilot. Your keys are a SYNTHETIC intended velocity; a model population turns it into spike counts;
// a fitted decoder turns the counts into the cursor's velocity. You close the loop by watching the cursor.
//
// Two input contexts, never both at once:
//   Explore   the movement keys fly the observation rig; the intended velocity is zero;
//   Pilot     the movement keys ARE the intended velocity; the rig holds its working view.
// The cursor is moved by the decoder's output only (tests/world-pilot.test.ts shows it stands still without a decoder
// and ignores your keys when every contact is lost). The hollow ring is where your intent alone would have put it.
//
// This is a FEATURE-LEVEL SURROGATE of the Experiment scene's chain: waveforms, amplifier, ADC and the sample-by-sample
// detector are bypassed (see model/pilot.ts). The full batch chain is still in Classic studio › Experiment.
import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Line as ThreeLine, LineBasicMaterial, LineDashedMaterial, Mesh, MeshStandardMaterial } from 'three';
import { create } from 'zustand';
import { useShell } from '../../shell/shellStore';
import { controller } from '../controller';
import { lookAt, type V3 } from '../flight';
import { hash3 } from '../model/lif';
import { PILOT_BIN_MS, PILOT_CH, PILOT_DECODERS, PILOT_FAULTS, PILOT_TARGET_RADIUS, PILOT_UNITS, condKey, intentCode, type PilotDecoderId, type PilotFault, type PilotSnapshot } from '../model/pilot';
import { PilotHost, type PilotInfo, type PilotProgress } from '../pilotHost';
import { rt, type SceneSpec } from '../runtime';
import { selectionOf, useWorld } from '../worldStore';
import { WorldFrame, fitCanvas, type ModelCard } from '../WorldFrame';

const BIN_S = PILOT_BIN_MS / 1000, HIST = 160, TRAIL = 70;
const ARENA: V3 = [205, 6, 0], ARENA_UM = 76;        // the cursor's workspace (±1) drawn ±76 µm wide, facing the pilot view
const PILOT_VIEW = { pos: [44, 26, 452] as V3, target: [44, 4, 0] as V3 };
const NAME: Record<string, string> = { linear: 'Linear', kalman: 'Kalman filter', mlp8: 'MLP · 8 hidden' };
const r2 = (v: number | undefined) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(2).replace('-', '−'));

/** Where each model unit is drawn: eight contacts in two rows, three cells around each (nearest, middle, far). */
const SITES: V3[] = Array.from({ length: PILOT_CH }, (_, ch) => [-262 + (ch % 4) * 84, 0, ch < 4 ? 52 : -52]);
const CELL_POS: V3[] = PILOT_UNITS.map((u) => {
  const s = SITES[u.ch], az = (hash3(77, u.id, 1) / 4294967296) * 2 * Math.PI, el = ((hash3(77, u.id, 2) / 4294967296) - 0.5) * 1.1, d = [24, 44, 66][u.rank];
  return [s[0] + Math.cos(az) * Math.cos(el) * d, s[1] + Math.sin(el) * d - 6, s[2] + Math.sin(az) * Math.cos(el) * d];
});
const SPEC: SceneSpec = {
  key: 'pilot',
  cells: PILOT_UNITS.map((u, i) => ({ id: `u${u.id}`, label: `Unit ${u.id + 1} · contact ${u.ch + 1}`, pos: CELL_POS[i], radius: [8.6, 7.6, 7][u.rank], tint: (['near', 'mid', 'far'] as const)[u.rank], shape: 'pyramidal' as const })),
  links: [],
  // the rig starts where both the cells and the cursor's workspace are in view (the same pose Pilot uses)
  home: { pos: PILOT_VIEW.pos, lookAt: PILOT_VIEW.target },
  overview: { pivot: [-10, 0, 0], dist: 600, az: 0.18, el: 0.26 },
};

interface PS {
  status: 'starting' | 'calibrating' | 'ready' | 'error';
  progress: PilotProgress | null;
  info: PilotInfo | null;
  /** Refreshed a few times a second for the readouts (the scene reads every bin directly). */
  snap: PilotSnapshot | null;
  last: { hit: boolean; timeS: number; efficiency: number } | null;
  offThread: boolean;
  note: string | null;
}
export const usePilot = create<PS>(() => ({ status: 'starting', progress: null, info: null, snap: null, last: null, offThread: true, note: null }));

const eng = {
  host: null as PilotHost | null, acc: 0, inflight: false, paused: false, stepOnce: false,
  prev: null as PilotSnapshot | null, cur: null as PilotSnapshot | null, arrived: 0, shown: 0,
  hist: new Float32Array(HIST * 4), histN: 0, trailD: [] as number[], trailI: [] as number[],
  pad: new Float32Array(PILOT_CH), uRate: new Float32Array(PILOT_UNITS.length), canvas: null as HTMLCanvasElement | null, lastLine: 0,
};
const call = (req: Parameters<PilotHost['call']>[0], progress?: (p: PilotProgress) => void) => eng.host!.call(req, progress);
function clearTraces(): void { eng.prev = eng.cur = null; eng.histN = 0; eng.trailD.length = 0; eng.trailI.length = 0; eng.pad.fill(0); eng.uRate.fill(0); rt.flash.fill(0); rt.act.fill(0); usePilot.setState({ snap: null, last: null }); }

async function calibrate(): Promise<void> {
  if (usePilot.getState().status === 'calibrating') return;
  usePilot.setState({ status: 'calibrating', progress: { done: 0, total: 5, what: 'Starting' } });
  try {
    const r = await call({ op: 'calibrate' }, (progress) => usePilot.setState({ progress }));
    usePilot.setState({ status: 'ready', progress: null, info: r.info ?? usePilot.getState().info });
    useWorld.getState().say(r.cancelled ? 'Calibration stopped: the decoders are the ones you had before.' : 'Calibrated: every decoder was fitted on fresh scripted reaches and scored on others it never saw.');
  } catch (e) { usePilot.setState({ status: 'error', note: e instanceof Error ? e.message : String(e) }); }
}
async function command(req: Parameters<PilotHost['call']>[0], say?: string): Promise<void> {
  if (usePilot.getState().status !== 'ready') return;
  const r = await call(req);
  if (r.info) usePilot.setState({ info: r.info });
  if (say) useWorld.getState().say(say);
}
async function start(seed: number): Promise<void> {
  clearTraces();
  usePilot.setState({ status: 'starting', info: null, note: null });
  const r = await call({ op: 'new', seed });
  usePilot.setState({ info: r.info ?? null, status: 'ready' });
  await calibrate();
}
function setContext(c: 'explore' | 'pilot'): void {
  if (controller.context === c) return;
  controller.setContext(c);
  if (c === 'pilot') { controller.glideTo({ pos: PILOT_VIEW.pos, ...lookAt(PILOT_VIEW.pos, PILOT_VIEW.target) }); useWorld.getState().say('Pilot: the movement keys are now your intended velocity. P or Esc gives them back to the rig.'); }
  else controller.returnToFlight();
}

function onSnap(s: PilotSnapshot): void {
  eng.prev = eng.cur; eng.cur = s; eng.arrived = performance.now(); eng.shown = 0;
  const k = eng.histN % HIST;
  eng.hist[k * 4] = s.intent[0]; eng.hist[k * 4 + 1] = s.intent[1]; eng.hist[k * 4 + 2] = s.decoded[0]; eng.hist[k * 4 + 3] = s.decoded[1]; eng.histN++;
  if (s.ended) { eng.trailD.length = 0; eng.trailI.length = 0; }
  eng.trailD.push(s.cursor[0], s.cursor[1]); eng.trailI.push(s.ghost[0], s.ghost[1]);
  if (eng.trailD.length > TRAIL * 2) { eng.trailD.splice(0, 2); eng.trailI.splice(0, 2); }
  const per = new Float32Array(PILOT_UNITS.length);
  for (const sp of s.spikes) per[sp.unit]++;
  for (let i = 0; i < per.length; i++) eng.uRate[i] += 0.2 * (per[i] / BIN_S - eng.uRate[i]);
  if (s.ended || s.bin % 4 === 0) usePilot.setState(s.ended ? { snap: s, last: s.ended } : { snap: s });
}

function frame(wall: number): void {
  const st = usePilot.getState();
  if (st.status === 'ready' && eng.host && !eng.inflight) {
    if (!eng.paused) eng.acc = Math.min(0.1, eng.acc + wall);
    if (eng.acc >= BIN_S || eng.stepOnce) {
      eng.acc = eng.stepOnce ? 0 : eng.acc - BIN_S; eng.stepOnce = false; eng.inflight = true;
      const a = controller.pilotAxes();
      void call({ op: 'step', code: intentCode(a.x, a.y, a.slow) }).then((r) => { if (r.snap) onSnap(r.snap); }).catch(() => undefined).finally(() => { eng.inflight = false; });
    }
  }
  // the scene replays each 50 ms bin as it arrives: a spike flashes at its own time inside the bin
  const cur = eng.cur, fade = Math.exp(-wall / 0.09);
  for (let i = 0; i < PILOT_UNITS.length; i++) { rt.flash[i] *= fade; rt.act[i] = Math.min(1, eng.uRate[i] / 70) * 0.55; rt.dim[i] = 0; }
  for (let c = 0; c < PILOT_CH; c++) eng.pad[c] *= fade;
  if (cur) {
    const frac = Math.min(1, (performance.now() - eng.arrived) / PILOT_BIN_MS), tShow = cur.tS - BIN_S + frac * BIN_S;
    while (eng.shown < cur.spikes.length && cur.spikes[eng.shown].tS <= tShow) { const sp = cur.spikes[eng.shown++]; rt.flash[sp.unit] = 1; if (sp.counted) eng.pad[PILOT_UNITS[sp.unit].ch] = 1; }
  }
  rt.pulses.length = 0;
  draw();
  const now = performance.now();
  if (now - eng.lastLine > 250) {
    eng.lastLine = now;
    const i = st.info, line = `Pilot surrogate · seed ${i?.seed ?? '–'} · bin ${cur?.bin ?? 0} (t = ${((cur?.bin ?? 0) * BIN_S).toFixed(1)} s) · real time · ${st.offThread ? 'model in a worker' : 'model on the main thread'}`;
    const w = useWorld.getState();
    if (w.running !== line) useWorld.setState({ running: line });
  }
}

// ── instrument: intended vs decoded velocity, and what each contact counts ──────────────────────────────────────
function draw(): void {
  const cv = eng.canvas;
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv), cur = eng.cur, info = usePilot.getState().info;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
  const barsW = Math.min(250, w * 0.3), x0 = 74, x1 = w - barsW - 26, n = Math.min(HIST, eng.histN);
  (['x', 'y'] as const).forEach((axis, a) => {
    const top = 4 + a * ((h - 22) / 2), bot = top + (h - 22) / 2 - 6, mid = (top + bot) / 2, y = (v: number) => mid - Math.max(-1.3, Math.min(1.3, v)) * ((bot - top) / 2.6);
    ctx.fillStyle = '#B4C0D8'; ctx.textAlign = 'left'; ctx.fillText(`velocity ${axis}`, 4, mid - 7); ctx.fillStyle = '#8FA0BF'; ctx.fillText(axis === 'x' ? '→ right' : '↑ up', 4, mid + 7);
    ctx.strokeStyle = 'rgba(150,185,245,.16)'; ctx.beginPath(); ctx.moveTo(x0, y(0)); ctx.lineTo(x1, y(0)); ctx.stroke();
    for (const [off, col, dash, lw] of [[0, '#8FB7FF', [5, 4], 1.4], [2, '#FFD9A8', [], 1.8]] as Array<[number, string, number[], number]>) {
      ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < n; i++) { const k = (eng.histN - n + i) % HIST, px = x1 - ((n - 1 - i) / (HIST - 1)) * (x1 - x0), py = y(eng.hist[k * 4 + off + a]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineWidth = 1;
  });
  ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'center';
  for (let s = 0; s <= 8; s += 2) ctx.fillText(s === 0 ? 'now' : `−${s} s`, x1 - (s / 8) * (x1 - x0), h - 6);
  ctx.textAlign = 'left'; ctx.fillStyle = '#8FB7FF'; ctx.fillText('- - intended (your keys)', x0 + 4, 9); ctx.fillStyle = '#FFD9A8'; ctx.fillText('— decoded (moves the cursor)', x0 + 190, 9);
  // counts per contact
  const bx = w - barsW, bw = (barsW - 8) / PILOT_CH, base = h - 20, top = 20;
  ctx.fillStyle = '#B4C0D8'; ctx.textAlign = 'left'; ctx.fillText('smoothed rate per contact, spikes/s', bx, 9);
  for (let c = 0; c < PILOT_CH; c++) {
    const x = bx + c * bw, lost = !!info?.cond.lost.includes(c), r = cur ? cur.rates[c] : 0, hh = Math.min(1, r / 90) * (base - top);
    ctx.fillStyle = 'rgba(150,185,245,.10)'; ctx.fillRect(x + 2, top, bw - 4, base - top);
    if (lost) { ctx.strokeStyle = '#FF9CA8'; ctx.beginPath(); ctx.moveTo(x + 3, top + 2); ctx.lineTo(x + bw - 3, base - 2); ctx.moveTo(x + bw - 3, top + 2); ctx.lineTo(x + 3, base - 2); ctx.stroke(); }
    else { ctx.fillStyle = '#7FE7FF'; ctx.fillRect(x + 2, base - hh, bw - 4, hh); }
    ctx.fillStyle = lost ? '#FF9CA8' : '#8FA0BF'; ctx.textAlign = 'center'; ctx.fillText(lost ? '✕' : `${c + 1}`, x + bw / 2, h - 8);
  }
}

function Scope() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { eng.canvas = ref.current; return () => { eng.canvas = null; }; }, []);
  return <canvas ref={ref} className="wk-timeline" data-testid="pl-scope" role="img" aria-label="Intended and decoded velocity over the last eight seconds, horizontally and vertically, and the smoothed spike rate that each of the eight contacts reports." />;
}

/** The remote cursor's workspace, the contacts, and the trails. An abstract workbench drawn beside the cells. */
function Arena() {
  const info = usePilot((s) => s.info);
  const cursor = useRef<Mesh>(null), ghost = useRef<Mesh>(null), target = useRef<Mesh>(null), pads = useRef<Array<MeshStandardMaterial | null>>([]);
  const lines = useMemo(() => {
    const mk = (dashed: boolean, color: string) => { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL * 3), 3)); g.setDrawRange(0, 0); const l = new ThreeLine(g, dashed ? new LineDashedMaterial({ color, dashSize: 3, gapSize: 3, fog: false }) : new LineBasicMaterial({ color, fog: false })); l.frustumCulled = false; return l; };
    return { d: mk(false, '#FFD9A8'), i: mk(true, '#8FB7FF') };
  }, []);
  useEffect(() => () => { for (const l of [lines.d, lines.i]) { l.geometry.dispose(); (l.material as LineBasicMaterial).dispose(); } }, [lines]);
  const at = (x: number, y: number, z = 0): V3 => [ARENA[0] + x * ARENA_UM, ARENA[1] + y * ARENA_UM, ARENA[2] + z];
  useFrame(() => {
    const cur = eng.cur, prev = eng.prev ?? cur;
    if (!cur || !prev) return;
    const f = Math.min(1, (performance.now() - eng.arrived) / PILOT_BIN_MS), mix = (a: number, b: number) => a + (b - a) * f;
    // between two bins the cursor is drawn on the straight line joining them (it moves at constant velocity within a bin)
    cursor.current?.position.set(...at(mix(prev.cursor[0], cur.cursor[0]), mix(prev.cursor[1], cur.cursor[1]), 2));
    ghost.current?.position.set(...at(mix(prev.ghost[0], cur.ghost[0]), mix(prev.ghost[1], cur.ghost[1]), 1));
    target.current?.position.set(...at(cur.target[0], cur.target[1], 0.5));
    for (const [line, src] of [[lines.d, eng.trailD], [lines.i, eng.trailI]] as Array<[ThreeLine, number[]]>) {
      const p = line.geometry.getAttribute('position') as BufferAttribute, m = src.length / 2;
      for (let k = 0; k < m; k++) p.setXYZ(k, ...at(src[k * 2], src[k * 2 + 1], 1.2));
      p.needsUpdate = true; line.geometry.setDrawRange(0, m); line.computeLineDistances();
    }
    pads.current.forEach((mat, c) => { if (mat) mat.emissiveIntensity = 0.25 + 2.4 * eng.pad[c]; });
  });
  const R = 1.15 * ARENA_UM;
  return (
    <>
      <group position={ARENA}>
        <mesh><circleGeometry args={[R, 64]} /><meshBasicMaterial color="#1A1436" transparent opacity={0.78} fog={false} /></mesh>
        <mesh position={[0, 0, 0.2]}><ringGeometry args={[R - 0.9, R, 96]} /><meshBasicMaterial color="#8E86C8" fog={false} /></mesh>
        <mesh position={[0, 0, 0.3]}><planeGeometry args={[2 * R, 0.35]} /><meshBasicMaterial color="#4B4486" fog={false} /></mesh>
        <mesh position={[0, 0, 0.3]}><planeGeometry args={[0.35, 2 * R]} /><meshBasicMaterial color="#4B4486" fog={false} /></mesh>
        <Html position={[0, R + 13, 0]} center zIndexRange={[3, 0]}><span className="w-tag" data-testid="pl-arena-tag">Remote cursor · an abstract workspace, not anatomy</span></Html>
      </group>
      <mesh ref={target}><ringGeometry args={[PILOT_TARGET_RADIUS * ARENA_UM - 1.1, PILOT_TARGET_RADIUS * ARENA_UM, 48]} /><meshBasicMaterial color="#6BE3A3" fog={false} /></mesh>
      <mesh ref={ghost}><ringGeometry args={[4.2, 5.2, 32]} /><meshBasicMaterial color="#8FB7FF" fog={false} /></mesh>
      <mesh ref={cursor}><circleGeometry args={[3.8, 32]} /><meshBasicMaterial color="#FFD9A8" fog={false} /></mesh>
      <primitive object={lines.i} /><primitive object={lines.d} />
      {SITES.map((s, ch) => {
        const lost = !!info?.cond.lost.includes(ch);
        return (
          <group key={ch} position={s}>
            <mesh position={[0, 130, 0]}><boxGeometry args={[2.2, 260, 0.8]} /><meshStandardMaterial color={lost ? '#3A3550' : '#B9A27A'} metalness={0.4} roughness={0.5} /></mesh>
            <mesh><boxGeometry args={[4.6, 7, 1.6]} /><meshStandardMaterial ref={(m) => { pads.current[ch] = m; }} color={lost ? '#2A2638' : '#F0B48E'} metalness={0.6} roughness={0.3} emissive="#7FE7FF" emissiveIntensity={0.25} /></mesh>
            <Html position={[0, -13, 0]} center zIndexRange={[2, 0]}><span className={`w-tag${lost ? ' warm' : ''}`} data-testid={`pl-contact-${ch + 1}`} data-lost={lost ? '1' : '0'}>{lost ? `contact ${ch + 1} · lost ✕` : `${ch + 1}`}</span></Html>
          </group>
        );
      })}
    </>
  );
}

function Instrument() {
  const st = usePilot(), ctx = useWorld((w) => w.ctl.context);
  const i = st.info, cal = i?.calibration, ev = i?.evaluation, snap = st.snap, busy = st.status !== 'ready';
  return (
    <div className="wd-inst" data-testid="pilot" data-status={st.status} data-context={ctx} data-decoder={i?.decoderId ?? ''} data-cond={i ? condKey(i.cond) : ''} data-calibration={cal?.id ?? 0} data-bin={snap?.bin ?? 0} data-hits={snap?.hits ?? i?.hits ?? 0}>
      <div className="wd-causes">
        <div className="wd-head">Decoder · held-out R² fitted → now</div>
        <table className="wd-table" data-testid="pl-scores"><tbody>
          {PILOT_DECODERS.map((d) => (
            <tr key={d} className={i?.decoderId === d ? 'on' : ''}>
              <td><button type="button" className={`wd-btn${i?.decoderId === d ? ' on' : ''}`} disabled={busy || !cal} onClick={() => void command({ op: 'decoder', id: d as PilotDecoderId }, `${NAME[d]} now moves the cursor (fitted at the last calibration; nothing was refitted).`)} data-testid={`pl-dec-${d}`}>{NAME[d]}</button></td>
              <td data-testid={`pl-r2-cal-${d}`}>{r2(cal?.scores[d]?.r2)}</td><td>→</td><td data-testid={`pl-r2-now-${d}`}>{r2(ev?.scores[d]?.r2)}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
      <div className="wd-main"><Scope /></div>
      <div className="wd-side">
        <div className="wd-card">
          <div className="wd-head">Break the loop</div>
          <div className="wd-row wd-grid2">
            {(Object.keys(PILOT_FAULTS) as PilotFault[]).map((f) => <button key={f} type="button" className="wd-btn warn" disabled={busy || !cal} onClick={() => void command({ op: 'fault', fault: f }, PILOT_FAULTS[f].what)} title={PILOT_FAULTS[f].what} data-testid={`pl-fault-${f}`}>{PILOT_FAULTS[f].label}</button>)}
            <button type="button" className="wd-btn" disabled={busy || !cal} onClick={() => void command({ op: 'clear' }, 'Conditions are back to the reference. The decoders are still the ones from the last calibration.')} data-testid="pl-clear">Undo faults</button>
          </div>
          <p className="wd-fine" data-testid="pl-task">Targets reached {snap?.hits ?? 0}{snap?.misses ? `, timed out ${snap.misses}` : ''}. {st.last ? `Last: ${st.last.hit ? `${st.last.timeS.toFixed(1)} s, path ${Math.round(st.last.efficiency * 100)} % direct` : 'timed out after 12 s'}. ` : ''}Tracking R² {snap && Number.isFinite(snap.fit) ? snap.fit.toFixed(2).replace('-', '−') : '–'} (decoded vs intended velocity, last 5 s).</p>
        </div>
      </div>
    </div>
  );
}

function Line() {
  const st = usePilot(), ctx = useWorld((w) => w.ctl.context);
  const i = st.info, cal = i?.calibration, ev = i?.evaluation;
  let text: string;
  if (st.status === 'error') text = `The pilot session stopped: ${st.note}`;
  else if (st.status === 'starting' || !cal) text = st.status === 'calibrating' ? `Calibrating: ${st.progress?.what ?? ''}. Scripted reaches are simulated; your keys are not used.` : 'No decoder is fitted yet, so the cursor cannot move.';
  else if (st.status === 'calibrating') text = `Recalibrating under the present conditions: ${st.progress?.what ?? ''}.`;
  else {
    const now = ev?.scores[i!.decoderId]?.r2, was = cal.scores[i!.decoderId]?.r2, changed = condKey(cal.cond) !== condKey(i!.cond);
    const best = ev ? PILOT_DECODERS.slice().sort((a, b) => (ev.scores[b]?.r2 ?? -9) - (ev.scores[a]?.r2 ?? -9))[0] : null;
    text = ctx === 'pilot' ? `You are piloting: keys → intended velocity → 24 model units → 8 contacts → ${NAME[i!.decoderId]} → cursor.` : `Press P or “Pilot” to steer. ${NAME[i!.decoderId]} is fitted (held-out R² ${r2(was)}).`;
    if (changed) text += ` Conditions have changed since calibration: ${NAME[i!.decoderId]} now scores ${r2(now)} on fresh reaches${best && best !== i!.decoderId && (ev!.scores[best]?.r2 ?? -9) > (now ?? -9) + 0.1 ? `; ${NAME[best]} scores ${r2(ev!.scores[best]?.r2)}` : ''}. Switch decoder, or recalibrate.`;
  }
  return <span data-testid="pl-line">{text}</span>;
}

function Tools() {
  const st = usePilot(), go = useShell((s) => s.go);
  const i = st.info, cal = i?.calibration, changed = !!cal && !!i && condKey(cal.cond) !== condKey(i.cond);
  return (
    <div className="wd-tools">
      {st.status === 'calibrating'
        ? <><span className="wd-fine" data-testid="pl-progress">{st.progress?.what} ({st.progress?.done ?? 0}/{st.progress?.total ?? 5})</span><button type="button" className="wd-btn warn" onClick={() => void call({ op: 'cancel' })} data-testid="pl-cancel">Stop</button></>
        : <button type="button" className={`wd-btn${changed ? ' primary' : ''}`} disabled={st.status !== 'ready'} onClick={() => void calibrate()} data-testid="pl-calibrate" title="Re-estimates the detection thresholds and refits every decoder on new scripted reaches (simulated; your keys are not used), then scores them on other reaches.">Recalibrate</button>}
      <span className="wd-fine">Surrogate: waveform stages bypassed. <button type="button" className="w-link" onClick={() => go('experiment')} data-testid="pl-full-chain">Full chain →</button></span>
    </div>
  );
}

function ContextSwitch() {
  const ctx = useWorld((w) => w.ctl.context), ready = usePilot((s) => s.status === 'ready' && !!s.info?.calibration);
  return (
    <div className="w-ctx" role="group" aria-label="Who the movement keys belong to" data-testid="pl-context">
      <button type="button" className={`w-btn${ctx === 'explore' ? ' on' : ''}`} onClick={() => setContext('explore')} data-testid="pl-explore">Explore</button>
      <button type="button" className={`w-btn${ctx === 'pilot' ? ' on' : ''}`} disabled={!ready} onClick={() => setContext('pilot')} data-testid="pl-pilot">Pilot <kbd>P</kbd></button>
      <span className="w-fine">{ctx === 'pilot' ? 'Keys steer the intended velocity; Shift = gently.' : 'Keys fly the rig.'}</span>
    </div>
  );
}

const MODEL: ModelCard[] = [
  { what: 'Your keys', cls: 'hypothesis', text: 'A synthetic intended velocity: one of eight directions at full speed, or 45 % with Shift. It stands in for what a user of a real interface would be trying to do.', limits: 'Nothing here reads a brain, and a keyboard is not a model of intention. The loop is closed by your own eyes; no human learning or co-adaptation is modelled.' },
  { what: 'The 24 units and their spikes', cls: 'published-model', text: 'The Experiment scene’s population: firing rate = base + speed × (k + m·cos(direction − preferred direction)), Poisson spikes with a 3 ms dead time. A unit’s spike is counted at its contact with a probability set by its size there (120 µV × 30 µm ÷ distance), the detector’s noise and a threshold fixed at calibration.', limits: 'Feature-level surrogate: no waveforms, amplifier, ADC, band-pass, common reference or sample-by-sample detector; no overlapping spikes. Positions in the scene are compressed for drawing — the model uses its own distances.', source: { label: 'Georgopoulos et al. 1982 (direction tuning)', href: 'https://doi.org/10.1523/JNEUROSCI.02-11-01527.1982' } },
  { what: 'The decoders and their scores', cls: 'published-model', text: 'Ridge-regression linear decoder, a steady-state Kalman filter and an 8-unit tanh network, each fitted on 20 scripted reaches and scored (R²) on 10 others generated with a different seed. “Now” is a fresh set of 10 under the present conditions, without refitting. Normalisation is computed from the fitting data only.', limits: 'Scores are for this generator and this task. They say nothing about which decoder is better for a person. No confidence interval is shown because none has been validated.' },
  { what: 'The three faults', cls: 'hypothesis', text: 'More noise (7 → 17.5 µV rms with thresholds left alone), three contacts lost, and a fixed seeded change of every unit’s tuning.', limits: 'Stand-ins for things that happen to recordings. “Tuning drift” is not a model of any particular biological or mechanical cause.' },
  { what: 'The cursor, the ring and the disc', cls: 'illustrative', text: 'The filled dot is moved by the decoder’s output only. The hollow ring is where your intended velocity alone would have taken it since the last target. The disc is the cursor’s workspace, drawn beside the cells.', limits: 'An abstract workbench: it has no place in the tissue.' },
];

export default function PilotToy() {
  useEffect(() => {
    eng.host = new PilotHost(); eng.acc = 0; eng.inflight = false; eng.paused = false;
    usePilot.setState({ offThread: eng.host.offThread });
    rt.frame = frame;
    rt.onPick = (hit) => useWorld.getState().select(selectionOf(hit));
    useWorld.setState({ paused: false });
    void start(7);
    // Esc closes an open panel first (the frame does that); only then does it give the keys back to the rig
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && controller.context === 'pilot' && !useWorld.getState().panel && !controller.captureKey) { e.stopImmediatePropagation(); setContext('explore'); } };
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('keydown', esc, true); controller.setContext('explore'); rt.frame = null; rt.onPick = null; eng.host?.dispose(); eng.host = null; clearTraces(); };
  }, []);
  const pause = () => { eng.paused = !eng.paused; useWorld.setState({ paused: eng.paused }); };
  const step = () => { eng.paused = true; eng.stepOnce = true; useWorld.setState({ paused: true }); };
  useEffect(() => {
    controller.actions.pause = pause; controller.actions.step = step;
    controller.actions.context = () => { if (usePilot.getState().status === 'ready') setContext(controller.context === 'pilot' ? 'explore' : 'pilot'); };
    controller.actions.tool = () => void calibrate();
    return () => { delete controller.actions.pause; delete controller.actions.step; delete controller.actions.context; delete controller.actions.tool; };
  });
  const replay = async () => {
    if (usePilot.getState().status !== 'ready') return;
    const x = await call({ op: 'export' });
    if (!x.data) return;
    const r = await call({ op: 'import', data: x.data });
    if (r.info) usePilot.setState({ info: r.info });
    useWorld.getState().say(r.matches ? `Replayed all ${x.data.bins} bins from the command log: the cursor path is identical.` : 'Replayed from the log, but the path differs — this should not happen.');
  };
  // the export lives in the worker: it is fetched whenever the panel asks, and shown on the next refresh
  const exported = useRef('');
  const runsIo = {
    get: () => { void call({ op: 'export' }).then((x) => { exported.current = JSON.stringify(x.data, null, 1); }).catch(() => undefined); return exported.current || '{ "note": "Press “Refresh & copy” once more: the run is being fetched from the worker." }'; },
    put: (text: string) => { const data = JSON.parse(text); void call({ op: 'import', data }).then((r) => { if (r.info) usePilot.setState({ info: r.info }); clearTraces(); useWorld.getState().say(r.matches ? 'Imported run replayed: identical cursor path.' : 'Imported run replayed, but its fingerprint differs.'); }); return true; },
  };
  return (
    <WorldFrame
      spec={SPEC} model={MODEL} runs={runsIo} instrument={<Instrument />} line={<Line />} tools={<Tools />} scene={<Arena />} contextSwitch={<ContextSwitch />}
      tag={(id) => { const u = PILOT_UNITS[+id.slice(1)]; return u ? ['nearest to its contact', 'further away', 'too far to be counted'][u.rank] : ''; }}
      transport={{ onPause: pause, onStep: step, stepLabel: 'Step one 50 ms bin', onReplay: () => void replay(), replayLabel: 'Replay & verify', onCompare: () => void command({ op: 'evaluate' }, 'Scored every fitted decoder on a fresh set of reaches under the present conditions (no refitting).'), compareLabel: 'Compare decoders', onReset: () => void start(7) }}
      legend="Pink bodies are nearest their contact, violet further, dim violet too far to be counted. A contact pad lights when it counts a spike; a body lights whenever its unit fires. The dot is the decoded cursor; the hollow ring is your intent alone."
    />
  );
}

if (typeof window !== 'undefined') (window as unknown as { __pilot?: unknown }).__pilot = { store: usePilot, eng, setContext };
