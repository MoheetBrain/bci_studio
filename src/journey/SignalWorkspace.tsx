// Signal journey: neural source → electrode → (routing) → analogue front end → (analogue MUX) → ADC → our chip →
// decoder / host. A flat block chain, aligned waveform panels, transport controls and parameters with calculated
// consequences. Every number on this screen is produced by src/journey/model/chain.ts from the visible parameters.
import { useEffect, useMemo, useRef } from 'react';
import { useJourney, PRESETS, type Zoom } from './journeyStore';
import { STAGES, REALISATION_LABEL, type Stage } from './stages';
import { Wave, type Marker } from './Wave';
import { stateAt, SAMPLE_RATES_HZ, LIMITS, ANALOG_RATE_HZ, EVENT_PACKET_BITS } from './model/chain';
import { Cites, EvidenceTag, SourceList } from '../science/Cite';
import { useHierarchy, srcRef } from '../chipmap/useHierarchy';
import { useShell } from '../shell/shellStore';
import { useAtlas } from '../atlas/atlasStore';
import { JourneyRail, Predict, type PredictTask } from '../kit/kit';
import './journey.css';

const ALIAS_TASK: PredictTask = {
  id: 'aliasing',
  question: 'A 7 kHz tone reaches a converter that takes 10,000 samples a second, and the low-pass filter in front of it is set far too wide. Where does the tone show up in the digital samples?',
  options: [
    { id: 'same', label: 'At 7 kHz, as it went in' },
    { id: 'folded', label: 'At 3 kHz — a frequency that was never there' },
    { id: 'gone', label: 'Nowhere: it is too fast to be captured at all' },
  ],
  correct: 'folded',
  explain: 'Sampling 10,000 times a second can only tell frequencies up to 5 kHz apart. Anything faster folds back: 10 − 7 = 3 kHz. The samples are identical to those of a real 3 kHz tone, so nothing after the converter can undo it — the filter before it has to prevent it.',
  wrong: {
    same: 'The converter cannot represent 7 kHz at this rate, but it does not ignore it either.',
    gone: 'It does not vanish; it lands on a different frequency and looks like real signal there.',
  },
  tryLabel: 'Load the aliasing example',
};

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const si = (v: number, unit: string) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} M${unit}`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)} k${unit}`;
  return `${v.toFixed(0)} ${unit}`;
};

function Slider(p: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; testId?: string; hint?: string }) {
  return (
    <label className="prm" title={p.hint}>
      <span className="prm-label">{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(+e.target.value)} data-testid={p.testId} aria-label={`${p.label} (${p.unit})`} />
      <span className="prm-value mono">{p.format ? p.format(p.value) : p.value} {p.unit}</span>
    </label>
  );
}

function StageInspector({ stage }: { stage: Stage }) {
  const { data, error } = useHierarchy();
  const go = useShell((s) => s.go);
  const openResearch = useShell((s) => s.openResearch);
  return (
    <section className="card stage-card" aria-label={`About: ${stage.title}`} data-testid="stage-inspector">
      <div className="stage-head">
        <h2 data-testid="stage-title">{stage.title}{stage.optional && <span className="opt"> · optional</span>}</h2>
        <div className="row">
          <span className={`real real-${stage.realisation}`} title={REALISATION_LABEL[stage.realisation].long} data-testid="stage-realisation">{REALISATION_LABEL[stage.realisation].short}</span>
          <EvidenceTag kind={stage.evidence} />
        </div>
      </div>
      <p className="stage-purpose">{stage.purpose}</p>
      <dl className="io">
        <dt>In</dt><dd>{stage.input}</dd>
        <dt>Out</dt><dd>{stage.output}</dd>
      </dl>
      {stage.notToBeConfusedWith && <p className="stage-confuse" role="note"><strong>Not to be confused:</strong> {stage.notToBeConfusedWith}</p>}
      <details open>
        <summary>Assumptions in this lesson</summary>
        <ul className="assume">{stage.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </details>
      {stage.chipInstances && (
        <details open>
          <summary>In our RTL ({stage.chipInstances.length} instances)</summary>
          {error && <p className="warn-text">The chip hierarchy could not be loaded ({error}); instance details are unavailable.</p>}
          <ul className="insts">
            {stage.chipInstances.map((path) => {
              const inst = data?.instances.find((i) => i.path === path);
              return (
                <li key={path}>
                  <span className="mono inst-name">{path.split('/').slice(1).join(' / ')}</span>
                  {inst
                    ? <span className="inst-meta"><span className="mono">{inst.module}</span> · <span className="mono">{srcRef(inst.file, inst.line)}</span></span>
                    : data ? <span className="warn-text">not found in the extracted hierarchy</span> : <span className="muted">loading…</span>}
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn" onClick={() => go('chip')} data-testid="stage-to-chip">Open these blocks in “Our chip” →</button>
        </details>
      )}
      <details>
        <summary>Sources ({stage.sources.length})</summary>
        <SourceList ids={stage.sources} />
        <button type="button" className="btn btn-link" onClick={() => openResearch(stage.title)}>Search the local corpus for “{stage.title}”</button>
      </details>
    </section>
  );
}

function Consequences() {
  const r = useJourney((s) => s.result);
  const d = r.derived, p = r.params;
  const rows: Array<[string, string, string?]> = [
    ['One code step (LSB) at the ADC', `${f(d.lsbV * 1e6, d.lsbV * 1e6 < 100 ? 2 : 0)} µV`, `= 2 × ${p.vrefV} V / 2^${p.bits}`],
    ['One code step referred to the electrode', `${f(d.lsbInputUv, d.lsbInputUv < 1 ? 3 : 2)} µV`, `LSB / gain (${p.gain})`],
    ['Ideal quantisation noise at the electrode', `${f(d.quantNoiseInputUvRms, 3)} µV RMS`, 'LSB / √12'],
    ['Largest input before clipping', `± ${f(d.fullScaleInputMv, 3)} mV`, 'min(ADC full scale, amplifier swing) / gain'],
    ['Electrode thermal noise', `${f(d.electrodeThermalUvRms, 2)} µV RMS`, `√(4kTRB): ${p.electrodeResistanceKohm} kΩ, ${si(d.noiseBandwidthHz, 'Hz')} noise bandwidth, 310 K`],
    ['Total input-referred noise', `${f(d.inputNoiseUvRms, 2)} µV RMS`, 'thermal ⊕ amplifier (root-sum-square)'],
    ['Spike peak kept by the amplifier band', `${f(d.spikePeakRetained * 100, 0)} %`, `band ${p.hpHz > 0 ? `${p.hpHz} Hz` : 'DC'} – ${si(p.lpHz, 'Hz')}`],
    ['Detection threshold at the electrode', p.core.threshold === 0 ? 'detector off' : `${f(d.thresholdInputUv, 1)} µV`, `${p.core.threshold} sample units${p.core.threshold ? ` = ${f(d.thresholdInputUv / Math.max(1e-9, d.inputNoiseUvRms), 1)} × input noise RMS` : ''}`],
    ['Nyquist frequency', si(d.nyquistHz, 'Hz'), `half of ${si(p.fsHz, 'S/s')}; the low-pass is ${f(d.lpAttenuationAtNyquistDb, 1)} dB there`],
    ['FEATURE band at this sample rate', `${f(d.featureBandHz[0], 0)}–${f(d.featureBandHz[1], 0)} Hz`, `designed as 70–150 Hz at 2 kS/s; window ${f(d.featureWindowMs, 2)} ms`],
    ['Raw sample stream', si(d.rawBitsPerS, 'bit/s'), `${si(p.fsHz, 'S/s')} × 16 bits, one channel`],
    ['Event stream', si(d.eventBitsPerS, 'bit/s'), `${r.digital.events.length} events × ${EVENT_PACKET_BITS} bits in ${p.durationMs} ms — lossy: the waveform is not recoverable`],
  ];
  return (
    <section className="card" aria-label="Calculated consequences of the current settings" data-testid="consequences">
      <h2>Consequences of these settings <EvidenceTag kind="synthetic" /></h2>
      <table className="cons">
        <tbody>
          {rows.map(([k, v, why]) => <tr key={k}><th scope="row">{k}</th><td className="mono">{v}</td><td className="why">{why}</td></tr>)}
        </tbody>
      </table>
      {d.afeClipFraction > 0 && <p className="alert" role="status" data-testid="alert-afe-clip">Amplifier saturated for {f(d.afeClipFraction * 100, 1)} % of the time{d.dcOffsetAtOutputV !== 0 ? ` — the ${p.electrodeOffsetMv} mV electrode offset alone asks for ${f(d.dcOffsetAtOutputV, 1)} V at the output (swing ± ${p.swingV} V). Switch the high-pass on.` : '. Lower the gain.'}</p>}
      {d.adcClipFraction > 0 && <p className="alert" role="status" data-testid="alert-adc-clip">ADC clamped at its rails for {f(d.adcClipFraction * 100, 1)} % of samples.</p>}
      {d.interferer && (
        <p className={d.interferer.aliased ? 'alert' : 'note'} role="status" data-testid="alias-note">
          Interferer: {f(d.interferer.inputUvPk, 0)} µV at {si(d.interferer.fHz, 'Hz')}. The low-pass ({si(p.lpHz, 'Hz')}) changes it by {f(d.interferer.attenuationDb, 1)} dB → {f(d.interferer.afterFilterUvPk, 1)} µV.{' '}
          {d.interferer.aliased
            ? <>It is above Nyquist ({si(d.nyquistHz, 'Hz')}), so after sampling it appears at <strong>{si(d.interferer.aliasHz, 'Hz')}</strong> — indistinguishable from a real signal at that frequency.</>
            : <>It is below Nyquist ({si(d.nyquistHz, 'Hz')}), so it is represented at its true frequency.</>}
        </p>
      )}
      <p className="det" data-testid="detection">
        Detector vs. the known synthetic spikes: {d.detection.trueSpikes} spikes fired; {d.detection.detectable} have a filtered peak above threshold;{' '}
        <strong>{d.detection.hits} detected</strong>, {d.detection.misses} missed, {d.detection.falsePositives} false events (match window ± {d.detection.toleranceMs} ms).
        {d.detection.trueSpikes - d.detection.detectable > 0 && <> The other {d.detection.trueSpikes - d.detection.detectable} are in the trace but below threshold: the electrode records them, the detector ignores them.</>}
      </p>
    </section>
  );
}

const ZOOMS: Array<{ id: Zoom; label: string }> = [{ id: 'all', label: 'Whole window' }, { id: '40', label: '40 ms' }, { id: '8', label: '8 ms' }];
const SPEEDS = [2, 5, 20, 100];

export default function SignalWorkspace() {
  const s = useJourney();
  const r = s.result, p = r.params;
  const stage = STAGES[s.stageIndex];
  const regionName = useAtlas((a) => a.nameOf(a.selectedId));
  const go = useShell((x) => x.go);

  // playback: wall-clock → signal time
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!s.playing) { last.current = null; return; }
    let raf = 0;
    const tick = (now: number) => {
      const st = useJourney.getState();
      if (last.current !== null) {
        const next = st.tMs + ((now - last.current) / 1000) * st.speed;
        if (next >= st.params.durationMs) { st.seek(st.params.durationMs); st.setPlaying(false); last.current = null; return; }
        st.seek(next);
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.playing]);

  const [t0, t1] = useMemo((): [number, number] => {
    if (s.zoom === 'all') return [0, p.durationMs];
    const span = +s.zoom;
    const a = Math.max(0, Math.min(p.durationMs - span, s.tMs - span / 2));
    return [a, a + span];
  }, [s.zoom, s.tMs, p.durationMs]);

  const now = useMemo(() => stateAt(r, s.tMs), [r, s.tMs]);
  const truthMarkers: Marker[] = useMemo(() => r.truth.map((t) => ({ tMs: t.tMs, color: ['#B0532A', '#3B6FB6', '#7A4FB0', '#56616A'][t.unit % 4], kind: 'tick' as const })), [r]);
  const eventMarkers: Marker[] = useMemo(() => r.digital.events.map((e) => ({ tMs: e.tMs, kind: 'triangle' as const, color: e.matchedUnit === null ? '#B3261E' : '#8A6400' })), [r]);
  const thr = p.core.threshold;
  const energyBars = useMemo(() => ({ tMs: r.digital.windows.map((w) => w.tMs), value: r.digital.windows.map((w) => w.energy), widthMs: r.derived.featureWindowMs, color: 'rgba(30,125,74,0.28)', label: 'window energy (bars, own scale)' }), [r]);
  const bands = p.gammaUvPk > 0 ? [{ t0: p.gammaStartMs, t1: p.gammaEndMs, color: 'rgba(30,125,74,0.07)' }] : [];
  const active = (key: string) => stage.trace !== null && stage.trace !== key;
  const rasterData = useMemo(() => { const a = new Float32Array(r.adc.count); for (const e of r.digital.events) a[e.n] = 1; return a; }, [r]);

  return (
    <div className="page journey cine" data-testid="signal-workspace">
      <div className="page-inner">
        <header className="jr-header">
          <div>
            <h1>Signal journey</h1>
            <p className="lede">
              Follow one electrode channel from tissue to digital records. This is one example architecture — the one this project plans around — and every trace below is{' '}
              <strong>computed from the parameters you see</strong>, not recorded.
              {regionName ? <> Electrode placed (illustratively) in the <button type="button" className="btn-link inline" onClick={() => go('brain')}>{regionName}</button>.</> : <> No brain region is selected; <button type="button" className="btn-link inline" onClick={() => go('brain')}>choose one in the atlas</button>.</>}
            </p>
          </div>
          <EvidenceTag kind="synthetic" />
        </header>

        <nav className="chain" aria-label="Stages of the recording chain, in signal order" data-testid="chain">
          {STAGES.map((st, i) => (
            <span key={st.id} className="chain-item">
              {i > 0 && <span className="chain-arrow" aria-hidden="true">→</span>}
              <button
                type="button"
                className={`chain-block real-${st.realisation}${i === s.stageIndex ? ' current' : ''}${st.optional ? ' optional' : ''}`}
                aria-current={i === s.stageIndex ? 'step' : undefined}
                onClick={() => s.setStage(i)}
                data-testid={`stage-${st.id}`}
                title={`${st.title} — ${REALISATION_LABEL[st.realisation].short}`}
              >
                <span className="chain-n">{i + 1}</span>
                <span className="chain-name">{st.short}</span>
                <span className="chain-real">{st.realisation === 'chip-rtl' ? 'our RTL' : st.realisation === 'external' ? 'external' : st.realisation}</span>
              </button>
            </span>
          ))}
        </nav>
        <div className="chain-legend" aria-label="Legend for the chain">
          <span><span className="sw sw-biology" />Biology</span>
          <span><span className="sw sw-external" />External hardware — not implemented in our repository</span>
          <span><span className="sw sw-chip" />Implemented in our RTL (simulated, not fabricated)</span>
          <span><span className="sw sw-optional" />Dashed: present in some systems only</span>
        </div>

        <div className="jr-grid">
          <div className="jr-left">
            <StageInspector stage={stage} />
            <section className="card" aria-label="Parameters">
              <h2>Settings</h2>
              <div className="presets" role="group" aria-label="Presets">
                {PRESETS.map((x) => <button key={x.id} type="button" className={`btn${s.preset === x.id ? ' on' : ''}`} aria-pressed={s.preset === x.id} onClick={() => s.applyPreset(x.id)} title={x.blurb} data-testid={`preset-${x.id}`}>{x.label}</button>)}
              </div>
              {s.preset && <p className="preset-blurb">{PRESETS.find((x) => x.id === s.preset)!.blurb}</p>}
              {s.errors.length > 0 && <p className="alert" role="alert" data-testid="param-errors">These settings are not valid, so the last valid result is still shown: {s.errors.join('; ')}.</p>}
              <fieldset><legend>Electrode</legend>
                <Slider label="Nearest neuron" unit="µm" value={p.units[0].distanceUm} min={LIMITS.distanceUm[0]} max={200} step={5} onChange={(v) => s.setUnitDistance(0, v)} testId="prm-distance" hint="Distance from the contact to the closest model neuron" />
                <Slider label="Offset" unit="mV" value={p.electrodeOffsetMv} min={-100} max={100} step={5} onChange={(v) => s.setParams({ electrodeOffsetMv: v })} />
              </fieldset>
              <fieldset><legend>Analogue front end</legend>
                <Slider label="Gain" unit="V/V" value={p.gain} min={20} max={2000} step={20} onChange={(v) => s.setParams({ gain: v })} testId="prm-gain" />
                <Slider label="High-pass" unit="Hz" value={p.hpHz} min={0} max={1000} step={10} onChange={(v) => s.setParams({ hpHz: v })} format={(v) => (v === 0 ? 'off (DC)' : String(v))} testId="prm-hp" />
                <Slider label="Low-pass" unit="Hz" value={p.lpHz} min={200} max={20000} step={100} onChange={(v) => s.setParams({ lpHz: v })} testId="prm-lp" />
              </fieldset>
              <fieldset><legend>ADC</legend>
                <label className="prm"><span className="prm-label">Sample rate</span>
                  <select value={p.fsHz} onChange={(e) => s.setParams({ fsHz: +e.target.value })} data-testid="prm-fs" aria-label="Sample rate (samples per second)">
                    {SAMPLE_RATES_HZ.map((v) => <option key={v} value={v}>{v.toLocaleString()} S/s</option>)}
                  </select>
                  <span className="prm-value mono">Nyquist {si(p.fsHz / 2, 'Hz')}</span>
                </label>
                <Slider label="Resolution" unit="bits" value={p.bits} min={4} max={16} step={1} onChange={(v) => s.setParams({ bits: v })} testId="prm-bits" />
              </fieldset>
              <fieldset><legend>Chip (EVENT path)</legend>
                <Slider label="Threshold" unit="units" value={p.core.threshold} min={0} max={8000} step={50} onChange={(v) => s.setCore({ threshold: v })} format={(v) => (v === 0 ? 'off' : String(v))} testId="prm-threshold" hint="16-bit sample units; 0 disables the detector (as in the RTL)" />
              </fieldset>
              <fieldset><legend>Interferer (aliasing demonstration)</legend>
                <Slider label="Amplitude" unit="µV" value={p.interfererUvPk} min={0} max={400} step={10} onChange={(v) => s.setParams({ interfererUvPk: v })} format={(v) => (v === 0 ? 'off' : String(v))} testId="prm-int-amp" />
                <Slider label="Frequency" unit="Hz" value={p.interfererHz} min={500} max={40000} step={500} onChange={(v) => s.setParams({ interfererHz: v })} testId="prm-int-f" />
              </fieldset>
              <p className="seed mono">seed {p.seed} · {p.durationMs} ms · analogue grid {ANALOG_RATE_HZ / 1000} kHz</p>
            </section>
          </div>

          <div className="jr-right">
            <section className="card transport" aria-label="Playback">
              <div className="row">
                <button type="button" className="btn" onClick={() => s.stepStage(-1)} disabled={s.stageIndex === 0} data-testid="prev-stage" aria-label="Previous stage">◀ Stage</button>
                <button type="button" className="btn" onClick={() => s.stepStage(1)} disabled={s.stageIndex === STAGES.length - 1} data-testid="next-stage" aria-label="Next stage">Stage ▶</button>
                <span className="sep" />
                <button type="button" className="btn btn-primary" onClick={() => s.setPlaying(!s.playing)} data-testid="play" aria-pressed={s.playing}>{s.playing ? 'Pause' : 'Play'}</button>
                <button type="button" className="btn" onClick={() => s.restart()} data-testid="restart">Restart</button>
                <label className="spd">Speed
                  <select value={s.speed} onChange={(e) => s.setSpeed(+e.target.value)} data-testid="speed" aria-label="Playback speed: milliseconds of signal per second">
                    {SPEEDS.map((v) => <option key={v} value={v}>{v} ms of signal / s</option>)}
                  </select>
                </label>
                <span className="row zoom" role="group" aria-label="Time zoom">
                  {ZOOMS.map((z) => <button key={z.id} type="button" className={`btn${s.zoom === z.id ? ' on' : ''}`} aria-pressed={s.zoom === z.id} onClick={() => s.setZoom(z.id)} data-testid={`zoom-${z.id}`}>{z.label}</button>)}
                </span>
              </div>
              <input className="scrub" type="range" min={0} max={p.durationMs} step={0.01} value={s.tMs} onChange={(e) => s.seek(+e.target.value)} aria-label="Timeline: signal time in milliseconds" data-testid="scrub" />
              <div className="clocks" data-testid="clocks">
                <span><span className="ck">Signal time</span> <span className="mono" data-testid="clock-t">{f(now.tMs, 2)} ms</span></span>
                <span><span className="ck">Sample index (chip timestamp)</span> <span className="mono" data-testid="clock-n">n = {now.n}</span>{now.sampleTimeMs !== null && <span className="muted"> taken at {f(now.sampleTimeMs, 3)} ms</span>}</span>
                <span><span className="ck">Playback</span> <span className="mono">{s.speed} ms/s</span> <span className="muted">(1 : {Math.round(1000 / s.speed)} slow motion — instructional only)</span></span>
                <span className="muted">Hardware clock cycles are not shown here; they are in the RTL traces under “Our chip”.</span>
              </div>
            </section>

            <section className="card waves" aria-label="Signals along the chain, on one time axis">
              <Wave title="1 · Membrane potential of the nearest neuron" unit="mV" data={r.analog.vmMv} rateHz={ANALOG_RATE_HZ} t0={t0} t1={t1} playheadMs={s.tMs} color="#B0532A" yRange={[-80, 40]}
                note="illustrative template — inside the cell; no electrode here measures it" dimmed={active('vm')} onSeek={s.seek} testId="wave-vm" valueDigits={1} />
              <Wave title="2 · Electrode − reference" unit="µV" data={r.analog.veUv} rateHz={ANALOG_RATE_HZ} t0={t0} t1={t1} playheadMs={s.tMs} color="#3B6FB6" markers={truthMarkers} bands={bands}
                note={`sum of ${p.units.length} neuron${p.units.length > 1 ? 's' : ''} + background + field potential; offset ${p.electrodeOffsetMv} mV not drawn; ticks = true spike times`} dimmed={active('ve')} onSeek={s.seek} testId="wave-ve" valueDigits={1} />
              <Wave title="4 · After the analogue front end" unit="mV" data={r.analog.afeV} scale={1000} rateHz={ANALOG_RATE_HZ} t0={t0} t1={t1} playheadMs={s.tMs} color="#7A4FB0"
                hlines={[{ value: p.swingV * 1000, color: '#B3261E', dashed: true, label: 'swing' }, { value: -p.swingV * 1000, color: '#B3261E', dashed: true }].filter(() => r.derived.afeClipFraction > 0)}
                note={`gain ${p.gain}, ${p.hpHz > 0 ? `${p.hpHz} Hz` : 'DC'}–${si(p.lpHz, 'Hz')}`} dimmed={active('afe')} onSeek={s.seek} testId="wave-afe" valueDigits={2} />
              <Wave title="6 · ADC codes" unit="codes" data={r.adc.code} rateHz={p.fsHz} t0={t0} t1={t1} playheadMs={s.tMs} color="#20272D" discrete
                note={`${p.bits}-bit two’s complement at ${si(p.fsHz, 'S/s')}; range ${-(2 ** (p.bits - 1))}…${2 ** (p.bits - 1) - 1}`} dimmed={active('adc')} onSeek={s.seek} testId="wave-adc" valueDigits={0} />
              <Wave title="7 · Chip, EVENT path: sample − baseline" unit="units" data={r.digital.residual} rateHz={p.fsHz} t0={t0} t1={t1} playheadMs={s.tMs} color="#8A6400" discrete markers={eventMarkers}
                hlines={thr > 0 ? [{ value: thr, color: '#8A6400', dashed: true, label: `threshold ±${thr}` }, { value: -thr, color: '#8A6400', dashed: true }] : []}
                note={thr > 0 ? '▼ = event fired (red ▼ = no true spike within ±1 ms)' : 'detector off (threshold 0)'} dimmed={active('digital')} onSeek={s.seek} testId="wave-residual" valueDigits={0} />
              <Wave title="7 · Chip, FEATURE path: band-pass output" unit="units" data={r.digital.y} rateHz={p.fsHz} t0={t0} t1={t1} playheadMs={s.tMs} color="#1E7D4A" discrete bars={energyBars} bands={bands}
                note={`band ${f(r.derived.featureBandHz[0], 0)}–${f(r.derived.featureBandHz[1], 0)} Hz at this sample rate`} dimmed={active('digital')} onSeek={s.seek} testId="wave-feature" valueDigits={0} />
              <Wave title="8 · Records leaving the chip: EVENT records" unit="" data={rasterData} rateHz={p.fsHz} t0={t0} t1={t1} playheadMs={s.tMs} color="#8A6400" discrete yRange={[-0.1, 1.3]} height={54} showTimeAxis
                note={`${r.digital.events.length} event records (${EVENT_PACKET_BITS} bits each) · ${r.digital.windows.length} FEATURE windows`} dimmed={active('output')} onSeek={s.seek} testId="wave-out" valueDigits={0} />
            </section>

            <section className="card nowcard" aria-label="Numbers at the playhead" data-testid="state-now">
              <h2>At the playhead</h2>
              <dl className="now">
                {([
                  ['Membrane potential', `${f(now.vmMv, 1)} mV`],
                  ['Electrode − reference', `${f(now.veUv, 1)} µV`],
                  ['Amplifier output', `${f(now.afeV * 1000, 2)} mV`],
                  ['Latest ADC code', `${now.code ?? '—'}${now.adcClipped ? ' (clamped)' : ''}`, 'now-code'],
                  ['16-bit sample to the chip', `${now.sample16 ?? '—'}`],
                  ['Baseline (u_baseline)', `${now.baseline ?? '—'}`],
                  ['Residual (sample − baseline)', `${now.residual ?? '—'}`],
                  ['Refractory counter', `${now.refractory ?? '—'}`],
                  ['Events so far', `${now.eventsSoFar}`, 'now-events'],
                  ['Last FEATURE energy', now.lastWindow ? now.lastWindow.energy.toLocaleString() : '—'],
                ] as Array<[string, string, string?]>).map(([k, v, id]) => (
                  <div key={k} className="now-item"><dt>{k}</dt><dd className="mono" data-testid={id}>{v}</dd></div>
                ))}
              </dl>
              <p className="muted">These values are recomputed from the model for the playhead time, so moving the timeline back and forth always gives the same numbers.</p>
            </section>

            <Consequences />
            <p className="jr-foot"><Cites ids={['buzsaki2012', 'henze2000', 'harrison2003', 'shannon1949', 'hbci-rtl']} /></p>
          </div>
        </div>
        <Predict
          task={ALIAS_TASK}
          onTry={() => { s.applyPreset('aliasing'); document.querySelector('[data-testid="signal-workspace"]')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
          result={s.result.derived.interferer ? <>Model: a {(s.result.derived.interferer.fHz / 1000).toFixed(0)} kHz tone sampled at {(s.result.params.fsHz / 1000).toFixed(0)} kS/s appears at {(s.result.derived.interferer.aliasHz / 1000).toFixed(1)} kHz{s.result.derived.interferer.aliased ? '' : ' (not aliased with the current settings)'}. Lower the low-pass corner in the controls and it fades.</> : <>Load the example to see the model’s numbers.</>}
        />
        <JourneyRail
          prev={{ to: 'interface', label: 'Back to the neuron and the contact', cue: '1 mm' }}
          next={{ to: 'chip', label: 'The samples enter our digital design', cue: 'bits → RTL' }}
        />
      </div>
    </div>
  );
}
