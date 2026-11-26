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

/** A cell body, or a recording site (an electrode contact): both are picked as spheres. */
export interface PickSphere { kind: 'cell' | 'site'; id: string; centre: V3; radius: number }
export interface PickPath { kind: 'link'; id: string; points: V3[]; radius: number }
export type Pickable = PickSphere | PickPath;
export interface Hit { kind: 'cell' | 'site' | 'link'; id: string; t: number }
/**
 * What a ray is aimed at. Normally the nearest thing it meets — but a body (cell or recording site) that the ray hits
 * wins over a thin connection passing in front of it, as long as the body looks at least 1.5 times as wide from here
 * as the connection's pick zone: someone aiming at the middle of a body means the body. A connection that is much
 * nearer than a small, distant body still wins.
 */
export function pick(o: V3, d: V3, things: readonly Pickable[], maxDist = Infinity): Hit | null {
  let cell: Hit | null = null, link: Hit | null = null, cellR = 0, linkR = 0;
  for (const p of things) {
    if (p.kind !== 'link') {
      const t = raySphere(o, d, p.centre, p.radius);
      if (t > 0 && t < maxDist && (!cell || t < cell.t)) { cell = { kind: p.kind, id: p.id, t }; cellR = p.radius; }
    } else {
      for (let i = 0; i + 1 < p.points.length; i++) {
        const h = raySegment(o, d, p.points[i], p.points[i + 1]);
        if (h && h.dist <= p.radius && h.t < maxDist && (!link || h.t < link.t)) { link = { kind: 'link', id: p.id, t: h.t }; linkR = p.radius; }
      }
    }
  }
  if (cell && (!link || cell.t <= link.t + Math.max(4, cellR) || cellR / cell.t >= (1.5 * linkR) / Math.max(1e-6, link.t))) return cell;
  return link;
}

/** How deep the rig is inside the nearest cell body's "display cutaway" zone: > 0 when a soma surface is within `margin`. */
export function nearSurface(pos: V3, cells: ReadonlyArray<{ centre: V3; radius: number }>, margin: number): boolean {
  for (const c of cells) if (Math.hypot(pos[0] - c.centre[0], pos[1] - c.centre[1], pos[2] - c.centre[2]) < c.radius + margin) return true;
  return false;
}

// ── whole-object aiming ─────────────────────────────────────────────────────────────────────────────────────────
// Every visible thing that can be pointed at is a BODY: an owner id plus the simple shapes that stand in for what is
// drawn — a sphere for a cell body or a contact, capsules along every branch (the same centre lines and calibres the
// mesh is built from). Pointing at any of them resolves to the owner, with the name of the part that was hit.
//
// Occlusion: the nearest shape the ray really passes through wins, whatever it belongs to — you cannot select through
// something opaque in front. Only when the ray passes through nothing does a near miss count (thin branches are a few
// pixels wide), and then the smallest miss on screen wins. Two exceptions, both deliberate: manipulation handles are
// drawn on top and are picked first; and a declared connection (a thin tube that starts inside a cell body) gives way
// to a body behind it that looks clearly wider, as before.
export type BodyKind = 'cell' | 'context' | 'site' | 'link' | 'landmark' | 'handle';
export interface PickBody {
  kind: BodyKind;
  id: string;
  /** A sphere part (cell body, contact, handle knob). */
  centre?: V3; radius?: number; spherePart?: string;
  /** Capsules, 7 numbers each: ax, ay, az, bx, by, bz, radius. */
  segs?: Float32Array;
  /** Part name per capsule (index into `partNames`). */
  parts?: Uint8Array; partNames?: readonly string[];
  /** Runs of capsules with a sphere that contains them, so that most of a large arbor is skipped without being tested. */
  chunks?: Array<{ c: V3; r: number; from: number; to: number }>;
  /** A sphere containing the whole body. */
  bound: { c: V3; r: number };
}
export interface BodyHit { kind: BodyKind; id: string; t: number; part: string; point: V3; exact: boolean }

/** Group a body's capsules into runs of `size` with bounding spheres (capsules arrive in branch order, so runs are compact). */
export function chunkBody(segs: Float32Array, size = 48): Array<{ c: V3; r: number; from: number; to: number }> {
  const out: Array<{ c: V3; r: number; from: number; to: number }> = [], n = segs.length / 7;
  for (let from = 0; from < n; from += size) {
    const to = Math.min(n, from + size);
    let cx = 0, cy = 0, cz = 0;
    for (let i = from; i < to; i++) { cx += segs[i * 7] + segs[i * 7 + 3]; cy += segs[i * 7 + 1] + segs[i * 7 + 4]; cz += segs[i * 7 + 2] + segs[i * 7 + 5]; }
    const k = 1 / (2 * (to - from)); cx *= k; cy *= k; cz *= k;
    let r = 0;
    for (let i = from; i < to; i++) for (const o of [0, 3]) r = Math.max(r, Math.hypot(segs[i * 7 + o] - cx, segs[i * 7 + o + 1] - cy, segs[i * 7 + o + 2] - cz) + segs[i * 7 + 6]);
    out.push({ c: [cx, cy, cz], r, from, to });
  }
  return out;
}
/** The sphere that contains a set of capsules and an optional sphere part. */
export function boundOf(segs: Float32Array | undefined, centre?: V3, radius = 0): { c: V3; r: number } {
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const eat = (x: number, y: number, z: number, r: number) => { lo = [Math.min(lo[0], x - r), Math.min(lo[1], y - r), Math.min(lo[2], z - r)]; hi = [Math.max(hi[0], x + r), Math.max(hi[1], y + r), Math.max(hi[2], z + r)]; };
  if (centre) eat(centre[0], centre[1], centre[2], radius);
  if (segs) for (let i = 0; i < segs.length; i += 7) { eat(segs[i], segs[i + 1], segs[i + 2], segs[i + 6]); eat(segs[i + 3], segs[i + 4], segs[i + 5], segs[i + 6]); }
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { c, r: Math.hypot(hi[0] - c[0], hi[1] - c[1], hi[2] - c[2]) };
}

/** Does the ray come within `r` of the sphere's centre in front of the origin (or start inside it)? */
function nearSphere(o: V3, d: V3, c: V3, r: number): boolean {
  const ox = c[0] - o[0], oy = c[1] - o[1], oz = c[2] - o[2], b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz;
  if (cc <= r * r) return true;
  return b > 0 && cc - b * b <= r * r;
}

/**
 * What the ray is aimed at among `bodies`. `slack` is how far, as an angle (radians ≈ pixels × field of view ÷ view
 * height), a ray may pass a shape and still pick it when it passes through nothing at all.
 */
export function pickBody(o: V3, d: V3, bodies: readonly PickBody[], maxDist = Infinity, slack = 0.006): BodyHit | null {
  let best: BodyHit | null = null, near: BodyHit | null = null, nearMiss = Infinity, handle: BodyHit | null = null, handleMiss = Infinity;
  let bestR = 0, linkR = 0, sphere: BodyHit | null = null, sphereR = 0;
  const at = (t: number): V3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  for (const b of bodies) {
    const reach = b.kind === 'handle' ? 4 : 1;
    if (!nearSphere(o, d, b.bound.c, b.bound.r + (Math.hypot(b.bound.c[0] - o[0], b.bound.c[1] - o[1], b.bound.c[2] - o[2]) + b.bound.r) * slack * reach)) continue;
    const consider = (t: number, miss: number, r: number, part: string) => {
      if (!(t > 0) || t > maxDist) return;
      if (b.kind === 'handle') {
        // handles are drawn over everything and are generous to hit
        const m = Math.max(0, miss) / t;
        if (m <= slack * reach && m < handleMiss) { handleMiss = m; handle = { kind: b.kind, id: b.id, t, part, point: at(t), exact: miss <= 0 }; }
        return;
      }
      if (miss <= 0) {
        if (!best || t < best.t) { best = { kind: b.kind, id: b.id, t, part, point: at(t), exact: true }; bestR = r; if (b.kind === 'link') linkR = r; }
        if (b.kind !== 'link' && part === (b.spherePart ?? 'body') && b.centre && (!sphere || t < sphere.t)) { sphere = { kind: b.kind, id: b.id, t, part, point: at(t), exact: true }; sphereR = r; }
      } else {
        const m = miss / t;
        if (m <= slack && m < nearMiss) { nearMiss = m; near = { kind: b.kind, id: b.id, t, part, point: at(t), exact: false }; }
      }
    };
    if (b.centre && b.radius) {
      const t = raySphere(o, d, b.centre, b.radius);
      if (t > 0) consider(t, 0, b.radius, b.spherePart ?? 'body');
      else {
        // not through it: how far past its surface?
        const ox = b.centre[0] - o[0], oy = b.centre[1] - o[1], oz = b.centre[2] - o[2], tc = ox * d[0] + oy * d[1] + oz * d[2];
        if (tc > 0) consider(tc, Math.sqrt(Math.max(0, ox * ox + oy * oy + oz * oz - tc * tc)) - b.radius, b.radius, b.spherePart ?? 'body');
      }
    }
    const s = b.segs;
    if (!s) continue;
    const test = (from: number, to: number) => {
      for (let i = from; i < to; i++) {
        const k = i * 7, h = raySegment(o, d, [s[k], s[k + 1], s[k + 2]], [s[k + 3], s[k + 4], s[k + 5]]);
        if (!h) continue;
        const r = s[k + 6], miss = h.dist - r;
        // through the capsule: the surface is met a little before the closest approach
        consider(miss <= 0 ? Math.max(1e-6, h.t - Math.sqrt(Math.max(0, r * r - h.dist * h.dist))) : h.t, miss, r, b.partNames?.[b.parts ? b.parts[i] : 0] ?? '');
      }
    };
    if (b.chunks) { for (const c of b.chunks) if (nearSphere(o, d, c.c, c.r + (Math.hypot(c.c[0] - o[0], c.c[1] - o[1], c.c[2] - o[2]) + c.r) * slack)) test(c.from, c.to); }
    else test(0, s.length / 7);
  }
  if (handle) return handle;
  // a declared connection in front of a body that looks clearly wider gives way to the body
  const b0 = best as BodyHit | null, s0 = sphere as BodyHit | null;
  if (b0 && b0.kind === 'link' && s0 && sphereR / s0.t >= (1.5 * Math.max(linkR, bestR)) / Math.max(1e-6, b0.t)) return s0;
  return b0 ?? near;
}

// ── the player's craft and the camera that follows it ───────────────────────────────────────────────────────────
export interface Boom { dist: number; height: number }
/**
 * Where a third-person camera sits for a craft at `pos` aimed along (yaw, pitch): behind it by `dist` and above by
 * `height` (along the camera's own up), looking the same way. `pull` (0…1) shortens the boom towards the craft.
 */
export function boomPose(pos: V3, yaw: number, pitch: number, boom: Boom, pull = 0): { pos: V3; yaw: number; pitch: number } {
  const f = lookDir(yaw, pitch), r = rightDir(yaw), u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], k = 1 - pull;
  return { pos: [pos[0] - f[0] * boom.dist * k + u[0] * boom.height * k, pos[1] - f[1] * boom.dist * k + u[1] * boom.height * k, pos[2] - f[2] * boom.dist * k + u[2] * boom.height * k], yaw, pitch };
}
/** How far the boom must be pulled in (0…1) so that the camera is outside every sphere (cell bodies, grown by `margin`). */
export function boomPull(pos: V3, yaw: number, pitch: number, boom: Boom, spheres: ReadonlyArray<{ centre: V3; radius: number }>, margin: number): number {
  let pull = 0;
  for (let step = 0; step < 6; step++) {
    const c = boomPose(pos, yaw, pitch, boom, pull).pos;
    if (!spheres.some((s) => Math.hypot(c[0] - s.centre[0], c[1] - s.centre[1], c[2] - s.centre[2]) < s.radius + margin)) return pull;
    pull = Math.min(0.9, pull + 0.16);
  }
  return pull;
}
/** Move `v` towards `to` by the exact first-order response over `dt` (time constant `tau`): frame-rate independent. */
export const ease = (v: number, to: number, dt: number, tau: number) => to + (v - to) * Math.exp(-dt / Math.max(1e-4, tau));
/** The same for an angle, the short way round. */
export const easeAngle = (v: number, to: number, dt: number, tau: number) => { const d = Math.atan2(Math.sin(to - v), Math.cos(to - v)); return v + d * (1 - Math.exp(-dt / Math.max(1e-4, tau))); };
/**
 * A critically damped approach of `v` to `to` that starts from the speed it already has (`vel`), so a move begins
 * gently and ends without overshoot. Returns the new value and the new speed. `time` ≈ how long most of the move takes.
 */
export function smoothDamp(v: number, to: number, vel: number, time: number, dt: number): [number, number] {
  const w = 2 / Math.max(1e-4, time), x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), d = v - to, t = (vel + w * d) * dt;
  return [to + (d + t) * e, (vel - w * t) * e];
}
