// Bridge between the CSS design tokens (styles.css) and the 3D scene, so plots, badges and
// 3D highlights agree on every colour. Values are read from the document and refreshed when
// the theme attribute changes; consumers either read `theme3d` per frame or subscribe.
import { useSyncExternalStore } from 'react';
import { Color } from 'three';
import type { ProcMode } from '../model/types';

const FALLBACK: Record<string, string> = {
  '--surface-workspace': '#F4F3EF',
  '--surface-panel': '#FFFFFF',
  '--fg': '#20272D',
  '--fg-secondary': '#56616A',
  '--accent': '#176B62',
  '--copper': '#A4633A',
  '--silver': '#8C949C',
  '--info': '#0B5E8A',
  '--warn': '#8A6400',
  '--ev-concept': '#5F6577',
  '--ev-scripted': '#6E3FB0',
  '--path-ai': '#B03A6A',
  '--mode-event': '#8A6400',
  '--mode-raw': '#0B6F85',
  '--mode-feature': '#1E7D4A',
  '--mode-hybrid': '#176B62',
  '--ch0': '#176B62', '--ch1': '#B0532A', '--ch2': '#3B6FB6', '--ch3': '#7A4FB0',
  '--ch4': '#8A6400', '--ch5': '#1E7D4A', '--ch6': '#B03A6A', '--ch7': '#56616A',
};

/** Current value of a CSS custom property on <html> (trimmed), with a fallback. */
export function cssToken(name: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  } catch { /* no DOM */ }
  return FALLBACK[name] ?? '#808080';
}

export interface Theme3D {
  dark: boolean;
  workspace: string;
  fg: string;
  accent: string;
  copper: string;
  silver: string;
  info: string;
  concept: string;
  scripted: string;
  /** v0.4 on-chip decoder path colour. */
  ai: string;
  mode: Record<ProcMode, string>;
  ch: string[];
}

function read(): Theme3D {
  const dark = document.documentElement.getAttribute('data-theme') === 'graphite';
  return {
    dark,
    workspace: cssToken('--surface-workspace'),
    fg: cssToken('--fg'),
    accent: cssToken('--accent'),
    copper: cssToken('--copper'),
    silver: cssToken('--silver'),
    info: cssToken('--info'),
    concept: cssToken('--ev-concept'),
    scripted: cssToken('--ev-scripted'),
    ai: cssToken('--path-ai'),
    mode: { EVENT: cssToken('--mode-event'), RAW: cssToken('--mode-raw'), FEATURE: cssToken('--mode-feature'), HYBRID: cssToken('--mode-hybrid') },
    ch: Array.from({ length: 8 }, (_, i) => cssToken(`--ch${i}`)),
  };
}

/** Live theme values (mutated in place on theme change so per-frame readers stay cheap). */
export const theme3d: Theme3D = read();
/** Bumped on every refresh; React consumers can subscribe with useThemeVersion(). */
let version = 0;
const listeners = new Set<() => void>();

/** Three.js Color instances that follow the theme (shared, never mutated by consumers). */
export const themeColors = {
  accent: new Color(theme3d.accent),
  copper: new Color(theme3d.copper),
  fg: new Color(theme3d.fg),
  workspace: new Color(theme3d.workspace),
  ai: new Color(theme3d.ai),
  mode: { EVENT: new Color(), RAW: new Color(), FEATURE: new Color(), HYBRID: new Color() } as Record<ProcMode, Color>,
  ch: Array.from({ length: 8 }, () => new Color()),
};

function sync() {
  themeColors.accent.set(theme3d.accent);
  themeColors.copper.set(theme3d.copper);
  themeColors.fg.set(theme3d.fg);
  themeColors.workspace.set(theme3d.workspace);
  themeColors.ai.set(theme3d.ai);
  (Object.keys(theme3d.mode) as ProcMode[]).forEach((m) => themeColors.mode[m].set(theme3d.mode[m]));
  theme3d.ch.forEach((c, i) => themeColors.ch[i].set(c));
}
sync();

export function refreshTheme3D() {
  Object.assign(theme3d, read());
  sync();
  version++;
  listeners.forEach((l) => l());
}

export function subscribeTheme3D(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function themeVersion() {
  return version;
}
/** Re-renders the caller when the theme changes; returns the current theme values. */
export function useTheme3D(): Theme3D {
  useSyncExternalStore(subscribeTheme3D, themeVersion, themeVersion);
  return theme3d;
}

// Follow <html data-theme="…"> (set by the prefs store) without a React dependency.
try {
  const mo = new MutationObserver(() => refreshTheme3D());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
} catch { /* no MutationObserver */ }
