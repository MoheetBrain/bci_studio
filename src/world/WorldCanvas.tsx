// The neural world's 3D view of one block of illustrative tissue.
//
// What is drawn, and what it is:
//   cells of a model        bodies at the model's own coordinates (µm); shapes ILLUSTRATIVE (morph.ts); glow, flash and
//                           the soft disc at a spike read from the model snapshot written into runtime.ts this frame —
//                           an explanatory overlay of model state, not what tissue looks like;
//   a reconstructed cell    (the world only) one neuron drawn from a published reconstruction, as an exemplar. No model
//                           computes anything in it;
//   connections             a tube per model connection; the bead moving along it marks an event that is on its way
//                           for the connection's DELAY — a timer made visible, not a voltage travelling down an axon;
//   context cells, fibres,  scenery and landmarks. They take part in no model. They are dimmer and hazier than the
//   specks, vessel          model's cells at the same distance, so the two are never confused;
//   the craft               (the world only) the player: a virtual navigation instrument. It records nothing and it
//                           touches nothing;
//   haze and "sky"          rosy towards the cortical surface, indigo towards the white matter: a depth and "which way
//                           is up" cue. Rendering only;
//   display cutaway         geometry right in front of the lens fades out. A viewing aid, not a hole in the tissue.
//
// Everything that is drawn as a thing can be pointed at as that thing: each part of the scene registers picking
// stand-ins for what it draws (pickRegistry.ts), made from the same centre lines and calibres as the meshes.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, addAfterEffect, addEffect, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, FogExp2, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3, type ShaderMaterial } from 'three';
import { controller } from './controller';
import { Craft } from './Craft';
import { FOG_COLOR, FOG_DENSITY, TINTS, makeFieldMaterial, makeHaloMaterial, makeHazeMaterial, makeSkyMaterial } from './fieldMaterial';
import { boundOf, chunkBody, type PickBody, type Pickable, type V3 } from './flight';
import { PART_NAMES, buildBackdrop, buildBackdropBlock, buildFibres, buildForeground, buildMotes, buildSkeletonCell, linkPath, type Box, type CellProxy, type SkeletonNodes } from './morph';
import { perf } from './perf';
import { allBodies, bodiesVersion, setBodies } from './pickRegistry';
import { MAX_LINKS, rt, type SceneSpec } from './runtime';
import { selectionOf, useWorld, type Selection } from './worldStore';

const BACKDROP_COUNT = { high: 96, balanced: 60, low: 30 } as const;
const BLOCK_COUNT = { high: 190, balanced: 120, low: 60 } as const;
/** Extra context cells that the "dense" reveal adds, to show how much is left out of the readable view. */
const DENSE_EXTRA = { high: 420, balanced: 260, low: 120 } as const;
const FIBRES = { high: 2600, balanced: 1400, low: 0 } as const;
const MOTES = { high: 900, balanced: 500, low: 0 } as const;
const DPR = { high: [1, 2], balanced: [1, 1.5], low: [1, 1] } as const;
const PULSES = 24;
// main-thread time of each frame, across every canvas on the page (for the performance sample; see perf.ts)
addEffect(() => { perf.begin(); });
addAfterEffect(() => { perf.end(); });

/** Scenery of a scene that is a whole block rather than a small cluster. */
export interface BlockScenery {
  box: Box;
  avoid: Array<{ p: readonly number[]; r: number }>;
  /** Centre lines of the vessel and of its branches (landmarks). */
  vessels: V3[][];
  scaleBar: V3;
}
/** A reconstructed cell to draw in place of a generated one: the cell's id in the scene, its skeleton, and where it goes. */
export interface SkeletonCell { id: string; nodes: SkeletonNodes; place: (x: number, y: number, z: number) => V3 }

const bodyOf = (kind: PickBody['kind'], id: string, proxy: CellProxy | null, centre?: V3, radius?: number, spherePart = 'cell body'): PickBody => {
  const segs = proxy && proxy.segs.length ? proxy.segs : undefined;
  return { kind, id, centre, radius, spherePart, segs, parts: proxy?.parts, partNames: PART_NAMES, chunks: segs && segs.length / 7 > 96 ? chunkBody(segs) : undefined, bound: boundOf(segs, centre, radius ?? 0) };
};

/** Moves the camera with the rig, runs the active model's frame, and keeps "what is aimed at" up to date. */
function Driver({ spec, embodied }: { spec: SceneSpec; embodied: boolean }) {
  const { camera, size, gl, scene } = useThree();
  const tick = useRef(0), seen = useRef(-1);
  useEffect(() => { scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY * 0.8); return () => { scene.fog = null; }; }, [scene]);
  useEffect(() => {
    controller.embodied = embodied;
    controller.attach(gl.domElement);
    return () => { controller.detach(); controller.embodied = false; controller.bodies = null; };
  }, [gl, embodied]);
  useEffect(() => {
    // the prototypes aim at cell bodies, sites and connections only (as they always did)
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
    controller.viewHeightPx = size.height;
    if (embodied && seen.current !== bodiesVersion()) { seen.current = bodiesVersion(); controller.bodies = allBodies(); }
    controller.update(dt);
    const c = controller.camPose();
    camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    camera.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
    rt.frame?.(dt);
    rt.frames++;
    if (++tick.current % 4 === 0 && !controller.manipulating) {
      const at = controller.captured ? ([0, 0] as [number, number]) : controller.pointer;
      const t0 = performance.now(), hit = at ? controller.hitAt(at[0], at[1]) : null;
      if (at) perf.pick(performance.now() - t0);
      const next: Selection | null = selectionOf(hit), cur = useWorld.getState().hovered;
      if (cur?.id !== next?.id || cur?.kind !== next?.kind || cur?.part !== next?.part) useWorld.setState({ hovered: next });
    }
  });
  return null;
}

/** The uniform values that say which cell is marked and which is isolated, for one of the two tissue materials. */
function useMarks(material: ShaderMaterial, indexOf: (s: Selection | null) => number, embodied: boolean) {
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered), reveal = useWorld((s) => s.reveal);
  useEffect(() => {
    const sel = indexOf(selected);
    material.uniforms.uSel.value = sel; material.uniforms.uHover.value = indexOf(hovered);
    // isolate: this material keeps the selected cell if it draws it, and thins everything else
    material.uniforms.uIso.value = embodied && reveal === 'isolate' && selected && selected.kind !== 'site' && selected.kind !== 'landmark' ? (sel >= 0 ? sel : -2) : -9;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, selected, hovered, reveal, embodied]);
}

function Field({ spec, embodied, skeleton }: { spec: SceneSpec; embodied: boolean; skeleton?: SkeletonCell | null }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildForeground(spec.cells.filter((c) => c.shape !== 'skeleton')), [spec.key]);
  const material = useMemo(() => makeFieldMaterial(false), []);
  // the reconstructed cell: drawn from its skeleton, with the same material and its own number among the scene's cells
  const recon = useMemo(() => {
    const i = skeleton ? spec.cells.findIndex((c) => c.id === skeleton.id) : -1;
    if (!skeleton || i < 0) return null;
    const n = skeleton.nodes, N = n.x.length, placed: SkeletonNodes = { ...n, x: new Array(N), y: new Array(N), z: new Array(N) };
    for (let k = 0; k < N; k++) { const p = skeleton.place(n.x[k], n.y[k], n.z[k]); placed.x[k] = p[0]; placed.y[k] = p[1]; placed.z[k] = p[2]; }
    return { index: i, ...buildSkeletonCell(placed, i, [0, 0, 0]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key, skeleton]);
  useEffect(() => () => built.geometry.dispose(), [built]);
  useEffect(() => () => recon?.geometry.dispose(), [recon]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const u = material.uniforms;
    u.uAct.value = rt.act; u.uFlash.value = rt.flash; u.uDim.value = rt.dim;
    spec.cells.forEach((c, i) => { const t = TINTS[c.tint]; (u.uTint.value as Vector3[])[i].set(t.r, t.g, t.b); });
  }, [material, spec]);
  // generated cells keep their number among the generated ones: map it back to the scene's numbering once
  useEffect(() => {
    const gen = spec.cells.map((c, i) => (c.shape !== 'skeleton' ? i : -1)).filter((i) => i >= 0), attr = built.geometry.getAttribute('aCell') as BufferAttribute;
    if (gen.some((g, k) => g !== k)) { for (let v = 0; v < attr.count; v++) attr.setX(v, gen[Math.round(attr.getX(v))]); attr.needsUpdate = true; }
  }, [built, spec]);
  useEffect(() => {
    if (!embodied) return;
    const gen = spec.cells.filter((c) => c.shape !== 'skeleton');
    const bodies = gen.map((c, k) => bodyOf(c.context ? 'context' : 'cell', c.id, built.proxies[k], c.pos, c.radius));
    if (recon) { const c = spec.cells[recon.index]; bodies.push(bodyOf('context', c.id, recon.proxy, c.pos, c.radius)); }
    setBodies('cells', bodies);
    return () => setBodies('cells', null);
  }, [built, recon, spec, embodied]);
  useMarks(material, (s) => (s && (s.kind === 'cell' || s.kind === 'context') ? spec.cells.findIndex((c) => c.id === s.id) : -9), embodied);
  return (
    <>
      <mesh geometry={built.geometry} material={material} frustumCulled={false} />
      {recon && <mesh geometry={recon.geometry} material={material} frustumCulled={false} />}
    </>
  );
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

/** Context cells: scenery that can still be pointed at, and says what it is. */
function Backdrop({ block, embodied }: { block?: BlockScenery; embodied: boolean }) {
  const quality = useWorld((s) => s.quality), reveal = useWorld((s) => s.reveal);
  const base = useMemo(() => (block ? buildBackdropBlock(BLOCK_COUNT[quality], block.box, block.avoid) : null), [quality, block]);
  const legacy = useMemo(() => (block ? null : buildBackdrop(BACKDROP_COUNT[quality], 330, 640)), [quality, block]);
  // the denser layer exists only once it has been asked for
  const wantDense = !!block && embodied && reveal === 'dense';
  const everDense = useRef(false); if (wantDense) everDense.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dense = useMemo(() => (block && everDense.current ? buildBackdropBlock(DENSE_EXTRA[quality], block.box, [...block.avoid, ...(base?.bodies ?? []).map((p) => ({ p, r: 40 }))], 9191, base?.bodies.length ?? 0) : null), [quality, block, base, wantDense]);
  const material = useMemo(() => makeFieldMaterial(true), []);
  useEffect(() => () => { base?.geometry.dispose(); legacy?.geometry.dispose(); }, [base, legacy]);
  useEffect(() => () => dense?.geometry.dispose(), [dense]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => { material.uniforms.uContext.value = wantDense ? 1 : 0; }, [material, wantDense]);
  useEffect(() => {
    if (!embodied || !base) return;
    const bodies = base.bodies.map((p, i) => bodyOf('context', `ctx${i}`, base.proxies[i], p, base.radii[i]));
    if (dense && wantDense) dense.bodies.forEach((p, i) => bodies.push(bodyOf('context', `ctx${base.bodies.length + i}`, dense.proxies[i], p, dense.radii[i])));
    setBodies('context', bodies);
    rt.context = { pos: [...base.bodies, ...(dense && wantDense ? dense.bodies : [])], radius: [...base.radii, ...(dense && wantDense ? dense.radii : [])], shape: [...base.shapes, ...(dense && wantDense ? dense.shapes : [])] };
    return () => { setBodies('context', null); rt.context = null; };
  }, [base, dense, wantDense, embodied]);
  useMarks(material, (s) => (s?.kind === 'context' && s.id.startsWith('ctx') ? +s.id.slice(3) : -9), embodied);
  return (
    <>
      <mesh geometry={(base ?? legacy)!.geometry} material={material} frustumCulled={false} />
      {dense && wantDense && <mesh geometry={dense.geometry} material={material} frustumCulled={false} />}
    </>
  );
}

/** The far haze, the fibres and the specks. */
function Atmosphere({ box }: { box: Box }) {
  const quality = useWorld((s) => s.quality), reduced = useWorld((s) => s.reducedMotion), reveal = useWorld((s) => s.reveal);
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
      {fibres && reveal !== 'isolate' && <lineSegments geometry={fibres.g} material={fibres.m} frustumCulled={false} renderOrder={2} />}
      {motes && reveal !== 'isolate' && <points geometry={motes.g} material={motes.m} frustumCulled={false} renderOrder={3} />}
    </>
  );
}

const LINK_EXC = new Color('#F6DCA6'), LINK_INH = new Color('#8FAEFF');
function Links({ spec, embodied }: { spec: SceneSpec; embodied: boolean }) {
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered), reveal = useWorld((s) => s.reveal);
  // with one neuron isolated, a connection is drawn only if that neuron is at one of its ends
  const isoId = embodied && reveal === 'isolate' && selected && (selected.kind === 'cell' || selected.kind === 'context') ? selected.id : null;
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
  useEffect(() => {
    if (!embodied) return;
    setBodies('links', built.map((b) => {
      const pts = b.curve.getPoints(18), segs = new Float32Array((pts.length - 1) * 7);
      for (let i = 0; i + 1 < pts.length; i++) segs.set([pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z, 1.4], i * 7);
      return { kind: 'link' as const, id: b.link.id, segs, partNames: ['connection'], bound: boundOf(segs) };
    }));
    return () => setBodies('links', null);
  }, [built, embodied]);
  const beads = useMemo(() => {
    const geo = new SphereGeometry(2.8, 14, 10), mat = new MeshBasicMaterial({ color: '#FFF3D6', fog: false });
    return { geo, mat, meshes: Array.from({ length: PULSES }, () => { const m = new Mesh(geo, mat); m.visible = false; return m; }) };
  }, []);
  useEffect(() => () => { beads.geo.dispose(); beads.mat.dispose(); }, [beads]);
  const p = useMemo(() => new Vector3(), []);
  useFrame(() => {
    // a connection is marked when it is selected or aimed at, and when the cell at either end of it is selected
    const cellSel = selected?.kind === 'cell' ? selected.id : null;
    built.forEach((b, i) => {
      const on = rt.linkOn[i] > 0.5;
      const mark = selected?.kind === 'link' && selected.id === b.link.id ? 1 : hovered?.kind === 'link' && hovered.id === b.link.id ? 0.5 : cellSel && (b.link.from === cellSel || b.link.to === cellSel) ? 0.45 : 0;
      b.mat.opacity = on ? 0.92 : 0.16; b.mat.emissiveIntensity = (on ? 0.55 : 0.1) + mark * 1.6;
    });
    for (let k = 0; k < PULSES; k++) {
      const pulse = rt.pulses[k], m = beads.meshes[k], b = pulse ? built[pulse.link] : undefined;
      if (!pulse || !b || (isoId && b.link.from !== isoId && b.link.to !== isoId)) { m.visible = false; continue; }
      b.curve.getPoint(Math.max(0, Math.min(1, pulse.u)), p); m.position.copy(p); m.visible = true;
    }
  });
  return (
    <>
      {built.map((b, i) => (
        <group key={b.link.id} visible={!isoId || b.link.from === isoId || b.link.to === isoId}>
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

const LEGACY_VESSEL: V3[][] = [[[-620, -190, 150], [-300, -150, 60], [-40, -205, -30], [240, -160, -120], [620, -215, -210]]];
/** Things to find your way by. None of them is part of a model. */
function Landmarks({ block, embodied }: { block?: BlockScenery; embodied: boolean }) {
  const overview = useWorld((s) => s.ctl.orbitLabel === 'Overview'), selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered);
  const paths = block?.vessels ?? LEGACY_VESSEL;
  const vessels = useMemo(() => paths.map((path, k) => ({ curve: new CatmullRomCurve3(path.map((p) => new Vector3(p[0], p[1], p[2]))), r: k === 0 ? 5.6 : 3.9 })).map((v) => ({ ...v, geo: new TubeGeometry(v.curve, 120, v.r, 12) })), [paths]);
  useEffect(() => () => vessels.forEach((v) => v.geo.dispose()), [vessels]);
  useEffect(() => {
    if (!embodied) return;
    const segs: number[] = [];
    for (const v of vessels) { const pts = v.curve.getPoints(40); for (let i = 0; i + 1 < pts.length; i++) segs.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z, v.r); }
    const f = Float32Array.from(segs);
    setBodies('landmarks', [{ kind: 'landmark', id: 'vessel', segs: f, partNames: ['vessel wall'], chunks: chunkBody(f, 16), bound: boundOf(f) }]);
    return () => setBodies('landmarks', null);
  }, [vessels, embodied]);
  const bar = block?.scaleBar ?? ([-50, -238, 150] as V3), mid = paths[0][Math.floor(paths[0].length / 2) - 1] ?? paths[0][0];
  const mark = selected?.kind === 'landmark' ? 1 : hovered?.kind === 'landmark' ? 0.5 : 0;
  return (
    <>
      {vessels.map((v, k) => <mesh key={k} geometry={v.geo}><meshStandardMaterial color="#A63A57" roughness={0.36} metalness={0.05} emissive={mark ? '#C0506C' : '#4A0F22'} emissiveIntensity={0.7 + mark * 0.5} /></mesh>)}
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

function Tags({ spec, tag, embodied }: { spec: SceneSpec; tag?: (id: string) => string; embodied: boolean }) {
  const selected = useWorld((s) => s.selected), hovered = useWorld((s) => s.hovered), overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  const is = (s: Selection | null, id: string) => !!s && s.id === id && (s.kind === 'cell' || s.kind === 'context' || s.kind === 'site');
  const cells = spec.cells.filter((c) => (overview && !spec.sites && !embodied) || is(selected, c.id) || is(hovered, c.id));
  const sites = (spec.sites ?? []).filter((c) => is(selected, c.id) || is(hovered, c.id));
  // a context cell that is aimed at or selected is named where it is, with what it is
  const ctx = [selected, hovered].filter((s): s is Selection => !!s && s.kind === 'context' && s.id.startsWith('ctx')).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
  const part = (id: string) => { const s = hovered && hovered.id === id ? hovered : selected && selected.id === id ? selected : null; return s?.part && s.part !== 'cell body' ? s.part : ''; };
  return (
    <>
      {cells.map((c) => {
        const sel = is(selected, c.id), extra = tag?.(c.id), p = part(c.id);
        return (
          <Html key={c.id} position={[c.pos[0], c.pos[1] + c.radius * 1.9, c.pos[2]]} center zIndexRange={[5, 0]}>
            <span className={`w-tag${sel ? ' accent' : ''}`} data-testid={`cell-tag-${c.id}`}>{sel ? '◉ ' : ''}{c.label}{p ? ` · ${p}` : ''}{extra ? ` · ${extra}` : ''}</span>
          </Html>
        );
      })}
      {ctx.map((s) => {
        const i = +s.id.slice(3), p = rt.context?.pos[i];
        return p ? (
          <Html key={s.id} position={[p[0], p[1] + (rt.context!.radius[i] ?? 8) * 1.9, p[2]]} center zIndexRange={[5, 0]}>
            <span className={`w-tag${selected?.id === s.id ? ' accent' : ''}`} data-testid={`cell-tag-${s.id}`}>{selected?.id === s.id ? '◉ ' : ''}Context neuron{part(s.id) ? ` · ${part(s.id)}` : ''} · no model</span>
          </Html>
        ) : null;
      })}
      {sites.map((c) => {
        const sel = is(selected, c.id), extra = tag?.(c.id);
        return (
          <Html key={c.id} position={[c.pos[0], c.pos[1] - c.radius - 7, c.pos[2]]} center zIndexRange={[5, 0]}>
            <span className={`w-tag${sel ? ' accent' : ' warm'}`} data-testid={`site-tag-${c.id}`}>{sel ? '◉ ' : ''}{c.label}{extra ? ` · ${extra}` : ''}</span>
          </Html>
        );
      })}
    </>
  );
}

export function WorldCanvas({ spec, children, tag, block, active = true, embodied = false, skeleton }: {
  spec: SceneSpec; children?: ReactNode; tag?: (id: string) => string; block?: BlockScenery;
  /** false = mounted and built, but not drawing (the scene is hidden). */
  active?: boolean;
  /** The world: the player is a craft in the scene, the camera follows it, and everything drawn can be aimed at. */
  embodied?: boolean;
  skeleton?: SkeletonCell | null;
}) {
  const quality = useWorld((s) => s.quality);
  const box = useMemo<Box>(() => block?.box ?? { min: [-700, -420, -700], max: [700, 420, 700] }, [block]);
  return (
    <Canvas flat frameloop={active ? 'always' : 'never'} dpr={DPR[quality] as unknown as [number, number]} camera={{ fov: (controller.fovY * 180) / Math.PI, near: 0.6, far: 5200, position: spec.home.pos }} gl={{ antialias: true, powerPreference: 'high-performance' }} data-testid="world-canvas">
      <ambientLight intensity={0.9} color="#B9A9E8" />
      <directionalLight position={[-420, 820, 380]} intensity={2.1} color="#FFEDF2" />
      <directionalLight position={[500, -780, -360]} intensity={0.7} color="#FF6D8E" />
      <Driver spec={spec} embodied={embodied} />
      <Atmosphere box={box} />
      <Backdrop block={block} embodied={embodied} />
      <Field spec={spec} embodied={embodied} skeleton={skeleton} />
      <Halos spec={spec} />
      <Links spec={spec} embodied={embodied} />
      <Landmarks block={block} embodied={embodied} />
      <Tags spec={spec} tag={tag} embodied={embodied} />
      {embodied && <Craft />}
      {children}
    </Canvas>
  );
}
