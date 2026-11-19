// Read design tokens from CSS at draw time so canvases, SVGs and Three.js agree with the active theme.
import type { ProcMode } from './types';

let cacheTheme = '';
const cache = new Map<string, string>();

/** Value of a CSS custom property on <html> for the current theme (cached per theme). */
export function cssVar(name: string, fallback = '#888888'): string {
  if (typeof document === 'undefined') return fallback;
  const t = document.documentElement.getAttribute('data-theme') ?? 'paper';
  if (t !== cacheTheme) {
    cache.clear();
    cacheTheme = t;
  }
  let v = cache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    cache.set(name, v);
  }
  return v;
}

/** #rrggbb → rgba(r,g,b,a). Passes other formats through with the alpha appended when possible. */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const r = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (r) {
    const parts = r[1].split(',').slice(0, 3).map((s) => s.trim());
    return `rgba(${parts.join(',')},${a})`;
  }
  return color;
}

export const modeColor = (m: ProcMode) => cssVar(`--mode-${m.toLowerCase()}`);
export const channelColor = (ch: number) => cssVar(`--ch${Math.max(0, Math.min(7, ch))}`);

/** Palette used by the signal-lab canvases; call inside draw() so it follows the theme. */
export function plotPalette() {
  return {
    grid: withAlpha(cssVar('--fg-tertiary'), 0.18),
    axis: cssVar('--fg-tertiary'),
    text: cssVar('--fg-secondary'),
    raw: cssVar('--info'),
    rawSel: cssVar('--fg'),
    filtered: cssVar('--accent'),
    baseline: cssVar('--warn'),
    band: withAlpha(cssVar('--warn'), 0.12),
    bandEdge: withAlpha(cssVar('--warn'), 0.5),
    energy: cssVar('--mode-feature'),
    event: cssVar('--mode-event'),
    hit: cssVar('--ok'),
    miss: cssVar('--danger'),
    fp: cssVar('--danger'),
    cursor: cssVar('--accent'),
    selection: cssVar('--fg'),
    truth: withAlpha(cssVar('--ev-scripted'), 0.16),
    focusRow: withAlpha(cssVar('--accent'), 0.08),
    canvasBg: cssVar('--surface-sunken'),
    digital1: cssVar('--ok'),
    digitalBus: cssVar('--info'),
    digitalHl: cssVar('--accent'),
  };
}
