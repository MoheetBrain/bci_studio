import { useEffect, useRef } from 'react';
import { NUM_CH } from './model';
import type { LabData } from './labStore';
import { plotPalette } from '../model/theme';
import { useScene } from '../state/sceneStore';

interface Props {
  data: LabData;
  cursor: number;
  selectedCh: number | null;
  windowT: number;                 // samples per channel shown
  flowCh: number | null;
  onSeek: (i: number, ch: number) => void;
}

function colors() {
  const p = plotPalette();
  return { grid: p.grid, sig: p.raw, sigSel: p.rawSel, base: p.baseline, band: p.band, bandEdge: p.bandEdge, ev: p.event, fp: p.fp, hit: p.hit, miss: p.miss, text: p.text, cursor: p.cursor, focusRow: p.focusRow };
}

/** Index of the last sample of channel `ch` at or before global index `cursor`. */
export function channelT(data: LabData, ch: number, cursor: number): number {
  const arr = data.perCh[ch].i;
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= cursor) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function rowLayout(h: number, sel: number | null) {
  const rows: { y: number; h: number }[] = [];
  if (sel === null) {
    const rh = h / NUM_CH;
    for (let c = 0; c < NUM_CH; c++) rows.push({ y: c * rh, h: rh });
  } else {
    const big = h * 0.42;
    const small = (h - big) / (NUM_CH - 1);
    let y = 0;
    for (let c = 0; c < NUM_CH; c++) {
      const rh = c === sel ? big : small;
      rows.push({ y, h: rh });
      y += rh;
    }
  }
  return rows;
}

export function WaveCanvas({ data, cursor, selectedCh, windowT, flowCh, onSeek }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  useScene((s) => s.theme); // redraw when the theme changes

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
  });

  function draw() {
    const el = ref.current;
    if (!el) return;
    const { w, h } = { w: el.clientWidth, h: el.clientHeight };
    if (w === 0 || h === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
    if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
    const g = el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const COL = colors();

    const labelW = 34;
    const plotW = w - labelW - 6;
    const rows = rowLayout(h, selectedCh);
    const thr = data.cfg.threshold;

    for (let ch = 0; ch < NUM_CH; ch++) {
      const { y, h: rh } = rows[ch];
      const pc = data.perCh[ch];
      const tCur = channelT(data, ch, cursor);
      const t0 = Math.max(0, tCur - windowT + 1);
      const tx = (t: number) => labelW + ((t - (tCur - windowT + 1)) / (windowT - 1)) * plotW;

      // row background + label
      if (ch === flowCh) {
        g.fillStyle = COL.focusRow;
        g.fillRect(0, y, w, rh);
      }
      g.strokeStyle = COL.grid;
      g.beginPath();
      g.moveTo(0, y + rh - 0.5);
      g.lineTo(w, y + rh - 0.5);
      g.stroke();
      g.fillStyle = ch === selectedCh ? plotPalette().selection : COL.text;
      g.font = '10px SF Mono, Menlo, monospace';
      g.fillText(`ch${ch}`, 6, y + Math.min(rh / 2 + 4, 14));
      if (tCur < 0) continue;

      // vertical scale from the window
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = t0; t <= tCur; t++) {
        const x = pc.x[t];
        const b = pc.baseInt[t];
        lo = Math.min(lo, x, b - thr);
        hi = Math.max(hi, x, b + thr);
      }
      const pad = (hi - lo) * 0.08 + 1;
      lo -= pad;
      hi += pad;
      const ty = (v: number) => y + rh - 2 - ((v - lo) / (hi - lo)) * (rh - 4);

      // threshold band around the baseline (|x - b| < thr = no event)
      if (thr > 0) {
        g.fillStyle = COL.band;
        g.beginPath();
        for (let t = t0; t <= tCur; t++) g.lineTo(tx(t), ty(pc.baseInt[t] + thr));
        for (let t = tCur; t >= t0; t--) g.lineTo(tx(t), ty(pc.baseInt[t] - thr));
        g.closePath();
        g.fill();
        if (rh > 40) {
          g.strokeStyle = COL.bandEdge;
          g.setLineDash([3, 3]);
          for (const sgn of [1, -1]) {
            g.beginPath();
            for (let t = t0; t <= tCur; t++) g.lineTo(tx(t), ty(pc.baseInt[t] + sgn * thr));
            g.stroke();
          }
          g.setLineDash([]);
        }
      }
      // baseline
      g.strokeStyle = COL.base;
      g.lineWidth = 1;
      g.beginPath();
      for (let t = t0; t <= tCur; t++) g.lineTo(tx(t), ty(pc.baseInt[t]));
      g.stroke();
      // signal
      g.strokeStyle = ch === selectedCh ? COL.sigSel : COL.sig;
      g.lineWidth = ch === selectedCh ? 1.4 : 1;
      g.beginPath();
      for (let t = t0; t <= tCur; t++) g.lineTo(tx(t), ty(pc.x[t]));
      g.stroke();
      g.lineWidth = 1;
    }

    // ground-truth spikes (triangles at the row bottom) and events (vertical bars)
    data.spikes.forEach((s, j) => {
      const { y, h: rh } = rows[s.ch];
      const tCur = channelT(data, s.ch, cursor);
      if (s.t > tCur - 3 || s.t < tCur - windowT + 1) return;
      const x = labelW + ((s.t - (tCur - windowT + 1)) / (windowT - 1)) * plotW;
      const hit = data.score.spikeHit[j];
      g.fillStyle = hit ? COL.hit : COL.miss;
      g.beginPath();
      g.moveTo(x, y + rh - 7);
      g.lineTo(x - 4, y + rh - 1);
      g.lineTo(x + 4, y + rh - 1);
      g.closePath();
      if (hit) g.fill();
      else {
        g.strokeStyle = COL.miss;
        g.stroke();
      }
    });
    data.events.forEach((e, k) => {
      if (e.i > cursor) return;
      const { y, h: rh } = rows[e.ch];
      const tCur = channelT(data, e.ch, cursor);
      if (e.t < tCur - windowT + 1) return;
      const x = labelW + ((e.t - (tCur - windowT + 1)) / (windowT - 1)) * plotW;
      const fp = (data.score.eventMatch.get(k) ?? -1) < 0;
      g.fillStyle = fp ? COL.fp : COL.ev;
      g.fillRect(x - 1, y + 2, 2, rh - 10);
      g.beginPath();
      g.arc(x, y + 4, 2.5, 0, Math.PI * 2);
      g.fill();
    });

    // cursor
    g.strokeStyle = COL.cursor;
    g.beginPath();
    g.moveTo(labelW + plotW + 0.5, 0);
    g.lineTo(labelW + plotW + 0.5, h);
    g.stroke();
  }

  function onClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const rows = rowLayout(r.height, selectedCh);
    const ch = Math.max(0, rows.findIndex((row) => py >= row.y && py < row.y + row.h));
    const labelW = 34;
    const plotW = r.width - labelW - 6;
    const tCur = channelT(data, ch, cursor);
    const t = Math.round(tCur - windowT + 1 + ((px - labelW) / plotW) * (windowT - 1));
    const tt = Math.max(0, Math.min(data.perCh[ch].i.length - 1, t));
    onSeek(data.perCh[ch].i[tt], ch);
  }

  return (
    <canvas
      ref={ref}
      onClick={onClick}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
      aria-label="Eight-channel neural signal display"
      data-testid="wave-canvas"
    />
  );
}
