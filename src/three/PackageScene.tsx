// Level 2 — HBCI-02 package close-up: lid, substrate, perimeter contacts, bond wires and die.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Object3D, QuadraticBezierCurve3, TubeGeometry, Vector3, type Group, type InstancedMesh, type Material, type Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Part } from './Part';
import { M, markingTexture, siliconTexture } from './materials';
import { roundedRing, roundedSlab, stripGeometry } from './geometry';
import { explodeLocal, runtime, useView } from './viewStore';
import { useScene } from '../state/sceneStore';
import { DIE_SIZE, useDieLayout } from './dieLayout';

type V3 = [number, number, number];

export const PKG = {
  sub: { w: 4.4, t: 0.22 },
  die: { w: 1.9, t: 0.14 },
  lid: { w: 4.0, h: 0.58 },
};
const SUB_TOP = PKG.sub.t / 2;
const DIE_TOP = SUB_TOP + PKG.die.t;
const BOND_N = 10;
const FINGER_R = 1.45;
const DIE_PAD_R = PKG.die.w / 2 - 0.08;

export const PKG_LAYOUT = {
  pins: { off: [0, -0.9, 0] as V3, delay: 0.05 },
  sub: { off: [0, 0, 0] as V3, delay: 0 },
  bonds: { off: [0, 0.6, 0] as V3, delay: 0.1 },
  die: { off: [0, 1.15, 0] as V3, delay: 0.14 },
  lid: { off: [0, 2.2, 0] as V3, delay: 0 },
};

function sidePoints(r: number, n: number, span: number, y: number): { p: V3; ry: number }[] {
  const out: { p: V3; ry: number }[] = [];
  for (let s = 0; s < 4; s++)
    for (let i = 0; i < n; i++) {
      const t = -span + (i * 2 * span) / (n - 1);
      const p: V3 = s === 0 ? [t, y, -r] : s === 1 ? [t, y, r] : s === 2 ? [-r, y, t] : [r, y, t];
      out.push({ p, ry: s < 2 ? 0 : Math.PI / 2 });
    }
  return out;
}

function useInstanced(ref: React.RefObject<InstancedMesh>, items: { p: V3; ry?: number }[]) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(0, it.ry ?? 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ref, items]);
}

function Lid() {
  const W = PKG.lid.w;
  const geo = useMemo(() => ({ wall: roundedRing(W, W, 0.26, 0.12, 0.5), top: roundedSlab(W, W, 0.08, 0.26, 0.025) }), [W]);
  const tex = useMemo(
    () =>
      markingTexture(
        [
          { text: 'HBCI-02', size: 92, weight: 700 },
          { text: 'DSP + AI DECODER · 8 CH', size: 36, weight: 500 },
          { text: 'CONCEPT PACKAGE · NOT QUALIFIED', size: 22, weight: 500, mono: true },
        ],
        { bg: '#bfc4ca', fg: '#3e444c', dot: true, border: '#8a9098' },
      ),
    [],
  );
  const lift = useRef<Group>(null!);
  useFrame(() => {
    lift.current.position.y = runtime.lidLift * 1.1;
    lift.current.rotation.z = runtime.lidLift * 0.06;
    lift.current.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (m) m.userData.baseOpacity = runtime.lidOpacity;
    });
    // Is the die hidden by a closed, opaque lid? (Labels must then not point at the lid.)
    const s = useScene.getState();
    const lidUp = runtime.lidLift * 1.1 + PKG_LAYOUT.lid.off[1] * explodeLocal(runtime.explode, PKG_LAYOUT.lid.delay);
    const lidShown = !s.hidden['pkg.lid'] && (!s.isolateId || s.isolateId === 'pkg.lid' || s.isolateId === 'sys.hbci01');
    const occluded = runtime.levelActive.package && lidShown && !s.xray && runtime.lidOpacity > 0.5 && lidUp < 0.45;
    useView.getState().setDieOccluded(occluded);
  });
  return (
    <Part id="pkg.lid" shell position={[0, SUB_TOP, 0]} offset={PKG_LAYOUT.lid.off} delay={PKG_LAYOUT.lid.delay} anchor={[1.6, 0.6, -1.6]} label="right">
      <group ref={lift}>
        <mesh geometry={geo.wall}>
          <meshPhysicalMaterial {...M.nickel} clearcoat={0.5} clearcoatRoughness={0.2} />
        </mesh>
        <mesh geometry={geo.top} position={[0, 0.5, 0]}>
          <meshPhysicalMaterial {...M.nickel} clearcoat={0.5} clearcoatRoughness={0.2} />
        </mesh>
        <mesh position={[0, 0.5805, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W - 0.3, W - 0.3]} />
          <meshStandardMaterial map={tex} metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
    </Part>
  );
}

function Substrate() {
  const slab = useMemo(() => roundedSlab(PKG.sub.w, PKG.sub.w, PKG.sub.t, 0.12, 0.02), []);
  const fingers = useMemo(() => sidePoints(FINGER_R, BOND_N, 0.9, SUB_TOP + 0.004), []);
  const fanout = useMemo(() => {
    const pl: [number, number][][] = [];
    const n = BOND_N;
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < n; i++) {
        const t = -0.9 + (i * 1.8) / (n - 1);
        const t2 = -1.75 + (i * 3.5) / (n - 1);
        const a = FINGER_R + 0.1, b = FINGER_R + 0.35, c = PKG.sub.w / 2 - 0.12;
        const map = (r: number, u: number): [number, number] => (s === 0 ? [u, -r] : s === 1 ? [u, r] : s === 2 ? [-r, u] : [r, u]);
        pl.push([map(a, t), map(b, t2), map(c, t2)]);
      }
    return stripGeometry(pl, 0.028, 0.005, SUB_TOP + 0.003);
  }, []);
  const ref = useRef<InstancedMesh>(null);
  useInstanced(ref, fingers);
  return (
    <Part id="pkg.substrate" offset={PKG_LAYOUT.sub.off} anchor={[-2.0, 0.15, 1.6]} label="left">
      <mesh geometry={slab} position={[0, -PKG.sub.t / 2, 0]}>
        <meshPhysicalMaterial {...M.laminate} clearcoat={0.4} clearcoatRoughness={0.35} />
      </mesh>
      <mesh geometry={fanout}>
        <meshStandardMaterial {...M.gold} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, fingers.length]}>
        <boxGeometry args={[0.07, 0.008, 0.16]} />
        <meshStandardMaterial {...M.gold} />
      </instancedMesh>
      {/* die-attach pad */}
      <mesh position={[0, SUB_TOP + 0.002, 0]}>
        <boxGeometry args={[2.05, 0.004, 2.05]} />
        <meshStandardMaterial {...M.tin} />
      </mesh>
    </Part>
  );
}

function Pins() {
  const pads = useMemo(() => sidePoints(PKG.sub.w / 2 - 0.12, 12, 1.75, -SUB_TOP - 0.02), []);
  const ref = useRef<InstancedMesh>(null);
  useInstanced(ref, pads);
  return (
    <Part id="pkg.pins" offset={PKG_LAYOUT.pins.off} delay={PKG_LAYOUT.pins.delay} anchor={[-1.9, -0.2, -2.0]} label="left">
      <instancedMesh ref={ref} args={[undefined, undefined, pads.length]}>
        <boxGeometry args={[0.16, 0.04, 0.3]} />
        <meshStandardMaterial {...M.tin} />
      </instancedMesh>
      <mesh position={[0, -SUB_TOP - 0.02, 0]}>
        <boxGeometry args={[2.3, 0.04, 2.3]} />
        <meshStandardMaterial {...M.tin} />
      </mesh>
    </Part>
  );
}

function Bonds() {
  const geo = useMemo(() => {
    const tubes: TubeGeometry[] = [];
    const span = 0.66;
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < BOND_N; i++) {
        const t = -span + (i * 2 * span) / (BOND_N - 1);
        const tf = -0.9 + (i * 1.8) / (BOND_N - 1);
        const map = (r: number, u: number, y: number) =>
          s === 0 ? new Vector3(u, y, -r) : s === 1 ? new Vector3(u, y, r) : s === 2 ? new Vector3(-r, y, u) : new Vector3(r, y, u);
        const a = map(DIE_PAD_R, t, DIE_TOP + 0.005);
        const b = map(FINGER_R - 0.02, tf, SUB_TOP + 0.01);
        const c = map(DIE_PAD_R + 0.12, (t + tf) / 2, DIE_TOP + 0.32);
        tubes.push(new TubeGeometry(new QuadraticBezierCurve3(a, c, b), 18, 0.009, 5, false));
      }
    const merged = mergeGeometries(tubes, false)!;
    tubes.forEach((g) => g.dispose());
    return merged;
  }, []);
  return (
    <Part id="pkg.bonds" offset={PKG_LAYOUT.bonds.off} delay={PKG_LAYOUT.bonds.delay} anchor={[1.25, DIE_TOP + 0.3, 0.9]} label="right">
      <mesh geometry={geo}>
        <meshStandardMaterial {...M.gold} roughness={0.2} />
      </mesh>
    </Part>
  );
}

function Die() {
  const layout = useDieLayout();
  const tex = useMemo(
    () =>
      siliconTexture(
        layout.blocks.map((b) => ({
          x: (b.x0 + DIE_SIZE / 2) / DIE_SIZE,
          y: (b.z0 + DIE_SIZE / 2) / DIE_SIZE,
          w: (b.x1 - b.x0) / DIE_SIZE,
          h: (b.z1 - b.z0) / DIE_SIZE,
          color: b.tint,
        })),
      ),
    [layout],
  );
  const pads = useMemo(() => sidePoints(DIE_PAD_R, BOND_N, 0.66, DIE_TOP + 0.002), []);
  const ref = useRef<InstancedMesh>(null);
  useInstanced(ref, pads);
  return (
    <Part id="pkg.die" position={[0, 0, 0]} offset={PKG_LAYOUT.die.off} delay={PKG_LAYOUT.die.delay} anchor={[0.6, DIE_TOP + 0.05, -0.6]} label="right">
      <mesh position={[0, SUB_TOP + PKG.die.t / 2, 0]}>
        <boxGeometry args={[PKG.die.w, PKG.die.t, PKG.die.w]} />
        <meshPhysicalMaterial color="#2a2f38" metalness={0.5} roughness={0.3} clearcoat={0.6} clearcoatRoughness={0.15} />
      </mesh>
      <mesh position={[0, DIE_TOP + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[PKG.die.w - 0.01, PKG.die.w - 0.01]} />
        <meshPhysicalMaterial map={tex} metalness={0.4} roughness={0.3} clearcoat={0.6} clearcoatRoughness={0.15} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, pads.length]}>
        <boxGeometry args={[0.07, 0.004, 0.07]} />
        <meshStandardMaterial {...M.tin} />
      </instancedMesh>
    </Part>
  );
}

export function PackageScene() {
  return (
    <group>
      <Pins />
      <Substrate />
      <Bonds />
      <Die />
      <Lid />
    </group>
  );
}

/** Size of the die inside the package scene (used to zoom into the die level). */
export const PKG_DIE_WIDTH = PKG.die.w;
