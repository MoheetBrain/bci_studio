// 3D viewport for the System / Package / Die levels. One Canvas, permanently mounted by App;
// rendering stops (frameloop "never") while a 2D level is shown. Neutral studio lighting on the
// workspace colour of the current theme, a grounded contact shadow, an optional faint grid, a
// screen-space selection outline and an orientation cube.
import { useEffect, useRef } from 'react';
import { Canvas, events as createPointerEvents, useFrame, useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, GizmoHelper, GizmoViewcube, Grid, Lightformer } from '@react-three/drei';
import { ACESFilmicToneMapping, Color, type Group, type Intersection, type Object3D } from 'three';
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';
import { Toolbar3D } from '../ui/Toolbar3D';
import { SystemScene } from './SystemScene';
import { CorticalScene } from './CorticalScene';
import { PackageScene } from './PackageScene';
import { DieScene } from './DieScene';
import { CameraRig, HOME, cameraBus } from './CameraRig';
import { Drivers, FLOOR, LevelStage, PresetStage, initialLevel3D } from './Stage';
import { PathSync, SignalPathArcs } from './SignalPath';
import { SelectionOutline } from './Outline';
import { LabelLayout } from './LabelLayout';
import { InspectionGizmo } from './Inspection';
import { clickBlocked } from './Part';
import { frameStats, is3DLevel, levelGroups, presetGroups, recordFrame, registry, runtime, useView, type Level3D } from './viewStore';
import { useTheme3D } from './theme';
import { CorticalLegend, DieOccludedNote, FpsMeter, HintToast, Watermark } from '../ui/ViewportPanels';
import { SignalInspector } from '../micro/SignalInspector';
import { DieLegend, PadCard } from '../micro/DieOverlays';
import { useMicro } from '../micro/microStore';
import { ROUTE_NETS } from '../micro/signals';
import { LessonButton, LessonOverlay } from '../ui/Lesson';
import type { Preset } from '../model/types';
import '../ui/ui.css';

function pickable(o: Object3D | null): boolean {
  while (o) {
    if (!o.visible || o.userData.noPick) return false;
    o = o.parent;
  }
  return true;
}

/** Default pointer events, but invisible / faded / x-rayed objects never take a hit. */
const pointerEvents: typeof createPointerEvents = (store) => ({
  ...createPointerEvents(store),
  filter: (hits: Intersection[]) => (runtime.transitionActive ? [] : hits.filter((h) => pickable(h.object))),
});

/** Neutral studio: soft white key + fill, a white environment for brushed metals, no colour wash. */
function Lights() {
  const t = useTheme3D();
  return (
    <>
      <color attach="background" args={[t.workspace]} />
      <hemisphereLight intensity={t.dark ? 0.35 : 0.5} color="#ffffff" groundColor={t.dark ? '#1b1e21' : '#d8d6d0'} />
      <directionalLight position={[5, 9, 6]} intensity={t.dark ? 1.3 : 1.6} color="#ffffff" />
      <directionalLight position={[-6, 4, -4]} intensity={0.45} color="#ffffff" />
      <Environment key={t.dark ? 'graphite' : 'paper'} resolution={256} frames={1}>
        <color attach="background" args={[t.dark ? '#44494f' : '#d6d8d9']} />
        <Lightformer form="rect" intensity={t.dark ? 1.4 : 1.8} color="#ffffff" position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#f6f4ef" position={[8, 1, 2]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#ffffff" position={[0, 2, -9]} scale={[14, 1.5, 1]} />
        <Lightformer form="rect" intensity={0.25} color="#ffffff" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
      </Environment>
    </>
  );
}

/** Floor: grounded contact shadow and an optional faint grid; Drivers moves it with the level. */
const FLOOR_SIZE: Record<Level3D, { scale: [number, number]; far: number }> = {
  system: { scale: [20, 12], far: 8 },
  package: { scale: [9, 9], far: 6 },
  die: { scale: [10, 10], far: 5 },
};

function Floor({ floorRef, level }: { floorRef: React.RefObject<Group>; level: Level3D }) {
  const t = useTheme3D();
  const showGrid = useScene((s) => s.showGrid);
  const f = FLOOR_SIZE[level];
  return (
    <group ref={floorRef} position={[0, FLOOR[level].base, 0]}>
      <ContactShadows scale={f.scale} far={f.far} blur={2.2} opacity={t.dark ? 0.55 : 0.38} color={t.dark ? '#000000' : '#20272d'} resolution={768} frames={Infinity} />
      {showGrid && (
        <Grid
          position={[0, -0.004, 0]}
          args={[60, 60]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor={t.dark ? '#2e3338' : '#d8dcd9'}
          sectionSize={2.5}
          sectionThickness={0.9}
          sectionColor={t.dark ? '#3a4046' : '#c4c9c6'}
          fadeDistance={34}
          fadeStrength={1.5}
          infiniteGrid
          followCamera={false}
          raycast={() => null}
        />
      )}
    </group>
  );
}

/** Orientation cube: click a face, edge or corner to look from that direction (framing the level). */
function Orientation() {
  const t = useTheme3D();
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const p = e.eventObject.position;
    const dir = p.lengthSq() > 0.1 ? p.clone() : e.face ? e.face.normal.clone() : null;
    if (dir) {
      if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.z) < 1e-6) dir.z += 0.0001;
      cameraBus.dir = dir.normalize();
    }
    return null;
  };
  return (
    <GizmoHelper alignment="top-right" margin={[56, 64]} renderPriority={1}>
      <GizmoViewcube
        onClick={onClick}
        color={t.dark ? '#2a2f34' : '#ffffff'}
        hoverColor={t.accent}
        textColor={t.dark ? '#e8eaec' : '#20272d'}
        strokeColor={t.dark ? '#3a4046' : '#c9cecb'}
        opacity={0.95}
        font="600 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
      />
    </GizmoHelper>
  );
}

/** Dev-only handle for debugging from the browser console. */
function DevHandle() {
  const three = useThree();
  useEffect(() => {
    if (import.meta.env.DEV)
      (window as unknown as Record<string, unknown>).__hbci3d = { three, runtime, registry, levelGroups, presetGroups, frameStats, useScene, useView };
  }, [three]);
  return null;
}

/** Records real frame timestamps for the FPS meter. */
function FrameProbe() {
  useFrame(() => recordFrame(performance.now()), -3);
  return null;
}

function SceneContent({ level }: { level: Level3D }) {
  const floorRef = useRef<Group>(null);
  return (
    <>
      <Lights />
      <FrameProbe />
      <Drivers floorRef={floorRef} />
      <PathSync />
      <Floor floorRef={floorRef} level={level} />
      <LevelStage level="system">
        <PresetStage preset="bench">
          <SystemScene />
          <SignalPathArcs />
        </PresetStage>
        <PresetStage preset="cortical">
          <CorticalScene />
        </PresetStage>
      </LevelStage>
      <LevelStage level="package">
        <PackageScene />
        <SignalPathArcs />
      </LevelStage>
      <LevelStage level="die">
        <DieScene />
      </LevelStage>
      <CameraRig />
      <InspectionGizmo />
      <Orientation />
      <SelectionOutline />
      <LabelLayout />
      <DevHandle />
    </>
  );
}

const LEVEL_TITLE: Record<string, { title: string; hint: string }> = {
  system: { title: 'Bench prototype · READ → CHIP → DECODER → LLM → FEEDBACK', hint: 'Click a part to select it · Explore inside opens HBCI-02' },
  package: { title: 'HBCI-02 package', hint: 'Open package lifts the lid to show the silicon die · Explore inside enters the die' },
  die: { title: 'Silicon die · v0.4 hbci02_digital_top', hint: 'Switch cfg_mode to light each path · the AI decoder is fed in every mode · Explore inside opens a block’s circuit' },
};
const PRESET_TITLE: Record<Preset, { title: string; hint: string }> = {
  bench: LEVEL_TITLE.system,
  cortical: { title: 'Thin cortical-interface candidate · CONCEPT', hint: 'Separate the assembly to see the layers · the HBCI-02 chip stays reachable from the component tree' },
};

function HoverTooltip({ wrap }: { wrap: React.RefObject<HTMLDivElement> }) {
  const hovered = useScene((s) => s.hoveredId);
  const level = useScene((s) => s.level);
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (tip.current) tip.current.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 16}px)`;
    };
    el.addEventListener('pointermove', move);
    return () => el.removeEventListener('pointermove', move);
  }, [wrap]);
  const route = useMicro((m) => m.hoverRoute);
  const c = hovered && !route ? COMPONENTS[hovered] : null;
  const rn = route ? ROUTE_NETS[route] : null;
  // The "on" class is toggled imperatively by Viewport3D (only while the pointer is inside).
  return (
    <div ref={tip} className="vp-tip" data-hover-tip>
      {route && (
        <>
          <b>{rn ? 'Drawn route' : 'Netlist connection'}</b>
          <small className="mono">{rn ? rn.nets.join(', ') : route.split(':')[1]?.replace('>', ' → ') || route}</small>
          <em>click: explain this signal</em>
        </>
      )}
      {c && (
        <>
          <b>{c.name}</b>
          <span className={`ev-dot ev-${c.evidence}`} />
          <small>{c.evidence}</small>
          {c.enter && c.enter !== level && <em>double-click: explore inside</em>}
        </>
      )}
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function Viewport3D({ active }: { active: boolean }) {
  const level = useScene((s) => s.level);
  const preset = useScene((s) => s.preset);
  const lessonOn = useScene((s) => s.lessonStep !== null);
  const advanced = useScene((s) => s.advanced);
  const transitioning = useView((s) => s.transitioning);
  const wrap = useRef<HTMLDivElement>(null);
  const lvl = is3DLevel(level) ? level : initialLevel3D();

  // Every 3D view is conceptual geometry; per-component evidence is shown by the inspector.
  useEffect(() => {
    if (active && is3DLevel(level)) useScene.getState().setViewEvidence('CONCEPT');
  }, [active, level]);

  // A part of the previous level can no longer be under the pointer.
  useEffect(() => {
    const s = useScene.getState();
    if (s.hoveredId && COMPONENTS[s.hoveredId]?.level !== level) s.hover(null);
  }, [level]);

  // F fits the selection (ignored while typing in a field).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      useScene.getState().requestFit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Pointer cursor over pickable parts; tooltip visibility only while the pointer is inside.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let inside = false;
    const apply = () => {
      const h = useScene.getState().hoveredId || useMicro.getState().hoverRoute;
      el.style.cursor = inside && h ? 'pointer' : '';
      const tip = el.querySelector<HTMLElement>('[data-hover-tip]');
      if (tip) tip.classList.toggle('on', inside && !!h);
    };
    const enter = () => ((inside = true), apply());
    const leave = () => ((inside = false), apply());
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    const unsub = useScene.subscribe((s, p) => s.hoveredId !== p.hoveredId && apply());
    const unsub2 = useMicro.subscribe((s, p) => s.hoverRoute !== p.hoverRoute && apply());
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      unsub();
      unsub2();
    };
  }, []);

  // Docked cards (signal inspector, pad card) sit just below the toolbar stack, whose height varies by level.
  useEffect(() => {
    const ov = wrap.current?.querySelector<HTMLElement>('.view-overlay');
    const tb = ov?.querySelector<HTMLElement>('.tb3d');
    if (!ov || !tb) return;
    const ro = new ResizeObserver(() => ov.style.setProperty('--tb3d-b', `${tb.offsetTop + tb.offsetHeight}px`));
    ro.observe(tb);
    return () => ro.disconnect();
  }, []);

  const h = HOME[lvl];
  const title = lvl === 'system' ? PRESET_TITLE[preset] : LEVEL_TITLE[lvl];
  return (
    <div className="vp3d" ref={wrap} data-testid="viewport-3d">
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={[1, 2]}
        camera={{ fov: 35, near: 0.05, far: 300, position: h.pos.toArray() }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        events={pointerEvents}
        onCreated={(st: RootState) => {
          st.gl.toneMapping = ACESFilmicToneMapping;
          st.gl.toneMappingExposure = 1.0;
          st.scene.background = new Color('#F4F3EF');
        }}
        onPointerMissed={(e) => {
          // Html labels live inside the canvas wrapper, so their clicks bubble here as "missed";
          // only a click on the canvas itself means empty space.
          if (!(e.target instanceof HTMLCanvasElement)) return;
          if (e.button === 0 && !clickBlocked()) useScene.getState().select(null);
        }}
      >
        <SceneContent level={lvl} />
      </Canvas>
      <div className="view-overlay">
        <Toolbar3D />
        {lvl === 'system' && preset === 'cortical' && <Watermark />}
        {!lessonOn && (
          <div className="vp-title">
            <LessonButton />
            {/* On the chip levels the display-mode banner above already names the view. */}
            {lvl === 'system' && <span className="vp-level">{title.title}</span>}
            {lvl === 'system' && <span className="vp-hint">{title.hint}</span>}
          </div>
        )}
        <div className="vp-br">
          <HintToast />
          {lvl === 'package' && !transitioning && <DieOccludedNote />}
          {lvl === 'die' && !transitioning && <DieLegend />}
          {lvl === 'system' && preset === 'cortical' && !transitioning && <CorticalLegend />}
          {advanced && <FpsMeter active={active} />}
        </div>
        <div className="disclaimer vp-disclaimer">Conceptual engineering model — not a manufactured implant.</div>
        {lvl === 'die' && !transitioning && <SignalInspector />}
        {lvl === 'die' && !transitioning && <PadCard />}
        <LessonOverlay />
        <HoverTooltip wrap={wrap} />
      </div>
    </div>
  );
}
