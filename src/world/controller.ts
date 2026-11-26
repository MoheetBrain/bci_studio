// The controller: turns keys, the mouse and the on-screen controls into movement.
//
// Two ways of using it:
//   prototypes (embodied = false)   `s` is the camera itself, as it was;
//   the world     (embodied = true)   `s` is the PLAYER — a craft with its own position and aim in the scene. The camera
//                                     is a separate thing (`cam`) that follows the craft from behind (third person), sits
//                                     in it (first person), or leaves it to look at something (Inspect). The craft's
//                                     drawn attitude (`body`) turns towards the aim with a short delay, so the craft is
//                                     seen to turn and translate on its own.
//
// Rules it keeps (tested in tests/e2e/world.mjs and tests/world-flight.test.ts):
//   · it moves an OBSERVER. It never calls a scientific model; discrete actions are handed to whoever registered them;
//   · one mode owns a drag: in flight a drag looks around, in Inspect it orbits, with the mouse captured there is no drag;
//   · the click that captures the mouse selects nothing; a click selects, a drag never does;
//   · SELECTING something changes nothing about who owns the keys. Only three things do: Inspect (an explicit focus —
//     and the first movement key leaves it and flies), Decoder Pilot (the movement keys are the intent, never the craft)
//     and a form control that has the keyboard focus;
//   · held keys are forgotten on window blur, on a change of context, and when the mouse is released;
//   · nothing the camera does is a jump that an interruption could leave half-done: the camera always eases from where
//     it IS towards where it should be, and an interrupted craft journey simply stops where the craft is.
//
// Who owns the keyboard (`strictOwnership`): the world's shortcuts act only while the keyboard focus is on the page
// itself or on the world's own view. A slider, field, list or button that has the focus keeps every key for itself, as
// controls do; pressing on the scene (or Escape) gives the focus back to the world.
import { ACTIONS, MOVE, actionFor, codeOf, isTyping, loadKeys, type Action } from './bindings';
import {
  NO_INPUT, SPEEDS_UM_S, applyLook, boomPose, boomPull, changeSpeedLevel, ease, easeAngle, focusOrbit, lookAt, lookDir, newFlight, nearSurface, orbitBy, orbitPose, pick, pickBody,
  rightDir, smoothDamp, stepFlight, viewRay, type BodyHit, type Boom, type FlightInput, type FlightState, type Orbit, type PickBody, type Pickable, type V3,
} from './flight';

export type Mode = 'fly' | 'orbit';
export type InputContext = 'explore' | 'pilot';
export type ViewKind = 'third' | 'first';
export interface Pose { pos: V3; yaw: number; pitch: number }
export interface ControllerView {
  mode: Mode; captured: boolean; context: InputContext; speedLevel: number; canReturn: boolean; orbitLabel: string; cutaway: boolean; moving: boolean;
  /** Third or first person (the world only). */
  viewKind: ViewKind;
  /** The craft is travelling by itself to a place the player asked for. */
  travelling: boolean;
}

const FOV = (58 * Math.PI) / 180;
const BOUND = 760;        // by default the rig cannot leave a cube of this half-size (µm) around the scene
const CUTAWAY_UM = 14;    // a cell body closer than this is faded so the view never fills with its inside
const TWEEN_MS = 260;
/** Something on the page other than the world's view has the keyboard focus. */
export function focusIsElsewhere(target?: EventTarget | null): boolean {
  const el = (target as Element | null) ?? (typeof document === 'undefined' ? null : document.activeElement);
  if (!el || el === document.body || el === document.documentElement) return false;
  return !(el instanceof Element && el.closest('[data-world-view]'));
}
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class FlightController {
  s: FlightState = newFlight([0, 0, 300]);
  mode: Mode = 'fly';
  context: InputContext = 'explore';
  captured = false;
  orbit: Orbit | null = null;
  orbitLabel = '';
  /** The flight pose that Return goes back to (prototypes only: in the world the craft never left). */
  saved: Pose | null = null;
  keys = loadKeys();
  held = new Set<Action>();
  aspect = 1.6;
  /** Height of the view in CSS pixels (for how many pixels a near miss may be). */
  viewHeightPx = 800;
  reducedMotion = false;
  /** Prototypes: what can be picked, and the cell bodies (for the near-surface cutaway). */
  pickables: Pickable[] = [];
  /** The world: every visible thing that can be pointed at (see flight.ts). When set, it replaces `pickables`. */
  bodies: PickBody[] | null = null;
  /** Discrete actions (focus, pause, tool …), registered by the workspace and the active toy. */
  actions: Partial<Record<Action, () => void>> = {};
  onPick: ((h: BodyHit | null) => void) | null = null;
  onChange: ((v: ControllerView) => void) | null = null;
  /** Called with the time of an input event, for the response-time sample. */
  onInput: ((t: number) => void) | null = null;
  /** The browser did not hand over the mouse. */
  onRefused: (() => void) | null = null;
  /** Remapping: the next key press is handed here instead of acting. */
  captureKey: ((code: string) => void) | null = null;
  readonly fovY = FOV;
  /** The box the rig stays in, µm. */
  bounds: { min: V3; max: V3 } = { min: [-BOUND, -BOUND, -BOUND], max: [BOUND, BOUND, BOUND] };
  /** See the header: keys act only while the world has the keyboard focus. */
  strictOwnership = false;
  /** False while the scene is mounted but not shown: no key reaches the rig or its actions. */
  enabled = true;
  /** What the wheel does while flying: change the travel speed, or move along the line of sight. */
  wheelMode: 'speed' | 'dolly' = 'speed';
  /** Camera glides take longer for longer moves (prototypes); otherwise they are short and fixed. */
  scaledGlides = false;
  /** Dragging turns the view the way the pointer moves ("look") instead of pulling the scene with it ("grab"). */
  dragLooks = false;
  /** Multiplier on the turn rate of both drag and captured mouse. */
  lookScale = 1;
  /** A double click on the scene (not a drag): what was under it. */
  onDouble: ((h: BodyHit | null) => void) | null = null;

  // ── the world: a player with a camera that follows ────────────────────────────────────────────────────────────
  embodied = false;
  viewKind: ViewKind = 'third';
  /** The camera as it is drawn (and as aiming uses it). */
  cam: Pose = { pos: [0, 0, 300], yaw: 0, pitch: 0 };
  /** The craft's drawn attitude: it follows the aim with a short delay and leans a little into its own movement. */
  body = { yaw: 0, pitch: 0, roll: 0 };
  boom: Boom = { dist: 62, height: 19 };
  /** A place the craft is flying itself to (null = the player is flying it). */
  auto: Pose | null = null;
  /** While it flies itself: its speed (x, y, z, yaw, pitch) and how long most of the journey takes, s. */
  private autoVel = [0, 0, 0, 0, 0];
  private autoTime = 0.6;
  /** Where the pointer is over the view (x, y in −1…1, y up), or null. */
  pointer: [number, number] | null = null;
  /** Dragging a manipulation handle: begin (true = taken), then the aim ray every time it changes, then the end. */
  onManip: { start: (hit: BodyHit) => boolean; move: (o: V3, d: V3) => void; end: () => void; cancel?: () => void } | null = null;

  private dom: HTMLElement | null = null;
  private tween: { t0: number; ms: number; from: Pose; to: Pose; then: () => void } | null = null;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private manip: { id: number } | null = null;
  private wheelAcc = 0;
  private noPickUntil = 0;
  private lastView = '';
  private lastRefused = -1e9;
  private cutaway = false;
  /** Seconds of slow blending left after the camera was sent somewhere else. */
  private camSettle = 0;
  private snapSoon = false;
  /** How far the camera still is from where it should be, µm (0 once it has arrived). */
  private camOff = 0;
  /** The camera's own speed (x, y, z, yaw, pitch), so that a move to somewhere else starts gently from how it was moving. */
  private camVel = [0, 0, 0, 0, 0];
  private pull = 0;
  private spheres: Array<{ centre: V3; radius: number }> = [];
  private spheresOf: PickBody[] | null = null;
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
    on(document, 'mousemove', (e: MouseEvent) => { if (this.captured) { this.auto = null; applyLook(this.s, e.movementX * this.lookScale, e.movementY * this.lookScale); this.onInput?.(e.timeStamp); } });
    // a control that takes the keyboard focus also takes the keys: let go of whatever was held
    on(document, 'focusin', (e: FocusEvent) => { if (this.strictOwnership && focusIsElsewhere(e.target)) this.clearHeld(); });
    on(dom, 'dblclick', (e: MouseEvent) => { if (this.captured || !this.dom) return; const [x, y] = this.ndc(e); this.onDouble?.(this.hitAt(x, y)); });
    on(dom, 'pointerdown', (e: PointerEvent) => this.pointerDown(e));
    on(dom, 'pointermove', (e: PointerEvent) => this.pointerMove(e));
    on(dom, 'pointerup', (e: PointerEvent) => this.pointerUp(e));
    on(dom, 'pointercancel', () => { this.drag = null; this.endManip(); });
    on(dom, 'pointerleave', () => { this.pointer = null; });
    on(dom, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(dom, 'contextmenu', (e: Event) => e.preventDefault());
    this.push();
  }
  detach(): void {
    for (const f of this.off) f();
    this.off = [];
    if (this.dom && document.pointerLockElement === this.dom) document.exitPointerLock();
    this.dom = null; this.clearHeld(); this.captured = false; this.pointer = null; this.manip = null;
  }

  // ── state the UI shows ──────────────────────────────────────────────────────────────────────────────────────
  view(): ControllerView {
    return {
      mode: this.mode, captured: this.captured, context: this.context, speedLevel: this.s.speedLevel, canReturn: this.embodied ? this.mode === 'orbit' : !!this.saved, orbitLabel: this.orbitLabel,
      cutaway: this.cutaway, moving: this.held.size > 0 && this.context === 'explore', viewKind: this.viewKind, travelling: !!this.auto,
    };
  }
  private push(): void {
    const v = this.view(), key = JSON.stringify(v);
    if (key !== this.lastView) { this.lastView = key; this.onChange?.(v); }
  }
  /** The player's pose: where the craft is and where it is aimed (prototypes: the camera). */
  pose(): Pose { return { pos: [this.s.pos[0], this.s.pos[1], this.s.pos[2]], yaw: this.s.yaw, pitch: this.s.pitch }; }
  setPose(p: Pose): void { this.s.pos = [p.pos[0], p.pos[1], p.pos[2]]; this.s.yaw = p.yaw; this.s.pitch = p.pitch; this.s.vel = [0, 0, 0]; }
  /** The camera's pose: what is drawn, and where aiming starts from. */
  camPose(): Pose { return this.embodied ? this.cam : this.pose(); }
  /** Where the camera should be for the present mode and view (before easing). */
  private camWant(): Pose {
    if (this.mode === 'orbit' && this.orbit) return orbitPose(this.orbit);
    if (this.viewKind === 'first') { const f = lookDir(this.s.yaw, this.s.pitch); return { pos: [this.s.pos[0] + f[0] * 2.4, this.s.pos[1] + f[1] * 2.4 + 0.8, this.s.pos[2] + f[2] * 2.4], yaw: this.s.yaw, pitch: this.s.pitch }; }
    return boomPose(this.s.pos, this.s.yaw, this.s.pitch, this.boom, this.pull);
  }
  /** Put the camera exactly where it should be (a new scene, a cut with reduced motion). */
  snapCamera(): void { this.pull = 0; this.camOff = 0; this.camVel = [0, 0, 0, 0, 0]; const w = this.camWant(); this.cam = { pos: [w.pos[0], w.pos[1], w.pos[2]], yaw: w.yaw, pitch: w.pitch }; this.body.yaw = this.s.yaw; this.body.pitch = this.s.pitch; this.body.roll = 0; this.camSettle = 0; this.snapSoon = false; }
  /** Start again from a scene's home pose. */
  home(pos: V3, target: V3): void {
    this.tween = null; this.mode = 'fly'; this.orbit = null; this.saved = null; this.orbitLabel = ''; this.auto = null;
    this.setPose({ pos, ...lookAt(pos, target) });
    if (this.embodied) this.snapCamera();
    this.clearHeld(); this.push();
  }
  /** Third person (the camera follows the craft) or first person (the camera is in it). The player's pose is the same. */
  setView(v: ViewKind): void { if (v === this.viewKind) return; this.viewKind = v; this.settle(0.32); this.push(); }
  private settle(seconds: number): void { if (this.reducedMotion) { this.snapSoon = true; this.camSettle = 0; } else this.camSettle = Math.max(this.camSettle, seconds); }

  // ── keyboard ────────────────────────────────────────────────────────────────────────────────────────────────
  private keyDown(e: KeyboardEvent): void {
    if (this.captureKey) { e.preventDefault(); e.stopPropagation(); if (e.code !== 'Escape') this.captureKey(codeOf(e)); else this.captureKey(''); return; }
    if (!this.enabled || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.strictOwnership && focusIsElsewhere(e.target)) return;
    const a = actionFor(this.keys, codeOf(e));
    if (!a) return;
    // a focused button keeps Space and Enter for itself
    if (e.code === 'Space' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
    e.preventDefault();
    this.onInput?.(e.timeStamp);
    if ((MOVE as readonly string[]).includes(a)) { this.held.add(a); this.interrupt(); this.push(); return; }
    if (!e.repeat) this.act(a);
  }
  private keyUp(e: KeyboardEvent): void {
    const a = actionFor(this.keys, codeOf(e));
    if (a && this.held.delete(a)) this.push();
  }
  /** The player took the controls: whatever the camera or the craft was doing by itself ends, where it is. */
  private interrupt(): void {
    if (!this.embodied) { this.finishTween(); return; }
    if (this.context !== 'explore') return;
    if (this.auto) { const top = 2 * (SPEEDS_UM_S[this.s.speedLevel] || 120), n = Math.hypot(this.s.vel[0], this.s.vel[1], this.s.vel[2]); if (n > top) this.s.vel = [(this.s.vel[0] / n) * top, (this.s.vel[1] / n) * top, (this.s.vel[2] / n) * top]; }
    this.auto = null;
    // the first movement key in Inspect leaves it and flies: the camera comes back to the craft from where it is
    if (this.mode === 'orbit') { this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.settle(0.4); }
  }
  /** Perform a discrete action (also used by the on-screen buttons). */
  act(a: Action): void {
    if (a === 'capture') { if (this.captured) this.release(); else this.requestCapture(); return; }
    if (a === 'return') { this.returnToFlight(); return; }
    this.actions[a]?.();
  }
  /** Press or release a movement control from an on-screen button. */
  hold(a: Action, down: boolean): void {
    if (down) { this.held.add(a); this.interrupt(); } else this.held.delete(a);
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
    if (this.mode === 'orbit') { if (this.embodied) this.returnToFlight(); else this.flyFromHere(); }
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
    this.clearHeld(); this.endManip();
    if (now) this.noPickUntil = performance.now() + 350;
    this.push();
  }
  private ndc(e: { clientX: number; clientY: number }): [number, number] { const r = this.dom!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]; }
  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.onInput?.(e.timeStamp);
    // pressing on the scene hands the keyboard back to the world
    (this.dom?.closest('[data-world-view]') as HTMLElement | null)?.focus({ preventScroll: true });
    if (this.captured) {
      if (performance.now() < this.noPickUntil) return;
      const hit = this.hitAt(0, 0);
      if (hit?.kind === 'handle' && this.onManip?.start(hit)) { this.manip = { id: e.pointerId }; return; }
      this.onPick?.(hit);
      return;
    }
    if (this.dom) {
      const [x, y] = this.ndc(e), hit = this.hitAt(x, y);
      this.pointer = [x, y];
      if (hit?.kind === 'handle' && this.onManip?.start(hit)) { this.manip = { id: e.pointerId }; try { this.dom.setPointerCapture(e.pointerId); } catch { /* gone */ } return; }
    }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { this.dom?.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  }
  private pointerMove(e: PointerEvent): void {
    if (this.dom && !this.captured) this.pointer = this.ndc(e);
    if (this.manip) { if (!this.captured && this.pointer) { const r = this.rayAt(this.pointer[0], this.pointer[1]); this.onManip?.move(r.o, r.d); } return; }
    const d = this.drag;
    if (!d || d.id !== e.pointerId || this.captured) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; d.x = e.clientX; d.y = e.clientY;
    if (!this.embodied) this.finishTween();
    this.onInput?.(e.timeStamp);
    // "grab the scene": dragging right turns the view left, as in a map (or the other way round, if the player prefers)
    const k = (this.dragLooks ? 1.4 : -1.4) * this.lookScale;
    if (this.mode === 'orbit' && this.orbit) orbitBy(this.orbit, dx, dy); else { this.auto = null; applyLook(this.s, dx * k, dy * k); }
  }
  private pointerUp(e: PointerEvent): void {
    if (this.manip) { this.endManip(); try { this.dom?.releasePointerCapture(e.pointerId); } catch { /* nothing to release */ } return; }
    const d = this.drag;
    this.drag = null;
    if (!d || d.id !== e.pointerId || this.captured) return;
    try { this.dom?.releasePointerCapture(e.pointerId); } catch { /* nothing to release */ }
    if (d.moved || performance.now() < this.noPickUntil || !this.dom) return;
    const [x, y] = this.ndc(e);
    this.onPick?.(this.hitAt(x, y));
  }
  private endManip(): void { if (this.manip) { this.manip = null; this.onManip?.end(); } }
  get manipulating(): boolean { return !!this.manip; }
  /** Abandon a handle drag: the thing goes back to where it was (the owner's `cancel`), and nothing is recorded. */
  cancelManip(): void { if (this.manip) { this.manip = null; if (this.onManip?.cancel) this.onManip.cancel(); else this.onManip?.end(); } }
  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.onInput?.(e.timeStamp);
    if (this.mode === 'orbit' && this.orbit) { this.orbit.dist = Math.max(18, Math.min(2200, this.orbit.dist * Math.exp(e.deltaY * 0.0016))); return; }
    if (this.wheelMode === 'dolly') {
      // a push along the line of sight; the flight response turns it into a short, smooth glide that stops by itself
      if (this.mode !== 'fly' || this.context !== 'explore') return;
      this.interrupt();
      const f = lookDir(this.s.yaw, this.s.pitch), dv = -Math.max(-240, Math.min(240, e.deltaY)) * 3.2 * (SPEEDS_UM_S[this.s.speedLevel] / 120);
      for (let a = 0; a < 3; a++) this.s.vel[a] = Math.max(-1400, Math.min(1400, this.s.vel[a] + f[a] * dv));
      return;
    }
    this.wheelAcc += e.deltaY;
    while (Math.abs(this.wheelAcc) >= 60) { changeSpeedLevel(this.s, this.wheelAcc < 0 ? 1 : -1); this.wheelAcc -= Math.sign(this.wheelAcc) * 60; }
    this.push();
  }

  // ── aiming ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** The ray through a point of the view (x, y in −1…1; 0, 0 is the reticle), from the camera. */
  rayAt(x: number, y: number): { o: V3; d: V3 } { const c = this.camPose(); return { o: [c.pos[0], c.pos[1], c.pos[2]], d: viewRay(c.yaw, c.pitch, this.fovY, this.aspect, x, y) }; }
  /** The ray the player is aiming along: through the pointer, or through the reticle while the mouse is captured. Null when the pointer is elsewhere. */
  aim(): { o: V3; d: V3 } | null { if (this.captured) return this.rayAt(0, 0); return this.pointer ? this.rayAt(this.pointer[0], this.pointer[1]) : null; }
  /** How far, as an angle, a ray may pass a thin thing and still pick it: about five pixels. */
  get slack(): number { return (5 * 2 * Math.tan(this.fovY / 2)) / Math.max(200, this.viewHeightPx); }
  /** What is under a point of the view. */
  hitAt(x: number, y: number): BodyHit | null {
    const { o, d } = this.rayAt(x, y);
    if (this.bodies) return pickBody(o, d, this.bodies, 2600, this.slack);
    const h = pick(o, d, this.pickables, 1200);
    return h ? { kind: h.kind, id: h.id, t: h.t, part: '', point: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t], exact: true } : null;
  }

  // ── focus, overview, return ─────────────────────────────────────────────────────────────────────────────────
  private goOrbit(o: Orbit, label: string): void {
    if (this.embodied) {
      // Inspect: the camera leaves the craft to look at something. The craft stays where it is.
      this.auto = null; this.release(); this.clearHeld();
      this.orbit = o; this.orbitLabel = label; this.mode = 'orbit'; this.s.vel = [0, 0, 0];
      this.settle(0.5); this.push();
      return;
    }
    if (this.mode === 'fly' && !this.saved) this.saved = this.pose();
    this.release(); this.clearHeld();
    this.orbit = o; this.orbitLabel = label; this.mode = 'orbit';
    this.startTween(orbitPose(o), () => { /* the orbit takes over */ });
    this.push();
  }
  /** Look at one object from outside it. In the world the craft stays put; in the prototypes the flight pose is kept for Return. */
  focus(centre: V3, radius: number, label: string, fit = 9): void { this.goOrbit(focusOrbit(centre, radius, this.camPose().pos, fit), label); }
  overview(o: Orbit): void { this.goOrbit({ pivot: [o.pivot[0], o.pivot[1], o.pivot[2]], dist: o.dist, az: o.az, el: o.el }, 'Overview'); }
  /** Back to the craft (the world), or to the pose that focus or overview left — exactly (prototypes). Does nothing to any model. */
  returnToFlight(): void {
    if (this.embodied) {
      if (this.mode !== 'orbit') return;
      this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.settle(0.45); this.push();
      return;
    }
    const to = this.saved;
    if (this.mode !== 'orbit' && !to) return;
    this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.saved = null; this.s.vel = [0, 0, 0];
    if (to) this.startTween(to, () => this.setPose(to));
    this.push();
  }
  /**
   * Go to a given flight pose. In the world the craft flies itself there (any movement key stops it where it is); in
   * the prototypes the camera glides and the pose left is kept for Return, unless `keep` is false.
   */
  glideTo(p: Pose, keep = true): void {
    if (this.embodied) {
      this.release(); this.clearHeld();
      if (this.mode === 'orbit') { this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.settle(0.4); }
      if (this.reducedMotion) { this.setPose(p); this.snapCamera(); this.auto = null; }
      else {
        // it sets off from the speed it has (so a new destination given on the way is taken up without a jolt), and a longer way takes longer
        const d = Math.hypot(p.pos[0] - this.s.pos[0], p.pos[1] - this.s.pos[1], p.pos[2] - this.s.pos[2]);
        if (!this.auto) this.autoVel = [this.s.vel[0], this.s.vel[1], this.s.vel[2], 0, 0];
        this.autoTime = Math.max(0.45, Math.min(1.15, 0.4 + d / 1500));
        this.auto = { pos: [p.pos[0], p.pos[1], p.pos[2]], yaw: p.yaw, pitch: p.pitch };
      }
      this.push();
      return;
    }
    this.finishTween();
    if (keep && !this.saved) this.saved = this.pose();
    if (!keep) this.saved = null;
    this.release(); this.clearHeld();
    this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.s.vel = [0, 0, 0];
    this.startTween(p, () => this.setPose(p));
    this.push();
  }
  /** Leave Inspect but stay with what was being looked at: the craft flies to where the camera is (prototypes: fly from here). */
  flyFromHere(): void {
    if (this.embodied) {
      if (this.mode !== 'orbit') return;
      const c = this.cam, f = lookDir(c.yaw, c.pitch), r = rightDir(c.yaw), u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      // where the craft must be for the follow camera to end up exactly where the camera is now
      this.glideTo({ pos: [c.pos[0] + f[0] * this.boom.dist - u[0] * this.boom.height, c.pos[1] + f[1] * this.boom.dist - u[1] * this.boom.height, c.pos[2] + f[2] * this.boom.dist - u[2] * this.boom.height], yaw: c.yaw, pitch: c.pitch });
      return;
    }
    this.finishTween(); this.mode = 'fly'; this.orbit = null; this.orbitLabel = ''; this.saved = null; this.s.vel = [0, 0, 0]; this.push();
  }

  private startTween(to: Pose, then: () => void): void {
    if (this.reducedMotion) { this.tween = null; this.setPose(to); then(); return; }
    const from = this.pose(), d = Math.hypot(to.pos[0] - from.pos[0], to.pos[1] - from.pos[1], to.pos[2] - from.pos[2]);
    this.tween = { t0: performance.now(), ms: this.scaledGlides ? Math.max(320, Math.min(1500, 300 + d * 1.05)) : TWEEN_MS, from, to, then };
  }
  /** Prototypes: any input ends a guided movement at once (at its destination, so that modes stay consistent). */
  private finishTween(): void { const t = this.tween; if (t) { this.tween = null; this.setPose(t.to); t.then(); } }
  /** The camera or the craft is still on its way somewhere by itself. */
  get transitioning(): boolean { return !!this.tween || !!this.auto || this.camSettle > 0 || this.snapSoon || (this.embodied && this.camOff > 0.6); }

  /** Once per rendered frame. `dt` in seconds. */
  update(dt: number): void {
    if (this.embodied) { this.updateEmbodied(Math.min(dt, 0.1)); return; }
    const t = this.tween;
    if (t) {
      // short moves ease out; long ones ease in as well, so that a long glide never starts with a jolt
      const k = Math.min(1, (performance.now() - t.t0) / t.ms), e = t.ms > 520 ? k * k * k * (k * (6 * k - 15) + 10) : 1 - Math.pow(1 - k, 3);
      for (let a = 0; a < 3; a++) this.s.pos[a] = t.from.pos[a] + (t.to.pos[a] - t.from.pos[a]) * e;
      this.s.yaw = t.from.yaw + angle(t.to.yaw - t.from.yaw) * e; this.s.pitch = t.from.pitch + (t.to.pitch - t.from.pitch) * e;
      if (k >= 1) this.finishTween();
    } else if (this.mode === 'orbit' && this.orbit) {
      this.setPose(orbitPose(this.orbit));
    } else {
      stepFlight(this.s, this.flightInput(), Math.min(dt, 0.1));
      this.clamp();
    }
    const near = nearSurface(this.s.pos, this.pickables.flatMap((p) => (p.kind !== 'link' ? [{ centre: p.centre, radius: p.radius }] : [])), CUTAWAY_UM);
    if (near !== this.cutaway) { this.cutaway = near; this.push(); }
  }
  private clamp(): void {
    for (let a = 0; a < 3; a++) {
      if (this.s.pos[a] < this.bounds.min[a]) { this.s.pos[a] = this.bounds.min[a]; this.s.vel[a] = 0; }
      else if (this.s.pos[a] > this.bounds.max[a]) { this.s.pos[a] = this.bounds.max[a]; this.s.vel[a] = 0; }
    }
  }
  private updateEmbodied(dt: number): void {
    const s = this.s;
    // 1 · the player: flown by the keys, or flying itself to where it was sent
    if (this.auto) {
      const to = this.auto, v = this.autoVel, T = this.autoTime;
      for (let a = 0; a < 3; a++) [s.pos[a], v[a]] = smoothDamp(s.pos[a], to.pos[a], v[a], T, dt);
      [s.yaw, v[3]] = smoothDamp(s.yaw, s.yaw + angle(to.yaw - s.yaw), v[3], T * 0.8, dt);
      [s.pitch, v[4]] = smoothDamp(s.pitch, to.pitch, v[4], T * 0.8, dt);
      // what the craft's attitude leans into, and what it keeps if the player takes over now
      s.vel = [v[0], v[1], v[2]];
      const dist = Math.hypot(to.pos[0] - s.pos[0], to.pos[1] - s.pos[1], to.pos[2] - s.pos[2]);
      if (dist < 0.3 && Math.abs(angle(to.yaw - s.yaw)) < 0.01 && Math.abs(to.pitch - s.pitch) < 0.01) { this.setPose(to); this.auto = null; this.push(); }
    } else {
      stepFlight(s, this.flightInput(), dt);
    }
    this.clamp();
    // 2 · the craft's attitude: towards the aim, a little into its own movement
    const sp = SPEEDS_UM_S[s.speedLevel] || 1, f = lookDir(s.yaw, 0), r = rightDir(s.yaw);
    const fwd = (s.vel[0] * f[0] + s.vel[2] * f[2]) / sp, side = (s.vel[0] * r[0] + s.vel[2] * r[2]) / sp;
    this.body.yaw = easeAngle(this.body.yaw, s.yaw - 0.12 * Math.max(-1, Math.min(1, side)), dt, 0.11);
    this.body.pitch = ease(this.body.pitch, s.pitch * 0.9 - 0.09 * Math.max(-1, Math.min(1, fwd)), dt, 0.13);
    this.body.roll = ease(this.body.roll, -0.2 * Math.max(-1, Math.min(1, side)), dt, 0.15);
    // 3 · the camera: eases from where it is towards where it should be; never inside a cell body
    if (this.bodies !== this.spheresOf) { this.spheresOf = this.bodies; this.spheres = (this.bodies ?? []).flatMap((b) => ((b.kind === 'cell' || b.kind === 'context') && b.centre && b.radius ? [{ centre: b.centre, radius: b.radius }] : [])); }
    this.pull = ease(this.pull, this.mode === 'fly' && this.viewKind === 'third' ? boomPull(s.pos, s.yaw, s.pitch, this.boom, this.spheres, 4) : 0, dt, 0.09);
    const want = this.camWant();
    if (this.snapSoon) { this.snapSoon = false; this.cam = { pos: [want.pos[0], want.pos[1], want.pos[2]], yaw: want.yaw, pitch: want.pitch }; this.camSettle = 0; this.camVel = [0, 0, 0, 0, 0]; }
    const slow = this.camSettle > 0, v = this.camVel;
    if (slow) {
      // on its way somewhere else (a change of view, to or from Inspect): a gentle start, a soft arrival, no overshoot
      for (let a = 0; a < 3; a++) [this.cam.pos[a], v[a]] = smoothDamp(this.cam.pos[a], want.pos[a], v[a], 0.3, dt);
      [this.cam.yaw, v[3]] = smoothDamp(this.cam.yaw, this.cam.yaw + angle(want.yaw - this.cam.yaw), v[3], 0.3, dt);
      [this.cam.pitch, v[4]] = smoothDamp(this.cam.pitch, want.pitch, v[4], 0.3, dt);
    } else {
      // following: tight, and its speed is remembered so that the next move away starts from it
      for (let a = 0; a < 3; a++) { const was = this.cam.pos[a]; this.cam.pos[a] = ease(was, want.pos[a], dt, 0.055); v[a] = dt > 0 ? (this.cam.pos[a] - was) / dt : 0; }
      this.cam.yaw = want.yaw; this.cam.pitch = want.pitch; v[3] = 0; v[4] = 0;
    }
    if (slow) {
      this.camSettle = Math.max(0, this.camSettle - dt);
      // not there yet: keep easing a little longer rather than stepping to the tight follow
      const off = Math.hypot(this.cam.pos[0] - want.pos[0], this.cam.pos[1] - want.pos[1], this.cam.pos[2] - want.pos[2]);
      if (this.camSettle <= 0 && (off > 1.5 || Math.abs(angle(want.yaw - this.cam.yaw)) > 0.012 || Math.abs(want.pitch - this.cam.pitch) > 0.012)) this.camSettle = 0.12;
    }
    this.camOff = Math.hypot(this.cam.pos[0] - want.pos[0], this.cam.pos[1] - want.pos[1], this.cam.pos[2] - want.pos[2]);
    const near = nearSurface(this.cam.pos, this.spheres, CUTAWAY_UM);
    if (near !== this.cutaway) { this.cutaway = near; this.push(); }
    if (this.manip && this.captured) { const ray = this.rayAt(0, 0); this.onManip?.move(ray.o, ray.d); }
  }
}

export const controller = new FlightController();
export const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])) as Record<Action, string>;
