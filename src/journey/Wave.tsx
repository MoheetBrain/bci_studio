// One waveform panel of an aligned stack: a uniformly sampled series on a shared time axis, with the playhead.
// Plain 2D canvas (graphs are not 3D). Every panel states its unit; a series with fewer samples than pixels is drawn
// as held steps with dots, so individual ADC samples are visible.
import { useEffect, useRef } from 'react';

export interface Marker { tMs: number; color?: string; label?: string; kind?: 'tick' | 'triangle' }
export interface Band { t0: number; t1: number; color: string }
export interface HLine { value: number; color: string; label?: string; dashed?: boolean }
export interface Bars { tMs: number[]; widthMs: number; value: number[]; color: string; label: string }

export interface WaveProps {
  title: string;
  unit: string;
  data: ArrayLike<number>;
  /** Samples per second of `data`. */
  rateHz: number;
  /** Multiplied into each value for display (e.g. V → mV). */
  scale?: number;
  t0: number;
  t1: number;
  playheadMs: number;
  color?: string;
  height?: number;
  /** Draw as sample-and-hold steps with dots when the samples are sparse on screen. */
  discrete?: boolean;
  /** Fixed y range; otherwise fitted to the visible data. */
  yRange?: [number, number];
  hlines?: HLine[];
  markers?: Marker[];
  bands?: Band[];
  bars?: Bars;
  note?: string;
  dimmed?: boolean;
  showTimeAxis?: boolean;
  onSeek?: (tMs: number) => void;
  testId?: string;
  valueDigits?: number;
}

/** A colour token as seen from `el` (tokens are redefined on the dark scenes, so the root value would be wrong there). */
function cssOf(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}
const nice = (v: number, digits = 3) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(Math.min(1, digits));
  if (a >= 10) return v.toFixed(Math.min(2, digits));
  return v.toFixed(digits);
};

export function Wave(p: WaveProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const h = p.height ?? 96;
  const scale = p.scale ?? 1;
  const idx = Math.min(p.data.length - 1, Math.max(0, Math.floor((p.playheadMs / 1000) * p.rateHz)));
  const valueNow = p.data.length ? p.data[idx] * scale : NaN;

  useEffect(() => {
    const canvas = ref.current, box = wrap.current;
    if (!canvas || !box) return;
    const draw = () => {
      const w = Math.max(120, box.clientWidth);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext('2d');
      if (!g) return;
      const css = (name: string, fallback: string) => cssOf(canvas, name, fallback);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const padL = 54, padR = 8, padT = 6, padB = p.showTimeAxis ? 18 : 6;
      const pw = w - padL - padR, ph = h - padT - padB;
      const fg = css('--fg-tertiary', '#6B757D'), grid = css('--border-soft', '#E7E9E7'), line = p.color ?? css('--accent', '#176B62');
      const { t0, t1 } = p;
      const xOf = (t: number) => padL + ((t - t0) / (t1 - t0)) * pw;
      const i0 = Math.max(0, Math.floor((t0 / 1000) * p.rateHz)), i1 = Math.min(p.data.length - 1, Math.ceil((t1 / 1000) * p.rateHz));
      // y range
      let lo = Infinity, hi = -Infinity;
      if (p.yRange) [lo, hi] = p.yRange;
      else {
        for (let i = i0; i <= i1; i++) { const v = p.data[i] * scale; if (v < lo) lo = v; if (v > hi) hi = v; }
        for (const l of p.hlines ?? []) { if (l.value < lo) lo = l.value; if (l.value > hi) hi = l.value; }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = -1; hi = 1; }
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      }
      const yOf = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * ph;
      // bands (e.g. burst window)
      for (const b of p.bands ?? []) {
        const x0 = Math.max(padL, xOf(b.t0)), x1 = Math.min(padL + pw, xOf(b.t1));
        if (x1 > x0) { g.fillStyle = b.color; g.fillRect(x0, padT, x1 - x0, ph); }
      }
      // frame + zero line
      g.strokeStyle = grid; g.lineWidth = 1;
      g.strokeRect(padL + 0.5, padT + 0.5, pw - 1, ph - 1);
      if (lo < 0 && hi > 0) { g.beginPath(); g.moveTo(padL, Math.round(yOf(0)) + 0.5); g.lineTo(padL + pw, Math.round(yOf(0)) + 0.5); g.stroke(); }
      // y labels
      g.fillStyle = fg; g.font = `10.5px ${css('--mono', 'ui-monospace, Menlo, monospace')}`; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(nice(hi, 2), padL - 5, padT + 6);
      g.fillText(nice(lo, 2), padL - 5, padT + ph - 6);
      // bars (e.g. window energy), scaled to the panel height independently and labelled
      if (p.bars && p.bars.value.length) {
        const max = Math.max(1, ...p.bars.value);
        g.fillStyle = p.bars.color;
        p.bars.tMs.forEach((t, k) => {
          const x0 = xOf(t - p.bars!.widthMs), x1 = xOf(t);
          if (x1 < padL || x0 > padL + pw) return;
          const bh = (p.bars!.value[k] / max) * (ph - 4);
          g.fillRect(Math.max(padL, x0) + 0.5, padT + ph - bh, Math.max(1, Math.min(padL + pw, x1) - Math.max(padL, x0) - 1), bh);
        });
      }
      // horizontal reference lines
      for (const l of p.hlines ?? []) {
        const y = Math.round(yOf(l.value)) + 0.5;
        if (y < padT || y > padT + ph) continue;
        g.strokeStyle = l.color; g.setLineDash(l.dashed ? [4, 3] : []);
        g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke(); g.setLineDash([]);
        if (l.label) { g.fillStyle = l.color; g.textAlign = 'left'; g.fillText(l.label, padL + 4, y - 6); }
      }
      // the series
      g.save();
      g.beginPath(); g.rect(padL, padT, pw, ph); g.clip();
      g.strokeStyle = line; g.fillStyle = line; g.lineWidth = 1.25; g.globalAlpha = p.dimmed ? 0.45 : 1;
      const n = i1 - i0 + 1;
      const tOf = (i: number) => (i / p.rateHz) * 1000;
      if (n > pw * 1.5) {
        // more samples than pixels: draw the min–max envelope per pixel column
        g.beginPath();
        for (let px = 0; px < pw; px++) {
          const a = i0 + Math.floor((px / pw) * n), b = Math.min(i1, i0 + Math.floor(((px + 1) / pw) * n));
          let mn = Infinity, mx = -Infinity;
          for (let i = a; i <= b; i++) { const v = p.data[i] * scale; if (v < mn) mn = v; if (v > mx) mx = v; }
          const x = padL + px + 0.5;
          g.moveTo(x, yOf(mx)); g.lineTo(x, yOf(mn) + 0.75);
        }
        g.stroke();
      } else if (p.discrete) {
        g.beginPath();
        for (let i = i0; i <= i1; i++) {
          const x = xOf(tOf(i)), xn = xOf(tOf(i + 1)), y = yOf(p.data[i] * scale);
          if (i === i0) g.moveTo(x, y); else g.lineTo(x, y);
          g.lineTo(xn, y);
        }
        g.stroke();
        if (n < pw / 5) for (let i = i0; i <= i1; i++) { g.beginPath(); g.arc(xOf(tOf(i)), yOf(p.data[i] * scale), 2.2, 0, Math.PI * 2); g.fill(); }
      } else {
        g.beginPath();
        for (let i = i0; i <= i1; i++) { const x = xOf(tOf(i)), y = yOf(p.data[i] * scale); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      g.restore();
      // markers
      for (const m of p.markers ?? []) {
        if (m.tMs < t0 || m.tMs > t1) continue;
        const x = xOf(m.tMs);
        g.fillStyle = m.color ?? css('--warn', '#8A6400'); g.strokeStyle = g.fillStyle;
        if (m.kind === 'triangle') { g.beginPath(); g.moveTo(x, padT + 9); g.lineTo(x - 4.5, padT + 1); g.lineTo(x + 4.5, padT + 1); g.closePath(); g.fill(); }
        else { g.beginPath(); g.moveTo(x + 0.5, padT + ph - 9); g.lineTo(x + 0.5, padT + ph - 1); g.stroke(); }
      }
      // time axis
      if (p.showTimeAxis) {
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'top';
        const span = t1 - t0;
        const step = [0.5, 1, 2, 5, 10, 20, 50, 100].find((s) => span / s <= 9) ?? 100;
        for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) g.fillText(`${+t.toFixed(1)} ms`, xOf(t), padT + ph + 4);
      }
      // playhead
      if (p.playheadMs >= t0 && p.playheadMs <= t1) {
        const x = Math.round(xOf(p.playheadMs)) + 0.5;
        g.strokeStyle = css('--fg', '#20272D'); g.lineWidth = 1; g.globalAlpha = 0.8;
        g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); g.globalAlpha = 1;
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); };
  });

  const seekFrom = (e: React.PointerEvent) => {
    if (!p.onSeek || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const f = (e.clientX - r.left - 54) / Math.max(1, r.width - 62);
    p.onSeek(p.t0 + Math.max(0, Math.min(1, f)) * (p.t1 - p.t0));
  };

  return (
    <figure className={`wave${p.dimmed ? ' dimmed' : ''}`} data-testid={p.testId}>
      <figcaption>
        <span className="wave-title">{p.title}</span>
        <span className="wave-unit">{p.unit}</span>
        <span className="wave-now mono" data-testid={p.testId ? `${p.testId}-now` : undefined}>{nice(valueNow, p.valueDigits ?? 2)} {p.unit}</span>
        {p.bars && <span className="wave-bars"><span className="sw" style={{ background: p.bars.color }} />{p.bars.label}</span>}
        {p.note && <span className="wave-note">{p.note}</span>}
      </figcaption>
      <div
        ref={wrap}
        className="wave-canvas"
        style={{ height: h }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); seekFrom(e); }}
        onPointerMove={(e) => { if (e.buttons) seekFrom(e); }}
      >
        <canvas ref={ref} style={{ width: '100%', height: h }} role="img" aria-label={`${p.title}, in ${p.unit}. Value at the playhead: ${nice(valueNow, 2)} ${p.unit}.`} />
      </div>
    </figure>
  );
}
