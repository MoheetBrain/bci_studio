// The observation rig's controller: turns keys, the mouse and the on-screen controls into rig movement.
//
// Rules it keeps (they are tested in tests/e2e/neuroverse.mjs):
//   · it moves an OBSERVER. It never calls a scientific model; discrete actions are handed to whoever registered them;
//   · one mode owns a drag: in flight a drag looks around, in focus it orbits, with the mouse captured there is no drag;
//   · the click that captures the mouse selects nothing; a click selects, a drag never does;
//   · in the Pilot context the movement keys belong to the toy (read with pilotAxes), not to the rig — never to both;
//   · held keys are forgotten on window blur, on a change of context, and when the mouse is released;
//   · nothing happens while a text or number field has the focus;
//   · focus keeps the pose it left and Return restores exactly that pose.
import { ACTIONS, MOVE, actionFor, codeOf, isTyping, loadKeys, type Action } from './bindings';
import {
  NO_INPUT, applyLook, changeSpeedLevel, focusOrbit, lookAt, newFlight, nearSurface, orbitBy, orbitPose, pick, stepFlight, viewRay,
  type FlightInput, type FlightState, type Hit, type Orbit, type Pickable, type V3,
} from './flight';

export type Mode = 'fly' | 'orbit';
export type InputContext = 'explore' | 'pilot';
export interface Pose { pos: V3; yaw: number; pitch: number }
export interface ControllerView { mode: Mode; captured: boolean; context: InputContext; speedLevel: number; canReturn: boolean; orbitLabel: string; cutaway: boolean; moving: boolean }

const FOV = (58 * Math.PI) / 180;
const BOUND = 760;        // the rig cannot leave a cube of this half-size (µm) around the scene
const CUTAWAY_UM = 14;    // a cell body closer than this is faded so the view never fills with its inside
const TWEEN_MS = 260;
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class FlightController {
  s: FlightState = newFlight([0, 0, 300]);
  mode: Mode = 'fly';
  context: InputContext = 'explore';
  captured = false;
  orbit: Orbit | null = null;
  orbitLabel = '';
  /** The flight pose that Return goes back to. */
  saved: Pose | null = null;
  keys = loadKeys();
  held = new Set<Action>();
  aspect = 1.6;
  reducedMotion = false;
  /** What can be picked, and the cell bodies (for the near-surface cutaway). */
  pickables: Pickable[] = [];
  /** Discrete actions (focus, pause, tool …), registered by the workspace and the active toy. */
  actions: Partial<Record<Action, () => void>> = {};
  onPick: ((h: Hit | null) => void) | null = null;
  onChange: ((v: ControllerView) => void) | null = null;
  /** Called with the time of an input event, for the response-time sample. */
  onInput: ((t: number) => void) | null = null;
  /** The browser did not hand over the mouse. */
  onRefused: (() => void) | null = null;
  /** Remapping: the next key press is handed here instead of acting. */
  captureKey: ((code: string) => void) | null = null;
  readonly fovY = FOV;

  private dom: HTMLElement | null = null;
  private tween: { t0: number; ms: number; from: Pose; to: Pose; then: () => void } | null = null;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private wheelAcc = 0;
  private noPickUntil = 0;
  private lastView = '';
  private lastRefused = -1e9;
  private cutaway = false;
  private off: Array<() => void> = [];

  attach(dom: HTMLElement): void {
    this.detach();
    this.dom = dom;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => { t.addEventListener(type, fn as EventListener, opts); this.off.push(() => t.removeEventListener(type, fn as EventListener, opts)); };
    on(window, 'keydown', (e: KeyboardEvent) => this.keyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keyUp(e));
    on(window, 'blur', () => this.clearHeld());
    on(document, 'visibilitychange', () => { if (document.hidden) this.clearHeld(); });
    on(document, 'pointerlockchange', () => this.lockChanged());
    on(document, 'pointerlockerror', () => this.refused());
    on(document, 'mousemove', (e: MouseEvent) => { if (this.captured) { applyLook(this.s, e.movementX, e.movementY); this.onInput?.(e.timeStamp); } });
    on(dom, 'pointerdown', (e: PointerEvent) => this.pointerDown(e));
    on(dom, 'pointermove', (e: PointerEvent) => this.pointerMove(e));
    on(dom, 'pointerup', (e: PointerEvent) => this.pointerUp(e));
    on(dom, 'pointercancel', () => { this.drag = null; });
    on(dom, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(dom, 'contextmenu', (e: Event) => e.preventDefault());
    this.push();
  }
  detach(): void {
    for (const f of this.off) f();
    this.off = [];
    if (this.dom && document.pointerLockElement === this.dom) document.exitPointerLock();
    this.dom = null; this.clearHeld(); this.captured = false;
  }

  // ── state the UI shows ──────────────────────────────────────────────────────────────────────────────────────
  view(): ControllerView {
    return { mode: this.mode, captured: this.captured, context: this.context, speedLevel: this.s.speedLevel, canReturn: !!this.saved, orbitLabel: this.orbitLabel, cutaway: this.cutaway, moving: this.held.size > 0 && this.context === 'explore' };
  }
  private push(): void {
    const v = this.view(), key = JSON.stringify(v);
    if (key !== this.lastView) { this.lastView = key; this.onChange?.(v); }
  }
  pose(): Pose { return { pos: [this.s.pos[0], this.s.pos[1], this.s.pos[2]], yaw: this.s.yaw, pitch: this.s.pitch }; }
  setPose(p: Pose): void { this.s.pos = [p.pos[0], p.pos[1], p.pos[2]]; this.s.yaw = p.yaw; this.s.pitch = p.pitch; this.s.vel = [0, 0, 0]; }
  /** Start again from a scene's home pose. */
  home(pos: V3, target: V3): void {
    this.tween = null; this.mode = 'fly'; this.orbit = null; this.saved = null; this.orbitLabel = '';
    this.setPose({ pos, ...lookAt(pos, target) });
    this.clearHeld(); this.push();
  }

  // ── keyboard ────────────────────────────────────────────────────────────────────────────────────────────────
  private keyDown(e: KeyboardEvent): void {
    if (this.captureKey) { e.preventDefault(); e.stopPropagation(); if (e.code !== 'Escape') this.captureKey(codeOf(e)); else this.captureKey(''); return; }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = actionFor(this.keys, codeOf(e));
    if (!a) return;
    // a focused button keeps Space and Enter for itself
    if (e.code === 'Space' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
    e.preventDefault();
    this.onInput?.(e.timeStamp);
    if ((MOVE as readonly string[]).includes(a)) { this.held.add(a); this.finishTween(); this.push(); return; }
    if (!e.repeat) this.act(a);
  }
  private keyUp(e: KeyboardEvent): void {
    const a = actionFor(this.keys, codeOf(e));
    if (a && this.held.delete(a)) this.push();
  }
  /** Perform a discrete action (also used by the on-screen buttons). */
  act(a: Action): void {
    if (a === 'capture') { if (this.captured) this.release(); else this.requestCapture(); return; }
    if (a === 'return') { this.returnToFlight(); return; }
    this.actions[a]?.();
  }
  /** Press or release a movement control from an on-screen button. */
  hold(a: Action, down: boolean): void {
    if (down) { this.held.add(a); this.finishTween(); } else this.held.delete(a);
    this.push();
  }
  clearHeld(): void { if (this.held.size) { this.held.clear(); this.push(); } this.drag = null; }
  setContext(c: InputContext): void { if (c !== this.context) { this.context = c; this.clearHeld(); this.s.vel = [0, 0, 0]; this.push(); } }
  setKeys(keys: Record<Action, string>): void { this.keys = keys; this.clearHeld(); }
  /** In the Pilot context: what the movement keys ask of the toy (x right, y up, each −1…1) and whether "precise" is held. */
  pilotAxes(): { x: number; y: number; slow: boolean } {
    if (this.context !== 'pilot') return { x: 0, y: 0, slow: false };
    const h = this.held;
    return { x: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), y: (h.has('forward') || h.has('up') ? 1 : 0) - (h.has('back') || h.has('down') ? 1 : 0), slow: h.has('brake') };
  }
  private flightInput(): FlightInput {
    if (this.context !== 'explore' || this.mode !== 'fly') return NO_INPUT;
    const h = this.held;
    return { forward: (h.has('forward') ? 1 : 0) - (h.has('back') ? 1 : 0), right: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), up: (h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0), brake: h.has('brake') };
  }

  // ── mouse ───────────────────────────────────────────────────────────────────────────────────────────────────
  requestCapture(): void {
    if (!this.dom || this.captured) return;
    if (this.mode === 'orbit') this.flyFromHere();
    this.noPickUntil = performance.now() + 350;
    // a browser may refuse (window not in front, capture not supported): say so; dragging to look still works
    try { const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => this.refused()); } catch { this.refused(); }
  }
  private refused(): void { const now = performance.now(); if (now - this.lastRefused > 1500) { this.lastRefused = now; this.onRefused?.(); } }
  release(): void { if (this.dom && document.pointerLockElement === this.dom) document.exitPointerLock(); }
  private lockChanged(): void {
    const now = !!this.dom && document.pointerLockElement === this.dom;
    if (now === this.captured) return;
    this.captured = now;
    this.clearHeld();
    if (now) this.noPickUntil = performance.now() + 350;
    this.push();
  }
  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.onInput?.(e.timeStamp);
    if (this.captured) { if (performance.now() >= this.noPickUntil) this.pickAt(0, 0); return; }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { this.dom?.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  }
  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId || this.captured) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; d.x = e.clientX; d.y = e.clientY;
    this.finishTween();
    this.onInput?.(e.timeStamp);
    // "grab the scene": dragging right turns the view left, as in a map
    if (this.mode === 'orbit' && this.orbit) orbitBy(this.orbit, dx, dy); else applyLook(this.s, -dx * 1.4, -dy * 1.4);
  }
  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.id !== e.pointerId || this.captured) return;
    try { this.dom?.releasePointerCapture(e.pointerId); } catch { /* nothing to release */ }
    if (d.moved || performance.now() < this.noPickUntil || !this.dom) return;
    const r = this.dom.getBoundingClientRect();
    this.pickAt(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  }
  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.onInput?.(e.timeStamp);
    if (this.mode === 'orbit' && this.orbit) { this.orbit.dist = Math.max(18, Math.min(1400, this.orbit.dist * Math.exp(e.deltaY * 0.0016))); return; }
    this.wheelAcc += e.deltaY;
    while (Math.abs(this.wheelAcc) >= 60) { changeSpeedLevel(this.s, this.wheelAcc < 0 ? 1 : -1); this.wheelAcc -= Math.sign(this.wheelAcc) * 60; }
    this.push();
  }
  /** What is under a point of the view (x, y in −1…1; 0, 0 is the reticle). */
  hitAt(x: number, y: number): Hit | null { return pick(this.s.pos, viewRay(this.s.yaw, this.s.pitch, this.fovY, this.aspect, x, y), this.pickables, 1200); }
  private pickAt(x: number, y: number): void { this.onPick?.(this.hitAt(x, y)); }

  // ── focus, overview, return ─────────────────────────────────────────────────────────────────────────────────
  private goOrbit(o: Orbit, label: string): void {
    if (this.mode === 'fly' && !this.saved) this.saved = this.pose();
    this.release(); this.clearHeld();
    this.orbit = o; this.orbitLabel = label; this.mode = 'orbit';
    this.startTween(orbitPose(o), () => { /* the orbit takes over */ });
    this.push();
  }
  /** Look at one object from outside it; the flight pose is kept for Return. */
  focus(centre: V3, radius: number, label: string): void { this.goOrbit(focusOrbit(centre, radius, this.s.pos), label); }
  overview(o: Orbit): void { this.goOrbit({ pivot: [o.pivot[0], o.pivot[1], o.pivot[2]], dist: o.dist, az: o.az, el: o.el }, 'Overview'); }
  /** Back to the pose that focus or overview left — exactly. Does nothing to any model. */
  returnToFlight(): void {
    const to = this.saved;
    if (this.mode !== 'orbit' && !to) return;
    this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.saved = null; this.s.vel = [0, 0, 0];
    if (to) this.startTween(to, () => this.setPose(to));
    this.push();
  }
  /** Glide to a given flight pose (used when a toy takes the camera to its working view). The pose left is kept for Return. */
  glideTo(p: Pose): void {
    this.finishTween();
    if (!this.saved) this.saved = this.pose();
    this.release(); this.clearHeld();
    this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.s.vel = [0, 0, 0];
    this.startTween(p, () => this.setPose(p));
    this.push();
  }
  /** Leave focus but stay here. */
  flyFromHere(): void { this.finishTween(); this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.saved = null; this.s.vel = [0, 0, 0]; this.push(); }

  private startTween(to: Pose, then: () => void): void {
    if (this.reducedMotion) { this.tween = null; this.setPose(to); then(); return; }
    this.tween = { t0: performance.now(), ms: TWEEN_MS, from: this.pose(), to, then };
  }
  /** Any input ends a guided movement at once (at its destination, so that modes stay consistent). */
  private finishTween(): void { const t = this.tween; if (t) { this.tween = null; this.setPose(t.to); t.then(); } }
  get transitioning(): boolean { return !!this.tween; }

  /** Once per rendered frame. `dt` in seconds. */
  update(dt: number): void {
    const t = this.tween;
    if (t) {
      const k = Math.min(1, (performance.now() - t.t0) / t.ms), e = 1 - Math.pow(1 - k, 3);
      for (let a = 0; a < 3; a++) this.s.pos[a] = t.from.pos[a] + (t.to.pos[a] - t.from.pos[a]) * e;
      this.s.yaw = t.from.yaw + angle(t.to.yaw - t.from.yaw) * e; this.s.pitch = t.from.pitch + (t.to.pitch - t.from.pitch) * e;
      if (k >= 1) this.finishTween();
    } else if (this.mode === 'orbit' && this.orbit) {
      this.setPose(orbitPose(this.orbit));
    } else {
      stepFlight(this.s, this.flightInput(), Math.min(dt, 0.1));
      for (let a = 0; a < 3; a++) if (Math.abs(this.s.pos[a]) > BOUND) { this.s.pos[a] = Math.sign(this.s.pos[a]) * BOUND; this.s.vel[a] = 0; }
    }
    const near = nearSurface(this.s.pos, this.pickables.flatMap((p) => (p.kind === 'cell' ? [{ centre: p.centre, radius: p.radius }] : [])), CUTAWAY_UM);
    if (near !== this.cutaway) { this.cutaway = near; this.push(); }
  }
}

export const controller = new FlightController();
export const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])) as Record<Action, string>;
