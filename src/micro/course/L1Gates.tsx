// Lesson 1 — A bit and a gate. Step 1–2: EDUCATIONAL gates driven by two bits. Step 3: the real synthesised gates
// of the filter (hbci_biquad, reduced-width copy of the same RTL; SYNTH), counted from the netlist JSON.
import { useEffect, useState } from 'react';
import { useArtifacts, fetchText } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { BitButton, Callout, ChipLinks, Lamp, Lead, Missing, Slower, Source, Widget, fmt, goGates } from './ui';

type B = 0 | 1;

const GATES: { id: string; name: string; rule: string; f: (a: B, b: B) => B; shape: 'and' | 'or' | 'xor' | 'not' | 'nand' }[] = [
  { id: 'and', name: 'AND', rule: '1 only if A and B are both 1', f: (a, b) => (a & b) as B, shape: 'and' },
  { id: 'or', name: 'OR', rule: '1 if at least one is 1', f: (a, b) => (a | b) as B, shape: 'or' },
  { id: 'xor', name: 'XOR', rule: '1 if A and B differ', f: (a, b) => (a ^ b) as B, shape: 'xor' },
  { id: 'not', name: 'NOT A', rule: 'flips A', f: (a) => (a ? 0 : 1), shape: 'not' },
  { id: 'nand', name: 'NAND', rule: 'NOT of AND', f: (a, b) => (a & b ? 0 : 1), shape: 'nand' },
];

/** Standard gate symbols (educational drawing). */
function GateSymbol({ shape, on }: { shape: string; on: boolean }) {
  const body = {
    and: 'M2 2 H16 A10 10 0 0 1 16 22 H2 Z',
    nand: 'M2 2 H14 A10 10 0 0 1 14 22 H2 Z',
    or: 'M2 2 Q11 12 2 22 Q20 22 30 12 Q20 2 2 2 Z',
    xor: 'M6 2 Q15 12 6 22 Q24 22 32 12 Q24 2 6 2 Z',
    not: 'M4 2 L26 12 L4 22 Z',
  }[shape]!;
  return (
    <svg viewBox="-2 0 42 24" className={`c-gate-sym${on ? ' on' : ''}`} aria-hidden>
      <path d={body} />
      {shape === 'xor' && <path d="M1 2 Q10 12 1 22" className="c-gate-extra" />}
      {(shape === 'not' || shape === 'nand') && <circle cx={shape === 'not' ? 29.5 : 27.5} cy={12} r={3.2} />}
    </svg>
  );
}

interface NetCounts { total: number; byType: [string, number][]; fullAdderGates: number; rtlLines: Record<string, number> }

/** Count the gates of the reduced-width synthesised filter netlist (Yosys write_json). */
function useBiquadGates(file: string | undefined): NetCounts | null | 'missing' {
  const [res, setRes] = useState<NetCounts | null | 'missing'>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void fetchText(`schematics/${file}`).then((txt) => {
      if (!live) return;
      if (!txt) { setRes('missing'); return; }
      try {
        const j = JSON.parse(txt) as { modules: Record<string, { cells: Record<string, { type: string; attributes?: Record<string, string> }> }> };
        const mod = j.modules.hbci_biquad ?? Object.values(j.modules)[0];
        const cells = Object.values(mod.cells);
        const by: Record<string, number> = {};
        let fa = 0;
        const rtlLines: Record<string, number> = {};
        for (const c of cells) {
          by[c.type] = (by[c.type] ?? 0) + 1;
          const src = c.attributes?.src ?? '';
          if (/techmap\.v:20[56]\./.test(src)) fa++;
          const m = src.match(/^rtl\/hbci_readout_core\.v:(\d+)\./);
          if (m) rtlLines[m[1]] = (rtlLines[m[1]] ?? 0) + 1;
        }
        setRes({ total: cells.length, byType: Object.entries(by).sort((a, b) => b[1] - a[1]), fullAdderGates: fa, rtlLines });
      } catch { setRes('missing'); }
    });
    return () => { live = false; };
  }, [file]);
  return res;
}

const pretty = (t: string) => t.replace(/^\$_|_$/g, '');

export function Lesson1({ step }: { step: number }) {
  const [a, setA] = useState<B>(1);
  const [b, setB] = useState<B>(0);
  const schem = useArtifacts((s) => s.schematics);
  const synth = useArtifacts((s) => s.synth);
  const loaded = useArtifacts((s) => s.loaded);
  const entry = schem?.entries.find((e) => e.id === 'hbci_biquad.gates.reduced');
  const counts = useBiquadGates(step === 2 ? entry?.netlist : undefined);
  const full = synth?.modules.find((m) => m.module === 'hbci_biquad');

  const inputs = (
    <div className="c-row">
      <BitButton name="A" v={a} onChange={setA} />
      <BitButton name="B" v={b} onChange={setB} />
      <span className="c-hint">Click a bit to flip it.</span>
    </div>
  );

  if (step === 0) {
    return (
      <div key={0}>
        <Lead>Every wire inside the chip carries one <b>bit</b>: 0 (low voltage) or 1 (high voltage). A <b>gate</b> is a tiny circuit that looks at its input bits and makes one output bit.</Lead>
        <Widget ev="EDUCATIONAL" label="Two bits, five gates" testId="course-gates">
          {inputs}
          <div className="c-gates">
            {GATES.map((g) => {
              const out = g.f(a, b);
              return (
                <div key={g.id} className={`c-gate${out ? ' on' : ''}`}>
                  <GateSymbol shape={g.shape} on={out === 1} />
                  <b>{g.name}</b>
                  <Lamp v={out} label={g.name} />
                  <small>{g.rule}</small>
                </div>
              );
            })}
          </div>
        </Widget>
        <Slower>
          <p>Think of a bit as a light switch: off is 0, on is 1. A gate is a rule that turns its input switches into one output switch.</p>
          <p><b>AND</b> is 1 only when both inputs are 1. <b>OR</b> is 1 when at least one input is 1. <b>XOR</b> ("exclusive or") is 1 when the two inputs are different. <b>NOT</b> flips its single input. <b>NAND</b> is an AND followed by a NOT.</p>
          <p>You never have to memorise these. Designers write Verilog (a text description of the logic) and a tool called <i>synthesis</i> picks the gates automatically. These drawings are for learning only.</p>
        </Slower>
      </div>
    );
  }

  if (step === 1) {
    const sum = (a ^ b) as B;
    const carry = (a & b) as B;
    return (
      <div key={1}>
        <Lead>Two gates side by side can add. XOR gives the sum digit and AND gives the carry, so 1 + 1 = <b>10</b> in binary (that is 2). Long chains of these make the adders and multipliers in the chip.</Lead>
        <Widget ev="EDUCATIONAL" label="Adding two bits (a half adder)">
          {inputs}
          <div className="c-adder">
            <div><span className="c-k">A + B</span><span className="mono c-big">{a} + {b}</span></div>
            <div><span className="c-k">carry (AND)</span><Lamp v={carry} label="carry" /></div>
            <div><span className="c-k">sum (XOR)</span><Lamp v={sum} label="sum" /></div>
            <div><span className="c-k">result</span><span className="mono c-big">{carry}{sum}<sub>2</sub> = {a + b}</span></div>
          </div>
        </Widget>
        <Slower>
          <p>In ordinary numbers, 7 + 5 = 12: you write 2 and carry 1 to the next column. Binary works the same way with only the digits 0 and 1. The XOR gate writes the digit, the AND gate decides whether to carry.</p>
          <p>Add a third input (the carry coming in from the column to the right) and you have a <i>full adder</i>. Put 16 of them in a row and you can add two 16-bit numbers. You will meet the real ones in the next step.</p>
        </Slower>
      </div>
    );
  }

  // step 2: the real gates
  const fa = counts && counts !== 'missing' ? counts : null;
  return (
    <div key={2}>
      <Lead>Those drawings were for learning. Here are <b>real</b> gates: the netlist Yosys synthesised from the chip's band-pass filter Verilog (<span className="mono">hbci_biquad</span>). Most of them are exactly the XOR/AND/OR adders from the last step.</Lead>
      <Widget ev="SYNTH" label="Real gates of the filter (reduced-width copy)" testId="course-real-gates">
        {!loaded ? <p className="c-hint">Loading…</p> : !entry ? <Missing what="schematics.json entry hbci_biquad.gates.reduced" /> : counts === 'missing' ? <Missing what={`artifacts/schematics/${entry.netlist}`} /> : !fa ? <p className="c-hint">Counting gates…</p> : (
          <>
            <p className="c-note">
              Same RTL, widths reduced so it can be drawn ({Object.entries(entry.params).map(([k, v]) => `${k}=${v}`).join(', ')}).
              Total: <b>{fmt(fa.total)} gates</b>.
            </p>
            <div className="c-bars" role="list">
              {fa.byType.map(([t, n]) => (
                <div key={t} className="c-barrow" role="listitem">
                  <span className="mono">{pretty(t)}</span>
                  <span className="c-bar"><i style={{ width: `${(100 * n) / fa.byType[0][1]}%` }} /></span>
                  <span className="mono">{fmt(n)}</span>
                </div>
              ))}
            </div>
            <p className="c-note"><b>{fmt(fa.fullAdderGates)}</b> of the {fmt(fa.total)} come from Yosys's full-adder recipe (an XOR/AND pair like step 2, plus a carry input), used to build the five multiplies and the sum.</p>
          </>
        )}
        {full && (
          <p className="c-note">At the real widths (16-bit samples and coefficients) the same filter is <b>{fmt(full.cells)} generic gates</b> after optimisation (synth_stats.json). Generic gates only: not a PDK, so no area or speed is claimed.</p>
        )}
      </Widget>
      <Callout>
        Step 1's gates are an <b>educational drawing</b>. These counts are the <b>synthesised netlist</b> of the filter's actual Verilog. Neither is a photo of silicon: the chip has not been fabricated.
      </Callout>
      <Slower>
        <p>Synthesis reads the Verilog line <span className="mono">p = m_b0 + m_b1 + m_b2 - m_a1 - m_a2</span> and replaces every multiply and add with rows of full adders, each made of XOR, AND and OR gates.</p>
        <p>The gates view draws a version with 4-bit numbers instead of 16-bit ones, because the real filter has thousands of gates, too many to read. The logic is the same, only narrower.</p>
        {fa && Object.keys(fa.rtlLines).length > 0 && (
          <p>A few gates come straight from filter lines: {Object.entries(fa.rtlLines).map(([l, n]) => `line ${l}: ${n}`).join(', ')} (the saturation check and the output selector).</p>
        )}
      </Slower>
      <Source>
        <p className="c-src-note">The Verilog of the filter: the five multiplies and the sum (lines 341–346) are what most gates implement. Yosys's full adder (techmap.v, lines 205–206) is <span className="mono">t1 = A ^ B, t2 = A &amp; B, t3 = C &amp; t1; Y = t1 ^ C, X = t2 | t3</span>.</p>
        <SourceView module="hbci_biquad" highlightLines={new Set([341, 342, 343, 344, 345, 346])} maxHeight={220} />
        {entry?.note && <p className="c-src-note">schematics.json: {entry.note}</p>}
      </Source>
      <ChipLinks links={[{ label: 'Open the filter\'s gates', go: () => goGates('hbci_biquad', 'rtl.u_biquad') }]} />
    </div>
  );
}

export const LESSON1 = {
  id: 'gates',
  title: 'A bit and a gate',
  steps: ['Bits and gates', 'Gates that add', 'See a real one'],
  Body: Lesson1,
  check: {
    q: 'Which gates on this lesson\'s pages come from the chip\'s actual Verilog?',
    options: [
      { text: 'The five gates you switched with A and B', why: 'Those are a teaching drawing (EDUCATIONAL). They behave like real gates but were drawn for learning.' },
      { text: 'The gate counts of the filter netlist', correct: true, why: 'Right. Yosys synthesised them from hbci_biquad\'s Verilog (SYNTH), shown at reduced width so it can be drawn.' },
      { text: 'Both: they are photos of the chip', why: 'Neither is a photo: the chip has not been fabricated. One is a drawing, the other a synthesised netlist.' },
    ],
  },
};
