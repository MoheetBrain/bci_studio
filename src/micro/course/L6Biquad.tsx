// Lesson 6 — Biquad + energy. A DEMO sine (10 / 100 / 300 Hz) runs through the DEMO feature path (bit-accurate port,
// verified 4000/4000 against the RTL) with the real coefficients. The weighted sum is shown with actual numbers.
// RTL anchor: mean FEATURE energy per channel from the RTL FEATURE run.
import { useMemo, useState } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { DEFAULT_FEATURE, FS } from '../../lab/featureModel';
import { FEATURE } from '../../model/system';
import { rtlFeatureConfig, rtlFeatureEnergy, runFeatureDemo, sineInput } from './data';
import { Callout, ChipLinks, Ev, Lead, Legend, LinePlot, Seg, Slider, Slower, Source, Widget, chColor, fmt, goChip } from './ui';

const N = 256;
type F = 10 | 100 | 300;

const sgn = (v: number) => (v < 0 ? `(${fmt(v)})` : fmt(v));

export function Lesson6({ step }: { step: number }) {
  const t = useArtifacts((s) => s.traceV03);
  const [f, setF] = useState<F>(100);
  const [amp, setAmp] = useState(3000);
  const [n, setN] = useState(43);
  const cfg = t ? rtlFeatureConfig(t) : DEFAULT_FEATURE;
  const run = useMemo(() => runFeatureDemo(sineInput(f, amp, N, FS), cfg), [f, amp, cfg.b0, cfg.b1, cfg.b2, cfg.a1, cfg.a2, cfg.winLog2, cfg.energyShift]); // eslint-disable-line react-hooks/exhaustive-deps
  const win = 1 << cfg.winLog2;
  const resp = FEATURE.measured_response_of_quantised_coefficients;

  const controls = (
    <>
      <Seg label="Input" value={f} onChange={setF} options={[{ v: 10 as F, label: '10 Hz' }, { v: 100 as F, label: '100 Hz' }, { v: 300 as F, label: '300 Hz' }]} />
      <Slider id="c6-amp" label="Amplitude" value={amp} min={500} max={16000} step={100} onChange={setAmp} />
    </>
  );
  const coefNote = (
    <p className="c-note">Coefficients <span className="mono">b0 {cfg.b0}, b1 {cfg.b1}, b2 {cfg.b2}, a1 {cfg.a1}, a2 {cfg.a2}</span> {t ? <>are the chip's configuration in the RTL run <Ev e="RTL" /></> : '(hbci_system.json defaults)'}. Input: a {f} Hz sine at {fmt(FS)} samples per second <Ev e="DEMO" />.</p>
  );

  if (step === 0) {
    const s = run[Math.min(n, N - 1)];
    const terms = [cfg.b0 * s.x, cfg.b1 * s.x1, cfg.b2 * s.x2, -cfg.a1 * s.y1, -cfg.a2 * s.y2].map((v) => v + 0); // + 0 turns -0 into 0
    return (
      <div key={0}>
        <Lead>The band-pass filter keeps roughly 70–150 Hz. For every sample it multiplies five numbers by five fixed <b>weights</b> (coefficients) and adds them up, then rounds. That is the whole filter.</Lead>
        <Widget ev="DEMO" label="One sample through the filter, with real numbers" testId="course-formula">
          {controls}
          <Slider id="c6-n" label="Sample" value={n} min={0} max={N - 1} onChange={setN} />
          <LinePlot ariaLabel="Input sine with the chosen sample marked" series={[{ data: run.map((r) => r.x), color: 'var(--ch1)', label: 'x' }]} cursor={n} height={80} />
          <div className="c-formula mono" aria-label="Weighted sum with numbers">
            <div>p = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2</div>
            <div>= {cfg.b0}·{sgn(s.x)} + {cfg.b1}·{sgn(s.x1)} + {sgn(cfg.b2)}·{sgn(s.x2)} − {sgn(cfg.a1)}·{sgn(s.y1)} − {cfg.a2}·{sgn(s.y2)}</div>
            <div>= {terms.map((v, k) => (k === 0 ? fmt(v) : v < 0 ? ` − ${fmt(-v)}` : ` + ${fmt(v)}`)).join('')}</div>
            <div>= <b>{fmt(s.p)}</b></div>
            <div className="c-formula-gap">y = sat16((p + 8192) &gt;&gt;&gt; 14)</div>
            <div>= sat16(⌊{fmt(s.p + 8192)} / 16,384⌋) = <b>{fmt(s.y)}</b>{s.ysat ? ' (saturated)' : ''}</div>
          </div>
          {coefNote}
        </Widget>
        <Callout>Multiply, then add, many times: the same <b>multiply-accumulate</b> idea that AI chips repeat billions of times. But this is a 5-weight filter for one band, not an LLM accelerator.</Callout>
        <Slower>
          <p><b>x</b> is the new input sample; <b>x1, x2</b> are this channel's previous two inputs and <b>y1, y2</b> its previous two outputs (the per-channel memory from lesson 4). Using its own past outputs is what makes the filter "ring" at its favourite frequency and ignore others.</p>
          <p>The weights are whole numbers that stand for fractions: divide by 16,384 (2¹⁴). So b0 = {cfg.b0} means about {(cfg.b0 / 16384).toFixed(3)}, a1 = {cfg.a1} about {(cfg.a1 / 16384).toFixed(3)}. Adding 8,192 and then shifting right by 14 bits divides by 16,384 and rounds to the nearest whole number.</p>
          <p><i>sat16</i> clamps the result to the 16-bit range (−32,768 … 32,767) instead of letting it wrap around; the <span className="mono">ysat</span> flag records when that happened.</p>
        </Slower>
        <Source>
          <SourceView module="hbci_biquad" highlightLines={new Set([341, 342, 343, 344, 345, 346, 352, 354, 361])} maxHeight={220} />
        </Source>
        <ChipLinks links={[{ label: 'Show the filter on the die', go: () => goChip('rtl.u_biquad', 'die') }]} />
      </div>
    );
  }

  const settled = run.slice(128);
  const gain = Math.max(...settled.map((r) => Math.abs(r.y))) / Math.max(1, Math.max(...settled.map((r) => Math.abs(r.x))));
  const db = 20 * Math.log10(Math.max(1e-6, gain));

  if (step === 1) {
    const lim = Math.max(amp, ...run.map((r) => Math.abs(r.y))) * 1.05;
    return (
      <div key={1}>
        <Lead>Feed the filter three different tones. 100 Hz is inside the band and passes almost unchanged; 10 Hz and 300 Hz are outside and come out much smaller.</Lead>
        <Widget ev="DEMO" label="Input x and filter output y" testId="course-filter">
          {controls}
          <LinePlot
            ariaLabel={`${f} hertz input and filter output`}
            series={[{ data: run.map((r) => r.x), color: 'var(--fg-tertiary)', label: 'x' }, { data: run.map((r) => r.y), color: 'var(--mode-feature)', label: 'y', width: 1.8 }]}
            yMin={-lim} yMax={lim} height={150} xLabel={`${N} samples = ${(1000 * N / FS).toFixed(0)} ms`}
          />
          <Legend items={[{ color: 'var(--fg-tertiary)', label: 'input x' }, { color: 'var(--mode-feature)', label: 'output y' }]} />
          <p className="c-note">After it settles (second half), the output is about <b>{gain.toFixed(2)}×</b> the input ({db.toFixed(1)} dB) <Ev e="DEMO" />.</p>
          {coefNote}
        </Widget>
        <table className="c-table">
          <caption>Measured response of the chip's rounded coefficients (hbci_system.json)</caption>
          <tbody>
            <tr><td>10 Hz</td><td className="mono r">{resp['10_hz_db']} dB</td><td>70 Hz</td><td className="mono r">{resp['70_hz_db']} dB</td></tr>
            <tr><td>102.5 Hz</td><td className="mono r">{resp['102_5_hz_db']} dB</td><td>150 Hz</td><td className="mono r">{resp['150_hz_db']} dB</td></tr>
            <tr><td>300 Hz</td><td className="mono r">{resp['300_hz_db']} dB</td><td colSpan={2} className="faint">{resp.note}</td></tr>
          </tbody>
        </table>
        <Slower>
          <p>Decibels (dB) compare sizes: 0 dB = unchanged, −6 dB ≈ half, −20 dB = one tenth. So 10 Hz shrinks to less than a tenth, 300 Hz to about a quarter, and 100 Hz passes.</p>
          <p>The first few dozen samples look different because the filter starts from an empty memory (all zeros) and needs a moment to "ring up". That start-up is real: the chip does the same after reset.</p>
          <p>Push the amplitude to the top at 100 Hz: the output can exceed the 16-bit range and gets clamped (saturated).</p>
        </Slower>
      </div>
    );
  }

  // step 2: energy windows
  const ends = run.filter((r) => r.done);
  const rtlE = t ? rtlFeatureEnergy(t) : null;
  const show = [0, 1, 2, 6];
  return (
    <div key={2}>
      <Lead>To summarise a band, the chip squares each output (y², always positive) and adds them up over a <b>window</b> of {win} samples of the channel. At the end of each window it emits one FEATURE record carrying that energy, then starts again from zero.</Lead>
      <Widget ev="DEMO" label="y² and window energies" testId="course-energy">
        {controls}
        <LinePlot
          ariaLabel={`Squared filter output with window boundaries every ${win} samples`}
          series={[{ data: run.map((r) => r.y2sq), color: 'var(--mode-feature)', label: 'y²' }]}
          vlines={Array.from({ length: Math.floor(N / win) }, (_, k) => ({ at: (k + 1) * win - 1, color: 'var(--fg-tertiary)' }))}
          yMin={0} height={120} xLabel={`window = ${win} samples`}
        />
        <div className="c-energies" aria-label="Energy of each window">
          {ends.map((r, k) => (
            <span key={r.n} className="c-energy"><i>window {k + 1}</i><b className="mono">{fmt(r.energy)}</b></span>
          ))}
        </div>
        <p className="c-note">energy = sat32(Σ y² &gt;&gt; {cfg.energyShift}) — the sum divided by {2 ** cfg.energyShift}, clamped to 32 bits. The first window is lower: the filter is still starting up.</p>
      </Widget>
      {rtlE && (
        <Widget ev="RTL" label="The same idea in the chip's RTL FEATURE run">
          <table className="c-table">
            <thead><tr><th>channel</th><th>signal</th><th className="r">mean energy</th></tr></thead>
            <tbody>
              {show.map((ch) => {
                const e = rtlE.find((q) => q.ch === ch)!;
                return (
                  <tr key={ch}>
                    <td><i className="c-sw" style={{ ['--sc' as string]: chColor(ch) }} aria-hidden />ch {ch}</td>
                    <td className="c-small">{t!.ground_truth.channels.find((c) => c.ch === ch)?.description.split(',')[0]}</td>
                    <td className="mono r">{fmt(e.mean)}<br /><small className="faint">{e.n} windows</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Widget>
      )}
      <Slower>
        <p>One FEATURE record replaces {win} samples, so the output is much smaller than RAW. The price: you only know how much 70–150 Hz activity there was in each window, not what the waveform looked like.</p>
        <p>Squaring makes negative and positive swings both count, and makes big swings count much more than small ones. Shifting right by {cfg.energyShift} bits just scales the number down so it fits a 32-bit field comfortably.</p>
      </Slower>
      <Source>
        <SourceView module="hbci_band_energy" highlightLines={new Set([404, 406, 407, 413, 416, 421, 429, 430])} maxHeight={220} />
      </Source>
      <ChipLinks links={[{ label: 'Show the energy block on the die', go: () => goChip('rtl.u_energy', 'die') }]} />
    </div>
  );
}

export const LESSON6 = {
  id: 'biquad',
  title: 'Biquad + energy',
  steps: ['A weighted sum', 'Which tones pass', 'Energy per window'],
  Body: Lesson6,
  check: {
    q: 'At the same amplitude, which input leaves the most energy after this filter?',
    options: [
      { text: '10 Hz', why: '10 Hz is far below the 70–150 Hz band: about −22 dB.' },
      { text: '100 Hz', correct: true, why: 'Right: 100 Hz is inside the band and passes almost unchanged.' },
      { text: '300 Hz', why: '300 Hz is above the band: about −11.5 dB, so much less energy.' },
    ],
  },
};
