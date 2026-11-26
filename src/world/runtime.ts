// What the active toy and the 3D scene share every frame. Plain mutable arrays, written by the toy from its model
// snapshot and read by the renderer — nothing here goes through React, so sixty updates a second cost nothing.
// The renderer never writes scientific state; the only way from the scene into a model is `onPick` (a selection)
// and the explicit tool actions a toy registers.
import type { BodyHit, V3 } from './flight';

export const MAX_CELLS = 32;
export const MAX_LINKS = 16;

export interface SceneCell {
  id: string;
  label: string;
  /** Soma centre, scene µm. */
  pos: V3;
  /** Soma radius, µm (drawn; also the picking radius). */
  radius: number;
  /** Colour group. Meaning is given in the toy's legend; never the only cue. */
  tint: 'exc' | 'inh' | 'input' | 'near' | 'mid' | 'far' | 'exemplar';
  /** 'skeleton' = drawn from a reconstructed morphology asset instead of being generated. */
  shape: 'pyramidal' | 'multipolar' | 'skeleton';
  /** True for a cell that no model computes (a context cell). Default: a cell of a model. */
  context?: boolean;
}
export interface SceneLink { id: string; from: string; to: string; inhibitory: boolean }
/** A recording site that can be aimed at and selected (an electrode contact). Not a cell of any model. */
export interface SceneSite { id: string; label: string; pos: V3; radius: number }
export interface SceneSpec {
  /** Changes whenever the geometry must be rebuilt. */
  key: string;
  cells: SceneCell[];
  links: SceneLink[];
  sites?: SceneSite[];
  /** Where the rig starts and what it looks at. */
  home: { pos: V3; lookAt: V3 };
  overview: { pivot: V3; dist: number; az: number; el: number };
}

export interface Pulse { link: number; u: number }

export const rt = {
  spec: null as SceneSpec | null,
  /** Per cell, 0…1: how close the membrane is to threshold (or a smoothed activity level). */
  act: new Float32Array(MAX_CELLS),
  /** Per cell, 0…1: a spike just happened. */
  flash: new Float32Array(MAX_CELLS),
  /** Per cell, 1 = switched off by the player. */
  dim: new Float32Array(MAX_CELLS),
  /** Per link, 1 = connected. */
  linkOn: new Float32Array(MAX_LINKS).fill(1),
  /** Per recording site, 0…1: the contact has just counted a threshold crossing. */
  site: new Float32Array(16),
  /** Context cells as drawn (positions, radii, shapes), for naming one that is aimed at. No model is attached to them. */
  context: null as null | { pos: V3[]; radius: number[]; shape: string[] },
  /** The instrument the player is holding ready to place ('P1' or 'P2'), or null. Presentation only: the craft's arm reaches out. */
  tool: null as null | string,
  /** Events on their way along a link (u = 0 at the sender, 1 at the receiver). */
  pulses: [] as Pulse[],
  /** The toy's per-frame work: advance its model clock and refresh the arrays above. */
  frame: null as null | ((wallSeconds: number) => void),
  /** Called by the scene when the player clicks: what was under the reticle or cursor (null = nothing). */
  onPick: null as null | ((hit: BodyHit | null) => void),
  /** Monotonic counter of frames drawn (for tests and the performance sample). */
  frames: 0,
};

export function resetRuntime(): void {
  rt.act.fill(0); rt.flash.fill(0); rt.dim.fill(0); rt.site.fill(0); rt.linkOn.fill(1); rt.pulses.length = 0; rt.frame = null; rt.onPick = null;
}
