// Small canvas plots for the Experiment scene: a multi-row strip over time (rasters, heat rows, step rows) and the
// cursor workspace. Both are pure functions of their props.
import { useEffect, useRef } from 'react';
import { TARGET_RADIUS, type MotorRun } from './model/motor';

export interface StripRow {
  label: string;
  color: string;
  /** Event times, seconds (drawn as ticks). */
  events?: ArrayLike<number>;
  /** Optional per-event flag: false draws the tick dimmed/red (e.g. a crossing no model neuron caused). */
  eventOk?: ArrayLike<number>;
  /** One value per bin (drawn as a heat row, or as a line when `line` is set). */
  values?: { data: ArrayLike<number>; stride: number; offset: number; binS: number; min: number; max: number };
  line?: boolean;
  emphasis?: boolean;
}

export function Strip(p: { rows: StripRow[]; t0: number; t1: number; playhead: number; rowH?: number; onSeek?: (t: number) => void; bands?: Array<{ t0: number; t1: number; color: string; label?: string }>; testId?: string; title?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null), wrap = useRef<HTMLDivElement | null>(null);
  const rowH = p.rowH ?? 14, padL = 74, padR = 8, padT = 4, padB = 16;
  const h = padT + padB + p.rows.length * rowH;
  useEffect(() => {
    const canvas = ref.current, box = wrap.current;
    if (!canvas || !box) return;
    const draw = () => {
      const w = Math.max(160, box.clientWidth), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const pw = w - padL - padR, xOf = (t: number) => padL + ((t - p.t0) / (p.t1 - p.t0)) * pw;
      for (const b of p.bands ?? []) {
        const x0 = Math.max(padL, xOf(b.t0)), x1 = Math.min(padL + pw, xOf(b.t1));
        if (x1 <= x0) continue;
        g.fillStyle = b.color; g.fillRect(x0, padT, x1 - x0, h - padT - padB);
        if (b.label && x1 - x0 > 30) { g.fillStyle = 'rgba(232,238,249,.7)'; g.font = '10px ui-monospace, Menlo, monospace'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(b.label, x0 + 3, h - padB + 3); }
      }
      g.font = '10.5px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
      p.rows.forEach((r, i) => {
        const y = padT + i * rowH;
        g.fillStyle = r.emphasis ? '#EAFBFF' : '#8FA0BF'; g.textAlign = 'right';
        g.fillText(r.label, padL - 6, y + rowH / 2);
        if (r.values) {
          const v = r.values, k0 = Math.max(0, Math.floor(p.t0 / v.binS)), k1 = Math.min(Math.floor(v.data.length / v.stride) - 1, Math.ceil(p.t1 / v.binS));
          if (r.line) {
            g.strokeStyle = r.color; g.lineWidth = 1.4; g.beginPath();
            for (let k = k0; k <= k1; k++) {
              const u = Math.max(0, Math.min(1, (v.data[k * v.stride + v.offset] - v.min) / (v.max - v.min)));
              const x = xOf((k + 0.5) * v.binS), yy = y + rowH - 1.5 - u * (rowH - 3);
              if (k === k0) g.moveTo(x, yy); else g.lineTo(x, yy);
            }
            g.save(); g.beginPath(); g.rect(padL, y, pw, rowH); g.clip();
            g.beginPath();
            for (let k = k0; k <= k1; k++) {
              const u = Math.max(0, Math.min(1, (v.data[k * v.stride + v.offset] - v.min) / (v.max - v.min)));
              const x = xOf((k + 0.5) * v.binS), yy = y + rowH - 1.5 - u * (rowH - 3);
              if (k === k0) g.moveTo(x, yy); else g.lineTo(x, yy);
            }
            g.stroke(); g.restore();
          } else {
            for (let k = k0; k <= k1; k++) {
              const u = Math.max(0, Math.min(1, (v.data[k * v.stride + v.offset] - v.min) / (v.max - v.min)));
              if (u <= 0.01) continue;
              const x0 = Math.max(padL, xOf(k * v.binS)), x1 = Math.min(padL + pw, xOf((k + 1) * v.binS));
              if (x1 <= x0) continue;
              g.globalAlpha = 0.12 + 0.88 * u; g.fillStyle = r.color; g.fillRect(x0, y + 1.5, Math.max(1, x1 - x0 - 0.5), rowH - 3); g.globalAlpha = 1;
            }
          }
        }
        if (r.events) {
          const e = r.events;
          // binary search for the first event in view
          let lo = 0, hi = e.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (e[m] < p.t0) lo = m + 1; else hi = m; }
          for (let i2 = lo; i2 < e.length && e[i2] <= p.t1; i2++) {
            const ok = !r.eventOk || r.eventOk[i2];
            g.strokeStyle = ok ? r.color : '#FF8A8A'; g.lineWidth = r.emphasis ? 1.6 : 1.1;
            const x = Math.round(xOf(e[i2])) + 0.5;
            g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x, y + rowH - 2); g.stroke();
          }
        }
      });
      // time axis
      g.fillStyle = '#6F7C97'; g.textAlign = 'center'; g.textBaseline = 'top';
      const span = p.t1 - p.t0, step = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5].find((s) => span / s <= 8) ?? 5;
      for (let t = Math.ceil(p.t0 / step) * step; t <= p.t1 + 1e-9; t += step) if (!(p.bands ?? []).some((b) => b.label)) g.fillText(step < 1 ? `${+(t * 1000).toFixed(1)} ms` : `${+t.toFixed(1)} s`, xOf(t), h - padB + 3);
      if (p.playhead >= p.t0 && p.playhead <= p.t1) { const x = Math.round(xOf(p.playhead)) + 0.5; g.strokeStyle = '#F5F8FF'; g.globalAlpha = 0.85; g.lineWidth = 1; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); g.globalAlpha = 1; }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  });
  const seek = (e: React.PointerEvent) => {
    if (!p.onSeek || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect(), f = (e.clientX - r.left - padL) / Math.max(1, r.width - padL - padR);
    p.onSeek(p.t0 + Math.max(0, Math.min(1, f)) * (p.t1 - p.t0));
  };
  return (
    <figure className="strip" data-testid={p.testId}>
      {p.title && <figcaption>{p.title}</figcaption>}
      <div ref={wrap} style={{ height: h }} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); seek(e); }} onPointerMove={(e) => { if (e.buttons) seek(e); }}>
        <canvas ref={ref} style={{ width: '100%', height: h, cursor: p.onSeek ? 'pointer' : undefined }} role="img" aria-label={p.title ?? 'Activity over time'} />
      </div>
    </figure>
  );
}

/** The cursor task: target, cursor with its trail, the intended and the decoded velocity, and the decoder's uncertainty. */
export function CursorPad({ run, k, size = 300 }: { run: MotorRun; k: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr; canvas.height = size * dpr;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const c = size / 2, sc = (size / 2 - 10) / 1.15, X = (x: number) => c + x * sc, Y = (y: number) => c - y * sc;
    g.strokeStyle = 'rgba(150,185,245,.22)'; g.lineWidth = 1;
    g.strokeRect(X(-1.15), Y(1.15), 2.3 * sc, 2.3 * sc);
    g.beginPath(); g.moveTo(X(-1.15), Y(0)); g.lineTo(X(1.15), Y(0)); g.moveTo(X(0), Y(1.15)); g.lineTo(X(0), Y(-1.15)); g.stroke();
    const tx = run.targetXY[k * 2], ty = run.targetXY[k * 2 + 1];
    if (Number.isFinite(tx)) {
      g.fillStyle = 'rgba(140,255,181,.16)'; g.strokeStyle = '#8CFFB5'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X(tx), Y(ty), TARGET_RADIUS * sc, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // trail: the last two seconds
    g.strokeStyle = 'rgba(127,231,255,.55)'; g.lineWidth = 1.5; g.beginPath();
    for (let j = Math.max(0, k - 40); j <= k; j++) { const x = X(run.cursor[j * 2]), y = Y(run.cursor[j * 2 + 1]); if (j === Math.max(0, k - 40)) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    const cx = run.cursor[k * 2], cy = run.cursor[k * 2 + 1];
    const arrow = (vx: number, vy: number, color: string, dash: number[]) => {
      const L = 0.42;
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2; g.setLineDash(dash);
      g.beginPath(); g.moveTo(X(cx), Y(cy)); g.lineTo(X(cx + vx * L), Y(cy + vy * L)); g.stroke(); g.setLineDash([]);
      const a = Math.atan2(-vy, vx), ex = X(cx + vx * L), ey = Y(cy + vy * L);
      if (Math.hypot(vx, vy) > 0.05) { g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - 7 * Math.cos(a - 0.4), ey - 7 * Math.sin(a - 0.4)); g.lineTo(ex - 7 * Math.cos(a + 0.4), ey - 7 * Math.sin(a + 0.4)); g.closePath(); g.fill(); }
    };
    // uncertainty of the decoded velocity, drawn around the tip of the decoded arrow
    const dx = run.decoded[k * 2], dy = run.decoded[k * 2 + 1], sx = run.decodedSd[k * 2], sy = run.decodedSd[k * 2 + 1];
    if (run.valid[k]) {
      g.fillStyle = 'rgba(215,184,255,.14)'; g.strokeStyle = 'rgba(215,184,255,.6)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(X(cx + dx * 0.42), Y(cy + dy * 0.42), Math.max(1, sx * 0.42 * sc), Math.max(1, sy * 0.42 * sc), 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    arrow(run.intent[k * 2], run.intent[k * 2 + 1], '#FFD08A', [4, 3]);
    arrow(dx, dy, '#D7B8FF', []);
    g.fillStyle = '#7FE7FF'; g.beginPath(); g.arc(X(cx), Y(cy), 5, 0, Math.PI * 2); g.fill();
  }, [run, k, size]);
  return <canvas ref={ref} className="cursor-pad" style={{ width: size, height: size }} role="img" aria-label="Cursor workspace: target, cursor, intended velocity and decoded velocity" data-testid="cursor-pad" />;
}
