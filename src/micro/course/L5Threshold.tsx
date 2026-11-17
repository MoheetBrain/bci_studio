// Lesson 5 — Threshold + refractory. The DEMO event model (lab/model.ts) runs on the real ch5 input samples x from the
// RTL trace. Residual, baseline, armed and refractory are DEMO values (the v0.3 trace does not log them). At the chip's
// settings the DEMO events are compared one by one with the RTL EVENT run's ch5 records.
import { useMemo, useState } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import type { CoreConfig } from '../../lab/model';
import { channelSamples, compareEvents, rtlCoreConfig, rtlEventRecords, runEventsOnChannel, sameConfig, v02Check } from './data';
import { Callout, ChipLinks, Ev, Lead, Legend, LinePlot, Missing, Slider, Slower, Source, Widget, fmt, goChip } from './ui';

const CH = 5;

export function Lesson5({ step }: { step: number }) {
  const t = useArtifacts((s) => s.traceV03);
  const t02 = useArtifacts((s) => s.trace);
  const loaded = useArtifacts((s) => s.loaded);
  const rtlCfg: CoreConfig | null = t ? rtlCoreConfig(t) : null;
  const [thr, setThr] = useState<number | null>(null);
  const [refr, setRefr] = useState<number | null>(null);
  const [evPick, setEvPick] = useState(0);
  const cfg: CoreConfig | null = rtlCfg ? { ...rtlCfg, threshold: thr ?? rtlCfg.threshold, refractory: refr ?? rtlCfg.refractory } : null;

  const run = useMemo(() => (t && cfg ? runEventsOnChannel(t, CH, cfg) : null), [t, cfg?.threshold, cfg?.refractory]); // eslint-disable-line react-hooks/exhaustive-deps
  const rtlRec = useMemo(() => (t ? rtlEventRecords(t, CH) : []), [t]);
  const cmp = run ? compareEvents(run.events, rtlRec) : null;
  const atChip = !!(cfg && rtlCfg && sameConfig(cfg, rtlCfg));
  const truth = useMemo(() => (t ? t.ground_truth.spikes.filter((s) => s.ch === CH) : []), [t]);
  const v02 = useMemo(() => (t02 ? v02Check(t02) : null), [t02]);

  if (!t || !run || !cfg || !rtlCfg) return <div key={step}>{loaded ? <Missing what="rtl_trace_v03.json" /> : <p className="c-hint">Loading the RTL trace…</p>}</div>;
  const row = channelSamples(t, CH);
  const kOf = (i: number) => Math.round((i - CH) / 8);
  const xs = row.map((s) => s.x);
  const base = run.steps.map((s) => s.baseInt);
  const res = run.steps.map((s) => s.res);
  const evK = run.events.map((e) => kOf(e.i));
  const truthMarks = truth.map((s) => ({ at: kOf(s.i), y: 0, color: 'var(--fg-tertiary)', shape: 'tick' as const }));
  const desc = t.ground_truth.channels.find((c) => c.ch === CH)?.description;

  const sliders = (
    <>
      <Slider id="c5-thr" label="Threshold" value={cfg.threshold} min={100} max={2500} step={10} onChange={setThr} />
      <Slider id="c5-refr" label="Refractory (samples)" value={cfg.refractory} min={0} max={40} onChange={setRefr} />
      {!atChip && <button className="btn sm" onClick={() => { setThr(null); setRefr(null); }}>Back to the chip's settings ({rtlCfg.threshold} / {rtlCfg.refractory})</button>}
    </>
  );

  const verdict = atChip ? (
    <Callout tone={cmp?.allMatch ? 'ok' : 'warn'}>
      <Ev e="DEMO" /> {fmt(cmp!.demo)} events vs <Ev e="RTL" /> {fmt(cmp!.rtl)} EVENT records for channel {CH} at the chip's settings (threshold {rtlCfg.threshold}, hysteresis {rtlCfg.hysteresis}, refractory {rtlCfg.refractory}, alpha_shift {rtlCfg.alphaShift}).
      {cmp!.allMatch ? ' Same sample numbers, same polarity and magnitude: ✓ they match.' : ' They do NOT match.'}
    </Callout>
  ) : (
    <Callout tone="warn">
      <Ev e="DEMO" /> {fmt(run.events.length)} events. These settings differ from the RTL run (threshold {rtlCfg.threshold}, refractory {rtlCfg.refractory}), so there is <b>no RTL result to compare with</b>: this is the browser model only.
    </Callout>
  );

  if (step === 0) {
    return (
      <div key={0}>
        <Lead>The event detector follows each channel's slow background level, the <b>baseline</b>, and measures how far every new sample sits from it: the <b>residual</b>. A spike is a residual that is suddenly large.</Lead>
        <Widget ev="DEMO" label={`Channel ${CH}: input and baseline`} testId="course-baseline">
          <LinePlot
            ariaLabel={`Channel ${CH} input from the RTL trace and the DEMO baseline`}
            series={[{ data: xs, color: 'var(--ch5)', label: 'x' }, { data: base, color: 'var(--copper)', label: 'baseline', width: 2 }]}
            marks={truthMarks} height={150} xLabel={`sample of channel ${CH} (0–${row.length - 1})`}
          />
          <Legend items={[{ color: 'var(--ch5)', label: 'input x (RTL)' }, { color: 'var(--copper)', label: 'baseline (DEMO)' }, { color: 'var(--fg-tertiary)', label: 'injected spike (ground truth)', dot: true }]} />
          <p className="c-note">{desc}.</p>
        </Widget>
        <Slower>
          <p>Electrodes pick up slow drifts as well as fast spikes. Comparing raw samples with a fixed level would mistake a drift for an event, so the chip first subtracts a running average: the baseline.</p>
          <p>The baseline moves 1/32 of the way towards each new sample (<span className="mono">alpha_shift = 5</span>, 2⁵ = 32). Slow changes are followed; a spike lasting a few samples barely moves it, so the spike stands out in the residual.</p>
        </Slower>
        <Source>
          <p className="c-src-note">The input x is the RTL trace's ch {CH} samples. The baseline is computed in the browser by the DEMO port of this module (the v0.3 trace does not log it).</p>
          <SourceView module="hbci_baseline_ema" highlightLines={new Set([235, 240, 241, 247, 251, 254])} maxHeight={200} />
        </Source>
      </div>
    );
  }

  if (step === 1) {
    const bands = run.events.map((e) => ({ from: kOf(e.i), to: kOf(e.i) + cfg.refractory, color: 'var(--mode-event)' }));
    const lim = Math.max(cfg.threshold * 1.4, ...res.map(Math.abs));
    return (
      <div key={1}>
        <Lead>An event fires when the residual's size reaches the <b>threshold</b>. Then the channel pauses for a <b>refractory</b> number of its own samples, so one spike is not reported many times. Move the sliders.</Lead>
        <Widget ev="DEMO" label={`Channel ${CH}: residual vs threshold`} testId="course-threshold">
          {sliders}
          <LinePlot
            ariaLabel={`Residual of channel ${CH} with threshold lines and ${run.events.length} events`}
            series={[{ data: res, color: 'var(--ch5)', label: 'residual' }]}
            hlines={[{ y: cfg.threshold, color: 'var(--mode-event)', label: '+threshold' }, { y: -cfg.threshold, color: 'var(--mode-event)', label: '−threshold' }]}
            bands={bands}
            marks={[...evK.map((k, n) => ({ at: k, y: res[k], color: 'var(--danger)', label: `event ${n}` })), ...truthMarks]}
            yMin={-lim} yMax={lim} height={160} xLabel={`sample of channel ${CH}`}
          />
          <Legend items={[{ color: 'var(--ch5)', label: 'residual (DEMO)' }, { color: 'var(--mode-event)', label: '± threshold', dash: true }, { color: 'var(--danger)', label: 'event', dot: true }, { color: 'var(--mode-event)', label: 'refractory pause' }]} />
          <p className="c-note"><b>{fmt(run.events.length)}</b> events; {truth.length} spikes were injected into this channel.</p>
        </Widget>
        {verdict}
        <Slower>
          <p>"Size" means the magnitude, ignoring the sign: a spike dipping down by 900 counts the same as one rising by 900. The record keeps the sign separately as the polarity bit.</p>
          <p>After an event the channel is also <i>disarmed</i> until the residual falls back below threshold − hysteresis ({cfg.threshold} − {cfg.hysteresis} = {Math.max(1, cfg.threshold - cfg.hysteresis)}). Refractory and hysteresis together stop one wobbly spike from counting twice.</p>
          <p>Too low a threshold and noise fires events; too high and small spikes are missed. Channel 5 is quiet, so the chip's setting finds every injected spike here. Channel 4 carries only loud noise and no spikes, yet in the RTL EVENT run the same setting fires there <b>{fmt(rtlEventRecords(t, 4).length)}</b> times <Ev e="RTL" />.</p>
        </Slower>
        <Source>
          <p className="c-src-note">The fire rule (<span className="mono">hbci_refractory_ctrl</span>):</p>
          <SourceView module="hbci_refractory_ctrl" highlightLines={new Set([309, 310, 311, 312, 313, 314])} maxHeight={170} />
          {v02 && (
            <p className="c-src-note">
              Is the DEMO model trustworthy? Re-run live on the v0.2 RTL trace (rtl_trace.json): <b>{fmt(v02.agree)} / {fmt(v02.total)}</b> samples agree on baseline, residual, armed, refractory count and fire; DEMO {v02.demoEvents} events vs RTL {v02.rtlEvents}.
            </p>
          )}
        </Source>
        <ChipLinks links={[{ label: 'Show the threshold comparator', go: () => goChip('rtl.u_threshold', 'die') }, { label: 'Show the re-trigger guard', go: () => goChip('rtl.u_refractory', 'die') }]} />
      </div>
    );
  }

  // step 2: one spike, sample by sample
  const ne = run.events.length;
  const pick = ne ? Math.min(evPick, ne - 1) : 0;
  const ev = ne ? run.events[pick] : null;
  const k0 = ev ? kOf(ev.i) : 0;
  const from = Math.max(0, k0 - 2);
  const to = Math.min(row.length - 1, k0 + Math.min(cfg.refractory, 10) + 2);
  const win = run.steps.slice(from, to + 1);
  return (
    <div key={2}>
      <Lead>Zoom in on one event. Watch the refractory counter: the event sets it to {cfg.refractory}, then it counts down by one at each of this channel's samples. Only at 0 (and when re-armed) can the channel fire again.</Lead>
      <Widget ev="DEMO" label={`Channel ${CH}: one event, sample by sample`} testId="course-spike">
        {sliders}
        {!ev ? <p className="c-note">No events at these settings. Lower the threshold.</p> : (
          <>
            <div className="c-row">
              <button className="btn sm" disabled={pick === 0} onClick={() => setEvPick(pick - 1)}>‹ Previous event</button>
              <span className="c-hint">event {pick + 1} of {ne}</span>
              <button className="btn sm" disabled={pick >= ne - 1} onClick={() => setEvPick(pick + 1)}>Next event ›</button>
            </div>
            <table className="c-table c-spike">
              <thead><tr><th>#</th><th className="r">x</th><th className="r">residual</th><th>≥ thr?</th><th>armed</th><th className="r">refr</th><th>fire</th></tr></thead>
              <tbody>
                {win.map((s) => (
                  <tr key={s.i} className={s.fire ? 'c-selrow' : undefined}>
                    <td className="mono">{s.i}</td>
                    <td className="mono r">{fmt(s.x)}</td>
                    <td className="mono r">{fmt(s.res)}</td>
                    <td>{s.above ? 'yes' : 'no'}</td>
                    <td>{s.armed}</td>
                    <td className="mono r">{s.refr}</td>
                    <td>{s.fire ? <b>EVENT</b> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="c-note"><b>x</b> comes from the RTL trace; residual, armed and refr are the DEMO model's values <i>before</i> each sample's update (the v0.3 trace does not log them).</p>
            {atChip && (() => {
              const r = rtlRec.find((q) => q.ts === ev.i);
              return r ? <p className="c-note"><Ev e="RTL" /> The RTL EVENT run has a record for sample #{r.ts}: seq {r.seq}, polarity {(r.data >>> 16) & 1 ? 'negative' : 'positive'}, magnitude {fmt(r.data & 0xffff)}.</p> : <p className="c-note">No RTL record at this sample.</p>;
            })()}
          </>
        )}
      </Widget>
      <Slower>
        <p>Each row is one sample of channel 5 (the numbers jump by 8 because the other 7 channels are in between). The event fires on the first sample whose residual is big enough, which can be a sample before the spike's deepest point.</p>
        <p>Right after the event, "armed" drops to 0 and "refr" starts counting down. Even if the residual stays large for a sample or two, nothing fires.</p>
      </Slower>
      <Source>
        <SourceView module="hbci_threshold_detector" highlightLines={new Set([281, 282, 284, 285, 286])} maxHeight={170} />
      </Source>
    </div>
  );
}

export const LESSON5 = {
  id: 'threshold',
  title: 'Threshold + refractory',
  steps: ['Baseline and residual', 'Threshold and pause', 'One spike, sample by sample'],
  Body: Lesson5,
  check: {
    q: 'You raise the threshold. What happens to the number of events?',
    options: [
      { text: 'It goes down (or stays the same)', correct: true, why: 'Right. Fewer residuals are big enough, so small spikes and noise stop firing.' },
      { text: 'It goes up', why: 'A higher bar is harder to reach, so fewer samples fire.' },
      { text: 'It does not depend on the threshold', why: 'Try the slider: above about 1,000 the smaller spikes on channel 5 are missed.' },
    ],
  },
};
