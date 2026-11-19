// Pure display / picking rules for the atlas. No three.js, no DOM: unit-tested in tests/atlas-rules.test.ts.
//
// The contract:
//   • a structure is VISIBLE unless its hemisphere or tissue layer is switched off or it is individually hidden;
//   • a structure is PICKABLE only when it is visible and drawn (nearly) opaque — so a faded "context" shell or a
//     transparent cortex never steals a click from what is seen through it, and hidden things are never picked;
//   • with a cut plane, only surface points on the kept side can be picked.
import type { Hemisphere, Tissue } from './types.ts';

export type VisOverride = 'hidden' | 'faded';

export interface DisplayState {
  hemi: Record<Hemisphere, boolean>;
  tissueOn: Record<Tissue, boolean>;
  /** Per-structure overrides (absent = shown). */
  vis: Record<string, VisOverride | undefined>;
  /** Opacity applied to the cortical mantle (cortex + sulci) when they are not part of the selection. */
  cortexOpacity: number;
  /** Structure ids that belong to the current selection (a structure, or every member of a selected group). */
  selected: ReadonlySet<string>;
}

export interface StructureLike { id: string; hemisphere: Hemisphere; tissue: Tissue }

export const FADED_OPACITY = 0.1;
/** Below this opacity a surface is see-through for picking. */
export const PICK_OPACITY_THRESHOLD = 0.5;

export interface Effective { visible: boolean; opacity: number; pickable: boolean }

export function effective(s: StructureLike, d: DisplayState): Effective {
  const override = d.vis[s.id];
  const visible = d.hemi[s.hemisphere] && d.tissueOn[s.tissue] && override !== 'hidden';
  if (!visible) return { visible: false, opacity: 0, pickable: false };
  const isSelected = d.selected.has(s.id);
  let opacity = 1;
  if (override === 'faded') opacity = FADED_OPACITY;
  else if (!isSelected && (s.tissue === 'cortex' || s.tissue === 'sulcus')) opacity = clamp01(d.cortexOpacity);
  return { visible: opacity > 0.001, opacity, pickable: opacity >= PICK_OPACITY_THRESHOLD };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
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
 * Resolve a pick from ray hits (any order): the nearest hit that lies on the kept side of the cut plane.
 * The caller only casts against pickable structures, so the nearest surviving hit is what the user sees.
 */
export function resolvePick(hits: readonly Hit[], clip: Clip): Hit | null {
  let best: Hit | null = null;
  for (const h of hits) {
    if (!keptByClip(h.pointRasMm, clip)) continue;
    if (!best || h.distance < best.distance) best = h;
  }
  return best;
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
