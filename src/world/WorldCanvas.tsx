// The neural world's 3D view: one compact representative circuit that every toy shares.
//
// What is drawn, and what it is:
//   cells of the model      bodies at the model's own coordinates (µm); shapes ILLUSTRATIVE (morph.ts); glow and flash
//                           read from the model snapshot the toy wrote into runtime.ts this frame;
//   connections             a tube per model connection; the bead moving along it marks an event that is on its way
//                           for the connection's DELAY — a timer made visible, not a voltage travelling down an axon;
//   backdrop cells, vessel  scenery and landmarks. They take part in no model;
//   display cutaway         geometry right in front of the lens fades out. A viewing aid, not a hole in the tissue.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CatmullRomCurve3, Color, FogExp2, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3 } from 'three';
import { controller } from './controller';
import { FOG_COLOR, FOG_DENSITY, TINTS, makeFieldMaterial } from './fieldMaterial';
import type { Pickable, V3 } from './flight';
import { buildBackdrop, buildForeground, linkPath } from './morph';
import { perf } from './perf';
import { MAX_LINKS, rt, type SceneSpec } from './runtime';
import { useWorld, type Selection } from './worldStore';

const BACKDROP_COUNT = { high: 96, balanced: 60, low: 30 } as const;
const DPR = { high: [1, 2], balanced: [1, 1.5], low: [1, 1] } as const;
const PULSES = 24;

/** Moves the camera with the rig, runs the toy's frame, and keeps "what is under the reticle" up to date. */
function Driver({ spec }: { spec: SceneSpec }) {
  const { camera, size, gl, scene } = useThree();
  const pointer = useRef<[number, number] | null>(null), tick = useRef(0);
  useEffect(() => { scene.background = FOG_COLOR; scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY); return () => { scene.fog = null; }; }, [scene]);
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

function Backdrop() {
  const quality = useWorld((s) => s.quality);
  const { geometry } = useMemo(() => buildBackdrop(BACKDROP_COUNT[quality], 330, 640), [quality]);
  const material = useMemo(() => makeFieldMaterial(true), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
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
      const tube = new Mesh(new TubeGeometry(curve, 48, 0.85, 6), mat);
      const end = curve.getPoint(1), tan = curve.getTangent(1);
      return [{ link: l, curve, mat, tube, end, tan }];
    });
  }, [spec]);
  useEffect(() => () => built.forEach((b) => { b.tube.geometry.dispose(); b.mat.dispose(); }), [built]);
  const beads = useMemo(() => {
    const geo = new SphereGeometry(2.6, 12, 10), mat = new MeshBasicMaterial({ color: '#FFF3D6', fog: false });
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
function Landmarks() {
  const overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  const vessel = useMemo(() => new TubeGeometry(new CatmullRomCurve3([new Vector3(-620, -190, 150), new Vector3(-300, -150, 60), new Vector3(-40, -205, -30), new Vector3(240, -160, -120), new Vector3(620, -215, -210)]), 80, 5.2, 10), []);
  useEffect(() => () => vessel.dispose(), [vessel]);
  return (
    <>
      <mesh geometry={vessel}><meshStandardMaterial color="#B4455F" roughness={0.42} emissive="#3A0C1A" emissiveIntensity={0.6} /></mesh>
      {/* a faint ceiling of light: the side the cortical surface would be on */}
      <mesh position={[0, 470, 0]} rotation={[Math.PI / 2, 0, 0]}><circleGeometry args={[900, 48]} /><meshBasicMaterial color="#E6A6C8" transparent opacity={0.05} depthWrite={false} fog={false} /></mesh>
      <group position={[-50, -238, 150]}>
        <mesh position={[50, 0, 0]}><boxGeometry args={[100, 0.9, 0.9]} /><meshBasicMaterial color="#E8EEF9" fog={false} /></mesh>
        <mesh><boxGeometry args={[0.9, 7, 0.9]} /><meshBasicMaterial color="#E8EEF9" fog={false} /></mesh>
        <mesh position={[100, 0, 0]}><boxGeometry args={[0.9, 7, 0.9]} /><meshBasicMaterial color="#E8EEF9" fog={false} /></mesh>
        <Html position={[50, -9, 0]} center zIndexRange={[2, 0]}><span className="w-tag" data-testid="scale-bar">100 µm</span></Html>
      </group>
      {overview && (
        <>
          <Html position={[-300, -150, 60]} center zIndexRange={[2, 0]}><span className="w-tag">small vessel · landmark only</span></Html>
          <Html position={[0, 330, 0]} center zIndexRange={[2, 0]}><span className="w-tag">↑ towards the cortical surface</span></Html>
        </>
      )}
    </>
  );
}

function Tags({ spec, tag }: { spec: SceneSpec; tag?: (id: string) => string }) {
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered), overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  const show = spec.cells.filter((c) => overview || (selected?.kind === 'cell' && selected.id === c.id) || (hovered?.kind === 'cell' && hovered.id === c.id));
  return (
    <>
      {show.map((c) => {
        const sel = selected?.kind === 'cell' && selected.id === c.id, extra = tag?.(c.id);
        return (
          <Html key={c.id} position={[c.pos[0], c.pos[1] + c.radius * 1.9, c.pos[2]]} center zIndexRange={[5, 0]}>
            <span className={`w-tag${sel ? ' accent' : ''}`} data-testid={`cell-tag-${c.id}`}>{sel ? '◉ ' : ''}{c.label}{extra ? ` · ${extra}` : ''}</span>
          </Html>
        );
      })}
    </>
  );
}

export function WorldCanvas({ spec, children, tag }: { spec: SceneSpec; children?: ReactNode; tag?: (id: string) => string }) {
  const quality = useWorld((s) => s.quality);
  return (
    <Canvas flat dpr={DPR[quality] as unknown as [number, number]} camera={{ fov: (controller.fovY * 180) / Math.PI, near: 0.6, far: 3400, position: spec.home.pos }} gl={{ antialias: true, powerPreference: 'high-performance' }} data-testid="world-canvas">
      <ambientLight intensity={0.9} color="#B9A9E8" />
      <directionalLight position={[-460, 800, 390]} intensity={2.1} color="#FFEDE6" />
      <directionalLight position={[500, -200, -400]} intensity={0.8} color="#5FA8FF" />
      <Driver spec={spec} />
      <Backdrop />
      <Field spec={spec} />
      <Links spec={spec} />
      <Landmarks />
      <Tags spec={spec} tag={tag} />
      {children}
    </Canvas>
  );
}
