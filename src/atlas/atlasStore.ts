// Atlas state: loaded data, the global region selection, and the display state. The selection lives here and is
// read by every scene of the studio, so it survives moving between scales.
import { create } from 'zustand';
import type { BufferGeometry } from 'three';
import { AtlasLoadError, loadAtlas, loadSlices, type SliceVolumes, type Specimen } from './loadAtlas';
import type { AtlasGroup, AtlasManifest, AtlasStructure, Hemisphere, TreeNode } from './types';
import { shellMode, type Clip, type ClipAxis, type DisplayState, type Focus, type ShellMode, type ViewMode } from './visibility';

export type ViewName = 'left' | 'right' | 'superior' | 'inferior' | 'anterior' | 'posterior';
export type CameraCmd =
  | { kind: 'reset'; nonce: number }
  | { kind: 'fit'; ids: string[]; nonce: number }
  | { kind: 'view'; view: ViewName; nonce: number }
  | { kind: 'orbit'; dAz: number; dPolar: number; nonce: number }
  | { kind: 'zoom'; factor: number; nonce: number }
  /** Fly to an explicit pose in display coordinates (used by guided journeys; seekable, so no tween when instant). */
  | { kind: 'pose'; position: [number, number, number]; target: [number, number, number]; instant?: boolean; nonce: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const REGION_KEY = 'hbci.atlas.region';
function storedRegion(): string | null {
  try { return localStorage.getItem(REGION_KEY); } catch { return null; }
}
function storeRegion(id: string | null) {
  try { if (id) localStorage.setItem(REGION_KEY, id); else localStorage.removeItem(REGION_KEY); } catch { /* storage unavailable */ }
}

export interface AtlasState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: { message: string; detail?: string } | null;
  progress: [number, number];
  manifest: AtlasManifest | null;
  geometries: Map<string, BufferGeometry>;
  specimen: Specimen | null;
  slices: { status: 'idle' | 'loading' | 'ready' | 'error'; data: SliceVolumes | null; error: string | null };
  structures: Map<string, AtlasStructure>;
  groups: Map<string, AtlasGroup>;
  tree: Map<string, TreeNode>;
  rootId: string;
  /** group id → every descendant structure id */
  members: Map<string, string[]>;
  /** depth-first order of structure ids (tree order), for keyboard stepping */
  order: string[];

  /** A structure id or a group id. */
  selectedId: string | null;
  hoverId: string | null;
  hoverSource: 'scene' | 'tree' | null;

  viewMode: ViewMode;
  focus: Focus;
  hemi: Record<Hemisphere, boolean>;
  hidden: Record<string, true>;
  clip: Clip;
  cameraCmd: CameraCmd | null;
  /** Width in CSS px of a panel floating over the right of the stage; the camera composes the subject in what is left. */
  insetRight: number;
  /** Bumped whenever the picture must be redrawn (demand rendering). */
  drawNonce: number;

  load: () => Promise<void>;
  loadSlices: () => Promise<void>;
  select: (id: string | null) => void;
  hover: (id: string | null, source?: 'scene' | 'tree') => void;
  selectionIds: () => string[];
  idsOf: (id: string) => string[];
  nameOf: (id: string | null) => string | null;
  setViewMode: (m: ViewMode) => void;
  setFocus: (f: Focus) => void;
  setHidden: (ids: string[], hidden: boolean) => void;
  restoreAll: () => void;
  setHemi: (h: Hemisphere, on: boolean) => void;
  setClip: (c: Partial<Clip>) => void;
  /** Start a cut on this plane: through the middle, with the cut face turned towards the viewer. */
  setCut: (axis: Exclude<ClipAxis, 'none'>) => void;
  /** Open the slice view with a coronal cut through the middle of these structures. */
  sliceThrough: (ids: string[]) => void;
  setInsetRight: (px: number) => void;
  camera: (c: DistributiveOmit<CameraCmd, 'nonce'>) => void;
  step: (dir: 1 | -1) => void;
  display: () => DisplayState;
  shell: () => ShellMode;
  hasOverrides: () => boolean;
  /** Extent of the whole atlas along a clip axis, in mm. */
  axisRange: (axis: ClipAxis) => [number, number];
}

let nonce = 1;

/** Where the camera sits relative to what it looks at, in atlas RAS (unit vector). Written by the scene every frame; not reactive. */
export const cameraFrom = { r: -0.8, a: 0.48, s: 0.36 };
/** Which side of a new cut to keep so that the cut face is turned towards the viewer. */
const facing = (axis: ClipAxis): '+' | '-' => ((axis === 'x' ? cameraFrom.r : axis === 'y' ? cameraFrom.a : cameraFrom.s) < 0 ? '+' : '-');

export const useAtlas = create<AtlasState>((set, get) => ({
  status: 'idle',
  error: null,
  progress: [0, 0],
  manifest: null,
  geometries: new Map(),
  specimen: null,
  slices: { status: 'idle', data: null, error: null },
  structures: new Map(),
  groups: new Map(),
  tree: new Map(),
  rootId: 'Brain',
  members: new Map(),
  order: [],
  selectedId: null,
  hoverId: null,
  hoverSource: null,
  viewMode: 'solid',
  focus: 'none',
  hemi: { left: true, right: true, midline: true },
  hidden: {},
  clip: { axis: 'none', posMm: 0, keep: '-' },
  cameraCmd: null,
  insetRight: 0,
  drawNonce: 0,

  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null, progress: [0, 0] });
    try {
      const { manifest, geometries, specimen } = await loadAtlas((d, t) => set({ progress: [d, t] }));
      const structures = new Map(manifest.structures.map((s) => [s.id, s]));
      const groups = new Map(manifest.groups.map((g) => [g.id, g]));
      const tree = new Map<string, TreeNode>();
      for (const g of manifest.groups) tree.set(g.id, { id: g.id, name: g.name, kind: 'group', parentId: g.parentId, children: [] });
      for (const s of manifest.structures) {
        if (tree.has(s.id)) continue;
        tree.set(s.id, { id: s.id, name: s.name, kind: 'structure', parentId: s.parentId, children: [] });
      }
      for (const n of tree.values()) if (n.parentId && tree.has(n.parentId)) tree.get(n.parentId)!.children.push(n.id);
      const root = manifest.groups.find((g) => g.parentId === null)!.id;
      const members = new Map<string, string[]>();
      const order: string[] = [];
      const collect = (id: string): string[] => {
        const n = tree.get(id)!;
        const own = structures.has(id) ? [id] : [];
        if (n.kind === 'structure') { order.push(id); return own; }
        if (own.length) order.push(id);
        const all = [...own, ...n.children.flatMap(collect)];
        members.set(id, all);
        return all;
      };
      collect(root);
      const wanted = storedRegion();
      set({
        status: 'ready', manifest, geometries, specimen, structures, groups, tree, rootId: root, members, order,
        selectedId: wanted && tree.has(wanted) ? wanted : get().selectedId && tree.has(get().selectedId!) ? get().selectedId : null,
      });
    } catch (e) {
      const err = e instanceof AtlasLoadError ? { message: e.message, detail: e.detail } : { message: e instanceof Error ? e.message : String(e) };
      set({ status: 'error', error: err });
    }
  },

  loadSlices: async () => {
    const s = get();
    if (!s.specimen || s.slices.status === 'loading' || s.slices.status === 'ready') return;
    set({ slices: { status: 'loading', data: null, error: null } });
    try {
      const data = await loadSlices(s.specimen.meta);
      set((st) => ({ slices: { status: 'ready', data, error: null }, drawNonce: st.drawNonce + 1 }));
    } catch (e) {
      set({ slices: { status: 'error', data: null, error: e instanceof Error ? e.message : String(e) } });
    }
  },

  select: (id) => {
    if (id !== null && get().status === 'ready' && !get().tree.has(id)) return;
    storeRegion(id);
    // a new selection starts un-isolated; clearing the selection clears the focus too
    set((s) => ({ selectedId: id, focus: id === s.selectedId ? s.focus : 'none', drawNonce: s.drawNonce + 1 }));
  },
  hover: (id, source = 'scene') => {
    if (get().hoverId === id) return;
    set((s) => ({ hoverId: id, hoverSource: id ? source : null, drawNonce: s.drawNonce + 1 }));
  },
  idsOf: (id) => {
    const s = get();
    return s.members.get(id) ?? (s.structures.has(id) ? [id] : []);
  },
  selectionIds: () => (get().selectedId ? get().idsOf(get().selectedId!) : []),
  nameOf: (id) => (id ? get().tree.get(id)?.name ?? null : null),

  setViewMode: (m) => {
    const s = get();
    let clip = s.clip;
    if (m === 'slice') {
      // open on a mid-sagittal cut the first time; the MRI volumes are fetched on demand
      if (clip.axis === 'none') { const [lo, hi] = s.axisRange('x'); clip = { axis: 'x', posMm: Math.round((lo + hi) / 2), keep: facing('x') }; }
      void s.loadSlices();
    } else if (clip.axis !== 'none') clip = { ...clip, axis: 'none' };
    set((st) => ({ viewMode: m, clip, focus: m === 'slice' ? 'none' : st.focus, drawNonce: st.drawNonce + 1 }));
  },
  setFocus: (f) => set((s) => ({ focus: s.selectedId ? f : 'none', viewMode: f !== 'none' && s.viewMode === 'slice' ? 'solid' : s.viewMode, clip: f !== 'none' && s.viewMode === 'slice' ? { ...s.clip, axis: 'none' } : s.clip, drawNonce: s.drawNonce + 1 })),
  setHidden: (ids, hidden) => set((s) => {
    const next = { ...s.hidden };
    for (const id of ids) { if (hidden) next[id] = true; else delete next[id]; }
    return { hidden: next, drawNonce: s.drawNonce + 1 };
  }),
  restoreAll: () => set((s) => ({
    hidden: {}, hemi: { left: true, right: true, midline: true }, viewMode: 'solid', focus: 'none', clip: { ...s.clip, axis: 'none' }, drawNonce: s.drawNonce + 1,
  })),
  setHemi: (h, on) => set((s) => ({ hemi: { ...s.hemi, [h]: on }, drawNonce: s.drawNonce + 1 })),
  setClip: (c) => set((s) => ({ clip: { ...s.clip, ...c }, drawNonce: s.drawNonce + 1 })),
  sliceThrough: (ids) => {
    const s = get();
    let lo = Infinity, hi = -Infinity;
    for (const id of ids) { const st = s.structures.get(id); if (st) { lo = Math.min(lo, st.boundsMm[0][1]); hi = Math.max(hi, st.boundsMm[1][1]); } }
    if (!Number.isFinite(lo)) return;
    const [a, b] = s.axisRange('y');
    void s.loadSlices();
    set((st) => ({ viewMode: 'slice', focus: 'none', clip: { axis: 'y', posMm: Math.round(Math.max(a, Math.min(b, (lo + hi) / 2))), keep: facing('y') }, drawNonce: st.drawNonce + 1 }));
  },
  setCut: (axis) => { const [lo, hi] = get().axisRange(axis); set((s) => ({ clip: { axis, posMm: Math.round((lo + hi) / 2), keep: facing(axis) }, drawNonce: s.drawNonce + 1 })); },
  setInsetRight: (px) => { if (get().insetRight !== px) set((s) => ({ insetRight: px, drawNonce: s.drawNonce + 1 })); },
  camera: (c) => set({ cameraCmd: { ...c, nonce: nonce++ } as CameraCmd }),
  step: (dir) => {
    const s = get();
    if (!s.order.length) return;
    const cur = s.selectedId && s.structures.has(s.selectedId) ? s.order.indexOf(s.selectedId) : -1;
    s.select(s.order[(cur + dir + s.order.length) % s.order.length]);
  },
  display: () => {
    const s = get();
    return {
      viewMode: s.viewMode, focus: s.focus, hemi: s.hemi, hidden: new Set(Object.keys(s.hidden)),
      selected: new Set(s.selectionIds()), onSurface: s.specimen?.surfaceIds ?? new Set<string>(), exposed: s.specimen?.exposedIds ?? new Set<string>(),
    };
  },
  shell: () => shellMode(get().display()),
  hasOverrides: () => {
    const s = get();
    return Object.keys(s.hidden).length > 0 || !s.hemi.left || !s.hemi.right || !s.hemi.midline || s.viewMode !== 'solid' || s.focus !== 'none';
  },
  axisRange: (axis) => {
    const m = get().manifest;
    if (!m || axis === 'none') return [-100, 100];
    const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    let lo = Infinity, hi = -Infinity;
    for (const s of m.structures) { lo = Math.min(lo, s.boundsMm[0][k]); hi = Math.max(hi, s.boundsMm[1][k]); }
    return [Math.floor(lo), Math.ceil(hi)];
  },
}));

export const VIEW_MODES: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: 'solid', label: 'Solid', hint: 'The brain surface as one specimen' },
  { id: 'xray', label: 'X-ray', hint: 'See through the surface to the structures inside' },
  { id: 'parcels', label: 'Regions', hint: 'Draw the borders of the atlas regions on the surface' },
  { id: 'slice', label: 'Slice', hint: 'Cut the brain and show this subject’s MRI on the cut' },
];
