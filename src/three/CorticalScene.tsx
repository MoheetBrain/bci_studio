// System preset "Thin cortical-interface candidate": a CONCEPT scene, deliberately not the bench
// board scaled down. Blueprint / hologram styling, layers that explode vertically, and NO physical
// dimensions anywhere. Electrode sites, recording channels and processing channels are drawn
// differently so the three counts are never confused. Every layer carries its registry id.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import {
  BufferAttribute,
  Color,
  DoubleSide,
  Object3D,
  PlaneGeometry,
  Quaternion,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import { Part, PartLabel } from './Part';
import { GLASS, M, blueprintTexture, relayTexture, tileTexture } from './materials';
import { SpiralCurve } from './geometry';
import { explodeLocal, runtime, smoothstep } from './viewStore';

type V3 = [number, number, number];
const noRaycast = () => null;

const CURV = 0.042;
const BASE_Y = -0.3;
/** Gentle dome shared by every layer so the stack conforms to a curved surface. */
const dome = (x: number, z: number) => -CURV * (x * x + z * z);
const UP = new Vector3(0, 1, 0);
const domeNormal = (x: number, z: number, out = new Vector3()) => out.set(2 * CURV * x, 1, 2 * CURV * z).normalize();
const superR = (u: number, v: number, p = 6) => Math.pow(Math.pow(Math.abs(u), p) + Math.pow(Math.abs(v), p), 1 / p);

/** Assembled height above the dome, vertical explode offset and stagger for each layer. */
export const CX = {
  cortex: { h: -0.05 },
  film: { h: 0, off: 0.75, delay: 0.04, w: 6.0, d: 4.2 },
  substrate: { h: 0.07, off: 1.5, delay: 0.08, w: 6.2, d: 4.4 },
  electronics: { h: 0.12, off: 2.25, delay: 0.12 },
  encap: { h: 0.24, off: 3.05, delay: 0.16, w: 6.7, d: 4.9, roll: 0.34 },
  relay: { pos: [0, 1.55, 0.25] as V3, off: 2.4, delay: 0.2 },
};

// Paper & Graphite: a restrained blueprint look. The three kinds of "channel" keep distinct hues.
const COL = {
  outline: '#6b8fb0',
  site: '#c9cfd6',
  rec: '#0b6f85',
  proc: '#b0532a',
};

// ─────────────────────────────────────────────────────────── geometry ──
function curvedSheet(w: number, d: number, sx: number, sz: number, h: number, roll = 0): BufferGeometry {
  const g = new PlaneGeometry(w, d, sx, sz);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let y = dome(x, z) + h;
    if (roll) y -= roll * smoothstep(0.8, 1, superR(x / (w / 2), z / (d / 2)));
    p.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

/** Boundary of a curved sheet as a closed polyline (for blueprint outlines). */
function borderPoints(w: number, d: number, h: number, roll = 0, n = 20): V3[] {
  const out: V3[] = [];
  const corners: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]];
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c], [bx, bz] = corners[c + 1];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      out.push([x, dome(x, z) + h - roll, z]);
    }
  }
  out.push(out[0]);
  return out;
}

/** Gyri-like folds: meandering sulci from domain-warped sines (0 at a crown, ~0.22 deep in a sulcus). */
function fold(x: number, z: number): number {
  // zero set of a sum of warped sines: a maze-like network of sulci between broad gyri
  const u = x * 1.55 + 0.9 * Math.sin(z * 1.3 + 0.4) + 0.4 * Math.sin(z * 3.1 + x * 1.7);
  const v = z * 1.55 + 0.9 * Math.sin(x * 1.1 + 1.3) + 0.4 * Math.sin(x * 2.9 - z * 1.5);
  const s = Math.sin(u) + Math.sin(v) + 0.6 * Math.sin((u + v) * 0.7 + 1.2);
  const ridge = Math.pow(Math.min(1, Math.abs(s) / 1.1), 0.5);
  return (1 - ridge) * 0.2;
}

const CORTEX_W = 9.0, CORTEX_D = 6.4;
function cortexY(x: number, z: number) {
  const r = superR(x / (CORTEX_W / 2), z / (CORTEX_D / 2), 4);
  return dome(x, z) + CX.cortex.h - fold(x, z) - 0.55 * smoothstep(0.72, 1, r);
}

function cortexGeometry(sx: number, sz: number, withColor: boolean): BufferGeometry {
  const g = new PlaneGeometry(CORTEX_W, CORTEX_D, sx, sz);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  const col = withColor ? new Float32Array(p.count * 4) : null;
  const crown = new Color('#b9838c'), sulcus = new Color('#3e1a2b'), c = new Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, cortexY(x, z) + (withColor ? 0 : 0.012));
    if (col) {
      const t = fold(x, z) / 0.2;
      c.copy(crown).lerp(sulcus, Math.pow(t, 0.8));
      const r = superR(x / (CORTEX_W / 2), z / (CORTEX_D / 2), 4);
      col.set([c.r, c.g, c.b, 1 - smoothstep(0.84, 1, r)], i * 4);
    }
  }
  if (col) g.setAttribute('color', new BufferAttribute(col, 4));
  g.computeVertexNormals();
  return g;
}

/** Instance matrices for objects sitting on the dome at height h, oriented to its normal. */
function placeOnDome(m: InstancedMesh, pts: [number, number][], h: number) {
  const o = new Object3D();
  const n = new Vector3();
  pts.forEach(([x, z], i) => {
    o.position.set(x, dome(x, z) + h, z);
    o.quaternion.setFromUnitVectors(UP, domeNormal(x, z, n));
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  });
  m.count = pts.length;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.computeBoundingBox();
}

function Outline({ pts, opacity = 0.65 }: { pts: V3[]; opacity?: number }) {
  return <Line points={pts} color={COL.outline} lineWidth={1.3} transparent opacity={opacity} toneMapped={false} raycast={noRaycast} />;
}

// ─────────────────────────────────────────────────────────────── cortex ──
function Cortex() {
  const geo = useMemo(() => cortexGeometry(150, 106, true), []);
  const wire = useMemo(() => cortexGeometry(54, 38, false), []);
  return (
    <Part id="cx.cortex" anchor={[-2.2, cortexY(-2.2, 2.4) + 0.05, 2.4]} label="left" lead={20} labelText="Cortical surface (illustrative)">
      <mesh geometry={geo}>
        <meshPhysicalMaterial vertexColors transparent roughness={0.66} metalness={0} clearcoat={0.18} clearcoatRoughness={0.5} envMapIntensity={0.45} side={DoubleSide} />
      </mesh>
      <mesh geometry={wire} raycast={noRaycast}>
        <meshBasicMaterial wireframe color={COL.outline} transparent opacity={0.08} depthWrite={false} toneMapped={false} />
      </mesh>
    </Part>
  );
}

// ───────────────────────────────────────────────────────── electrode film ──
const NX = 56, NZ = 36, BLOCK = 4;
const SITE_STEP_X = (CX.film.w * 0.92) / (NX - 1);
const SITE_STEP_Z = (CX.film.d * 0.9) / (NZ - 1);
const siteXZ = (ix: number, iz: number): [number, number] => [(ix - (NX - 1) / 2) * SITE_STEP_X, (iz - (NZ - 1) / 2) * SITE_STEP_Z];
/** Recording channels: one site per 4×4 block is connected at a time; the multiplexer steps through them. */
const N_REC = (NX / BLOCK) * (NZ / BLOCK);
const MUX_STEP_S = 0.45;

function ElectrodeFilm() {
  const sheet = useMemo(() => curvedSheet(CX.film.w, CX.film.d, 40, 28, CX.film.h), []);
  const outline = useMemo(() => borderPoints(CX.film.w, CX.film.d, CX.film.h), []);
  const sites = useRef<InstancedMesh>(null!);
  const rings = useRef<InstancedMesh>(null!);
  const lastStep = useRef(-1);
  const all = useMemo(() => {
    const out: [number, number][] = [];
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) out.push(siteXZ(ix, iz));
    return out;
  }, []);
  useLayoutEffect(() => placeOnDome(sites.current, all, CX.film.h - 0.004), [all]);
  useFrame(() => {
    // the multiplexer steps through the sites; frozen on one subset when motion is reduced
    const step = runtime.reducedMotion ? 0 : Math.floor(runtime.time / MUX_STEP_S) % (BLOCK * BLOCK);
    if (step === lastStep.current) return;
    lastStep.current = step;
    const sx = step % BLOCK, sz = Math.floor(step / BLOCK);
    const pts: [number, number][] = [];
    for (let bz = 0; bz < NZ / BLOCK; bz++) for (let bx = 0; bx < NX / BLOCK; bx++) pts.push(siteXZ(bx * BLOCK + sx, bz * BLOCK + sz));
    placeOnDome(rings.current, pts, CX.film.h + 0.004);
  });
  const siteLbl = siteXZ(5, 31);
  const recLbl = siteXZ(NX - 7, 30);
  return (
    <Part
      id="cx.electrode_film"
      offset={[0, CX.film.off, 0]}
      delay={CX.film.delay}
      anchor={[2.95, dome(2.95, -1.6) + 0.02, -1.6]}
      label="right"
      lead={34}
      labelText="Electrode layer · sites ≠ channels"
    >
      <mesh geometry={sheet}>
        <meshPhysicalMaterial color="#9fb6c9" transparent opacity={0.22} roughness={0.25} metalness={0} clearcoat={0.8} side={DoubleSide} depthWrite={false} />
      </mesh>
      <Outline pts={outline} />
      <instancedMesh ref={sites} args={[undefined, undefined, NX * NZ]}>
        <cylinderGeometry args={[0.03, 0.03, 0.01, 8]} />
        <meshStandardMaterial color={COL.site} metalness={0.9} roughness={0.25} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[undefined, undefined, N_REC]} raycast={noRaycast}>
        <torusGeometry args={[0.05, 0.011, 5, 14]} />
        <meshBasicMaterial color={COL.rec} toneMapped={false} />
      </instancedMesh>
      <PartLabel id="cx.electrode_film" position={[siteLbl[0], dome(...siteLbl) + 0.02, siteLbl[1]]} side="left" lead={22} text="electrode sites · illustrative grid" cls="cl-site" />
      <PartLabel id="cx.electrode_film" position={[recLbl[0], dome(...recLbl) + 0.02, recLbl[1]]} side="right" lead={18} text="recording channels · multiplexed subset (cycling)" cls="cl-rec" />
    </Part>
  );
}

// ─────────────────────────────────────────────────────────── substrate ──
function Substrate() {
  const sheet = useMemo(() => curvedSheet(CX.substrate.w, CX.substrate.d, 40, 28, CX.substrate.h), []);
  const outline = useMemo(() => borderPoints(CX.substrate.w, CX.substrate.d, CX.substrate.h), []);
  const tex = useMemo(() => blueprintTexture(), []);
  return (
    <Part
      id="cx.substrate"
      offset={[0, CX.substrate.off, 0]}
      delay={CX.substrate.delay}
      anchor={[-3.05, dome(-3.05, -1.9) + CX.substrate.h, -1.9]}
      label="left"
      lead={40}
    >
      <mesh geometry={sheet}>
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.12} transparent opacity={0.9} metalness={0.1} roughness={0.55} side={DoubleSide} />
      </mesh>
      <Outline pts={outline} />
    </Part>
  );
}

// ───────────────────────────────────────────────────── thinned electronics ──
const TILES: { x: number; z: number; title: string; sub: string; accent: string; lanes?: number }[] = [
  { x: -1.75, z: -0.62, title: 'AFE', sub: 'candidate · not designed', accent: '#7f9fc6' },
  { x: 0, z: -0.62, title: 'ADC', sub: 'candidate · not designed', accent: '#7f9fc6' },
  { x: 1.75, z: -0.62, title: 'POWER', sub: 'candidate · not designed', accent: '#a3a7b4' },
  { x: -1.75, z: 0.62, title: 'AFE', sub: 'candidate · not designed', accent: '#7f9fc6' },
  { x: 0, z: 0.62, title: 'READOUT', sub: 'HBCI-02-like core · 8 ch', accent: '#d9865a', lanes: 8 },
  { x: 1.75, z: 0.62, title: 'LINK', sub: 'candidate · not designed', accent: '#a3a7b4' },
];
const TILE = { w: 1.0, d: 0.72, t: 0.03 };
const READOUT_TILE = TILES[4];

function Tile({ t, laneRefs }: { t: (typeof TILES)[number]; laneRefs?: React.MutableRefObject<(Mesh | null)[]> }) {
  const tex = useMemo(() => tileTexture(t.title, t.sub, t.accent, t.lanes ?? 0), [t]);
  const q = useMemo(() => new Quaternion().setFromUnitVectors(UP, domeNormal(t.x, t.z)), [t]);
  const laneZ = (i: number) => ((142 + i * 26) / 360 - 0.5) * TILE.d;
  return (
    <group position={[t.x, dome(t.x, t.z) + CX.electronics.h, t.z]} quaternion={q}>
      <mesh position={[0, TILE.t / 2, 0]}>
        <boxGeometry args={[TILE.w, TILE.t, TILE.d]} />
        <meshPhysicalMaterial color="#2f343b" metalness={0.6} roughness={0.35} clearcoat={0.5} />
      </mesh>
      <mesh position={[0, TILE.t + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TILE.w - 0.02, TILE.d - 0.02]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.15} metalness={0.3} roughness={0.45} />
      </mesh>
      {laneRefs &&
        Array.from({ length: t.lanes ?? 0 }, (_, i) => (
          <mesh key={i} ref={(m) => (laneRefs.current[i] = m)} position={[0.06, TILE.t + 0.006, laneZ(i)]}>
            <boxGeometry args={[0.74, 0.008, 0.032]} />
            <meshStandardMaterial color="#5a3a26" emissive={COL.proc} emissiveIntensity={0.2} />
          </mesh>
        ))}
    </group>
  );
}

function Electronics() {
  const lanes = useRef<(Mesh | null)[]>([]);
  useFrame(() => {
    // the 8 processing channels are served in turn (illustrative, no data); a moving highlight, static when motion is reduced
    const t = runtime.time * 2.4;
    lanes.current.forEach((m, i) => {
      if (!m) return;
      const ph = runtime.reducedMotion ? (i === 0 ? 1 : 0) : Math.cos(t - i * 0.78);
      (m.material as MeshStandardMaterial).emissiveIntensity = 0.2 + 0.9 * Math.pow(Math.max(0, ph), 8);
    });
  });
  const lblX = READOUT_TILE.x + 0.38, lblZ = READOUT_TILE.z + 0.2;
  return (
    <Part
      id="cx.electronics"
      offset={[0, CX.electronics.off, 0]}
      delay={CX.electronics.delay}
      anchor={[2.3, dome(2.3, -0.62) + CX.electronics.h + 0.04, -0.62]}
      label="right"
      lead={46}
      labelText="Candidate thinned electronics"
    >
      {TILES.map((t, i) => (
        <Tile key={i} t={t} laneRefs={t.lanes ? lanes : undefined} />
      ))}
      <PartLabel
        id="cx.electronics"
        position={[lblX, dome(lblX, lblZ) + CX.electronics.h + 0.05, lblZ]}
        side="right"
        lead={26}
        text="processing channels · HBCI-02 implements 8 (RTL)"
        cls="cl-proc"
      />
    </Part>
  );
}

// ─────────────────────────────────────────────────────────── encapsulation ──
function Encapsulation() {
  const sheet = useMemo(() => curvedSheet(CX.encap.w, CX.encap.d, 48, 34, CX.encap.h, CX.encap.roll), []);
  const outline = useMemo(() => borderPoints(CX.encap.w, CX.encap.d, CX.encap.h, CX.encap.roll), []);
  return (
    <Part
      id="cx.encapsulation"
      shell
      offset={[0, CX.encap.off, 0]}
      delay={CX.encap.delay}
      anchor={[-3.0, dome(-3.0, 1.2) + CX.encap.h - 0.1, 1.2]}
      label="left"
      lead={58}
    >
      <mesh geometry={sheet} renderOrder={2}>
        <meshPhysicalMaterial {...GLASS} color="#c9d8e2" opacity={0.14} side={DoubleSide} />
      </mesh>
      <Outline pts={outline} opacity={0.45} />
    </Part>
  );
}

// ─────────────────────────────────────────────────────────────── relay ──
function readoutTileY(e: number) {
  return dome(READOUT_TILE.x, READOUT_TILE.z) + CX.electronics.h + TILE.t + CX.electronics.off * explodeLocal(e, CX.electronics.delay);
}

function Relay() {
  const tex = useMemo(() => relayTexture(), []);
  const coil = useMemo(() => new TubeGeometry(new SpiralCurve(0.2, 0.72, 7, 0), 420, 0.012, 5, false), []);
  const power = useRef<React.ElementRef<typeof Line>>(null!);
  const data = useRef<React.ElementRef<typeof Line>>(null!);
  const last = useRef(-1);
  const init = useMemo(() => Array.from({ length: 2 }, (_, i) => [0, -i, 0] as V3), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const e = runtime.explode;
    if (Math.abs(e - last.current) > 2e-4) {
      last.current = e;
      // relay-local coordinates of the readout tile (both share the scene frame)
      const ry = CX.relay.pos[1] + CX.relay.off * explodeLocal(e, CX.relay.delay);
      const ty = readoutTileY(e) - ry;
      const dz = READOUT_TILE.z - CX.relay.pos[2];
      power.current.geometry.setPositions([-0.14, -0.12, 0, -0.14, ty, dz]);
      data.current.geometry.setPositions([0.14, ty, dz, 0.14, -0.12, 0]);
      power.current.computeLineDistances();
      data.current.computeLineDistances();
    }
    if (runtime.motion) {
      (power.current.material as unknown as { dashOffset: number }).dashOffset -= dt * 0.7;
      (data.current.material as unknown as { dashOffset: number }).dashOffset -= dt * 0.9;
    }
  });
  return (
    <Part
      id="cx.relay"
      position={CX.relay.pos}
      offset={[0, CX.relay.off, 0]}
      delay={CX.relay.delay}
      anchor={[0.85, 0.08, 0]}
      label="right"
      lead={30}
    >
      <mesh>
        <cylinderGeometry args={[0.85, 0.85, 0.16, 48]} />
        <meshPhysicalMaterial {...M.anodized} clearcoat={0.7} clearcoatRoughness={0.25} />
      </mesh>
      <mesh position={[0, 0.081, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.8, 48]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.2} metalness={0.2} roughness={0.45} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} raycast={noRaycast}>
        <torusGeometry args={[0.855, 0.014, 6, 64]} />
        <meshStandardMaterial color={COL.rec} emissive={COL.rec} emissiveIntensity={0.35} />
      </mesh>
      <mesh geometry={coil} position={[0, -0.092, 0]}>
        <meshStandardMaterial {...M.copper} roughness={0.25} />
      </mesh>
      <Line ref={power} points={init} color="#8a6400" lineWidth={1.4} dashed dashSize={0.1} gapSize={0.09} transparent opacity={0.85} toneMapped={false} raycast={noRaycast} />
      <Line ref={data} points={init} color={COL.rec} lineWidth={1.4} dashed dashSize={0.1} gapSize={0.09} transparent opacity={0.85} toneMapped={false} raycast={noRaycast} />
    </Part>
  );
}

// ──────────────────────────────────────────────── explode guides (decor) ──
function StackGuides() {
  const refs = useRef<(React.ElementRef<typeof Line> | null)[]>([]);
  const last = useRef(-1);
  const corners = useMemo<[number, number][]>(() => [[-CX.film.w / 2, -CX.film.d / 2], [CX.film.w / 2, -CX.film.d / 2]], []);
  const init = useMemo(() => [[0, 0, 0], [0, 1, 0]] as V3[], []);
  useFrame(() => {
    const e = runtime.explode;
    if (Math.abs(e - last.current) < 2e-4) return;
    last.current = e;
    corners.forEach(([x, z], i) => {
      const l = refs.current[i];
      if (!l) return;
      const y0 = dome(x, z) + CX.film.h + CX.film.off * explodeLocal(e, CX.film.delay);
      const y1 = dome(x, z) + CX.encap.h - CX.encap.roll + CX.encap.off * explodeLocal(e, CX.encap.delay);
      l.geometry.setPositions([x, y0, z, x, Math.max(y0 + 0.01, y1), z]);
      l.computeLineDistances();
    });
  });
  return (
    <Part>
      {corners.map((_, i) => (
        <Line key={i} ref={(l) => (refs.current[i] = l)} points={init} color={COL.outline} lineWidth={1} dashed dashSize={0.06} gapSize={0.06} transparent opacity={0.4} toneMapped={false} raycast={noRaycast} />
      ))}
    </Part>
  );
}

export function CorticalScene() {
  return (
    <group position={[0, BASE_Y, 0]}>
      <Cortex />
      <ElectrodeFilm />
      <Substrate />
      <Electronics />
      <Encapsulation />
      <Relay />
      <StackGuides />
    </group>
  );
}
