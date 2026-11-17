// Camera rig: OrbitControls with damping (full 360°, can orbit under the model), smooth wheel
// zoom, eased fly-to animations for level changes, Fit, Reset and the standard views, a camera
// pose remembered per level (Back restores it), zoom/pan clamps so the model cannot be lost,
// and reduced-motion handling (flights ≤ 150 ms). Every flight is interruptible by user input.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box3, Quaternion, Vector3, type InstancedMesh, type Mesh, type Object3D, type PerspectiveCamera } from 'three';
import { useScene } from '../state/sceneStore';
import { COMPONENTS, ancestorsOf } from '../model/components';
import { damp, easeInOutCubic, is3DLevel, levelGroups, presetGroups, registry, runtime, useView, type Level3D } from './viewStore';
import { initialLevel3D } from './Stage';

/** Home view per level: viewing direction (from target towards the camera) and zoom limits.
 * The distance is computed from the level's visible bounds so the whole level fits. */
export const HOME: Record<Level3D, { pos: Vector3; target: Vector3; min: number; max: number; reach: number }> = {
  system: { pos: new Vector3(2.4, 7.4, 12.8), target: new Vector3(0.3, -0.2, 0), min: 1.2, max: 40, reach: 14 },
  package: { pos: new Vector3(4.9, 5.0, 7.0), target: new Vector3(0, 0.55, 0), min: 0.8, max: 26, reach: 8 },
  die: { pos: new Vector3(0, 8.0, 6.6), target: new Vector3(0, 0.2, 0.35), min: 0.8, max: 26, reach: 10 },
};

/** The cortical preset explodes vertically, so its home view is lower (more side-on). */
const CORTICAL_DIR = new Vector3(5.2, 4.6, 12.5);

/** Standard viewing directions (from the target towards the camera). */
const VIEW_DIR = {
  top: new Vector3(0, 1, 0.0001),
  front: new Vector3(0, 0.12, 1),
};

/** Requests that other scene components (orientation gizmo) can post for the rig. */
export const cameraBus = { dir: null as Vector3 | null };

const UP = new Vector3(0, 1, 0);
/**
 * Camera pose that frames `box` exactly, looking along -dir. Margins leave room for the
 * toolbar (top) and the level caption (bottom).
 */
export function framePose(box: Box3, dir: Vector3, fovDeg: number, aspect: number, margin = 1, nudge = 0.04) {
  const center = box.getCenter(new Vector3());
  const d = dir.clone().normalize();
  const f = d.clone().negate();
  const r = new Vector3().crossVectors(f, Math.abs(f.y) > 0.999 ? new Vector3(0, 0, -1) : UP).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  const tanV = Math.tan((fovDeg * Math.PI) / 360) * 0.8 / margin;
  const tanH = Math.tan((fovDeg * Math.PI) / 360) * aspect * 0.92 / margin;
  let dist = 0.5;
  const c = new Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    const z = c.dot(d);
    dist = Math.max(dist, z + Math.abs(c.dot(r)) / tanH, z + Math.abs(c.dot(u)) / tanV);
  }
  // nudge the target up a little so the model sits below the toolbar
  const target = center.clone().addScaledVector(u, -dist * tanV * nudge);
  return { pos: target.clone().addScaledVector(d, dist), target };
}

type Controls = React.ElementRef<typeof OrbitControls>;

interface Flight {
  ft: Vector3; tt: Vector3; dirA: Vector3; q: Quaternion; ra: number; rb: number; t: number; dur: number;
}

const _box = new Box3();
const _tmp = new Box3();

/** Root whose bounds define "the whole level": the active preset on the System level. */
function levelRoot(lvl: Level3D): Object3D | undefined {
  if (lvl === 'system') return presetGroups[useScene.getState().preset] ?? levelGroups.system;
  return levelGroups[lvl];
}

function isShown(o: Object3D | null): boolean {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

/** Bounding box of the visible meshes below `root`. */
export function visibleBox(root: Object3D, out: Box3, ignoreRootVisibility = false): Box3 {
  out.makeEmpty();
  root.updateWorldMatrix(true, true);
  if (!ignoreRootVisibility && !isShown(root.parent)) return out;
  const visit = (o: Object3D) => {
    if ((!o.visible && !(ignoreRootVisibility && o === root)) || o.userData.noFit) return;
    const m = o as Mesh;
    if (m.isMesh && m.geometry) {
      const im = o as InstancedMesh;
      if (im.isInstancedMesh) {
        if (im.count > 0) {
          im.computeBoundingBox();
          if (im.boundingBox) out.union(_tmp.copy(im.boundingBox).applyMatrix4(im.matrixWorld));
        }
      } else {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        if (bb && !bb.isEmpty()) out.union(_tmp.copy(bb).applyMatrix4(m.matrixWorld));
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return out;
}

/** Flight duration honouring reduced motion (instant-feeling, ≤ 150 ms). */
const dur = (normal: number) => (runtime.reducedMotion ? Math.min(0.14, normal) : normal);

export function CameraRig() {
  const controls = useRef<Controls>(null!);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const flight = useRef<Flight | null>(null);
  const desired = useRef<number | null>(null);
  const current = useRef<Level3D>(initialLevel3D());
  const pendingFit = useRef(false);
  const pendingView = useRef<Vector3 | 'iso' | 'fitAll' | null>(null);
  /** Re-frame after a level transition: restore the remembered pose (Back) or fly home (new dive). */
  const reframe = useRef<{ phase: 'start' | 'end'; waited: number; restore: boolean } | null>(null);
  /** Pending re-frame after a System preset switch (waits until the new preset is visible). */
  const presetFrame = useRef<{ waited: number } | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const flyTo = (pos: Vector3, target: Vector3, seconds = 1.1) => {
    const c = controls.current;
    if (!c) return;
    const ft = c.target.clone();
    const offA = camera.position.clone().sub(ft);
    const offB = pos.clone().sub(target);
    const dirA = offA.clone().normalize();
    const dirB = offB.clone().normalize();
    flight.current = {
      ft, tt: target.clone(), dirA, q: new Quaternion().setFromUnitVectors(dirA, dirB),
      ra: offA.length(), rb: offB.length(), t: 0, dur: dur(seconds),
    };
    desired.current = null;
  };

  const aspect = () => sizeRef.current.width / Math.max(1, sizeRef.current.height);

  /** Box of the whole level (visible bounds), or null before the scene has mounted. */
  const levelBox = (lvl: Level3D, ignoreVis = false) => {
    const g = levelRoot(lvl);
    if (!g) return null;
    visibleBox(g, _box, ignoreVis);
    return _box.isEmpty() ? null : _box;
  };

  const fit = () => {
    const s = useScene.getState();
    const lvl = current.current;
    let root: Object3D | undefined;
    if (s.selectedId) {
      for (const id of [s.selectedId, ...ancestorsOf(s.selectedId)]) {
        if (COMPONENTS[id]?.level === lvl && registry.get(id)) {
          root = registry.get(id);
          break;
        }
      }
    }
    const whole = levelRoot(lvl);
    root = root ?? whole;
    if (!root) return;
    visibleBox(root, _box);
    if (_box.isEmpty() && root !== whole && whole) visibleBox(whole, _box);
    if (_box.isEmpty()) return;
    const c = controls.current;
    const dir = camera.position.clone().sub(c.target);
    const p = framePose(_box, dir, camera.fov, aspect(), root === whole ? 1 : 0.8);
    flyTo(p.pos, p.target, 0.9);
  };

  const homeDir = (lvl: Level3D) => {
    const h = HOME[lvl];
    return lvl === 'system' && useScene.getState().preset === 'cortical' ? CORTICAL_DIR.clone() : h.pos.clone().sub(h.target);
  };

  /** Home pose of a level, fitted to its current visible bounds. */
  const homePose = (lvl: Level3D) => {
    const h = HOME[lvl];
    const box = levelBox(lvl, true);
    // The die sits under a taller overlay stack (mode chooser, selection chip), so it gets more room and sits lower.
    if (box) return lvl === 'die' ? framePose(box, homeDir(lvl), camera.fov, aspect(), 1.26, 0.1) : framePose(box, homeDir(lvl), camera.fov, aspect());
    return { pos: h.pos.clone(), target: h.target.clone() };
  };

  /** A standard view: the whole level framed along `dir`. */
  const viewPose = (dir: Vector3) => {
    const lvl = current.current;
    const box = levelBox(lvl);
    if (!box) return homePose(lvl);
    return lvl === 'die' ? framePose(box, dir, camera.fov, aspect(), 1.26, 0.1) : framePose(box, dir, camera.fov, aspect(), 1);
  };

  const remember = (lvl: Level3D) => {
    const c = controls.current;
    if (!c) return;
    useView.getState().rememberCamera(lvl, { pos: camera.position.toArray() as [number, number, number], target: c.target.toArray() as [number, number, number] });
  };

  const pendingHome = useRef(true);
  useLayoutEffect(() => {
    const h = HOME[current.current];
    camera.position.copy(h.pos);
    controls.current.target.copy(h.target);
    camera.lookAt(h.target);
    controls.current.update();
  }, [camera]);

  useEffect(() => {
    let last3d = current.current;
    return useScene.subscribe((s, p) => {
      if (s.level !== p.level && is3DLevel(s.level) && s.level !== last3d) {
        remember(last3d);
        const back = s.history.length < p.history.length;
        last3d = s.level;
        current.current = s.level;
        // The level transition scales the scene around the chip, so bounds measured now are
        // wrong. Fly towards the static home pose, then re-frame on real bounds afterwards.
        const mem = useView.getState().cameraMemory[s.level];
        const h = HOME[s.level];
        if (back && mem) flyTo(new Vector3(...mem.pos), new Vector3(...mem.target), 1.0);
        else flyTo(h.pos.clone(), h.target.clone(), 1.25);
        reframe.current = { phase: 'start', waited: 0, restore: !!(back && mem) };
      }
      if (s.preset !== p.preset && current.current === 'system' && s.level === 'system') presetFrame.current = { waited: 0 };
      if (s.fitRequest !== p.fitRequest) pendingFit.current = true;
      if (s.resetRequest !== p.resetRequest) {
        const h = homePose(current.current);
        flyTo(h.pos, h.target, 1.0);
      }
      if (s.viewRequest.n !== p.viewRequest.n) {
        const v = s.viewRequest.view;
        pendingView.current = v === 'top' ? VIEW_DIR.top : v === 'front' ? VIEW_DIR.front : v;
      }
    });
  }, []);

  // smooth wheel zoom (OrbitControls' own zoom is disabled)
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = controls.current;
      if (!c) return;
      const h = HOME[current.current];
      const cur = desired.current ?? camera.position.distanceTo(c.target);
      const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0014));
      desired.current = Math.min(h.max, Math.max(h.min, cur * k));
      flight.current = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const c = controls.current;
    if (!c) return;
    if (pendingHome.current && sizeRef.current.height > 0) {
      // first frame: parts have applied their explode offsets, so the bounds are real
      pendingHome.current = false;
      const h = homePose(current.current);
      camera.position.copy(h.pos);
      c.target.copy(h.target);
      camera.lookAt(h.target);
    }
    const rf = reframe.current;
    if (rf) {
      rf.waited += dt;
      if (rf.phase === 'start' && (runtime.transitionActive || rf.waited > 0.4)) rf.phase = 'end';
      if (rf.phase === 'end' && !runtime.transitionActive && !flight.current) {
        reframe.current = null;
        if (!rf.restore) {
          const h = homePose(current.current);
          if (h.pos.distanceTo(camera.position) > 0.02 * h.pos.distanceTo(h.target) || h.target.distanceTo(c.target) > 0.05) {
            flyTo(h.pos, h.target, 0.7);
          }
        }
      }
    }
    const pf = presetFrame.current;
    if (pf) {
      pf.waited += dt;
      const preset = useScene.getState().preset;
      if (runtime.presetOpacity[preset] > 0.08 || pf.waited > 1.5) {
        presetFrame.current = null;
        if (current.current === 'system' && !runtime.transitionActive) {
          const h = homePose('system');
          flyTo(h.pos, h.target, 1.0);
        }
      }
    }
    if (!runtime.transitionActive) {
      if (pendingFit.current) {
        pendingFit.current = false;
        fit();
      }
      const pv = pendingView.current ?? cameraBus.dir;
      if (pv) {
        pendingView.current = null;
        cameraBus.dir = null;
        if (pv === 'fitAll') {
          const dir = camera.position.clone().sub(c.target);
          const p = viewPose(dir);
          flyTo(p.pos, p.target, 0.9);
        } else {
          const dir = pv === 'iso' ? homeDir(current.current) : pv;
          const p = viewPose(dir);
          flyTo(p.pos, p.target, 0.9);
        }
      }
    }
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = runtime.reducedMotion ? f.t : easeInOutCubic(f.t);
      const q = new Quaternion().slerp(f.q, e);
      const dir = f.dirA.clone().applyQuaternion(q);
      c.target.lerpVectors(f.ft, f.tt, e);
      camera.position.copy(c.target).addScaledVector(dir, f.ra + (f.rb - f.ra) * e);
      camera.lookAt(c.target);
      if (f.t >= 1) flight.current = null;
    } else if (desired.current !== null) {
      const d = camera.position.distanceTo(c.target);
      const nd = runtime.reducedMotion ? desired.current : d + (desired.current - d) * damp(dt, 11);
      const dir = camera.position.clone().sub(c.target).normalize();
      camera.position.copy(c.target).addScaledVector(dir, nd);
      camera.lookAt(c.target);
      if (Math.abs(nd - desired.current) < desired.current * 1e-3) desired.current = null;
    } else {
      // clamps: keep the target near the level and the distance within the level's zoom range
      const h = HOME[current.current];
      const centre = h.target;
      const off = c.target.clone().sub(centre);
      const reach = h.reach;
      if (off.length() > reach) {
        off.setLength(reach);
        const nt = centre.clone().add(off);
        camera.position.add(nt.clone().sub(c.target));
        c.target.copy(nt);
      }
      const d = camera.position.distanceTo(c.target);
      if (d < h.min || d > h.max) {
        const nd = Math.min(h.max, Math.max(h.min, d));
        const dir = camera.position.clone().sub(c.target).normalize();
        camera.position.copy(c.target).addScaledVector(dir, nd);
      }
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enableZoom={false}
      rotateSpeed={0.65}
      panSpeed={0.85}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
      screenSpacePanning
      onStart={() => {
        flight.current = null;
      }}
    />
  );
}
