// Lesson 2 — A register and the clock. Step 1: EDUCATIONAL D flip-flop, stepped by the learner. Step 2: how many
// flip-flops u_fstate needs (arithmetic from the RTL declarations vs the SYNTH count). Step 3: u_fstate's x1 register
// in the RTL trace (x and cycle are RTL; the held x1 value is DERIVED, checked by recomputing y).
import { useMemo, useState } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { channelSamples, derivationCheck, featureMemory } from './data';
import { BitButton, Callout, ChipLinks, Ev, Lamp, Lead, Missing, Seg, Slider, Slower, Source, Widget, chColor, fmt, goChip } from './ui';

type B = 0 | 1;
interface Moment { clk: boolean; d: B; q: B }

/** Waveform of the learner's own actions: one column per action, a rising clock edge on every tick. */
function Waves({ hist }: { hist: Moment[] }) {
  const cols = hist.slice(-12);
  const W = 400, rowH = 26, x0 = 34, cw = (W - x0 - 6) / 12;
  const rows: { name: string; v: (m: Moment) => number; cls: string }[] = [
    { name: 'clk', v: (m) => (m.clk ? 1 : 0), cls: 'c-w-clk' },
    { name: 'D', v: (m) => m.d, cls: 'c-w-d' },
    { name: 'Q', v: (m) => m.q, cls: 'c-w-q' },
  ];
  return (
    <svg className="c-plot" viewBox={`0 0 ${W} ${rowH * 3 + 8}`} role="img" aria-label="Waveform of clock, D and Q for your last actions">
      <rect x={0} y={0} width={W} height={rowH * 3 + 8} className="c-plot-bg" />
      {rows.map((r, ri) => {
        const yHi = 6 + ri * rowH, yLo = yHi + rowH - 10;
        let d = '';
        cols.forEach((m, k) => {
          const xa = x0 + k * cw, xb = xa + cw;
          if (r.name === 'clk') {
            // a short pulse at the start of a tick column (rising edge), low otherwise
            d += m.clk ? `M${xa},${yLo} L${xa},${yHi} L${xa + cw * 0.45},${yHi} L${xa + cw * 0.45},${yLo} L${xb},${yLo} ` : `M${xa},${yLo} L${xb},${yLo} `;
          } else {
            const y = r.v(m) ? yHi : yLo;
            const prev = k > 0 ? (r.v(cols[k - 1]) ? yHi : yLo) : y;
            d += `M${xa},${prev} L${xa},${y} L${xb},${y} `;
          }
        });
        return (
          <g key={r.name}>
            <text x={4} y={yLo - 2} className="c-plot-t">{r.name}</text>
            <path d={d} className={r.cls} />
          </g>
        );
      })}
      {cols.map((m, k) => (m.clk ? <line key={k} x1={x0 + k * cw} x2={x0 + k * cw} y1={4} y2={rowH * 3 + 6} className="c-w-edge" /> : null))}
    </svg>
  );
}

export function Lesson2({ step }: { step: number }) {
  const [d, setD] = useState<B>(0);
  const [q, setQ] = useState<B>(0);
  const [hist, setHist] = useState<Moment[]>([{ clk: false, d: 0, q: 0 }]);
  const [ch, setCh] = useState(1);
  const [k, setK] = useState(160);
  const t = useArtifacts((s) => s.traceV03);
  const synth = useArtifacts((s) => s.synth);
  const loaded = useArtifacts((s) => s.loaded);
  const check = useMemo(() => (t ? derivationCheck(t) : null), [t]);

  const flipD = (v: B) => { setD(v); setHist((h) => [...h, { clk: false, d: v, q }]); };
  const tick = () => { setQ(d); setHist((h) => [...h, { clk: true, d, q: d }]); };

  if (step === 0) {
    return (
      <div key={0}>
        <Lead>A <b>register</b> (flip-flop) remembers one bit. It copies its input <b>D</b> to its output <b>Q</b> only when the <b>clock ticks</b>. In between, Q holds still even if D changes.</Lead>
        <Widget ev="EDUCATIONAL" label="One flip-flop, one gate" testId="course-dff">
          <div className="c-row">
            <BitButton name="D" v={d} onChange={flipD} />
            <button className="btn sm primary c-tick" onClick={tick}>Clock tick ▲</button>
            <span className="c-k">Q</span><Lamp v={q} label="Q" />
            <span className="c-k">NOT D</span><Lamp v={(d ? 0 : 1) as B} label="NOT D" />
          </div>
          <Waves hist={hist} />
          <p className="c-note">Flip D: the NOT gate's output changes at once, Q does not. Press <i>Clock tick</i>: now Q copies D.</p>
        </Widget>
        <Slower>
          <p>A gate has no memory: its output always follows its inputs, a moment later. That kind of logic is called <i>combinational</i>.</p>
          <p>A flip-flop is different. A clock signal goes up and down millions of times a second, and at each upward step (the <i>rising edge</i>) every flip-flop takes a snapshot of its input. Between edges it keeps showing the snapshot. That is how the chip remembers anything at all: the previous sample, a counter, a queue of records.</p>
          <p>In the chip the clock ticks by itself. Here you press the button, so nothing moves until you do.</p>
        </Slower>
      </div>
    );
  }

  if (step === 1) {
    const fs = synth?.modules.find((m) => m.module === 'hbci_feature_state');
    const perCh = 16 * 4 + 48 + 10 + 1;
    return (
      <div key={1}>
        <Lead>One flip-flop holds one bit, so a 16-bit number needs 16 flip-flops sharing the same clock. The filter's memory, <span className="mono">u_fstate</span>, keeps {perCh} bits for each of the 8 channels.</Lead>
        <Widget ev="DERIVED" label="Counting the bits in u_fstate's declarations">
          <table className="c-table">
            <tbody>
              <tr><td className="mono">x1, x2, y1, y2</td><td>4 numbers × 16 bits</td><td className="mono r">64</td></tr>
              <tr><td className="mono">acc</td><td>energy so far, 48 bits</td><td className="mono r">48</td></tr>
              <tr><td className="mono">cnt</td><td>samples in this window, 10 bits</td><td className="mono r">10</td></tr>
              <tr><td className="mono">sat</td><td>"saturated" flag, 1 bit</td><td className="mono r">1</td></tr>
              <tr className="c-sum"><td colSpan={2}>per channel</td><td className="mono r">{perCh}</td></tr>
              <tr className="c-sum"><td colSpan={2}>× 8 channels</td><td className="mono r">{perCh * 8}</td></tr>
            </tbody>
          </table>
          {fs ? (
            <p className="c-note"><Ev e="SYNTH" /> Yosys counted <b>{fmt(fs.flops)} flip-flops</b> in <span className="mono">hbci_feature_state</span> (synth_stats.json){fs.flops === perCh * 8 ? ': exactly the same number.' : '.'}</p>
          ) : loaded ? <Missing what="synth_stats.json" /> : null}
        </Widget>
        <Slower>
          <p>The widths come from the module's parameters as the top level uses it: SAMPLE_W = 16, ACC_W = 48, WIN_W = 10, NUM_CH = 8. Multiply them out and you get the number of one-bit memories the chip needs for this block.</p>
          <p>Synthesis turned each of those bits into one flip-flop cell. The two counts agree, which is a nice sanity check that nothing extra was stored.</p>
        </Slower>
        <Source>
          <SourceView module="hbci_feature_state" highlightLines={new Set([257, 258, 259, 260, 261, 262, 263])} maxHeight={200} />
        </Source>
      </div>
    );
  }

  // step 2: the real x1 register
  if (!t) return <div key={2}>{loaded ? <Missing what="rtl_trace_v03.json" /> : <p className="c-hint">Loading the RTL trace…</p>}</div>;
  const row = channelSamples(t, ch);
  const kk = Math.min(Math.max(0, k), row.length - 2);
  const now = row[kk];
  const next = row[kk + 1];
  const mem = featureMemory(t, ch, kk + 1);
  return (
    <div key={2}>
      <Lead>Real example: when a sample of one channel arrives, <span className="mono">u_fstate</span> writes it into that channel's <span className="mono">x1</span> register at the clock edge. It sits there, unchanged, until the same channel's next sample needs it.</Lead>
      <Widget ev="RTL" label="Channel x1 register in the RTL trace" testId="course-x1">
        <Seg label="Channel" value={ch} onChange={setCh} options={Array.from({ length: 8 }, (_, c) => ({ v: c, label: String(c), color: chColor(c) }))} />
        <Slider id="c2-k" label="Sample of this channel" value={kk} min={0} max={row.length - 2} onChange={setK} />
        <ol className="c-story">
          <li><b>Clock cycle {fmt(now.cycle)}:</b> sample #{fmt(now.i)} of channel {ch} arrives, <span className="mono">in_sample = {fmt(now.x)}</span>. <Ev e="RTL" /></li>
          <li><b>Rising edge:</b> <span className="mono">x1[{ch}] ← {fmt(now.x)}</span> (and the old x1 moves to x2). Seven other channels pass by; none of them touches x1[{ch}].</li>
          <li><b>Clock cycle {fmt(next.cycle)}</b> ({fmt(next.cycle - now.cycle)} cycles later): sample #{fmt(next.i)} of channel {ch} arrives and the filter reads <span className="mono">x1 = {fmt(mem?.x1 ?? 0)}</span>. <Ev e="DERIVED" /></li>
        </ol>
        {mem && (
          <p className="c-note">
            Check: feeding that x1 (and x2, y1, y2 found the same way) into the filter arithmetic gives <span className="mono">y = {fmt(mem.yCheck)}</span>; the RTL logged <span className="mono">y = {fmt(mem.s.y)}</span> {mem.yCheck === mem.s.y ? '✓' : '✗'}.
            {check && <> Over the whole trace this holds at <b>{fmt(check.agree)} / {fmt(check.total)}</b> samples.</>}
          </p>
        )}
      </Widget>
      <Callout>The trace logs <i>x</i>, <i>y</i> and the clock cycle of every sample (RTL). The stored <span className="mono">x1</span> is not logged; it is <b>derived</b> as "the x of this channel's previous sample", and the check above confirms the rule.</Callout>
      <Slower>
        <p>The chip receives one sample every 4 clock cycles, and the 8 channels take turns. So the same channel comes back every 8 samples = 32 clock cycles. The x1 register is what lets the filter remember this channel's previous input across that wait.</p>
        <p>The write only happens when a sample is accepted (<span className="mono">we = accept</span>), and only into the entry of the channel that just arrived.</p>
      </Slower>
      <Source>
        <SourceView module="hbci_feature_state" highlightLines={new Set([287, 288, 289, 290, 291])} maxHeight={200} />
      </Source>
      <ChipLinks links={[{ label: 'Show u_fstate on the die', go: () => goChip('rtl.u_fstate', 'die'), cursor: next.i }]} />
    </div>
  );
}

export const LESSON2 = {
  id: 'register',
  title: 'A register and the clock',
  steps: ['Remembering a bit', 'Many bits, one clock', 'The chip\'s x1 register'],
  Body: Lesson2,
  check: {
    q: 'You change D but do not press Clock tick. What does Q do?',
    options: [
      { text: 'It changes at once, like a gate', why: 'That is what the NOT gate does. A register waits for the clock.' },
      { text: 'It keeps its old value until the next tick', correct: true, why: 'Right. A register only copies D to Q at the rising clock edge.' },
      { text: 'It becomes 0', why: 'No: Q keeps whatever it last copied, 0 or 1.' },
    ],
  },
};
