// Level 1 dataflow: one block with its REAL ports (rtl_modules.json), the blocks that drive / receive each port
// (netlist), live values at the sample cursor, and a simplified internal drawing (moduleSpecs.ts) whose operators
// link to the Verilog lines they summarise. Square operators are stored, rounded ones are computed.
import { useMemo } from 'react';
import { useArtifacts } from '../../artifacts/load';
import type { RtlPort } from '../../artifacts/types';
import { instFriendly, instShort } from '../names';
import { useMicro } from '../microStore';
import { fmtValue, netIndex, netValue, type Net } from '../signals';
import type { ModuleSpec, Op } from './moduleSpecs';

export interface PortRow { name: string; dir: 'input' | 'output'; width: number; signed: boolean; net: Net | null; peers: string[] }

const RAW_PORTS: RtlPort[] = [
  { name: 'in_valid', dir: 'input', width: 1 }, { name: 'in_channel', dir: 'input', width: 3 }, { name: 'cfg_session_en', dir: 'input', width: 1 },
  { name: 'cfg_mode', dir: 'input', width: 2 }, { name: 'in_sample', dir: 'input', width: 16, signed: true },
  { name: 'raw_gen', dir: 'output', width: 1 }, { name: 'raw_data', dir: 'output', width: 32 },
];

/** Ports of the block with the net on each and the blocks at the other end. */
export function usePorts(spec: ModuleSpec, inst: string, scope: 'v03' | 'event'): PortRow[] {
  const modules = useArtifacts((a) => a.modules);
  return useMemo(() => {
    if (!modules) return [];
    const idx = netIndex(modules)[scope];
    const ports: RtlPort[] = inst === '$raw' ? RAW_PORTS : modules.modules.find((m) => m.name === spec.module)?.ports ?? [];
    return ports
      .filter((p) => p.name !== 'clk' && p.name !== 'rst_n')
      .map((p) => {
        let net: Net | null = null;
        if (inst === '$raw') net = idx.get(p.name) ?? null;
        else
          for (const n of idx.values()) {
            const ends = p.dir === 'input' ? n.sinks : n.drivers;
            if (ends.some((e) => e.inst === inst && e.port === p.name)) { net = n; break; }
          }
        const peers = !net ? [] : p.dir === 'input'
          ? [...new Set(net.drivers.map((d) => d.inst))]
          : [...new Set(net.sinks.map((d) => d.inst))];
        return { name: p.name, dir: p.dir as 'input' | 'output', width: p.width, signed: !!p.signed, net, peers };
      });
  }, [modules, spec.module, inst, scope]);
}

// Geometry in SVG units: peer labels | port wire | the block | port wire | peer labels.
const W = 1240;
const IN_X = 190, BOX_X0 = 330, BOX_X1 = 910, OUT_X = 1050;
const ROW = 30;
/** Approximate glyph advance (SVG units) of the operator label (bold 16.5) and subtitle (mono 13) fonts. */
const LABEL_CH = 9.6, SUB_CH = 7.9;

function peerNames(peers: string[], scope: 'v03' | 'event', dir: 'input' | 'output', name: (i: string) => string): string[] {
  return [...new Set(peers.map((p) => (p === '' ? (scope === 'v03' ? (dir === 'input' ? 'Chip inputs' : 'Chip outputs') : 'u_event ports') : name(p))))];
}
function peerLabel(peers: string[], scope: 'v03' | 'event', dir: 'input' | 'output'): string {
  if (!peers.length) return 'not connected';
  const uniq = peerNames(peers, scope, dir, instShort);
  return uniq.length > 1 ? `${uniq[0]} +${uniq.length - 1}` : uniq[0];
}
/** Split a subtitle at the space nearest its middle. */
function split2(s: string): string[] {
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - s.length / 2) < Math.abs(best - s.length / 2))) best = i;
  return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
}

export function Dataflow({ spec, inst, scope, activeOp, onOp }: { spec: ModuleSpec; inst: string; scope: 'v03' | 'event'; activeOp: string | null; onOp: (id: string) => void }) {
  const ports = usePorts(spec, inst, scope);
  const tr = useArtifacts((a) => a.traceV03);
  const cursor = useMicro((m) => m.cursor);
  const bits = useMicro((m) => m.showBits);
  const sig = useMicro((m) => m.signal);
  const setSignal = useMicro((m) => m.setSignal);
  const ins = ports.filter((p) => p.dir === 'input');
  const outs = ports.filter((p) => p.dir === 'output');
  const n = Math.max(ins.length, outs.length, 3);
  const top = 46;
  const boxH = Math.max(n * ROW + 10, spec.H * 6.2);
  const H = top + boxH + 40;
  const rowY = (k: number, cnt: number) => top + ((k + 0.5) * boxH) / Math.max(cnt, 1);
  const pos: Record<string, { x: number; y: number }> = {};
  ins.forEach((p, k) => (pos[`port:${p.name}`] = { x: BOX_X0, y: rowY(k, ins.length) }));
  outs.forEach((p, k) => (pos[`port:${p.name}`] = { x: BOX_X1, y: rowY(k, outs.length) }));
  const opXY = (o: Op) => ({ x: BOX_X0 + 24 + (o.x / 100) * (BOX_X1 - BOX_X0 - 48), y: top + 10 + (o.y / spec.H) * (boxH - 20) });
  spec.ops.forEach((o) => (pos[o.id] = opXY(o)));
  const selNet = sig?.kind === 'net' ? sig.net : null;

  const valueOf = (p: PortRow) => (p.net && scope === 'v03' ? netValue(p.net, tr, cursor) : null);

  return (
    <svg className="mv-flow" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Dataflow of ${spec.module}`} data-testid="module-dataflow">
      <defs>
        <marker id="mv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--fg-secondary)" />
        </marker>
      </defs>
      <text x={IN_X / 2} y={22} textAnchor="middle" className="mv-colh">comes from</text>
      <text x={(OUT_X + W) / 2} y={22} textAnchor="middle" className="mv-colh">goes to</text>
      <rect x={BOX_X0} y={top} width={BOX_X1 - BOX_X0} height={boxH} rx={10} className="mv-box" />
      <text x={(BOX_X0 + BOX_X1) / 2} y={top - 10} textAnchor="middle" className="mv-boxh">{spec.module === 'hbci_readout_core' ? 'raw_gen logic (inside hbci_readout_core)' : `${inst} : ${spec.module}`}</text>

      {/* internal links */}
      {spec.links.map((l, k) => {
        const a = pos[l.from], b = pos[l.to];
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const d = `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
        return (
          <g key={k}>
            <path d={d} className={`mv-link${l.bus ? ' bus' : ''}`} markerEnd="url(#mv-arrow)" />
            {l.label && <text x={mx} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="mv-linklbl">{l.label}</text>}
          </g>
        );
      })}

      {/* operators */}
      {spec.ops.map((o) => {
        const p = opXY(o);
        // Box grows to fit its label; a long subtitle wraps to two lines (layout checked against all specs).
        let w = Math.max(((o.w ?? 14) / 100) * (BOX_X1 - BOX_X0 - 48) + 18, [...o.label].length * LABEL_CH + 14);
        const subLines = !o.sub ? [] : [...o.sub].length * SUB_CH + 12 > w ? split2(o.sub) : [o.sub];
        w = Math.max(w, ...subLines.map((l) => [...l].length * SUB_CH + 12));
        const h = (o.h ?? 9) * 6.2 * (boxH / (spec.H * 6.2)) + 16 + (subLines.length > 1 ? 8 : 0);
        const ly = p.y - (subLines.length === 2 ? 10 : subLines.length ? 3 : -4);
        return (
          <g key={o.id} className={`mv-op ${o.kind}${activeOp === o.id ? ' on' : ''}`} onClick={() => onOp(o.id)} role="button" tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOp(o.id)} data-testid={`op-${o.id}`}>
            <title>{`${o.label} — ${o.explain} (Verilog lines ${o.lines[0]}–${o.lines[1]})`}</title>
            <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={o.kind === 'store' ? 1 : 9} />
            {o.kind === 'store' && <rect x={p.x - w / 2 + 3} y={p.y - h / 2 + 3} width={w - 6} height={h - 6} rx={1} className="mv-op-inner" />}
            <text x={p.x} y={ly} textAnchor="middle" className="mv-op-l">{o.label}</text>
            {subLines.map((l, k) => <text key={k} x={p.x} y={ly + 16 + k * 14} textAnchor="middle" className="mv-op-s">{l}</text>)}
          </g>
        );
      })}

      {/* ports */}
      {[...ins, ...outs].map((p) => {
        const a = pos[`port:${p.name}`];
        const isIn = p.dir === 'input';
        const v = valueOf(p);
        const wireX0 = isIn ? IN_X : BOX_X1, wireX1 = isIn ? BOX_X0 : OUT_X;
        const on = !!p.net && selNet === p.net.net;
        return (
          <g key={`${p.dir}:${p.name}`} className={`mv-port${on ? ' on' : ''}${p.net ? '' : ' nc'}`} role="button" tabIndex={0}
            onClick={() => p.net && setSignal({ kind: 'net', net: p.net.net, scope })}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && p.net && setSignal({ kind: 'net', net: p.net.net, scope })}
            data-testid={`port-${p.name}`}>
            <title>{`${p.name}: ${p.dir}, ${p.width} bit${p.width > 1 ? 's' : ''}${p.width > 1 ? (p.signed ? ', signed' : ', unsigned') : ''}${p.net ? ` · net ${p.net.net}` : ''}`}</title>
            <line x1={wireX0} x2={wireX1} y1={a.y} y2={a.y} className={`mv-wire${p.width > 1 ? ' bus' : ''}`} />
            {p.width > 1 && (
              <>
                {/* bus slash near the far end, clear of the value and name that sit next to the block */}
                <line x1={(isIn ? IN_X + 28 : OUT_X - 44) - 5} x2={(isIn ? IN_X + 28 : OUT_X - 44) + 5} y1={a.y + 7} y2={a.y - 7} className="mv-slash" />
                <text x={(isIn ? IN_X + 28 : OUT_X - 44) + 8} y={a.y - 7} className="mv-width">{p.width}</text>
              </>
            )}
            <text x={isIn ? BOX_X0 - 8 : BOX_X1 + 8} y={a.y + 14} textAnchor={isIn ? 'end' : 'start'} className="mv-pname">{p.name}</text>
            {v && <text x={isIn ? BOX_X0 - 8 : BOX_X1 + 8} y={a.y - 6} textAnchor={isIn ? 'end' : 'start'} className={`mv-pval src-${v.src.replace(' ', '')}`}>{v.v === null ? 'NO TRACE' : fmtValue(v.v, p.width, p.signed, bits).split('   ')[0]}</text>}
            <text x={isIn ? IN_X - 6 : OUT_X + 6} y={a.y + 4} textAnchor={isIn ? 'end' : 'start'} className="mv-peer">
              {peerLabel(p.peers, scope, p.dir)}
              <title>{p.peers.length ? `${isIn ? 'Driven by' : 'Feeds'}: ${peerNames(p.peers, scope, p.dir, instFriendly).join(', ')}` : 'not connected'}</title>
            </text>
          </g>
        );
      })}
      <text x={(BOX_X0 + BOX_X1) / 2} y={top + boxH + 22} textAnchor="middle" className="mv-foot">clk and rst_n reach every register and are not drawn · {spec.note}</text>
    </svg>
  );
}
