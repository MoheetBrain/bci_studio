// The 3D atlas viewport: one mesh per source structure, demand-rendered, with picking that resolves a genuine
// structure id (never colour, bounding boxes or guesses). Display state comes from atlasStore; rules from visibility.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  Color, DirectionalLight, DoubleSide, FrontSide, Group, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial, Plane,
  Raycaster, Sphere, Spherical, Vector2, Vector3, type PerspectiveCamera,
} from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { useAtlas, type CameraCmd, type ColorMode } from './atlasStore';
import type { AtlasStructure, Tissue } from './types';
import { displayToRasMm, effective, rasMmToDisplay, resolvePick, type Clip, type Hit } from './visibility';

// ── colours ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Restrained "specimen" tones: one tissue family, small value steps. Not a data encoding (see the legend). */
export const SPECIMEN: Record<Tissue, string> = {
  cortex: '#D9C8B9', sulcus: '#94847A', 'white-matter': '#EEE7DB', cerebellum: '#CBB5A5', brainstem: '#CFBEAA',
  diencephalon: '#C4A491', 'basal-nuclei': '#BB9987', 'medial-temporal': '#C19F8E', commissure: '#E7DDCC', ventricle: '#93ABC0',
};
/** Optional categorical encoding by tissue class (legend shown while active). */
export const TISSUE_COLORS: Record<Tissue, string> = {
  cortex: '#CDBBAA', sulcus: '#5D5550', 'white-matter': '#EFE9DD', cerebellum: '#C28E5A', brainstem: '#9C7FB8',
  diencephalon: '#4F8FBF', 'basal-nuclei': '#8A9A45', 'medial-temporal': '#D0749A', commissure: '#E3C567', ventricle: '#7FB6D6',
};
export const SELECT_COLOR = '#176B62';
export const HOVER_COLOR = '#3FA89B';

function baseColor(s: AtlasStructure, mode: ColorMode): Color {
  if (mode === 'source' && s.sourceColor) {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s.sourceColor);
    if (m) return new Color().setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, 'srgb');
  }
  return new Color(mode === 'tissue' ? TISSUE_COLORS[s.tissue] : SPECIMEN[s.tissue]);
}

// ── display transform (viewer only): three (x, y, z) metres = (R, S, −A) mm / 1000 ────────────────────────────────
const DISPLAY = new Matrix4().set(
  0.001, 0, 0, 0,
  0, 0, 0.001, 0,
  0, -0.001, 0, 0,
  0, 0, 0, 1,
);

function clipPlane(clip: Clip): Plane | null {
  if (clip.axis === 'none') return null;
  const n = clip.axis === 'x' ? new Vector3(1, 0, 0) : clip.axis === 'y' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  const plane = new Plane(n, -clip.posMm / 1000);
  if (clip.keep === '-') plane.negate();
  return plane;
}

// ── performance samples, readable by the browser tests (window.__atlasPerf) ───────────────────────────────────────
export const atlasPerf = { pickMs: [] as number[], frameMs: [] as number[], bvhBuiltMs: 0, bvhCount: 0 };
function sample(arr: number[], v: number) { arr.push(v); if (arr.length > 600) arr.shift(); }

export interface GizmoAxes { r: [number, number, number]; a: [number, number, number]; s: [number, number, number] }

interface SceneApi {
  pick: (clientX: number, clientY: number) => Hit | null;
  /** Screen position (client px) of a visible surface point of a structure, or null when none is in view. */
  screenPointOf: (id: string) => { x: number; y: number } | null;
  /** Camera pose and whether a programmatic transition is in progress (diagnostics / tests). */
  cameraState: () => { transitioning: boolean; position: [number, number, number]; target: [number, number, number] };
}

function BrainScene({ onGizmo, apiRef }: { onGizmo: (g: GizmoAxes) => void; apiRef: React.MutableRefObject<SceneApi | null> }) {
  const { camera, gl, invalidate, scene, size } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const geometries = useAtlas((s) => s.geometries);
  const manifest = useAtlas((s) => s.manifest)!;

  // Build the mesh set once per loaded atlas.
  const { group, meshes, byId, home } = useMemo(() => {
    const group = new Group();
    group.name = 'atlas-ras-mm';
    group.matrixAutoUpdate = false;
    group.matrix.copy(DISPLAY);
    group.matrixWorldNeedsUpdate = true;
    const meshes: Mesh[] = [];
    const byId = new Map<string, Mesh>();
    for (const s of manifest.structures) {
      const g = geometries.get(s.id);
      if (!g) continue;
      const mat = new MeshStandardMaterial({ roughness: 0.82, metalness: 0, color: SPECIMEN[s.tissue] });
      const mesh = new Mesh(g, mat);
      mesh.name = s.id;
      mesh.userData.structure = s;
      mesh.userData.pickable = true;
      mesh.raycast = acceleratedRaycast;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes.push(mesh);
      byId.set(s.id, mesh);
    }
    // Home framing from the data bounds.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const s of manifest.structures) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.boundsMm[0][k]); hi[k] = Math.max(hi[k], s.boundsMm[1][k]); }
    const centre = new Vector3(...rasMmToDisplay([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]));
    const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2000;
    return { group, meshes, byId, home: { centre, radius } };
  }, [geometries, manifest]);

  // Lights: soft sky/ground fill plus a headlight that follows the camera, so no side of the specimen goes black.
  useEffect(() => {
    const hemi = new HemisphereLight('#ffffff', '#b8b0a6', 1.15);
    const key = new DirectionalLight('#ffffff', 1.9);
    key.position.set(-0.4, 0.6, 1);
    camera.add(key);
    scene.add(hemi, camera);
    return () => { camera.remove(key); scene.remove(hemi, camera); hemi.dispose(); key.dispose(); };
  }, [camera, scene]);

  useEffect(() => {
    gl.localClippingEnabled = true;
    return () => { for (const m of meshes) (m.material as MeshStandardMaterial).dispose(); };
  }, [gl, meshes]);

  // Picking acceleration: build one BVH per structure in idle slices (brute-force raycast is used until then).
  useEffect(() => {
    let cancelled = false, i = 0;
    const t0 = performance.now();
    const work = () => {
      if (cancelled) return;
      const sliceStart = performance.now();
      while (i < meshes.length && performance.now() - sliceStart < 8) {
        const g = meshes[i++].geometry as typeof meshes[number]['geometry'] & { boundsTree?: MeshBVH };
        if (!g.boundsTree) g.boundsTree = new MeshBVH(g);
        atlasPerf.bvhCount = i;
      }
      if (i < meshes.length) setTimeout(work, 0);
      else atlasPerf.bvhBuiltMs = performance.now() - t0;
    };
    const id = setTimeout(work, 50);
    return () => { cancelled = true; clearTimeout(id); };
  }, [meshes]);

  // Apply the display state imperatively (251 meshes; no React re-render per hover).
  useEffect(() => {
    const select = new Color(SELECT_COLOR), hover = new Color(HOVER_COLOR), black = new Color(0, 0, 0);
    const apply = () => {
      const st = useAtlas.getState();
      const d = st.display();
      const plane = clipPlane(st.clip);
      const hoverIds = new Set(st.hoverId ? st.idsOf(st.hoverId) : []);
      for (const mesh of meshes) {
        const s = mesh.userData.structure as AtlasStructure;
        const e = effective(s, d);
        const mat = mesh.material as MeshStandardMaterial;
        mesh.visible = e.visible;
        mesh.userData.pickable = e.pickable;
        if (!e.visible) continue;
        const isSel = d.selected.has(s.id), isHover = hoverIds.has(s.id);
        const c = baseColor(s, st.colorMode);
        if (isSel) c.lerp(select, 0.9); else if (isHover) c.lerp(hover, 0.6);
        mat.color.copy(c);
        mat.emissive.copy(isSel ? select : isHover ? hover : black).multiplyScalar(isSel ? 0.18 : isHover ? 0.22 : 0);
        const transparent = e.opacity < 0.999;
        if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
        mat.opacity = e.opacity;
        mat.depthWrite = !transparent;
        mesh.renderOrder = transparent ? 2 : 0;
        const side = plane ? DoubleSide : FrontSide;
        if (mat.side !== side) { mat.side = side; mat.needsUpdate = true; }
        const hadClip = (mat.clippingPlanes?.length ?? 0) > 0;
        mat.clippingPlanes = plane ? [plane] : [];
        if (hadClip !== !!plane) mat.needsUpdate = true;
      }
      invalidate();
    };
    apply();
    return useAtlas.subscribe((s, p) => { if (s.drawNonce !== p.drawNonce) apply(); });
  }, [meshes, invalidate]);

  // ── camera ────────────────────────────────────────────────────────────────────────────────────────────────────
  const cameraStateRef = useRef<null | (() => { transitioning: boolean; position: [number, number, number]; target: [number, number, number] })>(null);
  const tween = useRef<{ t0: number; ms: number; p0: Vector3; p1: Vector3; q0: Vector3; q1: Vector3 } | null>(null);
  const fov = (camera as PerspectiveCamera).fov;
  const fitDistance = (radius: number) => {
    const aspect = size.width / Math.max(1, size.height);
    const half = (fov * Math.PI) / 360;
    const fit = Math.min(half, Math.atan(Math.tan(half) * aspect));
    return (radius / Math.sin(fit)) * 1.12;
  };
  const homePose = () => {
    // Left antero-lateral view of the left hemisphere: the central sulcus and precentral gyrus face the viewer.
    const dir = new Vector3(-0.86, 0.34, -0.38).normalize();
    return { pos: home.centre.clone().addScaledVector(dir, fitDistance(home.radius)), target: home.centre.clone() };
  };
  const go = (pos: Vector3, target: Vector3) => {
    const c = controls.current;
    if (!c) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { camera.position.copy(pos); c.target.copy(target); c.update(); invalidate(); return; }
    tween.current = { t0: performance.now(), ms: 520, p0: camera.position.clone(), p1: pos, q0: c.target.clone(), q1: target };
    invalidate();
  };

  // First frame: home pose without animation.
  useEffect(() => {
    const { pos, target } = homePose();
    camera.position.copy(pos);
    camera.near = 0.01; camera.far = 5;
    camera.updateProjectionMatrix();
    if (controls.current) { controls.current.target.copy(target); controls.current.update(); }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  useEffect(() => useAtlas.subscribe((s, p) => {
    if (!s.cameraCmd || s.cameraCmd === p.cameraCmd) return;
    const cmd: CameraCmd = s.cameraCmd;
    const c = controls.current;
    if (!c) return;
    const dirNow = camera.position.clone().sub(c.target).normalize();
    if (cmd.kind === 'reset') { const h = homePose(); go(h.pos, h.target); return; }
    if (cmd.kind === 'view') {
      const dirs: Record<string, [number, number, number]> = {
        left: [-1, 0.0001, 0], right: [1, 0.0001, 0], superior: [0, 1, 0.0015], inferior: [0, -1, -0.0015], anterior: [0, 0.0001, -1], posterior: [0, 0.0001, 1],
      };
      const dir = new Vector3(...dirs[cmd.view]).normalize();
      go(home.centre.clone().addScaledVector(dir, fitDistance(home.radius)), home.centre.clone());
      return;
    }
    if (cmd.kind === 'fit') {
      const sph = new Sphere();
      let first = true;
      for (const id of cmd.ids) {
        const m = byId.get(id);
        if (!m?.geometry.boundingSphere) continue;
        const b = m.geometry.boundingSphere.clone().applyMatrix4(DISPLAY);
        if (first) { sph.copy(b); first = false; } else sph.union(b);
      }
      if (first) return;
      // Keep the current viewing direction so the user keeps their bearings; show some surrounding context.
      go(sph.center.clone().addScaledVector(dirNow, fitDistance(Math.max(sph.radius * 1.9, 0.03))), sph.center.clone());
      return;
    }
    if (cmd.kind === 'orbit') {
      tween.current = null;
      const sp = new Spherical().setFromVector3(camera.position.clone().sub(c.target));
      sp.theta += cmd.dAz; sp.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sp.phi + cmd.dPolar));
      camera.position.copy(c.target).add(new Vector3().setFromSpherical(sp));
      c.update(); invalidate();
      return;
    }
    if (cmd.kind === 'zoom') {
      tween.current = null;
      const v = camera.position.clone().sub(c.target);
      v.setLength(Math.max(0.04, Math.min(2.2, v.length() * cmd.factor)));
      camera.position.copy(c.target).add(v);
      c.update(); invalidate();
    }
  }), [byId, camera, home, invalidate, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastFrame = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (lastFrame.current && now - lastFrame.current < 250) sample(atlasPerf.frameMs, now - lastFrame.current);
    lastFrame.current = now;
    const tw = tween.current, c = controls.current;
    if (tw && c) {
      const k = Math.min(1, (now - tw.t0) / tw.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(tw.p0, tw.p1, e);
      c.target.lerpVectors(tw.q0, tw.q1, e);
      c.update();
      if (k >= 1) tween.current = null; else invalidate();
    }
    // Orientation gizmo: where the anatomical axes point on screen.
    const m = camera.matrixWorldInverse;
    const ax = (x: number, y: number, z: number): [number, number, number] => {
      const v = new Vector3(x, y, z).transformDirection(m);
      return [v.x, v.y, v.z];
    };
    onGizmo({ r: ax(1, 0, 0), a: ax(0, 0, -1), s: ax(0, 1, 0) });
  });

  // ── picking ───────────────────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ray = new Raycaster() as Raycaster & { firstHitOnly?: boolean };
    const ndc = new Vector2();
    const cast = (clientX: number, clientY: number, only?: Mesh[]): Hit | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const clip = useAtlas.getState().clip;
      ray.firstHitOnly = clip.axis === 'none';
      const targets = only ?? meshes.filter((m) => m.visible && m.userData.pickable);
      const hits = ray.intersectObjects(targets, false).map((h): Hit => ({
        id: h.object.name, distance: h.distance, pointRasMm: displayToRasMm([h.point.x, h.point.y, h.point.z]),
      }));
      return resolvePick(hits, clip);
    };
    apiRef.current = {
      cameraState: () => cameraStateRef.current?.() ?? { transitioning: false, position: [0, 0, 0], target: [0, 0, 0] },
      pick: (x, y) => {
        const t0 = performance.now();
        const hit = cast(x, y);
        sample(atlasPerf.pickMs, performance.now() - t0);
        return hit;
      },
      screenPointOf: (id) => {
        const mesh = byId.get(id);
        if (!mesh || !mesh.visible) return null;
        const pos = mesh.geometry.getAttribute('position');
        const rect = gl.domElement.getBoundingClientRect();
        const v = new Vector3();
        const step = Math.max(1, Math.floor(pos.count / 400));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(DISPLAY).project(camera);
          if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.96 || Math.abs(v.y) > 0.96) continue;
          const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
          if (cast(x, y)?.id === id) return { x, y };
        }
        return null;
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, byId, camera, gl, meshes]);
  useEffect(() => {
    cameraStateRef.current = () => ({
      transitioning: tween.current !== null,
      position: camera.position.toArray() as [number, number, number],
      target: (controls.current?.target.toArray() ?? [0, 0, 0]) as [number, number, number],
    });
    return () => { cameraStateRef.current = null; };
  }, [camera]);

  return (
    <>
      <primitive object={group} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={0.04}
        maxDistance={2.2}
        zoomSpeed={0.9}
        rotateSpeed={0.85}
        onStart={() => { tween.current = null; /* user input always interrupts a camera transition */ }}
      />
    </>
  );
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The atlas viewport with pointer / touch / keyboard interaction and the hover name tag. */
export function AtlasViewport({ onGizmo }: { onGizmo: (g: GizmoAxes) => void }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const tag = useRef<HTMLDivElement | null>(null);
  const api = useRef<SceneApi | null>(null);
  const [webgl] = useState(webglAvailable);
  const [lost, setLost] = useState(false);
  const hoverId = useAtlas((s) => s.hoverId);
  const hoverSource = useAtlas((s) => s.hoverSource);
  const hoverName = useAtlas((s) => s.nameOf(s.hoverId));
  const hoverParent = useAtlas((s) => {
    const n = s.hoverId ? s.tree.get(s.hoverId) : null;
    return n?.parentId ? s.tree.get(n.parentId)?.name ?? null : null;
  });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let raf = 0, last: { x: number; y: number } | null = null;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let dragging = false;
    const place = (x: number, y: number) => {
      const t = tag.current;
      if (!t) return;
      const r = el.getBoundingClientRect();
      const tx = Math.min(r.width - 12, Math.max(12, x - r.left + 14));
      const ty = Math.min(r.height - 12, Math.max(12, y - r.top + 16));
      t.style.transform = `translate(${tx}px, ${ty}px)`;
    };
    const doHover = () => {
      raf = 0;
      if (!last || !api.current) return;
      const hit = api.current.pick(last.x, last.y);
      useAtlas.getState().hover(hit ? hit.id : null, 'scene');
      place(last.x, last.y);
    };
    const move = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) dragging = true;
      if (e.pointerType === 'touch' || dragging || e.buttons !== 0) return;
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(doHover);
    };
    const leave = () => { last = null; useAtlas.getState().hover(null); };
    const pdown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; dragging = false; };
    const pup = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId || dragging || performance.now() - d.t > 600 || e.button !== 0) { dragging = false; return; }
      // A tap / click (not a drag): select what is under the pointer, or clear on empty space.
      const hit = api.current?.pick(e.clientX, e.clientY) ?? null;
      const st = useAtlas.getState();
      st.select(hit ? hit.id : null);
      // Keep the name tag in step with what was just picked (touch has no hover; a click may arrive without a move).
      st.hover(hit ? hit.id : null, 'scene');
      place(e.clientX, e.clientY);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointerup', pup);
    el.addEventListener('pointercancel', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', pdown);
      el.removeEventListener('pointerup', pup);
      el.removeEventListener('pointercancel', leave);
    };
  }, []);

  // Test / diagnostics hooks (no production behaviour depends on them).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__atlas = {
      store: useAtlas,
      screenPointOf: (id: string) => api.current?.screenPointOf(id) ?? null,
      pickAt: (x: number, y: number) => api.current?.pick(x, y) ?? null,
      cameraState: () => api.current?.cameraState() ?? null,
    };
    w.__atlasPerf = atlasPerf;
    return () => { delete w.__atlas; delete w.__atlasPerf; };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const st = useAtlas.getState();
    const step = e.shiftKey ? 0.05 : 0.2;
    const k = e.key;
    if (k === 'ArrowLeft') st.camera({ kind: 'orbit', dAz: -step, dPolar: 0 });
    else if (k === 'ArrowRight') st.camera({ kind: 'orbit', dAz: step, dPolar: 0 });
    else if (k === 'ArrowUp') st.camera({ kind: 'orbit', dAz: 0, dPolar: -step });
    else if (k === 'ArrowDown') st.camera({ kind: 'orbit', dAz: 0, dPolar: step });
    else if (k === '+' || k === '=') st.camera({ kind: 'zoom', factor: 0.85 });
    else if (k === '-' || k === '_') st.camera({ kind: 'zoom', factor: 1 / 0.85 });
    else if (k === '0' || k === 'r' || k === 'R') st.camera({ kind: 'reset' });
    else if ((k === 'f' || k === 'F') && st.selectedId) st.camera({ kind: 'fit', ids: st.selectionIds() });
    else if (k === ']' || k === 'n') st.step(1);
    else if (k === '[' || k === 'p') st.step(-1);
    else if (k === 'Escape') st.select(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (!webgl || lost) {
    return (
      <div className="atlas-fallback" role="alert" data-testid="atlas-webgl-fallback">
        <strong>{lost ? 'The 3D graphics context was lost.' : '3D graphics (WebGL) are not available in this browser.'}</strong>
        <p>The brain cannot be drawn here, and no substitute picture is shown in its place. The structure list, search and explanations on this page still work.</p>
        {lost && <button className="btn" onClick={() => setLost(false)}>Try again</button>}
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      className="atlas-viewport"
      tabIndex={0}
      role="application"
      aria-label="3D brain atlas. Arrow keys rotate, plus and minus zoom, F fits the selection, 0 resets the view, square brackets step through structures, Escape clears the selection."
      aria-describedby="atlas-live"
      onKeyDown={onKey}
      data-testid="atlas-viewport"
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.01, far: 5, position: [-0.45, 0.18, -0.2] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); setLost(true); });
        }}
      >
        <BrainScene onGizmo={onGizmo} apiRef={api} />
      </Canvas>
      <div
        ref={tag}
        className="atlas-tag"
        style={{ display: hoverId && hoverSource === 'scene' ? undefined : 'none' }}
        data-testid="atlas-hover-tag"
        aria-hidden="true"
      >
        <span className="atlas-tag-name">{hoverName}</span>
        {hoverParent && <span className="atlas-tag-parent">{hoverParent}</span>}
      </div>
    </div>
  );
}
