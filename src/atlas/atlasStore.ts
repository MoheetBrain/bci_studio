// Atlas state: loaded data, the global region selection, and every display toggle. The selection lives here and is
// read by all workspaces (brain, neural interface, signal journey, chip, research), so it survives view changes.
import { create } from 'zustand';
import type { BufferGeometry } from 'three';
import { AtlasLoadError, loadAtlas } from './loadAtlas';
import type { AtlasGroup, AtlasManifest, AtlasStructure, Hemisphere, Tissue, TreeNode } from './types';
import type { Clip, DisplayState, VisOverride } from './visibility';

export type ColorMode = 'specimen' | 'tissue' | 'source';
export type ViewName = 'left' | 'right' | 'superior' | 'inferior' | 'anterior' | 'posterior';
export type CameraCmd =
  | { kind: 'reset'; nonce: number }
  | { kind: 'fit'; ids: string[]; nonce: number }
  | { kind: 'view'; view: ViewName; nonce: number }
  | { kind: 'orbit'; dAz: number; dPolar: number; nonce: number }
  | { kind: 'zoom'; factor: number; nonce: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const TISSUES: Tissue[] = ['cortex', 'sulcus', 'white-matter', 'cerebellum', 'brainstem', 'diencephalon', 'basal-nuclei', 'medial-temporal', 'commissure', 'ventricle'];
const ALL_ON = Object.fromEntries(TISSUES.map((t) => [t, true])) as Record<Tissue, boolean>;
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
  hoverSource: 'scene' | 'tree' | 'slice' | null;

  hemi: Record<Hemisphere, boolean>;
  tissueOn: Record<Tissue, boolean>;
  vis: Record<string, VisOverride | undefined>;
  cortexOpacity: number;
  clip: Clip;
  colorMode: ColorMode;
  cameraCmd: CameraCmd | null;
  /** Bumped whenever the picture must be redrawn (demand rendering). */
  drawNonce: number;

  load: () => Promise<void>;
  select: (id: string | null) => void;
  hover: (id: string | null, source?: 'scene' | 'tree' | 'slice') => void;
  selectionIds: () => string[];
  idsOf: (id: string) => string[];
  nameOf: (id: string | null) => string | null;
  setVis: (ids: string[], v: VisOverride | undefined) => void;
  isolate: (id: string) => void;
  showContext: (id: string) => void;
  restoreAll: () => void;
  setHemi: (h: Hemisphere, on: boolean) => void;
  setTissue: (t: Tissue, on: boolean) => void;
  setCortexOpacity: (v: number) => void;
  setClip: (c: Partial<Clip>) => void;
  setColorMode: (m: ColorMode) => void;
  camera: (c: DistributiveOmit<CameraCmd, 'nonce'>) => void;
  step: (dir: 1 | -1) => void;
  display: () => DisplayState;
  hasOverrides: () => boolean;
}

let nonce = 1;

export const useAtlas = create<AtlasState>((set, get) => ({
  status: 'idle',
  error: null,
  progress: [0, 0],
  manifest: null,
  geometries: new Map(),
  structures: new Map(),
  groups: new Map(),
  tree: new Map(),
  rootId: 'Brain',
  members: new Map(),
  order: [],
  selectedId: null,
  hoverId: null,
  hoverSource: null,
  hemi: { left: true, right: true, midline: true },
  tissueOn: { ...ALL_ON },
  vis: {},
  cortexOpacity: 1,
  clip: { axis: 'none', posMm: 0, keep: '-' },
  colorMode: 'specimen',
  cameraCmd: null,
  drawNonce: 0,

  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null, progress: [0, 0] });
    try {
      const { manifest, geometries } = await loadAtlas((d, t) => set({ progress: [d, t] }));
      const structures = new Map(manifest.structures.map((s) => [s.id, s]));
      const groups = new Map(manifest.groups.map((g) => [g.id, g]));
      const tree = new Map<string, TreeNode>();
      for (const g of manifest.groups) tree.set(g.id, { id: g.id, name: g.name, kind: 'group', parentId: g.parentId, children: [] });
      // A structure that is also a group in the source (has members) keeps its group node; its own mesh is a leaf "<id>" under it.
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
        status: 'ready', manifest, geometries, structures, groups, tree, rootId: root, members, order,
        selectedId: wanted && tree.has(wanted) ? wanted : get().selectedId && tree.has(get().selectedId!) ? get().selectedId : null,
      });
    } catch (e) {
      const err = e instanceof AtlasLoadError ? { message: e.message, detail: e.detail } : { message: e instanceof Error ? e.message : String(e) };
      set({ status: 'error', error: err });
    }
  },

  select: (id) => {
    if (id !== null && get().status === 'ready' && !get().tree.has(id)) return;
    storeRegion(id);
    set((s) => ({ selectedId: id, drawNonce: s.drawNonce + 1 }));
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

  setVis: (ids, v) => set((s) => {
    const vis = { ...s.vis };
    for (const id of ids) { if (v) vis[id] = v; else delete vis[id]; }
    return { vis, drawNonce: s.drawNonce + 1 };
  }),
  isolate: (id) => set((s) => {
    const keep = new Set(s.members.get(id) ?? [id]);
    const vis: Record<string, VisOverride | undefined> = {};
    for (const sid of s.structures.keys()) if (!keep.has(sid)) vis[sid] = 'hidden';
    return { vis, drawNonce: s.drawNonce + 1 };
  }),
  showContext: (id) => set((s) => {
    const keep = new Set(s.members.get(id) ?? [id]);
    const vis: Record<string, VisOverride | undefined> = {};
    for (const sid of s.structures.keys()) if (!keep.has(sid)) vis[sid] = 'faded';
    return { vis, drawNonce: s.drawNonce + 1 };
  }),
  restoreAll: () => set((s) => ({
    vis: {}, hemi: { left: true, right: true, midline: true }, tissueOn: { ...ALL_ON }, cortexOpacity: 1,
    clip: { ...s.clip, axis: 'none' }, drawNonce: s.drawNonce + 1,
  })),
  setHemi: (h, on) => set((s) => ({ hemi: { ...s.hemi, [h]: on }, drawNonce: s.drawNonce + 1 })),
  setTissue: (t, on) => set((s) => ({ tissueOn: { ...s.tissueOn, [t]: on }, drawNonce: s.drawNonce + 1 })),
  setCortexOpacity: (v) => set((s) => ({ cortexOpacity: Math.max(0, Math.min(1, v)), drawNonce: s.drawNonce + 1 })),
  setClip: (c) => set((s) => ({ clip: { ...s.clip, ...c }, drawNonce: s.drawNonce + 1 })),
  setColorMode: (m) => set((s) => ({ colorMode: m, drawNonce: s.drawNonce + 1 })),
  camera: (c) => set({ cameraCmd: { ...c, nonce: nonce++ } as CameraCmd }),
  step: (dir) => {
    const s = get();
    if (!s.order.length) return;
    const cur = s.selectedId && s.structures.has(s.selectedId) ? s.order.indexOf(s.selectedId) : -1;
    const next = s.order[(cur + dir + s.order.length) % s.order.length];
    s.select(next);
  },
  display: () => {
    const s = get();
    return { hemi: s.hemi, tissueOn: s.tissueOn, vis: s.vis, cortexOpacity: s.cortexOpacity, selected: new Set(s.selectionIds()) };
  },
  hasOverrides: () => {
    const s = get();
    return Object.keys(s.vis).length > 0 || !s.hemi.left || !s.hemi.right || !s.hemi.midline
      || TISSUES.some((t) => !s.tissueOn[t]) || s.cortexOpacity < 1 || s.clip.axis !== 'none';
  },
}));

export const TISSUE_ORDER = TISSUES;
export const TISSUE_LABEL: Record<Tissue, string> = {
  cortex: 'Cerebral cortex (gyri)',
  sulcus: 'Major sulci (surfaces)',
  'white-matter': 'Cerebral white matter',
  cerebellum: 'Cerebellum',
  brainstem: 'Brainstem',
  diencephalon: 'Thalamus & hypothalamus',
  'basal-nuclei': 'Basal nuclei',
  'medial-temporal': 'Hippocampus & amygdala',
  commissure: 'Commissures & septum',
  ventricle: 'Ventricles',
};
