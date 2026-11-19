// Theme-aware look of the logical block map (die level) and its tile textures.
// The tiles carry NO pseudo-random "standard-cell rows" or metal stripes: the v0.3 core has no layout, so
// the map must not show anything that looks like placed cells. A tile is a clean label card for one RTL
// instance at a conceptual position. Paper theme: warm white / charcoal / copper / restrained teal.
import { canvasTexture } from '../three/materials';

export interface DieLook {
  dark: boolean;
  substrate: string;     // die body (bare silicon stand-in, mid tone so white pads and pale tiles read)
  ring: string;          // seal ring / edge
  core: string;          // hbci_readout_core plate
  plate: string;         // sub-plates (legacy core cluster, RAW lane)
  tileBody: string;      // tile side walls
  tileFace: string;      // tile top background
  text: string;          // primary label
  textSub: string;       // secondary label
  pad: string;           // illustrative contact pads
  padEdge: string;
}

export function dieLook(dark: boolean): DieLook {
  return dark
    ? { dark, substrate: '#2b3036', ring: '#a4633a', core: '#353b42', plate: '#3c434b', tileBody: '#2c3139', tileFace: '#262b31', text: '#eef0f2', textSub: '#b8c0c8', pad: '#d9dde1', padEdge: '#8c949c' }
    : { dark, substrate: '#b9b4aa', ring: '#a4633a', core: '#efebe3', plate: '#e3ded3', tileBody: '#d8d3c8', tileFace: '#fbfaf7', text: '#20272d', textSub: '#4d5760', pad: '#fbfbf9', padEdge: '#6b757d' };
}

const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

/** Word-wrap `text` into at most `max` lines that fit `width` at the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= width || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    const keep = lines.slice(0, max);
    keep[max - 1] = `${keep[max - 1]}…`;
    return keep;
  }
  return lines;
}

/**
 * Label card for one tile: primary name (friendly in Learn mode, instance in Expert), a secondary line
 * (instance in Learn, friendly in Expert) and the cell count. `mono` says which line is a Verilog name.
 */
export function tileTexture(o: {
  primary: string; secondary: string; mono: 'primary' | 'secondary' | null; cellsLabel: string; tint: string;
  w: number; h: number; dark: boolean; labelAt?: number; labelH?: number;
  lanes?: { n: number; z0: number; z1: number; x: number };
}) {
  const L = dieLook(o.dark);
  const PX = 220;
  const cw = Math.max(64, Math.round(o.w * PX));
  const ch = Math.max(64, Math.round(o.h * PX));
  return canvasTexture(cw, ch, (ctx) => {
    ctx.fillStyle = L.tileFace;
    ctx.fillRect(0, 0, cw, ch);
    // soft identity wash + strong border in the block colour
    ctx.globalAlpha = o.dark ? 0.16 : 0.12;
    ctx.fillStyle = o.tint;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.tint;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, cw - 6, ch - 6);

    if (o.lanes) {
      const { n, z0, z1, x } = o.lanes;
      ctx.fillStyle = L.textSub;
      ctx.font = `600 ${Math.round(((z1 - z0) * ch) / n / 2.4)}px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) ctx.fillText(`ch${i}`, x * cw, (z0 + ((i + 0.5) * (z1 - z0)) / n) * ch);
    }

    const vertical = ch > cw * 1.8 && !o.lanes;
    ctx.save();
    ctx.translate(cw / 2, ch * (o.labelAt ?? 0.5));
    if (vertical) ctx.rotate(-Math.PI / 2);
    const avail = (vertical ? ch : cw) - 24;
    const across = (vertical ? cw : ch * (o.labelH ?? 1)) - 12;
    const fPrim = o.mono === 'primary' ? MONO : FONT;
    const fSec = o.mono === 'secondary' ? MONO : FONT;
    let big = Math.min(44, across / 3.4);
    ctx.font = `700 ${big}px ${fPrim}`;
    let lines = wrap(ctx, o.primary, avail, 2);
    while (big > 12 && lines.some((l) => ctx.measureText(l).width > avail)) {
      big -= 2;
      ctx.font = `700 ${big}px ${fPrim}`;
      lines = wrap(ctx, o.primary, avail, 2);
    }
    const small = Math.max(10, big * 0.58);
    const blockH = lines.length * big * 1.12 + small * 2.6;
    if (blockH > across + 4 && lines.length > 1) lines = wrap(ctx, o.primary, avail, 1);
    const top = -(lines.length * big * 1.12 + small * 2.6) / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = L.text;
    lines.forEach((l, k) => ctx.fillText(l, 0, top + k * big * 1.12));
    let y = top + lines.length * big * 1.12 + small * 0.25;
    if (o.secondary) {
      ctx.font = `600 ${small}px ${fSec}`;
      ctx.fillStyle = o.tint;
      ctx.fillText(fitText(ctx, o.secondary, avail), 0, y);
      y += small * 1.2;
    }
    ctx.font = `500 ${small * 0.92}px ${FONT}`;
    ctx.fillStyle = L.textSub;
    ctx.fillText(fitText(ctx, o.cellsLabel, avail), 0, y);
    ctx.restore();
  });
}

function fitText(ctx: CanvasRenderingContext2D, t: string, w: number): string {
  if (ctx.measureText(t).width <= w) return t;
  let s = t;
  while (s.length > 3 && ctx.measureText(`${s}…`).width > w) s = s.slice(0, -1);
  return `${s}…`;
}

/** Plain heading painted on a plate (e.g. the legacy core cluster). */
export function plateHeader(text: string, color: string, wUnits: number, hUnits: number) {
  const PX = 220;
  const cw = Math.max(64, Math.round(wUnits * PX));
  const ch = Math.max(24, Math.round(hUnits * PX));
  return canvasTexture(cw, ch, (ctx) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let f = Math.round(ch * 0.58);
    ctx.font = `700 ${f}px ${FONT}`;
    while (f > 10 && ctx.measureText(text).width > cw - ch * 0.6) { f -= 1; ctx.font = `700 ${f}px ${FONT}`; }
    ctx.fillText(text, ch * 0.3, ch / 2);
  });
}
