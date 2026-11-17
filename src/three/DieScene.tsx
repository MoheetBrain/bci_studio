// Level 3: silicon die with the v0.4 integrated top (rtl/hbci02_digital_top.v): the v0.3 readout core
// (rtl/hbci_readout_core.v, with the legacy event core u_event, the RAW lane, the FEATURE path and the record
// multiplexer: every relationship of the v0.3 map preserved), the on-chip AI decoder (rtl/hbci_ai_decoder.v:
// quantiser, frame collector, model store, MLP engine, prediction FIFO), the register file and the BIST block.
// Block identity: RTL. Relative size: generic synthesis cell counts (or labelled estimates).
// Placement: CONCEPT. The active processing mode (useScene.procMode) lights the record-generating
// paths and dims the rest; the decoder path is lit in every mode (the FEATURE tap is not gated by cfg_mode);
// lab activity (activeBlocks) sends pulses along the routes it crosses.
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import { Color, Object3D, Vector3, type InstancedMesh, type Mesh, type MeshStandardMaterial } from 'three';
import { Part, clickBlocked } from './Part';
import { LevelContext } from './levelContext';
import { M } from './materials';
import { dashedRectOutline, makeRoute, rectOutline, routePoint, stripGeometry, type Route } from './geometry';
import { damp, motionRate, runtime, useView } from './viewStore';
import { themeColors, useTheme3D } from './theme';
import { labelShown } from './labels';
import {
  CORE_HALF,
  DIE_H,
  DIE_W,
  DIE_TOP,
  BLOCK_TINT_LIGHT,
  EVENT_IDS,
  PAD_X,
  PAD_Z,
  RO_CX,
  TILE_BASE,
  TILE_H,
  TILE_TOP,
  TOP_HALF_X,
  TOP_HALF_Z,
  TRACE_Y,
  V04_IDS,
  useDieLayout,
  type BlockRect,
  type DieEdge,
  type DieLayout,
  type EdgeOwner,
  type PadGroup,
  type PadSide,
} from './dieLayout';
import { PATH_COLOR, PROC_MODES, pathActive, type DiePath } from './modes';
import { useScene } from '../state/sceneStore';
import { MODES } from '../model/system';
import type { ProcMode } from '../model/types';
import { useArtifacts } from '../artifacts/load';
import { buildGraph, buildGraphAi, buildGraphV03, buildGraphV04 } from '../circuit/rtlGraph';
import { dieLook, plateHeader, tileTexture } from '../micro/dieLook';
import { BLOCK_NAMES, INST_TO_ID } from '../micro/names';
import { useMicro, type NetScope } from '../micro/microStore';
import { ROUTE_NETS, netIndex } from '../micro/signals';

type V3 = [number, number, number];
const noRaycast = () => null;
const CORE_LIFT: V3 = [0, 0.45, 0];
const DIM = 0.36;
/** Lab-activity highlight colour: the pulsed channel's colour, else the accent. */
const activeColor = (ch: number | null) => (ch !== null ? themeColors.ch[ch % 8] : themeColors.accent);
const PATH_C = {
  get event() { return themeColors.mode.EVENT; },
  get raw() { return themeColors.mode.RAW; },
  get feature() { return themeColors.mode.FEATURE; },
  get ai() { return themeColors.ai; },
  all: themeColors.fg,
} as Record<DiePath, Color>;
const pathColor = (p: DiePath, m: ProcMode): Color => (p === 'all' ? themeColors.mode[m] : PATH_C[p]);

// ───────────────────────────────────────────── mode → dimming of blocks ──
const BLOCK_PATH: Record<string, DiePath> = {
  'rtl.core': 'event',
  ...Object.fromEntries(EVENT_IDS.map((id) => [id, 'event' as DiePath])),
  'rtl.raw_path': 'raw',
  'rtl.u_fstate': 'feature',
  'rtl.u_biquad': 'feature',
  'rtl.u_energy': 'feature',
  'rtl.ai': 'ai',
  'rtl.ai_quant': 'ai',
  'rtl.ai_collect': 'ai',
  'rtl.ai_model': 'ai',
  'rtl.ai_engine': 'ai',
  'rtl.ai_fifo': 'ai',
};

/** Component ids at the ends of the selected signal (route, net or netlist bundle); null = no signal selected. */
export function signalEnds(): Set<string> | null {
  const sig = useMicro.getState().signal;
  if (!sig) return null;
  const out = new Set<string>();
  const add = (inst: string, scope: NetScope) => {
    if (inst === '' || inst === '$in' || inst === '$out') out.add(scope === 'ai' ? 'rtl.ai' : 'die.pads');
    else out.add(INST_TO_ID[inst] ?? '');
  };
  if (sig.kind === 'route') {
    const e = runtime.dieEdges.find((x) => x.id === sig.edge);
    e?.from.forEach((i) => out.add(i));
    e?.to.forEach((i) => out.add(i));
  } else if (sig.kind === 'net') {
    const n = netIndex(useArtifacts.getState().modules)[sig.scope].get(sig.net);
    n?.drivers.forEach((d) => add(d.inst, sig.scope));
    n?.sinks.forEach((d) => add(d.inst, sig.scope));
  } else {
    const [a, b] = sig.pair.split('>');
    add(a, sig.scope);
    add(b, sig.scope);
  }
  // parents of event-core and decoder blocks stay readable
  if ([...out].some((id) => EVENT_IDS.includes(id))) out.add('rtl.core');
  if ([...out].some((id) => id.startsWith('rtl.ai_'))) out.add('rtl.ai');
  out.delete('');
  return out;
}

/** Dimming: a selected signal wins (its ends stay, everything else fades); otherwise the cfg_mode paths. */
function DimSync() {
  useLayoutEffect(() => {
    const ids = [...new Set([...Object.keys(BLOCK_PATH), 'rtl.u_ts', 'rtl.u_records', 'die.pads', 'rtl.top04', ...V04_IDS])];
    const apply = () => {
      const m = useScene.getState().procMode;
      const ends = signalEnds();
      for (const id of ids) {
        if (ends) runtime.dimTarget.set(id, ends.has(id) ? 1 : 0.22);
        else runtime.dimTarget.set(id, BLOCK_PATH[id] ? (pathActive(BLOCK_PATH[id], m) ? 1 : DIM) : 1);
      }
    };
    apply();
    const u1 = useScene.subscribe((s, p) => s.procMode !== p.procMode && apply());
    const u2 = useMicro.subscribe((s, p) => s.signal !== p.signal && apply());
    const u3 = useArtifacts.subscribe((s, p) => s.modules !== p.modules && apply());
    return () => {
      u1(); u2(); u3();
      for (const id of ids) runtime.dimTarget.delete(id);
    };
  }, []);
  return null;
}

// ───────────────────────────────────── lab activity (stage → stage transitions) ──
const activity = { ref: null as string[] | null, prev: new Set<string>(), cur: new Set<string>() };
function syncActivity(blocks: string[]) {
  if (activity.ref === blocks) return;
  activity.ref = blocks;
  activity.prev = activity.cur;
  activity.cur = new Set(blocks);
}
const anyIn = (ids: string[], set: Set<string>) => ids.some((i) => set.has(i));
/** An edge carries lab data if its destination is active now and its source is active now or was a stage ago. */
function edgeLit(e: DieEdge): boolean {
  const { cur, prev } = activity;
  return cur.size > 0 && anyIn(e.to, cur) && (anyIn(e.from, cur) || anyIn(e.from, prev));
}

// ─────────────────────────────────────────────────────────── substrate ──
function DieSubstrate() {
  const t = useTheme3D();
  const L = dieLook(t.dark);
  const seal = useMemo(() => {
    const hx = DIE_W / 2 - 0.1, hz = DIE_H / 2 - 0.1;
    return stripGeometry([[[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]]], 0.05, 0.01, DIE_TOP + 0.005);
  }, []);
  // Plain material: no painted grid or cell texture, because the v0.4 die has no published layout to show.
  return (
    <Part>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[DIE_W, 0.2, DIE_H]} />
        <meshPhysicalMaterial color={L.substrate} metalness={t.dark ? 0.5 : 0.2} roughness={t.dark ? 0.32 : 0.5} clearcoat={0.35} clearcoatRoughness={0.3} />
      </mesh>
      <mesh geometry={seal}>
        <meshStandardMaterial {...M.copper} />
      </mesh>
    </Part>
  );
}

// ──────────────────────────────────────────────────────────────── pads ──
const PAD_GROUP_LINES: Record<PadGroup, { title: string; lines: string[] }> = {
  in: { title: 'sample input (ADC style; 24-bit SPI frames on the chip top)', lines: ['in_valid →', 'in_channel[2:0] →', 'in_sample[15:0] →', '(no back-pressure)'] },
  rec: { title: 'record output', lines: ['rec_valid →', 'rec_type[1:0] →', 'rec_channel →', 'rec_flags →', 'rec_seq →', 'rec_ts →', 'rec_data →', '← rec_ready'] },
  reg: { title: 'register bus (SPI on the chip top)', lines: ['reg_addr[7:0] →', 'reg_wdata[31:0] →', 'reg_we → · reg_re →', '← reg_rdata[31:0]'] },
  pred: { title: 'prediction pins (pred_direct_en)', lines: ['pred_strobe →', 'pred_class_out[1:0] →', 'pred_irq →', '(FIFO head also over the bus)'] },
  clk: { title: 'clock and reset', lines: ['clk →', 'rst_n → (async, active low)'] },
};

function PadGroupLabels({ layout }: { layout: DieLayout }) {
  const level = useContext(LevelContext);
  const show = useScene((s) => s.selectedId === 'die.pads' && labelShown(s, 'die.pads', level, null));
  const pad = useMicro((m) => m.pad);
  const transitioning = useView((s) => s.transitioning);
  if (!show || transitioning) return null;
  const rec = layout.byId['rtl.u_records'], regs = layout.byId['rtl.regs'], fifo = layout.byId['rtl.ai_fifo'];
  const groups: { group: PadGroup; pos: V3; cls: string }[] = [
    { group: 'in', pos: [-PAD_X - 0.2, 0.2, layout.rawZ], cls: 'left' },
    { group: 'rec', pos: [rec.cx, 0.2, -PAD_Z - 0.05], cls: 'top' },
    { group: 'reg', pos: [regs.cx, 0.2, -PAD_Z - 0.05], cls: 'top' },
    { group: 'pred', pos: [PAD_X + 0.2, 0.2, fifo.cz], cls: 'right' },
    { group: 'clk', pos: [0, 0.2, PAD_Z + 0.05], cls: 'bottom' },
  ];
  const only = pad !== null ? layout.pads[pad]?.group ?? null : null;
  return (
    <>
      {groups.filter((g) => !only || g.group === only).map((g) => (
        <Html key={g.group} position={g.pos} zIndexRange={[19, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`padlbl ${g.cls}`}>
            <div className="padlbl-k">{PAD_GROUP_LINES[g.group].title} · grouped here (illustrative)</div>
            {PAD_GROUP_LINES[g.group].lines.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        </Html>
      ))}
    </>
  );
}

function DiePads({ layout }: { layout: DieLayout }) {
  const t = useTheme3D();
  const L = dieLook(t.dark);
  const pad = useMicro((m) => m.pad);
  const items = layout.pads;
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current!;
    const o = new Object3D();
    const c = new Color();
    items.forEach((it, i) => {
      o.position.set(it.x, DIE_TOP + 0.012, it.z);
      o.scale.setScalar(pad === i ? 1.25 : 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(pad === i ? themeColors.accent.getStyle() : L.pad));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, pad, L.pad]);
  return (
    <Part id="die.pads" anchor={[-PAD_X, 0.15, PAD_Z]} label="right" lead={26}>
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, items.length]}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta > 5 || clickBlocked() || e.instanceId === undefined) return;
          useScene.getState().select('die.pads');
          useMicro.getState().setPad(e.instanceId);
        }}
      >
        <boxGeometry args={[0.3, 0.024, 0.3]} />
        <meshStandardMaterial color="#ffffff" metalness={0.25} roughness={0.45} />
      </instancedMesh>
      <PadGroupLabels layout={layout} />
    </Part>
  );
}
export type { PadSide };

// ─────────────────────────────────────────────────────────────── blocks ──
/** Lit frame shown while the block's path generates records in the current mode (a steady tint, not a bloom). */
function ModeFrame({ x0, x1, z0, z1, path, y = TILE_TOP + 0.006, dashed = false }: { x0: number; x1: number; z0: number; z1: number; path: DiePath; y?: number; dashed?: boolean }) {
  const geo = useMemo(
    () => (dashed ? dashedRectOutline(x0, x1, z0, z1, 0.12, 0.07, 0.028, 0.008, y) : rectOutline(x0, x1, z0, z1, 0.028, 0.008, y)),
    [x0, x1, z0, z1, y, dashed],
  );
  const ref = useRef<Mesh>(null!);
  const glow = useRef(0);
  useFrame((_, rawDt) => {
    if (!runtime.levelActive.die) return;
    const dt = Math.min(rawDt, 0.05);
    const m = useScene.getState().procMode;
    const on = pathActive(path, m);
    const target = on ? (runtime.motion ? 0.85 + 0.12 * Math.sin(runtime.clock * 2.2) : 0.9) : 0;
    glow.current += (target - glow.current) * damp(dt, motionRate(8));
    const mat = ref.current.material as MeshStandardMaterial;
    mat.emissive.copy(pathColor(path, m));
    mat.emissiveIntensity = glow.current;
    mat.color.copy(on ? pathColor(path, m) : themeColors.fg).multiplyScalar(on ? 0.5 : 0.35);
  });
  return (
    <mesh ref={ref} geometry={geo} raycast={noRaycast}>
      <meshStandardMaterial color="#3a4048" metalness={0.4} roughness={0.5} emissive="#ffffff" emissiveIntensity={0} />
    </mesh>
  );
}

/** Two-level tile names: Learn = short plain name over the instance; Expert = instance over the module. */
function tileNames(id: string, fallback: { name: string; sub: string }, expert: boolean) {
  const n = BLOCK_NAMES[id];
  if (!n) return { primary: fallback.name, secondary: fallback.sub, mono: 'primary' as const };
  return expert
    ? { primary: n.inst, secondary: n.module && n.module !== n.inst ? n.module : n.short, mono: 'primary' as const }
    : { primary: n.short, secondary: n.inst, mono: 'secondary' as const };
}

function Block({ b, frame = false, children }: { b: BlockRect; frame?: boolean; children?: React.ReactNode }) {
  const t = useTheme3D();
  const expert = useScene((s) => s.uiMode === 'inspect');
  const L = dieLook(t.dark);
  const tint = t.dark ? b.tint : BLOCK_TINT_LIGHT[b.id] ?? b.tint;
  const lanes = b.lanes;
  const header = lanes ? Math.min(0.42, b.h * 0.3) : 0;
  const lanesZ0 = b.z0 + header;
  const lanesZ1 = b.z1 - 0.08;
  const tex = useMemo(() => {
    const nm = tileNames(b.id, { name: b.name, sub: b.sub }, expert);
    return tileTexture({
      ...nm,
      cellsLabel: b.cellsLabel,
      tint,
      w: b.w,
      h: b.h,
      dark: t.dark,
      labelAt: lanes ? header / 2 / b.h : 0.5,
      labelH: lanes ? header / b.h : 1,
      lanes: lanes ? { n: lanes, z0: (lanesZ0 - b.z0) / b.h, z1: (lanesZ1 - b.z0) / b.h, x: 0.06 } : undefined,
    });
  }, [b, lanes, header, lanesZ0, lanesZ1, expert, tint, t.dark]);
  useEffect(() => () => tex.dispose(), [tex]);
  const laneRefs = useRef<(Mesh | null)[]>([]);
  const laneGlow = useRef<number[]>(new Array(8).fill(0));
  useFrame((_, rawDt) => {
    if (!lanes || !runtime.levelActive.die) return;
    const dt = Math.min(rawDt, 0.05);
    const s = useScene.getState();
    const active = s.activeBlocks.includes(b.id);
    for (let i = 0; i < lanes; i++) {
      const m = laneRefs.current[i];
      if (!m) continue;
      const mat = m.material as MeshStandardMaterial;
      const hit = active && s.pulseChannel === i;
      const target = hit ? (runtime.motion ? 1.1 + 0.25 * Math.sin(runtime.clock * 6) : 1.2) : active ? 0.12 : 0;
      laneGlow.current[i] += (target - laneGlow.current[i]) * damp(dt, motionRate(12));
      mat.emissive.copy(themeColors.ch[i % 8]);
      mat.emissiveIntensity = laneGlow.current[i];
    }
  });
  const laneH = (lanesZ1 - lanesZ0) / Math.max(1, lanes);
  const laneX0 = b.x0 + b.w * 0.24;
  const laneX1 = b.x1 - 0.08;
  return (
    <Part id={b.id} anchor={[b.cx, TILE_TOP + 0.05, b.cz]} label={false}>
      <RoundedBox args={[b.w - 0.02, TILE_H, b.h - 0.02]} radius={0.014} smoothness={2} position={[b.cx, TILE_BASE + TILE_H / 2, b.cz]}>
        <meshPhysicalMaterial color={L.tileBody} metalness={t.dark ? 0.55 : 0.1} roughness={0.45} clearcoat={0.3} clearcoatRoughness={0.3} />
      </RoundedBox>
      {/* Unlit label card so text keeps its exact colours and contrast under the scene lighting. */}
      <mesh position={[b.cx, TILE_TOP + 0.001, b.cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[b.w - 0.04, b.h - 0.04]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {Array.from({ length: lanes }, (_, i) => (
        <mesh key={i} ref={(m) => (laneRefs.current[i] = m)} position={[(laneX0 + laneX1) / 2, TILE_TOP + 0.008, lanesZ0 + (i + 0.5) * laneH]}>
          <boxGeometry args={[laneX1 - laneX0, 0.012, laneH * 0.66]} />
          <meshStandardMaterial color={t.dark ? '#3d444d' : '#e6e2d9'} metalness={0.2} roughness={0.5} emissive="#176b62" emissiveIntensity={0} />
        </mesh>
      ))}
      {frame && <ModeFrame x0={b.x0 - 0.02} x1={b.x1 + 0.02} z0={b.z0 - 0.02} z1={b.z1 + 0.02} path={b.path} />}
      {children}
    </Part>
  );
}

// ─────────────────────────────────────────────────────────────── traces ──
/** Routes related to the selected signal (the route itself, or every route carrying the net / bundle). */
export function relatedRoutes(): Set<string> | null {
  const sig = useMicro.getState().signal;
  if (!sig) return null;
  if (sig.kind === 'route') return new Set([sig.edge]);
  const nets = new Set<string>();
  if (sig.kind === 'net') nets.add(sig.net);
  else {
    const idx = netIndex(useArtifacts.getState().modules)[sig.scope];
    const [a, b] = sig.pair.split('>');
    for (const n of idx.values()) {
      const from = n.drivers.map((d) => d.inst || '$in');
      const to = n.sinks.map((d) => d.inst || '$out');
      if (from.includes(a === '' ? '$in' : a) && to.includes(b === '' ? '$out' : b)) nets.add(n.net);
    }
  }
  const out = new Set<string>();
  for (const [id, r] of Object.entries(ROUTE_NETS)) if (r.scope === sig.scope && r.nets.some((n) => nets.has(n))) out.add(id);
  return out;
}

/**
 * Copper routes (one mesh per RTL connection, drawn as a conceptual route, not a fabricated wire) with four
 * overlays: the active processing mode, lab activity, the selection's signal path, and the signal inspector's
 * selection (that route stays lit, every other route fades). Each route has a wider invisible hit strip so a
 * thin line is easy to click; clicking opens the signal inspector.
 */
function Traces({ edges, modeDim }: { edges: DieEdge[]; modeDim: boolean }) {
  const lineMode = useMicro((m) => m.lineMode);
  const geos = useMemo(
    () => edges.map((e) => stripGeometry(e.lanes, e.lanes.length > 1 ? 0.03 : 0.036, 0.008, TRACE_Y + (e.writeback ? 0.004 : 0))),
    [edges],
  );
  const hits = useMemo(() => edges.map((e) => stripGeometry(e.lanes, 0.16, 0.02, TRACE_Y + 0.01)), [edges]);
  const routes = useMemo<Route[]>(() => edges.map((e) => makeRoute(e.lanes[0].map(([x, z]) => new Vector3(x, TRACE_Y + 0.03, z)))), [edges]);
  const viaGeo = useMemo(() => {
    const pts: [number, number][][] = [];
    for (const e of edges)
      for (const l of e.lanes) {
        const a = l[0], b = l[l.length - 1];
        pts.push([[a[0] - 0.035, a[1]], [a[0] + 0.035, a[1]]], [[b[0] - 0.035, b[1]], [b[0] + 0.035, b[1]]]);
      }
    return stripGeometry(pts, 0.07, 0.012, TRACE_Y + 0.002);
  }, [edges]);
  const meshRefs = useRef<(Mesh | null)[]>([]);
  const glow = useRef<number[]>([]);
  const heat = useRef<number[]>([]);
  const core = useRef<InstancedMesh>(null!);
  const MAX = 90;
  const tmp = useMemo(() => ({ o: new Object3D(), v: new Vector3(), c: new Color() }), []);

  useFrame((_, rawDt) => {
    if (!runtime.levelActive.die) return;
    const dt = Math.min(rawDt, 0.05);
    const s = useScene.getState();
    syncActivity(s.activeBlocks);
    const mode = s.procMode;
    const path = runtime.pathSet;
    const rel = relatedRoutes();
    const hov = useMicro.getState().hoverRoute;
    const onPath = (e: DieEdge) => {
      if (!s.highlightPath || path.size === 0) return false;
      const wild = (ids: string[]) => ids.some((i) => path.has(i)) || ids.includes('die.pads');
      return wild(e.from) && wild(e.to) && (e.from.some((i) => path.has(i)) || e.to.some((i) => path.has(i)));
    };
    let n = 0;
    const t = runtime.clock;
    const put = (r: Route, u: number, c: Color, scale: number) => {
      if (n >= MAX) return;
      routePoint(r, u, tmp.v);
      tmp.o.position.copy(tmp.v);
      tmp.o.scale.setScalar(scale);
      tmp.o.updateMatrix();
      core.current.setMatrixAt(n, tmp.o.matrix);
      core.current.setColorAt(n, c);
      n++;
    };
    const act = activeColor(s.pulseChannel);
    edges.forEach((e, i) => {
      const lit = edgeLit(e);
      heat.current[i] = lit ? 1 : Math.max(0, (heat.current[i] ?? 0) - dt * 1.4);
      const h = heat.current[i];
      const modeOn = pathActive(e.path, mode);
      const pth = onPath(e) && !runtime.transitionActive;
      const sel = !!rel && rel.has(e.id);
      const hovered = hov === e.id;
      const pc = pathColor(e.path, mode);
      const wobble = runtime.motion ? 1 : 0;
      const target = sel ? 1.6 : hovered ? 1.2 : h > 0.02 ? 1.4 * Math.max(0.4, h) : pth ? 0.8 + 0.2 * wobble * Math.sin(t * 3) : modeOn && !rel ? 0.5 + 0.1 * wobble * Math.sin(t * 2.2 + i) : 0;
      glow.current[i] = (glow.current[i] ?? 0) + (target - (glow.current[i] ?? 0)) * damp(dt, motionRate(10));
      const m = meshRefs.current[i];
      if (m) {
        const mat = m.material as MeshStandardMaterial;
        if (sel || hovered) mat.emissive.copy(themeColors.accent);
        else if (h > 0.02) mat.emissive.copy(act);
        else if (pth) mat.emissive.copy(themeColors.accent);
        else mat.emissive.copy(pc);
        mat.emissiveIntensity = glow.current[i];
        if (rel) mat.userData.baseOpacity = sel ? 1 : 0.14;
        else if (modeDim) mat.userData.baseOpacity = modeOn || h > 0.02 || pth ? 1 : 0.32;
        else mat.userData.baseOpacity = 1;
      }
      const r = routes[i];
      const tm = runtime.reducedMotion ? 0 : t;
      if (sel) {
        const count = Math.max(2, Math.min(4, Math.round(r.length / 0.7)));
        for (let k = 0; k < count; k++) put(r, ((tm * 0.8) / Math.max(r.length, 0.3) + k / count) % 1, themeColors.accent, 0.9);
      } else if (rel) {
        // another signal is selected: no ambient markers on this route
      } else if (h > 0.02) {
        const count = Math.max(2, Math.min(5, Math.round(r.length / 0.6)));
        for (let k = 0; k < count; k++) put(r, ((tm * 2.2) / Math.max(r.length, 0.3) + k / count) % 1, act, 1);
      } else if (pth) {
        const count = Math.max(2, Math.min(4, Math.round(r.length / 0.8)));
        for (let k = 0; k < count; k++) put(r, (tm / Math.max(r.length, 0.3) + k / count) % 1, themeColors.accent, 0.9);
      } else if (modeOn && runtime.motion) {
        put(r, ((runtime.time * 0.55) / Math.max(r.length, 0.3) + i * 0.37) % 1, pc, 0.6);
      }
    });
    core.current.count = n;
    core.current.instanceMatrix.needsUpdate = true;
    if (core.current.instanceColor) core.current.instanceColor.needsUpdate = true;
  });

  useLayoutEffect(() => {
    const c = new Color('#176b62');
    for (let i = 0; i < MAX; i++) core.current.setColorAt(i, c);
    core.current.count = 0;
  }, []);

  return (
    <group visible={lineMode === 'concept'}>
      {geos.map((g, i) => (
        <mesh key={edges[i].id} geometry={g} ref={(m) => (meshRefs.current[i] = m)} userData={{ edge: edges[i].id }} raycast={noRaycast}>
          <meshStandardMaterial {...M.copper} emissive="#9c6845" emissiveIntensity={0} />
        </mesh>
      ))}
      {hits.map((g, i) => (
        <mesh
          key={`hit-${edges[i].id}`}
          geometry={g}
          userData={{ noOutline: true }}
          onPointerOver={(e) => { e.stopPropagation(); useMicro.getState().setHoverRoute(edges[i].id); }}
          onPointerOut={() => { if (useMicro.getState().hoverRoute === edges[i].id) useMicro.getState().setHoverRoute(null); }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.delta > 5 || clickBlocked()) return;
            useMicro.getState().setSignal({ kind: 'route', edge: edges[i].id });
          }}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
      <mesh geometry={viaGeo} raycast={noRaycast}>
        <meshStandardMaterial {...M.gold} />
      </mesh>
      <instancedMesh ref={core} args={[undefined, undefined, MAX]} frustumCulled={false} raycast={noRaycast}>
        <sphereGeometry args={[0.042, 12, 8]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

const byOwner = (edges: DieEdge[], o: EdgeOwner) => edges.filter((e) => e.owner === o);

// ─────────────────────────────────────────────────────── record multiplexer ──
const FIFO_N = 16;
const TYPE_PATH: Record<string, DiePath> = { RAW: 'raw', EVENT: 'event', FEATURE: 'feature' };

/** Record mux: pending registers per type → priority arbiter → 16-deep FIFO → rec_* pads. */
function Records({ b, layout }: { b: BlockRect; layout: DieLayout }) {
  const t3 = useTheme3D();
  // Empty FIFO slots and idle pending registers: a light outline tone on paper, dark on graphite.
  const idle = t3.dark ? '#3a4048' : '#cfc8bb';
  const pendRefs = useRef<(Mesh | null)[]>([]);
  const slots = useRef<InstancedMesh>(null!);
  const queue = useRef<(DiePath | null)[]>(new Array(FIFO_N).fill(null));
  const tick = useRef(0);
  const nTick = useRef(0);
  const zs = layout.pending.map((p) => p.z);
  const arbX = b.x0 + 0.38;
  const wires = useMemo(() => {
    const pl: [number, number][][] = layout.pending.map((p) => [[p.x + 0.08, p.z], [arbX, p.z]]);
    pl.push([[arbX, layout.outZ], [layout.fifo.x0, layout.outZ]]);
    return stripGeometry(pl, 0.022, 0.006, TILE_TOP + 0.004);
  }, [layout, arbX]);
  const tmp = useMemo(() => ({ o: new Object3D(), c: new Color(), dark: new Color(idle) }), [idle]);
  const slotH = layout.fifo.h / FIFO_N;

  useLayoutEffect(() => {
    const m = slots.current;
    for (let i = 0; i < FIFO_N; i++) {
      tmp.o.position.set(layout.fifo.cx, TILE_TOP + 0.01, layout.fifo.z0 + (i + 0.5) * slotH);
      tmp.o.updateMatrix();
      m.setMatrixAt(i, tmp.o.matrix);
      m.setColorAt(i, tmp.dark);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [layout, slotH, tmp]);

  useFrame((_, rawDt) => {
    if (!runtime.levelActive.die) return;
    const dt = Math.min(rawDt, 0.05);
    const s = useScene.getState();
    syncActivity(s.activeBlocks);
    const mode = s.procMode;
    // pending registers glow when their record type is generated in this mode; flash on lab data
    layout.pending.forEach((p, i) => {
      const m = pendRefs.current[i];
      if (!m) return;
      const mat = m.material as MeshStandardMaterial;
      const labHit = activity.cur.has('rtl.u_records') && (p.path === 'raw' ? activity.cur.has('rtl.raw_path') || activity.prev.has('rtl.raw_path') : p.path === 'feature' ? activity.cur.has('rtl.u_energy') || activity.prev.has('rtl.u_energy') : activity.cur.has('rtl.u_packer') || activity.prev.has('rtl.u_packer') || activity.cur.has('rtl.core'));
      const target = labHit ? 1.6 : pathActive(p.path, mode) ? 0.7 : 0.04;
      mat.emissive.copy(labHit ? activeColor(s.pulseChannel) : PATH_C[p.path]);
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * damp(dt, motionRate(10));
    });
    // FIFO: an illustrative stream of the record types this mode emits (not the RTL trace)
    if (runtime.motion) tick.current += dt;
    if (tick.current > 0.42) {
      tick.current = 0;
      const k = nTick.current++;
      let next: DiePath | null = null;
      if (mode === 'RAW') next = 'raw';
      else if (mode === 'FEATURE') next = k % 4 === 0 ? 'feature' : null;
      else if (mode === 'EVENT') next = k % 7 === 3 ? 'event' : null;
      else next = k % 4 === 0 ? 'feature' : 'raw';
      if (activity.cur.has('rtl.u_records')) {
        // the record type is decided by the stage that fed the multiplexer (this one or the previous)
        const fed = (id: string) => activity.cur.has(id) || activity.prev.has(id);
        next = fed('rtl.u_energy') ? 'feature' : fed('rtl.raw_path') ? 'raw' : 'event';
      }
      queue.current.pop();
      queue.current.unshift(next);
      const m = slots.current;
      queue.current.forEach((q, i) => {
        if (q) tmp.c.copy(PATH_C[q]).multiplyScalar(1.2 - (i / FIFO_N) * 0.5);
        else tmp.c.copy(tmp.dark);
        m.setColorAt(i, tmp.c);
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <Block b={b} frame>
      {layout.pending.map((p, i) => (
        <mesh key={p.type} ref={(m) => (pendRefs.current[i] = m)} position={[p.x, TILE_TOP + 0.02, p.z]} raycast={noRaycast}>
          <boxGeometry args={[0.18, 0.03, 0.16]} />
          <meshStandardMaterial color={idle} metalness={t3.dark ? 0.4 : 0.1} roughness={0.45} emissive={PATH_COLOR[TYPE_PATH[p.type] as 'raw']} emissiveIntensity={0.3} />
        </mesh>
      ))}
      <mesh position={[arbX, TILE_TOP + 0.018, (Math.min(...zs) + Math.max(...zs)) / 2]} raycast={noRaycast}>
        <boxGeometry args={[0.07, 0.026, Math.max(...zs) - Math.min(...zs) + 0.22]} />
        <meshStandardMaterial color="#b9a070" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh geometry={wires} raycast={noRaycast}>
        <meshStandardMaterial {...M.copper} />
      </mesh>
      <instancedMesh ref={slots} args={[undefined, undefined, FIFO_N]} raycast={noRaycast}>
        <boxGeometry args={[layout.fifo.w, 0.014, slotH * 0.68]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </Block>
  );
}

// ──────────────────────────────────────────────────────────── RAW lane ──
function RawLane({ layout }: { layout: DieLayout }) {
  const t = useTheme3D();
  const expert = useScene((s) => s.uiMode === 'inspect');
  const L = dieLook(t.dark);
  const r = layout.raw;
  const gateW = 0.62;
  const gateH = r.z1 - layout.rawZ + 0.16;
  const gateZ = r.z1 - gateH / 2 - 0.03;
  const tint = t.dark ? PATH_COLOR.raw : BLOCK_TINT_LIGHT['rtl.raw_path'];
  const tex = useMemo(() => {
    const nm = tileNames('rtl.raw_path', { name: 'raw_gen', sub: 'accept · session · mode' }, expert);
    return tileTexture({ ...nm, cellsLabel: 'top-level logic, not a module', tint, w: gateW, h: gateH - 0.04, dark: t.dark });
  }, [expert, tint, t.dark, gateH]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <Part id="rtl.raw_path" anchor={[r.x0 + gateW + 0.25, TILE_TOP + 0.02, layout.rawZ + 0.1]} label="right" lead={16} labelText="RAW lane · samples pass through">
      <mesh position={[r.cx, DIE_TOP + 0.013, r.cz]}>
        <boxGeometry args={[r.w, 0.01, r.h]} />
        <meshStandardMaterial color={L.plate} metalness={0.15} roughness={0.6} />
      </mesh>
      <mesh position={[r.x0 + 0.05 + gateW / 2, TILE_BASE + TILE_H / 2, gateZ]}>
        <boxGeometry args={[gateW, TILE_H, gateH - 0.02]} />
        <meshPhysicalMaterial color={L.tileBody} metalness={t.dark ? 0.55 : 0.1} roughness={0.45} clearcoat={0.3} />
      </mesh>
      <mesh position={[r.x0 + 0.05 + gateW / 2, TILE_TOP + 0.001, gateZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[gateW - 0.02, gateH - 0.04]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <ModeFrame x0={r.x0} x1={r.x1} z0={r.z0} z1={r.z1} path="raw" y={DIE_TOP + 0.02} />
      <Traces edges={byOwner(layout.edges, 'raw')} modeDim={false} />
    </Part>
  );
}

// ─────────────────────────────────────────────────── legacy EVENT core ──
function EventCluster({ layout }: { layout: DieLayout }) {
  const t = useTheme3D();
  const expert = useScene((s) => s.uiMode === 'inspect');
  const L = dieLook(t.dark);
  const c = layout.cluster;
  const color = t.dark ? PATH_COLOR.event : '#7a5800';
  const headTex = useMemo(
    () => plateHeader(expert ? 'u_event · hbci_event_core — legacy EVENT core (unchanged v0.2)' : 'Legacy event-detection subsystem · u_event (unchanged since v0.2)', color, c.w - 0.1, 0.22),
    [c.w, expert, color],
  );
  useEffect(() => () => headTex.dispose(), [headTex]);
  const tiles = layout.blocks.filter((b) => b.path === 'event');
  return (
    <Part id="rtl.core" anchor={[c.x1 - 0.25, TILE_TOP, c.z0 + 0.12]} label="right" lead={36} labelText="u_event · legacy event detector">
      <mesh position={[c.cx, DIE_TOP + 0.013, c.cz]}>
        <boxGeometry args={[c.w, 0.01, c.h]} />
        <meshStandardMaterial color={L.plate} metalness={0.15} roughness={0.6} />
      </mesh>
      <mesh position={[c.x0 + 0.05 + (c.w - 0.1) / 2, DIE_TOP + 0.02, c.z0 + 0.15]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[c.w - 0.1, 0.22]} />
        <meshBasicMaterial map={headTex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <ModeFrame x0={c.x0} x1={c.x1} z0={c.z0} z1={c.z1} path="event" y={DIE_TOP + 0.02} dashed />
      {tiles.map((b) => (
        <Block key={b.id} b={b} />
      ))}
      <Traces edges={byOwner(layout.edges, 'core')} modeDim={false} />
    </Part>
  );
}

// ───────────────────────────────────────────────── netlist "airlines" ──
/**
 * Straight lines between the blocks that the Yosys netlist actually connects (rtl_modules.json): one line per
 * pair of instances, whatever the number of nets in it. Shown instead of the conceptual routes when the line
 * mode is "netlist". Clock and reset reach every register and are left out to keep the picture readable.
 */
function NetlistAirlines({ layout }: { layout: DieLayout }) {
  const lineMode = useMicro((m) => m.lineMode);
  const modules = useArtifacts((a) => a.modules);
  const sig = useMicro((m) => m.signal);
  const hov = useMicro((m) => m.hoverRoute);
  const t = useTheme3D();
  const lines = useMemo(() => {
    if (!modules) return [];
    const clean = (nets: { net: string }[]) => nets.filter((n) => n.net !== 'clk' && n.net !== 'rst_n');
    const rec = layout.byId['rtl.u_records'];
    const pos = (inst: string, scope: NetScope): [number, number] | null => {
      if (scope === 'v03') {
        if (inst === '' || inst === '$in') return [-PAD_X + 0.25, layout.rawZ];
        if (inst === '$out') return [rec.cx, -PAD_Z + 0.25];
        if (inst === '$raw') return [layout.raw.x0 + 0.36, layout.rawZ - 0.05];
        if (inst === 'u_event') return [layout.cluster.x1 - 0.2, layout.cluster.cz];
      } else if (scope === 'event') {
        if (inst === '' || inst === '$in') return [layout.cluster.x0 + 0.05, layout.cluster.cz];
        if (inst === '$out') return [layout.cluster.x1 - 0.05, layout.cluster.cz];
      } else if (scope === 'v04') {
        if (inst === '' || inst === '$in') return [-PAD_X + 0.25, layout.rawZ + 0.3];
        if (inst === '$out') return [layout.byId['rtl.ai_fifo'].x1 + 0.2, layout.byId['rtl.ai_fifo'].cz];
        if (inst === 'u_readout') return [layout.core.cx, layout.core.cz + 0.2];
        if (inst === 'u_ai') return [layout.ai.cx, layout.ai.cz];
      } else {
        if (inst === '' || inst === '$in') return [layout.ai.x0 - 0.05, layout.ai.cz + 0.6];
        if (inst === '$out') return [layout.ai.x1 + 0.05, layout.ai.cz];
      }
      const b = layout.byId[INST_TO_ID[inst] ?? ''];
      return b ? [b.cx, b.cz] : null;
    };
    const out: { id: string; scope: NetScope; a: [number, number]; b: [number, number]; n: number; bits: number }[] = [];
    const add = (scope: NetScope, edges: ReturnType<typeof buildGraphV03>['edges']) => {
      for (const e of edges) {
        const nets = clean(e.nets);
        if (!nets.length) continue;
        const a = pos(e.from, scope), b = pos(e.to, scope);
        if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
        out.push({ id: `${e.from}>${e.to === '$out' ? '' : e.to}`, scope, a, b, n: nets.length, bits: e.nets.reduce((k, x) => k + x.width, 0) });
      }
    };
    add('v03', buildGraphV03(modules).edges);
    add('event', buildGraph(modules).edges);
    add('v04', buildGraphV04(modules).edges);
    add('ai', buildGraphAi(modules).edges);
    return out;
  }, [modules, layout]);
  const geos = useMemo(() => lines.map((l) => stripGeometry([[l.a, l.b]], 0.026, 0.008, TRACE_Y + 0.03)), [lines]);
  const hits = useMemo(() => lines.map((l) => stripGeometry([[l.a, l.b]], 0.14, 0.02, TRACE_Y + 0.035)), [lines]);
  if (lineMode !== 'netlist') return null;
  const selPair = sig?.kind === 'pair' ? `${sig.scope}:${sig.pair}` : null;
  return (
    <group>
      {lines.map((l, i) => {
        const key = `${l.scope}:${l.id}`;
        const on = selPair === key || hov === key;
        const dim = !!selPair && !on;
        return (
          <group key={key}>
            <mesh geometry={geos[i]} raycast={noRaycast}>
              <meshBasicMaterial color={on ? t.accent : l.scope === 'event' ? (t.dark ? '#d9b45a' : '#7a5800') : l.scope === 'ai' ? t.ai : l.scope === 'v04' ? (t.dark ? '#c9ced6' : '#4d5760') : t.dark ? '#5fd3c4' : '#176b62'} transparent opacity={dim ? 0.18 : 0.95} toneMapped={false} />
            </mesh>
            <mesh
              geometry={hits[i]}
              userData={{ noOutline: true }}
              onPointerOver={(e) => { e.stopPropagation(); useMicro.getState().setHoverRoute(key); }}
              onPointerOut={() => { if (useMicro.getState().hoverRoute === key) useMicro.getState().setHoverRoute(null); }}
              onClick={(e) => {
                e.stopPropagation();
                if (e.delta > 5 || clickBlocked()) return;
                useMicro.getState().setSignal({ kind: 'pair', pair: l.id, scope: l.scope });
              }}
            >
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ───────────────────────────────────────────────────────── mode badge ──
function ModeBadge() {
  const level = useContext(LevelContext);
  const show = useScene((s) => s.level === level);
  const mode = useScene((s) => s.procMode);
  const transitioning = useView((s) => s.transitioning);
  if (!show || transitioning) return null;
  const info = MODES[mode];
  return (
    <Html position={[RO_CX + CORE_HALF - 0.75, DIE_TOP + 0.06, -CORE_HALF + 0.13]} center zIndexRange={[21, 0]}>
      <button
        className={`die-mode-badge mode-${mode}`}
        title={`${info.summary}\nClick to cycle EVENT → RAW → FEATURE → HYBRID`}
        onClick={() => {
          const i = PROC_MODES.indexOf(mode);
          useScene.getState().setProcMode(PROC_MODES[(i + 1) % PROC_MODES.length]);
        }}
      >
        <code>cfg_mode = {info.code}</code> <b>{mode}</b> <span>→ {info.records.join(' + ')} records</span>
      </button>
    </Html>
  );
}

// ──────────────────────────────────────────────────────── readout core ──
function Readout() {
  const layout = useDieLayout();
  const t = useTheme3D();
  const L = dieLook(t.dark);
  useLayoutEffect(() => {
    runtime.dieEdges = layout.edges;
  }, [layout]);
  const outline = useMemo(() => rectOutline(RO_CX - CORE_HALF, RO_CX + CORE_HALF, -CORE_HALF, CORE_HALF, 0.035, 0.01, DIE_TOP + 0.016), []);
  const f = layout.feature;
  const feat = layout.blocks.filter((b) => b.path === 'feature');
  const rec = layout.byId['rtl.u_records'];
  const uts = layout.byId['rtl.u_ts'];
  return (
    <>
      <DiePads layout={layout} />
      <TopPlate layout={layout} />
      <Part id="rtl.readout" offset={CORE_LIFT} delay={0.05} anchor={[RO_CX - CORE_HALF, DIE_TOP + 0.05, -CORE_HALF]} label="left" lead={44} labelText="hbci_readout_core (v0.3 DSP core)">
        <mesh position={[RO_CX, DIE_TOP + 0.007, 0]}>
          <boxGeometry args={[CORE_HALF * 2, 0.012, CORE_HALF * 2]} />
          <meshStandardMaterial color={L.core} metalness={0.1} roughness={0.6} />
        </mesh>
        <mesh geometry={outline}>
          <meshStandardMaterial {...M.copper} />
        </mesh>
        <ModeFrame x0={f.x0 - 0.05} x1={f.x1 + 0.05} z0={f.z0 - 0.05} z1={f.z1 + 0.05} path="feature" y={DIE_TOP + 0.02} dashed />
        <Traces edges={byOwner(layout.edges, 'readout')} modeDim />
        <EventCluster layout={layout} />
        <RawLane layout={layout} />
        {feat.map((b) => (
          <Block key={b.id} b={b} frame />
        ))}
        {uts && <Block b={uts} frame />}
        <Records b={rec} layout={layout} />
        <ModeBadge />
      </Part>
      <AiCluster layout={layout} />
      <RegsStrip layout={layout} />
      <NetlistAirlines layout={layout} />
    </>
  );
}

// ───────────────────────────────────────────── v0.4: top outline, AI decoder cluster, register strip ──
/** hbci02_digital_top: the thin plate and outline that enclose the DSP core, the decoder and the register file. */
function TopPlate({ layout }: { layout: DieLayout }) {
  const t = useTheme3D();
  const expert = useScene((s) => s.uiMode === 'inspect');
  const L = dieLook(t.dark);
  const outline = useMemo(() => rectOutline(-TOP_HALF_X, TOP_HALF_X, -TOP_HALF_Z, TOP_HALF_Z, 0.03, 0.008, DIE_TOP + 0.012), []);
  const color = t.dark ? '#c9ced6' : '#4d5760';
  const headTex = useMemo(
    () => plateHeader(expert ? 'hbci02_digital_top — v0.4 integrated top (DSP core · AI decoder · register file · BIST)' : 'Chip logic, v0.4 top level · hbci02_digital_top (DSP core + on-chip AI decoder + registers + self-test)', color, layout.strip.w + layout.core.w + 0.3, 0.2),
    [expert, color, layout],
  );
  useEffect(() => () => headTex.dispose(), [headTex]);
  void L;
  return (
    <Part id="rtl.top04" anchor={[0, DIE_TOP + 0.03, TOP_HALF_Z]} label="right" lead={18} labelText="hbci02_digital_top (v0.4)">
      <mesh position={[0, DIE_TOP + 0.004, 0]}>
        <boxGeometry args={[TOP_HALF_X * 2, 0.006, TOP_HALF_Z * 2]} />
        <meshStandardMaterial color={t.dark ? '#30353c' : '#e9e6df'} metalness={0.1} roughness={0.65} />
      </mesh>
      <mesh geometry={outline} raycast={noRaycast}>
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[layout.core.x0 + (layout.strip.w + layout.core.w + 0.3) / 2, DIE_TOP + 0.014, -TOP_HALF_Z + 0.09]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[layout.strip.w + layout.core.w + 0.3, 0.2]} />
        <meshBasicMaterial map={headTex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Part>
  );
}

/** Pending register (1 frame) and the 4-deep prediction FIFO drawn on the FIFO tile; slot colours are illustrative. */
function PredFifo({ b }: { b: BlockRect }) {
  const t3 = useTheme3D();
  const idle = t3.dark ? '#3a4048' : '#cfc8bb';
  const slots = useRef<InstancedMesh>(null!);
  const tmp = useMemo(() => ({ o: new Object3D(), c: new Color(), dark: new Color(idle) }), [idle]);
  const N = 4;
  const slotW = (b.w - 0.3) / N;
  useLayoutEffect(() => {
    const m = slots.current;
    for (let i = 0; i < N; i++) {
      tmp.o.position.set(b.x0 + 0.15 + (i + 0.5) * slotW, TILE_TOP + 0.01, b.z1 - 0.14);
      tmp.o.updateMatrix();
      m.setMatrixAt(i, tmp.o.matrix);
      m.setColorAt(i, tmp.dark);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [b, slotW, tmp]);
  const tick = useRef(0);
  const n = useRef(0);
  useFrame((_, rawDt) => {
    if (!runtime.levelActive.die) return;
    if (runtime.motion) tick.current += Math.min(rawDt, 0.05);
    if (tick.current > 0.7) {
      tick.current = 0;
      n.current = (n.current + 1) % 6;
      const m = slots.current;
      for (let i = 0; i < N; i++) {
        const filled = i < Math.max(0, Math.min(N, n.current - 1));
        if (filled) tmp.c.copy(themeColors.ai).multiplyScalar(1.1 - i * 0.15);
        else tmp.c.copy(tmp.dark);
        m.setColorAt(i, tmp.c);
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });
  return (
    <instancedMesh ref={slots} args={[undefined, undefined, N]} raycast={noRaycast}>
      <boxGeometry args={[slotW * 0.8, 0.014, 0.1]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}

/** hbci_ai_decoder (u_ai): plate, header, the five sub-block tiles, the decoder routes and a lit frame (always on). */
function AiCluster({ layout }: { layout: DieLayout }) {
  const t = useTheme3D();
  const expert = useScene((s) => s.uiMode === 'inspect');
  const L = dieLook(t.dark);
  const c = layout.ai;
  const color = t.ai;
  const headTex = useMemo(
    () => plateHeader(expert ? 'u_ai · hbci_ai_decoder — on-chip AI decoder (v0.4, RTL)' : 'On-chip AI decoder · u_ai (v0.4, real RTL; conceptual position)', color, c.w - 0.1, 0.22),
    [c.w, expert, color],
  );
  useEffect(() => () => headTex.dispose(), [headTex]);
  const tiles = layout.blocks.filter((b) => b.path === 'ai');
  const fifo = layout.byId['rtl.ai_fifo'];
  return (
    <Part id="rtl.ai" offset={CORE_LIFT} delay={0.08} anchor={[c.x1 - 0.2, TILE_TOP, c.z0 + 0.12]} label="right" lead={40} labelText="u_ai · on-chip AI decoder (v0.4)">
      <mesh position={[c.cx, DIE_TOP + 0.013, c.cz]}>
        <boxGeometry args={[c.w, 0.01, c.h]} />
        <meshStandardMaterial color={L.plate} metalness={0.15} roughness={0.6} />
      </mesh>
      <mesh position={[c.x0 + 0.05 + (c.w - 0.1) / 2, DIE_TOP + 0.02, c.z0 + 0.15]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[c.w - 0.1, 0.22]} />
        <meshBasicMaterial map={headTex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <ModeFrame x0={c.x0} x1={c.x1} z0={c.z0} z1={c.z1} path="ai" y={DIE_TOP + 0.02} dashed />
      {tiles.map((b) => (
        <Block key={b.id} b={b} frame={b.id === 'rtl.ai_engine'}>
          {b.id === 'rtl.ai_fifo' && <PredFifo b={fifo} />}
        </Block>
      ))}
      <Traces edges={byOwner(layout.edges, 'ai')} modeDim={false} />
    </Part>
  );
}

/** Register file (top-level logic of hbci02_digital_top) and the BIST block, with the register-bus routes. */
function RegsStrip({ layout }: { layout: DieLayout }) {
  const regs = layout.byId['rtl.regs'];
  const bist = layout.byId['rtl.u_bist'];
  return (
    <group>
      <Block b={regs} />
      <Block b={bist} />
      <Traces edges={byOwner(layout.edges, 'top')} modeDim={false} />
    </group>
  );
}

export function DieScene() {
  return (
    <group>
      <DimSync />
      <DieSubstrate />
      <Readout />
    </group>
  );
}
