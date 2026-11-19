// The 3D view of stages 1–3: the tissue under the device, one neuron, and the contact that listens to it.
// ILLUSTRATIVE geometry (the atlas has no cells): shapes and positions are drawn to explain, the activity on them is
// read from the simulation at the timeline position — a soma lights up exactly when its unit spikes in the model.
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Fog, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, Points, PointsMaterial, SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { DEVICE, threadSites } from './implantStore';
import { mulberry32 } from './model/rng';
import { NEAR0_UM, UNITS_PER_CH, type MotorRun, type Unit } from './model/motor';
import { CONTACT_GAIN, type VisualRun } from './model/visual';

const HOT = new Color('#FFE9C4');
const RANK_COLOR = ['#F29BC0', '#9C8FE0', '#6F6AA8'];
const PITCH_UM = DEVICE.pitchMm * 1000;
/** Centre of each contact in the tissue scene, µm (x, z across the cortex; y is depth, up towards the surface). */
const SITES: Array<[number, number, number]> = threadSites().map(([x, z]) => [x * 1000, 0, z * 1000]);

interface Pose { pos: [number, number, number]; target: [number, number, number] }

/** The fly-in from above is shown once per visit; coming back to the 3D stages later starts at the stage's own view. */
let introShown = false;

/** Smoothly moves the camera to the pose of the current stage; a drag takes over until the stage changes again. */
function Rig({ pose, intro }: { pose: Pose; intro: Pose }) {
  const { camera, invalidate } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const tween = useRef<{ t0: number; ms: number; p0: Vector3; q0: Vector3; p1: Vector3; q1: Vector3 } | null>(null);
  const first = useRef(true);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const p1 = new Vector3(...pose.pos), q1 = new Vector3(...pose.target);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const flyIn = first.current && !introShown && !reduce;
    if (flyIn) { camera.position.set(...intro.pos); c.target.set(...intro.target); c.update(); }
    if (reduce || (first.current && !flyIn)) { camera.position.copy(p1); c.target.copy(q1); c.update(); tween.current = null; }
    else tween.current = { t0: performance.now(), ms: flyIn ? 1500 : 900, p0: camera.position.clone(), q0: c.target.clone(), p1, q1 };
    first.current = false; introShown = true;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose.pos.join(), pose.target.join()]);
  useFrame(() => {
    const tw = tween.current, c = controls.current;
    if (!tw || !c) return;
    const k = Math.min(1, (performance.now() - tw.t0) / tw.ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tw.p0, tw.p1, e); c.target.lerpVectors(tw.q0, tw.q1, e); c.update();
    if (k >= 1) tween.current = null; else invalidate();
  });
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={120} maxDistance={16000} enableDamping={false} onStart={() => { tween.current = null; }} />;
}

/** Redraw when the timeline moves while paused. */
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

function Dust({ spread }: { spread: number }) {
  const dust = useMemo(() => {
    const rnd = mulberry32(77), n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * spread; pos[i * 3 + 1] = (rnd() - 0.5) * spread * 0.5; pos[i * 3 + 2] = (rnd() - 0.5) * spread * 0.7; }
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(pos, 3));
    return new Points(g, new PointsMaterial({ color: '#7A8DC8', size: spread / 500, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false }));
  }, [spread]);
  useEffect(() => () => { dust.geometry.dispose(); (dust.material as PointsMaterial).dispose(); }, [dust]);
  return <primitive object={dust} />;
}

/** Cells that are simply there: too far from any contact to be picked out. They give the tissue depth; they do nothing. */
function Bystanders({ around }: { around: Vector3[] }) {
  const { somas, lines } = useMemo(() => {
    const rnd = mulberry32(4242), n = 110, d = new Object3D();
    const m = new InstancedMesh(new SphereGeometry(1, 12, 9), new MeshStandardMaterial({ color: '#4B4A86', roughness: 0.7, transparent: true, opacity: 0.55 }), n);
    const seg: number[] = [];
    let placed = 0;
    while (placed < n) {
      const base = around[Math.floor(rnd() * around.length)];
      const x = base.x + (rnd() - 0.5) * 1700, y = (rnd() - 0.5) * 900 + 60, z = base.z + (rnd() - 0.5) * 1300;
      // keep the neighbourhood of every contact clear: what is drawn there is what the model records
      if (around.some((c) => Math.hypot(x - c.x, y - c.y, z - c.z) < 260)) continue;
      d.position.set(x, y, z); d.scale.set(8 + rnd() * 3, 10 + rnd() * 4, 8 + rnd() * 3); d.updateMatrix();
      m.setMatrixAt(placed++, d.matrix as Matrix4);
      seg.push(x, y + 9, z, x + (rnd() - 0.5) * 30, y + 190 + rnd() * 120, z + (rnd() - 0.5) * 30);
      for (let k = 0; k < 3; k++) { const a = rnd() * Math.PI * 2, l = 45 + rnd() * 40; seg.push(x, y, z, x + Math.cos(a) * l, y - 15 - rnd() * 30, z + Math.sin(a) * l); }
    }
    m.instanceMatrix.needsUpdate = true;
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(seg), 3));
    return { somas: m, lines: new LineSegments(g, new LineBasicMaterial({ color: '#5A5AA0', transparent: true, opacity: 0.4 })) };
  }, [around]);
  useEffect(() => () => { somas.geometry.dispose(); (somas.material as MeshStandardMaterial).dispose(); lines.geometry.dispose(); (lines.material as LineBasicMaterial).dispose(); }, [somas, lines]);
  return <><primitive object={somas} /><primitive object={lines} /></>;
}

// ── motor: threads among neurons ────────────────────────────────────────────────────────────────────────────────
interface Cell { unit: Unit; group: Group; soma: MeshStandardMaterial; neurite: MeshStandardMaterial; halo: MeshBasicMaterial; centre: Vector3 }

function buildCell(u: Unit, site: Vector3): Cell {
  const r = mulberry32(900 + u.id), col = new Color(RANK_COLOR[u.rank]);
  const centre = site.clone().add(new Vector3(...u.pos));
  const group = new Group();
  const rad = u.rank === 0 ? 11 : 9;
  const soma = new MeshStandardMaterial({ color: col, roughness: 0.5, emissive: HOT, emissiveIntensity: 0 });
  const neurite = new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.65, emissive: HOT, emissiveIntensity: 0, transparent: true, opacity: u.rank === 0 ? 1 : 0.7 });
  const body = new Mesh(new SphereGeometry(rad, 22, 16), soma);
  body.scale.set(1, 1.25, 1); body.position.copy(centre);
  group.add(body);
  const apex = centre.clone().add(new Vector3((r() - 0.5) * 40, 230 + r() * 90, (r() - 0.5) * 40));
  group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([centre.clone().add(new Vector3(0, rad, 0)), centre.clone().lerp(apex, 0.5).add(new Vector3((r() - 0.5) * 16, 0, (r() - 0.5) * 16)), apex]), 16, u.rank === 0 ? 2.6 : 1.9, 6), neurite));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r() * 0.9, len = 55 + r() * 45;
    const tip = centre.clone().add(new Vector3(Math.cos(a) * len, -18 - r() * 40, Math.sin(a) * len));
    group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([centre, centre.clone().lerp(tip, 0.5).add(new Vector3(0, -5, 0)), tip]), 8, 1.4, 5), neurite));
  }
  const halo = new MeshBasicMaterial({ color: '#FFD7A0', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
  const glow = new Mesh(new SphereGeometry(rad * 3.2, 16, 12), halo);
  glow.position.copy(centre);
  group.add(glow);
  return { unit: u, group, soma, neurite, halo, centre };
}

function MotorTissue({ run, now, speed, stage, labels }: { run: MotorRun; now: () => number; speed: number; stage: number; labels: boolean }) {
  const { invalidate, scene } = useThree();
  const fc = run.params.focusCh, shift = run.params.nearUm - NEAR0_UM;
  const sites = useMemo(() => SITES.map((s) => new Vector3(...s)), []);
  const cells = useMemo(() => run.units.map((u) => buildCell(u, sites[u.ch])), [run.units, sites]);
  const root = useMemo(() => { const g = new Group(); cells.forEach((c) => g.add(c.group)); return g; }, [cells]);
  useEffect(() => () => { root.traverse((o) => { const m = o as Mesh; m.geometry?.dispose?.(); (m.material as MeshStandardMaterial | undefined)?.dispose?.(); }); }, [root]);
  useEffect(() => { scene.fog = new Fog('#070B16', 2500, 14000); return () => { scene.fog = null; }; }, [scene]);
  // each contact sits `shift` further from its nearest neuron than in the reference placement
  const contacts = useMemo(() => sites.map((s, ch) => {
    const near = cells[ch * UNITS_PER_CH].centre.clone().sub(s);
    return s.clone().addScaledVector(near.normalize(), -shift);
  }), [sites, cells, shift]);
  const pads = useRef<Array<MeshStandardMaterial | null>>([]);
  const link = useRef<MeshBasicMaterial | null>(null);
  const ptr = useRef(new Int32Array(run.units.length));
  useEffect(() => { ptr.current = new Int32Array(run.units.length); invalidate(); }, [run, invalidate]);

  useFrame(() => {
    const t = now(), decay = Math.max(0.0012, 0.025 * speed);
    const chGlow = new Float32Array(sites.length);
    for (const c of cells) {
      const sp = run.spikeT[c.unit.id];
      // most recent spike at or before t (the pointer only ever moves a little between frames)
      let i = ptr.current[c.unit.id];
      if (i >= sp.length || (i > 0 && sp[i - 1] > t)) i = 0;
      while (i < sp.length && sp[i] <= t) i++;
      ptr.current[c.unit.id] = i;
      const dt = i > 0 ? t - sp[i - 1] : Infinity;
      const g = dt < decay * 6 ? Math.exp(-dt / decay) : 0;
      c.soma.emissiveIntensity = g * 1.5; c.neurite.emissiveIntensity = g * 0.5; c.halo.opacity = g * 0.22;
      chGlow[c.unit.ch] = Math.max(chGlow[c.unit.ch], g * Math.min(1, run.ampUv[c.unit.id] / 60));
    }
    pads.current.forEach((m, ch) => { if (m) m.emissiveIntensity = 0.35 + 2.6 * chGlow[ch]; });
    if (link.current) link.current.opacity = 0.16 + 0.8 * chGlow[fc];
  });

  const near = cells[fc * UNITS_PER_CH], contact = contacts[fc];
  const mid = near.centre.clone().lerp(contact, 0.5), gap = near.centre.distanceTo(contact);
  const linkQuat = useMemo(() => { const o = new Object3D(); o.position.copy(mid); o.lookAt(contact); o.rotateX(Math.PI / 2); return o.quaternion.clone(); }, [mid, contact]);
  return (
    <>
      <primitive object={root} />
      <Bystanders around={sites} />
      <Dust spread={9000} />
      {contacts.map((c, ch) => (
        <group key={ch} position={c}>
          {/* thread: a thin flexible ribbon coming down from the surface (drawn wider than a real one) */}
          <mesh position={[0, 700, 0]}><boxGeometry args={[22, 1500, 7]} /><meshStandardMaterial color={ch === fc ? '#F3D7A8' : '#8E8468'} roughness={0.4} metalness={0.35} emissive="#5A4520" emissiveIntensity={ch === fc ? 0.8 : 0.3} transparent opacity={ch === fc ? 1 : 0.75} /></mesh>
          <mesh position={[0, 0, 4.2]}><boxGeometry args={[16, 24, 2]} /><meshStandardMaterial ref={(m) => { pads.current[ch] = m; }} color="#F0B48E" roughness={0.3} metalness={0.6} emissive="#7FE7FF" emissiveIntensity={0.35} /></mesh>
          {(stage === 1 || ch === fc) && <Html position={[0, 1500, 0]} center zIndexRange={[2, 0]}><span className={`scene-tag${ch === fc ? ' accent' : ''}`}>contact {ch + 1}</span></Html>}
        </group>
      ))}
      {/* the path from the nearest neuron to its contact: brightens with that neuron's share of the contact voltage */}
      <mesh position={mid} quaternion={linkQuat}><cylinderGeometry args={[0.9, 0.9, Math.max(1, gap - 12), 6]} /><meshBasicMaterial ref={link} color="#7FE7FF" transparent opacity={0.2} depthWrite={false} /></mesh>
      <Html position={mid.clone().add(new Vector3(0, 16, 0))} center zIndexRange={[2, 0]}><span className="scene-tag accent" data-testid="tissue-distance">{Math.round(gap)} µm</span></Html>
      {labels && stage >= 2 && (
        <>
          <Html position={near.centre.clone().add(new Vector3(-34, 0, 0))} center zIndexRange={[2, 0]}><span className="scene-tag warm">nearest neuron</span></Html>
          <Html position={contact.clone().add(new Vector3(52, 0, 0))} center zIndexRange={[2, 0]}><span className="scene-tag accent">recording site</span></Html>
        </>
      )}
      {/* 100 µm scale bar next to the contact */}
      <group position={contact.clone().add(new Vector3(-50, -150, 60))}>
        <mesh position={[50, 0, 0]}><boxGeometry args={[100, 1.6, 1.6]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <mesh><boxGeometry args={[1.6, 10, 1.6]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <mesh position={[100, 0, 0]}><boxGeometry args={[1.6, 10, 1.6]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <Html position={[50, -14, 0]} center zIndexRange={[2, 0]}><span className="scene-tag">100 µm</span></Html>
      </group>
    </>
  );
}

// ── visual: contacts on the surface, a sheet of cells beneath ───────────────────────────────────────────────────
function VisualTissue({ run, now, stage }: { run: VisualRun; now: () => number; stage: number }) {
  const { invalidate, scene } = useThree();
  const fc = run.params.focusCh, N = 900;
  const { mesh, owner, phase } = useMemo(() => {
    const rnd = mulberry32(314), m = new InstancedMesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: '#ffffff' }), N);
    const owner = new Uint8Array(N), phase = new Float32Array(N), d = new Object3D();
    for (let i = 0; i < N; i++) {
      const ch = i % SITES.length, a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * PITCH_UM * 0.62;
      d.position.set(SITES[ch][0] + Math.cos(a) * rr, -150 - rnd() * 1500, SITES[ch][2] + Math.sin(a) * rr);
      d.scale.setScalar(16 + rnd() * 10); d.updateMatrix();
      m.setMatrixAt(i, d.matrix as Matrix4); owner[i] = ch; phase[i] = rnd();
    }
    m.instanceMatrix.needsUpdate = true;
    return { mesh: m, owner, phase };
  }, []);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }, [mesh]);
  useEffect(() => { scene.fog = new Fog('#070B16', 5000, 20000); return () => { scene.fog = null; }; }, [scene]);
  useEffect(() => { invalidate(); }, [run, invalidate]);
  const discs = useRef<Array<MeshStandardMaterial | null>>([]);
  const cold = useMemo(() => new Color('#3F3C78'), []), warm = useMemo(() => new Color('#FFD7A0'), []), c = useMemo(() => new Color(), []);
  useFrame(() => {
    const t = now(), k = Math.max(0, Math.min(run.nBins - 1, Math.floor((t * 1000) / run.binMs)));
    const slot = Math.floor(t / 0.03);
    for (let i = 0; i < N; i++) {
      const drive = run.drive[k * run.nCh + owner[i]];
      // each cell flickers on its own; how often depends on the drive under its contact (illustrative)
      const h = Math.abs(Math.sin((slot + 1) * (i + 1) * 12.9898 + phase[i] * 78.233) * 43758.5453) % 1;
      const on = h < 0.06 + 0.5 * Math.min(1, drive);
      mesh.setColorAt(i, c.copy(cold).lerp(warm, on ? 0.35 + 0.65 * Math.min(1, drive + 0.2) : 0.04));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    discs.current.forEach((m, ch) => { if (m) m.emissiveIntensity = 0.3 + 2.2 * Math.min(1, run.drive[k * run.nCh + ch]); });
  });
  return (
    <>
      <primitive object={mesh} />
      <Dust spread={12000} />
      {/* the cortical surface, as a faint sheet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -60, 0]}><planeGeometry args={[PITCH_UM * 6, PITCH_UM * 4]} /><meshBasicMaterial color="#E2A4C6" transparent opacity={0.07} depthWrite={false} /></mesh>
      {SITES.map((s, ch) => (
        <group key={ch} position={[s[0], 0, s[2]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}><cylinderGeometry args={[520, 520, 40, 40]} /><meshStandardMaterial ref={(m) => { discs.current[ch] = m; }} color={ch === fc ? '#F0B48E' : '#A9907F'} roughness={0.35} metalness={0.6} emissive="#7FE7FF" emissiveIntensity={0.3} /></mesh>
          {(stage <= 1 || ch === fc) && <Html position={[0, 320, 0]} center zIndexRange={[2, 0]}><span className={`scene-tag${ch === fc ? ' accent' : ''}`}>contact {ch + 1}{CONTACT_GAIN[ch] < 0.2 ? ' · barely driven' : ''}</span></Html>}
        </group>
      ))}
      <group position={[SITES[fc][0] - 500, -1750, SITES[fc][2] + 900]}>
        <mesh position={[500, 0, 0]}><boxGeometry args={[1000, 14, 14]} /><meshBasicMaterial color="#E8EEF9" /></mesh>
        <Html position={[500, -110, 0]} center zIndexRange={[2, 0]}><span className="scene-tag">1 mm</span></Html>
      </group>
    </>
  );
}

function Outline() {
  // the device's footprint on the surface, far above the contacts (motor) — a cue for where "up" and the device are
  const geo = useMemo(() => { const g = new BufferGeometry(); const p: number[] = []; const R = DEVICE.footprintMm * 1000; for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, b = ((i + 1) / 64) * Math.PI * 2; p.push(Math.cos(a) * R, 0, Math.sin(a) * R, Math.cos(b) * R, 0, Math.sin(b) * R); } g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3)); return g; }, []);
  const obj = useMemo(() => new LineSegments(geo, new LineBasicMaterial({ color: '#7FE7FF', transparent: true, opacity: 0.35 })), [geo]);
  useEffect(() => () => { geo.dispose(); (obj.material as LineBasicMaterial).dispose(); }, [geo, obj]);
  return <primitive object={obj} position={[0, 1450, 0]} />;
}

export function TissueStage({ run, now, playing, speed, stage, labels }: { run: MotorRun | VisualRun; now: () => number; playing: boolean; speed: number; stage: number; labels: boolean }) {
  const fc = run.params.focusCh, site = SITES[fc];
  const poses: Pose[] = run.kind === 'motor'
    ? [
      { pos: [site[0] - 430, 250, site[2] + 1000], target: [site[0] + 30, 110, site[2]] },
      { pos: [site[0] - 190, 70, site[2] + 400], target: [site[0] + 10, 25, site[2]] },
      { pos: [site[0] + 130, 30, site[2] + 290], target: [site[0], 0, site[2]] },
    ]
    : [
      { pos: [-2600, 4200, 9000], target: [0, -500, 0] },
      { pos: [site[0] - 1500, 1100, site[2] + 3600], target: [site[0], -500, site[2]] },
      { pos: [site[0] + 900, 1500, site[2] + 2300], target: [site[0], -100, site[2]] },
    ];
  const intro: Pose = { pos: [0, 15000, 2500], target: [0, 0, 0] };
  const pose = poses[Math.max(0, Math.min(2, stage - 1))];
  return (
    <Canvas frameloop={playing ? 'always' : 'demand'} dpr={[1, 2]} camera={{ position: intro.pos, fov: 34, near: 5, far: 40000 }} gl={{ antialias: true, alpha: true }} data-testid="tissue-canvas">
      <ambientLight intensity={0.7} color="#A9B6F0" />
      <directionalLight position={[-400, 900, 600]} intensity={1.9} color="#F6EEFF" />
      <directionalLight position={[-700, 100, -500]} intensity={1.3} color="#62BCFF" />
      <directionalLight position={[600, -200, 300]} intensity={0.7} color="#F04A86" />
      {run.kind === 'motor' ? <><MotorTissue run={run} now={now} speed={speed} stage={stage} labels={labels} /><Outline /></> : <VisualTissue run={run} now={now} stage={stage} />}
      <Scrubbed now={now} />
      <Rig pose={pose} intro={intro} />
    </Canvas>
  );
}
