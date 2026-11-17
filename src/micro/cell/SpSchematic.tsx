// Draws a static CMOS cell as a pull-up network (supply → output) over a pull-down network
// (output → ground), from series/parallel expressions (netlist.ts). Used twice: on the PDK tab the
// expressions come from the SKY130 SPICE netlist; on the tutorial tab they are idealised switches
// whose state follows the learner's inputs.
import type { ReactElement } from 'react';
import { conducts, type Expr } from './netlist';

const LW = 112;  // space left of a device's channel lead (gate lead + label)
const RW = 96;   // space right of it (type, names / state)
const DH = 84;   // device height
const GAP = 16;  // between parallel branches
const BP = 18;   // bus clearance above/below parallel branches

interface Size { w: number; h: number; tx: number }

function size(e: Expr): Size {
  if (e.k === 'dev') return { w: LW + RW, h: DH, tx: LW };
  const s = e.items.map(size);
  if (e.k === 'ser') {
    const l = Math.max(...s.map((c) => c.tx));
    const r = Math.max(...s.map((c) => c.w - c.tx));
    return { w: l + r, h: s.reduce((a, c) => a + c.h, 0), tx: l };
  }
  let off = 0;
  const t: number[] = [];
  s.forEach((c) => { t.push(off + c.tx); off += c.w + GAP; });
  return { w: off - GAP, h: Math.max(...s.map((c) => c.h)) + 2 * BP, tx: (t[0] + t[t.length - 1]) / 2 };
}

interface Ctx {
  wires: { d: string; on: boolean }[];
  glyphs: ReactElement[];
  values?: Record<string, 0 | 1>;
  hl?: string | null;
  showNames: boolean;
  nodeLabels: boolean;
  key: number;
}

function draw(e: Expr, x: number, y: number, active: boolean, ctx: Ctx) {
  const sz = size(e);
  if (e.k === 'dev') {
    const cx = x + sz.tx;
    const my = y + DH / 2;
    const on = ctx.values ? conducts(e, ctx.values) : undefined;
    const chX = cx - 14;
    const gx = cx - 23;
    // drain / source leads (part of the current path)
    ctx.wires.push({ d: `M ${cx} ${y} V ${y + 20} H ${chX}`, on: active });
    ctx.wires.push({ d: `M ${chX} ${y + DH - 20} H ${cx} V ${y + DH}`, on: active });
    const cls = ['cv-dev', e.type === 'p' ? 'pmos' : 'nmos', on === true ? 'is-on' : on === false ? 'is-off' : '',
      active ? 'is-path' : '', ctx.hl && e.names.includes(ctx.hl) ? 'is-hl' : ''].filter(Boolean).join(' ');
    const label2 = ctx.showNames
      ? (e.names.length > 1 ? `×${e.names.length}: ${e.names.join(' ')}` : e.names[0])
      : on === undefined ? '' : on ? 'ON' : 'OFF';
    const gateText = ctx.values ? `${e.gate} = ${ctx.values[e.gate]}` : e.gate;
    ctx.glyphs.push(
      <g key={ctx.key++} className={cls}>
        <title>{`${e.type === 'p' ? 'PMOS' : 'NMOS'}, gate ${e.gate}${e.names.length > 1 ? `, ${e.names.length} parallel fingers (${e.names.join(', ')})` : ctx.showNames ? ` (${e.names[0]})` : ''}${on === undefined ? '' : on ? ': conducting (switch closed)' : ': off (switch open)'}`}</title>
        <rect className="cv-dev-bg" x={cx - LW + 4} y={y + 6} width={LW + RW - 8} height={DH - 12} rx={8} />
        {on === false
          ? <><line className="cv-ch" x1={chX} y1={y + 16} x2={chX} y2={my - 8} /><line className="cv-ch" x1={chX} y1={my + 8} x2={chX} y2={y + DH - 16} /></>
          : <line className="cv-ch" x1={chX} y1={y + 16} x2={chX} y2={y + DH - 16} />}
        <line className="cv-gate" x1={gx} y1={y + 22} x2={gx} y2={y + DH - 22} />
        {e.type === 'p'
          ? <><circle className="cv-bubble" cx={gx - 6} cy={my} r={5} /><line className="cv-gate" x1={gx - 11} y1={my} x2={cx - 50} y2={my} /></>
          : <line className="cv-gate" x1={gx} y1={my} x2={cx - 50} y2={my} />}
        <text className="cv-gl" x={cx - 54} y={my + 6} textAnchor="end">{gateText}</text>
        <text className="cv-dt" x={cx + 8} y={my - 6}>{e.type === 'p' ? 'PMOS' : 'NMOS'}</text>
        {label2 && <text className={`cv-dn${on === true ? ' on' : on === false ? ' off' : ''}`} x={cx + 8} y={my + 14}>{label2}</text>}
      </g>,
    );
    return;
  }
  if (e.k === 'ser') {
    const tX = x + sz.tx;
    let yy = y;
    e.items.forEach((c, i) => {
      const cs = size(c);
      draw(c, tX - cs.tx, yy, active, ctx);
      yy += cs.h;
      if (i < e.items.length - 1) {
        ctx.glyphs.push(<circle key={ctx.key++} className="cv-node" cx={tX} cy={yy} r={4} />);
        if (ctx.nodeLabels && e.nodes[i]) {
          ctx.glyphs.push(<text key={ctx.key++} className="cv-nl" x={tX + 9} y={yy + 5}>{e.nodes[i]}</text>);
        }
      }
    });
    return;
  }
  let off = 0;
  const bx = x + sz.tx;
  e.items.forEach((c) => {
    const cs = size(c);
    const cx = x + off + cs.tx;
    const on = active && (!ctx.values || conducts(c, ctx.values));
    ctx.wires.push({ d: `M ${bx} ${y} H ${cx} V ${y + BP}`, on });
    ctx.wires.push({ d: `M ${cx} ${y + BP + cs.h} V ${y + sz.h} H ${bx}`, on });
    draw(c, x + off, y + BP, on, ctx);
    off += cs.w + GAP;
  });
  ctx.glyphs.push(<circle key={ctx.key++} className="cv-node" cx={bx} cy={y} r={4} />);
  ctx.glyphs.push(<circle key={ctx.key++} className="cv-node" cx={bx} cy={y + sz.h} r={4} />);
}

export interface SpSchematicProps {
  pu: Expr;
  pd: Expr;
  top: string;
  bottom: string;
  out: string;
  /** Tutorial mode: input values; devices show ON/OFF and the conducting path is highlighted. */
  values?: Record<string, 0 | 1>;
  /** Device name to emphasise (PDK tab: hovered table row). */
  hl?: string | null;
  showNames?: boolean;
  nodeLabels?: boolean;
  title: string;
}

export function SpSchematic({ pu, pd, top, bottom, out, values, hl, showNames = false, nodeLabels = false, title }: SpSchematicProps) {
  const su = size(pu);
  const sd = size(pd);
  const ML = 24;
  const X = ML + Math.max(su.tx, sd.tx);
  const R = Math.max(su.w - su.tx, sd.w - sd.tx);
  const railT = 34;
  const puY = railT + 18;
  const yY = puY + su.h + 26;
  const pdY = yY + 26;
  const railB = pdY + sd.h + 18;
  const xOut = X + R + 14;
  const W = xOut + 92;
  const H = railB + 30;
  const upOn = values ? conducts(pu, values) : false;
  const dnOn = values ? conducts(pd, values) : false;
  const y = values ? (upOn && !dnOn ? '1' : dnOn && !upOn ? '0' : '?') : null;
  const ctx: Ctx = { wires: [], glyphs: [], values, hl, showNames, nodeLabels, key: 0 };
  ctx.wires.push({ d: `M ${X} ${railT} V ${puY}`, on: upOn });
  draw(pu, X - su.tx, puY, upOn, ctx);
  ctx.wires.push({ d: `M ${X} ${puY + su.h} V ${yY}`, on: upOn });
  ctx.wires.push({ d: `M ${X} ${yY} V ${pdY}`, on: dnOn });
  draw(pd, X - sd.tx, pdY, dnOn, ctx);
  ctx.wires.push({ d: `M ${X} ${pdY + sd.h} V ${railB}`, on: dnOn });
  const wires = [...ctx.wires.filter((w) => !w.on), ...ctx.wires.filter((w) => w.on)];
  return (
    <svg className="cv-sch" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={title}>
      <line className={`cv-rail${upOn ? ' is-path' : ''}`} x1={8} y1={railT} x2={W - 8} y2={railT} />
      <text className="cv-rl" x={10} y={railT - 9}>{top}</text>
      <line className={`cv-rail${dnOn ? ' is-path' : ''}`} x1={8} y1={railB} x2={W - 8} y2={railB} />
      <text className="cv-rl" x={10} y={railB + 22}>{bottom}</text>
      {wires.map((w, i) => <path key={i} className={`cv-w${w.on ? ' is-path' : ''}`} d={w.d} />)}
      <path className={`cv-w cv-out${y === '1' ? ' y1' : y === '0' ? ' y0' : ''}`} d={`M ${X} ${yY} H ${xOut}`} />
      <circle className="cv-node" cx={X} cy={yY} r={5} />
      <text className="cv-yl" x={xOut + 6} y={yY + 6}>{y === null ? out : `${out} = ${y}`}</text>
      {ctx.glyphs}
    </svg>
  );
}
