// The whole brain at the entrance to the world: the atlas's MRI-derived surface, lit for the camera, with real region
// picking. It is also the small "you are here" map while the player is inside the tissue (the same canvas, made small).
//
//   measured / derived   the surface (one volunteer's MRI) and the region under the pointer (the atlas's label volume);
//   rendering            colour, light, relief and the warm glow that marks the way in (brainLook.ts).
// The glow marks an atlas REGION — the left precentral gyrus as the atlas labels it, a fold drawn from sulcal
// landmarks. It is not a map of primary motor cortex, whose borders the atlas does not contain.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ACESFilmicToneMapping, Group, Matrix4, Mesh, Raycaster, Vector2, Vector3, type BufferAttribute, type BufferGeometry, type PerspectiveCamera } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { useAtlas } from '../../atlas/atlasStore';
import { selectionField } from '../../atlas/surfaceFields';
import { makeBrainMaterial, prepareGeometry } from './brainLook';
import { useJourney, type RegionPick } from './journeyStore';

export const ENTRY_ID = 'left_precentral_gyrus';
/** Regions with a circuit to enter in this build. */
export const ENTERABLE = new Set([ENTRY_ID]);

// display transform (viewer only): three (x, y, z) metres = (R, S, −A) mm / 1000 — the same as the classic atlas view
const DISPLAY = new Matrix4().set(0.001, 0, 0, 0, 0, 0, 0.001, 0, 0, -0.001, 0, 0, 0, 0, 0, 1);
const FOV = 30;
interface Orbit { az: number; el: number; dist: number; target: Vector3 }
const posOf = (o: Orbit, out = new Vector3()) => out.set(o.target.x + o.dist * Math.cos(o.el) * Math.sin(o.az), o.target.y + o.dist * Math.sin(o.el), o.target.z + o.dist * Math.cos(o.el) * Math.cos(o.az));

export interface BrainApi {
  /** Fly in to the entry site. Resolves when the camera has arrived (at once with reduced motion). */
  dive: (reduced: boolean) => Promise<void>;
  /** Start close to the entry site and pull back to the opening shot. */
  rise: (reduced: boolean) => Promise<void>;
  home: () => void;
  /** Turn by these angles (radians) and scale the distance: the keyboard's way of doing what a drag and the wheel do. */
  nudge: (dAz: number, dEl: number, zoom?: number) => void;
  face: (id: string) => void;
  pickAt: (clientX: number, clientY: number) => RegionPick | null;
  screenOf: (id: string) => { x: number; y: number } | null;
  state: () => { az: number; el: number; dist: number; moving: boolean; coverage: number };
}
export const brain: { api: BrainApi | null } = { api: null };

function Scene({ mode, onReady }: { mode: 'stage' | 'map'; onReady: () => void }) {
  const { camera, gl, size, invalidate } = useThree();
  const specimen = useAtlas((s) => s.specimen)!, manifest = useAtlas((s) => s.manifest)!;
  const tree = useAtlas((s) => s.tree);
  const region = useJourney((s) => s.region), hover = useJourney((s) => s.hoverRegion);

  const built = useMemo(() => {
    const g = specimen.geometry as BufferGeometry & { boundsTree?: MeshBVH };
    prepareGeometry(g, specimen.adj);
    if (!g.boundsTree) g.boundsTree = new MeshBVH(g);
    const material = makeBrainMaterial();
    const mesh = new Mesh(g, material);
    mesh.raycast = acceleratedRaycast; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    const root = new Group();
    root.matrixAutoUpdate = false; root.matrix.copy(DISPLAY); root.matrixWorldNeedsUpdate = true;
    root.add(mesh);
    const [lo, hi] = specimen.meta.mesh.boundsMm;
    const centre = new Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2).applyMatrix4(DISPLAY);
    const extent = { r: (hi[0] - lo[0]) / 1000, a: (hi[1] - lo[1]) / 1000, s: (hi[2] - lo[2]) / 1000 };
    const indexOf = new Map(manifest.structures.map((s, i) => [s.id, i + 1]));
    // the way in: an exposed point of the entry region's surface near the middle of the region (a crown, not a fold)
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), ao = g.getAttribute('aAo'), r = indexOf.get(ENTRY_ID) ?? 0;
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let v = 0; v < specimen.region.length; v++) if (specimen.region[v] === r) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); n++; }
    let site: { p: Vector3; n: Vector3 } | null = null;
    if (n) {
      cx /= n; cy /= n; cz /= n;
      let best = -1, score = -Infinity;
      for (let v = 0; v < specimen.region.length; v++) {
        if (specimen.region[v] !== r) continue;
        const d = Math.hypot(pos.getX(v) - cx, pos.getY(v) - cy, pos.getZ(v) - cz), out = Math.hypot(pos.getX(v) - (lo[0] + hi[0]) / 2, pos.getY(v) - (lo[1] + hi[1]) / 2, pos.getZ(v) - (lo[2] + hi[2]) / 2);
        const sc = ao.getX(v) * 40 + out * 0.5 - d * 1.2;
        if (sc > score) { score = sc; best = v; }
      }
      if (best >= 0) site = { p: new Vector3(pos.getX(best), pos.getY(best), pos.getZ(best)).applyMatrix4(DISPLAY), n: new Vector3(nrm.getX(best), nrm.getY(best), nrm.getZ(best)).transformDirection(DISPLAY).normalize() };
    }
    // a few surface points per region, for finding a visible point of a region (tests, "show me")
    const samples = new Map<number, number[]>();
    for (let v = 0; v < specimen.region.length; v += 5) { const k = specimen.region[v]; if (k) { let l = samples.get(k); if (!l) samples.set(k, (l = [])); if (l.length < 500) l.push(v); } }
    return { root, mesh, material, centre, extent, indexOf, site, samples, pos };
  }, [specimen, manifest]);
  useEffect(() => () => built.material.dispose(), [built]);

  // ── camera ────────────────────────────────────────────────────────────────────────────────────────────────────
  const homeDir = useMemo(() => new Vector3(-0.80, 0.36, -0.48).normalize(), []);
  // read through refs, so that a camera move started in the same tick as a change of mode or size is composed for the new one
  const modeRef = useRef(mode), sizeRef = useRef(size);
  modeRef.current = mode; sizeRef.current = size;
  const fit = (fill = 0.8) => {
    const t = Math.tan((FOV * Math.PI) / 360), aspect = sizeRef.current.width / Math.max(1, sizeRef.current.height);
    const w = Math.hypot(built.extent.a * 0.95, built.extent.r * 0.45), h = built.extent.s * 1.04;
    return Math.max(h / (2 * t * fill), w / (2 * t * aspect * (fill + 0.06)));
  };
  const homeOrbit = (): Orbit => ({ az: Math.atan2(homeDir.x, homeDir.z), el: Math.asin(homeDir.y), dist: fit(modeRef.current === 'map' ? 0.92 : 0.86), target: built.centre.clone() });
  const orbit = useRef<Orbit>(homeOrbit());
  const vel = useRef({ az: 0, el: 0 });
  const tween = useRef<{ t0: number; ms: number; from: Orbit; to: Orbit; done: () => void } | null>(null);
  const dirty = useRef(true), userMoved = useRef(false), marker = useRef<Group>(null);
  const apply = () => { const cam = camera as PerspectiveCamera; posOf(orbit.current, cam.position); cam.lookAt(orbit.current.target); };
  const go = (to: Orbit, ms: number, done: () => void = () => undefined) => {
    if (ms <= 0) { tween.current = null; orbit.current = to; dirty.current = true; invalidate(); done(); return; }
    // take the short way round
    const from = { ...orbit.current, target: orbit.current.target.clone() };
    to.az = from.az + Math.atan2(Math.sin(to.az - from.az), Math.cos(to.az - from.az));
    tween.current = { t0: performance.now(), ms, from, to, done };
    invalidate();
  };
  const closeTo = (): Orbit | null => {
    const s = built.site;
    if (!s) return null;
    // look straight at the site from just outside it, along its own outward direction
    return { az: Math.atan2(s.n.x, s.n.z), el: Math.asin(Math.max(-0.95, Math.min(0.95, s.n.y))), dist: 0.034, target: s.p.clone() };
  };

  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 1.0;
    const cam = camera as PerspectiveCamera;
    cam.fov = FOV; cam.near = 0.005; cam.far = 4; cam.updateProjectionMatrix();
    // the smoothed outline of the region that can be entered (computed once)
    const attr = (built.mesh.geometry as BufferGeometry).getAttribute('aWEntry') as BufferAttribute, flags = new Uint8Array(256), idx = built.indexOf.get(ENTRY_ID) ?? 0;
    if (idx) { flags[idx] = 1; selectionField(specimen.region, flags, specimen.adj, 5, attr.array as Uint8Array); attr.needsUpdate = true; }
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);
  // keep the composition when the stage changes size or becomes the small map
  useEffect(() => {
    if (tween.current) return;
    if (mode === 'map' || !userMoved.current) orbit.current = homeOrbit();
    else orbit.current.dist = Math.max(fit() * 0.42, Math.min(fit() * 1.5, orbit.current.dist));
    dirty.current = true; invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, mode]);

  // selection and hover → the material
  useEffect(() => {
    const u = built.material.uniforms, attr = (built.mesh.geometry as BufferGeometry).getAttribute('aWSel') as BufferAttribute;
    const flags = new Uint8Array(256), idx = region ? built.indexOf.get(region.id) ?? 0 : 0;
    if (idx) flags[idx] = 1;
    selectionField(specimen.region, flags, specimen.adj, 4, attr.array as Uint8Array);
    attr.needsUpdate = true;
    u.uDim.value = idx && mode === 'stage' ? 1 : 0;
    dirty.current = true; invalidate();
  }, [region, built, specimen, mode, invalidate]);
  useEffect(() => { built.material.uniforms.uHover.value = hover && mode === 'stage' ? built.indexOf.get(hover.id) ?? -9 : -9; dirty.current = true; invalidate(); }, [hover, built, mode, invalidate]);

  useFrame(({ clock }) => {
    const o = orbit.current, tw = tween.current;
    if (tw) {
      const k = Math.min(1, (performance.now() - tw.t0) / tw.ms), e = k * k * k * (k * (6 * k - 15) + 10);
      o.az = tw.from.az + (tw.to.az - tw.from.az) * e; o.el = tw.from.el + (tw.to.el - tw.from.el) * e;
      // distance eases in log space, so a long dive does not crawl at the start and rush at the end
      o.dist = Math.exp(Math.log(tw.from.dist) + (Math.log(tw.to.dist) - Math.log(tw.from.dist)) * e);
      o.target.lerpVectors(tw.from.target, tw.to.target, e);
      dirty.current = true;
      if (k >= 1) { tween.current = null; tw.done(); }
    } else if (Math.abs(vel.current.az) + Math.abs(vel.current.el) > 1e-5) {
      o.az += vel.current.az; o.el = Math.max(-1.35, Math.min(1.35, o.el + vel.current.el));
      vel.current.az *= 0.9; vel.current.el *= 0.9;
      dirty.current = true;
    }
    if (dirty.current) { apply(); dirty.current = false; }
    built.material.uniforms.uPulse.value = mode === 'stage' ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.1) : 0.6;
    // the mark of the way in keeps its size on screen, so that it never fills the view during the dive
    if (marker.current) marker.current.scale.setScalar(Math.max(0.03, o.dist / fit(0.86)));
  });

  // ── picking and the API ─────────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ray = new Raycaster() as Raycaster & { firstHitOnly?: boolean }, ndc = new Vector2(), local = new Vector3(), inv = new Matrix4();
    ray.firstHitOnly = true;
    const pos = built.pos;
    const pickAt = (clientX: number, clientY: number): RegionPick | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObject(built.mesh, false)[0];
      if (!h?.face) return null;
      inv.copy(built.mesh.matrixWorld).invert(); local.copy(h.point).applyMatrix4(inv);
      let best = h.face.a, bd = Infinity;
      for (const v of [h.face.a, h.face.b, h.face.c]) { const dd = (pos.getX(v) - local.x) ** 2 + (pos.getY(v) - local.y) ** 2 + (pos.getZ(v) - local.z) ** 2; if (dd < bd) { bd = dd; best = v; } }
      const r = specimen.region[best], s = r ? manifest.structures[r - 1] : null;
      if (!s) return null;
      const parent = tree.get(s.id)?.parentId;
      return { id: s.id, name: s.name, hemisphere: s.hemisphere, tissue: s.tissue, group: parent ? tree.get(parent)?.name ?? null : null, enterable: ENTERABLE.has(s.id) };
    };
    const project = (v: number) => {
      const p = new Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(DISPLAY).project(camera), rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, ok: Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.94 && p.z < 1 };
    };
    brain.api = {
      dive: (reduced) => new Promise((resolve) => { const to = closeTo(); if (!to) { resolve(); return; } userMoved.current = false; go(to, reduced ? 0 : 1700, resolve); }),
      rise: (reduced) => new Promise((resolve) => { const from = closeTo(); if (from && !reduced) { orbit.current = from; dirty.current = true; } userMoved.current = false; go(homeOrbit(), reduced ? 0 : 1500, resolve); }),
      home: () => { userMoved.current = false; vel.current = { az: 0, el: 0 }; go(homeOrbit(), 700); },
      nudge: (dAz, dEl, zoom = 1) => {
        if (tween.current) return;
        const o = orbit.current, f = fit();
        o.az += dAz; o.el = Math.max(-1.35, Math.min(1.35, o.el + dEl)); o.dist = Math.max(f * 0.42, Math.min(f * 1.5, o.dist * zoom));
        userMoved.current = true; dirty.current = true; invalidate(); useJourney.getState().tick('arrive');
      },
      face: (id) => {
        const r = built.indexOf.get(id), list = r ? built.samples.get(r) : null;
        if (!list?.length) return;
        const c = new Vector3();
        for (const v of list) c.add(new Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)));
        const out = c.multiplyScalar(1 / list.length).applyMatrix4(DISPLAY).sub(built.centre).normalize();
        userMoved.current = true;
        go({ az: Math.atan2(out.x, out.z), el: Math.asin(Math.max(-0.9, Math.min(0.9, out.y))) * 0.8 + 0.12, dist: fit(), target: built.centre.clone() }, 800);
      },
      pickAt,
      screenOf: (id) => {
        const r = built.indexOf.get(id);
        for (const v of (r && built.samples.get(r)) || []) { const p = project(v); if (p.ok && pickAt(p.x, p.y)?.id === id) return { x: p.x, y: p.y }; }
        return null;
      },
      state: () => {
        let y0 = Infinity, y1 = -Infinity;
        const rect = gl.domElement.getBoundingClientRect();
        for (let v = 0; v < pos.count; v += 211) { const p = project(v); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        return { az: orbit.current.az, el: orbit.current.el, dist: orbit.current.dist, moving: !!tween.current, coverage: (y1 - y0) / rect.height };
      },
    };
    // pointer: drag turns the brain, a click selects, moving names what is under the pointer
    const dom = gl.domElement;
    let down: { x: number; y: number; id: number; moved: boolean } | null = null, raf = 0, last: { x: number; y: number } | null = null;
    const hoverNow = () => { raf = 0; if (!last || mode !== 'stage') return; const hit = pickAt(last.x, last.y), cur = useJourney.getState().hoverRegion; if (cur?.id !== hit?.id) useJourney.setState({ hoverRegion: hit ? { id: hit.id, name: hit.name } : null }); useJourney.getState().tick('arrive'); };
    const pd = (e: PointerEvent) => { if (mode !== 'stage' || e.button !== 0 || tween.current) return; down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; vel.current = { az: 0, el: 0 }; try { dom.setPointerCapture(e.pointerId); } catch { /* gone */ } };
    const pm = (e: PointerEvent) => {
      if (mode !== 'stage') return;
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) < 4) return;
        down.moved = true; down.x = e.clientX; down.y = e.clientY; userMoved.current = true;
        const o = orbit.current, k = 0.0052;
        vel.current = { az: -dx * k * 0.35, el: dy * k * 0.35 };
        o.az -= dx * k; o.el = Math.max(-1.35, Math.min(1.35, o.el + dy * k));
        dirty.current = true; invalidate();
        if (useJourney.getState().hoverRegion) useJourney.setState({ hoverRegion: null });
        useJourney.getState().tick('arrive');
        return;
      }
      if (e.pointerType === 'touch' || e.buttons !== 0) return;
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(hoverNow);
    };
    const pu = (e: PointerEvent) => {
      const d = down; down = null;
      try { dom.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (!d || d.moved || mode !== 'stage') return;
      const hit = pickAt(e.clientX, e.clientY);
      useJourney.setState({ region: hit && hit.id !== useJourney.getState().region?.id ? hit : hit ? useJourney.getState().region : null });
    };
    const leave = () => { last = null; if (useJourney.getState().hoverRegion) useJourney.setState({ hoverRegion: null }); };
    const wheel = (e: WheelEvent) => { if (mode !== 'stage' || tween.current) return; e.preventDefault(); const o = orbit.current, f = fit(); o.dist = Math.max(f * 0.42, Math.min(f * 1.5, o.dist * Math.exp(e.deltaY * 0.0011))); userMoved.current = true; dirty.current = true; invalidate(); };
    dom.addEventListener('pointerdown', pd); dom.addEventListener('pointermove', pm); dom.addEventListener('pointerup', pu); dom.addEventListener('pointercancel', leave); dom.addEventListener('pointerleave', leave);
    dom.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf); brain.api = null;
      dom.removeEventListener('pointerdown', pd); dom.removeEventListener('pointermove', pm); dom.removeEventListener('pointerup', pu); dom.removeEventListener('pointercancel', leave); dom.removeEventListener('pointerleave', leave);
      dom.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, camera, gl, manifest, specimen, tree, mode, size.width, size.height]);

  return (
    <>
      <primitive object={built.root} />
      {built.site && (
        <group ref={marker} position={built.site.p} onUpdate={(g) => g.lookAt(built.site!.p.clone().add(built.site!.n))}>
          <mesh position={[0, 0, 0.0009]} renderOrder={5}><ringGeometry args={[mode === 'map' ? 0.0052 : 0.0026, mode === 'map' ? 0.0078 : 0.0034, 40]} /><meshBasicMaterial color={mode === 'map' ? '#7FE7FF' : '#FFC98A'} transparent opacity={0.95} toneMapped={false} depthTest={mode !== 'map'} /></mesh>
          <mesh position={[0, 0, 0.0009]} renderOrder={5}><circleGeometry args={[mode === 'map' ? 0.003 : 0.0011, 24]} /><meshBasicMaterial color={mode === 'map' ? '#EAFBFF' : '#FFE9CC'} toneMapped={false} depthTest={mode !== 'map'} /></mesh>
        </group>
      )}
    </>
  );
}

/** The brain as a full stage (`stage`) or as the small map shown inside the tissue (`map`). */
export function BrainStage({ mode, active }: { mode: 'stage' | 'map'; active: boolean }) {
  const status = useAtlas((s) => s.status), error = useAtlas((s) => s.error), progress = useAtlas((s) => s.progress);
  const hover = useJourney((s) => s.hoverRegion);
  const [ready, setReady] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null), tag = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const move = (e: PointerEvent) => { const t = tag.current, r = el.getBoundingClientRect(); if (t) t.style.transform = `translate(${Math.min(r.width - 240, Math.max(8, e.clientX - r.left + 16))}px, ${Math.min(r.height - 40, Math.max(8, e.clientY - r.top + 18))}px)`; };
    el.addEventListener('pointermove', move);
    return () => el.removeEventListener('pointermove', move);
  }, []);
  if (status === 'error') return <div className="jb-fallback" role="alert" data-testid="brain-error"><b>The brain atlas could not be loaded.</b><span>{error?.message}</span></div>;
  return (
    <div ref={wrap} className={`jb-stage jb-${mode}`} data-testid="brain-stage" data-ready={ready ? '1' : '0'} data-mode={mode}>
      {status === 'ready' && (
        <Canvas frameloop={active ? 'always' : 'demand'} dpr={mode === 'map' ? [1, 1.5] : [1, 2]} camera={{ fov: FOV, near: 0.005, far: 4, position: [-0.45, 0.2, -0.27] }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
          <Scene mode={mode} onReady={() => setReady(true)} />
        </Canvas>
      )}
      {!ready && <div className="jb-loading" role="status" data-testid="brain-loading">Loading the brain atlas{progress[1] ? ` · ${Math.round((100 * progress[0]) / progress[1])} %` : '…'}</div>}
      {mode === 'stage' && <div ref={tag} className="jb-tag" style={{ display: hover ? undefined : 'none' }} data-testid="brain-hover" aria-hidden="true"><b>{hover?.name}</b><span>atlas label</span></div>}
    </div>
  );
}

if (typeof window !== 'undefined') (window as unknown as { __brain?: unknown }).__brain = brain;
