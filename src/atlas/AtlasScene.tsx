// The 3D atlas stage. Demand-rendered. Two representations of one anatomy are drawn (see visibility.ts):
// the continuous MRI-derived shell (looks + surface picking) and the atlas's per-structure meshes (anything beneath).
// Picking always resolves a genuine structure id: from the label-volume region of the shell vertex that was hit,
// from the mesh that was hit, or from the label voxel under the pointer on the MRI slice.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  ACESFilmicToneMapping, BufferAttribute, BufferGeometry, Color, Data3DTexture, DirectionalLight, DoubleSide, Group, HemisphereLight, LinearFilter,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, NearestFilter, Plane, Raycaster, RedFormat,
  ShaderMaterial, Sphere, Spherical, UnsignedByteType, Vector2, Vector3, Vector4, type PerspectiveCamera,
} from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { cameraFrom, useAtlas, type CameraCmd } from './atlasStore';
import type { Tissue } from './types';
import { colourRegions, parcelFields, selectionField } from './surfaceFields';
import { displayToRasMm, plan, rasMmToDisplay, regionAt, resolvePick, shellMode, type Clip, type Hit } from './visibility';
import { ghostDepthMaterial, ghostMaterial, makeStateTexture, setClip, SLICE_FRAG, SLICE_VERT, specimenMaterial, structureMaterial, SELECT_COLOR, HOVER_COLOR } from './tissue';

/** Which rendering is shown. 'tissue' is the product; the others exist only for same-camera comparison captures. */
export type Look = 'tissue' | 'pbr' | 'legacy';

const LEGACY_TONES: Record<Tissue, string> = {
  cortex: '#D9C8B9', sulcus: '#94847A', 'white-matter': '#EEE7DB', cerebellum: '#CBB5A5', brainstem: '#CFBEAA',
  diencephalon: '#C4A491', 'basal-nuclei': '#BB9987', 'medial-temporal': '#C19F8E', commissure: '#E7DDCC', ventricle: '#93ABC0',
};

// display transform (viewer only): three (x, y, z) metres = (R, S, −A) mm / 1000
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

// performance samples, readable by the browser tests (window.__atlasPerf)
export const atlasPerf = { pickMs: [] as number[], frameMs: [] as number[], bvhBuiltMs: 0, bvhCount: 0, frames: 0 };
function sample(arr: number[], v: number) { arr.push(v); if (arr.length > 600) arr.shift(); }

export interface GizmoAxes { r: [number, number, number]; a: [number, number, number]; s: [number, number, number] }
export interface CameraState { transitioning: boolean; position: [number, number, number]; target: [number, number, number] }

interface SceneApi {
  pick: (clientX: number, clientY: number) => Hit | null;
  /** Screen position (client px) of a visible, pickable point of a structure, or null when none is in view. */
  screenPointOf: (id: string) => { x: number; y: number } | null;
  cameraState: () => CameraState;
  /** Fraction of the canvas height / width covered by the specimen's silhouette box (for framing checks). */
  coverage: () => { w: number; h: number };
}

function BrainScene({ onGizmo, apiRef, look }: { onGizmo: (g: GizmoAxes) => void; apiRef: React.MutableRefObject<SceneApi | null>; look: Look }) {
  const { camera, gl, invalidate, scene, size } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const geometries = useAtlas((s) => s.geometries);
  const manifest = useAtlas((s) => s.manifest)!;
  const specimen = useAtlas((s) => s.specimen)!;
  const sliceData = useAtlas((s) => s.slices.data);

  const built = useMemo(() => {
    const root = new Group();
    root.name = 'atlas-ras-mm';
    root.matrixAutoUpdate = false;
    root.matrix.copy(DISPLAY);
    root.matrixWorldNeedsUpdate = true;
    const state = makeStateTexture();

    const shell = new Mesh(specimen.geometry, specimenMaterial(state));
    shell.name = 'shell';
    shell.raycast = acceleratedRaycast;
    shell.matrixAutoUpdate = false;
    const ghost = new Mesh(specimen.geometry, ghostMaterial(state));
    ghost.name = 'ghost';
    ghost.renderOrder = 4;
    ghost.matrixAutoUpdate = false;
    ghost.visible = false;
    const ghostDepth = new Mesh(specimen.geometry, ghostDepthMaterial(ghost.material as ShaderMaterial));
    ghostDepth.name = 'ghost-depth';
    ghostDepth.renderOrder = 3;
    ghostDepth.matrixAutoUpdate = false;
    ghost.add(ghostDepth);
    root.add(shell, ghost);

    const meshes: Mesh[] = [];
    const byId = new Map<string, Mesh>();
    for (const s of manifest.structures) {
      const g = geometries.get(s.id);
      if (!g) continue;
      const mesh = new Mesh(g, structureMaterial(s.tissue));
      mesh.name = s.id;
      mesh.userData.structure = s;
      mesh.raycast = acceleratedRaycast;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      root.add(mesh);
      meshes.push(mesh);
      byId.set(s.id, mesh);
    }

    // comparison-only renderings (never used by the product UI)
    const alt = new Group();
    alt.visible = false;
    if (look === 'legacy') {
      for (const s of manifest.structures) {
        const g = geometries.get(s.id);
        if (g) alt.add(new Mesh(g, new MeshStandardMaterial({ roughness: 0.82, metalness: 0, color: LEGACY_TONES[s.tissue] })));
      }
    } else if (look === 'pbr') {
      const g = specimen.geometry.clone();
      const ao = g.getAttribute('aAo');
      const col = new Float32Array(ao.count * 3);
      const deep = new Color('#5B2447'), white = new Color('#FFFFFF'), c = new Color();
      for (let i = 0; i < ao.count; i++) { c.copy(deep).lerp(white, Math.min(1, Math.max(0, (ao.getX(i) - 0.08) / 0.72))); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new BufferAttribute(col, 3));
      alt.add(new Mesh(g, new MeshPhysicalMaterial({ color: '#E89AAE', roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.7, sheenColor: new Color('#B9A6FF'), sheenRoughness: 0.5, vertexColors: true })));
    }
    root.add(alt);

    // the MRI on the cut face
    const sliceGeom = new BufferGeometry();
    sliceGeom.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    sliceGeom.setIndex([0, 1, 2, 0, 2, 3]);
    const sliceMat = new ShaderMaterial({
      vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG, side: DoubleSide, toneMapped: false, transparent: true,
      uniforms: {
        uT1: { value: null }, uRegion: { value: null }, uState: { value: state }, uOrigin: { value: new Vector3() }, uDims: { value: new Vector3(1, 1, 1) },
        uSelCol: { value: new Vector3(...new Color(SELECT_COLOR).toArray()) }, uHovCol: { value: new Vector3(...new Color(HOVER_COLOR).toArray()) }, uDim: { value: 0 },
      },
    });
    const slice = new Mesh(sliceGeom, sliceMat);
    slice.name = 'mri-slice';
    slice.visible = false;
    slice.frustumCulled = false;
    slice.matrixAutoUpdate = false;
    root.add(slice);

    // framing from the data bounds
    const [lo, hi] = specimen.meta.mesh.boundsMm;
    const centre = new Vector3(...rasMmToDisplay([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]));
    const extent = { r: (hi[0] - lo[0]) / 1000, a: (hi[1] - lo[1]) / 1000, s: (hi[2] - lo[2]) / 1000 };
    const radius = Math.hypot(extent.r, extent.a, extent.s) / 2;

    // a quiet measurement ring under the specimen: ⌀ 200 mm, ticks every 10°, long ticks at the anatomical axes
    const ringPos: number[] = [];
    const y = lo[2] / 1000 - 0.012, R = 0.1;
    for (let i = 0; i < 180; i++) {
      const a0 = (i / 180) * Math.PI * 2, a1 = ((i + 1) / 180) * Math.PI * 2;
      ringPos.push(centre.x + R * Math.cos(a0), y, centre.z + R * Math.sin(a0), centre.x + R * Math.cos(a1), y, centre.z + R * Math.sin(a1));
    }
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, len = i % 9 === 0 ? 0.012 : 0.004;
      ringPos.push(centre.x + R * Math.cos(a), y, centre.z + R * Math.sin(a), centre.x + (R + len) * Math.cos(a), y, centre.z + (R + len) * Math.sin(a));
    }
    const ringGeom = new BufferGeometry();
    ringGeom.setAttribute('position', new BufferAttribute(new Float32Array(ringPos), 3));
    const ring = new LineSegments(ringGeom, new LineBasicMaterial({ color: '#6FA8D8', transparent: true, opacity: 0.32, depthWrite: false }));
    ring.name = 'scale-ring';

    // per-region vertex samples of the shell (for the test hook that finds a visible point of a structure)
    const regionVerts = new Map<number, number[]>();
    for (let v = 0; v < specimen.region.length; v += 7) { const r = specimen.region[v]; if (r) { let l = regionVerts.get(r); if (!l) regionVerts.set(r, (l = [])); if (l.length < 400) l.push(v); } }
    const indexOfId = new Map(manifest.structures.map((s, i) => [s.id, i + 1]));
    return { root, state, shell, ghost, meshes, byId, alt, slice, ring, home: { centre, radius, extent }, regionVerts, indexOfId };
  }, [geometries, manifest, specimen, look]);
  const { root, state, shell, ghost, meshes, byId, alt, slice, ring, home, regionVerts, indexOfId } = built;

  // lights are only needed by the comparison renderings; the tissue shader carries its own camera-relative rig
  useEffect(() => {
    if (look === 'tissue') return;
    const hemi = new HemisphereLight('#ffffff', '#b8b0a6', look === 'legacy' ? 1.15 : 0.55);
    const key = new DirectionalLight('#ffffff', look === 'legacy' ? 1.9 : 2.6);
    key.position.set(-0.4, 0.6, 1);
    camera.add(key);
    const extra: DirectionalLight[] = [];
    if (look === 'pbr') {
      const rim = new DirectionalLight('#59B8FF', 2.4); rim.position.set(-0.8, 0.3, -0.52);
      const fill = new DirectionalLight('#FF4F8E', 0.7); fill.position.set(0.85, -0.25, 0.46);
      camera.add(rim, fill); extra.push(rim, fill);
    }
    scene.add(hemi, camera);
    return () => { camera.remove(key, ...extra); scene.remove(hemi, camera); hemi.dispose(); key.dispose(); extra.forEach((l) => l.dispose()); };
  }, [camera, scene, look]);

  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    return () => {
      (shell.material as ShaderMaterial).dispose(); (ghost.material as ShaderMaterial).dispose(); ((ghost.children[0] as Mesh).material as ShaderMaterial).dispose(); state.dispose();
      for (const m of meshes) (m.material as ShaderMaterial).dispose();
      (slice.material as ShaderMaterial).dispose(); slice.geometry.dispose(); ring.geometry.dispose(); (ring.material as LineBasicMaterial).dispose();
    };
  }, [gl, shell, ghost, state, meshes, slice, ring]);

  // picking acceleration: the shell at once, the structure meshes in idle slices
  useEffect(() => {
    let cancelled = false, i = 0;
    const t0 = performance.now();
    const sg = shell.geometry as BufferGeometry & { boundsTree?: MeshBVH };
    if (!sg.boundsTree) sg.boundsTree = new MeshBVH(sg);
    const work = () => {
      if (cancelled) return;
      const sliceStart = performance.now();
      while (i < meshes.length && performance.now() - sliceStart < 8) {
        const g = meshes[i++].geometry as BufferGeometry & { boundsTree?: MeshBVH };
        if (!g.boundsTree) g.boundsTree = new MeshBVH(g);
        atlasPerf.bvhCount = i;
      }
      if (i < meshes.length) setTimeout(work, 0);
      else atlasPerf.bvhBuiltMs = performance.now() - t0;
    };
    const id = setTimeout(work, 30);
    return () => { cancelled = true; clearTimeout(id); };
  }, [meshes, shell]);

  // MRI volumes → 3D textures, once
  useEffect(() => {
    if (!sliceData) return;
    const [w, h, d] = sliceData.dims;
    const mk = (data: Uint8Array, filter: typeof LinearFilter | typeof NearestFilter) => {
      const t = new Data3DTexture(data, w, h, d);
      t.format = RedFormat; t.type = UnsignedByteType; t.minFilter = filter; t.magFilter = filter; t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true;
      return t;
    };
    const t1 = mk(sliceData.t1, LinearFilter), reg = mk(sliceData.region, NearestFilter);
    const u = (slice.material as ShaderMaterial).uniforms;
    u.uT1.value = t1; u.uRegion.value = reg;
    u.uOrigin.value.set(...sliceData.originMm); u.uDims.value.set(w, h, d);
    useAtlas.setState((s) => ({ drawNonce: s.drawNonce + 1 }));
    return () => { t1.dispose(); reg.dispose(); u.uT1.value = null; u.uRegion.value = null; };
  }, [sliceData, slice]);

  // apply the display state imperatively (no React re-render per hover)
  const planCache = useRef(new Map<string, boolean>());
  const selKey = useRef('\u0000');
  const parcelsReady = useRef(false);
  useEffect(() => {
    const apply = () => {
      const st = useAtlas.getState();
      const d = st.display();
      const mode = shellMode(d);
      const plane = look === 'tissue' ? clipPlane(st.clip) : null;
      const hoverIds = new Set(st.hoverId ? st.idsOf(st.hoverId) : []);
      const data = state.image.data as Uint8Array;
      let selOnSurface = false;
      planCache.current.clear();
      manifest.structures.forEach((s, i) => {
        const p = plan(s, d);
        const sel = d.selected.has(s.id), hov = hoverIds.has(s.id);
        if (sel && d.onSurface.has(s.id)) selOnSurface = true;
        const o = (i + 1) * 4;
        data[o] = sel ? 255 : 0; data[o + 1] = hov ? 255 : 0; data[o + 2] = p.visible ? 255 : 0;
        planCache.current.set(s.id, p.pickable);
        const mesh = byId.get(s.id);
        if (mesh) {
          mesh.visible = look === 'tissue' && p.mesh;
          const u = (mesh.material as ShaderMaterial).uniforms;
          (u.uRegionState.value as Vector4).set(sel ? 1 : 0, hov ? 1 : 0, 1, 0);
          u.uDim.value = d.selected.size > 0 && !sel ? 0.55 : 0;
          setClip(mesh.material as ShaderMaterial, plane);
        }
      });
      state.needsUpdate = true;
      // smoothed selection mask on the surface (recomputed only when the selection changes)
      const key = [...d.selected].sort().join('|');
      if (key !== selKey.current) {
        selKey.current = key;
        const flags = new Uint8Array(256);
        manifest.structures.forEach((s, i) => { if (d.selected.has(s.id)) flags[i + 1] = 1; });
        const attr = specimen.geometry.getAttribute('aSelW') as BufferAttribute;
        selectionField(specimen.region, flags, specimen.adj, 4, attr.array as Uint8Array);
        attr.needsUpdate = true;
      }
      // region-class fields for the border lines (computed the first time the Regions view is opened)
      if (st.viewMode === 'parcels' && !parcelsReady.current) {
        parcelsReady.current = true;
        const { classOf } = colourRegions(specimen.region, specimen.adj);
        const f = parcelFields(specimen.region, classOf, specimen.adj, 3);
        const pa = specimen.geometry.getAttribute('aParcelA') as BufferAttribute, pb = specimen.geometry.getAttribute('aParcelB') as BufferAttribute;
        const A = pa.array as Uint8Array, B = pb.array as Uint8Array;
        for (let v = 0, n = specimen.region.length; v < n; v++) { A.set(f.subarray(v * 8, v * 8 + 4), v * 4); B.set(f.subarray(v * 8 + 4, v * 8 + 8), v * 4); }
        pa.needsUpdate = true; pb.needsUpdate = true;
      }
      const su = (shell.material as ShaderMaterial).uniforms, gu = (ghost.material as ShaderMaterial).uniforms;
      shell.visible = look === 'tissue' && mode === 'solid';
      ghost.visible = look === 'tissue' && mode === 'ghost';
      alt.visible = look !== 'tissue';
      su.uDim.value = selOnSurface ? 1 : 0;
      su.uParcels.value = st.viewMode === 'parcels' ? 1 : 0;
      (su.uHemi.value as Vector2).set(d.hemi.left ? 1 : 0, d.hemi.right ? 1 : 0);
      (gu.uHemi.value as Vector2).set(d.hemi.left ? 1 : 0, d.hemi.right ? 1 : 0);
      gu.uStrength.value = st.viewMode === 'xray' ? 1 : 0.8;
      setClip(shell.material as ShaderMaterial, plane);
      setClip(ghost.material as ShaderMaterial, plane);
      setClip((ghost.children[0] as Mesh).material as ShaderMaterial, plane);

      // the MRI on the cut
      const vol = st.slices.data;
      slice.visible = look === 'tissue' && st.viewMode === 'slice' && st.clip.axis !== 'none' && !!vol && !!(slice.material as ShaderMaterial).uniforms.uT1.value;
      if (slice.visible && vol) {
        const o = vol.originMm, e = [o[0] + vol.dims[0] - 1, o[1] + vol.dims[1] - 1, o[2] + vol.dims[2] - 1], p = st.clip.posMm;
        const q = st.clip.axis === 'x' ? [[p, o[1], o[2]], [p, e[1], o[2]], [p, e[1], e[2]], [p, o[1], e[2]]]
          : st.clip.axis === 'y' ? [[o[0], p, o[2]], [e[0], p, o[2]], [e[0], p, e[2]], [o[0], p, e[2]]]
          : [[o[0], o[1], p], [e[0], o[1], p], [e[0], e[1], p], [o[0], e[1], p]];
        const attr = slice.geometry.getAttribute('position') as BufferAttribute;
        q.forEach((v, i) => attr.setXYZ(i, v[0], v[1], v[2]));
        attr.needsUpdate = true;
        (slice.material as ShaderMaterial).uniforms.uDim.value = d.selected.size > 0 ? 1 : 0;
      }
      invalidate();
    };
    apply();
    return useAtlas.subscribe((s, p) => { if (s.drawNonce !== p.drawNonce) apply(); });
  }, [manifest, state, shell, ghost, alt, slice, byId, invalidate, look]);

  // ── camera ────────────────────────────────────────────────────────────────────────────────────────────────────
  const tween = useRef<{ t0: number; ms: number; p0: Vector3; p1: Vector3; q0: Vector3; q1: Vector3 } | null>(null);
  const inset = useRef(0);
  /** True while the camera still sits on the opening shot, so a window resize can re-compose it. */
  const atHome = useRef(true);
  const fov = (camera as PerspectiveCamera).fov;
  /** Distance at which a box of the given on-screen width / height (metres) fills the stated share of the free stage. */
  const frameDistance = (w: number, h: number, fillW = 0.82, fillH = 0.74) => {
    const t = Math.tan((fov * Math.PI) / 360);
    const freeW = Math.max(200, size.width - useAtlas.getState().insetRight);
    const aspect = freeW / Math.max(1, size.height);
    return Math.max(h / 2 / fillH / t, w / 2 / fillW / (t * aspect) * (size.width / freeW));
  };
  const homePose = () => {
    // left antero-lateral, slightly from above: the central sulcus and the precentral gyrus face the viewer
    const dir = new Vector3(-0.80, 0.36, -0.48).normalize();
    const w = Math.hypot(home.extent.a * 0.95, home.extent.r * 0.45), h = home.extent.s * 1.02;
    return { pos: home.centre.clone().addScaledVector(dir, frameDistance(w, h)), target: home.centre.clone() };
  };
  const go = (pos: Vector3, target: Vector3, instant = false) => {
    const c = controls.current;
    if (!c) return;
    const reduce = instant || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { tween.current = null; camera.position.copy(pos); c.target.copy(target); c.update(); invalidate(); return; }
    tween.current = { t0: performance.now(), ms: 720, p0: camera.position.clone(), p1: pos, q0: c.target.clone(), q1: target };
    invalidate();
  };

  useEffect(() => {
    const { pos, target } = homePose();
    camera.position.copy(pos);
    camera.near = 0.01; camera.far = 6;
    camera.updateProjectionMatrix();
    if (controls.current) { controls.current.target.copy(target); controls.current.update(); }
    atHome.current = true;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  // keep the opening shot composed when the stage changes size (until the user has moved the camera)
  useEffect(() => {
    if (!atHome.current || !controls.current) return;
    const { pos, target } = homePose();
    tween.current = null;
    camera.position.copy(pos); controls.current.target.copy(target); controls.current.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useEffect(() => useAtlas.subscribe((s, p) => {
    if (!s.cameraCmd || s.cameraCmd === p.cameraCmd) return;
    const cmd: CameraCmd = s.cameraCmd;
    const c = controls.current;
    if (!c) return;
    const dirNow = camera.position.clone().sub(c.target).normalize();
    if (cmd.kind === 'reset') { const h = homePose(); go(h.pos, h.target); atHome.current = true; return; }
    atHome.current = false;
    if (cmd.kind === 'pose') { go(new Vector3(...cmd.position), new Vector3(...cmd.target), cmd.instant); return; }
    if (cmd.kind === 'view') {
      const dirs: Record<string, [number, number, number]> = {
        left: [-1, 0.0001, 0], right: [1, 0.0001, 0], superior: [0, 1, 0.0015], inferior: [0, -1, -0.0015], anterior: [0, 0.0001, -1], posterior: [0, 0.0001, 1],
      };
      const side = cmd.view === 'left' || cmd.view === 'right', top = cmd.view === 'superior' || cmd.view === 'inferior';
      const w = side ? home.extent.a : home.extent.r, h = top ? home.extent.a : home.extent.s;
      go(home.centre.clone().addScaledVector(new Vector3(...dirs[cmd.view]).normalize(), frameDistance(w, h)), home.centre.clone());
      return;
    }
    if (cmd.kind === 'fit' || cmd.kind === 'dive') {
      const sph = new Sphere();
      let first = true;
      for (const id of cmd.ids) {
        const m = byId.get(id);
        if (!m?.geometry.boundingSphere) continue;
        const b = m.geometry.boundingSphere.clone().applyMatrix4(DISPLAY);
        if (first) { sph.copy(b); first = false; } else sph.union(b);
      }
      if (first) return;
      // Swing towards the structure's outward side, but only part of the way, so the user keeps their bearings;
      // keep enough of the surrounding brain in frame to see where the structure sits.
      const outward = sph.center.clone().sub(home.centre);
      const dir = outward.length() > 0.012 ? dirNow.clone().lerp(outward.normalize(), 0.55).normalize() : dirNow;
      if (dir.y < 0.05) dir.setY(0.05).normalize();
      // Close enough to read the structure, far enough that the brain around it still says where it is.
      if (cmd.kind === 'dive') {
        // straight in along the structure's outward direction, until it fills the stage
        const inDir = outward.length() > 0.012 ? outward.clone().normalize() : dirNow;
        go(sph.center.clone().addScaledVector(inDir, Math.max(0.05, sph.radius * 1.6)), sph.center.clone());
        return;
      }
      const r = Math.max(sph.radius, 0.014);
      const homeDist = homePose().pos.distanceTo(home.centre);
      const dist = Math.min(homeDist * 0.92, Math.max(homeDist * 0.50, frameDistance(r * 4.2, r * 4.2, 0.9, 0.9)));
      const target = sph.center.clone().lerp(home.centre, 0.22);
      go(target.clone().addScaledVector(dir, dist), target);
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
      v.setLength(Math.max(0.03, Math.min(2.2, v.length() * cmd.factor)));
      camera.position.copy(c.target).add(v);
      c.update(); invalidate();
    }
  }), [byId, camera, home, invalidate, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastFrame = useRef(0);
  useFrame(() => {
    const now = performance.now();
    atlasPerf.frames++;
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
    // compose the subject in the part of the stage that is not covered by a side panel
    const want = useAtlas.getState().insetRight;
    if (Math.abs(inset.current - want) > 0.5) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      inset.current = reduce ? want : inset.current + (want - inset.current) * 0.18;
      if (Math.abs(inset.current - want) <= 0.5) inset.current = want;
      const cam = camera as PerspectiveCamera;
      if (inset.current > 0.5) cam.setViewOffset(size.width, size.height, inset.current / 2, 0, size.width, size.height); else cam.clearViewOffset();
      invalidate();
    }
    if (c) { const f = camera.position.clone().sub(c.target).normalize(); cameraFrom.r = f.x; cameraFrom.s = f.y; cameraFrom.a = -f.z; }
    const m = camera.matrixWorldInverse;
    const ax = (x: number, y: number, z: number): [number, number, number] => { const v = new Vector3(x, y, z).transformDirection(m); return [v.x, v.y, v.z]; };
    onGizmo({ r: ax(1, 0, 0), a: ax(0, 0, -1), s: ax(0, 1, 0) });
  });

  // ── picking ───────────────────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ray = new Raycaster() as Raycaster & { firstHitOnly?: boolean };
    const ndc = new Vector2(), local = new Vector3(), inv = new Matrix4();
    const pos = shell.geometry.getAttribute('position');
    const cast = (clientX: number, clientY: number): Hit | null => {
      if (look !== 'tissue') return null;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const st = useAtlas.getState();
      const clip = st.clip;
      const anyHidden = Object.keys(st.hidden).length > 0 || !st.hemi.left || !st.hemi.right || !st.hemi.midline;
      // a hidden region of the shell is discarded on screen, so the ray must be able to pass through it
      ray.firstHitOnly = clip.axis === 'none' && !anyHidden;
      const targets: Mesh[] = [];
      if (shell.visible) targets.push(shell);
      for (const m of meshes) if (m.visible) targets.push(m);
      inv.copy(shell.matrixWorld).invert();
      const hits: Hit[] = ray.intersectObjects(targets, false).map((h) => {
        let id = h.object.name;
        if (h.object === shell && h.face) {
          // region of the hit triangle's nearest vertex, from the label volume
          local.copy(h.point).applyMatrix4(inv);
          let best = h.face.a, bd = Infinity;
          for (const v of [h.face.a, h.face.b, h.face.c]) {
            const dd = (pos.getX(v) - local.x) ** 2 + (pos.getY(v) - local.y) ** 2 + (pos.getZ(v) - local.z) ** 2;
            if (dd < bd) { bd = dd; best = v; }
          }
          const r = specimen.region[best];
          id = r ? manifest.structures[r - 1].id : '';
        }
        return { id, distance: h.distance, pointRasMm: displayToRasMm([h.point.x, h.point.y, h.point.z]) };
      });
      if (slice.visible && st.slices.data) {
        const plane = clipPlane({ ...clip, keep: '+' })!;
        const hitP = ray.ray.intersectPlane(plane, new Vector3());
        if (hitP) {
          const rasP = displayToRasMm([hitP.x, hitP.y, hitP.z]);
          const v = regionAt(st.slices.data, rasP);
          // inside the imaged head the slice is opaque: it is either a labelled region or it blocks the pick
          if (v.t1 > 0) hits.push({ id: v.region ? manifest.structures[v.region - 1].id : '', distance: ray.ray.origin.distanceTo(hitP), pointRasMm: rasP });
        }
      }
      return resolvePick(hits, clip, (id) => planCache.current.get(id) ?? false);
    };
    const project = (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).applyMatrix4(DISPLAY).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, ok: v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.96 };
    };
    apiRef.current = {
      cameraState: () => ({
        transitioning: tween.current !== null,
        position: camera.position.toArray() as [number, number, number],
        target: (controls.current?.target.toArray() ?? [0, 0, 0]) as [number, number, number],
      }),
      pick: (x, y) => {
        const t0 = performance.now();
        const hit = cast(x, y);
        sample(atlasPerf.pickMs, performance.now() - t0);
        return hit;
      },
      screenPointOf: (id) => {
        const tryPoint = (x: number, y: number, z: number) => { const p = project(x, y, z); return p.ok && cast(p.x, p.y)?.id === id ? { x: p.x, y: p.y } : null; };
        const r = indexOfId.get(id);
        if (shell.visible && r) for (const v of regionVerts.get(r) ?? []) { const hit = tryPoint(pos.getX(v), pos.getY(v), pos.getZ(v)); if (hit) return hit; }
        const mesh = byId.get(id);
        if (mesh?.visible) {
          const mp = mesh.geometry.getAttribute('position');
          const step = Math.max(1, Math.floor(mp.count / 300));
          for (let i = 0; i < mp.count; i += step) { const hit = tryPoint(mp.getX(i), mp.getY(i), mp.getZ(i)); if (hit) return hit; }
        }
        return null;
      },
      coverage: () => {
        const [lo, hi] = specimen.meta.mesh.boundsMm;
        const rect = gl.domElement.getBoundingClientRect();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < pos.count; i += 97) {
          const p = project(pos.getX(i), pos.getY(i), pos.getZ(i));
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        void lo; void hi;
        return { w: (x1 - x0) / rect.width, h: (y1 - y0) / rect.height };
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, byId, camera, gl, meshes, shell, slice, specimen, manifest, regionVerts, indexOfId, look]);

  return (
    <>
      <primitive object={root} />
      {look === 'tissue' && <primitive object={ring} />}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={0.03}
        maxDistance={2.2}
        zoomSpeed={0.9}
        rotateSpeed={0.8}
        onStart={() => { tween.current = null; atHome.current = false; /* user input always interrupts a camera move */ }}
      />
    </>
  );
}

function webglAvailable(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** The atlas viewport with pointer / touch / keyboard interaction and the hover name tag. */
export function AtlasViewport({ onGizmo, look = 'tissue' }: { onGizmo: (g: GizmoAxes) => void; look?: Look }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const tag = useRef<HTMLDivElement | null>(null);
  const api = useRef<SceneApi | null>(null);
  const [webgl] = useState(webglAvailable);
  const [lost, setLost] = useState(false);
  const hoverId = useAtlas((s) => s.hoverId);
  const selectedId = useAtlas((s) => s.selectedId);
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
      t.style.transform = `translate(${Math.min(r.width - 12, Math.max(12, x - r.left + 16))}px, ${Math.min(r.height - 12, Math.max(12, y - r.top + 18))}px)`;
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
      // a tap / click (not a drag): select what is under the pointer, or clear on empty space
      const hit = api.current?.pick(e.clientX, e.clientY) ?? null;
      const st = useAtlas.getState();
      if (hit && hit.id !== st.selectedId) { st.select(hit.id); st.camera({ kind: 'fit', ids: st.idsOf(hit.id) }); }
      else if (!hit) st.select(null);
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

  // test / diagnostics hooks (no production behaviour depends on them)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__atlas = {
      store: useAtlas,
      screenPointOf: (id: string) => api.current?.screenPointOf(id) ?? null,
      pickAt: (x: number, y: number) => api.current?.pick(x, y) ?? null,
      cameraState: () => api.current?.cameraState() ?? null,
      coverage: () => api.current?.coverage() ?? null,
    };
    w.__atlasPerf = atlasPerf;
    return () => { delete w.__atlas; delete w.__atlasPerf; };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const st = useAtlas.getState();
    const step = e.shiftKey ? 0.05 : 0.2;
    const k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
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
        <strong>{lost ? 'The 3D graphics context was lost.' : '3D graphics (WebGL 2) are not available in this browser.'}</strong>
        <p>The brain cannot be drawn here, and no substitute picture is shown in its place. Region search and the explanations still work.</p>
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
      aria-label="3D brain. Arrow keys rotate, plus and minus zoom, F frames the selection, 0 resets the view, square brackets step through structures, Escape clears the selection."
      aria-describedby="atlas-live"
      onKeyDown={onKey}
      data-testid="atlas-viewport"
      data-look={look}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.01, far: 6, position: [-0.45, 0.18, -0.2] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.domElement.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); setLost(true); });
        }}
      >
        <BrainScene onGizmo={onGizmo} apiRef={api} look={look} />
      </Canvas>
      <div
        ref={tag}
        className="atlas-tag"
        style={{ display: hoverId && hoverSource === 'scene' && hoverId !== selectedId ? undefined : 'none' }}
        data-testid="atlas-hover-tag"
        aria-hidden="true"
      >
        <span className="atlas-tag-name">{hoverName}</span>
        {hoverParent && <span className="atlas-tag-parent">{hoverParent}</span>}
      </div>
    </div>
  );
}
