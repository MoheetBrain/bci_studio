// The world: one journey from the whole brain into a block of illustrative cortex and back.
//
//   brain    the atlas's surface, turned and picked with the pointer            (BrainStage)
//   cortex   a flyable block with two models in it, one running at a time      (CortexStage + circuitLab / decoderTask)
// The two are different things at different scales, drawn by different canvases; the move between them is a camera
// dive, a caption that says what changes, and a cross-fade — and it runs backwards the same way. The brain stays on
// screen inside the tissue as a small map with a mark where you went in.
//
// Input ownership is explicit and shown: the observer (camera), your intent (decoder task), or an interface control.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlas } from '../../atlas/atlasStore';
import { controller, focusIsElsewhere } from '../controller';
import { lookAt, type Hit } from '../flight';
import { BLOCK, HOME, arrayView } from '../model/layout';
import { perf } from '../perf';
import { rt } from '../runtime';
import { useWorld } from '../worldStore';
import { BrainStage, ENTRY_ID, brain } from './BrainStage';
import { labFrame, replay, setPaused, stepOnce, togglePause, useLab } from './circuitLab';
import { CortexStage, SPEC, isUnit } from './CortexStage';
import { Dock, dock } from './Dock';
import { setTaskPaused, startTask, taskFrame, taskStep, useTask } from './decoderTask';
import { Hud, hud, labelOf, type HudActions } from './Hud';
import { useJourney } from './journeyStore';
import './journey.css';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ARRIVE_FROM = { pos: [HOME.pos[0] - 60, 470, HOME.pos[2] + 150] as [number, number, number] };

export default function Journey() {
  const place = useJourney((s) => s.place), station = useJourney((s) => s.station), level = useJourney((s) => s.level);
  const ctl = useWorld((s) => s.ctl), reduced = useWorld((s) => s.reducedMotion);
  const atlas = useAtlas((s) => s.status);
  const [preload, setPreload] = useState(false), [veil, setVeil] = useState<'none' | 'in' | 'hold'>('none'), [studio, setStudio] = useState(false);
  const view = useRef<HTMLDivElement | null>(null), busy = useRef(false);
  const dragLooks = useJourney((s) => s.dragLooks), lookScale = useJourney((s) => s.lookScale);

  // build the tissue once the brain is on screen, so that going in does not stall on it
  useEffect(() => { if (atlas === 'ready' || atlas === 'error') { const t = setTimeout(() => setPreload(true), 500); return () => clearTimeout(t); } }, [atlas]);

  // ── the controller belongs to this world while it is mounted ───────────────────────────────────────────────────
  useEffect(() => {
    controller.bounds = BLOCK; controller.strictOwnership = true; controller.wheelMode = 'dolly'; controller.scaledGlides = true;
    useWorld.setState({ selected: null, hovered: null, panel: null, notice: null, ready: false });
    controller.onChange = (v) => useWorld.setState({ ctl: v });
    controller.onInput = (t) => perf.input(t);
    controller.onRefused = () => useWorld.getState().say('The browser did not hand over the mouse (this window may not be in front, or capture is not available here). Dragging the scene looks around just the same.');
    return () => {
      controller.bounds = { min: [-760, -760, -760], max: [760, 760, 760] }; controller.strictOwnership = false; controller.wheelMode = 'speed'; controller.scaledGlides = false; controller.dragLooks = false; controller.lookScale = 1;
      controller.onChange = null; controller.onInput = null; controller.onRefused = null; controller.onPick = null; controller.onDouble = null; controller.setContext('explore');
      rt.frame = null; rt.onPick = null;
      // leaving the world for the studio: both models stop, and the entrance will offer the way back to this spot
      const j = useJourney.getState();
      setPaused(true); setTaskPaused(true);
      if (j.place !== 'brain') {
        const l = useLab.getState().lab, pose = controller.pose();
        j.remember({ pose });
        useJourney.setState({ place: 'brain', owner: 'observer', resume: { history: l.history.map((h) => ({ setup: h.setup, label: h.label })), baseline: l.baseline.recipe.parameters, pose, station: j.station } });
      }
    };
  }, []);
  useEffect(() => { controller.reducedMotion = reduced; }, [reduced]);
  // keys reach the rig and the models only while the tissue is what is on screen
  useEffect(() => { controller.enabled = place === 'cortex'; if (place !== 'cortex') controller.clearHeld(); return () => { controller.enabled = true; }; }, [place]);
  useEffect(() => { controller.dragLooks = dragLooks; controller.lookScale = lookScale; }, [dragLooks, lookScale]);

  // ── selection ──────────────────────────────────────────────────────────────────────────────────────────────────
  const focusOn = (kind: string, id: string) => {
    const c = kind === 'site' ? SPEC.sites?.find((s) => s.id === id) : SPEC.cells.find((x) => x.id === id);
    if (c) controller.focus(c.pos, c.radius, labelOf(kind, id));
  };
  const select = useCallback((kind: 'cell' | 'site' | 'link', id: string, focus = false) => {
    useWorld.getState().select({ kind, id });
    const j = useJourney.getState();
    if (kind === 'cell' && !isUnit(id)) { useLab.setState({ focus: id }); if (id === 'T') j.tick('notice'); }
    if (kind === 'site' && id === 'probe') j.tick('record');
    if (focus) focusOn(kind, id);
  }, []);
  useEffect(() => {
    const pick = (hit: Hit | null) => { if (hit) select(hit.kind, hit.id); else useWorld.getState().select(null); };
    controller.onPick = pick; rt.onPick = pick;
    controller.onDouble = (hit) => { if (hit && hit.kind !== 'link') select(hit.kind, hit.id, true); };
  }, [select]);

  // ── which model runs ───────────────────────────────────────────────────────────────────────────────────────────
  const releasePilot = useCallback(() => { if (controller.context === 'pilot') { controller.setContext('explore'); useWorld.getState().say('The keys fly the observer again.'); } }, []);
  const pilot = useCallback(() => {
    const j = useJourney.getState();
    if (j.station !== 'array') { useWorld.getState().say('The decoder task runs at the electrode array. Use “Go to → The electrode array” first.'); return; }
    if (controller.context === 'pilot') { releasePilot(); return; }
    if (useTask.getState().status !== 'ready' || !useTask.getState().info?.calibration) { useWorld.getState().say('The decoders are still being fitted — a moment.'); return; }
    const el = view.current, r = el?.getBoundingClientRect(), covered = r ? Math.min(0.42, 300 / Math.max(1, r.width)) : 0.2;
    const v = arrayView(controller.aspect, controller.fovY, covered);
    controller.glideTo({ pos: v.pos, ...lookAt(v.pos, v.lookAt) }, false);
    controller.setContext('pilot');
    setTaskPaused(false);
    el?.focus({ preventScroll: true });
    useWorld.getState().say('You have the controls: the movement keys are now your intended velocity. The observer stays where it is. Esc or P gives the keys back.');
  }, [releasePilot]);
  const goStation = useCallback((s: 'circuit' | 'array') => {
    const j = useJourney.getState();
    releasePilot();
    useWorld.getState().select(null);
    if (s === 'array') { const v = arrayView(controller.aspect, controller.fovY, 0.2); controller.glideTo({ pos: v.pos, ...lookAt(v.pos, v.lookAt) }, false); setPaused(true); setTaskPaused(false); }
    else { controller.glideTo({ pos: HOME.pos, ...lookAt(HOME.pos, HOME.lookAt) }, false); setTaskPaused(true); replay(); }
    if (j.station !== s) j.set({ station: s });
  }, [releasePilot]);

  // ── the frame: exactly one model advances ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let flown = 0, last: [number, number, number] | null = null;
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
      dock.draw?.(); hud.draw?.();
      // the route's "explore" step: the observer has really moved
      if (!j.beats.explore && j.place === 'cortex') {
        const p = controller.s.pos;
        if (last && controller.held.size > 0 && controller.context === 'explore' && !controller.transitioning) flown += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
        last = [p[0], p[1], p[2]];
        if (flown > 40) j.tick('explore');
      }
    };
    return () => { rt.frame = null; };
  }, []);
  // ticks that follow from the experiment's own state
  useEffect(() => useLab.subscribe((s, p) => {
    const j = useJourney.getState();
    if (s.watched > p.watched && s.watched >= 1) j.tick('notice');
    if (s.lab.history.length > 1 && s.lab !== p.lab) { j.tick('notice'); j.tick('change'); }
  }), []);
  useEffect(() => { const j = useJourney.getState(); if (level !== 'observe' && j.beats.change && useLab.getState().lab.history.length > 1) j.tick('compare'); }, [level]);
  // the first change opens the linked trace once, so that the consequence can be read against the baseline
  useEffect(() => useLab.subscribe((s, p) => { if (p.lab.history.length === 1 && s.lab.history.length === 2 && useJourney.getState().level === 'observe' && !useJourney.getState().beats.compare) { useJourney.getState().set({ level: 'understand' }); useWorld.getState().say('The trace is open: your run against the baseline, on the same axes.'); } }), []);

  // ── keys that belong to the journey rather than to flying ──────────────────────────────────────────────────────
  useEffect(() => {
    const A = controller.actions;
    A.pause = () => (useJourney.getState().station === 'circuit' ? togglePause() : setTaskPaused(!useTask.getState().paused));
    A.step = () => (useJourney.getState().station === 'circuit' ? stepOnce() : taskStep());
    A.focus = () => { const s = useWorld.getState().selected; if (s && s.kind !== 'link') focusOn(s.kind, s.id); else useWorld.getState().say('Select something first: click a cell or an electrode tip.'); };
    A.overview = () => { if (controller.orbitLabel === 'Overview') controller.returnToFlight(); else { releasePilot(); controller.overview(SPEC.overview); } };
    A.help = () => useWorld.getState().setPanel(useWorld.getState().panel === 'controls' ? null : 'controls');
    A.context = pilot;
    A.tool = () => { const l = useLab.getState(); if (useJourney.getState().station === 'circuit') l.toBaseline(); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || controller.captureKey) return;
      const w = useWorld.getState(), j = useJourney.getState();
      // a captured mouse is given back first — by the browser itself as a rule, and here in case the key reaches the page
      if (controller.captured) { controller.release(); return; }
      // a control that has the keyboard gives it back next
      if (focusIsElsewhere()) { view.current?.focus({ preventScroll: true }); (document.activeElement as HTMLElement | null)?.blur?.(); view.current?.focus({ preventScroll: true }); return; }
      if (w.panel) { w.setPanel(null); return; }
      if (j.place === 'brain') { if (j.region) useJourney.setState({ region: null }); return; }
      if (controller.context === 'pilot') { releasePilot(); return; }
      if (controller.mode === 'orbit') { controller.returnToFlight(); return; }
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
    // leaving the page: remember where the observer was
    const bye = () => { if (useJourney.getState().place === 'cortex') useJourney.getState().remember({ pose: controller.pose() }); };
    document.addEventListener('focusin', owner); document.addEventListener('focusout', ownerSoon); window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('keydown', esc); window.removeEventListener('keydown', enter); document.removeEventListener('focusin', owner); document.removeEventListener('focusout', ownerSoon); window.removeEventListener('pagehide', bye);
      for (const k of ['pause', 'step', 'focus', 'overview', 'help', 'context', 'tool'] as const) delete A[k];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilot, releasePilot]);
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
    // the tissue: arrive from above (the side of the surface) and settle at the circuit — or return to where it was left
    const saved = resume ? j.resume : null;
    if (saved?.history?.length && useLab.getState().lab.history.length === 1) useLab.getState().restore(saved.history, saved.baseline);
    const to = saved?.pose ?? { pos: HOME.pos, ...lookAt(HOME.pos, HOME.lookAt) };
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
    releasePilot(); controller.release();
    j.remember({ pose: controller.pose() });
    useJourney.setState({ resume: { history: useLab.getState().lab.history.map((h) => ({ setup: h.setup, label: h.label })), baseline: useLab.getState().lab.baseline.recipe.parameters, pose: controller.pose(), station: j.station } });
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
  const act = useRef<HudActions>({ enter: () => void enter(), leave: () => void leave(), resume: () => void enter(true), goStation, pilot, select });
  act.current = { enter: () => void enter(), leave: () => void leave(), resume: () => void enter(true), goStation, pilot, select };

  // HUD buttons pressed with the pointer do not take the keyboard away from the world (fields, sliders and lists do,
  // as controls should; a button reached with Tab keeps the focus and Space presses it, as buttons should)
  const keepKeys = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('button') || t.closest('[data-takes-focus]')) return;
    e.preventDefault();
    if (useJourney.getState().place === 'cortex') view.current?.focus({ preventScroll: true });
  };
  const inCortex = place === 'cortex', brainAs = place === 'cortex' ? 'map' : 'stage';
  return (
    <div className={`journey place-${place}${ctl.captured ? ' captured' : ''}`} data-testid="journey" data-place={place} data-station={station} data-level={level} data-mode={ctl.mode} data-context={ctl.context} data-captured={ctl.captured ? '1' : '0'} onMouseDown={keepKeys} onClick={() => studio && setStudio(false)}>
      <div className="jc-layer" aria-hidden={!inCortex}>
        <div ref={view} className="jc-view" data-world-view tabIndex={inCortex ? 0 : -1} role="application" aria-label="The tissue. W A S D and E Q fly, drag to look, click to select, Space pauses the model. The “Go to” list selects any cell or electrode contact without the pointer." data-testid="world-view">
          {preload && <CortexStage active={inCortex || place === 'entering'} />}
        </div>
        <div className="jc-vignette" aria-hidden="true" />
      </div>
      <div className={`jb-layer as-${brainAs}`} data-testid="brain-layer" data-as={brainAs}>
        <BrainStage mode={brainAs} active={place !== 'cortex'} />
        {brainAs === 'stage' && <div className="jb-lens" aria-hidden="true" />}
        {brainAs === 'map' && <button type="button" className="jb-mapbtn" onClick={() => void leave()} data-testid="map" title="Back out to the whole brain. Your experiment stays as it is."><span>You are here · back to the brain</span></button>}
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
if (typeof window !== 'undefined') (window as unknown as { __journey?: unknown }).__journey = { store: useJourney, spec: SPEC };

