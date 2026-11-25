// The observation rig's movement and aiming, as plain arithmetic: no DOM, no three.js, so it can be unit-tested and
// so that nothing here can touch a scientific model. Scene units are µm; angles are radians; time is seconds.
//
//   yaw    rotation about the scene's up axis (+y); 0 looks along −z, positive turns left;
//   pitch  rotation up (+) or down (−), limited to ±88°. There is no roll.
//
// Velocity follows the commanded velocity with a first-order response (time constant RESPONSE_S; BRAKE_S while the
// brake is held). The update is the exact solution of that response over the frame, so the path flown for a given
// sequence of key presses does not depend on the frame rate.
export type V3 = [number, number, number];

export const SPEEDS_UM_S = [15, 30, 60, 120, 240, 480] as const;
export const DEFAULT_SPEED_LEVEL = 3;
export const RESPONSE_S = 0.08;
export const BRAKE_S = 0.035;
/** While the brake is held, movement keys still creep at this fraction of the travel speed. */
export const PRECISION = 0.18;
/** Below this speed, with no key held, the rig is simply stopped. */
export const STOP_UM_S = 0.6;
export const PITCH_LIMIT = (88 * Math.PI) / 180;
export const LOOK_SENS = 0.0022;

export interface FlightState { pos: V3; yaw: number; pitch: number; vel: V3; speedLevel: number }
export interface FlightInput { forward: number; right: number; up: number; brake: boolean }
export const NO_INPUT: FlightInput = { forward: 0, right: 0, up: 0, brake: false };

export const newFlight = (pos: V3, yaw = 0, pitch = 0): FlightState => ({ pos: [pos[0], pos[1], pos[2]], yaw, pitch, vel: [0, 0, 0], speedLevel: DEFAULT_SPEED_LEVEL });

/** Unit vector the rig looks along. */
export function lookDir(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}
/** Unit vector to the rig's right (always level). */
export const rightDir = (yaw: number): V3 => [Math.cos(yaw), 0, -Math.sin(yaw)];
/** Yaw and pitch that look from `from` towards `to`. */
export function lookAt(from: V3, to: V3): { yaw: number; pitch: number } {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(dy, h))) };
}

export function applyLook(s: FlightState, dxPx: number, dyPx: number, sens = LOOK_SENS): void {
  s.yaw -= dxPx * sens;
  s.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.pitch - dyPx * sens));
  if (s.yaw > Math.PI) s.yaw -= 2 * Math.PI; else if (s.yaw < -Math.PI) s.yaw += 2 * Math.PI;
}

/** The velocity the keys ask for, µm/s. Forward follows the view; "up" is the scene's up. */
export function commanded(s: FlightState, i: FlightInput): V3 {
  const f = lookDir(s.yaw, s.pitch), r = rightDir(s.yaw);
  let x = f[0] * i.forward + r[0] * i.right, y = f[1] * i.forward + i.up, z = f[2] * i.forward + r[2] * i.right;
  const n = Math.hypot(x, y, z);
  if (n < 1e-9) return [0, 0, 0];
  const sp = SPEEDS_UM_S[s.speedLevel] * (i.brake ? PRECISION : 1) / Math.max(1, n);
  x *= sp; y *= sp; z *= sp;
  return [x, y, z];
}

/** Advance the rig by dt seconds under an input held constant over that time. */
export function stepFlight(s: FlightState, i: FlightInput, dt: number): void {
  if (!(dt > 0)) return;
  const tau = i.brake ? BRAKE_S : RESPONSE_S, k = Math.exp(-dt / tau), target = commanded(s, i);
  for (let a = 0; a < 3; a++) {
    const d = s.vel[a] - target[a];
    s.pos[a] += target[a] * dt + d * tau * (1 - k);
    s.vel[a] = target[a] + d * k;
  }
  // released keys mean stopped: once the rig has slowed to a crawl nobody could see, it is at rest (no residual drift)
  if (target[0] === 0 && target[1] === 0 && target[2] === 0 && Math.hypot(s.vel[0], s.vel[1], s.vel[2]) < STOP_UM_S) s.vel = [0, 0, 0];
}
export const speedOf = (s: FlightState) => Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
export const changeSpeedLevel = (s: FlightState, by: number) => { s.speedLevel = Math.max(0, Math.min(SPEEDS_UM_S.length - 1, s.speedLevel + by)); };

// ── focus / orbit ───────────────────────────────────────────────────────────────────────────────────────────────
export interface Orbit { pivot: V3; dist: number; az: number; el: number }
/** Where the rig is and where it looks for an orbit. */
export function orbitPose(o: Orbit): { pos: V3; yaw: number; pitch: number } {
  const c = Math.cos(o.el), pos: V3 = [o.pivot[0] + o.dist * Math.sin(o.az) * c, o.pivot[1] + o.dist * Math.sin(o.el), o.pivot[2] + o.dist * Math.cos(o.az) * c];
  return { pos, ...lookAt(pos, o.pivot) };
}
/**
 * An orbit that looks at an object of radius `r` from the side the rig is already on, far enough out to be outside
 * the object and to see all of it (`fit` = how many radii away).
 */
export function focusOrbit(centre: V3, r: number, from: V3, fit = 9, minDist = 30): Orbit {
  let dx = from[0] - centre[0], dy = from[1] - centre[1], dz = from[2] - centre[2];
  const n = Math.hypot(dx, dy, dz);
  if (n < 1e-6) { dx = 0; dy = 0.35; dz = 1; }
  const m = Math.hypot(dx, dy, dz);
  return { pivot: [centre[0], centre[1], centre[2]], dist: Math.max(minDist, r * fit), az: Math.atan2(dx, dz), el: Math.max(-1.2, Math.min(1.2, Math.asin(dy / m))) };
}
export function orbitBy(o: Orbit, dxPx: number, dyPx: number, sens = 0.006): void {
  o.az -= dxPx * sens;
  o.el = Math.max(-1.45, Math.min(1.45, o.el + dyPx * sens));
}

/** The ray through a point of the view (x, y in −1…1, y up) for a camera with no roll and a vertical field of view. */
export function viewRay(yaw: number, pitch: number, fovYRad: number, aspect: number, x: number, y: number): V3 {
  const f = lookDir(yaw, pitch), r = rightDir(yaw);
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];     // right × forward = camera up
  const t = Math.tan(fovYRad / 2), a = x * t * aspect, b = y * t;
  const d: V3 = [f[0] + r[0] * a + u[0] * b, f[1] + r[1] * a + u[1] * b, f[2] + r[2] * a + u[2] * b], n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
}

/** Where a scene point appears in the view (x, y in −1…1, y up), and whether it is in front of the rig. The inverse of viewRay. */
export function projectPoint(pos: V3, yaw: number, pitch: number, fovYRad: number, aspect: number, p: V3): { x: number; y: number; front: boolean } {
  const f = lookDir(yaw, pitch), r = rightDir(yaw), u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d: V3 = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]], z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2], t = Math.tan(fovYRad / 2);
  if (z <= 1e-6) return { x: 0, y: 0, front: false };
  return { x: (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (z * t * aspect), y: (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (z * t), front: true };
}

// ── aiming ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Distance along a ray to a sphere, or −1. A sphere that contains the origin is not hit (you are inside it). */
export function raySphere(o: V3, d: V3, c: V3, r: number): number {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}
/** Closest approach of a ray to a segment: distance between them and where along the ray, or null if behind. */
export function raySegment(o: V3, d: V3, a: V3, b: V3): { dist: number; t: number } | null {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = o[0] - a[0], wy = o[1] - a[1], wz = o[2] - a[2];
  const uu = ux * ux + uy * uy + uz * uz, ud = ux * d[0] + uy * d[1] + uz * d[2], uw = ux * wx + uy * wy + uz * wz, dw = d[0] * wx + d[1] * wy + d[2] * wz;
  const den = uu - ud * ud;
  let s = den > 1e-9 ? (uw - ud * dw) / den : 0;
  s = Math.max(0, Math.min(1, s));
  const t = s * ud - dw;
  if (t <= 0) return null;
  const px = o[0] + d[0] * t - (a[0] + ux * s), py = o[1] + d[1] * t - (a[1] + uy * s), pz = o[2] + d[2] * t - (a[2] + uz * s);
  return { dist: Math.hypot(px, py, pz), t };
}

export interface PickSphere { kind: 'cell'; id: string; centre: V3; radius: number }
export interface PickPath { kind: 'link'; id: string; points: V3[]; radius: number }
export type Pickable = PickSphere | PickPath;
export interface Hit { kind: 'cell' | 'link'; id: string; t: number }
/** The nearest thing a ray meets. A cell wins over a link that is hit less than 4 µm in front of it (links are thin and end on cells). */
export function pick(o: V3, d: V3, things: readonly Pickable[], maxDist = Infinity): Hit | null {
  let cell: Hit | null = null, link: Hit | null = null;
  for (const p of things) {
    if (p.kind === 'cell') {
      const t = raySphere(o, d, p.centre, p.radius);
      if (t > 0 && t < maxDist && (!cell || t < cell.t)) cell = { kind: 'cell', id: p.id, t };
    } else {
      for (let i = 0; i + 1 < p.points.length; i++) {
        const h = raySegment(o, d, p.points[i], p.points[i + 1]);
        if (h && h.dist <= p.radius && h.t < maxDist && (!link || h.t < link.t)) link = { kind: 'link', id: p.id, t: h.t };
      }
    }
  }
  if (cell && (!link || cell.t <= link.t + 4)) return cell;
  return link;
}

/** How deep the rig is inside the nearest cell body's "display cutaway" zone: > 0 when a soma surface is within `margin`. */
export function nearSurface(pos: V3, cells: ReadonlyArray<{ centre: V3; radius: number }>, margin: number): boolean {
  for (const c of cells) if (Math.hypot(pos[0] - c.centre[0], pos[1] - c.centre[1], pos[2] - c.centre[2]) < c.radius + margin) return true;
  return false;
}
