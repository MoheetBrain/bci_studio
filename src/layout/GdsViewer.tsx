import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutImage } from '../artifacts/types';

const NICE_UM = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

/**
 * Pan/zoom viewer for a KLayout rendering of the final GDSII. The pixel to
 * micron mapping comes from the render metadata (region_um), so the scale bar
 * and cursor read-out are in real layout coordinates.
 */
export function GdsViewer({ image, src }: { image: LayoutImage; src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [x0, y0, x1, y1] = image.region_um;
  const fit = size.w && size.h ? Math.min(size.w / image.width_px, size.h / image.height_px) : 0;
  const s = fit * view.z;                       // screen px per image px
  const pxPerUm = (s * image.width_px) / (x1 - x0);
  const offX = (size.w - image.width_px * fit) / 2;
  const offY = (size.h - image.height_px * fit) / 2;

  const reset = useCallback(() => setView({ z: 1, x: 0, y: 0 }), []);
  useEffect(reset, [image.file, reset]);

  const toUm = (cx: number, cy: number): [number, number] => {
    const ix = (cx - offX - view.x) / s;
    const iy = (cy - offY - view.y) / s;
    return [x0 + (ix / image.width_px) * (x1 - x0), y1 - (iy / image.height_px) * (y1 - y0)];
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    const cx = e.clientX - r.left - offX;
    const cy = e.clientY - r.top - offY;
    const z = Math.min(40, Math.max(1, view.z * Math.exp(-e.deltaY * 0.0015)));
    const k = z / view.z;
    setView({ z, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k });
  };

  const bar = NICE_UM.find((u) => u * pxPerUm >= 70) ?? NICE_UM[NICE_UM.length - 1];
  const inside = cursor && cursor[0] >= x0 && cursor[0] <= x1 && cursor[1] >= y0 && cursor[1] <= y1;

  return (
    <div
      ref={box}
      data-testid="gds-viewer"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#05070d', borderRadius: 6, cursor: drag.current ? 'grabbing' : 'grab', userSelect: 'none' }}
      onWheel={onWheel}
      onDoubleClick={reset}
      onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
      onMouseUp={() => { drag.current = null; }}
      onMouseLeave={() => { drag.current = null; setCursor(null); }}
      onMouseMove={(e) => {
        const r = box.current!.getBoundingClientRect();
        setCursor(toUm(e.clientX - r.left, e.clientY - r.top));
        const d = drag.current;
        if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      }}
    >
      {fit > 0 && (
        <img
          src={src}
          alt={image.caption}
          draggable={false}
          style={{
            position: 'absolute', left: offX, top: offY, width: image.width_px * fit, height: image.height_px * fit,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0',
            imageRendering: view.z > 3 ? 'pixelated' : 'auto',
          }}
        />
      )}
      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
        <div style={{ width: bar * pxPerUm, height: 4, background: '#e6edfb', borderRadius: 2 }} />
        <span className="mono" style={{ fontSize: 11, color: '#e6edfb', textShadow: '0 0 3px #000' }}>{bar} µm</span>
      </div>
      <div className="mono" style={{ position: 'absolute', right: 10, bottom: 10, fontSize: 11, color: '#cfd8ee', background: 'rgba(5,7,13,.75)', padding: '3px 7px', borderRadius: 4, pointerEvents: 'none' }}>
        {inside ? `x ${cursor![0].toFixed(2)} µm · y ${cursor![1].toFixed(2)} µm` : 'scroll to zoom · drag to pan · double-click to fit'}
        {view.z > 1.01 && ` · ${view.z.toFixed(1)}×`}
      </div>
    </div>
  );
}
