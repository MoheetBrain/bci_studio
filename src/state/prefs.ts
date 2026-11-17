// Persisted UI preferences with safe defaults. Storage can be missing (private window, previews),
// so every access is guarded; RESET WORKSPACE clears only these keys, never project data.
export type Theme = 'paper' | 'graphite';
export type UiMode = 'learn' | 'inspect';
export type LabelPolicy = 'focus' | 'all' | 'none';
export type LabSize = 'collapsed' | 'normal' | 'tall';

export interface Prefs {
  theme: Theme;
  uiMode: UiMode;
  labelPolicy: LabelPolicy;
  showGrid: boolean;
  advanced: boolean;
  reduceMotion: 'system' | 'reduce';
  labSize: LabSize;
  panels: { left: number; right: number; bottom: number; leftOpen: boolean; rightOpen: boolean };
  hintDismissed: boolean;
  /** Hardware version this UI revision was last used with (informational only). */
  seenVersion: string;
}

export const PREFS_KEY = 'hbci.prefs.v1';
export const LEGACY_KEYS = ['hbci.panelSizes'];

export const DEFAULT_PREFS: Prefs = {
  theme: 'paper',
  uiMode: 'learn',
  labelPolicy: 'focus',
  showGrid: false,
  advanced: false,
  reduceMotion: 'system',
  labSize: 'collapsed',
  panels: { left: 272, right: 360, bottom: 340, leftOpen: true, rightOpen: true },
  hintDismissed: false,
  seenVersion: '0.3',
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...p, panels: { ...DEFAULT_PREFS.panels, ...(p.panels ?? {}) } };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function clearPrefs(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** True when the OS asks for reduced motion or the user chose it in the studio. */
export function prefersReducedMotion(p: Pick<Prefs, 'reduceMotion'>): boolean {
  if (p.reduceMotion === 'reduce') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Apply theme and motion attributes to <html>. */
export function applyDocumentPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', p.theme);
  if (prefersReducedMotion(p)) root.setAttribute('data-motion', 'reduce');
  else root.removeAttribute('data-motion');
}
