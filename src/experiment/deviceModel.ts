// The virtual BCI as three.js objects, in the brain scene's display space (metres). A generic sealed enclosure with a
// bundle of fine flexible threads reaching the cortex beneath it. ILLUSTRATIVE: not any manufacturer's design, and the
// threads are drawn about thirty times thicker than a real polymer thread so that they can be seen at this scale.
import {
  CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion,
  RingGeometry, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { DEVICE, threadSites, type Placement } from './implantStore';

const MM = 0.001;
const UP = new Vector3(0, 1, 0);

export interface DeviceObject {
  group: Group;
  /** Meshes a pointer ray is tested against (the enclosure). */
  pickTargets: Mesh[];
  setPose: (p: Pick<Placement, 'pointRasMm' | 'normalRas'>) => void;
  /** 'attached' is solid; 'preview' is translucent, tinted by whether the spot can be used. */
  setState: (state: 'attached' | 'preview', compatible?: boolean) => void;
  dispose: () => void;
}

/** RAS mm → display metres (x, y, z) = (R, S, −A) / 1000; directions use the same axes without the scale. */
const toDisplay = (p: readonly [number, number, number], scale = MM) => new Vector3(p[0] * scale, p[2] * scale, -p[1] * scale);

export function buildDevice(): DeviceObject {
  const group = new Group();
  group.name = 'virtual-bci';
  const R = (DEVICE.diameterMm / 2) * MM, H = DEVICE.heightMm * MM, lift = DEVICE.standoffMm * MM;

  const shell = new MeshStandardMaterial({ color: '#A9B4C8', roughness: 0.3, metalness: 0.78, transparent: true });
  const glass = new MeshStandardMaterial({ color: '#222C47', roughness: 0.42, metalness: 0.5, transparent: true });
  const coil = new MeshStandardMaterial({ color: '#C9A277', roughness: 0.45, metalness: 0.8, transparent: true });
  const led = new MeshBasicMaterial({ color: '#7FE7FF', transparent: true });
  const thread = new MeshStandardMaterial({ color: '#F3D7A8', roughness: 0.4, metalness: 0.3, emissive: new Color('#7A5A2A'), emissiveIntensity: 0.9, transparent: true });
  const site = new MeshBasicMaterial({ color: '#8FF0FF', transparent: true });
  const ring = new MeshBasicMaterial({ color: '#7FE7FF', transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false });
  const mats = [shell, glass, coil, led, thread, site];

  // enclosure: a rounded puck (lathe profile in metres)
  const prof = [[0, 0], [R - 1.4 * MM, 0], [R - 0.4 * MM, 0.5 * MM], [R, 1.6 * MM], [R, H - 1.6 * MM], [R - 0.4 * MM, H - 0.5 * MM], [R - 1.4 * MM, H], [0, H]].map(([x, y]) => new Vector2(x, y));
  const body = new Mesh(new LatheGeometry(prof, 56), shell);
  body.position.y = lift;
  const lid = new Mesh(new CylinderGeometry(R * 0.74, R * 0.74, 0.5 * MM, 48), glass);
  lid.position.y = lift + H + 0.05 * MM;
  // a square-cornered trace on the lid (an induction coil, as a concept) — deliberately not circular rings
  const coilRing = new Mesh(new TorusGeometry(R * 0.5, 0.16 * MM, 6, 4), coil);
  coilRing.rotation.x = Math.PI / 2; coilRing.rotation.z = Math.PI / 4; coilRing.position.y = lift + H + 0.32 * MM;
  const coilRing2 = new Mesh(new TorusGeometry(R * 0.36, 0.14 * MM, 6, 4), coil);
  coilRing2.rotation.x = Math.PI / 2; coilRing2.rotation.z = Math.PI / 4; coilRing2.position.y = lift + H + 0.32 * MM;
  const lamp = new Mesh(new SphereGeometry(0.55 * MM, 12, 10), led);
  lamp.position.set(R * 0.58, lift + H + 0.3 * MM, 0);
  const collar = new Mesh(new CylinderGeometry(2.4 * MM, 3.2 * MM, 1.4 * MM, 24), glass);
  collar.position.y = lift - 0.7 * MM;
  group.add(body, lid, coilRing, coilRing2, lamp, collar);

  // threads: from the underside of the enclosure to their entry points on the surface, and a little way in
  const sites = threadSites();
  sites.forEach(([sx, sz], i) => {
    const a = (i / sites.length) * Math.PI * 2;
    const from = new Vector3(Math.cos(a) * 1.6 * MM, lift - 1.4 * MM, Math.sin(a) * 1.6 * MM);
    const entry = new Vector3(sx * MM, 0, sz * MM);
    const mid = from.clone().lerp(entry, 0.5).add(new Vector3(sx * MM * 0.35, 1.2 * MM, sz * MM * 0.35));
    const tip = entry.clone().add(new Vector3(0, -1.6 * MM, 0));
    group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([from, mid, entry, tip]), 28, 0.16 * MM, 6), thread));
    const dot = new Mesh(new SphereGeometry(0.36 * MM, 10, 8), site);
    dot.position.copy(entry).add(new Vector3(0, 0.15 * MM, 0));
    group.add(dot);
  });

  // footprint on the surface
  const foot = new Mesh(new RingGeometry(DEVICE.footprintMm * MM, (DEVICE.footprintMm + 0.5) * MM, 64), ring);
  foot.rotation.x = -Math.PI / 2; foot.position.y = 0.7 * MM; foot.renderOrder = 6;
  group.add(foot);

  const q = new Quaternion();
  return {
    group,
    pickTargets: [body, lid],
    setPose: (p) => {
      const n = toDisplay(p.normalRas, 1).normalize();
      group.position.copy(toDisplay(p.pointRasMm));
      group.quaternion.copy(q.setFromUnitVectors(UP, n));
      group.updateMatrixWorld(true);
    },
    setState: (state, compatible = true) => {
      const preview = state === 'preview';
      for (const m of mats) { m.opacity = preview ? (compatible ? 0.72 : 0.3) : 1; m.depthWrite = !preview; }
      ring.color.set(preview ? (compatible ? '#8CFFB5' : '#FF7A7A') : '#7FE7FF');
      ring.opacity = preview ? 1 : 0.85;
      led.color.set(preview ? (compatible ? '#8CFFB5' : '#FF7A7A') : '#7FE7FF');
    },
    dispose: () => {
      group.traverse((o) => { (o as Mesh).geometry?.dispose?.(); });
      [...mats, ring].forEach((m) => m.dispose());
    },
  };
}
