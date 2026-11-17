// Small building blocks shared by the course lessons: evidence tags, the "Explain slower" / "Show source"
// disclosures, "See it on the chip" buttons and a tiny inline-SVG line plot that follows the theme tokens.
import { useState, type ReactNode } from 'react';
import { EvidenceBadge } from '../../ui/EvidenceBadge';
import type { Evidence, Level } from '../../model/types';
import { useScene } from '../../state/sceneStore';
import { useHw } from '../../state/hwStore';
import { useMicro } from '../microStore';

/** Evidence badge, or one of the course's two extra labels. */
export function Ev({ e, title }: { e: Evidence | 'EDUCATIONAL' | 'DERIVED'; title?: string }) {
  if (e === 'EDUCATIONAL') {
    return (
      <span className="evidence ev-CONCEPT c-tag" title={title ?? 'Educational illustration drawn for learning. Not taken from the chip.'}>
        <span className="dot" />EDUCATIONAL
      </span>
    );
  }
  if (e === 'DERIVED') {
    return (
      <span className="evidence ev-RTL c-tag c-derived" title={title ?? 'Reconstructed from actual RTL trace values by the rule stated next to it. Not logged directly.'}>
        <span className="dot" />DERIVED FROM RTL TRACE
      </span>
    );
  }
  return <EvidenceBadge e={e} title={title} />;
}

/** The 1–3 sentence beginner text of a step. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="c-lead">{children}</p>;
}

/** A widget frame with its evidence label. */
export function Widget({ ev, label, children, testId }: { ev: Parameters<typeof Ev>[0]['e']; label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="c-widget" data-testid={testId}>
      <div className="c-widget-h"><span>{label}</span><Ev e={ev} /></div>
      {children}
    </div>
  );
}

function Disclosure({ label, children, kind }: { label: string; children: ReactNode; kind: 'slower' | 'source' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`c-disc c-disc-${kind}`}>
      <button className="btn sm c-disc-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden>{open ? '▾' : '▸'}</span> {open ? (kind === 'slower' ? 'Hide the longer explanation' : 'Hide the source') : label}
      </button>
      {open && <div className="c-disc-body">{children}</div>}
    </div>
  );
}

/** Longer explanation, hidden until asked for. */
export function Slower({ children }: { children: ReactNode }) {
  return <Disclosure label="Explain slower" kind="slower">{children}</Disclosure>;
}

/** The exact RTL / evidence behind a step, hidden until asked for. */
export function Source({ children }: { children: ReactNode }) {
  return <Disclosure label="Show source" kind="source">{children}</Disclosure>;
}

export function Callout({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'ok' | 'warn' }) {
  return <div className={`c-callout c-${tone}`}>{children}</div>;
}

export function Missing({ what }: { what: string }) {
  return <div className="c-missing">Not available: {what}. Nothing is shown instead of it (run <code>make artifacts</code> to generate it).</div>;
}

// ───────────────────────────── driving the studio ──

/** Select a registry block and go to a chip level. */
export function goChip(id: string, level: Level) {
  const s = useScene.getState();
  s.select(id);
  s.setLevel(level);
}

/** Open the synthesised-gates view of a Verilog module. */
export function goGates(module: string, id: string) {
  useHw.getState().setGatesModule(module);
  goChip(id, 'gates');
}

export function ChipLinks({ links }: { links: { label: string; go: () => void; cursor?: number }[] }) {
  return (
    <div className="c-chiplinks">
      <span className="c-chiplinks-h">See it on the chip</span>
      {links.map((l) => (
        <button key={l.label} className="btn sm" onClick={() => { if (l.cursor !== undefined) useMicro.getState().setCursor(l.cursor); l.go(); }}>
          {l.label} <span aria-hidden>↗</span>
        </button>
      ))}
    </div>
  );
}

/** Toggle button for one bit. */
export function BitButton({ name, v, onChange }: { name: string; v: 0 | 1; onChange: (v: 0 | 1) => void }) {
  return (
    <button className={`c-bit${v ? ' on' : ''}`} aria-pressed={v === 1} onClick={() => onChange(v ? 0 : 1)} title={`Click to flip ${name}`}>
      <span className="c-bit-name">{name}</span><span className="c-bit-val">{v}</span>
    </button>
  );
}

/** A lamp showing one output bit. */
export function Lamp({ v, label }: { v: 0 | 1; label?: string }) {
  return <span className={`c-lamp${v ? ' on' : ''}`} aria-label={`${label ?? 'output'} = ${v}`}>{v}</span>;
}

export const fmt = (n: number) => n.toLocaleString('en-US');

// ───────────────────────────── tiny SVG line plot ──

export interface Series { data: number[]; color: string; label: string; width?: number; dash?: string }
export interface PlotMark { at: number; color: string; label?: string; shape?: 'dot' | 'tick' }

/** Inline-SVG plot (viewBox 400 wide) of series against sample index, with optional bands, levels and marks. */
export function LinePlot({
  series, height = 140, yMin, yMax, hlines = [], bands = [], marks = [], vlines = [], xLabel, cursor, ariaLabel,
}: {
  series: Series[];
  height?: number;
  yMin?: number; yMax?: number;
  hlines?: { y: number; color: string; dash?: string; label?: string }[];
  bands?: { from: number; to: number; color: string }[];
  marks?: (PlotMark & { y: number })[];
  vlines?: { at: number; color: string; dash?: string }[];
  xLabel?: string;
  cursor?: number;
  ariaLabel: string;
}) {
  const W = 400, padL = 6, padR = 6, padT = 8, padB = xLabel ? 20 : 8;
  const n = Math.max(1, ...series.map((s) => s.data.length));
  const all = series.flatMap((s) => s.data).concat(hlines.map((h) => h.y));
  const lo = yMin ?? Math.min(0, ...all);
  const hi = yMax ?? Math.max(1, ...all);
  const sx = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, n - 1);
  const sy = (v: number) => padT + (height - padT - padB) * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / Math.max(1e-9, hi - lo));
  return (
    <svg className="c-plot" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
      <rect x={0} y={0} width={W} height={height} className="c-plot-bg" />
      {bands.map((b, k) => (
        <rect key={`b${k}`} x={sx(b.from)} y={padT} width={Math.max(1, sx(b.to) - sx(b.from))} height={height - padT - padB} style={{ fill: b.color, opacity: 0.16 }} />
      ))}
      {lo < 0 && hi > 0 && <line x1={padL} x2={W - padR} y1={sy(0)} y2={sy(0)} className="c-plot-zero" />}
      {vlines.map((v, k) => (
        <line key={`v${k}`} x1={sx(v.at)} x2={sx(v.at)} y1={padT} y2={height - padB} style={{ stroke: v.color, strokeDasharray: v.dash ?? '3 3', strokeWidth: 1 }} />
      ))}
      {hlines.map((h, k) => (
        <g key={`h${k}`}>
          <line x1={padL} x2={W - padR} y1={sy(h.y)} y2={sy(h.y)} style={{ stroke: h.color, strokeDasharray: h.dash ?? '5 4', strokeWidth: 1.2 }} />
          {h.label && <text x={W - padR - 2} y={sy(h.y) - 3} textAnchor="end" className="c-plot-t" style={{ fill: h.color }}>{h.label}</text>}
        </g>
      ))}
      {series.map((s) => (
        <polyline
          key={s.label}
          points={s.data.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')}
          style={{ fill: 'none', stroke: s.color, strokeWidth: s.width ?? 1.4, strokeDasharray: s.dash }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {marks.map((m, k) => (m.shape === 'tick'
        ? <line key={`m${k}`} x1={sx(m.at)} x2={sx(m.at)} y1={padT} y2={padT + 9} style={{ stroke: m.color, strokeWidth: 2.5 }} />
        : <circle key={`m${k}`} cx={sx(m.at)} cy={sy(m.y)} r={3.6} style={{ fill: m.color, stroke: 'var(--surface-panel)', strokeWidth: 1 }} />))}
      {cursor !== undefined && <line x1={sx(cursor)} x2={sx(cursor)} y1={padT} y2={height - padB} className="c-plot-cursor" />}
      {xLabel && <text x={W / 2} y={height - 5} textAnchor="middle" className="c-plot-t">{xLabel}</text>}
    </svg>
  );
}

/** Legend row for a plot. */
export function Legend({ items }: { items: { color: string; label: string; dash?: boolean; dot?: boolean }[] }) {
  return (
    <div className="c-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i className={it.dot ? 'dot' : it.dash ? 'dash' : 'line'} style={{ ['--c' as string]: it.color }} />{it.label}
        </span>
      ))}
    </div>
  );
}

/** Labelled range slider (keyboard operable). */
export function Slider({ label, value, min, max, step = 1, onChange, suffix, id }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; id: string;
}) {
  return (
    <div className="c-slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id} className="mono">{fmt(value)}{suffix ?? ''}</output>
    </div>
  );
}

/** Segmented choice (radio group of buttons). */
export function Seg<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { v: T; label: string; color?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="c-seg" role="radiogroup" aria-label={label}>
      <span className="c-seg-l">{label}</span>
      {options.map((o) => (
        <button
          key={String(o.v)} role="radio" aria-checked={o.v === value} className={`btn sm${o.v === value ? ' on' : ''}`}
          onClick={() => onChange(o.v)} style={o.color ? { ['--sc' as string]: o.color } : undefined}
        >
          {o.color && <i className="c-sw" aria-hidden />}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Channel colour token. */
export const chColor = (ch: number) => `var(--ch${ch})`;
