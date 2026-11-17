// Lesson 3 — A bus and a multiplexer. Step 1: in_sample[15:0] / in_channel[2:0] of a real sample (RTL). Step 2:
// EDUCATIONAL 4:1 mux. Step 3: in_channel[2:0] selects one of u_fstate's 8 entries: the selected entry's acc/cnt are the
// logged values (RTL); the other seven are DERIVED (each entry is only written when its own channel arrives).
import { useState } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { bits, muxEntries } from './data';
import { BitButton, Callout, ChipLinks, Ev, Lead, Missing, Slider, Slower, Source, Widget, chColor, fmt, goChip } from './ui';

type B = 0 | 1;

function BusBits({ v, w, label }: { v: number; w: number; label: string }) {
  const b = bits(v, w);
  return (
    <div className="c-bus" role="img" aria-label={`${label} = ${b.join('')} = ${v}`}>
      {b.map((x, k) => (
        <span key={k} className={`c-busbit${x ? ' on' : ''}${k === 0 && w === 16 ? ' sign' : ''}`}>
          <i>{w - 1 - k}</i>{x}
        </span>
      ))}
    </div>
  );
}

const MUX_IN = [12, 7, 30, 5];

function Mux4({ s1, s0 }: { s1: B; s0: B }) {
  const sel = s1 * 2 + s0;
  const W = 400, H = 150;
  return (
    <svg className="c-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`4 to 1 multiplexer, select ${s1}${s0} picks input ${sel} = ${MUX_IN[sel]}`}>
      <rect x={0} y={0} width={W} height={H} className="c-plot-bg" />
      {MUX_IN.map((v, k) => {
        const y = 22 + k * 30;
        const on = k === sel;
        return (
          <g key={k}>
            <text x={12} y={y + 5} className={`c-mux-t${on ? ' on' : ''}`}>in{k} = {v}</text>
            <line x1={96} x2={168} y1={y} y2={y} className={`c-mux-w${on ? ' on' : ''}`} />
            <text x={150} y={y - 4} textAnchor="middle" className="c-plot-t">{k >> 1}{k & 1}</text>
          </g>
        );
      })}
      <path d="M168 8 L238 30 L238 112 L168 134 Z" className="c-mux-body" />
      <text x={203} y={75} textAnchor="middle" className="c-plot-t">MUX</text>
      <line x1={203} x2={203} y1={124} y2={146} className="c-mux-w" />
      <text x={212} y={146} className="c-plot-t">select = {s1}{s0}</text>
      <line x1={238} x2={300} y1={71} y2={71} className="c-mux-w on" />
      <text x={306} y={76} className="c-mux-t on">out = {MUX_IN[sel]}</text>
    </svg>
  );
}

export function Lesson3({ step }: { step: number }) {
  const t = useArtifacts((s) => s.traceV03);
  const loaded = useArtifacts((s) => s.loaded);
  const [i, setI] = useState(805);
  const [s1, setS1] = useState<B>(1);
  const [s0, setS0] = useState<B>(0);

  const need = !t ? (loaded ? <Missing what="rtl_trace_v03.json" /> : <p className="c-hint">Loading the RTL trace…</p>) : null;

  if (step === 0) {
    const s = t?.samples[Math.min(i, (t?.samples.length ?? 1) - 1)];
    return (
      <div key={0}>
        <Lead>One wire carries one bit, so a 16-bit number travels on 16 wires side by side: a <b>bus</b>. <span className="mono">in_sample[15:0]</span> means "the wires numbered 15 down to 0".</Lead>
        <Widget ev="RTL" label="A real sample on the input buses" testId="course-bus">
          {need ?? (s && (
            <>
              <Slider id="c3-i" label="Sample number" value={i} min={0} max={t!.samples.length - 1} onChange={setI} />
              <div className="c-buslabel"><span className="mono">in_channel[2:0]</span> <span className="mono">= {s.ch}</span></div>
              <BusBits v={s.ch} w={3} label="in_channel" />
              <div className="c-buslabel"><span className="mono">in_sample[15:0]</span> <span className="mono">= {fmt(s.x)}</span></div>
              <BusBits v={s.x} w={16} label="in_sample" />
            </>
          ))}
        </Widget>
        <Slower>
          <p>Each little box is one wire. A lit box carries 1, a dark one 0. Read together, the 16 bits form one number, the way the digits 4, 0, 7 form 407.</p>
          <p>Bit 15 (outlined) is the sign: when it is 1 the number is negative ("two's complement"). That is why 16 wires can carry any whole number from −32,768 to 32,767.</p>
          <p>The 3-wire <span className="mono">in_channel</span> bus says which of the 8 channels this sample belongs to (000 = channel 0 … 111 = channel 7).</p>
        </Slower>
        <Source>
          <p className="c-src-note">The values are <span className="mono">x</span> and <span className="mono">ch</span> of <span className="mono">samples[{i}]</span> in rtl_trace_v03.json, logged by the testbench from the Icarus Verilog run. The ports are declared in <span className="mono">hbci_readout_core</span>:</p>
          <SourceView module="hbci_readout_core" highlightLines={new Set([66, 67, 68])} maxHeight={160} />
        </Source>
      </div>
    );
  }

  if (step === 1) {
    const sel = s1 * 2 + s0;
    return (
      <div key={1}>
        <Lead>A <b>multiplexer</b> (mux) is a switch made of gates: its <b>select</b> bits choose which input reaches the output. Two select bits can name 4 inputs: 00, 01, 10, 11.</Lead>
        <Widget ev="EDUCATIONAL" label="A 4-to-1 multiplexer" testId="course-mux">
          <div className="c-row">
            <BitButton name="S1" v={s1} onChange={setS1} />
            <BitButton name="S0" v={s0} onChange={setS0} />
            <span className="c-hint">select {s1}{s0} = input {sel}</span>
          </div>
          <Mux4 s1={s1} s0={s0} />
        </Widget>
        <Slower>
          <p>Think of a railway junction: several tracks come in, one goes out, and the lever decides which track is connected. The select bits are the lever, written as a binary number.</p>
          <p>With 1 select bit you can choose between 2 inputs, with 2 bits between 4, with 3 bits between 8. Each extra bit doubles the choice.</p>
        </Slower>
      </div>
    );
  }

  // step 2: in_channel selects the channel entry
  const s = t?.samples[Math.min(i, (t?.samples.length ?? 1) - 1)];
  const ents = t && s ? muxEntries(t, s.i) : [];
  return (
    <div key={2}>
      <Lead>Three select bits can name 8 inputs. In the chip, <span className="mono">in_channel[2:0]</span> is the select of a mux inside <span className="mono">u_fstate</span>: it picks which of the 8 channel entries the filter reads right now.</Lead>
      <Widget ev="RTL" label="u_fstate's 8 entries, selected by in_channel" testId="course-mux-real">
        {need ?? (s && (
          <>
            <Slider id="c3-i2" label="Sample number" value={i} min={0} max={t!.samples.length - 1} onChange={setI} />
            <p className="c-note">Sample #{fmt(s.i)}: <span className="mono">in_channel = {bits(s.ch, 3).join('')}</span> (channel {s.ch}), so the mux passes entry {s.ch} to the filter.</p>
            <table className="c-table c-mux-table">
              <thead><tr><th>select</th><th>entry</th><th className="r">cnt</th><th className="r">acc</th><th>source</th></tr></thead>
              <tbody>
                {ents.map((e) => (
                  <tr key={e.ch} className={e.kind === 'rtl' ? 'c-selrow' : undefined}>
                    <td className="mono">{bits(e.ch, 3).join('')}</td>
                    <td><i className="c-sw" style={{ ['--sc' as string]: chColor(e.ch) }} aria-hidden />ch {e.ch}</td>
                    <td className="mono r">{e.cnt ?? '—'}</td>
                    <td className="mono r">{e.acc === null ? '—' : fmt(e.acc)}</td>
                    <td>{e.kind === 'rtl' ? <Ev e="RTL" title="rd_cnt / rd_acc logged at this sample" /> : e.kind === 'derived' ? <span className="c-derived-t" title={`Logged when channel ${e.ch} was next read, at sample #${e.at}`}>derived</span> : <span className="faint">not in trace</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
      </Widget>
      <Callout><b>cnt</b> counts samples in the current energy window and <b>acc</b> is the energy so far (lesson 6). The highlighted row is what the mux actually outputs (logged, RTL). The other rows are <b>derived</b>: an entry only changes when its own channel arrives, so its value now equals what was read the next time that channel came.</Callout>
      <Slower>
        <p>All 8 channels share the same filter hardware, one after the other. The mux is how the shared filter gets the right channel's memory each time: the channel number on the input bus is wired straight to the select.</p>
        <p>The event detector's memory (<span className="mono">u_state</span>) has the same kind of 8-way mux, selected by the same <span className="mono">in_channel</span> bus.</p>
      </Slower>
      <Source>
        <SourceView module="hbci_feature_state" highlightLines={new Set([267, 268, 269, 270, 271, 272, 273])} maxHeight={200} />
      </Source>
      {s && <ChipLinks links={[{ label: 'Show u_fstate on the die', go: () => goChip('rtl.u_fstate', 'die'), cursor: s.i }, { label: 'Show u_state', go: () => goChip('rtl.u_state', 'die'), cursor: s.i }]} />}
    </div>
  );
}

export const LESSON3 = {
  id: 'mux',
  title: 'A bus and a multiplexer',
  steps: ['A bus', 'A multiplexer', 'in_channel picks the channel'],
  Body: Lesson3,
  check: {
    q: 'How many select bits does a mux need to choose between the chip\'s 8 channels?',
    options: [
      { text: '2', why: '2 bits can only name 4 inputs (00, 01, 10, 11).' },
      { text: '3', correct: true, why: 'Right: 000 to 111 names 8 inputs. That is why in_channel is [2:0], three wires.' },
      { text: '8', why: 'That would be one wire per channel. A mux needs fewer: each extra bit doubles the choice.' },
    ],
  },
};
