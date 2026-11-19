// The eight stages of the signal's journey. Each view reads the same simulated session at the same timeline
// position, so the 3D scene, the plots, the numbers and the decoder output always describe one state.
import { useMemo } from 'react';
import { Wave, type Marker } from '../journey/Wave';
import type { Timeline } from '../kit/kit';
import { useExperiment, type Mode } from './experimentStore';
import { afeMagnitude, aliasFrequency, codeBits } from './model/dsp';
import { LIVE_DECODERS } from './model/decoders';
import {
  BIN_MS, CAL_S, DSP_BAND_HZ, FEEDBACK_DELAY_BINS, GRID_HZ, HP_CHOICES_HZ, MOTOR_LIMITS, N_CH, NEAR0_UM, REF_AMP_UV, REF_DIST_UM, SAMPLE_RATES_HZ, SWING_V,
  UNITS_PER_CH, VMAX, unitRate, type MotorRun,
} from './model/motor';
import type { MotorSession, VisualSession } from './model/session';
import { spikeTemplate } from './model/template';
import { BROADBAND_GAIN, CONTACT_GAIN, DRIVE, LATENCY_S, OBJECTS, VIS_BAND_HZ, VIS_HP_CHOICES_HZ, VIS_SAMPLE_RATES_HZ, VISUAL_LIMITS, type VisualRun } from './model/visual';
import { CursorPad, Strip, type StripRow } from './plots';
import { Prov } from './Prov';

export interface StageProps { s: MotorSession | VisualSession; t: number; tl: Timeline; mode: Mode }
const C = { cyan: '#7FE7FF', warm: '#FFD08A', pink: '#F29BC0', violet: '#D7B8FF', green: '#8CFFB5', red: '#FF8A8A', grey: '#A9B6CF' };
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(f % 1000 ? 1 : 0)} kHz` : `${f} Hz`);

// ── controls ────────────────────────────────────────────────────────────────────────────────────────────────────
export function Slider(p: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; testId: string; log?: boolean; digits?: number; hint?: string }) {
  const toPos = (v: number) => (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
  const fromPos = (x: number) => (p.log ? p.min * Math.pow(p.max / p.min, x) : p.min + x * (p.max - p.min));
  const round = (v: number) => Math.round(v / p.step) * p.step;
  return (
    <label className="exp-knob" title={p.hint}>
      <span className="exp-knob-label">{p.label}</span>
      <input type="range" min={0} max={1} step={0.001} value={toPos(p.value)} onChange={(e) => p.onChange(+round(fromPos(+e.target.value)).toFixed(6))} data-testid={p.testId} aria-valuetext={`${p.value} ${p.unit}`} />
      <output className="mono" data-testid={`${p.testId}-out`}>{p.value.toFixed(p.digits ?? 0)} {p.unit}</output>
    </label>
  );
}
export function Choice<T extends number | string>(p: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="exp-choice">
      <span className="exp-knob-label">{p.label}</span>
      <div className="seg" role="group" aria-label={p.label} data-testid={p.testId}>
        {p.options.map((o) => <button key={String(o.value)} type="button" className={`seg-btn${o.value === p.value ? ' on' : ''}`} aria-pressed={o.value === p.value} onClick={() => p.onChange(o.value)} data-testid={`${p.testId}-${o.value}`}>{o.label}</button>)}
      </div>
    </div>
  );
}
export function Toggle(p: { label: string; value: boolean; onChange: (v: boolean) => void; testId: string; hint?: string }) {
  return <label className="exp-toggle" title={p.hint}><input type="checkbox" checked={p.value} onChange={(e) => p.onChange(e.target.checked)} data-testid={p.testId} /><span>{p.label}</span></label>;
}
export function Readouts({ items, testId }: { items: Array<[string, React.ReactNode]>; testId?: string }) {
  return <dl className="exp-readouts" data-testid={testId}>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}</dl>;
}

// ── derived traces for the recorded contact (motor) ─────────────────────────────────────────────────────────────
export function useMotorDerived(run: MotorRun | null) {
  return useMemo(() => {
    if (!run || !run.focus) return null;
    const f = run.focus, tm = spikeTemplate(f.gridHz), n = f.elecUv.length;
    const units = run.units.filter((u) => u.ch === f.ch);
    const vm = new Float32Array(n).fill(-65), near = new Float32Array(n);
    units.forEach((u) => {
      for (const ts of run.spikeT[u.id]) {
        const o = Math.round(ts * f.gridHz);
        if (u.rank === 0) { for (let i = 0; i < tm.vmMv.length && o + i < n; i++) vm[o + i] += tm.vmMv[i]; for (let i = 0; i < tm.ec.length && o + i < n; i++) near[o + i] += run.ampUv[u.id] * tm.ec[i]; }
      }
    });
    return { units, vm, near, peakS: tm.ecPeak / f.gridHz };
  }, [run]);
}

const binOf = (run: { binMs: number; nBins: number }, t: number) => Math.max(0, Math.min(run.nBins - 1, Math.floor((t * 1000) / run.binMs + 1e-6)));

/** Step to the previous / next spike or event on the recorded contact. */
function Jump({ times, t, tl, label }: { times: ArrayLike<number>; t: number; tl: Timeline; label: string }) {
  const next = () => { for (let i = 0; i < times.length; i++) if (times[i] > t + 1e-4) { tl.setPlaying(false); tl.seek(times[i]); return; } };
  const prev = () => { for (let i = times.length - 1; i >= 0; i--) if (times[i] < t - 1e-4) { tl.setPlaying(false); tl.seek(times[i]); return; } };
  return (
    <div className="exp-jump" role="group" aria-label={`Step through ${label}`}>
      <button type="button" className="btn" onClick={prev} data-testid="jump-prev">◀ previous {label}</button>
      <button type="button" className="btn" onClick={next} data-testid="jump-next">next {label} ▶</button>
    </div>
  );
}

const stimBands = (r: VisualRun) => r.stim.map((s) => ({ t0: s.onS * 1000, t1: s.offS * 1000, color: s.kind === 'object' ? 'rgba(140,255,181,.10)' : 'rgba(255,208,138,.10)' }));
const stimBandsS = (r: VisualRun) => r.stim.map((s) => ({ t0: s.onS, t1: s.offS, color: s.kind === 'object' ? 'rgba(140,255,181,.12)' : 'rgba(255,208,138,.12)', label: s.kind === 'object' ? OBJECTS[s.identity] : 'scrambled' }));

// ── 1 · tissue ──────────────────────────────────────────────────────────────────────────────────────────────────
export function TissueBelow({ s, t, tl }: StageProps) {
  if (s.kind === 'motor') {
    const r = s.run, fc = r.params.focusCh;
    const rows: StripRow[] = r.units.map((u) => ({ label: u.rank === 0 ? `contact ${u.ch + 1}` : '', color: u.rank === 0 ? C.pink : u.rank === 1 ? '#9C8FE0' : '#6F6AA8', events: r.spikeT[u.id], emphasis: u.ch === fc && u.rank === 0 }));
    return <Strip rows={rows} rowH={9} t0={Math.max(0, t - 1)} t1={Math.max(0, t - 1) + 2} playhead={t} onSeek={tl.seek} testId="raster" title="Every model neuron’s spikes — 2 s around the playhead" />;
  }
  const r = s.run;
  const rows: StripRow[] = Array.from({ length: r.nCh }, (_, c) => ({ label: `contact ${c + 1}`, color: C.warm, values: { data: r.drive, stride: r.nCh, offset: c, binS: r.binMs / 1000, min: 0, max: 1.3 }, emphasis: c === r.params.focusCh }));
  return <Strip rows={rows} rowH={13} t0={0} t1={r.durationS} playhead={t} onSeek={tl.seek} bands={stimBandsS(r)} testId="drive-strip" title="How hard the cortex under each contact is driven (model), with the pictures shown" />;
}

// ── 2 · neuron ──────────────────────────────────────────────────────────────────────────────────────────────────
export function NeuronView({ s, t, tl }: StageProps) {
  const d = useMotorDerived(s.kind === 'motor' ? s.run : null);
  if (s.kind === 'motor' && d && s.run.focus) {
    const r = s.run, f = r.focus!, u = d.units[0], k = binOf(r, t), w = 30;
    const t0 = Math.max(0, t * 1000 - w / 2);
    const vx = r.intent[k * 2], vy = r.intent[k * 2 + 1], rate = unitRate(u, vx, vy);
    return (
      <>
        <Wave title="Membrane potential of the nearest neuron" unit="mV" data={d.vm} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.pink} height={120} yRange={[-85, 50]} hlines={[{ value: -65, color: 'rgba(169,182,207,.5)', label: 'rest', dashed: true }]} onSeek={(ms) => tl.seek(ms / 1000)} showTimeAxis testId="wave-vm" valueDigits={1} note="Hodgkin–Huxley action potential replayed at each simulated spike" />
        <Wave title="What that spike looks like from outside the cell, at the contact" unit="µV" data={d.near} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={96} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-near" valueDigits={1} note="∝ −dV/dt, scaled by 1 / distance" />
        <Jump times={r.spikeT[u.id]} t={t} tl={tl} label="spike" />
        <Tuning u={u} vx={vx} vy={vy} rate={rate} />
      </>
    );
  }
  if (s.kind === 'visual') {
    const r = s.run, fc = r.params.focusCh, k = binOf(r, t);
    return (
      <>
        <Strip rows={[{ label: 'drive', color: C.warm, line: true, values: { data: r.drive, stride: r.nCh, offset: fc, binS: r.binMs / 1000, min: 0, max: 1.4 } }]} rowH={70} t0={0} t1={r.durationS} playhead={t} onSeek={tl.seek} bands={stimBandsS(r)} testId="drive-line" title={`Population drive under contact ${fc + 1}: about ${(LATENCY_S * 1000).toFixed(0)} ms after a picture appears, the local firing rate rises`} />
        <Readouts testId="neuron-readouts" items={[
          ['Drive now', fmt(r.drive[k * r.nCh + fc], 2)],
          ['This contact’s gain', fmt(CONTACT_GAIN[fc], 2)],
          ['Intact object', `× ${DRIVE.object}`], ['Scrambled picture', `× ${DRIVE.scrambled}`],
          ['Background amplitude', `× ${(1 + BROADBAND_GAIN * r.drive[k * r.nCh + fc]).toFixed(2)}`],
        ]} />
        <p className="exp-note">There are no single neurons to follow here. A contact on the surface sums the currents of very many cells; what changes with the picture is the overall level of that activity — a broadband shift — not the spikes of one cell.</p>
      </>
    );
  }
  return null;
}

function Tuning({ u, vx, vy, rate }: { u: MotorRun['units'][number]; vx: number; vy: number; rate: number }) {
  const sp = Math.hypot(vx, vy), th = Math.atan2(vy, vx);
  const pts = Array.from({ length: 73 }, (_, i) => { const a = (i / 72) * 2 * Math.PI, r = unitRate(u, Math.cos(a), Math.sin(a)); return `${(60 + (r / 70) * 52 * Math.cos(a)).toFixed(1)},${(60 - (r / 70) * 52 * Math.sin(a)).toFixed(1)}`; }).join(' ');
  return (
    <div className="exp-tuning" data-testid="tuning">
      <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label="Direction tuning of the nearest neuron: firing rate against movement direction">
        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(150,185,245,.18)" /><circle cx="60" cy="60" r="26" fill="none" stroke="rgba(150,185,245,.12)" />
        <polygon points={pts} fill="rgba(242,155,192,.14)" stroke={C.pink} strokeWidth="1.4" />
        <line x1="60" y1="60" x2={60 + 52 * Math.cos(u.prefRad)} y2={60 - 52 * Math.sin(u.prefRad)} stroke={C.pink} strokeDasharray="3 3" />
        {sp > 0.03 && <line x1="60" y1="60" x2={60 + (rate / 70) * 52 * Math.cos(th)} y2={60 - (rate / 70) * 52 * Math.sin(th)} stroke={C.warm} strokeWidth="2.2" />}
      </svg>
      <div>
        <div className="exp-sub">This neuron’s tuning <Prov kind="simulated" /></div>
        <p>It fires fastest when the intended movement points along its preferred direction (dashed) and slowest for the opposite one. The yellow line is the intended movement <em>right now</em>.</p>
        <Readouts items={[['Intended speed', fmt(sp, 2)], ['Firing rate now', `${fmt(rate, 0)} /s`], ['Rest rate', `${fmt(u.baseHz, 0)} /s`], ['Tuning depth', `${fmt(u.modHz, 0)} /s`]]} />
      </div>
    </div>
  );
}

// ── 3 · electrode ───────────────────────────────────────────────────────────────────────────────────────────────
export function ElectrodeView({ s, t, tl }: StageProps) {
  const set = useExperiment((x) => x.setMotor), setV = useExperiment((x) => x.setVisual);
  const d = useMotorDerived(s.kind === 'motor' ? s.run : null);
  const f = s.run.focus!;
  if (s.kind === 'motor' && d) {
    const r = s.run, p = r.params, w = 30, t0 = Math.max(0, t * 1000 - w / 2), u = d.units[0];
    const amp = r.ampUv[u.id];
    return (
      <>
        <Wave title={`Voltage at contact ${f.ch + 1}: every nearby neuron, the slow field potential, noise${p.artefact ? ' and artefacts' : ''}`} unit="µV" data={f.elecUv} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={130} onSeek={(ms) => tl.seek(ms / 1000)} showTimeAxis testId="wave-elec" valueDigits={1} />
        <Wave title="The nearest neuron’s share of it" unit="µV" data={d.near} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.pink} height={84} yRange={[-Math.max(40, amp) * 1.15, Math.max(40, amp) * 0.5]} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-share" valueDigits={1} />
        <Jump times={r.spikeT[u.id]} t={t} tl={tl} label="spike" />
        <div className="exp-controls" data-testid="electrode-controls">
          <Slider label="Electrode distance from the cells (nominal; all contacts move together)" value={p.nearUm} min={MOTOR_LIMITS.nearUm[0]} max={MOTOR_LIMITS.nearUm[1]} step={5} unit="µm" onChange={(v) => set({ nearUm: v })} testId="knob-distance" />
          <Slider label="Recording noise (0.3–7.5 kHz)" value={p.noiseUv} min={MOTOR_LIMITS.noiseUv[0]} max={MOTOR_LIMITS.noiseUv[1]} step={0.5} unit="µV rms" digits={1} onChange={(v) => set({ noiseUv: v })} testId="knob-noise" />
          <Toggle label="Common-mode artefacts (mains hum, brief transients on all contacts)" value={p.artefact} onChange={(v) => set({ artefact: v })} testId="toggle-artefact" />
        </div>
        <Readouts testId="electrode-readouts" items={[
          ['This contact’s nearest neuron', `${fmt(u.dist0Um + p.nearUm - NEAR0_UM, 0)} µm away`], ['Its spike at the contact', `${fmt(amp, 0)} µV`], ['Rule', `${REF_AMP_UV} µV × ${REF_DIST_UM} µm / ${fmt(u.dist0Um + p.nearUm - NEAR0_UM, 0)} µm`],
          ['Noise in the detector’s band', `${fmt(r.sigmaUv[f.ch], 1)} µV`], ['Spike ÷ noise', fmt(amp / Math.max(0.1, r.sigmaUv[f.ch]), 1)], ['Electrode offset (DC)', `${fmt(f.offsetMv, 1)} mV`],
        ]} />
      </>
    );
  }
  if (s.kind === 'visual') {
    const r = s.run, p = r.params, w = 600, t0 = Math.max(0, t * 1000 - w / 2);
    return (
      <>
        <Wave title={`Field potential at surface contact ${f.ch + 1}`} unit="µV" data={f.elecUv} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={150} onSeek={(ms) => tl.seek(ms / 1000)} bands={stimBands(r)} testId="wave-elec" valueDigits={1} note="shaded: a picture is on the screen" />
        <div className="exp-controls" data-testid="electrode-controls">
          <Slider label="Measurement noise (1–300 Hz)" value={p.noiseUv} min={VISUAL_LIMITS.noiseUv[0]} max={VISUAL_LIMITS.noiseUv[1]} step={0.5} unit="µV rms" digits={1} onChange={(v) => setV({ noiseUv: v })} testId="knob-noise" />
          <Toggle label="Mains hum (50 Hz) on all contacts" value={p.artefact} onChange={(v) => setV({ artefact: v })} testId="toggle-artefact" />
          <Choice label="Contact shown" value={p.focusCh} options={Array.from({ length: r.nCh }, (_, c) => ({ value: c, label: String(c + 1) }))} onChange={(v) => setV({ focusCh: v })} testId="focus-ch" />
        </div>
        <p className="exp-note">No distance control here: there is no simple law for how a surface potential falls with distance from a sheet of active cortex, and this model does not pretend to have one. A slow rhythm near 10 Hz and the evoked potential ride on top of the background.</p>
      </>
    );
  }
  return null;
}

// ── 4 · analogue front end ──────────────────────────────────────────────────────────────────────────────────────
export function FrontEndView({ s, t, tl }: StageProps) {
  const setM = useExperiment((x) => x.setMotor), setV = useExperiment((x) => x.setVisual);
  const f = s.run.focus!, p = s.run.params, motor = s.kind === 'motor';
  const set = (patch: { gain?: number; hpHz?: number; lpHz?: number }) => (motor ? setM(patch) : setV(patch));
  const w = motor ? 60 : 800, t0 = Math.max(0, t * 1000 - w / 2), probe = motor ? 1000 : 100;
  const lim = motor ? MOTOR_LIMITS : VISUAL_LIMITS, hps = motor ? HP_CHOICES_HZ : VIS_HP_CHOICES_HZ;
  const clipped = f.clippedFrac > 0.001;
  return (
    <>
      <svg className="exp-chain" viewBox="0 0 640 74" role="img" aria-label="Front end: electrode with DC offset, high-pass, low-pass, gain, to the converter">
        {[['Contact', `${fmt(f.offsetMv, 0)} mV offset`], ['High-pass', p.hpHz > 0 ? `${p.hpHz} Hz` : 'none (DC)'], ['Low-pass', hz(p.lpHz)], ['Gain', `× ${p.gain}`], ['To ADC', `±${SWING_V} V swing`]].map(([a, b], i) => (
          <g key={a} transform={`translate(${8 + i * 128},10)`}>
            <rect width="104" height="52" rx="9" fill="rgba(127,231,255,.07)" stroke={i === 4 && clipped ? C.red : 'rgba(127,231,255,.4)'} />
            <text x="52" y="22" textAnchor="middle" fill="#EAFBFF" fontSize="12.5" fontWeight="650">{a}</text>
            <text x="52" y="40" textAnchor="middle" fill="#A9B6CF" fontSize="11" fontFamily="ui-monospace, Menlo, monospace">{b}</text>
            {i < 4 && <path d="M106 26h18m-5-4 5 4-5 4" stroke={C.cyan} fill="none" strokeWidth="1.4" />}
          </g>
        ))}
      </svg>
      <Wave title="1 · At the contact (the DC offset is not drawn)" unit="µV" data={f.elecUv} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.grey} height={84} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-fe-in" valueDigits={1} />
      <Wave title={p.hpHz > 0 ? `2 · After the ${p.hpHz} Hz high-pass: slow drift and offset removed` : '2 · No high-pass: the offset and drift pass straight through'} unit="µV" data={f.hpUv} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={84} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-fe-hp" valueDigits={1} />
      <Wave title={`3 · After the ${hz(p.lpHz)} low-pass and × ${p.gain}: what the converter is given`} unit="V" data={f.ampV} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={clipped ? C.red : C.green} height={96} yRange={[-1.1, 1.1]} hlines={[{ value: SWING_V, color: 'rgba(255,138,138,.7)', label: 'rail', dashed: true }, { value: -SWING_V, color: 'rgba(255,138,138,.7)', dashed: true }]} onSeek={(ms) => tl.seek(ms / 1000)} showTimeAxis testId="wave-fe-out" valueDigits={3} />
      {clipped && <p className="exp-warn" role="status" data-testid="fe-clipped">The amplifier is against its rail for {(f.clippedFrac * 100).toFixed(0)} % of the samples: {p.hpHz <= 0 ? `the electrode’s ${fmt(f.offsetMv, 0)} mV offset times the gain is ${fmt(f.offsetMv * p.gain / 1000, 1)} V, far beyond ±${SWING_V} V. This is why a neural amplifier is AC-coupled.` : 'the gain is too high for this signal.'}</p>}
      <div className="exp-controls" data-testid="frontend-controls">
        <Choice label="High-pass corner" value={p.hpHz} options={hps.map((h) => ({ value: h, label: h === 0 ? 'DC' : `${h} Hz` }))} onChange={(v) => set({ hpHz: v })} testId="knob-hp" />
        <Slider label="Low-pass (anti-alias) corner" value={p.lpHz} min={lim.lpHz[0]} max={lim.lpHz[1]} step={motor ? 100 : 10} unit="Hz" log onChange={(v) => set({ lpHz: v })} testId="knob-lp" />
        <Slider label="Gain" value={p.gain} min={lim.gain[0]} max={lim.gain[1]} step={10} unit="×" log onChange={(v) => set({ gain: v })} testId="knob-gain" />
      </div>
      <Readouts testId="frontend-readouts" items={[
        [`Gain at ${hz(probe)}`, `× ${fmt(p.gain * afeMagnitude(probe, p.hpHz, p.lpHz), 0)}`],
        ['At the Nyquist frequency', `${fmt(20 * Math.log10(afeMagnitude(p.fsHz / 2, p.hpHz, p.lpHz)), 1)} dB`],
        ['Samples on a rail', `${(f.clippedFrac * 100).toFixed(1)} %`],
      ]} />
    </>
  );
}

// ── 5 · analogue-to-digital conversion ──────────────────────────────────────────────────────────────────────────
export function AdcView({ s, t, tl }: StageProps) {
  const setM = useExperiment((x) => x.setMotor), setV = useExperiment((x) => x.setVisual);
  const f = s.run.focus!, p = s.run.params, motor = s.kind === 'motor';
  const set = (patch: { fsHz?: number; bits?: number }) => (motor ? setM(patch) : setV(patch));
  const w = (motor ? 3 : 40) * Math.max(1, (motor ? 30000 : 1000) / p.fsHz) ** 0.5, t0 = Math.max(0, t * 1000 - w / 2);
  const lsbV = SWING_V / 2 ** (p.bits - 1), sNow = Math.max(0, Math.min(f.codes.length - 1, Math.round(t * f.fsHz)));
  const rows = Array.from({ length: 7 }, (_, i) => sNow - 3 + i).filter((i) => i >= 0 && i < f.codes.length);
  const codeV = useMemo(() => { const a = new Float32Array(f.codes.length); for (let i = 0; i < a.length; i++) a[i] = f.codes[i] * lsbV; return a; }, [f.codes, lsbV]);
  const att = afeMagnitude(p.fsHz / 2, p.hpHz, p.lpHz), tone = p.fsHz * 0.7;
  const rates = motor ? SAMPLE_RATES_HZ : VIS_SAMPLE_RATES_HZ;
  return (
    <>
      <Wave title="Continuous voltage from the amplifier" unit="V" data={f.ampV} rateHz={f.gridHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.green} height={110} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-adc-in" valueDigits={4} />
      <Wave title={`Sampled ${p.fsHz.toLocaleString()} times a second and rounded to ${p.bits} bits (${2 ** p.bits} levels)`} unit="V" data={codeV} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={130} discrete onSeek={(ms) => tl.seek(ms / 1000)} showTimeAxis testId="wave-adc-out" valueDigits={4} note="each dot is one stored number" />
      <table className="exp-table" data-testid="adc-table">
        <thead><tr><th>Sample</th><th>Time</th><th>Voltage in</th><th>Code</th><th>Stored bits</th><th>Rounding error</th></tr></thead>
        <tbody>
          {rows.map((i) => {
            const vin = f.ampV[Math.min(f.ampV.length - 1, i * (f.gridHz / f.fsHz))];
            return (
              <tr key={i} className={i === sNow ? 'is-now' : undefined}>
                <td className="mono">{i}</td><td className="mono">{((i / f.fsHz) * 1000).toFixed(3)} ms</td><td className="mono">{(vin * 1000).toFixed(2)} mV</td>
                <td className="mono" data-testid={i === sNow ? 'adc-code-now' : undefined}>{f.codes[i]}</td><td className="mono bits">{codeBits(f.codes[i], p.bits)}</td><td className="mono">{((f.codes[i] * lsbV - vin) * 1000).toFixed(2)} mV</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="exp-controls" data-testid="adc-controls">
        <Choice label="Sample rate" value={p.fsHz} options={rates.map((r) => ({ value: r, label: r >= 1000 ? `${r / 1000} k` : String(r) }))} onChange={(v) => set({ fsHz: v })} testId="knob-fs" />
        <Slider label="Resolution" value={p.bits} min={4} max={16} step={1} unit="bits" onChange={(v) => set({ bits: v })} testId="knob-bits" />
      </div>
      <Readouts testId="adc-readouts" items={[
        ['One step at the converter', `${(lsbV * 1000).toFixed(lsbV < 0.001 ? 3 : 2)} mV`],
        ['One step at the electrode', `${fmt(f.lsbUv, f.lsbUv < 10 ? 2 : 0)} µV`],
        ['Nyquist frequency', hz(p.fsHz / 2)],
        ['Front-end gain left at Nyquist', `${(att * 100).toFixed(att < 0.1 ? 1 : 0)} %`],
        [`A ${hz(Math.round(tone))} tone would appear at`, hz(Math.round(aliasFrequency(tone, p.fsHz)))],
      ]} />
      {att > 0.3 && <p className="exp-warn" role="status" data-testid="adc-alias">The low-pass corner ({hz(p.lpHz)}) is above the Nyquist frequency ({hz(p.fsHz / 2)}): {(att * 100).toFixed(0)} % of what arrives there still gets through and is folded back into the band as if it were signal. Lower the corner or raise the sample rate.</p>}
      {f.lsbUv > 20 && <p className="exp-warn" role="status" data-testid="adc-coarse">One step is {fmt(f.lsbUv, 0)} µV at the electrode — {motor ? 'comparable to the spikes themselves, so they survive only as one-step blips, or not at all.' : 'larger than the changes you are trying to measure.'}</p>}
    </>
  );
}

// ── 6 · digital signal processing ───────────────────────────────────────────────────────────────────────────────
export function DspView({ s, t, tl }: StageProps) {
  const setM = useExperiment((x) => x.setMotor), setV = useExperiment((x) => x.setVisual);
  const f = s.run.focus!;
  if (s.kind === 'motor') {
    const r = s.run, p = r.params, w = 60, t0 = Math.max(0, t * 1000 - w / 2), thr = r.thresholdUv[f.ch], k = binOf(r, t);
    const ev: number[] = [], ok: number[] = [], markers: Marker[] = [];
    for (let e = 0; e < r.events.n; e++) if (r.events.ch[e] === f.ch) { ev.push(r.events.t[e]); ok.push(r.events.unit[e] >= 0 ? 1 : 0); markers.push({ tMs: r.events.t[e] * 1000, color: r.events.unit[e] >= 0 ? C.green : C.red, kind: 'triangle' }); }
    const rows: StripRow[] = Array.from({ length: N_CH }, (_, c) => ({ label: `ch ${c + 1}`, color: C.cyan, values: { data: r.counts, stride: N_CH, offset: c, binS: BIN_MS / 1000, min: 0, max: 5 }, emphasis: c === f.ch }));
    const rateRows: StripRow[] = Array.from({ length: N_CH }, (_, c) => ({ label: `ch ${c + 1}`, color: C.violet, values: { data: r.rates, stride: N_CH, offset: c, binS: BIN_MS / 1000, min: 0, max: 60 }, emphasis: c === f.ch }));
    const s0 = Math.max(0, t - 1.5);
    return (
      <>
        <Wave title={`1 · Band-pass ${DSP_BAND_HZ[0]} Hz – ${hz(Math.min(DSP_BAND_HZ[1], 0.4 * p.fsHz))}: keep what spikes are made of`} unit="µV" data={f.digUv} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.grey} height={84} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-dsp-bp" valueDigits={1} />
        {p.car && <Wave title="2 · What all eight contacts have in common (this is subtracted)" unit="µV" data={f.refUv} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.warm} height={64} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-dsp-ref" valueDigits={1} />}
        <Wave title={`${p.car ? '3' : '2'} · Detector input, with its threshold at −${p.threshK} × the noise estimate`} unit="µV" data={f.outUv} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={120} hlines={thr > 0 ? [{ value: -thr, color: C.warm, label: `threshold −${fmt(thr, 1)} µV`, dashed: true }] : []} markers={markers} onSeek={(ms) => tl.seek(ms / 1000)} showTimeAxis testId="wave-dsp-out" valueDigits={1} note="▼ green: a model neuron’s spike · ▼ red: noise or artefact" />
        {t < CAL_S && <p className="exp-note" data-testid="dsp-calibrating">For the first second the detector only listens: it measures the noise level it will set its threshold from. Nothing is counted yet.</p>}
        <Jump times={ev} t={t} tl={tl} label="crossing" />
        <Strip rows={rows} rowH={11} t0={s0} t1={s0 + 3} playhead={t} onSeek={tl.seek} testId="counts-strip" title={`Threshold crossings counted in ${BIN_MS} ms bins — brighter = more`} />
        <Strip rows={rateRows} rowH={11} t0={s0} t1={s0 + 3} playhead={t} onSeek={tl.seek} testId="rates-strip" title={`Smoothed into a firing-rate estimate (time constant ${p.tauMs} ms) — the decoder’s input`} />
        <div className="exp-controls" data-testid="dsp-controls">
          <Toggle label="Common average reference (subtract what all contacts share)" value={p.car} onChange={(v) => setM({ car: v })} testId="toggle-car" />
          <Slider label="Threshold" value={p.threshK} min={MOTOR_LIMITS.threshK[0]} max={MOTOR_LIMITS.threshK[1]} step={0.25} unit="× noise" digits={2} onChange={(v) => setM({ threshK: v })} testId="knob-thresh" />
          <Slider label="Rate smoothing" value={p.tauMs} min={MOTOR_LIMITS.tauMs[0]} max={MOTOR_LIMITS.tauMs[1]} step={10} unit="ms" onChange={(v) => setM({ tauMs: v })} testId="knob-tau" />
          <Choice label="Contact shown" value={p.focusCh} options={Array.from({ length: N_CH }, (_, c) => ({ value: c, label: String(c + 1) }))} onChange={(v) => setM({ focusCh: v })} testId="focus-ch" />
        </div>
        <Readouts testId="dsp-readouts" items={[
          ['Noise estimate σ̂', `${fmt(r.sigmaUv[f.ch], 2)} µV`], ['Threshold', `−${fmt(thr, 1)} µV`],
          ['Crossings in this bin', String(r.counts[k * N_CH + f.ch])], ['Rate estimate now', `${fmt(r.rates[k * N_CH + f.ch], 1)} /s`],
          ['Crossings from a model neuron', `${ok.filter(Boolean).length} of ${ok.length}`],
        ]} />
      </>
    );
  }
  const r = s.run, p = r.params, w = 600, t0 = Math.max(0, t * 1000 - w / 2), k = binOf(r, t);
  const rows: StripRow[] = Array.from({ length: r.nCh }, (_, c) => ({ label: `contact ${c + 1}`, color: C.violet, values: { data: r.feat, stride: r.nCh, offset: c, binS: r.binMs / 1000, min: 0, max: 8 }, emphasis: c === f.ch }));
  return (
    <>
      <Wave title="1 · The samples, back in microvolts at the contact" unit="µV" data={f.digUv} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.grey} height={84} onSeek={(ms) => tl.seek(ms / 1000)} bands={stimBands(r)} testId="wave-dsp-bp" valueDigits={1} />
      {p.car && <Wave title="2 · What all eight contacts have in common (mains hum, shared rhythm) — subtracted" unit="µV" data={f.refUv} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.warm} height={64} onSeek={(ms) => tl.seek(ms / 1000)} testId="wave-dsp-ref" valueDigits={1} />}
      <Wave title={`${p.car ? '3' : '2'} · Band-pass ${VIS_BAND_HZ[0]}–${Math.min(VIS_BAND_HZ[1], 0.4 * p.fsHz)} Hz: the part whose power follows local firing`} unit="µV" data={f.outUv} rateHz={f.fsHz} t0={t0} t1={t0 + w} playheadMs={t * 1000} color={C.cyan} height={110} onSeek={(ms) => tl.seek(ms / 1000)} bands={stimBands(r)} showTimeAxis testId="wave-dsp-out" valueDigits={2} />
      <Strip rows={rows} rowH={13} t0={0} t1={r.durationS} playhead={t} onSeek={tl.seek} bands={stimBandsS(r)} testId="feat-strip" title={`Band power per ${r.binMs} ms bin, in dB above rest, smoothed (${p.tauMs} ms) — the decoder’s inputs`} />
      <div className="exp-controls" data-testid="dsp-controls">
        <Toggle label="Common average reference (removes hum shared by all contacts)" value={p.car} onChange={(v) => setV({ car: v })} testId="toggle-car" />
        <Slider label="Power smoothing" value={p.tauMs} min={VISUAL_LIMITS.tauMs[0]} max={VISUAL_LIMITS.tauMs[1]} step={10} unit="ms" onChange={(v) => setV({ tauMs: v })} testId="knob-tau" />
      </div>
      <Readouts testId="dsp-readouts" items={[
        ['Band power now', `${fmt(r.powerDb[k * r.nCh + f.ch], 1)} dB`], ['Smoothed', `${fmt(r.feat[k * r.nCh + f.ch], 1)} dB`],
        ['Power at rest', `${fmt(Math.sqrt(r.basePowerUv2[f.ch]), 2)} µV rms`],
      ]} />
      {p.fsHz < 400 && <p className="exp-warn" data-testid="dsp-band-lost">At {p.fsHz} samples a second the Nyquist frequency is {p.fsHz / 2} Hz — below the top of the {VIS_BAND_HZ[0]}–{VIS_BAND_HZ[1]} Hz band. Part of the feature can no longer be represented.</p>}
    </>
  );
}

// ── 7 · decoder ─────────────────────────────────────────────────────────────────────────────────────────────────
function Terms({ labels, values, base, baseLabel, total, unit, color, testId }: { labels: string[]; values: number[]; base: number; baseLabel: string; total: number; unit: string; color: string; testId: string }) {
  const max = Math.max(0.05, Math.abs(base), ...values.map(Math.abs));
  const bar = (v: number) => ({ left: v < 0 ? `${50 + (v / max) * 48}%` : '50%', width: `${Math.abs(v / max) * 48}%`, background: v < 0 ? C.red : color });
  return (
    <div className="exp-terms" data-testid={testId}>
      <div className="exp-term"><span>{baseLabel}</span><i><b style={bar(base)} /></i><output className="mono">{base >= 0 ? '+' : ''}{base.toFixed(3)}</output></div>
      {values.map((v, i) => <div className="exp-term" key={i}><span>{labels[i]}</span><i><b style={bar(v)} /></i><output className="mono">{v >= 0 ? '+' : ''}{v.toFixed(3)}</output></div>)}
      <div className="exp-term total"><span>sum</span><i /><output className="mono" data-testid={`${testId}-sum`}>{total >= 0 ? '+' : ''}{total.toFixed(3)} {unit}</output></div>
    </div>
  );
}

export function DecoderView({ s, t, tl }: StageProps) {
  const setDecoder = useExperiment((x) => x.setDecoder), recal = useExperiment((x) => x.recalibrate), setM = useExperiment((x) => x.setMotor);
  const setStage = useExperiment((x) => x.setStage);
  if (s.kind === 'motor') {
    const r = s.run, k = binOf(r, t), st = r.steps, info = s.decoders.find((d) => d.id === s.decoderId)!;
    const fc = r.params.focusCh;
    const term = (o: number) => (st ? Array.from(st.contrib.subarray((k * 2 + o) * st.nTerm, (k * 2 + o + 1) * st.nTerm)) : []);
    const labels = st ? Array.from({ length: st.nTerm }, (_, j) => (st.contribOf === 'channel' ? `ch ${j + 1}` : `hidden ${j + 1}`)) : [];
    const baseLabel = info.id === 'kalman' ? 'carried from the last bin' : 'bias';
    const evs: Array<{ t: number; unit: number }> = [];
    for (let e = 0; e < r.events.n; e++) if (r.events.ch[e] === fc && binOf(r, r.events.t[e]) === k) evs.push({ t: r.events.t[e], unit: r.events.unit[e] });
    return (
      <>
        <div className="exp-controls" data-testid="decoder-controls">
          <Choice label="Decoder" value={s.decoderId} options={LIVE_DECODERS.map((id) => ({ value: id as string, label: s.decoders.find((d) => d.id === id)!.name }))} onChange={setDecoder} testId="decoder-pick" />
        </div>
        <p className="exp-note">{info.blurb} It was fitted on {s.trainBins} bins ({(s.trainBins * BIN_MS / 1000).toFixed(0)} s) of a simulated calibration task in which the cursor is moved for the user and the user is assumed to intend that movement.</p>
        <div className="exp-decoder" data-testid="decoder-now">
          <div>
            <div className="exp-sub">Inputs in this bin ({(k * BIN_MS / 1000).toFixed(2)}–{((k + 1) * BIN_MS / 1000).toFixed(2)} s)</div>
            <table className="exp-table compact" data-testid="decoder-inputs">
              <thead><tr><th>Channel</th><th>Crossings</th><th>Rate</th><th>{info.uses === 'rates' ? 'z-score' : 'count − mean'}</th></tr></thead>
              <tbody>{Array.from({ length: N_CH }, (_, c) => (
                <tr key={c} className={c === fc ? 'is-now' : undefined}>
                  <td><button type="button" className="crumb" onClick={() => setM({ focusCh: c })} title="Show this contact’s waveforms" data-testid={`trace-ch-${c}`}>ch {c + 1}</button></td>
                  <td className="mono">{r.counts[k * N_CH + c]}</td><td className="mono">{fmt(r.rates[k * N_CH + c], 1)} /s</td><td className="mono">{st ? fmt(st.inputs[k * st.nIn + c], 2) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {st && r.valid[k] ? (
            <>
              <div><div className="exp-sub">Velocity x = {baseLabel} + Σ terms</div><Terms labels={labels} values={term(0)} base={st.base[k * 2]} baseLabel={baseLabel} total={r.decoded[k * 2]} unit="" color={C.violet} testId="terms-x" /></div>
              <div><div className="exp-sub">Velocity y = {baseLabel} + Σ terms</div><Terms labels={labels} values={term(1)} base={st.base[k * 2 + 1]} baseLabel={baseLabel} total={r.decoded[k * 2 + 1]} unit="" color={C.violet} testId="terms-y" /></div>
            </>
          ) : <p className="exp-note" data-testid="decoder-waiting">Nothing is decoded in this bin: the detector is still measuring its noise level (first {CAL_S + 0.25} s).</p>}
        </div>
        <Readouts testId="decoder-readouts" items={[
          ['Decoded velocity', `(${fmt(r.decoded[k * 2], 2)}, ${fmt(r.decoded[k * 2 + 1], 2)})`],
          ['Intended velocity', `(${fmt(r.intent[k * 2], 2)}, ${fmt(r.intent[k * 2 + 1], 2)})`],
          ['Uncertainty (1 s.d.)', `± ${fmt(r.decodedSd[k * 2], 2)}, ± ${fmt(r.decodedSd[k * 2 + 1], 2)}`],
          ['Arithmetic per bin', `${info.cost.macs} multiply–adds${info.cost.nonlin ? ` + ${info.cost.nonlin} tanh` : ''}`],
        ]} />
        <p className="exp-fine"><Prov kind="inferred" /> {info.uncertainty}</p>
        <div className="exp-trace" data-testid="trace-panel">
          <div className="exp-sub">Trace this prediction back <Prov kind="simulated" /></div>
          <p>Channel {fc + 1} contributed {st && st.contribOf === 'channel' ? <strong className="mono">({fmt(st.contrib[(k * 2) * st.nTerm + fc], 3)}, {fmt(st.contrib[(k * 2 + 1) * st.nTerm + fc], 3)})</strong> : 'through the hidden units'} to this bin’s output. Its input is the smoothed rate {fmt(r.rates[k * N_CH + fc], 1)} /s, which this bin’s <strong data-testid="trace-count">{evs.length}</strong> crossing{evs.length === 1 ? '' : 's'} fed:</p>
          {evs.length === 0 ? <p className="exp-note">No crossing on this channel in this bin — pick another channel in the table, or step to another bin.</p> : (
            <ul className="exp-events">
              {evs.map((e) => {
                const u = e.unit >= 0 ? r.units[e.unit] : null;
                return (
                  <li key={e.t}>
                    <span className="mono">{e.t.toFixed(4)} s</span>
                    <span>{u ? <>spike of the {['nearest', 'middle', 'far'][u.rank]} neuron ({fmt(r.ampUv[u.id], 0)} µV at the contact)</> : <span className="warn-text">no model neuron fired — noise or an artefact crossed the threshold</span>}</span>
                    <span className="exp-hops">{([[6, 'detector'], [5, 'samples'], [4, 'amplifier'], [3, 'electrode'], [2, 'neuron']] as const).map(([n, l]) => <button key={n} type="button" className="btn" onClick={() => { tl.setPlaying(false); tl.seek(e.t); setStage(n); }} data-testid={`trace-to-${n}`}>{l}</button>)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="exp-scores" data-testid="decoder-scores">
          <div className="exp-sub">How well each decoder does on a run it never saw <Prov kind="simulated" /></div>
          <table className="exp-table compact">
            <thead><tr><th>Decoder</th><th>R² as calibrated</th><th>R² under the current recording</th><th>Lag</th><th>Multiply–adds</th></tr></thead>
            <tbody>{s.decoders.map((d) => (
              <tr key={d.id} className={d.id === s.decoderId ? 'is-now' : undefined}>
                <td>{d.name}</td><td className="mono">{fmt(d.heldOut.r2, 2)}</td><td className={`mono${s.drifted && d.heldOutNow.r2 < d.heldOut.r2 - 0.1 ? ' warn-text' : ''}`} data-testid={`r2-now-${d.id}`}>{fmt(d.heldOutNow.r2, 2)}</td><td className="mono">{d.heldOutNow.lagBins * BIN_MS} ms</td><td className="mono">{d.cost.macs}</td>
              </tr>
            ))}</tbody>
          </table>
          {s.drifted && <p className="exp-warn" data-testid="decoder-drifted">The recording conditions are no longer the ones these decoders were fitted under. They are being used as they are. <button type="button" className="btn" onClick={recal} data-testid="recalibrate">Recalibrate under the current conditions</button></p>}
          <p className="exp-fine">R² compares decoded with intended velocity over {s.heldOutBins} held-out bins (1 = perfect, 0 = no better than always answering the mean, below 0 = worse). Synthetic data: this says how the decoders behave on this model, not on a brain.</p>
        </div>
      </>
    );
  }
  const r = s.run, k = binOf(r, t), st = r.steps, m = s.model;
  const term = (o: number) => (st ? Array.from(st.contrib.subarray((k * 2 + o) * st.nTerm, (k * 2 + o + 1) * st.nTerm)) : []);
  const labels = Array.from({ length: r.nCh }, (_, c) => `contact ${c + 1}`);
  const logit = (o: number) => (st ? st.base[k * 2 + o] + term(o).reduce((a, v) => a + v, 0) : 0);
  return (
    <>
      <p className="exp-note">Two logistic units read the eight band powers. Each adds up weighted inputs and squashes the sum into a probability. They were fitted on {s.trainBins} bins of a simulated calibration session with labelled pictures.</p>
      {st && r.valid[k] ? (
        <div className="exp-decoder" data-testid="decoder-now">
          <div><div className="exp-sub">Is a picture on? logit = bias + Σ terms</div><Terms labels={labels} values={term(0)} base={st.base[k * 2]} baseLabel="bias" total={logit(0)} unit="→ P" color={C.violet} testId="terms-x" /><div className="exp-prob" data-testid="p-on"><span>P(picture on)</span><i><b style={{ width: `${r.decoded[k * 2] * 100}%` }} /></i><output className="mono">{(r.decoded[k * 2] * 100).toFixed(0)} %</output></div></div>
          <div><div className="exp-sub">If so, an intact object? logit = bias + Σ terms</div><Terms labels={labels} values={term(1)} base={st.base[k * 2 + 1]} baseLabel="bias" total={logit(1)} unit="→ P" color={C.green} testId="terms-y" /><div className="exp-prob" data-testid="p-object"><span>P(intact object)</span><i><b style={{ width: `${r.decoded[k * 2 + 1] * 100}%`, background: C.green }} /></i><output className="mono">{(r.decoded[k * 2 + 1] * 100).toFixed(0)} %</output></div></div>
        </div>
      ) : <p className="exp-note" data-testid="decoder-waiting">Nothing is decoded in this bin: the first second is used to measure the power at rest.</p>}
      <p className="exp-fine"><Prov kind="inferred" /> The probability is the model’s own confidence: near 50 % it is saying it does not know. Weights on contacts {m.W[0].map((w, c) => (Math.abs(w) < 0.15 ? c + 1 : 0)).filter(Boolean).join(', ') || '—'} are close to zero — the cortex under them is barely driven by pictures in this model, so they carry little.</p>
      {s.drifted && <p className="exp-warn" data-testid="decoder-drifted">The recording conditions differ from the calibration’s. <button type="button" className="btn" onClick={recal} data-testid="recalibrate">Recalibrate under the current conditions</button></p>}
      <button type="button" className="btn" onClick={() => { tl.setPlaying(false); setStage(6); }} data-testid="trace-to-6">See where these band powers come from →</button>
    </>
  );
}

// ── 8 · output and feedback ─────────────────────────────────────────────────────────────────────────────────────
export function OutputView({ s, t, tl }: StageProps) {
  if (s.kind === 'motor') {
    const r = s.run, k = binOf(r, t), sum = s.summary;
    const err = Math.hypot(r.decoded[k * 2] - r.intent[k * 2], r.decoded[k * 2 + 1] - r.intent[k * 2 + 1]);
    const tx = r.targetXY[k * 2], dist = Number.isFinite(tx) ? Math.hypot(tx - r.cursor[k * 2], r.targetXY[k * 2 + 1] - r.cursor[k * 2 + 1]) : NaN;
    return (
      <div className="exp-output">
        <div>
          <CursorPad run={r} k={k} size={320} />
          <div className="exp-legend"><span><i style={{ background: C.cyan }} />cursor</span><span><i style={{ background: C.green }} />target</span><span><i style={{ background: C.warm }} />intended</span><span><i style={{ background: C.violet }} />decoded ± uncertainty</span></div>
        </div>
        <div>
          <svg className="exp-loop" viewBox="0 0 330 150" role="img" aria-label="The closed loop: intention, neurons, recording, decoder, cursor, and back through the eyes">
            {[['Intention', 14, 14], ['Neurons', 124, 14], ['Recording', 234, 14], ['Decoder', 234, 96], ['Cursor', 124, 96], ['Eyes', 14, 96]].map(([l, x, y]) => <g key={String(l)}><rect x={+x} y={+y} width="82" height="38" rx="9" fill="rgba(127,231,255,.07)" stroke="rgba(127,231,255,.4)" /><text x={+x + 41} y={+y + 23} textAnchor="middle" fill="#EAFBFF" fontSize="12">{l}</text></g>)}
            <path d="M96 33h26M206 33h26M275 52v42M234 115h-26M124 115H98M55 96V54" stroke={C.cyan} fill="none" strokeWidth="1.4" markerEnd="url(#ah)" />
            <defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0l8 4-8 4z" fill={C.cyan} /></marker></defs>
            <text x="60" y="80" fill="#FFD08A" fontSize="10.5" fontFamily="ui-monospace, Menlo, monospace">{FEEDBACK_DELAY_BINS * BIN_MS} ms late</text>
          </svg>
          <Readouts testId="output-readouts" items={[
            ['Cursor', `(${fmt(r.cursor[k * 2], 2)}, ${fmt(r.cursor[k * 2 + 1], 2)})`], ['Distance to target', Number.isFinite(dist) ? fmt(dist, 2) : 'no target yet'],
            ['Decoded − intended', fmt(err, 2)], ['Targets reached', `${sum.hits} of ${sum.trials}`],
            ['Mean time to a target', sum.meanTimeS ? `${fmt(sum.meanTimeS, 2)} s` : '—'], ['Path directness', sum.pathEfficiency ? `${(sum.pathEfficiency * 100).toFixed(0)} %` : '—'],
          ]} />
          <p className="exp-note">The decoder’s errors do not pile up, because the loop is closed: the simulated user sees where the cursor went ({FEEDBACK_DELAY_BINS * BIN_MS} ms late) and aims at the target again from there. The cursor moves at {VMAX} workspace units per second for a decoded speed of 1.</p>
          <Strip rows={r.trials.map((tr, i) => ({ label: `target ${i + 1}`, color: tr.hit ? C.green : C.red, events: [tr.endS] }))} rowH={13} t0={0} t1={r.durationS} playhead={t} onSeek={tl.seek} bands={r.trials.map((tr) => ({ t0: tr.startS, t1: tr.endS, color: 'rgba(140,255,181,.06)' }))} testId="trials-strip" title="When each target was reached" />
        </div>
      </div>
    );
  }
  const r = s.run, sum = s.summary, binS = r.binMs / 1000, k = binOf(r, t);
  const truth = Float32Array.from(r.on), kind = Float32Array.from(r.kindOf, (v) => (v === 1 ? 1 : 0)), said = new Float32Array(r.nBins), saidObj = new Float32Array(r.nBins);
  for (let i = 0; i < r.nBins; i++) { said[i] = r.decoded[i * 2] > 0.5 ? 1 : 0; saidObj[i] = said[i] && r.decoded[i * 2 + 1] > 0.5 ? 1 : 0; }
  const v = (data: ArrayLike<number>, stride = 1, offset = 0) => ({ data, stride, offset, binS, min: 0, max: 1 });
  return (
    <>
      <Strip rowH={18} t0={0} t1={r.durationS} playhead={t} onSeek={tl.seek} bands={stimBandsS(r)} testId="visual-outcome" title="What was on the screen, and what the decoder said" rows={[
        { label: 'on screen', color: C.warm, values: v(truth) }, { label: 'P(on)', color: C.violet, line: true, values: v(r.decoded, 2, 0) }, { label: 'said “on”', color: C.violet, values: v(said) },
        { label: 'intact', color: C.green, values: v(kind) }, { label: 'P(intact)', color: C.green, line: true, values: v(r.decoded, 2, 1) }, { label: 'said intact', color: C.green, values: v(saidObj) },
      ]} />
      <Readouts testId="output-readouts" items={[
        ['Now', r.on[k] ? (r.kindOf[k] === 1 ? 'an intact object is on' : 'a scrambled picture is on') : 'blank screen'],
        ['Decoder says', r.valid[k] ? (r.decoded[k * 2] > 0.5 ? `picture on (${(r.decoded[k * 2] * 100).toFixed(0)} %)` : `nothing (${(r.decoded[k * 2] * 100).toFixed(0)} %)`) : '—'],
        ['Intact objects detected', `${sum.objectsDetected} of ${sum.objectsShown}`], ['Scrambled pictures detected', `${sum.scrambledDetected} of ${sum.scrambledShown}`],
        ['Mean delay after onset', sum.meanDelayS ? `${(sum.meanDelayS * 1000).toFixed(0)} ms` : '—'], ['False alarms', `${sum.falseAlarmBins} of ${sum.quietBins} quiet bins`],
        ['Intact vs scrambled right', `${sum.kindCorrect} of ${sum.detected}`], ['Which object? (chance 1 in 4)', `${sum.identityCorrect} of ${sum.objects}`],
      ]} />
      <div className="exp-limits" data-testid="visual-limits">
        <div className="exp-sub">What this recording can and cannot tell</div>
        <ul>
          <li><strong>That something appeared, and when</strong> — yes, when the cortex under the contacts is driven hard enough. Weakly driving pictures are missed.</li>
          <li><strong>Intact object or scrambled</strong> — partly, and only because the model was told intact objects drive this cortex harder. It illustrates the imaging result; it is not evidence for it.</li>
          <li><strong>Which object</strong> — no. Every object drives the model identically, so the “which object” score above is chance by construction. Real identity information lives in patterns across many areas, not in the level of activity under a few contacts.</li>
          <li><strong>A cursor</strong> — there is nothing here to steer one with. This cortex responds to what is seen, not to what the person intends to do; that is the motor experiment.</li>
        </ul>
        <p className="exp-fine">There is no feedback loop in this experiment: the picture drives the cortex, and the decoder only reports. Nothing here reads what a person is imagining or thinking.</p>
      </div>
    </>
  );
}
export { UNITS_PER_CH, GRID_HZ };
