// Neurons: beneath the selected region, at the scale of cells. A schematic patch of cortex in 3D, one neuron driven
// by the Hodgkin–Huxley membrane model, and one electrode contact listening from a set distance.
//
// What is what (also said in the UI):
//   • cell shapes and positions — a drawing; the MRI atlas has no cellular data and nothing was "zoomed into";
//   • the membrane potential — computed from the published Hodgkin–Huxley equations (squid axon, not human cortex);
//   • the contact's voltage — a stated teaching rule (1 / distance) plus fixed-seed noise.
import { useEffect, useMemo, useState } from 'react';
import { useAtlas } from '../atlas/atlasStore';
import { Wave } from '../journey/Wave';
import { ClaimList, EvidenceTag } from '../science/Cite';
import type { Claim } from '../atlas/content/regions';
import { JourneyRail, LevelSwitch, Predict, Transport, useLevel, useTimeline, type PredictTask } from '../kit/kit';
import { firingRateHz, HH, HH_LIMITS, isSustained, sampleAt, simulateHH } from './model/hh';
import { buildColumn, DEFAULT_COLUMN, DISTANCE_LIMITS_UM, NOISE_RMS_UV, REF_AMP_UV, REF_DIST_UM, type ColumnParams } from './model/column';
import { NeuronStage } from './NeuronStage';
import './neuro.css';

const CLAIMS: Claim[] = [
  { text: 'The membrane potential shown is the Hodgkin–Huxley model: sodium, potassium and leak conductances fitted to the squid giant axon at 6.3 °C. It is integrated exactly as published; it is not a model of a human cortical neuron and not a recording.', kind: 'assumption', sources: ['hodgkin1952'] },
  { text: 'Neuronal activity gives rise to transmembrane currents that can be measured in the fluid outside the cells. Synaptic currents are the major contributor to that extracellular signal; action potentials and other membrane events add to it.', kind: 'background', sources: ['buzsaki2012'] },
  { text: 'The size of the first, negative phase of the extracellular spike follows the size of the neuron’s intracellular action potential — the electrode sees a small, inverted, sharpened shadow of it, not the membrane potential itself.', kind: 'background', sources: ['henze2000'] },
  { text: 'A recording site does not listen to one neuron. For a tetrode in rat hippocampus, roughly a thousand neurons lie within range and 60–100 should be large enough to tell apart in principle, yet about six are usually isolated.', kind: 'background', sources: ['henze2000'] },
  { text: 'Intracortical arrays intended for brain–computer interfaces record from small populations of neurons rather than single units, with an average signal-to-noise ratio around 6 : 1 reported for one array design.', kind: 'background', sources: ['maynard1997'] },
  { text: `In this scene a spike’s size at the contact is ${REF_AMP_UV} µV × (${REF_DIST_UM} µm ÷ distance), its shape is the negative of the membrane potential’s rate of change, and the noise is a fixed ${NOISE_RMS_UV} µV rms. Those are teaching rules, not measurements of this (or any) brain.`, kind: 'assumption', sources: [] },
  { text: 'The cell shapes, their positions, the neighbours’ spike times and the electrode position are invented for the drawing. Nothing here is a placement recommendation, and the atlas contains no cellular data.', kind: 'assumption', sources: [] },
];

const SPEEDS = [
  { value: 1, label: '1000× slower' },
  { value: 4, label: '250× slower' },
  { value: 20, label: '50× slower' },
];

const TASK: PredictTask = {
  id: 'all-or-nothing',
  question: 'The neuron is firing with 10 µA/cm² of current pushed into it. You double the current to 20. What happens to its spikes?',
  options: [
    { id: 'taller', label: 'Each spike gets about twice as tall' },
    { id: 'more', label: 'They come more often, at about the same height' },
    { id: 'both', label: 'Both: taller and more often' },
  ],
  correct: 'more',
  explain: 'In this model a spike is all-or-nothing. Once the membrane crosses threshold, the sodium and potassium gates run nearly the same course whatever started it, so extra drive shortens the wait between spikes instead of enlarging them.',
  wrong: {
    taller: 'Spike height is set by the channels and the ion gradients, not by how hard the cell is pushed.',
    both: 'Only the timing changes much. The first spike is as tall as before, and the ones that follow are slightly smaller, because the sodium gates have less time to recover between them.',
  },
  tryLabel: 'Double the current',
};

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export default function InterfaceWorkspace() {
  const regionName = useAtlas((s) => s.nameOf(s.selectedId));
  const tissue = useAtlas((s) => (s.selectedId ? s.structures.get(s.selectedId)?.tissue : undefined));
  const level = useLevel((s) => s.level);
  const [params, setParams] = useState<ColumnParams>(DEFAULT_COLUMN);
  const col = useMemo(() => buildColumn(params), [params]);
  const T = col.params.durationMs;
  const tl = useTimeline(T, 4);
  const [zoom, setZoom] = useState<'all' | 'spike'>('all');

  // start moving on arrival, unless the visitor prefers stillness
  useEffect(() => {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) tl.setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = tl.t;
  const [t0, t1] = zoom === 'all' ? [0, T] : [Math.max(0, Math.min(T - 10, t - 4)), Math.max(10, Math.min(T, t + 6))];
  const rateHz = col.perMs * 1000;
  const spikes = col.hh.spikesMs.map((ts) => ({ tMs: ts, kind: 'triangle' as const, color: '#FFB45C' }));
  const vm = sampleAt(col.hh.v, col.perMs, t), ve = sampleAt(col.electrodeUv, col.perMs, t);
  const rate = firingRateHz(col.hh);

  // the prediction's check, computed from the same model the scene runs
  const check = useMemo(() => {
    const run = (I: number) => {
      const r = simulateHH({ currentUaCm2: I, onMs: 10, offMs: 185, durationMs: 200 });
      // peak of each spike: the maximum within 3 ms of its upward zero crossing
      const peaks = r.spikesMs.map((ts) => { let p = -Infinity; for (let k = Math.floor(ts * r.perMs), end = Math.min(r.v.length, k + 3 * r.perMs); k < end; k++) p = Math.max(p, r.v[k]); return p; });
      return { rate: firingRateHz(r), first: peaks[0] ?? NaN, later: peaks[peaks.length - 1] ?? NaN };
    };
    return { lo: run(10), hi: run(20) };
  }, []);

  const cortical = tissue === 'cortex';
  const place = regionName ? (cortical ? `Beneath the ${regionName}` : `Cells like those near the ${regionName}`) : 'Beneath the surface';
  const set = (over: Partial<ColumnParams>) => setParams((p) => ({ ...p, ...over }));

  return (
    <div className="scene cine" data-testid="interface-workspace">
      <div className="scene-stage">
        <div className="scene-grid" aria-hidden="true" />
        <NeuronStage col={col} now={tl.now} playing={tl.playing} labels={level === 'intuitive'} />
        <header className="scene-head">
          <div className="scene-kicker">
            <span>Neurons · about 1 mm across</span>
            <EvidenceTag kind="schematic" title="The cell shapes are a drawing. The membrane potential is computed from a published model. Nothing here was measured from this brain." />
          </div>
          <h1 data-testid="interface-title">{place}</h1>
          <p>
            {level === 'intuitive' && <>You are now about 150 times closer than the whole-brain view. One neuron fires; a metal contact {Math.round(col.params.distanceUm)} µm away hears a faint, upside-down echo of each spike.</>}
            {level === 'math' && <>The warm cell follows the Hodgkin–Huxley equations. The contact’s voltage is a stated rule: proportional to −dV/dt, and to 1 / distance.</>}
            {level === 'engineering' && <>Inside the cell the swing is about 100 mV. At the contact it is {fmt(col.focusAmplitudeUv, 0)} µV on {NOISE_RMS_UV} µV rms of noise — a ratio of {fmt(col.snr, 1)} : 1. That is the signal the electronics get.</>}
          </p>
        </header>
        <p className="scene-caption" data-testid="interface-caption">
          {vm > -20
            ? <><strong>Spike.</strong> Sodium rushes in and the inside swings positive; the contact dips at the same instant.</>
            : vm < -67
              ? <><strong>Recovery.</strong> Potassium flows out and the membrane overshoots below rest before the next spike can start.</>
              : <><strong>Charging.</strong> The injected current pushes the membrane up from rest towards threshold.</>}
          {' '}The drawing is schematic; the atlas holds no cells.
        </p>
        <div className="scene-foot">
          <Transport tl={tl} duration={T} speeds={SPEEDS} step={0.02} label="Neuron timeline" clock="Model time (milliseconds of biology), not wall-clock time" format={(x) => `${x.toFixed(2)} ms`} />
          <JourneyRail
            prev={{ to: 'brain', label: 'Back to the whole brain', cue: '≈150× wider' }}
            next={{ to: 'signal', label: 'Follow the contact’s voltage into the amplifier', cue: 'µV → bits' }}
          />
        </div>
      </div>

      <aside className="scene-side" aria-label="Plots and controls">
        <LevelSwitch />

        <section className="panel">
          <h2>Inside the neuron <EvidenceTag kind="synthetic" title="Computed from the Hodgkin–Huxley equations; not a recording." /></h2>
          <Wave title="Membrane potential" unit="mV" data={col.hh.v} rateHz={rateHz} t0={t0} t1={t1} playheadMs={t} color="#FFB45C" height={104} yRange={[-90, 55]}
            hlines={[{ value: HH.rest, color: 'rgba(255,255,255,0.25)', label: 'rest', dashed: true }]} markers={spikes} onSeek={tl.seek} testId="wave-vm" valueDigits={1} />
          {level === 'math' && (
            <>
              <Wave title="m — sodium opens" unit="" data={col.hh.m} rateHz={rateHz} t0={t0} t1={t1} playheadMs={t} color="#FF8FA3" height={44} yRange={[0, 1]} onSeek={tl.seek} testId="wave-m" />
              <Wave title="h — sodium stays available" unit="" data={col.hh.h} rateHz={rateHz} t0={t0} t1={t1} playheadMs={t} color="#C6A6FF" height={44} yRange={[0, 1]} onSeek={tl.seek} testId="wave-h" />
              <Wave title="n — potassium opens" unit="" data={col.hh.n} rateHz={rateHz} t0={t0} t1={t1} playheadMs={t} color="#8DB8FF" height={44} yRange={[0, 1]} onSeek={tl.seek} testId="wave-n" />
              <div className="eq" data-testid="hh-equations">{`C dV/dt = I − gNa·m³h·(V − ENa) − gK·n⁴·(V − EK) − gL·(V − EL)
dx/dt   = αx(V)·(1 − x) − βx(V)·x        x ∈ {m, h, n}
C = ${HH.C} µF/cm²   gNa = ${HH.gNa}   gK = ${HH.gK}   gL = ${HH.gL} mS/cm²
ENa = ${HH.ENa}   EK = ${HH.EK}   EL = ${HH.EL} mV`}</div>
            </>
          )}
          <h2>At the contact, <span className="nocase">{Math.round(col.params.distanceUm)} µm</span> away <EvidenceTag kind="synthetic" title="A teaching rule (1 / distance) plus fixed-seed noise; not a recording." /></h2>
          <Wave title="Contact voltage" unit="µV" data={col.electrodeUv} rateHz={rateHz} t0={t0} t1={t1} playheadMs={t} color="#7FE7FF" height={104}
            hlines={[{ value: -col.focusAmplitudeUv, color: 'rgba(127,231,255,0.45)', label: 'this neuron’s spike', dashed: true }]} markers={spikes} onSeek={tl.seek} showTimeAxis testId="wave-ve" valueDigits={0} />
          {level === 'math' && <div className="eq">{`V_contact(t) ≈ −k·dV/dt + neighbours + noise
k chosen so the spike is ${REF_AMP_UV} µV × (${REF_DIST_UM} µm / d)   →  ${fmt(col.focusAmplitudeUv, 1)} µV at d = ${Math.round(col.params.distanceUm)} µm`}</div>}
          <div className="row-between">
            <span className="small">Smaller ticks in the lower trace are neighbouring cells. Click a plot to move the playhead.</span>
            <div className="seg" role="group" aria-label="Time window">
              <button type="button" className={`seg-btn${zoom === 'all' ? ' on' : ''}`} aria-pressed={zoom === 'all'} onClick={() => setZoom('all')} data-testid="zoom-all">All</button>
              <button type="button" className={`seg-btn${zoom === 'spike' ? ' on' : ''}`} aria-pressed={zoom === 'spike'} onClick={() => setZoom('spike')} data-testid="zoom-spike">10 ms</button>
            </div>
          </div>
        </section>

        <section className="panel" aria-label="Change a variable">
          <h2>Change something</h2>
          <div className="knob">
            <label htmlFor="k-current">Current pushed into the neuron</label>
            <output data-testid="current-out">{fmt(col.params.currentUaCm2, 1)} µA/cm²</output>
            <input id="k-current" type="range" min={HH_LIMITS.currentUaCm2[0]} max={20} step={0.5} value={params.currentUaCm2} onChange={(e) => set({ currentUaCm2: +e.target.value })} data-testid="knob-current" />
            <span className="small" data-testid="firing-note">{col.hh.spikesMs.length === 0 ? 'Too little to reach threshold: no spikes.' : isSustained(col.hh) ? `Fires ${fmt(rate, 0)} times a second while the current is on.` : `${col.hh.spikesMs.length === 1 ? 'One spike' : `${col.hh.spikesMs.length} spikes`}, then it settles: not enough to keep firing.`}</span>
          </div>
          <div className="knob">
            <label htmlFor="k-distance">Distance from neuron to contact</label>
            <output data-testid="distance-out">{Math.round(col.params.distanceUm)} µm</output>
            <input id="k-distance" type="range" min={DISTANCE_LIMITS_UM[0]} max={DISTANCE_LIMITS_UM[1]} step={5} value={params.distanceUm} onChange={(e) => set({ distanceUm: +e.target.value })} data-testid="knob-distance" />
            <span className="small">The neuron’s spike at the contact: <strong data-testid="amp-out">{fmt(col.focusAmplitudeUv, 0)} µV</strong> ({fmt(col.snr, 1)} × the noise). The neuron itself does not change.</span>
          </div>
          {level !== 'intuitive' && (
            <dl className="readouts" data-testid="neuron-readouts">
              <div><dt>V membrane</dt><dd>{fmt(vm, 1)} <small>mV</small></dd></div>
              <div><dt>V contact</dt><dd>{fmt(ve, 0)} <small>µV</small></dd></div>
              <div><dt>m · h · n</dt><dd>{fmt(sampleAt(col.hh.m, col.perMs, t), 2)} · {fmt(sampleAt(col.hh.h, col.perMs, t), 2)} · {fmt(sampleAt(col.hh.n, col.perMs, t), 2)}</dd></div>
              <div><dt>I sodium</dt><dd>{fmt(sampleAt(col.hh.iNa, col.perMs, t), 0)} <small>µA/cm²</small></dd></div>
              <div><dt>I potassium</dt><dd>{fmt(sampleAt(col.hh.iK, col.perMs, t), 0)} <small>µA/cm²</small></dd></div>
              <div><dt>Firing rate</dt><dd>{isSustained(col.hh) ? fmt(rate, 0) : '—'} <small>/s</small></dd></div>
              {level === 'engineering' && <div><dt>Inside ÷ outside</dt><dd>≈ {fmt(100000 / Math.max(1, col.focusAmplitudeUv), 0)} <small>×</small></dd></div>}
              {level === 'engineering' && <div><dt>Noise (stated)</dt><dd>{NOISE_RMS_UV} <small>µV rms</small></dd></div>}
            </dl>
          )}
          {level === 'engineering' && <p className="small">What this hands to the electronics: tens of microvolts, lasting about a millisecond, next to neighbours and noise of similar size. The next scene amplifies, filters and digitises it.</p>}
        </section>

        <Predict
          task={TASK}
          onTry={() => { set({ currentUaCm2: 20 }); tl.seek(0); tl.setPlaying(true); }}
          result={<>Model, 10 → 20 µA/cm²: rate {fmt(check.lo.rate, 0)} → {fmt(check.hi.rate, 0)} spikes a second. The first spike peaks at {fmt(check.lo.first, 0)} → {fmt(check.hi.first, 0)} mV; later ones at {fmt(check.lo.later, 0)} → {fmt(check.hi.later, 0)} mV.</>}
        />

        <section className="panel">
          <details data-testid="interface-evidence">
            <summary>What is real here, and what is a drawing</summary>
            <ClaimList claims={CLAIMS} />
          </details>
        </section>
      </aside>
    </div>
  );
}
