// Where things are in the journey's one block of illustrative cortex. Scene units are µm; +y points towards the
// cortical surface. Two models live here and they are kept apart in space on purpose:
//
//   the five-cell circuit   the LIF circuit of the timing experiment, at the positions its own definition gives
//                           (model/circuits.ts). Two recording contacts, P1 and P2, are placed near it BY THE PLAYER:
//                           their positions are state (model/journey.ts), in the coordinates of this file;
//   the array               eight penetrating electrode tips, and around each tip the three units the population model
//                           assigns to it (experiment/model/motor.ts), each at that model's own offset from its tip.
//
// The array's pitch and the probe's position are DRAWING AND OBSERVATION choices of this build. The distances that the
// models use are the models' own: the probe's amplitudes follow from the probe position below through the declared
// 1/distance rule (model/observe.ts); a unit's size at its tip is the population model's `dist0Um`.
// Pure module. Unit-tested in tests/world-journey.test.ts.
import { layoutUnits } from '../../experiment/model/motor.ts';
import { workshopCircuit } from './circuits.ts';
import { ampAtUv, distUm, type Vec3 } from './observe.ts';

export type V3 = [number, number, number];

/**
 * Model coordinates are scene coordinates here: both are micrometres in this block, with the same origin and axes.
 * The two functions exist so that every place where a position crosses from a model to the picture (or back) says so,
 * and so that a different picture scale would need a change in exactly one place.
 */
export const modelToScene = (p: readonly number[]): V3 => [p[0], p[1], p[2]];
export const sceneToModel = (p: readonly number[]): V3 => [p[0], p[1], p[2]];

/** A recording site beside the target cell T that hears T well and the other four cells weakly (used by tests and as a suggested place). */
export const PROBE_TIP: V3 = [24, -27, 5];
/** The probe's shank runs from its tip up and out of the block along this direction (unit vector). */
export const PROBE_AXIS: V3 = (() => { const v: V3 = [-0.34, 0.92, 0.2], n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n] as V3; })();

/** Tip spacing of the drawn array, µm. A drawing choice: the population model has no pitch of its own. */
export const ARRAY_PITCH_UM = 170;
export const ARRAY_CENTRE: V3 = [140, -30, -700];
/** Tip of each of the eight channels: two rows of four. Channel 1 is tip 0. */
export const ARRAY_TIPS: V3[] = Array.from({ length: 8 }, (_, ch) => [ARRAY_CENTRE[0] + ((ch % 4) - 1.5) * ARRAY_PITCH_UM, ARRAY_CENTRE[1], ARRAY_CENTRE[2] + (ch < 4 ? 0.5 : -0.5) * 190] as V3);

const UNITS = layoutUnits();
/** Soma of each population unit: its own tip plus the population model's own offset. */
export const UNIT_POS: V3[] = UNITS.map((u) => { const t = ARRAY_TIPS[u.ch]; return [t[0] + u.pos[0], t[1] + u.pos[1], t[2] + u.pos[2]] as V3; });

/** The rig may not leave this box. */
export const BLOCK = { min: [-820, -430, -1420] as V3, max: [1040, 540, 760] as V3 };

export const CIRCUIT_CENTRE: V3 = [26, 4, 0];
/**
 * The reconstructed exemplar neuron (public/world/h01-exemplar.json): where its cell body is put, and how far it is
 * turned about the surfaceward axis (a rigid placement: nothing is mirrored or scaled).
 */
export const EXEMPLAR = { origin: [40, 10, 330] as V3, turn: Math.PI };
/** A point of the exemplar's own frame (µm) in the block. */
export function exemplarToScene(x: number, y: number, z: number): V3 {
  const c = Math.cos(EXEMPLAR.turn), s = Math.sin(EXEMPLAR.turn);
  return [EXEMPLAR.origin[0] + x * c + z * s, EXEMPLAR.origin[1] + y, EXEMPLAR.origin[2] - x * s + z * c];
}
/** Where the craft arrives: beside the exemplar neuron, the circuit beyond it, the array in the distance. */
export const HOME = { pos: [78, 40, 432] as V3, lookAt: [24, 2, 40] as V3 };
/** Where the craft goes for the circuit: close enough to read the five cells. */
export const CIRCUIT_VIEW = { pos: [60, 46, 250] as V3, lookAt: [28, 2, 0] as V3 };
export const OVERVIEW = { pivot: [90, 0, -200] as V3, dist: 1350, az: 0.5, el: 0.34 };
/** A small vessel that forks under the circuit: a landmark. Centre lines, µm. */
export const VESSEL: { trunk: V3[]; branch: V3[] } = {
  trunk: [[-800, -190, 380], [-380, -152, 190], [40, -176, -80], [470, -150, -420], [1020, -212, -780]],
  branch: [[40, -176, -80], [-90, -214, -300], [-250, -236, -560], [-430, -262, -900]],
};

/**
 * A pose from which the whole array is in view, for a view of the given aspect ratio in which the right-hand share
 * `covered` (0…1) of the width is taken by a panel.
 */
export function arrayView(aspect: number, fovY: number, covered = 0): { pos: V3; lookAt: V3 } {
  const halfW = 1.5 * ARRAY_PITCH_UM + 170, free = Math.max(0.35, 1 - covered), tanH = Math.tan(fovY / 2) * aspect;
  // distance at which the array's width fills 86 % of the free part of the view
  const d = Math.max(380, halfW / (tanH * free * 0.86));
  // the array is composed in the free (left) part: look a little to its right
  const shift = covered * tanH * d;
  const lookAt: V3 = [ARRAY_CENTRE[0] + shift, ARRAY_CENTRE[1] + 10, ARRAY_CENTRE[2]];
  return { pos: [lookAt[0], lookAt[1] + d * 0.3, lookAt[2] + d * 0.954], lookAt };
}

/** Size of each circuit cell's spike at the probe, µV, by the declared 1/distance rule. */
export function probeAmplitudes(variant = 0): Record<string, number> {
  const c = workshopCircuit(variant);
  return Object.fromEntries(c.cells.map((x) => [x.id, ampAtUv(distUm(PROBE_TIP, x.pos as Vec3))]));
}

/** Smallest distance between any two drawn somas of the scene (circuit cells and units), µm. */
export function minSomaGap(): number {
  const pts: V3[] = [...workshopCircuit(0).cells.map((c) => c.pos as V3), ...UNIT_POS];
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, distUm(pts[i], pts[j]));
  return m;
}
