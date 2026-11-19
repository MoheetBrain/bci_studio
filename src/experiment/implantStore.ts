// Where the virtual BCI is attached. One device at a time; the placement is a real point of the atlas subject's
// surface (a vertex of the specimen mesh, its outward normal, and the atlas region read from the label volume there).
// The placement is kept in this browser only (localStorage), so it survives a reload and moving between scenes.
//
// This is an educational placement simulator: it does not model a skull, a craniectomy, vessels or an insertion, and
// nothing here is a surgical plan.
import { create } from 'zustand';

export interface Placement {
  /** Atlas structure id of the surface region under the device. */
  regionId: string;
  /** Vertex of the specimen surface the device is anchored to. */
  vertex: number;
  /** Anchor point, atlas RAS millimetres (scanner space, not MNI). */
  pointRasMm: [number, number, number];
  /** Outward unit normal of the surface at the anchor, RAS. */
  normalRas: [number, number, number];
}

export interface Preview extends Placement {
  /** False over anything the simulator does not attach to (cerebellum, brainstem, a cut face …). */
  compatible: boolean;
}

/** Which experiment a region supports in this build. Everything else attaches, but runs no experiment. */
export type ExperimentKind = 'motor' | 'visual';
export function experimentFor(regionName: string | null | undefined): ExperimentKind | null {
  const n = (regionName ?? '').toLowerCase();
  if (/\bprecentral gyrus\b/.test(n)) return 'motor';
  if (/\blateral occipital gyrus\b/.test(n)) return 'visual';
  return null;
}

const KEY = 'hbci.implant.v1';
function stored(): Placement | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Placement | null;
    const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    return p && typeof p.regionId === 'string' && Number.isInteger(p.vertex) && vec(p.pointRasMm) && vec(p.normalRas) ? p : null;
  } catch { return null; }
}
function store(p: Placement | null) {
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

interface ImplantState {
  /** The attached device, or null. */
  placement: Placement | null;
  /** True while the device follows the pointer over the surface. */
  placing: boolean;
  /** Where the device would attach right now (only while placing). */
  preview: Preview | null;
  /** Bumped whenever the device must be redrawn. */
  nonce: number;
  begin: () => void;
  cancel: () => void;
  setPreview: (p: Preview | null) => void;
  attach: (p: Placement) => void;
  remove: () => void;
}

export const useImplant = create<ImplantState>((set, get) => ({
  placement: stored(),
  placing: false,
  preview: null,
  nonce: 0,
  begin: () => set((s) => ({ placing: true, preview: null, nonce: s.nonce + 1 })),
  cancel: () => { if (get().placing) set((s) => ({ placing: false, preview: null, nonce: s.nonce + 1 })); },
  setPreview: (p) => {
    const cur = get().preview;
    if (cur === p || (cur && p && cur.vertex === p.vertex && cur.compatible === p.compatible)) return;
    set((s) => ({ preview: p, nonce: s.nonce + 1 }));
  },
  attach: (p) => { store(p); set((s) => ({ placement: p, placing: false, preview: null, nonce: s.nonce + 1 })); },
  remove: () => { store(null); set((s) => ({ placement: null, placing: false, preview: null, nonce: s.nonce + 1 })); },
}));

/** Device dimensions, millimetres. A generic sealed, skull-mounted concept — not any manufacturer's design. */
export const DEVICE = {
  /** Diameter and height of the electronics enclosure. */
  diameterMm: 23, heightMm: 8,
  /** How far above the cortical surface the enclosure is drawn (the skull it would sit in is not modelled). */
  standoffMm: 9,
  /** Recording sites: 2 rows × 4, this far apart on the surface. */
  channels: 8, pitchMm: 2.2,
  footprintMm: 5.2,
} as const;

/** Entry points of the eight threads on the surface, in the device's local frame (mm; x, z across the surface). */
export function threadSites(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) out.push([(c - 1.5) * DEVICE.pitchMm, (r - 0.5) * DEVICE.pitchMm]);
  return out;
}
