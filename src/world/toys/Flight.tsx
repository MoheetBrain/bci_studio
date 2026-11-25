// Toy A — Instrument flight. Fly an observation rig through a live ten-cell field, put a virtual recording contact
// where you choose, silence a cell, compare what the contact hears, and work out which cell starts each wave.
//
// What depends on what (and what does not):
//   · the field keeps running whatever the camera does; flying and looking change NOTHING in the model;
//   · the contact's recording is computed from the contact's position — it changes only when you PLACE the contact
//     (an explicit, logged command at the probe tip), never because the camera moved;
//   · "Inspect V" reads the model's membrane variable directly: a virtual state inspection, not something a contact
//     could measure;
//   · the wiring is hidden until you have named the leading cell. The generator's own truth is one click away and
//     says that it is the generator's truth.
import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { create } from 'zustand';
import { controller } from '../controller';
import { lookDir } from '../flight';
import { FieldRun, type FieldExport } from '../model/fieldRun';
import { LIF_DT_MS, ModelClock } from '../model/lif';
import { OBS, ampAtUv, detect, distUm, type Vec3 } from '../model/observe';
import { rt, type SceneSpec } from '../runtime';
import { useWorld } from '../worldStore';
import { WorldFrame, fitCanvas, type ModelCard } from '../WorldFrame';

const WINDOW_STEPS = 1200;                 // 60 ms of recording on screen
const PROBE_UM = 34;                       // the probe tip rides this far in front of the rig
const SPEEDS = [10, 25, 50];
const f0 = (v: number) => Math.round(v).toString().replace('-', '−');

interface Capture { label: string; fromMs: number; traces: Array<Float32Array | null>; silenced: string[] }
interface FS {
  seed: number;
  /** Bumped whenever the run object is replaced or its command log changes. */
  rev: number;
  slot: 1 | 2;
  speed: number;
  truth: boolean;
  revealed: boolean;
  attempts: number;
  solved: number;
  guess: { cell: string; right: boolean } | null;
  capture: Capture | null;
  inspect: string | null;
  note: string | null;
}
export const useFlight = create<FS>(() => ({ seed: 1, rev: 0, slot: 1, speed: 25, truth: false, revealed: false, attempts: 0, solved: 0, guess: null, capture: null, inspect: null, note: null }));

const clock = new ModelClock(25, LIF_DT_MS);
const eng = { run: new FieldRun(1), canvas: null as HTMLCanvasElement | null, vRing: [] as Float32Array[], lastLine: 0, lastStep: -1, dirty: true, stats: [null, null] as Array<{ events: number; maxUv: number } | null> };
const bump = () => useFlight.setState({ rev: useFlight.getState().rev + 1 });
function newRun(seed: number): void {
  eng.run = new FieldRun(seed); eng.vRing = eng.run.circuit.cells.map(() => new Float32Array(WINDOW_STEPS)); eng.dirty = true;
  clock.seek(0); clock.paused = false;
  useFlight.setState({ seed: eng.run.seed, revealed: false, guess: null, capture: null, inspect: null, truth: false, note: null, attempts: 0 }); bump();
  useWorld.setState({ paused: false, selected: null });
}

/** Where the probe tip is right now: a fixed distance in front of the rig. */
export function probeTip(): Vec3 {
  const s = controller.s, d = lookDir(s.yaw, s.pitch);
  return [s.pos[0] + d[0] * PROBE_UM, s.pos[1] + d[1] * PROBE_UM, s.pos[2] + d[2] * PROBE_UM];
}

function specOf(run: FieldRun, revealed: boolean): SceneSpec {
  return {
    key: `flight-${run.seed}`,
    cells: run.circuit.cells.map((c) => ({ id: c.id, label: c.label, pos: c.pos, radius: 9, tint: 'exc' as const, shape: 'pyramidal' as const })),
    // the wiring is part of the answer: it is drawn only once the player has found the leading cell
    links: revealed ? run.circuit.conns.map((k) => ({ id: k.id, from: k.from, to: k.to, inhibitory: false })) : [],
    home: { pos: [6, 34, 372], lookAt: [10, -12, 0] },
    overview: { pivot: [10, -16, 0], dist: 520, az: 0.35, el: 0.32 },
  };
}

function frame(wall: number): void {
  const st = useFlight.getState(), run = eng.run, c = run.circuit;
  clock.msPerSecond = st.speed;
  const target = Math.min(run.step + 600, clock.tick(wall));
  if (clock.step() > target) clock.seek(target);
  while (run.step < target) { run.advanceTo(run.step + 1); const k = run.step % WINDOW_STEPS; for (let i = 0; i < c.cells.length; i++) eng.vRing[i][k] = run.state.v[i]; }
  const t = run.timeMs, decay = Math.max(0.5, 0.05 * st.speed);
  for (let i = 0; i < c.cells.length; i++) {
    const x = c.cells[i], sp = run.spikes[i], last = sp.length ? sp[sp.length - 1] : -1e9;
    rt.act[i] = Math.max(0, Math.min(1, (run.state.v[i] - x.el) / (run.state.vth[i] - x.el))) * 0.7;
    rt.flash[i] = t - last < 6 * decay ? Math.exp(-(t - last) / decay) : 0;
    rt.dim[i] = run.silenced(i) ? 1 : 0;
  }
  rt.linkOn.fill(1); rt.pulses.length = 0;
  if (run.step !== eng.lastStep || eng.dirty) { eng.lastStep = run.step; eng.dirty = false; draw(); }
  const now = performance.now();
  if (now - eng.lastLine > 200) {
    eng.lastLine = now;
    const line = `LIF field of 10 cells · seed ${run.seed} · run ${run.runId.split('-')[2]}${run.parentRunId ? ' (branched)' : ''} · t = ${t.toFixed(1)} ms${run.replaying ? ' · replaying the past' : ''} · ${st.speed} model-ms per second`;
    if (useWorld.getState().running !== line) useWorld.setState({ running: line });
  }
}

// ── the recording instrument ────────────────────────────────────────────────────────────────────────────────────
const PAD_L = 92, PAD_R = 12, UV_HI = 90, UV_LO = -260;
function draw(): void {
  const cv = eng.canvas;
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv), st = useFlight.getState(), run = eng.run, c = run.circuit;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
  const rows: Array<{ label: string; sub: string; col: string; kind: 'contact' | 'capture' | 'v'; slot?: 1 | 2; cell?: number }> = [
    { label: 'contact 1', sub: 'µV', col: '#7FE7FF', kind: 'contact', slot: 1 },
    { label: 'contact 2', sub: 'µV', col: '#F4B3FF', kind: 'contact', slot: 2 },
  ];
  if (st.capture) rows.push({ label: 'kept', sub: st.capture.label, col: '#8FB7FF', kind: 'capture' });
  const ic = st.inspect ? c.cells.findIndex((x) => x.id === st.inspect) : -1;
  if (ic >= 0) rows.push({ label: `V of ${c.cells[ic].label}`, sub: 'mV · model state', col: '#FFD9A8', kind: 'v', cell: ic });
  const rowH = (h - 16) / rows.length, x0 = PAD_L, x1 = w - PAD_R, toX = (i: number, n: number) => x0 + (i / Math.max(1, n - 1)) * (x1 - x0);
  // time axis: the window ends "now"
  ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'center';
  for (let ms = 0; ms <= 60; ms += 10) { const x = x1 - (ms / 60) * (x1 - x0); ctx.strokeStyle = 'rgba(150,185,245,.10)'; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h - 14); ctx.stroke(); ctx.fillText(ms === 0 ? 'now' : `−${ms} ms`, x, h - 6); }
  const thr = -OBS.threshK * OBS.noiseUv;
  rows.forEach((row, r) => {
    const top = r * rowH + 2, bot = (r + 1) * rowH - 3;
    ctx.textAlign = 'left'; ctx.fillStyle = row.col; ctx.fillText(row.label, 4, top + 8);
    ctx.fillStyle = '#8FA0BF'; ctx.fillText(row.sub.slice(0, 13), 4, top + 21);
    if (row.kind === 'v') {
      const cell = c.cells[row.cell!], lo = cell.el - 6, hi = run.state.vth[row.cell!] + 4, y = (mv: number) => top + ((hi - mv) / (hi - lo)) * (bot - top);
      ctx.strokeStyle = 'rgba(255,123,138,.7)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, y(run.state.vth[row.cell!])); ctx.lineTo(x1, y(run.state.vth[row.cell!])); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = row.col; ctx.lineWidth = 1.4; ctx.beginPath();
      const n = Math.min(WINDOW_STEPS, run.step);
      for (let i = 0; i < n; i += 2) { const k = (run.step - n + 1 + i + WINDOW_STEPS * 4) % WINDOW_STEPS, px = x1 - ((n - 1 - i) / (WINDOW_STEPS - 1)) * (x1 - x0), py = y(eng.vRing[row.cell!][k]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke(); ctx.lineWidth = 1;
      return;
    }
    const y = (uv: number) => top + ((UV_HI - Math.max(UV_LO, Math.min(UV_HI, uv))) / (UV_HI - UV_LO)) * (bot - top);
    ctx.strokeStyle = 'rgba(150,185,245,.16)'; ctx.beginPath(); ctx.moveTo(x0, y(0)); ctx.lineTo(x1, y(0)); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,123,138,.55)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x0, y(thr)); ctx.lineTo(x1, y(thr)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#8FA0BF'; ctx.textAlign = 'right'; ctx.fillText('0', x0 - 5, y(0)); ctx.fillText(`${UV_LO}`.replace('-', '−'), x0 - 5, bot - 4);
    let uv: Float32Array | null = null;
    if (row.kind === 'contact') { uv = run.placements(row.slot!).length ? run.trace(row.slot!, WINDOW_STEPS).uv : null; }
    else uv = st.capture!.traces[0] ?? st.capture!.traces[1];
    if (!uv) { ctx.fillStyle = '#6F7C97'; ctx.textAlign = 'center'; ctx.fillText(row.slot === st.slot ? 'not placed — fly close to a cell and press “Place contact”' : 'not placed', (x0 + x1) / 2, (top + bot) / 2); if (row.slot) eng.stats[row.slot - 1] = null; return; }
    const n = uv.length, off = WINDOW_STEPS - n;
    ctx.strokeStyle = row.col; ctx.lineWidth = 1.1; ctx.beginPath();
    for (let i = 0; i < n; i++) { const px = toX(i + off, WINDOW_STEPS), py = y(uv[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.stroke(); ctx.lineWidth = 1;
    // detected events: an inference from the trace (a triangle under each trough)
    const ev = detect(uv); let mx = 0;
    ctx.fillStyle = '#F2F6FF';
    for (const e of ev) { mx = Math.max(mx, e.ampUv); const px = toX(e.i + off, WINDOW_STEPS), py = Math.min(bot - 1, y(-e.ampUv) + 7); ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px - 3, py); ctx.lineTo(px + 3, py); ctx.fill(); }
    if (row.slot) eng.stats[row.slot - 1] = { events: ev.length, maxUv: mx };
  });
}

function Recorder() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { eng.canvas = ref.current; eng.dirty = true; return () => { eng.canvas = null; }; }, []);
  return <canvas ref={ref} className="wk-timeline" data-testid="fl-recorder" role="img" aria-label="Synthetic recordings of the two virtual contacts over the last 60 ms of model time, with the detection threshold and a mark under each detected event; a kept window and a cell's membrane potential when chosen." />;
}

// ── scientific actions (each one is a logged command) ───────────────────────────────────────────────────────────
function placeContact(): void {
  const st = useFlight.getState(), tip = probeTip(), run = eng.run;
  run.place(st.slot, tip);
  const near = run.circuit.cells.map((c) => ({ c, d: distUm(tip, c.pos) })).sort((a, b) => a.d - b.d)[0];
  useWorld.getState().say(`Contact ${st.slot} placed ${f0(near.d)} µm from the nearest cell body. Its recording now comes from there.`);
  eng.dirty = true; bump();
}
function toggleSilence(id: string): void {
  const run = eng.run, i = run.circuit.cells.findIndex((c) => c.id === id);
  if (i < 0) return;
  const off = !run.silenced(i);
  run.issue('cell-on', id, off ? 0 : 1);
  useWorld.getState().say(off ? `${run.circuit.cells[i].label} silenced from t = ${run.timeMs.toFixed(1)} ms: it cannot fire until you wake it.` : `${run.circuit.cells[i].label} can fire again.`);
  bump();
}
function keep(): void {
  const st = useFlight.getState(), run = eng.run;
  if (st.capture) { useFlight.setState({ capture: null }); eng.dirty = true; return; }
  const traces = ([1, 2] as const).map((s) => (run.placements(s).length ? run.trace(s, WINDOW_STEPS).uv : null));
  if (!traces[0] && !traces[1]) { useWorld.getState().say('Place a contact first: there is nothing to keep yet'); return; }
  const silenced = run.circuit.cells.filter((_, i) => run.silenced(i)).map((c) => c.label);
  useFlight.setState({ capture: { label: `t ${run.timeMs.toFixed(0)} ms`, fromMs: run.timeMs, traces, silenced } }); eng.dirty = true;
  useWorld.getState().say(`Kept the last 60 ms of contact ${traces[0] ? 1 : 2} (${silenced.length ? `${silenced.join(', ')} silenced` : 'nothing silenced'}). Change something and compare on the same axes.`);
}
function guess(id: string): void {
  const st = useFlight.getState(), run = eng.run, i = run.circuit.cells.findIndex((c) => c.id === id), right = i === run.truth.driver;
  useFlight.setState({ guess: { cell: id, right }, attempts: st.attempts + 1, revealed: st.revealed || right, solved: st.solved + (right && !st.revealed ? 1 : 0) });
  useWorld.getState().say(right ? `Yes — ${run.circuit.cells[i].label} starts every wave. Its connections are now drawn.` : `Not ${run.circuit.cells[i].label}: the rhythm does not start there.`);
}

function Instrument() {
  const st = useFlight();
  const sel = useWorld((w) => w.selected);
  const run = eng.run, c = run.circuit, cell = sel?.kind === 'cell' ? c.cells.find((x) => x.id === sel.id) ?? null : null, ci = cell ? c.cells.indexOf(cell) : -1;
  const placed = run.placements(st.slot), at = placed.length ? placed[placed.length - 1].pos : null;
  const silenced = c.cells.filter((_, i) => run.silenced(i));
  return (
    <div className="wd-inst" data-testid="flight" data-seed={st.seed} data-rev={st.rev} data-revealed={st.revealed ? '1' : '0'} data-run={run.runId}>
      <div className="wd-causes">
        <div className="wd-head">Your instrument</div>
        <div className="wd-row">
          <span className="wd-pick">Contact
            {([1, 2] as const).map((s) => <button key={s} type="button" className={`wd-chip${st.slot === s ? ' on' : ''}`} onClick={() => useFlight.setState({ slot: s })} data-testid={`fl-slot-${s}`} aria-label={`Use contact ${s}`}>{s}</button>)}
          </span>
          <button type="button" className="wd-btn primary" onClick={placeContact} data-testid="fl-place" title="Put the chosen contact at the probe tip (the small marker in front of you)">Place contact here</button>
        </div>
        <p className="wd-fine" data-testid="fl-contact-at">{at ? `Contact ${st.slot} stays at (${at.map(f0).join(', ')}) µm.` : 'Not placed. The marker ahead of you is the probe tip.'}</p>
        {cell ? (
          <div className="wd-row">
            <button type="button" className={`wd-btn${run.silenced(ci) ? ' on' : ''}`} onClick={() => toggleSilence(cell.id)} data-testid="fl-silence">{run.silenced(ci) ? `Wake ${cell.label}` : `Silence ${cell.label}`}</button>
            <button type="button" className={`wd-btn${st.inspect === cell.id ? ' on' : ''}`} onClick={() => { useFlight.setState({ inspect: st.inspect === cell.id ? null : cell.id }); eng.dirty = true; }} data-testid="fl-inspect" title="Virtual state inspection: reads the model’s membrane variable. No contact could measure this.">Inspect V</button>
          </div>
        ) : <p className="wd-fine">Click a cell to silence it or read its membrane potential.</p>}
        {silenced.length > 0 && <p className="wd-fine" data-testid="fl-silenced">Silenced (grey, hatched): {silenced.map((x) => x.label.replace('Cell ', '#')).join(', ')}</p>}
      </div>
      <div className="wd-main">
        <Recorder />
        {st.truth && (
          <div className="wd-sub" data-testid="fl-truth">
            <span className="w-class w-class-synthetic-observation"><i />GENERATOR TRUTH</span>
            <span>{at ? c.cells.map((x) => `${x.label.replace('Cell ', '#')} ${f0(distUm(at, x.pos))} µm → ${f0(ampAtUv(distUm(at, x.pos)))} µV`).join(' · ') : 'place the contact to see what each cell contributes there'}</span>
          </div>
        )}
      </div>
      <div className="wd-side">
        <div className="wd-card" data-testid="fl-quest" data-solved={st.revealed ? '1' : '0'}>
          <div className="wd-head">Which cell leads? {st.solved ? `· found ${st.solved}` : ''}</div>
          {st.revealed
            ? <p>{c.cells[run.truth.driver].label} fires on its own; six follow along the connections now drawn; three take no part.</p>
            : <p>One cell starts each wave. Listen, silence a suspect, see what stops — then select it.</p>}
          <div className="wd-row">
            {!st.revealed && <button type="button" className="wd-btn primary" disabled={!cell} onClick={() => cell && guess(cell.id)} data-testid="fl-guess">{cell ? `${cell.label} leads` : 'Select a cell first'}</button>}
            <button type="button" className="wd-btn" onClick={() => newRun(((st.seed * 7 + 3) % 9973) + 1)} data-testid="fl-new" title="A new field: the same ten places, a different leader and wiring">New field</button>
          </div>
          {st.guess && !st.guess.right && !st.revealed && <p className="wd-fine" data-testid="fl-wrong">Not {c.cells.find((x) => x.id === st.guess!.cell)?.label}. Tries so far: {st.attempts}.</p>}
        </div>
      </div>
    </div>
  );
}

function Line() {
  useFlight((s) => s.rev);
  const slot = useFlight((s) => s.slot), capture = useFlight((s) => s.capture), running = useWorld((w) => w.running);
  void running;                                  // re-read the live statistics a few times a second
  const s = eng.stats[slot - 1];
  if (!eng.run.placements(slot).length) return <span data-testid="fl-line">Nothing is being recorded yet. Fly up to a cell and place contact {slot}: the recording is computed from where the contact is, not from where you look.</span>;
  return <span data-testid="fl-line">Contact {slot}: {s ? `${s.events} detected event${s.events === 1 ? '' : 's'} in the last 60 ms, the largest ${f0(s.maxUv)} µV` : '…'}.{capture ? ` Kept for comparison: ${capture.label}${capture.silenced.length ? `, ${capture.silenced.join(', ')} silenced` : ''}.` : ''}</span>;
}
function Tools() {
  const speed = useFlight((s) => s.speed), truth = useFlight((s) => s.truth);
  return <div className="wd-tools"><button type="button" className={`wd-btn${truth ? ' on' : ''}`} onClick={() => useFlight.setState({ truth: !truth })} data-testid="fl-truth-toggle" title="What the generator itself knows about the active contact. Not a measurement.">Generator truth</button><label className="wd-speed">Playback <select value={speed} onChange={(e) => useFlight.setState({ speed: +e.target.value })} data-testid="fl-speed">{SPEEDS.map((v) => <option key={v} value={v}>{v} ms / s</option>)}</select></label></div>;
}

/** The probe tip in front of the rig, and the contacts where they were placed. */
function Probe() {
  useFlight((s) => s.rev);
  const tip = useRef<Group>(null), captured = useWorld((w) => w.ctl.captured), mode = useWorld((w) => w.ctl.mode), slot = useFlight((s) => s.slot);
  useFrame(() => { const g = tip.current; if (!g) return; const p = probeTip(); g.position.set(p[0], p[1], p[2]); g.rotation.y += 0.02; });
  const marks = ([1, 2] as const).flatMap((s) => { const p = eng.run.placements(s); return p.length ? [{ s, pos: p[p.length - 1].pos }] : []; });
  return (
    <>
      <group ref={tip} visible={mode === 'fly' && !captured}>
        <mesh><octahedronGeometry args={[1.1, 0]} /><meshBasicMaterial color={slot === 1 ? '#7FE7FF' : '#F4B3FF'} fog={false} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.3, 0.14, 6, 28]} /><meshBasicMaterial color="#E8EEF9" fog={false} transparent opacity={0.7} /></mesh>
      </group>
      {marks.map((m) => (
        <group key={m.s} position={m.pos}>
          <mesh><sphereGeometry args={[2.4, 16, 12]} /><meshStandardMaterial color="#F0B48E" metalness={0.6} roughness={0.3} emissive={m.s === 1 ? '#7FE7FF' : '#F4B3FF'} emissiveIntensity={0.9} /></mesh>
          <mesh position={[0, 60, 0]}><boxGeometry args={[0.9, 120, 0.35]} /><meshStandardMaterial color="#B9A27A" metalness={0.4} roughness={0.5} /></mesh>
          <Html position={[0, 7, 0]} center zIndexRange={[4, 0]}><span className="w-tag accent" data-testid={`fl-contact-tag-${m.s}`}>contact {m.s}</span></Html>
        </group>
      ))}
    </>
  );
}

const MODEL: ModelCard[] = [
  { what: 'The ten cells’ spikes', cls: 'published-model', text: 'The same leaky integrate-and-fire model as the Time workshop. One cell has a constant current and fires regularly; its spikes spread along strong excitatory connections with delays of 1–4 ms; three cells receive only random background kicks.', limits: 'No spike shapes, channels or dendrites. Which cell leads, and the wiring, are drawn from a seed — they describe no real circuit.', source: { label: 'Gerstner et al., Neuronal Dynamics §1.3', href: 'https://neuronaldynamics.epfl.ch/online/Ch1.S3.html' } },
  { what: 'The contact’s recording', cls: 'synthetic-observation', text: 'y(t) = Σ cells a·Σ spikes h(t − t_spike) + noise. h is one fixed waveform (the studio’s teaching template: the negative time-derivative of a Hodgkin–Huxley action potential) with its trough on the spike time; a = 120 µV × 30 µm ÷ distance from the contact to the cell body (never less than 15 µm); noise is white, 6 µV rms. Sampled at 20 kHz.', limits: 'Not a volume-conductor calculation and not a recording. No reference electrode, no tissue filtering, no dependence on cell shape. The 15 µm floor only avoids a division by zero.', source: { label: 'Why a real forward model needs more: Lindén et al. 2014 (LFPy)', href: 'https://doi.org/10.3389/fninf.2013.00041' } },
  { what: 'Triangles under the trace', cls: 'synthetic-observation', text: 'Detected events: downward crossings of −4.5 × the noise level, 1 ms apart at least.', limits: 'An inference. It can miss small spikes, merge overlapping ones and fire on noise. It does not say which cell fired.' },
  { what: '“Inspect V” and “Generator truth”', cls: 'published-model', text: 'Read straight from the model: a cell’s membrane variable, or each cell’s distance and contribution at the contact.', limits: 'Virtual state inspection. No contact could measure either; they are there so that a guess can be checked.' },
  { what: 'Cell shapes, the vessel, the probe marker', cls: 'illustrative', text: 'Generated shapes and landmarks. Cell-body positions are the model’s own coordinates, and the recording uses those.', limits: 'Not reconstructions and not the cells of any atlas region.' },
];

export default function FlightToy() {
  const rev = useFlight((s) => s.rev), revealed = useFlight((s) => s.revealed), capture = useFlight((s) => s.capture);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spec = useMemo(() => specOf(eng.run, revealed), [revealed, eng.run]);
  void rev;
  useEffect(() => {
    if (!eng.vRing.length) eng.vRing = eng.run.circuit.cells.map(() => new Float32Array(WINDOW_STEPS));
    rt.frame = frame;
    rt.onPick = (hit) => useWorld.getState().select(hit && hit.kind === 'cell' ? { kind: 'cell', id: hit.id } : null);
    clock.seek(eng.run.step); clock.paused = false; useWorld.setState({ paused: false });
    return () => { rt.frame = null; rt.onPick = null; };
  }, []);
  const pause = () => { clock.paused = !clock.paused; useWorld.setState({ paused: clock.paused }); };
  // one millisecond of model time: the clock is moved on by 20 steps and stays paused; the frame loop does the stepping
  const step = () => { clock.paused = true; clock.seek(eng.run.step + 20); useWorld.setState({ paused: true }); eng.dirty = true; };
  const replay = () => { const to = eng.run.rewind(200); clock.seek(to); clock.paused = false; useWorld.setState({ paused: false }); eng.dirty = true; useWorld.getState().say('Back 200 ms: the same spikes will happen at the same times. Change something now and a new run branches off here.'); };
  useEffect(() => { controller.actions.pause = pause; controller.actions.step = step; controller.actions.tool = placeContact; return () => { delete controller.actions.pause; delete controller.actions.step; delete controller.actions.tool; }; });
  const runs = {
    get: () => JSON.stringify(eng.run.export(), null, 1),
    put: (text: string) => { const { run, matches } = FieldRun.import(JSON.parse(text) as FieldExport); eng.run = run; eng.vRing = run.circuit.cells.map(() => new Float32Array(WINDOW_STEPS)); clock.seek(run.step); eng.dirty = true; useFlight.setState({ seed: run.seed, revealed: false, guess: null, capture: null, inspect: null }); bump(); return matches; },
  };
  return (
    <WorldFrame
      spec={spec} model={MODEL} runs={runs} instrument={<Instrument />} line={<Line />} tools={<Tools />} scene={<Probe />}
      tag={(id) => { const i = eng.run.circuit.cells.findIndex((c) => c.id === id); return i >= 0 && eng.run.silenced(i) ? 'silenced' : ''; }}
      transport={{ onPause: pause, onStep: step, stepLabel: 'Step 1 ms', onReplay: replay, replayLabel: 'Replay 200 ms', onCompare: keep, comparing: !!capture, compareLabel: capture ? 'Compare: clear' : 'Compare: keep window', onReset: () => newRun(useFlight.getState().seed) }}
      legend="All ten cells look alike on purpose. A silenced cell is grey with diagonal hatching. The small spinning marker in front of you is the probe tip; a placed contact stays where you put it."
    />
  );
}

if (typeof window !== 'undefined') (window as unknown as { __flight?: unknown }).__flight = { store: useFlight, clock, eng, probeTip };
