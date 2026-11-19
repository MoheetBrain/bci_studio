// Level 4, tab (b): EDUCATIONAL transistor tutorial. Idealised switch-like MOSFETs, no PDK data,
// no currents or voltages: a NAND (2 PMOS in parallel, 2 NMOS in series) and an inverter.
import { EvidenceBadge } from '../../ui/EvidenceBadge';
import { SpSchematic } from './SpSchematic';
import { conducts, type Expr } from './netlist';

export interface TutState { ex: 'nand' | 'inv'; v: Record<string, 0 | 1>; slow: boolean }

const dev = (type: 'n' | 'p', gate: string): Expr => ({ k: 'dev', type, gate, names: [`${type === 'p' ? 'P' : 'N'}${gate}`] });

const EXAMPLES = {
  nand: {
    label: 'NAND', sub: '2 PMOS + 2 NMOS', inputs: ['A', 'B'],
    pu: { k: 'par', items: [dev('p', 'A'), dev('p', 'B')] } as Expr,
    pd: { k: 'ser', items: [dev('n', 'A'), dev('n', 'B')], nodes: [''] } as Expr,
  },
  inv: {
    label: 'Inverter', sub: '1 PMOS + 1 NMOS', inputs: ['A'],
    pu: dev('p', 'A'),
    pd: dev('n', 'A'),
  },
} as const;

function devs(e: Expr): (Expr & { k: 'dev' })[] {
  return e.k === 'dev' ? [e] : e.items.flatMap(devs);
}
const nm = (d: Expr & { k: 'dev' }) => `${d.type === 'p' ? 'PMOS' : 'NMOS'} ${d.gate}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const all = (n: number) => (n === 2 ? 'both' : 'all');

function pathText(e: Expr, v: Record<string, 0 | 1>): string {
  const on = devs(e).filter((d) => conducts(d, v)).map(nm);
  if (e.k === 'ser') return `${list(on)} (in series, ${all(on.length)} ON)`;
  return list(on);
}

function whyOff(e: Expr, v: Record<string, 0 | 1>, to: string): string {
  const ds = devs(e);
  const off = ds.filter((d) => !conducts(d, v)).map(nm);
  const kind = ds[0].type === 'p' ? 'PMOS' : 'NMOS';
  if (e.k === 'dev') return `${off[0]} is OFF, so there is no path to ${to}.`;
  if (e.k === 'ser') return `The ${kind} are in series, so the path to ${to} needs ${all(ds.length)} of them ON, but ${list(off)} ${off.length > 1 ? 'are' : 'is'} OFF.`;
  return `The ${kind} are in parallel, so one ON would be enough, but ${all(ds.length)} are OFF: no path to ${to}.`;
}

export function Tutorial({ st, set, seeReal }: { st: TutState; set: (p: Partial<TutState>) => void; seeReal: (ex: TutState['ex']) => void }) {
  const ex = EXAMPLES[st.ex];
  const v: Record<string, 0 | 1> = Object.fromEntries(ex.inputs.map((i) => [i, st.v[i] ?? 0]));
  const up = conducts(ex.pu, v);
  const dn = conducts(ex.pd, v);
  const y = up && !dn ? 1 : 0;
  const rows = Array.from({ length: 1 << ex.inputs.length }, (_, m) => {
    const rv: Record<string, 0 | 1> = Object.fromEntries(ex.inputs.map((p, i) => [p, ((m >> (ex.inputs.length - 1 - i)) & 1) as 0 | 1]));
    const ru = conducts(ex.pu, rv);
    return { rv, y: ru ? 1 : 0, path: ru ? `VDD via ${pathText(ex.pu, rv)}` : `GND via ${pathText(ex.pd, rv)}` };
  });
  const isCur = (rv: Record<string, 0 | 1>) => ex.inputs.every((p) => rv[p] === v[p]);

  return (
    <div className="cv-body" data-testid="cell-tutorial">
      <div className="cv-caution concept" role="note">
        <span aria-hidden="true" className="cv-caution-i">i</span>
        <span><b>Educational.</b> Idealised switch-like transistors, not SKY130 PDK data and not part of the chip&apos;s evidence.</span>
        <EvidenceBadge e="CONCEPT" />
      </div>

      <div className="cv-pickrow">
        <span className="cv-k">Example</span>
        <div className="cv-seg" role="radiogroup" aria-label="Example gate">
          {(Object.keys(EXAMPLES) as (keyof typeof EXAMPLES)[]).map((k) => (
            <button key={k} role="radio" aria-checked={st.ex === k} className={`seg-btn cv-segbtn${st.ex === k ? ' on' : ''}`} onClick={() => set({ ex: k })} data-testid={`tut-ex-${k}`}>
              <b>{EXAMPLES[k].label}</b> <span>{EXAMPLES[k].sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cv-grid">
        <section className="cv-card" aria-label="Interactive circuit">
          <div className="cv-inputs">
            {ex.inputs.map((p) => (
              <button
                key={p}
                className={`cv-in ${v[p] ? 'one' : 'zero'}`}
                aria-pressed={v[p] === 1}
                onClick={() => set({ v: { ...st.v, [p]: v[p] ? 0 : 1 } })}
                data-testid={`tut-in-${p}`}
              >
                <span className="cv-in-k">Input {p}</span>
                <span className="cv-in-v">{v[p]}</span>
                <span className="cv-in-h">click to flip</span>
              </button>
            ))}
            <span className="cv-arrow" aria-hidden="true">→</span>
            <div className={`cv-out ${y ? 'one' : 'zero'}`} aria-live="polite" data-testid="tut-out">
              <span className="cv-in-k">Output Y</span>
              <span className="cv-in-v">{y}</span>
              <span className="cv-in-h">{up ? 'connected to VDD' : 'connected to GND'}</span>
            </div>
          </div>
          <div className="cv-schwrap">
            <SpSchematic pu={ex.pu} pd={ex.pd} top="VDD (logic 1)" bottom="GND (logic 0)" out="Y" values={v}
              title={`Idealised ${ex.label} made of switches, inputs ${ex.inputs.map((p) => `${p}=${v[p]}`).join(', ')}, output Y=${y}`} />
          </div>
          <ul className="cv-legend">
            <li><i className="cv-lg on" /> lit transistor: ON, switch closed</li>
            <li><i className="cv-lg off" /> gap in the channel: OFF, switch open</li>
            <li><i className="cv-lg path" /> thick line: the connected path that sets Y</li>
          </ul>
        </section>

        <section className="cv-card" aria-label="Explanation">
          <h3>What is happening</h3>
          <ul className="cv-explain">
            {ex.inputs.map((p) => (
              <li key={p}><b>{p} = {v[p]}</b>: NMOS {p} is <b>{v[p] ? 'ON' : 'OFF'}</b>, PMOS {p} is <b>{v[p] ? 'OFF' : 'ON'}</b>.</li>
            ))}
            <li>{up ? <>Y is connected to <b>VDD</b> through {pathText(ex.pu, v)}, so <b>Y = 1</b>.</> : <>Y is connected to <b>GND</b> through {pathText(ex.pd, v)}, so <b>Y = 0</b>.</>}</li>
            <li className="muted">{up ? whyOff(ex.pd, v, 'GND') : whyOff(ex.pu, v, 'VDD')}</li>
          </ul>

          <label className="cv-slow">
            <input type="checkbox" checked={st.slow} onChange={(e) => set({ slow: e.target.checked })} data-testid="tut-slow" />
            Explain slower
          </label>
          {st.slow && (
            <ol className="cv-slowtext" data-testid="tut-slowtext">
              <li>Here a transistor is treated as a switch. Its <b>gate</b> input decides whether the switch is closed (conducting) or open.</li>
              <li><b>NMOS</b> (no circle on the gate) closes when its gate is <b>1</b> and opens when it is 0.</li>
              <li><b>PMOS</b> (small circle on the gate, meaning “opposite”) closes when its gate is <b>0</b> and opens when it is 1.</li>
              <li>The PMOS at the top try to connect Y to <b>VDD</b>, which means logic 1. The NMOS at the bottom try to connect Y to <b>GND</b>, which means logic 0.</li>
              {st.ex === 'nand' ? (
                <>
                  <li>The two PMOS are side by side (<b>parallel</b>): either one closed is enough to connect Y to VDD.</li>
                  <li>The two NMOS are stacked (<b>series</b>): current can only reach GND if both are closed, which needs A = 1 <i>and</i> B = 1.</li>
                  <li>For every input combination exactly one of the two networks connects, so Y is never left floating and VDD is never shorted to GND.</li>
                  <li>So Y is 0 only when A and B are both 1: “NOT AND”, the <b>NAND</b> gate.</li>
                </>
              ) : (
                <>
                  <li>One PMOS and one NMOS share input A. Whatever A is, exactly one of them is closed.</li>
                  <li>A = 0 closes the PMOS (Y connected to VDD, Y = 1); A = 1 closes the NMOS (Y connected to GND, Y = 0). Y is always the opposite of A: an <b>inverter</b>.</li>
                </>
              )}
              <li>The genuine SKY130 cell on the other tab has the same structure, derived there from the PDK netlist; each of its transistors is built from two parallel “fingers”.</li>
            </ol>
          )}

          <h3>Truth table</h3>
          <table className="cv-table cv-tt big" data-testid="tut-truth">
            <thead><tr>{ex.inputs.map((p) => <th key={p}>{p}</th>)}<th>Y</th><th className="cv-pathcol">Y is connected to</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={isCur(r.rv) ? 'cur' : ''}
                  aria-current={isCur(r.rv) ? 'true' : undefined}
                  onClick={() => set({ v: { ...st.v, ...r.rv } })}
                  title="Click to use these inputs"
                >
                  {ex.inputs.map((p) => <td key={p}>{r.rv[p]}</td>)}
                  <td><b>{r.y}</b></td>
                  <td className="cv-pathcol">{r.path}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="cv-note">Real transistors also have resistance, capacitance and a switching delay; none of that is modelled here, only the logic.</p>
          <button className="btn" onClick={() => seeReal(st.ex)} data-testid="tut-see-real">See the genuine SKY130 {ex.label === 'NAND' ? 'NAND2' : 'inverter'} cell</button>
        </section>
      </div>
    </div>
  );
}
