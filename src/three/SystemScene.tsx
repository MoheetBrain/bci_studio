// Level 1 — conceptual system assembly with an exploded-view reveal.
// All geometry is procedural and CONCEPT-level; every group carries its registry id.
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, RoundedBox } from '@react-three/drei';
import {
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Object3D,
  ShapeGeometry,
  TubeGeometry,
  Vector3,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import { Part, PartLabel } from './Part';
import { themeColors } from './theme';
import { C, GLASS, M, feedbackPanelTexture, markingTexture, neuralTexture, pcbTexture, stagePlateTexture } from './materials';
import { CHIP_W, SpiralCurve, arcPoints, roundedRectShape, roundedRing, roundedSlab, stripGeometry, writeRibbon, writeTube } from './geometry';
import { explodeLocal, levelGroups, partAnchorWorld, runtime } from './viewStore';
import { useScene, isVisible } from '../state/sceneStore';

type V3 = [number, number, number];
const noRaycast = () => null;

const PCB = { w: 5.6, d: 3.0, r: 0.42, t: 0.07, y: -0.12 };
const TOP = PCB.y + PCB.t;

/** Assembled positions, explode offsets (at explode = 1) and stagger delays. */
export const SYS = {
  connector: { pos: [-2.5, TOP, 0] as V3, off: [-0.7, 0.8, 0] as V3, delay: 0.22 },
  afe: { pos: [-1.45, TOP, -0.6] as V3, off: [0, 1.3, -0.2] as V3, delay: 0.18 },
  adc: { pos: [-1.45, TOP, 0.72] as V3, off: [0, 1.05, 0.25] as V3, delay: 0.26 },
  hbci01: { pos: [0.15, TOP, 0] as V3, off: [0, 1.7, 0] as V3, delay: 0.12 },
  comms: { pos: [1.55, TOP, 0.82] as V3, off: [0, 1.25, 0.25] as V3, delay: 0.2 },
  pmu: { pos: [1.55, TOP, -0.85] as V3, off: [0, 1.05, -0.2] as V3, delay: 0.24 },
  coil: { pos: [1.2, -0.31, 0] as V3, off: [0, -1.5, 0] as V3, delay: 0.08 },
  electrode: { pos: [-5.15, -0.55, 0] as V3, off: [-1.4, -0.35, 0] as V3, delay: 0.05 },
  ai: { pos: [5.7, 0.85, -0.2] as V3, off: [1.2, 0.55, 0] as V3, delay: 0 },
  chassis: { pos: [0, -0.5, 0] as V3, off: [0, -2.4, 0] as V3, delay: 0.02 },
  glass: { pos: [0, 0.33, 0] as V3, off: [0, 3.0, 0] as V3, delay: 0 },
};

const add = (a: V3, b: V3, k: number): Vector3 => new Vector3(a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k);

/** A sub-assembly that explodes independently inside a part. */
function Sub({ position, offset, delay = 0, children }: { position: V3; offset: V3; delay?: number; children: ReactNode }) {
  const ref = useRef<Group>(null!);
  useFrame(() => {
    const k = explodeLocal(runtime.explode, delay);
    ref.current.position.set(position[0] + offset[0] * k, position[1] + offset[1] * k, position[2] + offset[2] * k);
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

/** Top face of a rounded rectangle with 0..1 UVs (for printed textures). */
function roundedTop(w: number, d: number, r: number) {
  const g = new ShapeGeometry(roundedRectShape(w, d, r), 10);
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + d / 2) / d);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Instance a list of positions/scales into an InstancedMesh once. */
function useInstances(ref: React.RefObject<InstancedMesh>, items: { p: V3; s?: V3; ry?: number }[]) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.scale.set(...(it.s ?? [1, 1, 1]));
      o.rotation.set(0, it.ry ?? 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ref, items]);
}

// ───────────────────────────────────────────────────────────── housing ──
function Housing() {
  const W = 6.3, D = 3.7, R = 0.75;
  const geo = useMemo(
    () => ({
      floor: roundedSlab(W, D, 0.08, R, 0.03),
      wall: roundedRing(W, D, R, 0.09, 0.82),
      glass: roundedSlab(W - 0.08, D - 0.08, 0.05, R - 0.04, 0.02),
      bezel: roundedRing(W - 0.02, D - 0.02, R - 0.01, 0.16, 0.035),
    }),
    [],
  );
  return (
    <Part id="sys.housing" shell label={false} anchor={[-2.7, 0.4, -1.6]}>
      <Sub position={SYS.chassis.pos} offset={SYS.chassis.off} delay={SYS.chassis.delay}>
        <mesh geometry={geo.floor}>
          <meshPhysicalMaterial {...M.titanium} clearcoat={0.3} clearcoatRoughness={0.4} />
        </mesh>
        <mesh geometry={geo.wall}>
          <meshPhysicalMaterial {...M.titanium} clearcoat={0.5} clearcoatRoughness={0.25} />
        </mesh>
        {/* feedthrough where the flexible interconnect enters */}
        <RoundedBox args={[0.2, 0.26, 0.62]} radius={0.04} position={[-3.12, 0.5, 0]}>
          <meshStandardMaterial {...M.titaniumDark} />
        </RoundedBox>
        <PartLabel id="sys.housing" position={[2.9, 0.4, 1.2]} side="right" lead={30} />
      </Sub>
      <Sub position={SYS.glass.pos} offset={SYS.glass.off} delay={SYS.glass.delay}>
        <mesh geometry={geo.glass} raycast={noRaycast} renderOrder={2}>
          <meshPhysicalMaterial {...GLASS} />
        </mesh>
        <mesh geometry={geo.bezel} position={[0, -0.005, 0]}>
          <meshStandardMaterial {...M.graphite} />
        </mesh>
      </Sub>
    </Part>
  );
}

// ──────────────────────────────────────────────────────────────── board ──
const FOOT = [
  { x: -2.5, z: 0, w: 0.4, d: 1.04, ref: 'J1' },
  { x: -1.45, z: -0.6, w: 1.05, d: 0.9, ref: 'U2 AFE' },
  { x: -1.45, z: 0.72, w: 0.72, d: 0.72, ref: 'U3 ADC' },
  { x: 0.15, z: 0, w: CHIP_W + 0.2, d: CHIP_W + 0.2, ref: 'U1 HBCI-02' },
  { x: 1.55, z: -0.85, w: 1.05, d: 0.7, ref: 'U4 PMU' },
  { x: 1.55, z: 0.82, w: 0.82, d: 0.72, ref: 'U5 COMMS' },
];

function inFoot(x: number, z: number, pad = 0.08) {
  return FOOT.some((f) => Math.abs(x - f.x) < f.w / 2 + pad && Math.abs(z - f.z) < f.d / 2 + pad);
}

function Pcb() {
  const board = useMemo(() => roundedSlab(PCB.w, PCB.d, PCB.t, PCB.r, 0.012), []);
  const top = useMemo(() => roundedTop(PCB.w - 0.03, PCB.d - 0.03, PCB.r - 0.015), []);
  const tex = useMemo(
    () => pcbTexture(FOOT.map((f) => ({ x: (f.x + PCB.w / 2) / PCB.w, y: (f.z + PCB.d / 2) / PCB.d, w: f.w / PCB.w, h: f.d / PCB.d, ref: f.ref })), PCB.w / PCB.d),
    [],
  );
  const traces = useMemo(() => {
    const y = PCB.t + 0.004;
    const sig: [number, number][][] = [];
    // J1 → AFE (8 electrode channels)
    for (let i = 0; i < 8; i++) {
      const z = -0.42 + i * 0.12;
      const zt = -0.95 + i * 0.09;
      sig.push([[-2.3, z], [-2.18, z], [-2.08, zt], [-1.97, zt]]);
    }
    // AFE → ADC
    for (let i = 0; i < 4; i++) sig.push([[-1.75 + i * 0.2, -0.15], [-1.75 + i * 0.2, 0.36]]);
    // ADC → HBCI-02 (multiplexed sample bus)
    for (let i = 0; i < 5; i++) {
      const z = 0.55 + i * 0.08;
      sig.push([[-1.09, z], [-0.75, z], [-0.62, z - 0.45], [-0.5, z - 0.45]]);
    }
    // HBCI-02 → COMMS (record + prediction stream)
    for (let i = 0; i < 4; i++) {
      const z = 0.2 + i * 0.08;
      sig.push([[0.81, z], [0.95, z], [1.1, z + 0.45], [1.14, z + 0.45]]);
    }
    const pwr: [number, number][][] = [
      [[1.02, -0.95], [0.6, -0.95], [0.6, -0.66]],
      [[1.02, -1.15], [-2.0, -1.15], [-2.0, -1.0]],
      [[2.07, -0.85], [2.3, -0.85], [2.3, 0.4], [1.96, 0.4]],
      [[-2.0, -1.15], [-2.0, 1.25], [-1.45, 1.25], [-1.45, 1.09]],
    ];
    return { sig: stripGeometry(sig, 0.022, 0.006, y), pwr: stripGeometry(pwr, 0.06, 0.006, y) };
  }, []);

  const vias = useMemo(() => {
    const out: { p: V3 }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400 && out.length < 90; i++) {
      const x = (rnd() - 0.5) * (PCB.w - 0.6);
      const z = (rnd() - 0.5) * (PCB.d - 0.5);
      if (!inFoot(x, z, 0.06)) out.push({ p: [x, PCB.t + 0.003, z] });
    }
    return out;
  }, []);
  const caps = useMemo(() => {
    const out: { p: V3; ry?: number }[] = [];
    for (const f of FOOT.slice(1)) {
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        out.push({ p: [f.x + side * (f.w / 2 + 0.1), PCB.t + 0.025, f.z + (i < 2 ? -0.15 : 0.15)], ry: Math.PI / 2 });
      }
    }
    return out;
  }, []);
  const viaRef = useRef<InstancedMesh>(null);
  const capRef = useRef<InstancedMesh>(null);
  useInstances(viaRef, vias);
  useInstances(capRef, caps);

  return (
    <Part id="sys.pcb" position={[0, PCB.y, 0]} label="left" lead={26} anchor={[-2.2, 0.1, 1.3]}>
      <mesh geometry={board}>
        <meshPhysicalMaterial {...M.mask} clearcoat={0.6} clearcoatRoughness={0.3} />
      </mesh>
      <mesh geometry={top} position={[0, PCB.t + 0.001, 0]}>
        <meshPhysicalMaterial map={tex} metalness={0} roughness={0.55} clearcoat={0.35} clearcoatRoughness={0.35} envMapIntensity={0.55} />
      </mesh>
      <mesh geometry={traces.sig}>
        <meshStandardMaterial {...M.copper} />
      </mesh>
      <mesh geometry={traces.pwr}>
        <meshStandardMaterial {...M.copper} />
      </mesh>
      <instancedMesh ref={viaRef} args={[undefined, undefined, vias.length]}>
        <cylinderGeometry args={[0.026, 0.026, 0.006, 10]} />
        <meshStandardMaterial {...M.gold} />
      </instancedMesh>
      <instancedMesh ref={capRef} args={[undefined, undefined, caps.length]}>
        <boxGeometry args={[0.12, 0.05, 0.07]} />
        <meshStandardMaterial {...M.ceramicTan} />
      </instancedMesh>
    </Part>
  );
}

// ───────────────────────────────────────────────────────────── modules ──
function Marking({ w, d, y, tex, metal = true }: { w: number; d: number; y: number; tex: ReturnType<typeof markingTexture>; metal?: boolean }) {
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial map={tex} metalness={metal ? 0.9 : 0.1} roughness={metal ? 0.32 : 0.6} />
    </mesh>
  );
}

function Connector() {
  const pins = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ p: [0.02, 0.17, -0.4 + (i * 0.8) / 11] as V3 })), []);
  const ref = useRef<InstancedMesh>(null);
  useInstances(ref, pins);
  return (
    <Part id="sys.connector" position={SYS.connector.pos} offset={SYS.connector.off} delay={SYS.connector.delay} anchor={[0, 0.3, -0.45]} label="left" lead={34}>
      <RoundedBox args={[0.34, 0.16, 0.98]} radius={0.025} position={[0, 0.08, 0]}>
        <meshStandardMaterial {...M.plastic} />
      </RoundedBox>
      <instancedMesh ref={ref} args={[undefined, undefined, pins.length]}>
        <boxGeometry args={[0.16, 0.025, 0.035]} />
        <meshStandardMaterial {...M.gold} />
      </instancedMesh>
      <RoundedBox args={[0.12, 0.06, 1.02]} radius={0.015} position={[0.13, 0.19, 0]}>
        <meshStandardMaterial {...M.steel} />
      </RoundedBox>
    </Part>
  );
}

function Afe() {
  const tex = useMemo(() => markingTexture([{ text: 'AFE ×8', size: 78 }, { text: 'LNA · BPF · CONCEPT', size: 34, weight: 500 }], { bg: '#9fa5ad', fg: '#3e444c', w: 512, h: 432 }), []);
  return (
    <Part id="sys.afe" position={SYS.afe.pos} offset={SYS.afe.off} delay={SYS.afe.delay} anchor={[-0.3, 0.2, -0.35]} label="left" lead={70}>
      <RoundedBox args={[0.95, 0.16, 0.8]} radius={0.02} smoothness={3} position={[0, 0.08, 0]}>
        <meshStandardMaterial {...M.steel} />
      </RoundedBox>
      <Marking w={0.86} d={0.72} y={0.162} tex={tex} />
    </Part>
  );
}

function QfnPins({ size, n, y = 0.012 }: { size: number; n: number; y?: number }) {
  const items = useMemo(() => {
    const out: { p: V3; ry?: number }[] = [];
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < n; i++) {
        const t = -size * 0.38 + (i * size * 0.76) / (n - 1);
        const e = size / 2 + 0.015;
        const p: V3 = s === 0 ? [t, y, -e] : s === 1 ? [t, y, e] : s === 2 ? [-e, y, t] : [e, y, t];
        out.push({ p, ry: s < 2 ? 0 : Math.PI / 2 });
      }
    return out;
  }, [size, n, y]);
  const ref = useRef<InstancedMesh>(null);
  useInstances(ref, items);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
      <boxGeometry args={[0.03, 0.022, 0.06]} />
      <meshStandardMaterial {...M.tin} />
    </instancedMesh>
  );
}

function Adc() {
  const tex = useMemo(() => markingTexture([{ text: 'ADC', size: 120 }, { text: '16-bit · MUX ×8', size: 46, weight: 500 }], { bg: '#2c3137', fg: '#d5d9de', dot: true }), []);
  return (
    <Part id="sys.adc" position={SYS.adc.pos} offset={SYS.adc.off} delay={SYS.adc.delay} anchor={[0, 0.16, 0.25]} label="left" lead={18}>
      <RoundedBox args={[0.6, 0.09, 0.6]} radius={0.015} position={[0, 0.045, 0]}>
        <meshStandardMaterial {...M.epoxy} />
      </RoundedBox>
      <Marking w={0.54} d={0.54} y={0.0905} tex={tex} metal={false} />
      <QfnPins size={0.6} n={7} />
    </Part>
  );
}

function Hbci01() {
  const tex = useMemo(
    () =>
      markingTexture(
        [
          { text: 'HBCI-02', size: 96, weight: 700 },
          { text: 'DSP + AI DECODER · 8 CH', size: 38, weight: 500 },
          { text: 'RTL v0.3 · CONCEPT PKG', size: 28, weight: 500, mono: true },
        ],
        { bg: '#bfc4ca', fg: '#3e444c', dot: true, border: '#8a9098' },
      ),
    [],
  );
  const seal = useMemo(() => roundedRing(1.34, 1.34, 0.06, 0.03, 0.014), []);
  return (
    <Part id="sys.hbci01" position={SYS.hbci01.pos} offset={SYS.hbci01.off} delay={SYS.hbci01.delay} anchor={[0.45, 0.26, -0.5]} label="right" lead={78}>
      <RoundedBox args={[CHIP_W, 0.05, CHIP_W]} radius={0.012} position={[0, 0.025, 0]}>
        <meshStandardMaterial {...M.laminate} />
      </RoundedBox>
      <mesh geometry={seal} position={[0, 0.05, 0]}>
        <meshStandardMaterial {...M.copper} />
      </mesh>
      <RoundedBox args={[1.24, 0.12, 1.24]} radius={0.028} smoothness={4} position={[0, 0.11, 0]}>
        <meshPhysicalMaterial {...M.nickel} clearcoat={0.6} clearcoatRoughness={0.2} />
      </RoundedBox>
      <Marking w={1.13} d={1.13} y={0.1705} tex={tex} />
      <QfnPins size={CHIP_W} n={13} y={0.01} />
    </Part>
  );
}

function Power() {
  const coil = useMemo(() => new TubeGeometry(new SpiralCurve(0.32, 1.16, 9, 0), 720, 0.021, 6, false), []);
  const lead = useMemo(
    () => new TubeGeometry(new CatmullRomCurve3([new Vector3(0.32, 0, 0), new Vector3(0.1, 0.03, 0.05), new Vector3(-0.1, 0.03, 0.2), new Vector3(-0.2, 0.06, 1.2)]), 40, 0.018, 6),
    [],
  );
  const tex = useMemo(() => markingTexture([{ text: '4R7', size: 150 }], { bg: '#2b2d33', fg: '#9aa3b0' }), []);
  return (
    <Part id="sys.power" label={false} anchor={[SYS.pmu.pos[0], SYS.pmu.pos[1] + 0.25, SYS.pmu.pos[2]]}>
      <Sub position={SYS.pmu.pos} offset={SYS.pmu.off} delay={SYS.pmu.delay}>
        <RoundedBox args={[0.42, 0.22, 0.42]} radius={0.05} position={[-0.2, 0.11, 0]}>
          <meshStandardMaterial {...M.ferrite} />
        </RoundedBox>
        <Marking w={0.36} d={0.36} y={0.2205} tex={tex} metal={false} />
        <group position={[0.25, 0, 0.05]}>
          <RoundedBox args={[0.3, 0.06, 0.3]} radius={0.01} position={[0, 0.03, 0]}>
            <meshStandardMaterial {...M.epoxy} />
          </RoundedBox>
          <QfnPins size={0.3} n={4} y={0.008} />
        </group>
        {[-0.18, 0, 0.18].map((z) => (
          <RoundedBox key={z} args={[0.1, 0.07, 0.07]} radius={0.01} position={[0.47, 0.035, z]}>
            <meshStandardMaterial {...M.ceramicTan} />
          </RoundedBox>
        ))}
        <PartLabel id="sys.power" position={[0.1, 0.3, -0.25]} side="right" lead={28} />
      </Sub>
      <Sub position={SYS.coil.pos} offset={SYS.coil.off} delay={SYS.coil.delay}>
        <mesh geometry={coil}>
          <meshStandardMaterial {...M.copper} roughness={0.22} />
        </mesh>
        <mesh geometry={lead}>
          <meshStandardMaterial {...M.copper} roughness={0.22} />
        </mesh>
        <mesh position={[0, -0.045, 0]}>
          <cylinderGeometry args={[1.28, 1.28, 0.025, 64]} />
          <meshStandardMaterial {...M.ferrite} />
        </mesh>
      </Sub>
    </Part>
  );
}

function Comms() {
  const tex = useMemo(() => markingTexture([{ text: 'COMMS', size: 92 }, { text: 'RECORD LINK · CONCEPT', size: 36, weight: 500 }], { bg: '#9fa5ad', fg: '#3e444c', w: 512, h: 440 }), []);
  const antenna = useMemo(
    () =>
      stripGeometry(
        [[[0.36, 0], [0.72, 0], [0.72, -0.6], [0.82, -0.6], [0.82, 0.48], [0.92, 0.48], [0.92, -0.6], [1.02, -0.6], [1.02, 0.42]]],
        0.035,
        0.006,
        0.004,
      ),
    [],
  );
  return (
    <Part id="sys.comms" position={SYS.comms.pos} offset={SYS.comms.off} delay={SYS.comms.delay} anchor={[0.2, 0.2, 0.3]} label="right" lead={22}>
      <RoundedBox args={[0.7, 0.13, 0.6]} radius={0.02} position={[0, 0.065, 0]}>
        <meshStandardMaterial {...M.steel} />
      </RoundedBox>
      <Marking w={0.64} d={0.55} y={0.1305} tex={tex} />
      <mesh geometry={antenna}>
        <meshStandardMaterial {...M.copper} />
      </mesh>
    </Part>
  );
}

// ────────────────────────────────────────────────── electrode + ribbon ──
function ElectrodeArray() {
  const paddle = useMemo(() => roundedSlab(1.5, 1.25, 0.03, 0.3, 0.01), []);
  const tail = useMemo(() => roundedSlab(0.62, 0.42, 0.03, 0.06, 0.01), []);
  const sites = useMemo(() => {
    const out: { p: V3 }[] = [];
    for (const z of [-0.3, 0.3]) for (const x of [-0.5, -0.17, 0.17, 0.5]) out.push({ p: [x, 0.034, z] });
    return out;
  }, []);
  const traces = useMemo(() => {
    const pl: [number, number][][] = [];
    const cols = [-0.5, -0.17, 0.17, 0.5];
    for (const [row, sign] of [[-0.3, -1], [0.3, 1]] as const) {
      cols.forEach((sx, col) => {
        const zr = row + sign * (0.14 + (3 - col) * 0.035);
        const lane = sign < 0 ? col : 7 - col;
        const zl = -0.175 + lane * 0.05;
        pl.push([[sx, row], [sx, zr], [0.6, zr], [0.8, zl], [1.28, zl]]);
      });
    }
    return stripGeometry(pl, 0.02, 0.005, 0.032);
  }, []);
  const ref = useRef<InstancedMesh>(null);
  const ringRef = useRef<InstancedMesh>(null);
  useInstances(ref, sites);
  useInstances(ringRef, sites);
  return (
    <Part id="sys.electrode_array" position={SYS.electrode.pos} offset={SYS.electrode.off} delay={SYS.electrode.delay} anchor={[-0.3, 0.1, -0.55]} label="right" lead={56}>
      <mesh geometry={paddle}>
        <meshPhysicalMaterial color={C.polyimide} roughness={0.35} metalness={0} clearcoat={0.8} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={tail} position={[1.0, 0, 0]}>
        <meshPhysicalMaterial color={C.polyimide} roughness={0.35} metalness={0} clearcoat={0.8} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={traces}>
        <meshStandardMaterial {...M.gold} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, sites.length]}>
        <cylinderGeometry args={[0.085, 0.085, 0.012, 24]} />
        <meshStandardMaterial {...M.platinum} />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, sites.length]}>
        <torusGeometry args={[0.105, 0.012, 6, 28]} />
        <meshStandardMaterial {...M.gold} />
      </instancedMesh>
    </Part>
  );
}

/** Current endpoints of the flex ribbon (follow the exploded electrode and connector). */
function flexEnds(e: number) {
  const a = add(SYS.electrode.pos, SYS.electrode.off, explodeLocal(e, SYS.electrode.delay)).add(new Vector3(1.3, 0.015, 0));
  const b = add(SYS.connector.pos, SYS.connector.off, explodeLocal(e, SYS.connector.delay)).add(new Vector3(-0.17, 0.08, 0));
  return [a, b] as const;
}

function FlexInterconnect() {
  const geo = useMemo(() => new BufferGeometry(), []);
  const traceGeos = useMemo(() => Array.from({ length: 8 }, () => new BufferGeometry()), []);
  const labelRef = useRef<Group>(null!);
  const last = useRef(-1);
  const side = useMemo(() => new Vector3(0, 0, 1), []);
  useFrame(() => {
    const e = runtime.explode;
    if (Math.abs(e - last.current) < 2e-4) return;
    last.current = e;
    const [a, b] = flexEnds(e);
    const mid = new Vector3().lerpVectors(a, b, 0.55);
    mid.y = Math.max(a.y, b.y) + 0.28;
    const curve = new CatmullRomCurve3([a, a.clone().add(new Vector3(0.4, 0, 0)), mid, b.clone().add(new Vector3(-0.42, 0, 0)), b], false, 'centripetal');
    const pts = curve.getPoints(60);
    writeRibbon(geo, pts, 0.4, 0.016, side);
    traceGeos.forEach((g, i) => writeRibbon(g, pts, 0.02, 0.004, side, -0.175 + i * 0.05, 0.01));
    const m = pts[30];
    labelRef.current.position.copy(m);
    const o = labelRef.current.parent?.parent;
    if (o) o.userData.anchor = [m.x, m.y, m.z];
  });
  return (
    <Part id="sys.flex_interconnect" label={false}>
      <mesh geometry={geo}>
        <meshPhysicalMaterial color={C.polyimide} roughness={0.3} metalness={0} clearcoat={0.9} transparent opacity={0.88} side={DoubleSide} />
      </mesh>
      {traceGeos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial {...M.copper} />
        </mesh>
      ))}
      <group ref={labelRef}>
        <PartLabel id="sys.flex_interconnect" position={[0, 0.02, 0.2]} side="left" lead={16} />
      </group>
    </Part>
  );
}

// ─────────────────────────────────────────────────────── external AI ──
const VIOLET = '#8a63c9';
const PLATE = { w: 0.74, h: 0.46, t: 0.024, y: 0.34, z: -0.1, tilt: -0.42, lift: 0.5 };

/** One loop stage hosted by the external AI module (external decoder for larger models: not implemented; LLM: scripted). */
function LoopStagePlate({ id, x, delay, kind }: { id: 'loop.ext_decoder' | 'loop.llm'; x: number; delay: number; kind: 'ghost' | 'scripted' }) {
  const ghost = kind === 'ghost';
  const tex = useMemo(
    () =>
      ghost
        ? stagePlateTexture({ title: 'LARGER DECODER', sub: 'small decoder is on the chip (RTL)', tag: 'NOT IMPLEMENTED', fg: '#d9dbe3', bg: '#2f3239', accent: '#9a9fae', dashed: true, icon: 'net' })
        : stagePlateTexture({ title: 'LANGUAGE MODEL', sub: 'reasons over an authorised request', tag: 'SCRIPTED EXAMPLE', fg: '#efe9f8', bg: '#312a40', accent: '#b9a1e3', icon: 'chat' }),
    [ghost],
  );
  return (
    <Part
      id={id}
      position={[x, PLATE.y, PLATE.z]}
      rotation={[PLATE.tilt, 0, 0]}
      offset={[0, PLATE.lift, 0]}
      delay={delay}
      anchor={[ghost ? -PLATE.w * 0.3 : -PLATE.w * 0.1, PLATE.h, 0]}
      label="left"
      lead={ghost ? 30 : 104}
      labelText={ghost ? 'Larger decoder · not implemented (small one on chip)' : 'Language model · scripted example'}
    >
      <mesh position={[0, PLATE.h / 2, 0]}>
        <boxGeometry args={[PLATE.w, PLATE.h, PLATE.t]} />
        {ghost ? (
          <meshStandardMaterial color="#9a9fae" metalness={0.1} roughness={0.6} transparent opacity={0.14} depthWrite={false} />
        ) : (
          <meshPhysicalMaterial color="#3a3148" metalness={0.3} roughness={0.35} clearcoat={0.5} />
        )}
      </mesh>
      <mesh position={[0, PLATE.h / 2, PLATE.t / 2 + 0.002]}>
        <planeGeometry args={[PLATE.w - 0.02, PLATE.h - 0.02]} />
        {ghost ? (
          <meshBasicMaterial map={tex} transparent opacity={0.66} depthWrite={false} toneMapped={false} />
        ) : (
          <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.3} metalness={0.1} roughness={0.45} />
        )}
      </mesh>
    </Part>
  );
}

function AiModule() {
  const body = useMemo(() => roundedSlab(1.7, 1.15, 0.28, 0.22, 0.04), []);
  const tex = useMemo(() => neuralTexture(), []);
  return (
    <Part id="sys.ai_module" position={SYS.ai.pos} offset={SYS.ai.off} delay={SYS.ai.delay} anchor={[-0.6, 0.12, 0.58]} label="left" lead={14}>
      <mesh geometry={body}>
        <meshPhysicalMaterial {...M.anodized} clearcoat={0.5} clearcoatRoughness={0.35} />
      </mesh>
      <mesh position={[0, 0.282, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.42, 0.92]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.25} metalness={0.2} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.14, 0.578]}>
        <boxGeometry args={[1.1, 0.025, 0.01]} />
        <meshStandardMaterial color={C.teal} emissive={C.teal} emissiveIntensity={0.35} />
      </mesh>
      <LoopStagePlate id="loop.ext_decoder" x={-0.42} delay={0.1} kind="ghost" />
      <LoopStagePlate id="loop.llm" x={0.42} delay={0.16} kind="scripted" />
      <Sub position={[0, PLATE.y + PLATE.h * 0.48, PLATE.z + 0.02]} offset={[0, PLATE.lift, 0]} delay={0.13}>
        <mesh rotation={[0, 0, -Math.PI / 2]} raycast={noRaycast}>
          <coneGeometry args={[0.045, 0.1, 12]} />
          <meshStandardMaterial color="#b9a6dc" emissive={VIOLET} emissiveIntensity={0.3} />
        </mesh>
      </Sub>
    </Part>
  );
}

// ───────────────────────────────────────── feedback (research branch) ──
const FB = { panel: [-5.05, 1.7, -1.7] as V3, off: [-1.3, 0.7, -0.2] as V3, delay: 0.06, w: 0.95, h: 0.56 };
const FB_COLORS = ['#1e7d4a', '#8a6400', VIOLET];

function feedbackEnds(e: number) {
  const ai = add(SYS.ai.pos, SYS.ai.off, explodeLocal(e, SYS.ai.delay));
  const k = explodeLocal(e, 0.16);
  const s = ai.add(new Vector3(0.42, PLATE.y + PLATE.h + PLATE.lift * k - 0.05, PLATE.z - 0.2));
  const p = add(FB.panel, FB.off, explodeLocal(e, FB.delay));
  return { s, p, end: p.clone().add(new Vector3(FB.w / 2 + 0.02, FB.h * 0.75, 0)) };
}

/**
 * The return path of the READ–COMPUTE–FEEDBACK loop: a dashed violet arc from the language-model
 * stage back to a software-only indicator on the person's side. Not a neural return channel.
 */
function FeedbackLoop() {
  const tube = useMemo(() => new BufferGeometry(), []);
  const panelTex = useMemo(() => feedbackPanelTexture(), []);
  const line = useRef<React.ElementRef<typeof Line>>(null!);
  const pulses = useRef<InstancedMesh>(null!);
  const panel = useRef<Group>(null!);
  const labelRef = useRef<Group>(null!);
  const pills = useRef<(Mesh | null)[]>([]);
  const pts = useRef<Vector3[]>([]);
  const last = useRef(-1);
  const init = useMemo(() => Array.from({ length: 65 }, (_, i) => [i * 0.01, 0, 0] as V3), []);
  const tmp = useMemo(() => ({ o: new Object3D(), buf: [] as number[] }), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const e = runtime.explode;
    if (Math.abs(e - last.current) > 2e-4) {
      last.current = e;
      const { s, p, end } = feedbackEnds(e);
      const apexY = Math.max(s.y, end.y) + 1.6;
      const curve = new CatmullRomCurve3(
        [s, new Vector3(s.x - 0.5, s.y + 0.9, s.z - 0.6), new Vector3(2.0, apexY, -2.4), new Vector3(-2.6, apexY, -2.4), new Vector3(end.x + 0.6, end.y + 0.8, end.z - 0.3), end],
        false,
        'centripetal',
      );
      pts.current = curve.getPoints(64);
      writeTube(tube, pts.current, 0.028, 6);
      tmp.buf.length = 0;
      for (const v of pts.current) tmp.buf.push(v.x, v.y, v.z);
      line.current.geometry.setPositions(tmp.buf);
      line.current.computeLineDistances();
      panel.current.position.copy(p);
      const apex = pts.current[32];
      labelRef.current.position.copy(apex);
      const o = labelRef.current.parent?.parent;
      if (o) o.userData.anchor = [apex.x, apex.y, apex.z];
    }
    const mat = line.current.material as unknown as { dashOffset: number };
    if (runtime.motion) mat.dashOffset -= dt * 0.8;
    // indicator steps ready → uncertain → clarify (illustrative; driven by nothing real); static when motion is reduced
    const lit = runtime.reducedMotion ? 0 : Math.floor(runtime.time / 1.8) % 3;
    pills.current.forEach((m, i) => {
      if (!m) return;
      (m.material as MeshStandardMaterial).emissiveIntensity = i === lit ? 0.9 : 0.1;
    });
    const P = pts.current;
    pulses.current.count = runtime.motion ? 4 : 0;
    if (P.length > 1 && runtime.motion) {
      for (let k = 0; k < 4; k++) {
        const u = (runtime.time * 0.16 + k / 4) % 1;
        const f = u * (P.length - 1);
        const i = Math.min(P.length - 2, Math.floor(f));
        tmp.o.position.lerpVectors(P[i], P[i + 1], f - i);
        tmp.o.updateMatrix();
        pulses.current.setMatrixAt(k, tmp.o.matrix);
      }
      pulses.current.instanceMatrix.needsUpdate = true;
    }
  });
  const pillX = (i: number) => (48 / 512 - 0.5) * FB.w + i * (160 / 512) * FB.w;
  const pillY = FB.h / 2 + (0.5 - 230 / 300) * FB.h;
  return (
    <Part id="loop.feedback" label={false}>
      <mesh geometry={tube}>
        <meshStandardMaterial color="#5a4a78" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <Line ref={line} points={init} color={VIOLET} lineWidth={1.8} dashed dashSize={0.2} gapSize={0.14} transparent opacity={0.9} toneMapped={false} raycast={noRaycast} />
      <instancedMesh ref={pulses} args={[undefined, undefined, 4]} frustumCulled={false} raycast={noRaycast}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshBasicMaterial color={VIOLET} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <group ref={panel} position={FB.panel}>
        <group rotation={[-0.3, 0.35, 0]}>
          <RoundedBox args={[FB.w + 0.06, FB.h + 0.06, 0.05]} radius={0.02} position={[0, FB.h / 2, -0.03]}>
            <meshStandardMaterial {...M.anodized} />
          </RoundedBox>
          <mesh position={[0, FB.h / 2, 0.0]}>
            <planeGeometry args={[FB.w, FB.h]} />
            <meshStandardMaterial map={panelTex} emissiveMap={panelTex} emissive="#ffffff" emissiveIntensity={0.3} metalness={0.1} roughness={0.45} />
          </mesh>
          {FB_COLORS.map((c, i) => (
            <mesh key={c} ref={(m) => (pills.current[i] = m)} position={[pillX(i), pillY, 0.012]}>
              <cylinderGeometry args={[0.032, 0.032, 0.018, 16]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.1} />
            </mesh>
          ))}
        </group>
      </group>
      <group ref={labelRef}>
        <PartLabel id="loop.feedback" position={[0, 0.05, 0]} side="right" lead={24} text="Feedback · research branch · software-only" />
      </group>
    </Part>
  );
}

/** Dashed, animated wireless data beam: comms → external AI module. */
function DataBeam() {
  const ref = useRef<React.ElementRef<typeof Line>>(null!);
  const init = useMemo(() => Array.from({ length: 33 }, (_, i) => [i * 0.1, 0, 0] as V3), []);
  const a = useMemo(() => new Vector3(), []);
  const b = useMemo(() => new Vector3(), []);
  const buf = useMemo<number[]>(() => [], []);
  useLayoutEffect(() => {
    ref.current.userData.selfVisible = true;
  }, []);
  useFrame((_, dt) => {
    const line = ref.current;
    const s = useScene.getState();
    const g = levelGroups.system;
    const ok = !!g && isVisible(s, 'sys.comms') && isVisible(s, 'loop.ext_decoder') && !runtime.transitionActive && runtime.presetOpacity.bench > 0.01;
    line.visible = ok;
    if (!ok || !partAnchorWorld('sys.comms', a) || !partAnchorWorld('loop.ext_decoder', b)) return;
    g!.worldToLocal(a);
    g!.worldToLocal(b);
    a.y += 0.1;
    arcPoints(a, b, 1.1 + a.distanceTo(b) * 0.08, 32, buf);
    line.geometry.setPositions(buf);
    line.computeLineDistances();
    const mat = line.material as unknown as { dashOffset: number; color: { copy: (c: unknown) => void } };
    if (runtime.motion) mat.dashOffset -= Math.min(dt, 0.05) * 0.9;
    mat.color.copy(themeColors.accent);
  });
  return (
    <Part>
      <Line ref={ref} points={init} color={C.teal} lineWidth={1.4} dashed dashSize={0.16} gapSize={0.11} transparent opacity={0.8} toneMapped={false} />
    </Part>
  );
}

export function SystemScene() {
  return (
    <group>
      <Housing />
      <Pcb />
      <Connector />
      <Afe />
      <Adc />
      <Hbci01 />
      <Power />
      <Comms />
      <ElectrodeArray />
      <FlexInterconnect />
      <AiModule />
      <DataBeam />
      <FeedbackLoop />
    </group>
  );
}
