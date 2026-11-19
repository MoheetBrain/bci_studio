// Lesson 4 — Per-channel state. Step 1: the round-robin input order (RTL). Step 2: what u_fstate holds for two
// channels in the same round: x1/x2/y1/y2 DERIVED from earlier samples of that channel, acc/cnt logged (RTL).
import { useState } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { featureMemory, type FMem } from './data';
import { Callout, ChipLinks, Ev, Lead, Missing, Slider, Slower, Source, Widget, chColor, fmt, goChip } from './ui';

export function Lesson4({ step }: { step: number }) {
  const t = useArtifacts((s) => s.traceV03);
  const loaded = useArtifacts((s) => s.loaded);
  const [a, setA] = useState(2);
  const [b, setB] = useState(5);
  const [k, setK] = useState(100);
  const need = !t ? (loaded ? <Missing what="rtl_trace_v03.json" /> : <p className="c-hint">Loading the RTL trace…</p>) : null;
  const desc = (ch: number) => t?.ground_truth.channels.find((c) => c.ch === ch)?.description ?? '';

  if (step === 0) {
    const first = t?.samples.slice(0, 24) ?? [];
    return (
      <div key={0}>
        <Lead>The 8 channels arrive one after another on the same wires: 0, 1, 2 … 7, then 0 again (round-robin). Each channel comes back every 8 samples, so the chip must remember each channel's own recent past separately.</Lead>
        <Widget ev="RTL" label="The first 24 samples the chip received" testId="course-rr">
          {need ?? (
            <div className="c-rr">
              {first.map((s) => (
                <span key={s.i} className="c-rr-cell" style={{ ['--sc' as string]: chColor(s.ch) }} title={`sample #${s.i}: channel ${s.ch}, x = ${s.x}`}>
                  <i>#{s.i}</i>ch{s.ch}
                </span>
              ))}
            </div>
          )}
        </Widget>
        <Slower>
          <p>There is only one filter and one event detector, shared by all 8 channels in turn. That saves a lot of hardware, but it means the hardware forgets which channel it was working on as soon as the next sample arrives.</p>
          <p>The fix is a small memory per channel: before each sample is processed, the chip reads that channel's saved numbers, and afterwards it writes the updated numbers back. The filter memory is <span className="mono">u_fstate</span>; the event detector's memory is <span className="mono">u_state</span> (baseline, armed flag, refractory count).</p>
        </Slower>
        <Source>
          <p className="c-src-note">The per-channel arrays: one entry per channel, indexed by <span className="mono">[0:NUM_CH-1]</span>.</p>
          <SourceView module="hbci_feature_state" highlightLines={new Set([257, 258, 259, 260, 261, 262, 263])} maxHeight={200} />
        </Source>
      </div>
    );
  }

  const mA = t ? featureMemory(t, a, k) : null;
  const mB = t ? featureMemory(t, b, k) : null;
  const rows: { key: keyof FMem; name: string; plain: string; derived: boolean }[] = [
    { key: 'x1', name: 'x1', plain: 'previous input', derived: true },
    { key: 'x2', name: 'x2', plain: 'input before that', derived: true },
    { key: 'y1', name: 'y1', plain: 'previous filter output', derived: true },
    { key: 'y2', name: 'y2', plain: 'output before that', derived: true },
    { key: 'acc', name: 'acc', plain: 'energy so far in this window', derived: false },
    { key: 'cnt', name: 'cnt', plain: 'samples so far in this window', derived: false },
  ];
  const chOpts = Array.from({ length: 8 }, (_, c) => c);
  return (
    <div key={1}>
      <Lead>Pick channel 2, then channel 5, in the same round. Their memories hold completely different numbers, because their signals are completely different.</Lead>
      <Widget ev="RTL" label="What u_fstate holds for two channels" testId="course-fmem">
        {need ?? (mA && mB && (
          <>
            <div className="c-row c-wrap">
              <label className="c-sel">Channel A <select value={a} onChange={(e) => setA(Number(e.target.value))}>{chOpts.map((c) => <option key={c} value={c}>ch {c}</option>)}</select></label>
              <label className="c-sel">Channel B <select value={b} onChange={(e) => setB(Number(e.target.value))}>{chOpts.map((c) => <option key={c} value={c}>ch {c}</option>)}</select></label>
            </div>
            <Slider id="c4-k" label="Round (sample of each channel)" value={k} min={0} max={499} onChange={setK} />
            <table className="c-table c-mem">
              <thead>
                <tr><th>memory</th><th className="r" style={{ color: chColor(a) }}>ch {a}<br /><small>#{fmt(mA.s.i)}</small></th><th className="r" style={{ color: chColor(b) }}>ch {b}<br /><small>#{fmt(mB.s.i)}</small></th><th>source</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><span className="mono">{r.name}</span> <small className="faint">{r.plain}</small></td>
                    <td className="mono r">{fmt(mA[r.key] as number)}</td>
                    <td className="mono r">{fmt(mB[r.key] as number)}</td>
                    <td>{r.derived ? <span className="c-derived-t" title="Value logged at this channel's earlier sample (x or y)">derived</span> : <Ev e="RTL" />}</td>
                  </tr>
                ))}
                <tr className="c-sum">
                  <td>new input x <small className="faint">arriving now</small></td>
                  <td className="mono r">{fmt(mA.s.x)}</td><td className="mono r">{fmt(mB.s.x)}</td><td><Ev e="RTL" /></td>
                </tr>
                <tr className="c-sum">
                  <td>filter output y <small className="faint">made from all of the above</small></td>
                  <td className="mono r">{fmt(mA.s.y)}</td><td className="mono r">{fmt(mB.s.y)}</td><td><Ev e="RTL" /></td>
                </tr>
              </tbody>
            </table>
            <p className="c-note">
              ch {a}: {desc(a)}.<br />ch {b}: {desc(b)}.
            </p>
            <p className="c-note">Check: recomputing y from the derived history gives {fmt(mA.yCheck)} and {fmt(mB.yCheck)} {mA.yCheck === mA.s.y && mB.yCheck === mB.s.y ? '— both equal the RTL y ✓' : '— mismatch ✗'}.</p>
          </>
        ))}
      </Widget>
      <Callout><Ev e="DERIVED" /> x1, x2, y1, y2 are not logged; they are the <i>x</i> and <i>y</i> the RTL logged at this channel's previous two samples (round {k > 0 ? k - 1 : '—'} and {k > 1 ? k - 2 : '—'}; 0 before that, the reset value). acc and cnt are the values the RTL logged as read from the memory.</Callout>
      <Slower>
        <p>The filter's output depends on the channel's last two inputs and last two outputs. If channels shared one memory, channel 5's quiet noise would be mixed with channel 2's loud 300 Hz tone, and both outputs would be nonsense.</p>
        <p>Same for the energy: <i>acc</i> adds up one channel's filtered energy over a window of 32 of its own samples. Each channel needs its own running total and its own count.</p>
      </Slower>
      <Source>
        <p className="c-src-note">Write-back of one channel's entry after its sample (only the entry selected by <span className="mono">ch</span> changes):</p>
        <SourceView module="hbci_feature_state" highlightLines={new Set([287, 288, 289, 290, 291, 292, 293, 294])} maxHeight={200} />
      </Source>
      {mA && <ChipLinks links={[{ label: 'Show the feature memory', go: () => goChip('rtl.u_fstate', 'die'), cursor: mA.s.i }, { label: 'Show the event memory', go: () => goChip('rtl.u_state', 'die'), cursor: mA.s.i }]} />}
    </div>
  );
}

export const LESSON4 = {
  id: 'state',
  title: 'Per-channel state',
  steps: ['Channels take turns', 'Channel 2 vs channel 5'],
  Body: Lesson4,
  check: {
    q: 'What would go wrong if all 8 channels shared one x1 register?',
    options: [
      { text: 'Nothing: x1 is only used for display', why: 'x1 feeds the filter arithmetic directly: y depends on it.' },
      { text: 'The filter would mix one channel\'s past into another channel\'s output', correct: true, why: 'Right. Each channel\'s output must depend only on its own past, so each needs its own memory.' },
      { text: 'The chip would need more wires on in_sample', why: 'The input bus stays 16 bits. The problem is memory, not wires.' },
    ],
  },
};
