// The neural world's 3D view of one block of illustrative tissue.
//
// What is drawn, and what it is:
//   cells of a model        bodies at the model's own coordinates (µm); shapes ILLUSTRATIVE (morph.ts); glow, flash and
//                           the soft disc at a spike read from the model snapshot written into runtime.ts this frame —
//                           an explanatory overlay of model state, not what tissue looks like;
//   connections             a tube per model connection; the bead moving along it marks an event that is on its way
//                           for the connection's DELAY — a timer made visible, not a voltage travelling down an axon;
//   backdrop cells, fibres, scenery and landmarks. They take part in no model. They are dimmer and hazier than the
//   specks, vessel          model's cells at the same distance, so the two are never confused;
//   haze and "sky"          rosy towards the cortical surface, indigo towards the white matter: a depth and "which way
//                           is up" cue. Rendering only;
//   display cutaway         geometry right in front of the lens fades out. A viewing aid, not a hole in the tissue.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, addAfterEffect, addEffect, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, FogExp2, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3 } from 'three';
import { controller } from './controller';
import { FOG_COLOR, FOG_DENSITY, TINTS, makeFieldMaterial, makeHaloMaterial, makeHazeMaterial, makeSkyMaterial } from './fieldMaterial';
import type { Pickable, V3 } from './flight';
import { buildBackdrop, buildBackdropBlock, buildFibres, buildForeground, buildMotes, linkPath, type Box } from './morph';
import { perf } from './perf';
import { MAX_LINKS, rt, type SceneSpec } from './runtime';
import { useWorld, type Selection } from './worldStore';

const BACKDROP_COUNT = { high: 96, balanced: 60, low: 30 } as const;
const BLOCK_COUNT = { high: 190, balanced: 120, low: 60 } as const;
const FIBRES = { high: 2600, balanced: 1400, low: 0 } as const;
const MOTES = { high: 900, balanced: 500, low: 0 } as const;
const DPR = { high: [1, 2], balanced: [1, 1.5], low: [1, 1] } as const;
const PULSES = 24;
// main-thread time of each frame, across every canvas on the page (for the performance sample; see perf.ts)
addEffect(() => { perf.begin(); });
addAfterEffect(() => { perf.end(); });

/** Scenery of a scene that is a whole block rather than a small cluster. */
export interface BlockScenery { box: Box; avoid: Array<{ p: readonly number[]; r: number }>; vessel: V3[]; scaleBar: V3 }

/** Moves the camera with the rig, runs the active model's frame, and keeps "what is under the reticle" up to date. */
function Driver({ spec }: { spec: SceneSpec }) {
  const { camera, size, gl, scene } = useThree();
  const pointer = useRef<[number, number] | null>(null), tick = useRef(0);
  useEffect(() => { scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY * 0.8); return () => { scene.fog = null; }; }, [scene]);
  useEffect(() => {
    const dom = gl.domElement;
    controller.attach(dom);
    const move = (e: PointerEvent) => { const r = dom.getBoundingClientRect(); pointer.current = [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]; };
    const leave = () => { pointer.current = null; };
    dom.addEventListener('pointermove', move); dom.addEventListener('pointerleave', leave);
    return () => { dom.removeEventListener('pointermove', move); dom.removeEventListener('pointerleave', leave); controller.detach(); };
  }, [gl]);
  useEffect(() => {
    const byId = new Map(spec.cells.map((c) => [c.id, c]));
    const things: Pickable[] = spec.cells.map((c) => ({ kind: 'cell', id: c.id, centre: c.pos, radius: c.radius * 1.2 }));
    for (const s of spec.sites ?? []) things.push({ kind: 'site', id: s.id, centre: s.pos, radius: s.radius });
    for (const l of spec.links) {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (a && b) things.push({ kind: 'link', id: l.id, points: new CatmullRomCurve3(linkPath(a, b)).getPoints(14).map((p) => [p.x, p.y, p.z] as V3), radius: 3.2 });
    }
    controller.pickables = things;
    rt.spec = spec;
  }, [spec]);
  // the rig goes to the scene's home pose only when the scene itself is a different one
  useEffect(() => { controller.home(spec.home.pos, spec.home.lookAt); useWorld.setState({ ready: true }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [spec.key]);
  useFrame((_, dt) => {
    const now = performance.now();
    perf.frame(now);
    controller.aspect = size.width / Math.max(1, size.height);
    controller.update(dt);
    const s = controller.s;
    camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    rt.frame?.(dt);
    rt.frames++;
    if (++tick.current % 5 === 0) {
      const at = controller.captured ? ([0, 0] as [number, number]) : pointer.current;
      const hit = at ? controller.hitAt(at[0], at[1]) : null, next: Selection | null = hit ? { kind: hit.kind, id: hit.id } : null, cur = useWorld.getState().hovered;
      if (cur?.id !== next?.id || cur?.kind !== next?.kind) useWorld.setState({ hovered: next });
    }
  });
  return null;
}

function Field({ spec }: { spec: SceneSpec }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => buildForeground(spec.cells), [spec.key]);
  const material = useMemo(() => makeFieldMaterial(false), []);
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const u = material.uniforms;
    u.uAct.value = rt.act; u.uFlash.value = rt.flash; u.uDim.value = rt.dim;
    spec.cells.forEach((c, i) => { const t = TINTS[c.tint]; (u.uTint.value as Vector3[])[i].set(t.r, t.g, t.b); });
  }, [material, spec]);
  useEffect(() => {
    const idx = (s: Selection | null) => (s?.kind === 'cell' ? spec.cells.findIndex((c) => c.id === s.id) : -9);
    material.uniforms.uSel.value = idx(selected); material.uniforms.uHover.value = idx(hovered);
  }, [material, spec, selected, hovered]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** A soft disc where a model cell has just fired (overlay of model state; off with reduced motion). */
function Halos({ spec }: { spec: SceneSpec }) {
  const { size, viewport } = useThree();
  const reduced = useWorld((s) => s.reducedMotion);
  const built = useMemo(() => {
    const g = new BufferGeometry(), n = spec.cells.length, pos = new Float32Array(n * 3), idx = new Float32Array(n), rad = new Float32Array(n);
    spec.cells.forEach((c, i) => { pos.set(c.pos, i * 3); idx[i] = i; rad[i] = c.radius; });
    g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('aIdx', new BufferAttribute(idx, 1)); g.setAttribute('aRadius', new BufferAttribute(rad, 1));
    const m = makeHaloMaterial(); m.uniforms.uFlash.value = rt.flash;
    return { g, m };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key]);
  useEffect(() => () => { built.g.dispose(); built.m.dispose(); }, [built]);
  useFrame(() => { built.m.uniforms.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan(controller.fovY / 2)); });
  return reduced ? null : <points geometry={built.g} material={built.m} frustumCulled={false} renderOrder={6} />;
}

function Backdrop({ block }: { block?: BlockScenery }) {
  const quality = useWorld((s) => s.quality);
  const { geometry } = useMemo(() => (block ? buildBackdropBlock(BLOCK_COUNT[quality], block.box, block.avoid) : buildBackdrop(BACKDROP_COUNT[quality], 330, 640)), [quality, block]);
  const material = useMemo(() => makeFieldMaterial(true), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** The far haze, the fibres and the specks. */
function Atmosphere({ box }: { box: Box }) {
  const quality = useWorld((s) => s.quality), reduced = useWorld((s) => s.reducedMotion);
  const { size, viewport } = useThree();
  const sky = useMemo(() => makeSkyMaterial(), []);
  const fibres = useMemo(() => (FIBRES[quality] ? { g: buildFibres(FIBRES[quality], box), m: makeHazeMaterial(false) } : null), [quality, box]);
  const motes = useMemo(() => (MOTES[quality] ? { g: buildMotes(MOTES[quality], box), m: makeHazeMaterial(true) } : null), [quality, box]);
  useEffect(() => () => sky.dispose(), [sky]);
  useEffect(() => () => { fibres?.g.dispose(); fibres?.m.dispose(); }, [fibres]);
  useEffect(() => () => { motes?.g.dispose(); motes?.m.dispose(); }, [motes]);
  useFrame(({ clock }) => {
    if (!motes) return;
    motes.m.uniforms.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan(controller.fovY / 2));
    if (!reduced) motes.m.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <>
      <mesh material={sky} frustumCulled={false} renderOrder={-10}><sphereGeometry args={[1, 24, 16]} /></mesh>
      {fibres && <lineSegments geometry={fibres.g} material={fibres.m} frustumCulled={false} renderOrder={2} />}
      {motes && <points geometry={motes.g} material={motes.m} frustumCulled={false} renderOrder={3} />}
    </>
  );
}

const LINK_EXC = new Color('#F6DCA6'), LINK_INH = new Color('#8FAEFF');
function Links({ spec }: { spec: SceneSpec }) {
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered);
  const built = useMemo(() => {
    const byId = new Map(spec.cells.map((c) => [c.id, c]));
    return spec.links.slice(0, MAX_LINKS).flatMap((l) => {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) return [];
      const curve = new CatmullRomCurve3(linkPath(a, b)), col = l.inhibitory ? LINK_INH : LINK_EXC;
      const mat = new MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.5, transparent: true, opacity: 0.9 });
      const tube = new Mesh(new TubeGeometry(curve, 64, 0.95, 7), mat);
      const end = curve.getPoint(1), tan = curve.getTangent(1);
      return [{ link: l, curve, mat, tube, end, tan }];
    });
  }, [spec]);
  useEffect(() => () => built.forEach((b) => { b.tube.geometry.dispose(); b.mat.dispose(); }), [built]);
  const beads = useMemo(() => {
    const geo = new SphereGeometry(2.8, 14, 10), mat = new MeshBasicMaterial({ color: '#FFF3D6', fog: false });
    return { geo, mat, meshes: Array.from({ length: PULSES }, () => { const m = new Mesh(geo, mat); m.visible = false; return m; }) };
  }, []);
  useEffect(() => () => { beads.geo.dispose(); beads.mat.dispose(); }, [beads]);
  const p = useMemo(() => new Vector3(), []);
  useFrame(() => {
    built.forEach((b, i) => {
      const on = rt.linkOn[i] > 0.5, mark = selected?.kind === 'link' && selected.id === b.link.id ? 1 : hovered?.kind === 'link' && hovered.id === b.link.id ? 0.5 : 0;
      b.mat.opacity = on ? 0.92 : 0.16; b.mat.emissiveIntensity = (on ? 0.55 : 0.1) + mark * 1.6;
    });
    for (let k = 0; k < PULSES; k++) {
      const pulse = rt.pulses[k], m = beads.meshes[k], b = pulse ? built[pulse.link] : undefined;
      if (!pulse || !b) { m.visible = false; continue; }
      b.curve.getPoint(Math.max(0, Math.min(1, pulse.u)), p); m.position.copy(p); m.visible = true;
    }
  });
  return (
    <>
      {built.map((b, i) => (
        <group key={b.link.id}>
          <primitive object={b.tube} />
          {/* the ending says what kind of connection it is without colour: a bead excites, a flat bar inhibits */}
          {b.link.inhibitory
            ? <mesh position={b.end} onUpdate={(m) => m.lookAt(b.end.clone().add(b.tan))}><cylinderGeometry args={[3.4, 3.4, 0.9, 16]} /><meshStandardMaterial color={LINK_INH} emissive={LINK_INH} emissiveIntensity={0.5} /></mesh>
            : <mesh position={b.end}><sphereGeometry args={[1.9, 12, 10]} /><meshStandardMaterial color={LINK_EXC} emissive={LINK_EXC} emissiveIntensity={0.5} /></mesh>}
          {selected?.kind === 'link' && selected.id === b.link.id && (
            <Html position={b.curve.getPoint(0.5)} center zIndexRange={[4, 0]}><span className="w-tag accent" data-testid="link-tag">{b.link.from} → {b.link.to} · {b.link.inhibitory ? 'inhibits' : 'excites'}{rt.linkOn[i] > 0.5 ? '' : ' · off'}</span></Html>
          )}
        </group>
      ))}
      {beads.meshes.map((m, k) => <primitive key={k} object={m} />)}
    </>
  );
}

/** Things to find your way by. None of them is part of a model. */
function Landmarks({ block }: { block?: BlockScenery }) {
  const overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  const path = block?.vessel ?? ([[-620, -190, 150], [-300, -150, 60], [-40, -205, -30], [240, -160, -120], [620, -215, -210]] as V3[]);
  const vessel = useMemo(() => new TubeGeometry(new CatmullRomCurve3(path.map((p) => new Vector3(p[0], p[1], p[2]))), 120, 5.6, 12), [path]);
  useEffect(() => () => vessel.dispose(), [vessel]);
  const bar = block?.scaleBar ?? ([-50, -238, 150] as V3), mid = path[Math.floor(path.length / 2) - 1] ?? path[0];
  return (
    <>
      <mesh geometry={vessel}><meshStandardMaterial color="#A63A57" roughness={0.36} metalness={0.05} emissive="#4A0F22" emissiveIntensity={0.7} /></mesh>
      <group position={bar}>
        <mesh position={[50, 0, 0]}><boxGeometry args={[100, 0.9, 0.9]} /><meshBasicMaterial color="#E8EEF9" fog={false} /></mesh>
        <mesh><boxGeometry args={[0.9, 7, 0.9]} /><meshBasicMaterial color="#E8EEF9" fog={false} /></mesh>
        <mesh position={[100, 0, 0]}><boxGeometry args={[0.9, 7, 0.9]} /><meshBasicMaterial color="#E8EEF9" fog={false} /></mesh>
        <Html position={[50, -9, 0]} center zIndexRange={[2, 0]}><span className="w-tag" data-testid="scale-bar">100 µm</span></Html>
      </group>
      {overview && (
        <>
          <Html position={mid} center zIndexRange={[2, 0]}><span className="w-tag">small vessel · landmark only</span></Html>
          <Html position={[bar[0] + 60, (block?.box.max[1] ?? 400) - 90, bar[2] - 150]} center zIndexRange={[2, 0]}><span className="w-tag">↑ towards the cortical surface</span></Html>
        </>
      )}
    </>
  );
}

function Tags({ spec, tag }: { spec: SceneSpec; tag?: (id: string) => string }) {
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered), overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  const is = (s: Selection | null, kind: string, id: string) => s?.kind === kind && s.id === id;
  const cells = spec.cells.filter((c) => (overview && !spec.sites) || is(selected, 'cell', c.id) || is(hovered, 'cell', c.id));
  const sites = (spec.sites ?? []).filter((c) => is(selected, 'site', c.id) || is(hovered, 'site', c.id));
  return (
    <>
      {cells.map((c) => {
        const sel = is(selected, 'cell', c.id), extra = tag?.(c.id);
        return (
          <Html key={c.id} position={[c.pos[0], c.pos[1] + c.radius * 1.9, c.pos[2]]} center zIndexRange={[5, 0]}>
            <span className={`w-tag${sel ? ' accent' : ''}`} data-testid={`cell-tag-${c.id}`}>{sel ? '◉ ' : ''}{c.label}{extra ? ` · ${extra}` : ''}</span>
          </Html>
        );
      })}
      {sites.map((c) => {
        const sel = is(selected, 'site', c.id), extra = tag?.(c.id);
        return (
          <Html key={c.id} position={[c.pos[0], c.pos[1] - c.radius - 7, c.pos[2]]} center zIndexRange={[5, 0]}>
            <span className={`w-tag${sel ? ' accent' : ' warm'}`} data-testid={`site-tag-${c.id}`}>{sel ? '◉ ' : ''}{c.label}{extra ? ` · ${extra}` : ''}</span>
          </Html>
        );
      })}
    </>
  );
}

export function WorldCanvas({ spec, children, tag, block, active = true }: { spec: SceneSpec; children?: ReactNode; tag?: (id: string) => string; block?: BlockScenery; /** false = mounted and built, but not drawing (the scene is hidden). */ active?: boolean }) {
  const quality = useWorld((s) => s.quality);
  const box = useMemo<Box>(() => block?.box ?? { min: [-700, -420, -700], max: [700, 420, 700] }, [block]);
  return (
    <Canvas flat frameloop={active ? 'always' : 'never'} dpr={DPR[quality] as unknown as [number, number]} camera={{ fov: (controller.fovY * 180) / Math.PI, near: 0.6, far: 5200, position: spec.home.pos }} gl={{ antialias: true, powerPreference: 'high-performance' }} data-testid="world-canvas">
      <ambientLight intensity={0.9} color="#B9A9E8" />
      <directionalLight position={[-420, 820, 380]} intensity={2.1} color="#FFEDF2" />
      <directionalLight position={[500, -780, -360]} intensity={0.7} color="#FF6D8E" />
      <Driver spec={spec} />
      <Atmosphere box={box} />
      <Backdrop block={block} />
      <Field spec={spec} />
      <Halos spec={spec} />
      <Links spec={spec} />
      <Landmarks block={block} />
      <Tags spec={spec} tag={tag} />
      {children}
    </Canvas>
  );
}
