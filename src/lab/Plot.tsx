import { useEffect, useRef } from 'react';

/** Canvas that redraws whenever `deps` change or it is resized. */
export function Plot({ draw, deps, height, onClick, onDrag, testId, title }: {
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  deps: unknown[];
  height: number | string;
  onClick?: (fx: number, fy: number, width: number) => void;
  onDrag?: (fx0: number, fx1: number, done: boolean) => void;
  testId?: string;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const paint = () => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
    if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
    const g = el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    drawRef.current(g, w, h);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(paint, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const frac = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };

  return (
    <canvas
      ref={ref}
      title={title}
      data-testid={testId}
      style={{ width: '100%', height, display: 'block', cursor: onDrag ? 'ew-resize' : onClick ? 'crosshair' : 'default' }}
      onMouseDown={(e) => { if (onDrag) dragRef.current = frac(e)[0]; }}
      onMouseMove={(e) => { if (onDrag && dragRef.current !== null) onDrag(dragRef.current, frac(e)[0], false); }}
      onMouseUp={(e) => {
        const [fx, fy] = frac(e);
        if (onDrag && dragRef.current !== null) {
          const a = dragRef.current;
          dragRef.current = null;
          if (Math.abs(fx - a) > 0.01) { onDrag(a, fx, true); return; }
        }
        onClick?.(fx, fy, ref.current!.getBoundingClientRect().width);
      }}
      onMouseLeave={() => { dragRef.current = null; }}
    />
  );
}
