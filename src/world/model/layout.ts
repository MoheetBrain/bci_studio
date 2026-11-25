// Where things are in the journey's one block of illustrative cortex. Scene units are µm; +y points towards the
// cortical surface. Two models live here and they are kept apart in space on purpose:
//
//   the five-cell circuit   the LIF circuit of the timing experiment, at the positions its own definition gives
//                           (model/circuits.ts), with ONE recording probe beside the target cell;
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

/** The recording site of the single probe beside the target cell T. */
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
/** Where the rig arrives: the circuit in front, the array in the distance behind it. */
export const HOME = { pos: [52, 58, 338] as V3, lookAt: [28, 2, 0] as V3 };
export const OVERVIEW = { pivot: [90, 0, -330] as V3, dist: 1250, az: 0.5, el: 0.34 };

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
