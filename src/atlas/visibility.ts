// Pure display / picking rules for the atlas. No three.js, no DOM: unit-tested in tests/atlas-rules.test.ts.
//
// Two representations of the same anatomy are drawn:
//   • the SHELL  — one continuous surface from the MRI; each vertex carries a region id from the label volume;
//   • the MESHES — the atlas's own closed model per structure (needed for anything beneath the surface).
//
// The contract:
//   • the shell is solid by default, a see-through "ghost" when the inside must be visible, and absent when a
//     selection is isolated;
//   • a structure is VISIBLE unless its hemisphere is switched off or it is individually hidden;
//   • it is PICKABLE only where it is drawn opaque — on the solid shell if it reaches the surface, or as its own mesh.
//     A ghost shell never takes a click, and hidden things are never picked;
//   • with a cut plane, only points on the kept side can be picked.
import type { Hemisphere, Tissue } from './types.ts';

export type ViewMode = 'solid' | 'xray' | 'parcels' | 'slice';
export type Focus = 'none' | 'context' | 'isolate';
export type ShellMode = 'solid' | 'ghost' | 'hidden';

export interface DisplayState {
  viewMode: ViewMode;
  focus: Focus;
  hemi: Record<Hemisphere, boolean>;
  /** Individually hidden structure ids. */
  hidden: ReadonlySet<string>;
  /** Structure ids that belong to the current selection (a structure, or every member of a selected group). */
  selected: ReadonlySet<string>;
  /** Structure ids that own part of the shell surface. */
  onSurface: ReadonlySet<string>;
  /** The subset of `onSurface` that belongs to the outer tissue classes: what can really be seen from outside. */
  exposed: ReadonlySet<string>;
}

export interface StructureLike { id: string; hemisphere: Hemisphere; tissue: Tissue }

/** Structures that are shown as solid bodies inside the ghost shell in X-ray mode. */
/** Tissue classes that form the outside of the brain. A deep structure may own a few hidden surface vertices
 *  (the hippocampus on the medial wall, for instance) without being something one can see from outside. */
export const OUTER: ReadonlySet<Tissue> = new Set<Tissue>(['cortex', 'cerebellum', 'brainstem']);

export const INNER: ReadonlySet<Tissue> = new Set<Tissue>(['diencephalon', 'basal-nuclei', 'medial-temporal', 'commissure', 'ventricle', 'brainstem']);

export function shellMode(d: DisplayState): ShellMode {
  const hasSel = d.selected.size > 0;
  if (d.focus === 'isolate' && hasSel) return 'hidden';
  if (d.viewMode === 'slice') return 'solid';
  if (d.viewMode === 'xray') return 'ghost';
  if (d.focus === 'context' && hasSel) return 'ghost';
  // a selection that never reaches the surface can only be seen through the shell
  if (hasSel) { let any = false; for (const id of d.selected) if (d.exposed.has(id)) { any = true; break; } if (!any) return 'ghost'; }
  return 'solid';
}

export interface Plan {
  /** Not switched off by a hemisphere toggle or an individual hide. */
  visible: boolean;
  /** Drawn (and pickable) as part of the solid shell. */
  surface: boolean;
  /** Drawn (and pickable) as its own opaque atlas mesh. */
  mesh: boolean;
  pickable: boolean;
}

export function plan(s: StructureLike, d: DisplayState): Plan {
  const visible = d.hemi[s.hemisphere] && !d.hidden.has(s.id);
  if (!visible) return { visible: false, surface: false, mesh: false, pickable: false };
  const shell = shellMode(d);
  const surface = shell === 'solid' && d.onSurface.has(s.id);
  const isSel = d.selected.has(s.id);
  const mesh = d.viewMode !== 'slice' && shell !== 'solid' && (isSel || (d.viewMode === 'xray' && d.focus === 'none' && INNER.has(s.tissue)));
  return { visible, surface, mesh, pickable: surface || mesh };
}

export type ClipAxis = 'none' | 'x' | 'y' | 'z';
/** Cut plane in atlas RAS millimetres. keep = '+': keep the side where coordinate > pos. */
export interface Clip { axis: ClipAxis; posMm: number; keep: '+' | '-' }

/** True when a RAS-mm point survives the cut. */
export function keptByClip(pointRasMm: readonly [number, number, number], clip: Clip): boolean {
  if (clip.axis === 'none') return true;
  const v = pointRasMm[clip.axis === 'x' ? 0 : clip.axis === 'y' ? 1 : 2];
  return clip.keep === '+' ? v >= clip.posMm : v <= clip.posMm;
}

export interface Hit { id: string; distance: number; pointRasMm: readonly [number, number, number] }

/**
 * Resolve a pick from ray hits (any order): the nearest hit that lies on the kept side of the cut plane and whose
 * structure is pickable. `pickable` is asked per hit because one shell hit may belong to a hidden region (which is
 * not drawn, so the ray passes through it).
 */
export function resolvePick(hits: readonly Hit[], clip: Clip, pickable: (id: string) => boolean = () => true): Hit | null {
  let best: Hit | null = null;
  for (const h of hits) {
    if (!keptByClip(h.pointRasMm, clip)) continue;
    // id '' is an opaque surface that belongs to no structure: it cannot be selected, but it does block what is behind it
    if (h.id !== '' && !pickable(h.id)) continue;
    if (!best || h.distance < best.distance) best = h;
  }
  return best && best.id !== '' ? best : null;
}

/** Viewer transform (display only): three.js metres ← atlas RAS millimetres. (x, y, z) = (R, S, −A) / 1000. */
export function rasMmToDisplay(p: readonly [number, number, number]): [number, number, number] {
  return [p[0] / 1000, p[2] / 1000, -p[1] / 1000];
}
export function displayToRasMm(p: readonly [number, number, number]): [number, number, number] {
  return [p[0] * 1000, -p[2] * 1000, p[1] * 1000];
}

/** Anatomical wording for a hemisphere, never "screen left/right". */
export function hemisphereLabel(h: Hemisphere): string {
  return h === 'left' ? 'Left hemisphere (subject’s left)' : h === 'right' ? 'Right hemisphere (subject’s right)' : 'Midline / unpaired';
}

/** Region id of a voxel volume at a RAS-mm point (0 = none). Volumes are RAS-aligned, 1 mm. */
export function regionAt(vol: { dims: readonly number[]; originMm: readonly number[]; region: Uint8Array; t1: Uint8Array }, p: readonly [number, number, number]): { region: number; t1: number } {
  const x = Math.round(p[0] - vol.originMm[0]), y = Math.round(p[1] - vol.originMm[1]), z = Math.round(p[2] - vol.originMm[2]);
  if (x < 0 || y < 0 || z < 0 || x >= vol.dims[0] || y >= vol.dims[1] || z >= vol.dims[2]) return { region: 0, t1: 0 };
  const i = x + vol.dims[0] * (y + vol.dims[1] * z);
  return { region: vol.region[i], t1: vol.t1[i] };
}
