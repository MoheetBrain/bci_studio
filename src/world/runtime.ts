// What the active toy and the 3D scene share every frame. Plain mutable arrays, written by the toy from its model
// snapshot and read by the renderer — nothing here goes through React, so sixty updates a second cost nothing.
// The renderer never writes scientific state; the only way from the scene into a model is `onPick` (a selection)
// and the explicit tool actions a toy registers.
import type { Hit, V3 } from './flight';

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
  tint: 'exc' | 'inh' | 'input' | 'near' | 'mid' | 'far';
  shape: 'pyramidal' | 'multipolar';
}
export interface SceneLink { id: string; from: string; to: string; inhibitory: boolean }
export interface SceneSpec {
  /** Changes whenever the geometry must be rebuilt. */
  key: string;
  cells: SceneCell[];
  links: SceneLink[];
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
  /** Events on their way along a link (u = 0 at the sender, 1 at the receiver). */
  pulses: [] as Pulse[],
  /** The toy's per-frame work: advance its model clock and refresh the arrays above. */
  frame: null as null | ((wallSeconds: number) => void),
  /** Called by the scene when the player clicks: what was under the reticle or cursor (null = nothing). */
  onPick: null as null | ((hit: Hit | null) => void),
  /** Monotonic counter of frames drawn (for tests and the performance sample). */
  frames: 0,
};

export function resetRuntime(): void {
  rt.act.fill(0); rt.flash.fill(0); rt.dim.fill(0); rt.linkOn.fill(1); rt.pulses.length = 0; rt.frame = null; rt.onPick = null;
}
