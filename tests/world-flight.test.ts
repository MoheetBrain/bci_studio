// The observation rig's movement and aiming (src/world/flight.ts): frame-rate independence, prompt braking,
// focus poses that stay outside the object, and picking that ignores a body the rig is inside.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAKE_S, NO_INPUT, PRECISION, RESPONSE_S, SPEEDS_UM_S, applyLook, changeSpeedLevel, focusOrbit, lookAt, lookDir, nearSurface, newFlight, orbitBy, orbitPose, pick, raySegment, raySphere, speedOf, stepFlight,
  projectPoint, viewRay, type FlightInput, type Pickable, type V3,
} from '../src/world/flight.ts';
import { DEFAULT_KEYS, actionFor, codeOf, rebind } from '../src/world/bindings.ts';

const fly = (fps: number, script: Array<[number, FlightInput]>) => {
  const s = newFlight([0, 0, 0]);
  for (const [seconds, input] of script) { const n = Math.round(seconds * fps); for (let i = 0; i < n; i++) stepFlight(s, input, 1 / fps); }
  return s;
};
const F: FlightInput = { ...NO_INPUT, forward: 1 }, R: FlightInput = { ...NO_INPUT, right: 1 }, B: FlightInput = { ...NO_INPUT, brake: true };

test('flight: the same key presses fly the same path at 30, 60 and 120 frames per second', () => {
  const script: Array<[number, FlightInput]> = [[0.5, F], [0.3, R], [0.2, NO_INPUT], [0.4, { ...F, up: 1 }], [0.1, B]];
  const a = fly(30, script), b = fly(60, script), c = fly(120, script);
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(a.pos[i] - b.pos[i]) < 1e-9 && Math.abs(b.pos[i] - c.pos[i]) < 1e-9, `axis ${i}: ${a.pos[i]} ${b.pos[i]} ${c.pos[i]}`); assert.ok(Math.abs(a.vel[i] - c.vel[i]) < 1e-9); }
  // 0.5 s forward at the default level: v·t − v·τ·(1 − e^(−t/τ))
  const v = SPEEDS_UM_S[3], s = fly(60, [[0.5, F]]);
  assert.ok(Math.abs(-s.pos[2] - (v * 0.5 - v * RESPONSE_S * (1 - Math.exp(-0.5 / RESPONSE_S)))) < 1e-9);
  assert.equal(s.pos[0], 0); assert.equal(s.pos[1], 0);
});

test('flight: speed settles on the chosen level, releasing the keys stops without drift, the brake stops sooner and allows a slow creep', () => {
  const s = fly(60, [[1, F]]);
  assert.ok(Math.abs(speedOf(s) - SPEEDS_UM_S[3]) < 0.01);
  const coast = fly(60, [[1, F], [0.4, NO_INPUT]]), braked = fly(60, [[1, F], [0.15, B]]);
  assert.ok(speedOf(coast) < 1, `coasting ${speedOf(coast)}`);
  assert.ok(speedOf(braked) < SPEEDS_UM_S[3] * Math.exp(-0.15 / BRAKE_S) + 1e-6);
  assert.ok(speedOf(fly(60, [[1, F], [0.1, B]])) < speedOf(fly(60, [[1, F], [0.1, NO_INPUT]])) / 2);
  assert.equal(speedOf(fly(60, [[1, F], [3, NO_INPUT]])), 0, 'no residual drift');
  const creep = fly(60, [[1, { ...F, brake: true }]]);
  assert.ok(Math.abs(speedOf(creep) - SPEEDS_UM_S[3] * PRECISION) < 0.01);
  const lv = newFlight([0, 0, 0]);
  changeSpeedLevel(lv, 99); assert.equal(lv.speedLevel, SPEEDS_UM_S.length - 1);
  changeSpeedLevel(lv, -99); assert.equal(lv.speedLevel, 0);
  // diagonal input is not faster than straight
  assert.ok(Math.abs(speedOf(fly(60, [[1, { ...F, right: 1 }]])) - SPEEDS_UM_S[3]) < 0.01);
});

test('look: yaw and pitch only, pitch limited, forward follows the view, and lookAt inverts lookDir', () => {
  const s = newFlight([0, 0, 0]);
  applyLook(s, 100, 0); assert.ok(s.yaw < 0 && s.pitch === 0);
  applyLook(s, 0, -1e6); assert.ok(s.pitch > 1.5 && s.pitch < Math.PI / 2);
  const d = lookDir(0.7, -0.3), back = lookAt([0, 0, 0], [d[0] * 50, d[1] * 50, d[2] * 50]);
  assert.ok(Math.abs(back.yaw - 0.7) < 1e-9 && Math.abs(back.pitch + 0.3) < 1e-9);
  // the centre of the view is the look direction; the top edge is half the field of view above it, with no roll
  const mid = viewRay(0.4, 0.2, 1, 1.6, 0, 0), ld = lookDir(0.4, 0.2), top = viewRay(0, 0, 1, 1.6, 0, 1), side = viewRay(0, 0, 1, 1.6, 1, 0);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(mid[i] - ld[i]) < 1e-12);
  assert.ok(Math.abs(Math.atan2(top[1], -top[2]) - 0.5) < 1e-12 && Math.abs(top[0]) < 1e-12);
  assert.ok(Math.abs(side[0] / -side[2] - Math.tan(0.5) * 1.6) < 1e-12 && Math.abs(side[1]) < 1e-12);
  // projecting a point on a view ray gives back the view coordinates of that ray
  const ray = viewRay(0.4, 0.2, 1, 1.6, 0.35, -0.6), pr = projectPoint([5, 6, 7], 0.4, 0.2, 1, 1.6, [5 + ray[0] * 90, 6 + ray[1] * 90, 7 + ray[2] * 90]);
  assert.ok(pr.front && Math.abs(pr.x - 0.35) < 1e-9 && Math.abs(pr.y + 0.6) < 1e-9);
  assert.equal(projectPoint([0, 0, 0], 0, 0, 1, 1.6, [0, 0, 10]).front, false, 'behind the rig');
  const ahead = lookDir(0, 0);
  assert.ok(Math.abs(ahead[0]) < 1e-12 && Math.abs(ahead[1]) < 1e-12 && ahead[2] === -1);
});

test('focus: the orbit pose is outside the object on the side the rig came from, looks at its centre, and keeps its pivot while orbiting', () => {
  const centre: V3 = [40, 0, 0], from: V3 = [-60, 30, 90];
  const o = focusOrbit(centre, 9, from), p = orbitPose(o);
  const dist = Math.hypot(p.pos[0] - centre[0], p.pos[1] - centre[1], p.pos[2] - centre[2]);
  assert.ok(dist > 9 * 3 && Math.abs(dist - o.dist) < 1e-9);
  const toRig = [from[0] - centre[0], from[1] - centre[1], from[2] - centre[2]], toPose = [p.pos[0] - centre[0], p.pos[1] - centre[1], p.pos[2] - centre[2]];
  const cos = (toRig[0] * toPose[0] + toRig[1] * toPose[1] + toRig[2] * toPose[2]) / (Math.hypot(...toRig) * Math.hypot(...toPose));
  assert.ok(cos > 0.999, 'same side');
  const look = lookDir(p.yaw, p.pitch), hit = raySphere(p.pos, look, centre, 9);
  assert.ok(hit > 0, 'the view axis passes through the object');
  orbitBy(o, 120, -40);
  const q = orbitPose(o);
  assert.ok(Math.abs(Math.hypot(q.pos[0] - centre[0], q.pos[1] - centre[1], q.pos[2] - centre[2]) - o.dist) < 1e-9);
  assert.deepEqual(o.pivot, centre);
  // focusing from inside the object still gives a pose outside it
  const inside = orbitPose(focusOrbit(centre, 9, centre));
  assert.ok(Math.hypot(inside.pos[0] - centre[0], inside.pos[1] - centre[1], inside.pos[2] - centre[2]) > 9);
});

test('picking: nearest body along the ray; a body the rig is inside is not picked; thin links are picked only near the ray', () => {
  const things: Pickable[] = [
    { kind: 'cell', id: 'near', centre: [0, 0, -50], radius: 10 },
    { kind: 'cell', id: 'far', centre: [0, 0, -120], radius: 10 },
    { kind: 'cell', id: 'side', centre: [60, 0, -50], radius: 10 },
    { kind: 'link', id: 'wire', points: [[-40, 20, -80], [40, 20, -80]], radius: 3 },
  ];
  assert.equal(pick([0, 0, 0], [0, 0, -1], things)?.id, 'near');
  assert.equal(pick([0, 0, -50], [0, 0, -1], things)?.id, 'far', 'from inside "near", the ray finds what is beyond');
  assert.equal(pick([0, 0, 0], [0, 0, 1], things), null);
  const up = lookDir(0, Math.atan2(20, 80));
  assert.equal(pick([0, 0, 0], up, things)?.id, 'wire');
  assert.equal(pick([0, 0, 0], lookDir(0, Math.atan2(30, 80)), things), null, '10 µm off a 3 µm link is a miss');
  assert.equal(pick([0, 0, 0], [0, 0, -1], things, 30), null, 'out of reach');
  assert.equal(raySphere([0, 0, 0], [0, 0, -1], [0, 0, -50], 10), 40);
  assert.ok(Math.abs(raySegment([0, 0, 0], [0, 0, -1], [-5, 3, -20], [5, 3, -20])!.dist - 3) < 1e-9);
  assert.equal(nearSurface([0, 0, -38], [{ centre: [0, 0, -50], radius: 10 }], 6), true);
  assert.equal(nearSurface([0, 0, -20], [{ centre: [0, 0, -50], radius: 10 }], 6), false);
});

test('bindings: keys are matched by position, either Shift brakes, arrows always move, a key with no code falls back to its character, and a rebind swaps', () => {
  assert.equal(actionFor(DEFAULT_KEYS, codeOf({ code: 'KeyW', key: 'z' })), 'forward', 'position, not the printed letter');
  assert.equal(actionFor(DEFAULT_KEYS, codeOf({ code: 'ShiftRight' })), 'brake');
  assert.equal(actionFor(DEFAULT_KEYS, codeOf({ code: 'ArrowLeft' })), 'left');
  assert.equal(actionFor(DEFAULT_KEYS, codeOf({ code: '', key: 'd' })), 'right');
  assert.equal(actionFor(DEFAULT_KEYS, codeOf({ code: '', key: ' ' })), 'pause');
  assert.equal(actionFor(DEFAULT_KEYS, codeOf({ code: 'KeyZ' })), null);
  const swapped = rebind(DEFAULT_KEYS, 'forward', 'KeyF')!;
  assert.equal(swapped.forward, 'KeyF'); assert.equal(swapped.focus, 'KeyW', 'the action that had the key takes the old one');
  assert.equal(rebind(DEFAULT_KEYS, 'forward', 'Escape'), null, 'Esc cannot be bound');
  assert.equal(rebind(DEFAULT_KEYS, 'forward', 'ArrowUp'), null, 'nor the arrow keys, which always move');
});

test('aiming: a body the ray hits wins over a thin connection passing in front of it — unless the body is small and far behind', () => {
  const link = (z: number): Pickable => ({ kind: 'link', id: 'wire', points: [[-40, 0, z], [40, 0, z]], radius: 3.2 });
  const body = (z: number): Pickable => ({ kind: 'cell', id: 'body', centre: [0, 0, z], radius: 11 });
  const site = (z: number): Pickable => ({ kind: 'site', id: 'tip', centre: [0, 0, z], radius: 10 });
  // a connection 90 µm in front of a body 340 µm away: the body looks about 2.7 times as wide as the connection's pick zone
  assert.equal(pick([0, 0, 0], [0, 0, -1], [link(-250), body(-340)])?.id, 'body');
  assert.equal(pick([0, 0, 0], [0, 0, -1], [link(-250), site(-340)])?.kind, 'site', 'a recording site is aimed at in the same way');
  // the same connection close to the eye, the body far behind it: the connection is what is being aimed at
  assert.equal(pick([0, 0, 0], [0, 0, -1], [link(-60), body(-900)])?.id, 'wire');
  // off the body, the connection is picked as before
  assert.equal(pick([0, 0, 0], lookDir(Math.atan2(-30, 250), 0), [link(-250), body(-340)])?.id, 'wire');
});
