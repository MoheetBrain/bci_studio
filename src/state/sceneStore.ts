// Scene / navigation / UI-preference state shared by every view. Contract owned by the main agent:
// add fields if needed, but do not rename or remove existing ones.
import { create } from 'zustand';
import type { Evidence, Level, Preset, ProcMode } from '../model/types';
import { COMPONENTS, ancestorsOf } from '../model/components';
import { useHw } from './hwStore';
import { BLOCK_NAMES } from '../micro/names';
import {
  DEFAULT_PREFS, applyDocumentPrefs, clearPrefs, loadPrefs, prefersReducedMotion, savePrefs,
  type LabSize, type LabelPolicy, type Prefs, type Theme, type UiMode,
} from './prefs';

export type AssemblyMode = 'idle' | 'assembling' | 'exploding';
/** Top-level destinations of the studio. */
export type Destination = 'chip' | 'system' | 'lab';
/** Levels that belong to the MY CHIP destination (package → die → circuit → gates → layout). */
export const CHIP_LEVELS: Level[] = ['package', 'die', 'circuit', 'module', 'gates', 'cell', 'layout'];

export interface SceneState {
  level: Level;
  /** Evidence label of the current viewport (each view sets it on mount). */
  viewEvidence: Evidence;
  selectedId: string | null;
  hoveredId: string | null;

  /** 0 = assembled, 1 = fully exploded. */
  explode: number;
  mode: AssemblyMode;
  paused: boolean;

  xray: boolean;            // transparent shells, internal parts visible
  ghostOthers: boolean;     // non-selected parts semi-transparent
  isolateId: string | null; // only this subtree visible
  hidden: Record<string, true>;
  labels: boolean;
  highlightPath: boolean;   // highlight the signal path through the selection

  /** Bumped to ask the active camera rig to animate. */
  fitRequest: number;
  resetRequest: number;
  /** Bumped with a named standard view ('top' | 'front' | 'iso') for the camera rig. */
  viewRequest: { n: number; view: 'top' | 'front' | 'iso' | 'fitAll' };

  /** Signal-lab driven highlights (data-flow animation). */
  activeBlocks: string[];   // component ids lit up right now
  pulseChannel: number | null;

  history: Level[];

  /** v0.3: which System-level preset is shown (bench prototype or thin cortical candidate). */
  preset: Preset;
  /** v0.3: readout-core processing mode highlighted across the studio (cfg_mode). */
  procMode: ProcMode;
  /** v0.3: guided-lesson step (null = no lesson running). */
  lessonStep: number | null;
  /** UI refresh: which lesson is running ('chip' | 'sample' | legacy 'tour'), when lessonStep !== null. */
  lessonId: string | null;

  /* ── UI refresh (Paper & Graphite) ── */
  theme: Theme;
  uiMode: UiMode;
  labelPolicy: LabelPolicy;
  showGrid: boolean;
  advanced: boolean;
  /** Effective reduced-motion flag (OS setting or user choice). 3D transitions must respect it. */
  reducedMotion: boolean;
  reduceMotionPref: Prefs['reduceMotion'];
  labSize: LabSize;
  panels: Prefs['panels'];
  hintDismissed: boolean;
  /** Presentation-only part offsets from "Move for inspection" (id → [dx,dy,dz]); never affects evidence. */
  inspectionOffsets: Record<string, [number, number, number]>;
  inspectionMode: boolean;
  /** Bumped by resetWorkspace so view-local state (lid, camera memory, undo) can reset too. */
  workspaceReset: number;

  setLevel: (l: Level, opts?: { push?: boolean }) => void;
  back: () => void;
  setViewEvidence: (e: Evidence) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  /** Double-click behaviour: select and enter the component's deeper level. */
  enter: (id: string) => void;
  setExplode: (v: number) => void;
  setMode: (m: AssemblyMode) => void;
  togglePause: () => void;
  toggle: (k: 'xray' | 'ghostOthers' | 'labels' | 'highlightPath') => void;
  isolate: (id: string | null) => void;
  setHidden: (id: string, hidden: boolean) => void;
  showAll: () => void;
  requestFit: () => void;
  requestReset: () => void;
  requestView: (view: 'top' | 'front' | 'iso' | 'fitAll') => void;
  setActiveBlocks: (ids: string[], channel?: number | null) => void;
  setPreset: (p: Preset) => void;
  setProcMode: (m: ProcMode) => void;
  setLessonStep: (n: number | null, lessonId?: string | null) => void;

  /** Destination derived from the level (and the lab drawer). */
  destination: () => Destination;
  goTo: (d: Destination) => void;
  setTheme: (t: Theme) => void;
  setUiMode: (m: UiMode) => void;
  setLabelPolicy: (p: LabelPolicy) => void;
  setShowGrid: (v: boolean) => void;
  setAdvanced: (v: boolean) => void;
  setReduceMotion: (v: Prefs['reduceMotion']) => void;
  setLabSize: (s: LabSize) => void;
  setPanels: (p: Partial<Prefs['panels']>) => void;
  dismissHint: () => void;
  setInspectionMode: (v: boolean) => void;
  setInspectionOffset: (id: string, off: [number, number, number] | null) => void;
  resetInspectionOffsets: () => void;
  /** Recover from a confusing layout: clears UI preferences only, never project data. */
  resetWorkspace: () => void;
}

const prefs0 = loadPrefs();
applyDocumentPrefs(prefs0);

function persist(get: () => SceneState) {
  const s = get();
  const p: Prefs = {
    theme: s.theme, uiMode: s.uiMode, labelPolicy: s.labelPolicy, showGrid: s.showGrid, advanced: s.advanced,
    reduceMotion: s.reduceMotionPref, labSize: s.labSize, panels: s.panels, hintDismissed: s.hintDismissed,
    seenVersion: DEFAULT_PREFS.seenVersion,
  };
  savePrefs(p);
  applyDocumentPrefs(p);
}

export const useScene = create<SceneState>((set, get) => ({
  // Chip-first: a fresh visit opens the HBCI-02 package, assembled, with the chip selected.
  level: 'package',
  viewEvidence: 'CONCEPT',
  selectedId: 'sys.hbci01',
  hoveredId: null,
  explode: 0,
  mode: 'idle',
  paused: false,
  xray: false,
  ghostOthers: false,
  isolateId: null,
  hidden: {},
  labels: true,
  highlightPath: false,
  fitRequest: 0,
  resetRequest: 0,
  viewRequest: { n: 0, view: 'iso' },
  activeBlocks: [],
  pulseChannel: null,
  history: [],
  preset: 'bench',
  procMode: 'HYBRID',
  lessonStep: null,
  lessonId: null,

  theme: prefs0.theme,
  uiMode: prefs0.uiMode,
  labelPolicy: prefs0.labelPolicy,
  showGrid: prefs0.showGrid,
  advanced: prefs0.advanced,
  reducedMotion: prefersReducedMotion(prefs0),
  reduceMotionPref: prefs0.reduceMotion,
  labSize: prefs0.labSize,
  panels: prefs0.panels,
  hintDismissed: prefs0.hintDismissed,
  inspectionOffsets: {},
  inspectionMode: false,
  workspaceReset: 0,

  setLevel: (l, opts) => {
    const cur = get().level;
    if (cur === l) return;
    set({
      level: l,
      history: opts?.push === false ? get().history : [...get().history, cur],
      isolateId: null,
    });
    if (cur === 'module' && l === 'die') get().requestView('fitAll');
    // Entering the gates level: open the selected block's own netlist.
    if (l === 'gates') {
      const id = get().selectedId;
      const m = id === 'rtl.raw_path' || id === 'rtl.readout' ? 'hbci_readout_core' : id ? COMPONENTS[id]?.rtlModule : undefined;
      if (m) useHw.getState().setGatesModule(m);
    }
  },
  back: () => {
    const h = get().history;
    if (h.length === 0) {
      // Nothing to go back to: step outwards within MY CHIP, else to the system context.
      const l = get().level;
      const outward: Partial<Record<Level, Level>> = { die: 'package', circuit: 'die', module: 'die', gates: 'module', cell: 'gates', layout: 'die', package: 'system' };
      if (outward[l]) set({ level: outward[l]!, isolateId: null });
      return;
    }
    const from = get().level;
    set({ level: h[h.length - 1], history: h.slice(0, -1), isolateId: null });
    // Leaving the module microscope: zoom the die back out to the whole map.
    if (from === 'module' && get().level === 'die') get().requestView('fitAll');
  },
  setViewEvidence: (e) => set({ viewEvidence: e }),
  select: (id) => set({ selectedId: id }),
  hover: (id) => set({ hoveredId: id }),
  enter: (id) => {
    const c = COMPONENTS[id];
    set({ selectedId: id });
    if (!c?.enter) return;
    const s = get();
    // Die → module: fly the camera into the block first, then open its microscope view.
    if (s.level === 'die' && c.enter === 'module' && !s.reducedMotion) {
      s.requestFit();
      window.setTimeout(() => {
        const g = get();
        if (g.level !== 'die' || g.selectedId !== id) return;
        g.setLevel('module');
        // The die camera is now zoomed into the block; whichever way the user comes back, show the whole map.
        g.requestView('fitAll');
      }, 850);
      return;
    }
    s.setLevel(c.enter);
  },
  setExplode: (v) => set({ explode: Math.min(1, Math.max(0, v)), mode: 'idle' }),
  setMode: (m) => set({ mode: m, paused: false }),
  togglePause: () => set({ paused: !get().paused }),
  toggle: (k) => set({ [k]: !get()[k] } as Partial<SceneState>),
  isolate: (id) => set({ isolateId: id }),
  setHidden: (id, hidden) => {
    const h = { ...get().hidden };
    if (hidden) h[id] = true;
    else delete h[id];
    set({ hidden: h });
  },
  showAll: () => set({ hidden: {}, isolateId: null }),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
  requestReset: () => set({ resetRequest: get().resetRequest + 1 }),
  requestView: (view) => set({ viewRequest: { n: get().viewRequest.n + 1, view } }),
  setActiveBlocks: (ids, channel = null) => set({ activeBlocks: ids, pulseChannel: channel }),
  setPreset: (p) => set({ preset: p, isolateId: null, selectedId: null }),
  setProcMode: (m) => set({ procMode: m }),
  setLessonStep: (n, lessonId) => set({ lessonStep: n, lessonId: n === null ? null : (lessonId ?? get().lessonId ?? 'tour') }),

  destination: () => {
    const s = get();
    if (s.labSize !== 'collapsed' && s.level === 'system') return 'system';
    return CHIP_LEVELS.includes(s.level) ? 'chip' : 'system';
  },
  goTo: (d) => {
    const s = get();
    if (d === 'chip') {
      if (!CHIP_LEVELS.includes(s.level)) s.setLevel('package');
      if (!s.selectedId || !(s.selectedId.startsWith('pkg.') || s.selectedId.startsWith('rtl.') || s.selectedId === 'sys.hbci01')) set({ selectedId: 'sys.hbci01' });
    } else if (d === 'system') {
      if (s.level !== 'system') s.setLevel('system');
      const sel = s.selectedId ? COMPONENTS[s.selectedId] : null;
      if (!sel || sel.level !== 'system') set({ selectedId: 'sys.hbci01' });
    } else {
      set({ labSize: s.labSize === 'collapsed' ? 'normal' : s.labSize });
      persist(get);
    }
  },
  setTheme: (t) => { set({ theme: t }); persist(get); },
  setUiMode: (m) => { set({ uiMode: m }); persist(get); },
  setLabelPolicy: (p) => { set({ labelPolicy: p, labels: p !== 'none' }); persist(get); },
  setShowGrid: (v) => { set({ showGrid: v }); persist(get); },
  setAdvanced: (v) => { set({ advanced: v }); persist(get); },
  setReduceMotion: (v) => { set({ reduceMotionPref: v, reducedMotion: prefersReducedMotion({ reduceMotion: v }) }); persist(get); },
  setLabSize: (s) => { set({ labSize: s }); persist(get); },
  setPanels: (p) => { set({ panels: { ...get().panels, ...p } }); persist(get); },
  dismissHint: () => { set({ hintDismissed: true }); persist(get); },
  setInspectionMode: (v) => set({ inspectionMode: v }),
  setInspectionOffset: (id, off) => {
    const o = { ...get().inspectionOffsets };
    if (off) o[id] = off; else delete o[id];
    set({ inspectionOffsets: o });
  },
  resetInspectionOffsets: () => set({ inspectionOffsets: {} }),
  resetWorkspace: () => {
    clearPrefs();
    const d = DEFAULT_PREFS;
    set({
      theme: d.theme, uiMode: d.uiMode, labelPolicy: d.labelPolicy, labels: true, showGrid: d.showGrid, advanced: d.advanced,
      reduceMotionPref: d.reduceMotion, reducedMotion: prefersReducedMotion(d), labSize: d.labSize, panels: d.panels, hintDismissed: false,
      hidden: {}, isolateId: null, ghostOthers: false, xray: false, highlightPath: false, explode: 0, mode: 'idle',
      inspectionOffsets: {}, inspectionMode: false, level: 'package', history: [], selectedId: 'sys.hbci01', lessonStep: null, lessonId: null,
      workspaceReset: get().workspaceReset + 1,
    });
    get().requestReset();
    applyDocumentPrefs(d);
  },
}));

// Track the OS reduced-motion setting while the page is open.
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', () => {
    const s = useScene.getState();
    useScene.setState({ reducedMotion: prefersReducedMotion({ reduceMotion: s.reduceMotionPref }) });
    applyDocumentPrefs({ ...DEFAULT_PREFS, theme: s.theme, reduceMotion: s.reduceMotionPref });
  });
} catch { /* no matchMedia */ }

/** True if `id` should be rendered given hidden/isolate state. */
export function isVisible(s: Pick<SceneState, 'hidden' | 'isolateId'>, id: string): boolean {
  const chain = [id, ...ancestorsOf(id)];
  if (chain.some((x) => s.hidden[x])) return false;
  if (!s.isolateId) return true;
  return chain.includes(s.isolateId) || ancestorsOf(s.isolateId).includes(id);
}

/** Breadcrumb for the current level/selection: My chip > Package > Silicon die > Filter. */
export function breadcrumb(s: Pick<SceneState, 'level' | 'selectedId' | 'preset'>): { label: string; level?: Level; id?: string }[] {
  const out: { label: string; level?: Level; id?: string }[] = [];
  if (CHIP_LEVELS.includes(s.level)) {
    out.push({ label: 'My chip', level: 'package', id: 'sys.hbci01' });
    if (s.level !== 'package') out.push({ label: 'Package', level: 'package', id: 'sys.hbci01' });
    if (['die', 'circuit', 'module', 'gates', 'cell', 'layout'].includes(s.level)) out.push({ label: 'Silicon die', level: 'die', id: 'pkg.die' });
    const sel = s.selectedId ? COMPONENTS[s.selectedId] : null;
    const blockSel = sel && sel.id.startsWith('rtl.') ? sel : null;
    const blockName = blockSel ? (BLOCK_NAMES[blockSel.id]?.friendly ?? blockSel.name) : null;
    if (s.level === 'circuit') out.push({ label: 'RTL circuit', level: 'circuit' });
    if (['module', 'gates', 'cell'].includes(s.level) && blockSel && blockName) out.push({ label: blockName, level: 'module', id: blockSel.id });
    if (s.level === 'gates' || s.level === 'cell') out.push({ label: 'Gates', level: 'gates' });
    if (s.level === 'cell') out.push({ label: 'Standard cell', level: 'cell' });
    if (s.level === 'layout') out.push({ label: 'Physical layout', level: 'layout' });
    if (sel && sel.id !== 'sys.hbci01' && sel.id !== 'pkg.die' && sel.level === s.level) out.push({ label: BLOCK_NAMES[sel.id]?.friendly ?? sel.name, id: sel.id });
  } else {
    out.push({ label: 'System context', level: 'system' });
    out.push({ label: s.preset === 'bench' ? 'Bench prototype' : 'Thin cortical candidate (concept)' });
    const sel = s.selectedId ? COMPONENTS[s.selectedId] : null;
    if (sel && sel.level === 'system') out.push({ label: sel.name, id: sel.id });
  }
  return out;
}
