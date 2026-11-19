import { useScene } from '../state/sceneStore';
// View-local state for the 3D viewport (owned by the 3D subagent; not part of the shared contract).
import { create } from 'zustand';
import type { Object3D } from 'three';
import { Vector3 } from 'three';
import type { Level, Preset } from '../model/types';
import type { DieEdge } from './dieLayout';

export type Level3D = 'system' | 'package' | 'die';
export const LEVELS_3D: Level3D[] = ['system', 'package', 'die'];
export function is3DLevel(l: Level): l is Level3D {
  return l === 'system' || l === 'package' || l === 'die';
}

/** One remembered camera pose (restored when Back returns to the level). */
export interface CameraPose {
  pos: [number, number, number];
  target: [number, number, number];
}

interface ViewState {
  /** Package level: lid opacity (0..1) and lift (0..1, scaled to world units by the scene). */
  lidOpacity: number;
  lidLift: number;
  exposeDie: boolean;
  /** True while a level transition animation is running (labels and picking are suspended). */
  transitioning: boolean;
  /** Package level: the silicon die is hidden by an opaque, closed lid (labels must not point at the lid). */
  dieOccluded: boolean;
  /** Camera pose remembered per level (restored on Back). */
  cameraMemory: Partial<Record<Level3D, CameraPose>>;
  /** "Move for inspection" undo stack: previous offset of the last moved parts. */
  inspectionUndo: { id: string; prev: [number, number, number] | null }[];
  /** True while the inspection gizmo is dragging a part. */
  inspectionDragging: boolean;
  /** Open overlay panel in the viewport toolbar (More ▾ / Help). */
  panel: 'more' | 'help' | null;
  setLidOpacity: (v: number) => void;
  setLidLift: (v: number) => void;
  toggleExposeDie: () => void;
  setExposeDie: (on: boolean) => void;
  setTransitioning: (v: boolean) => void;
  setDieOccluded: (v: boolean) => void;
  rememberCamera: (level: Level3D, pose: CameraPose) => void;
  pushInspectionUndo: (id: string, prev: [number, number, number] | null) => void;
  popInspectionUndo: () => { id: string; prev: [number, number, number] | null } | undefined;
  setInspectionDragging: (v: boolean) => void;
  setPanel: (p: 'more' | 'help' | null) => void;
}

export const useView = create<ViewState>((set, get) => ({
  lidOpacity: 1,
  lidLift: 0,
  exposeDie: false,
  transitioning: false,
  dieOccluded: true,
  cameraMemory: {},
  inspectionUndo: [],
  inspectionDragging: false,
  panel: null,
  setLidOpacity: (v) => set({ lidOpacity: Math.min(1, Math.max(0, v)) }),
  setLidLift: (v) => set({ lidLift: Math.min(1, Math.max(0, v)) }),
  toggleExposeDie: () => get().setExposeDie(!get().exposeDie),
  setExposeDie: (on) => set({ exposeDie: on, lidOpacity: on ? 0.22 : 1, lidLift: on ? 1 : 0 }),
  setTransitioning: (v) => set({ transitioning: v }),
  setDieOccluded: (v) => get().dieOccluded !== v && set({ dieOccluded: v }),
  rememberCamera: (level, pose) => set({ cameraMemory: { ...get().cameraMemory, [level]: pose } }),
  pushInspectionUndo: (id, prev) => set({ inspectionUndo: [...get().inspectionUndo.slice(-29), { id, prev }] }),
  popInspectionUndo: () => {
    const u = get().inspectionUndo;
    if (u.length === 0) return undefined;
    set({ inspectionUndo: u.slice(0, -1) });
    return u[u.length - 1];
  },
  setInspectionDragging: (v) => set({ inspectionDragging: v }),
  setPanel: (p) => set({ panel: p }),
}));

/** Mutable per-frame values shared between scene components (no React re-render). */
export const runtime = {
  /** Smoothed explode value actually used for geometry (0 = assembled, 1 = exploded). */
  explode: 0,
  /** Smoothed lid values. */
  lidLift: 0,
  lidOpacity: 1,
  /** Ambient animation clock; stops while the assembly animation is paused. */
  time: 0,
  /** Real clock (keeps running when paused; used for lab-driven pulses). */
  clock: 0,
  /** Per-level fade factor used by every part during level transitions. */
  levelOpacity: { system: 1, package: 0, die: 0 } as Record<Level3D, number>,
  levelActive: { system: true, package: false, die: false } as Record<Level3D, boolean>,
  transitionActive: false,
  /** Ids on the highlighted signal path (recomputed when selection / toggle changes). */
  pathSet: new Set<string>(),
  pathEdges: [] as [string, string][],
  /** System-level preset cross-fade (1 = shown). Driven by PresetStage. */
  presetOpacity: { bench: 1, cortical: 0 } as Record<Preset, number>,
  /** Per-component dim target (e.g. die blocks outside the active processing mode); 1 = normal. */
  dimTarget: new Map<string, number>(),
  /** Conceptual die routes currently drawn (set by DieScene), for the signal inspector's endpoint lookup. */
  dieEdges: [] as DieEdge[],
  /** Mirrors useScene.reducedMotion for per-frame code (kept in sync by Drivers). */
  reducedMotion: false,
  /** Mirrors useScene.paused for per-frame code. */
  paused: false,
  /** True while any decorative motion (dashes, pulses, sweeps) may run. */
  get motion() {
    return !this.reducedMotion && !this.paused;
  },
};

/** Render layers used by the selection outline pass (meshes of the selected / hovered part). */
export const OUTLINE_LAYER_SELECTED = 7;
export const OUTLINE_LAYER_HOVER = 8;

/** Root group of each System-level preset (for framing and bounds). */
export const presetGroups: Partial<Record<Preset, Object3D>> = {};

/** Real frame timestamps (ms, performance.now) for the measured FPS meter. */
export const frameStats = { times: new Float64Array(180), n: 0, i: 0, last: 0 };
export function recordFrame(now: number) {
  frameStats.times[frameStats.i] = now;
  frameStats.i = (frameStats.i + 1) % frameStats.times.length;
  frameStats.n = Math.min(frameStats.n + 1, frameStats.times.length);
  frameStats.last = now;
}

/** id → root object of the part (for fit, labels, signal path anchors, transitions). */
export const registry = new Map<string, Object3D>();
export const levelGroups: Partial<Record<Level3D, Object3D>> = {};

const _v = new Vector3();
/** World-space anchor of a registered part (its label anchor if it has one). */
export function partAnchorWorld(id: string, out: Vector3): Vector3 | null {
  const o = registry.get(id);
  if (!o) return null;
  const a = o.userData.anchor as [number, number, number] | undefined;
  _v.set(a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0);
  o.updateWorldMatrix(true, false);
  return out.copy(_v).applyMatrix4(o.matrixWorld);
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Staggered explode factor for a part with a start delay in [0, 0.5). */
export function explodeLocal(e: number, delay = 0): number {
  return easeInOutCubic(clamp01((e - delay) / (1 - delay)));
}
/** Frame-rate independent damping factor. */
export const damp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
/** Damping rate adjusted for reduced motion (effectively instant when reduced). */
export const motionRate = (rate: number) => (runtime.reducedMotion ? Math.max(rate, 60) : rate);

// Full visual reset when the user resets the workspace (lid, camera memory, inspection undo).
useScene.subscribe((s, p) => {
  if (s.workspaceReset !== p.workspaceReset) {
    useView.setState({ exposeDie: false, lidOpacity: 1, lidLift: 0, cameraMemory: {}, inspectionUndo: [] } as Partial<ReturnType<typeof useView.getState>>);
  }
});
