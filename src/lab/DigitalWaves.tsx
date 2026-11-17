import { useEffect, useRef } from 'react';
import type { WaveSignal } from '../artifacts/types';
import { plotPalette } from '../model/theme';
import { useScene } from '../state/sceneStore';

/** Logic-analyser view of RTL waveform change lists around a cycle. */
export function DigitalWaves({ waves, cycle, span = 64, highlight }: {
  waves: WaveSignal[];
  cycle: number;
  span?: number;
  highlight?: (name: string) => boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useScene((s) => s.theme);

  useEffect(() => {
    const P = plotPalette();
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const g = el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const nameW = 150;
    const c0 = cycle - Math.floor(span * 0.75);
    const c1 = c0 + span;
    const cx = (c: number) => nameW + ((c - c0) / span) * (w - nameW - 4);
    const rowH = Math.max(14, Math.min(24, h / Math.max(1, waves.length)));
    g.font = '10px SF Mono, Menlo, monospace';

    // cycle grid
    g.strokeStyle = P.grid;
    for (let c = Math.ceil(c0 / 8) * 8; c < c1; c += 8) {
      g.beginPath();
      g.moveTo(cx(c), 0);
      g.lineTo(cx(c), h);
      g.stroke();
    }

    waves.forEach((sig, r) => {
      const y = r * rowH;
      const hi = y + 3;
      const lo = y + rowH - 3;
      const hl = highlight?.(sig.name);
      g.fillStyle = hl ? P.selection : P.text;
      g.fillText(sig.name.length > 22 ? '…' + sig.name.slice(-21) : sig.name, 4, y + rowH / 2 + 3);
      // value at c0
      let k = 0;
      let val = 0;
      while (k < sig.changes.length && sig.changes[k][0] <= c0) { val = sig.changes[k][1]; k++; }
      const segs: [number, number, number][] = [];
      let start = c0;
      for (; k < sig.changes.length && sig.changes[k][0] < c1; k++) {
        segs.push([start, sig.changes[k][0], val]);
        start = sig.changes[k][0];
        val = sig.changes[k][1];
      }
      segs.push([start, c1, val]);
      g.strokeStyle = hl ? P.digitalHl : sig.width === 1 ? P.digital1 : P.digitalBus;
      g.lineWidth = 1.2;
      if (sig.width === 1) {
        g.beginPath();
        segs.forEach(([a, b, v], j) => {
          const yy = v ? hi : lo;
          if (j === 0) g.moveTo(cx(a), yy);
          else g.lineTo(cx(a), yy);
          g.lineTo(cx(b), yy);
        });
        g.stroke();
      } else {
        segs.forEach(([a, b, v]) => {
          const xa = cx(a);
          const xb = cx(b);
          g.beginPath();
          g.moveTo(xa + 2, hi);
          g.lineTo(xb - 2, hi);
          g.lineTo(xb, (hi + lo) / 2);
          g.lineTo(xb - 2, lo);
          g.lineTo(xa + 2, lo);
          g.lineTo(xa, (hi + lo) / 2);
          g.closePath();
          g.stroke();
          if (xb - xa > 26) {
            g.fillStyle = P.text;
            const signed = v >= 2 ** (sig.width - 1) && sig.name.includes('sample') ? v - 2 ** sig.width : v;
            g.fillText(String(signed), xa + 4, (hi + lo) / 2 + 3);
          }
        });
      }
    });
    // cursor
    g.strokeStyle = P.cursor;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx(cycle) + 0.5, 0);
    g.lineTo(cx(cycle) + 0.5, h);
    g.stroke();
    g.fillStyle = P.cursor;
    g.fillText(`cycle ${cycle}`, cx(cycle) + 4, h - 4);
  });

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} data-testid="digital-waves" />;
}
