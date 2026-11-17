// SVG of one standard cell's real GDSII polygons (µm, y up as in the GDS: drawn with y negated).
// Layer toggles, hover read-out, pin labels from TEXT records, scale bar, zoom and pan.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellDoc, CellLayer, GateRegion, Pt } from './netlist';

export interface LStyle {
  z: number;
  kind: 'fill' | 'outline' | 'contact';
  color: string;
  fo?: number;
  stroke?: string;
  dash?: string;
  sw?: number;
  on: boolean;
  short: string;
  plain: string;
}

/** Drawing style per (layer/datatype). Names in the UI come from the PDK's sky130A.lyp (in the JSON). */
export const LSTYLE: Record<string, LStyle> = {
  '81/4': { z: 0, kind: 'outline', color: '#64748b', dash: '1 4', on: false, short: 'standard-cell area', plain: 'An ID layer that marks the area as a standard cell. Not a material.' },
  '64/20': { z: 1, kind: 'fill', color: '#15803d', fo: 0.22, stroke: '#16a34a', sw: 2.5, on: true, short: 'n-well', plain: 'N-well: an n-type region of the silicon. The PMOS transistors sit inside it.' },
  '122/16': { z: 2, kind: 'outline', color: '#a3a3a3', dash: '4 3', on: false, short: 'p-well pin', plain: 'P-well pin: marks the body connection VNB of the NMOS transistors.' },
  '64/16': { z: 3, kind: 'outline', color: '#4ade80', dash: '4 3', on: false, short: 'n-well pin', plain: 'N-well pin: marks the body connection VPB of the PMOS transistors.' },
  '93/44': { z: 4, kind: 'outline', color: '#2dd4bf', dash: '6 3', on: false, short: 'n+ implant', plain: 'N+ implant (nsdm): makes the NMOS source and drain n-type.' },
  '94/20': { z: 5, kind: 'outline', color: '#fb923c', dash: '6 3', on: false, short: 'p+ implant', plain: 'P+ implant (psdm): makes the PMOS source and drain p-type.' },
  '78/44': { z: 6, kind: 'outline', color: '#c084fc', dash: '2 2', on: false, short: 'high-Vt PMOS', plain: 'hvtp: marks high-threshold-voltage PMOS (the netlist model is pfet_01v8_hvt).' },
  '95/20': { z: 7, kind: 'outline', color: '#94a3b8', dash: '3 2', on: false, short: 'nitride poly cut', plain: 'npc: a processing opening around the contacts that land on polysilicon.' },
  '65/20': { z: 10, kind: 'fill', color: '#22c55e', fo: 0.55, stroke: '#4ade80', on: true, short: 'diffusion', plain: 'Diffusion: the active silicon where transistors form.' },
  '66/20': { z: 11, kind: 'fill', color: '#ef4444', fo: 0.62, stroke: '#f87171', on: true, short: 'polysilicon', plain: 'Polysilicon: where it crosses diffusion it forms a transistor gate.' },
  '66/44': { z: 12, kind: 'contact', color: '#f8fafc', on: true, short: 'contact (licon1)', plain: 'licon1: a contact from diffusion or polysilicon up to the li1 wiring layer.' },
  '67/20': { z: 13, kind: 'fill', color: '#818cf8', fo: 0.42, stroke: '#a5b4fc', on: true, short: 'local interconnect (li1)', plain: 'li1: local interconnect, the lowest wiring layer.' },
  '67/16': { z: 14, kind: 'outline', color: '#f9a8d4', dash: '3 2', on: false, short: 'li1 pin', plain: 'li1 pin: the shape where the router may connect a signal pin.' },
  '67/44': { z: 15, kind: 'contact', color: '#fbbf24', on: true, short: 'contact (mcon)', plain: 'mcon: a contact from li1 up to metal 1.' },
  '68/20': { z: 16, kind: 'fill', color: '#3b82f6', fo: 0.36, stroke: '#60a5fa', sw: 1.5, on: true, short: 'metal 1', plain: 'Metal 1 (met1): the first metal wiring layer.' },
  '68/16': { z: 17, kind: 'outline', color: '#f9a8d4', dash: '3 2', on: false, short: 'met1 pin', plain: 'met1 pin: the shape where a power pin is defined.' },
  '236/0': { z: 20, kind: 'outline', color: '#e2e8f0', dash: '5 4', on: true, short: 'cell boundary', plain: 'prBoundary: the abutment box. Neighbouring cells touch it; it sets the cell width and row height.' },
};

export function lkey(l: { layer: number; datatype: number }) {
  return `${l.layer}/${l.datatype}`;
}

export function styleOf(l: CellLayer): LStyle {
  return LSTYLE[lkey(l)] ?? { z: 30, kind: 'outline', color: '#9ca3af', dash: '2 2', on: false, short: `${l.name}.${l.purpose}`, plain: '' };
}

const BG = '#0d1117';
const NICE = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
const f3 = (v: number) => v.toFixed(2);
const pathD = (pts: Pt[]) => 'M ' + pts.map(([x, y]) => `${x} ${-y}`).join(' L ') + ' Z';

export type Hover =
  | { kind: 'poly'; key: string; i: number }
  | { kind: 'gate'; i: number }
  | null;

interface Props {
  doc: CellDoc;
  vis: Record<string, boolean>;
  showGates: boolean;
  showLabels: boolean;
  hover: Hover;
  setHover: (h: Hover) => void;
}

export function CellCanvas({ doc, vis, showGates, showLabels, hover, setHover }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [px, setPx] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ z: 1, dx: 0, dy: 0 });
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; id: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setView({ z: 1, dx: 0, dy: 0 }), [doc.cell]);

  const [ex0, ey0, ex1, ey1] = doc.extent_um;
  const fit = { x: ex0 - 0.62, y: -(ey1 + 0.55), w: ex1 - ex0 + 0.62 + 0.22, h: ey1 - ey0 + 0.55 + 0.3 };
  const vw = fit.w / view.z;
  const vh = fit.h / view.z;
  const vx = fit.x + fit.w / 2 + view.dx - vw / 2;
  const vy = fit.y + fit.h / 2 + view.dy - vh / 2;
  const ppu = px.w && px.h ? Math.min(px.w / vw, px.h / vh) : 100; // screen px per µm
  const fs = 15 / ppu;

  const layers = useMemo(() => [...doc.layers].sort((a, b) => styleOf(a).z - styleOf(b).z), [doc]);
  const gates: GateRegion[] = doc.gate_regions_derived?.status === 'ok' ? doc.gate_regions_derived.regions ?? [] : [];

  // pin labels (TEXT records on *.label layers); labels at the same point are joined.
  const labels = useMemo(() => {
    const m = new Map<string, { x: number; y: number; texts: string[]; layers: string[] }>();
    for (const t of doc.labels) {
      if (!/\.label\b/.test(t.layer_name)) continue;
      const k = `${t.x},${t.y}`;
      const g = m.get(k) ?? { x: t.x, y: t.y, texts: [], layers: [] };
      if (!g.texts.includes(t.text)) g.texts.push(t.text);
      g.layers.push(`${t.text} on ${t.layer_name}`);
      m.set(k, g);
    }
    return [...m.values()];
  }, [doc]);

  const bar = [...NICE].reverse().find((u) => u <= vw * 0.3) ?? NICE[0];
  const [bx0, by0, bx1, by1] = doc.bbox_um;
  const dimY = -(ey1 + 0.24);
  const dimX = ex0 - 0.3;
  const tick = 0.06;

  const toUm = (clientX: number, clientY: number): [number, number] | null => {
    const s = svg.current;
    const ctm = s?.getScreenCTM();
    if (!s || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, -p.y];
  };

  const zoom = (k: number) => setView((v) => {
    const z = Math.min(12, Math.max(1, v.z * k));
    return z === 1 ? { z, dx: 0, dy: 0 } : { ...v, z };
  });

  const hovered = hover?.kind === 'poly' ? doc.layers.find((l) => lkey(l) === hover.key)?.polygons[hover.i] : null;
  const hoveredGate = hover?.kind === 'gate' ? gates[hover.i] : null;

  return (
    <div className="cv-canvas" ref={box} style={{ background: BG }}>
      <svg
        ref={svg}
        className="cv-svg"
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Polygons of ${doc.cell} from the GDSII, ${doc.size_um.width} by ${doc.size_um.height} micrometres`}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy, id: e.pointerId }; }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; setCursor(null); setHover(null); }}
        onPointerMove={(e) => {
          setCursor(toUm(e.clientX, e.clientY));
          const d = drag.current;
          if (d && (e.buttons & 1)) setView((v) => ({ ...v, dx: d.dx - (e.clientX - d.x) / ppu, dy: d.dy - (e.clientY - d.y) / ppu }));
        }}
        onDoubleClick={() => setView({ z: 1, dx: 0, dy: 0 })}
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
      >
        <defs>
          <pattern id="cv-hatch-m1" patternUnits="userSpaceOnUse" width={0.08} height={0.08} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.08} stroke="#60a5fa" strokeWidth={0.02} />
          </pattern>
        </defs>
        {layers.map((l) => {
          const k = lkey(l);
          if (!vis[k]) return null;
          const s = styleOf(l);
          return (
            <g key={k} data-layer={k}>
              {l.polygons.map((pts, i) => {
                const enter = () => setHover({ kind: 'poly', key: k, i });
                const leave = () => setHover(null);
                if (s.kind === 'contact') {
                  const xs = pts.map((p) => p[0]);
                  const ys = pts.map((p) => -p[1]);
                  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
                  return (
                    <g key={i} onPointerEnter={enter} onPointerLeave={leave}>
                      <path d={pathD(pts)} fill={s.color} fillOpacity={0.22} stroke={s.color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                      <path d={`M ${x0} ${y0} L ${x1} ${y1} M ${x0} ${y1} L ${x1} ${y0}`} stroke={s.color} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    </g>
                  );
                }
                return (
                  <path
                    key={i}
                    d={pathD(pts)}
                    fill={s.kind === 'fill' ? (k === '68/20' ? 'url(#cv-hatch-m1)' : s.color) : 'none'}
                    fillOpacity={s.kind === 'fill' ? (k === '68/20' ? 1 : s.fo ?? 0.4) : undefined}
                    stroke={s.stroke ?? s.color}
                    strokeWidth={s.sw ?? 1.2}
                    strokeDasharray={s.dash}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={s.kind === 'fill' ? 'visiblePainted' : 'stroke'}
                    onPointerEnter={enter}
                    onPointerLeave={leave}
                  />
                );
              })}
              {k === '68/20' && l.polygons.map((pts, i) => (
                <path key={`f${i}`} d={pathD(pts)} fill={s.color} fillOpacity={0.22} stroke="none" pointerEvents="none" />
              ))}
            </g>
          );
        })}
        {showGates && gates.map((g, i) => (
          <rect
            key={`g${i}`}
            className="cv-gate-r"
            x={g.x0} y={-g.y1} width={g.x1 - g.x0} height={g.y1 - g.y0}
            fill="#fde047" fillOpacity={0.16} stroke="#fde047" strokeWidth={2} vectorEffect="non-scaling-stroke"
            onPointerEnter={() => setHover({ kind: 'gate', i })}
            onPointerLeave={() => setHover(null)}
          />
        ))}
        {hovered && <path d={pathD(hovered)} fill="none" stroke="#ffffff" strokeWidth={2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        {hoveredGate && <rect x={hoveredGate.x0} y={-hoveredGate.y1} width={hoveredGate.x1 - hoveredGate.x0} height={hoveredGate.y1 - hoveredGate.y0} fill="none" stroke="#ffffff" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        {showLabels && labels.map((g) => (
          <g key={`${g.x},${g.y}`} pointerEvents="none">
            <circle cx={g.x} cy={-g.y} r={3 / ppu} fill="#ffffff" stroke={BG} strokeWidth={1 / ppu} />
            <text
              x={g.x + 5 / ppu} y={-g.y - 5 / ppu} fontSize={fs} fontWeight={700} fill="#ffffff"
              stroke={BG} strokeWidth={fs * 0.28} paintOrder="stroke" strokeLinejoin="round"
            >
              {g.texts.join(' · ')}
              <title>{`TEXT record(s): ${g.layers.join('; ')} at x ${g.x} µm, y ${g.y} µm`}</title>
            </text>
          </g>
        ))}
        {/* dimensions of the abutment box (prBoundary) */}
        <g className="cv-dim" pointerEvents="none" stroke="#cbd5e1" strokeWidth={1} fill="#e2e8f0">
          <path d={`M ${bx0} ${dimY} H ${bx1} M ${bx0} ${dimY - tick} V ${dimY + tick} M ${bx1} ${dimY - tick} V ${dimY + tick}`} vectorEffect="non-scaling-stroke" fill="none" />
          <text x={(bx0 + bx1) / 2} y={dimY - 0.07} fontSize={fs} textAnchor="middle" stroke="none">{f3(bx1 - bx0)} µm</text>
          <path d={`M ${dimX} ${-by1} V ${-by0} M ${dimX - tick} ${-by1} H ${dimX + tick} M ${dimX - tick} ${-by0} H ${dimX + tick}`} vectorEffect="non-scaling-stroke" fill="none" />
          <text x={dimX - 0.08} y={-(by0 + by1) / 2} fontSize={fs} textAnchor="middle" stroke="none" transform={`rotate(-90 ${dimX - 0.08} ${-(by0 + by1) / 2})`}>{f3(by1 - by0)} µm</text>
        </g>
      </svg>
      <div className="cv-scale" aria-hidden="true">
        <div style={{ width: bar * ppu }} />
        <span>{bar} µm</span>
      </div>
      <div className="cv-zoom">
        <button className="btn sm" onClick={() => zoom(1.5)} aria-label="Zoom in">+</button>
        <button className="btn sm" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out" disabled={view.z <= 1}>−</button>
        <button className="btn sm" onClick={() => setView({ z: 1, dx: 0, dy: 0 })} disabled={view.z === 1 && view.dx === 0 && view.dy === 0}>Fit</button>
      </div>
      <div className="cv-xy mono" aria-live="off">
        {cursor ? `x ${cursor[0].toFixed(3)} µm · y ${cursor[1].toFixed(3)} µm` : 'y axis points up, as in the GDS'}
        {view.z > 1.01 && ` · ${view.z.toFixed(1)}×`}
      </div>
    </div>
  );
}
