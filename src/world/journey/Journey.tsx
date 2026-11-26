// The world: one journey from the whole brain into a block of illustrative cortex and back.
//
//   brain    the atlas's surface, turned and picked with the pointer            (BrainStage)
//   cortex   a block the player flies a small craft through, with two models in it, one running at a time
//                                                                               (CortexStage + circuitLab / decoderTask)
// The two are different things at different scales, drawn by different canvases; the move between them is a camera
// dive, a caption that says what changes, and a cross-fade — and it runs backwards the same way. The brain stays on
// screen inside the tissue as a small map with a mark where you went in.
//
// Who the keys belong to is explicit and shown, and only four things change it:
//   Explore         the movement keys fly the craft (the default; selecting something does NOT change this);
//   Inspect         the camera has left the craft to look at one thing; a drag orbits; the first movement key flies again;
//   Decoder Pilot   the movement keys are the intended velocity of the decoder task; the craft holds still;
//   a control       a slider, list or field that has the keyboard focus keeps the keys until Escape or a click on the scene.
// Holding a contact ready to place is not a mode of the keys: the craft still flies; the next click puts the contact down.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlas } from '../../atlas/atlasStore';
import { controller, focusIsElsewhere } from '../controller';
import { lookAt, type BodyHit } from '../flight';
import { saveLab, type ContactId } from '../model/journey';
import { BLOCK, CIRCUIT_VIEW, HOME, arrayView, modelToScene, sceneToModel, type V3 } from '../model/layout';
import { perf } from '../perf';
import { rt } from '../runtime';
import { selectionOf, useWorld, type Selection } from '../worldStore';
import { BrainStage, ENTRY_ID, brain } from './BrainStage';
import { contactAt, isContactId, labFrame, replay, setPaused, stepOnce, togglePause, useLab } from './circuitLab';
import { CortexStage, EXEMPLAR_VIEW, SPEC, armPoint, isCircuitCell, nearestCell, stage } from './CortexStage';
import { Dock, dock } from './Dock';
import { setTaskPaused, startTask, taskFrame, taskStep, useTask } from './decoderTask';
import { EXEMPLAR_ID, useExemplar } from './exemplar';
import { Hud, hud, labelOf, type HudActions } from './Hud';
import { flushSaved, savedReveal, useJourney } from './journeyStore';
import './journey.css';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ARRIVE_FROM = { pos: [HOME.pos[0] + 40, HOME.pos[1] + 330, HOME.pos[2] + 190] as V3 };
const poseAt = (v: { pos: V3; lookAt: V3 }) => ({ pos: v.pos, ...lookAt(v.pos, v.lookAt) });

export default function Journey() {
  const place = useJourney((s) => s.place), station = useJourney((s) => s.station), level = useJourney((s) => s.level);
  const ctl = useWorld((s) => s.ctl), reduced = useWorld((s) => s.reducedMotion), reveal = useWorld((s) => s.reveal);
  const atlas = useAtlas((s) => s.status), tool = useLab((s) => s.tool);
  const [preload, setPreload] = useState(false), [veil, setVeil] = useState<'none' | 'in' | 'hold'>('none'), [studio, setStudio] = useState(false);
  const view = useRef<HTMLDivElement | null>(null), busy = useRef(false);
  const dragLooks = useJourney((s) => s.dragLooks), lookScale = useJourney((s) => s.lookScale);

  // build the tissue once the brain is on screen, so that going in does not stall on it
  useEffect(() => { if (atlas === 'ready' || atlas === 'error') { const t = setTimeout(() => setPreload(true), 500); return () => clearTimeout(t); } }, [atlas]);

  // ── the controller belongs to this world while it is mounted ───────────────────────────────────────────────────
  useEffect(() => {
    controller.bounds = BLOCK; controller.strictOwnership = true; controller.wheelMode = 'dolly'; controller.scaledGlides = true;
    controller.viewKind = useJourney.getState().viewKind;
    useWorld.setState({ selected: null, hovered: null, panel: null, notice: null, ready: false, reveal: savedReveal });
    controller.onChange = (v) => useWorld.setState({ ctl: v });
    controller.onInput = (t) => perf.input(t);
    controller.onRefused = () => useWorld.getState().say('The browser did not hand over the mouse (this window may not be in front, or capture is not available here). Dragging the scene looks around just the same.');
    // the experiment a previous visit left — its causes, its contacts, its baseline — is there again before anything is shown
    const left = useJourney.getState().resume?.lab, l = useLab.getState().lab;
    if (left && l.history.length === 1) useLab.getState().restore(left);
    return () => {
      controller.bounds = { min: [-760, -760, -760], max: [760, 760, 760] }; controller.strictOwnership = false; controller.wheelMode = 'speed'; controller.scaledGlides = false; controller.dragLooks = false; controller.lookScale = 1;
      controller.onChange = null; controller.onInput = null; controller.onRefused = null; controller.onPick = null; controller.onDouble = null; controller.setContext('explore'); controller.viewKind = 'third';
      rt.frame = null; rt.onPick = null; rt.tool = null;
      useWorld.setState({ reveal: 'explore' });
      // leaving the world for the studio: both models stop, and the entrance will offer the way back to this spot
      const j = useJourney.getState();
      setPaused(true); setTaskPaused(true); useLab.setState({ tool: null });
      if (j.place !== 'brain') {
        const pose = controller.pose();
        j.remember({ pose });
        useJourney.setState({ place: 'brain', owner: 'observer', resume: { lab: saveLab(useLab.getState().lab), pose, station: j.station } });
      }
      flushSaved();
    };
  }, []);
  useEffect(() => { controller.reducedMotion = reduced; }, [reduced]);
  // keys reach the rig and the models only while the tissue is what is on screen
  useEffect(() => { controller.enabled = place === 'cortex'; if (place !== 'cortex') controller.clearHeld(); return () => { controller.enabled = true; }; }, [place]);
  useEffect(() => { controller.dragLooks = dragLooks; controller.lookScale = lookScale; }, [dragLooks, lookScale]);
  useEffect(() => { useJourney.getState().remember({ reveal }); }, [reveal]);

  // ── selection ──────────────────────────────────────────────────────────────────────────────────────────────────
  const focusOn = (kind: Selection['kind'], id: string) => {
    const say = useWorld.getState().say;
    if (kind === 'link') return;
    if (kind === 'landmark') { say('The vessel is a landmark to find your way by. Fly along it — there is nothing inside it to look at.'); return; }
    if (kind === 'site' && isContactId(id)) { const m = contactAt(id); if (m) controller.focus(modelToScene(m), 6, id, 11); else say(`${id} has not been placed yet.`); return; }
    if (kind === 'context' && id === EXEMPLAR_ID) { controller.focus(EXEMPLAR_VIEW.centre, EXEMPLAR_VIEW.radius, 'the reconstructed neuron', 2.5); return; }
    if (kind === 'context') { const i = +id.slice(3), p = rt.context?.pos[i]; if (p) controller.focus(p, rt.context!.radius[i] ?? 8, 'a context neuron'); return; }
    const c = kind === 'site' ? SPEC.sites?.find((s) => s.id === id) : SPEC.cells.find((x) => x.id === id);
    if (c) controller.focus(c.pos, c.radius, labelOf(kind, id));
  };
  // Selecting changes what is selected — and nothing about who owns the keys or where the craft is.
  const select = useCallback((kind: Selection['kind'], id: string, focus = false, part?: string) => {
    useWorld.getState().select({ kind, id, ...(part ? { part } : {}) });
    const j = useJourney.getState();
    if (kind === 'cell' && isCircuitCell(id)) { useLab.setState({ focus: id }); if (id === 'T') j.tick('notice'); }
    if ((kind === 'cell' || kind === 'context') && part && part !== 'cell body') j.tick('point');
    if (focus) focusOn(kind, id);
  }, []);
  const putDown = useCallback((id: ContactId, at: V3) => {
    const l = useLab.getState(), was = l.lab.contacts[id], near = nearestCell(at);
    l.place(id, sceneToModel(at)); l.setTool(null);
    useWorld.getState().select({ kind: 'site', id });
    useWorld.getState().say(`${id} ${was ? 'moved' : 'placed'} ${near.distUm.toFixed(0)} µm from ${near.id}. It stays there when you fly away. The circuit’s spikes did not change — only what ${id} records of them.`);
  }, []);
  useEffect(() => {
    const pick = (hit: BodyHit | null) => {
      const held = useLab.getState().tool;
      // a contact held ready: this click puts it down where the preview shows it
      if (held) { if (stage.preview) putDown(held, stage.preview); return; }
      const s = selectionOf(hit);
      if (s) select(s.kind, s.id, false, s.part); else useWorld.getState().select(null);
    };
    controller.onPick = pick; rt.onPick = pick;
    controller.onDouble = (hit) => { const s = selectionOf(hit); if (s && s.kind !== 'link' && !useLab.getState().tool) select(s.kind, s.id, true, s.part); };
  }, [select, putDown]);

  // ── which model runs ───────────────────────────────────────────────────────────────────────────────────────────
  const releasePilot = useCallback(() => { if (controller.context === 'pilot') { controller.setContext('explore'); useWorld.getState().say('Explore: the keys fly your craft again.'); } }, []);
  const pilot = useCallback(() => {
    const j = useJourney.getState();
    if (j.station !== 'array') { useWorld.getState().say('The decoder task runs at the electrode array. Use “Go to → The electrode array” first.'); return; }
    if (controller.context === 'pilot') { releasePilot(); return; }
    if (useTask.getState().status !== 'ready' || !useTask.getState().info?.calibration) { useWorld.getState().say('The decoders are still being fitted — a moment.'); return; }
    const el = view.current, r = el?.getBoundingClientRect(), covered = r ? Math.min(0.42, 300 / Math.max(1, r.width)) : 0.2;
    useLab.getState().setTool(null);
    controller.glideTo(poseAt(arrayView(controller.aspect, controller.fovY, covered)), false);
    controller.setContext('pilot');
    setTaskPaused(false);
    el?.focus({ preventScroll: true });
    useWorld.getState().say('Decoder Pilot: the movement keys are now your intended velocity. Your craft holds still. Esc or P gives the keys back.');
  }, [releasePilot]);
  const goStation = useCallback((s: 'circuit' | 'array') => {
    const j = useJourney.getState();
    releasePilot();
    if (s === 'array') { useLab.getState().setTool(null); controller.glideTo(poseAt(arrayView(controller.aspect, controller.fovY, 0.2)), false); setPaused(true); setTaskPaused(false); }
    else { controller.glideTo(poseAt(CIRCUIT_VIEW), false); setTaskPaused(true); replay(); }
    if (j.station !== s) j.set({ station: s });
  }, [releasePilot]);
  /** Take a contact in hand (the next click puts it down), or put it away again. */
  const takeTool = useCallback((id: ContactId | null) => {
    const l = useLab.getState(), w = useWorld.getState();
    if (id === null || l.tool === id) { l.setTool(null); return; }
    if (useJourney.getState().station !== 'circuit') { w.say('P1 and P2 record the five-cell circuit. Go to the circuit first (they never feed the decoder).'); return; }
    releasePilot();
    if (controller.mode === 'orbit') controller.returnToFlight();
    l.setTool(id);
    view.current?.focus({ preventScroll: true });
    w.say(`${id} is in hand. Aim at a place and click to put it down — it snaps to just outside whatever you aim at. Esc puts it away.`);
  }, [releasePilot]);

  // ── the frame: exactly one model advances ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let flown = 0, last: V3 | null = null, pointed = 0, sincePose = 0;
    // adaptive detail: if frames stay slow, draw less. Only ever downwards, and never anything a model depends on.
    const slow = { n: 0, over: 0, since: performance.now() };
    rt.frame = (wall) => {
      if (wall > 0 && wall < 0.25) { slow.n++; if (wall > 0.0225) slow.over++; }
      if (slow.n >= 150) {
        const w = useWorld.getState(), bad = slow.over / slow.n > 0.5 && performance.now() - slow.since > 4000;
        if (bad && w.quality !== 'low' && !document.hidden) { const next = w.quality === 'high' ? 'balanced' : 'low'; useWorld.setState({ quality: next }); w.say(`Frames were slow, so the scene is now drawn at ${next} detail (Controls → Detail). No model changed.`); slow.since = performance.now(); }
        slow.n = 0; slow.over = 0;
      }
      const j = useJourney.getState(), circuit = j.station === 'circuit';
      // the array's task does not start before the player has been told that it is a different model
      labFrame(wall, circuit); taskFrame(wall, !circuit && j.declared);
      dock.draw?.(); hud.draw?.(); hud.orient?.(); hud.aim?.();
      if (j.place !== 'cortex') return;
      // the route's "explore" step: the player has really flown the craft
      if (!j.beats.explore) {
        const p = controller.s.pos;
        if (last && controller.held.size > 0 && controller.context === 'explore' && !controller.auto) flown += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
        last = [p[0], p[1], p[2]];
        if (flown > 40) j.tick('explore');
      }
      // the route's "point" step: a branch (not a cell body) has been aimed at for a moment
      if (!j.beats.point) {
        const h = useWorld.getState().hovered;
        pointed = h && (h.kind === 'cell' || h.kind === 'context') && h.part && h.part !== 'cell body' ? pointed + wall : 0;
        if (pointed > 0.45) j.tick('point');
      }
      // where the craft is, for the next visit (navigation state: kept apart from the experiment)
      sincePose += wall;
      if (sincePose > 2.5) { sincePose = 0; j.remember({ pose: controller.pose() }); }
    };
    return () => { rt.frame = null; };
  }, []);
  // ticks that follow from the experiment's own state
  useEffect(() => useLab.subscribe((s, p) => {
    const j = useJourney.getState();
    if (s.watched > p.watched && s.watched >= 1) j.tick('notice');
    if (s.lab === p.lab) return;
    if (s.lab.setup !== p.lab.setup && s.lab.history.length > 1) { j.tick('notice'); j.tick('change'); }
    const a = p.lab.contacts, b = s.lab.contacts;
    if (b.P1 && b.P2) j.tick('place');
    for (const id of ['P1', 'P2'] as const) if (a[id] && b[id] && (a[id]![0] !== b[id]![0] || a[id]![1] !== b[id]![1] || a[id]![2] !== b[id]![2])) j.tick('move');
  }), []);
  useEffect(() => { const j = useJourney.getState(); if (level !== 'observe' && j.beats.change && useLab.getState().lab.history.length > 1) j.tick('compare'); }, [level]);
  // the first change of a cause opens the linked trace once, so that the consequence can be read against the baseline
  useEffect(() => useLab.subscribe((s, p) => { if (p.lab.history.length === 1 && s.lab.history.length === 2 && s.lab.setup !== p.lab.setup && useJourney.getState().level === 'observe' && !useJourney.getState().beats.compare) { useJourney.getState().set({ level: 'understand' }); useWorld.getState().say('The trace is open: your run against the baseline, on the same axes.'); } }), []);
  // a contact in hand belongs to flying: it is put away by anything that takes the keys or the camera elsewhere
  useEffect(() => { if (tool && (ctl.context === 'pilot' || ctl.mode === 'orbit' || station !== 'circuit' || place !== 'cortex')) useLab.getState().setTool(null); }, [tool, ctl.context, ctl.mode, station, place]);

  // ── keys that belong to the journey rather than to flying ──────────────────────────────────────────────────────
  useEffect(() => {
    const A = controller.actions;
    A.pause = () => (useJourney.getState().station === 'circuit' ? togglePause() : setTaskPaused(!useTask.getState().paused));
    A.step = () => (useJourney.getState().station === 'circuit' ? stepOnce() : taskStep());
    A.focus = () => { const s = useWorld.getState().selected; if (s && s.kind !== 'link') focusOn(s.kind, s.id); else useWorld.getState().say('Select something first: click a neuron, a contact or an electrode.'); };
    A.overview = () => { if (controller.orbitLabel === 'Overview') controller.returnToFlight(); else { releasePilot(); controller.overview(SPEC.overview); } };
    A.help = () => useWorld.getState().setPanel(useWorld.getState().panel === 'controls' ? null : 'controls');
    A.context = pilot;
    A.view = () => { const v = controller.viewKind === 'third' ? 'first' : 'third'; controller.setView(v); useJourney.getState().set({ viewKind: v }); useWorld.getState().say(v === 'first' ? 'First person: you are looking out of the craft. It is in the same place, aimed the same way.' : 'Third person: the camera follows your craft.'); };
    A.tool = () => { const l = useLab.getState(), sel = useWorld.getState().selected; takeTool(l.tool ? null : !l.lab.contacts.P1 ? 'P1' : !l.lab.contacts.P2 ? 'P2' : sel?.kind === 'site' && isContactId(sel.id) ? sel.id : 'P1'); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || controller.captureKey) return;
      const w = useWorld.getState(), j = useJourney.getState(), l = useLab.getState();
      // from the most momentary thing to the most lasting: a drag in progress, a contact in hand, the captured mouse…
      if (controller.manipulating) { controller.cancelManip(); w.say('Move cancelled: the contact is back where it was.'); return; }
      if (l.tool) { l.setTool(null); return; }
      // a captured mouse is given back — by the browser itself as a rule, and here in case the key reaches the page
      if (controller.captured) { controller.release(); return; }
      // a control that has the keyboard gives it back next
      if (focusIsElsewhere()) { view.current?.focus({ preventScroll: true }); (document.activeElement as HTMLElement | null)?.blur?.(); view.current?.focus({ preventScroll: true }); return; }
      if (w.panel) { w.setPanel(null); return; }
      if (j.place === 'brain') { if (j.region) useJourney.setState({ region: null }); return; }
      if (controller.context === 'pilot') { releasePilot(); return; }
      if (controller.mode === 'orbit') { controller.returnToFlight(); return; }
      if (w.reveal === 'isolate') { useWorld.setState({ reveal: 'explore' }); return; }
      if (w.selected) w.select(null);
    };
    // on the whole brain: Enter goes in, the arrow keys turn it, + and − move closer and away, 0 is the opening view
    const enter = (e: KeyboardEvent) => {
      if (useJourney.getState().place !== 'brain' || focusIsElsewhere(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key, step = e.shiftKey ? 0.06 : 0.22;
      if (k === 'Enter') void (useJourney.getState().resume && useJourney.getState().visited ? act.current.resume() : act.current.enter());
      else if (k === 'ArrowLeft') brain.api?.nudge(-step, 0); else if (k === 'ArrowRight') brain.api?.nudge(step, 0);
      else if (k === 'ArrowUp') brain.api?.nudge(0, step); else if (k === 'ArrowDown') brain.api?.nudge(0, -step);
      else if (k === '+' || k === '=') brain.api?.nudge(0, 0, 0.87); else if (k === '-' || k === '_') brain.api?.nudge(0, 0, 1 / 0.87);
      else if (k === '0') brain.api?.home();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', esc); window.addEventListener('keydown', enter);
    const owner = () => { const o = controller.context === 'pilot' ? 'pilot' : focusIsElsewhere() ? 'interface' : 'observer'; if (useJourney.getState().owner !== o) useJourney.setState({ owner: o }); };
    const ownerSoon = () => setTimeout(owner, 0);
    // leaving the page: remember where the craft was, and write everything that is waiting to be stored
    const bye = () => { if (useJourney.getState().place === 'cortex') useJourney.getState().remember({ pose: controller.pose() }); flushSaved(); };
    document.addEventListener('focusin', owner); document.addEventListener('focusout', ownerSoon); window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('keydown', esc); window.removeEventListener('keydown', enter); document.removeEventListener('focusin', owner); document.removeEventListener('focusout', ownerSoon); window.removeEventListener('pagehide', bye);
      for (const k of ['pause', 'step', 'focus', 'overview', 'help', 'context', 'tool', 'view'] as const) delete A[k];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilot, releasePilot, takeTool]);
  useEffect(() => { useJourney.setState({ owner: ctl.context === 'pilot' ? 'pilot' : focusIsElsewhere() ? 'interface' : 'observer' }); }, [ctl.context]);

  // ── going in and coming back out ───────────────────────────────────────────────────────────────────────────────
  const enter = useCallback(async (resume = false) => {
    const j = useJourney.getState();
    if (busy.current || j.place !== 'brain') return;
    busy.current = true;
    setStudio(false); useWorld.getState().setPanel(null);
    const entry = useAtlas.getState().structures.get(ENTRY_ID);
    j.tick('arrive'); j.tick('enter');
    j.set({ place: 'entering', region: null, hoverRegion: null, entry: entry ? { id: entry.id, name: entry.name } : j.entry });
    setPreload(true);
    void startTask();
    const still = useWorld.getState().reducedMotion;
    setVeil('in');
    await Promise.all([brain.api?.dive(still) ?? Promise.resolve(), wait(still ? 500 : 1500)]);
    setVeil('hold');
    await wait(still ? 250 : 520);
    // the tissue: the craft comes down from above (the side of the surface) and settles beside the reconstructed neuron
    // — or flies back to where it was left. Either way it is the craft that moves, and the first movement key takes it over.
    const saved = resume ? j.resume : null;
    const to = saved?.pose ?? poseAt(HOME);
    controller.home(ARRIVE_FROM.pos, HOME.lookAt);
    useJourney.getState().set({ place: 'cortex', visited: true, station: 'circuit' });
    setTaskPaused(true); replay();
    controller.glideTo(to, false);
    setVeil('none');
    requestAnimationFrame(() => view.current?.focus({ preventScroll: true }));
    busy.current = false;
  }, []);
  const leave = useCallback(async () => {
    const j = useJourney.getState();
    if (busy.current || j.place !== 'cortex') return;
    busy.current = true;
    releasePilot(); controller.release(); controller.cancelManip(); useLab.getState().setTool(null);
    j.remember({ pose: controller.pose() });
    useJourney.setState({ resume: { lab: saveLab(useLab.getState().lab), pose: controller.pose(), station: j.station } });
    const still = useWorld.getState().reducedMotion;
    setVeil('hold');
    await wait(still ? 200 : 420);
    setPaused(true); setTaskPaused(true);
    j.tick('return');
    useJourney.getState().set({ place: 'leaving' });
    // let the brain become the full stage again before its camera is asked to move
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    setVeil('none');
    await (brain.api?.rise(still) ?? Promise.resolve());
    useJourney.getState().set({ place: 'brain' });
    busy.current = false;
  }, [releasePilot]);
  const placeAtArm = useCallback((id: ContactId) => {
    if (useJourney.getState().station !== 'circuit') { useWorld.getState().say('P1 and P2 record the five-cell circuit. Go to the circuit first.'); return; }
    putDown(id, armPoint());
  }, [putDown]);
  const acts: HudActions = { enter: () => void enter(), leave: () => void leave(), resume: () => void enter(true), goStation, pilot, select, takeTool, placeAtArm };
  const act = useRef<HudActions>(acts);
  act.current = acts;

  // HUD buttons pressed with the pointer do not take the keyboard away from the world (fields, sliders and lists do,
  // as controls should; a button reached with Tab keeps the focus and Space presses it, as buttons should)
  const keepKeys = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('button') || t.closest('[data-takes-focus]')) return;
    e.preventDefault();
    if (useJourney.getState().place === 'cortex') view.current?.focus({ preventScroll: true });
  };
  const inCortex = place === 'cortex', brainAs = place === 'cortex' ? 'map' : 'stage';
  const mode = ctl.context === 'pilot' ? 'pilot' : ctl.mode === 'orbit' ? 'inspect' : 'explore';
  return (
    <div className={`journey place-${place}${ctl.captured ? ' captured' : ''}${tool ? ' placing' : ''}`} data-testid="journey" data-place={place} data-station={station} data-level={level} data-mode={ctl.mode} data-context={ctl.context} data-captured={ctl.captured ? '1' : '0'}
      data-input={mode} data-view={ctl.viewKind} data-travelling={ctl.travelling ? '1' : '0'} data-tool={tool ?? ''} data-reveal={reveal} onMouseDown={keepKeys} onClick={() => studio && setStudio(false)}>
      <div className="jc-layer" aria-hidden={!inCortex}>
        <div ref={view} className="jc-view" data-world-view tabIndex={inCortex ? 0 : -1} role="application" aria-label="The tissue. W A S D and E Q fly your craft, drag to look, click to select, Space pauses the model. The “Go to” list selects any cell, contact or electrode without the pointer." data-testid="world-view">
          {preload && <CortexStage active={inCortex || place === 'entering'} />}
        </div>
        <div className="jc-vignette" aria-hidden="true" />
      </div>
      <div className={`jb-layer as-${brainAs}`} data-testid="brain-layer" data-as={brainAs}>
        <BrainStage mode={brainAs} active={place !== 'cortex'} />
        {brainAs === 'stage' && <div className="jb-lens" aria-hidden="true" />}
        {brainAs === 'map' && <button type="button" className="jb-mapbtn" onClick={() => void leave()} data-testid="map" title="Back out to the whole brain. Your experiment and your contacts stay as they are."><span>You are here · back to the brain</span></button>}
      </div>
      <div className={`j-veil ${veil}`} aria-hidden={veil === 'none'} data-testid="veil" data-veil={veil}>
        <div className="j-veil-text">
          <p className="j-scale"><span>15 cm</span><i>→</i><span>1 mm</span><i>→</i><b>100 µm</b></p>
          <p>The atlas ends at the surface. What follows is an <b>illustrative</b> block of cortex with models running in it — not cells from this brain.</p>
        </div>
      </div>
      <Hud act={act.current} studio={studio} setStudio={setStudio} />
      {inCortex && <Dock onPilot={pilot} />}
    </div>
  );
}

// test and inspection hook (read-only use)
if (typeof window !== 'undefined') (window as unknown as { __journey?: unknown }).__journey = { store: useJourney, spec: SPEC, stage, exemplar: useExemplar };
