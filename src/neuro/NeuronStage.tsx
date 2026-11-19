// The 3D stage of the Neurons scene: a schematic patch of cortex (invented cell shapes), one neuron driven by the
// Hodgkin–Huxley model, and one electrode shank with a single active contact. Everything drawn is a function of the
// timeline position, read every frame through `now()`; nothing is integrated here.
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Fog, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points,
  PointsMaterial, SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { mulberry32 } from '../journey/model/chain';
import { sampleAt } from './model/hh';
import { axonPulses, type Cell, type ColumnResult } from './model/column';

const V = (p: readonly [number, number, number]) => new Vector3(p[0], p[1], p[2]);
const FOCUS = new Color('#F29BC0'), OTHER = new Color('#6F6AA8'), HOT = new Color('#FFE9C4'), AXON = new Color('#BFD4FF');

interface Built { group: Group; soma: MeshStandardMaterial; neurite: MeshStandardMaterial; axonCurve: CatmullRomCurve3; axonLength: number; pulses: Mesh[]; cell: Cell }

function buildCell(c: Cell, pulseGeom: SphereGeometry): Built {
  const focus = c.id === 0;
  const group = new Group();
  const soma = new MeshStandardMaterial({ color: focus ? FOCUS : OTHER, roughness: 0.5, metalness: 0, emissive: HOT, emissiveIntensity: 0 });
  const neurite = new MeshStandardMaterial({ color: focus ? FOCUS.clone().multiplyScalar(0.85) : OTHER.clone().multiplyScalar(0.8), roughness: 0.65, emissive: HOT, emissiveIntensity: 0, transparent: !focus, opacity: focus ? 1 : 0.62 });
  const axonMat = new MeshStandardMaterial({ color: AXON, roughness: 0.6, transparent: true, opacity: focus ? 0.9 : 0.45 });
  const body = new Mesh(new SphereGeometry(c.radius, 28, 20), soma);
  body.scale.set(1, 1.28, 1);
  body.position.copy(V(c.soma));
  group.add(body);
  const top = V(c.soma).add(new Vector3(0, c.radius * 1.1, 0)), apex = V(c.apex);
  const mid = top.clone().lerp(apex, 0.5).add(new Vector3((c.id % 3 - 1) * 9, 0, ((c.id * 7) % 5 - 2) * 5));
  group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([top, mid, apex]), 24, focus ? 3.0 : 2.2, 8), neurite));
  // apical tuft
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + c.id;
    const tip = apex.clone().add(new Vector3(Math.cos(a) * 42, 34 + k * 8, Math.sin(a) * 42));
    group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([apex, apex.clone().lerp(tip, 0.5).add(new Vector3(0, 8, 0)), tip]), 10, 1.4, 6), neurite));
  }
  for (const b of c.basal) {
    const tip = V(b), from = V(c.soma).add(tip.clone().sub(V(c.soma)).normalize().multiplyScalar(c.radius * 0.8));
    group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([from, from.clone().lerp(tip, 0.5).add(new Vector3(0, -6, 0)), tip]), 12, focus ? 1.9 : 1.4, 6), neurite));
  }
  const axonCurve = new CatmullRomCurve3(c.axon.map(V));
  group.add(new Mesh(new TubeGeometry(axonCurve, 40, focus ? 1.3 : 0.9, 6), axonMat));
  const pulses: Mesh[] = [];
  for (let k = 0; k < (focus ? 4 : 2); k++) {
    const m = new Mesh(pulseGeom, new MeshBasicMaterial({ color: focus ? '#FFE2B8' : '#C9D8FF', transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
    m.visible = false; m.scale.setScalar(focus ? 1 : 0.7);
    group.add(m); pulses.push(m);
  }
  return { group, soma, neurite, axonCurve, axonLength: axonCurve.getLength(), pulses, cell: c };
}

function Column({ col, now, labels }: { col: ColumnResult; now: () => number; labels: boolean }) {
  const { scene, invalidate } = useThree();
  const cellsKey = col.cells.length + ':' + col.params.durationMs;
  const built = useMemo(() => {
    const pulseGeom = new SphereGeometry(4.2, 12, 10);
    return col.cells.map((c) => buildCell(c, pulseGeom));
    // the layout depends only on the duration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsKey]);
  const root = useMemo(() => { const g = new Group(); built.forEach((b) => g.add(b.group)); return g; }, [built]);
  useEffect(() => () => { root.traverse((o) => { const m = o as Mesh; m.geometry?.dispose?.(); (m.material as MeshStandardMaterial | undefined)?.dispose?.(); }); }, [root]);

  // faint specks for depth (not cells, not data)
  const dust = useMemo(() => {
    const rnd = mulberry32(77), n = 520, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * 1300; pos[i * 3 + 1] = (rnd() - 0.5) * 1000 + 40; pos[i * 3 + 2] = (rnd() - 0.5) * 900; }
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(pos, 3));
    return new Points(g, new PointsMaterial({ color: '#7A8DC8', size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false }));
  }, []);
  useEffect(() => { scene.fog = new Fog('#070B16', 1000, 2400); return () => { scene.fog = null; }; }, [scene]);

  const contactMat = useRef<MeshStandardMaterial>(null), linkMat = useRef<MeshBasicMaterial>(null), haloMat = useRef<MeshBasicMaterial>(null);
  const d = col.params.distanceUm;

  useFrame(() => {
    const t = now();
    const vm = sampleAt(col.hh.v, col.perMs, t);
    const depol = Math.max(0, Math.min(1, (vm + 68) / 105));
    for (const b of built) {
      let glow = 0, spikes: readonly number[];
      if (b.cell.id === 0) { glow = Math.pow(depol, 1.4) * 2.6; spikes = col.hh.spikesMs; } else {
        spikes = b.cell.spikesMs;
        for (const ts of spikes) { const dt = t - ts; if (dt >= -0.15 && dt < 4) glow = Math.max(glow, 1.6 * Math.exp(-Math.max(0, dt) / 0.9)); }
      }
      b.soma.emissiveIntensity = glow;
      b.neurite.emissiveIntensity = glow * 0.35;
      const at = axonPulses(spikes, b.axonLength, t);
      b.pulses.forEach((m, k) => {
        const u = at[at.length - 1 - k];
        m.visible = u !== undefined;
        if (u !== undefined) m.position.copy(b.axonCurve.getPointAt(Math.min(1, u)));
      });
    }
    const ve = Math.abs(sampleAt(col.electrodeUv, col.perMs, t)), vf = Math.abs(sampleAt(col.focusUv, col.perMs, t));
    if (contactMat.current) contactMat.current.emissiveIntensity = 0.25 + Math.min(3, (ve / 60) * 2.2);
    if (linkMat.current) linkMat.current.opacity = 0.18 + Math.min(0.8, vf / Math.max(20, col.focusAmplitudeUv));
    if (haloMat.current) haloMat.current.opacity = Math.min(0.5, (vf / Math.max(20, col.focusAmplitudeUv)) * 0.5);
  });
  // parameters changed while paused: draw once
  useEffect(() => { invalidate(); }, [col, invalidate]);

  const contacts = [-240, -200, -160, -120, -80, -40, 0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400];
  const shankBox = useMemo(() => new BoxGeometry(18, 720, 70), []);
  return (
    <>
      <primitive object={root} />
      <primitive object={dust} />
      {/* field at the soma (drawn only while current is crossing the membrane) */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[26, 24, 16]} />
        <meshBasicMaterial ref={haloMat} color="#FFD7A0" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* the path from the neuron to the contact: brightens with the neuron's share of the contact's voltage */}
      <mesh position={[d / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.9, 0.9, Math.max(1, d - 11), 6]} />
        <meshBasicMaterial ref={linkMat} color="#7FE7FF" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* electrode shank; the near face sits `distance` from the soma centre */}
      <group position={[d, 0, 0]}>
        <mesh position={[9, 80, 0]}>
          <boxGeometry args={[18, 720, 70]} />
          <meshStandardMaterial color="#5B6F9E" roughness={0.32} metalness={0.55} emissive="#1B2A55" emissiveIntensity={0.6} />
        </mesh>
        <lineSegments position={[9, 80, 0]}>
          <edgesGeometry args={[shankBox]} />
          <lineBasicMaterial color="#9FC4FF" transparent opacity={0.55} />
        </lineSegments>
        {contacts.map((y) => (y === 0 ? (
          <mesh key={y} position={[-0.6, 0, 0]}>
            <boxGeometry args={[1.6, 18, 18]} />
            <meshStandardMaterial ref={contactMat} color="#F0B48E" roughness={0.3} metalness={0.6} emissive="#7FE7FF" emissiveIntensity={0.3} />
          </mesh>
        ) : (
          <mesh key={y} position={[-0.4, y, 0]}>
            <boxGeometry args={[1, 14, 14]} />
            <meshStandardMaterial color="#B08A78" roughness={0.45} metalness={0.5} />
          </mesh>
        )))}
      </group>
      {/* 100 µm scale bar */}
      <group position={[250, -190, 220]}>
        <mesh position={[50, 0, 0]}><boxGeometry args={[100, 1.6, 1.6]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <mesh position={[0, 0, 0]}><boxGeometry args={[1.6, 10, 1.6]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <mesh position={[100, 0, 0]}><boxGeometry args={[1.6, 10, 1.6]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <Html position={[50, -14, 0]} center zIndexRange={[2, 0]}><span className="scene-tag">100 µm</span></Html>
      </group>
      <Html position={[d / 2, 16, 0]} center zIndexRange={[2, 0]}><span className="scene-tag accent" data-testid="distance-tag">{Math.round(d)} µm</span></Html>
      {labels && (
        <>
          <Html position={[-24, 4, 0]} center zIndexRange={[2, 0]}><span className="scene-tag warm">cell body</span></Html>
          <Html position={[col.cells[0].apex[0] - 30, col.cells[0].apex[1] * 0.45, 0]} center zIndexRange={[2, 0]}><span className="scene-tag">dendrite (inputs arrive)</span></Html>
          <Html position={[col.cells[0].axon[3][0] - 44, col.cells[0].axon[3][1], col.cells[0].axon[3][2]]} center zIndexRange={[2, 0]}><span className="scene-tag">axon (spike leaves)</span></Html>
          <Html position={[d + 46, 0, 0]} center zIndexRange={[2, 0]}><span className="scene-tag accent">one contact</span></Html>
        </>
      )}
    </>
  );
}

export function NeuronStage({ col, now, playing, labels }: { col: ColumnResult; now: () => number; playing: boolean; labels: boolean }) {
  return (
    <Canvas
      frameloop={playing ? 'always' : 'demand'}
      dpr={[1, 2]}
      camera={{ position: [-560, 170, 1120], fov: 34, near: 5, far: 6000 }}
      gl={{ antialias: true, alpha: true }}
      data-testid="neuron-canvas"
    >
      <ambientLight intensity={0.55} color="#8FA0E8" />
      <directionalLight position={[-400, 700, 600]} intensity={2.2} color="#F6EEFF" />
      <directionalLight position={[-700, 100, -500]} intensity={1.4} color="#62BCFF" />
      <directionalLight position={[600, -200, 300]} intensity={0.7} color="#F04A86" />
      <Column col={col} now={now} labels={labels} />
      <Scrubbed now={now} />
      <OrbitControls makeDefault enablePan={false} minDistance={260} maxDistance={2000} target={[70, 10, 0]} enableDamping={false} />
    </Canvas>
  );
}

/** Redraw when the timeline is moved while paused (demand mode draws only when asked). */
function Scrubbed({ now }: { now: () => number }) {
  const { invalidate } = useThree();
  const last = useRef(-1);
  useEffect(() => {
    let raf = 0;
    const tick = () => { const t = now(); if (t !== last.current) { last.current = t; invalidate(); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [now, invalidate]);
  return null;
}
