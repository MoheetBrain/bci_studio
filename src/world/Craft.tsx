// The player: a small virtual research craft.
//
// It is a NAVIGATION INSTRUMENT of this application and nothing else: it marks where the player is and which way they
// are aimed. It is not a thing that exists in tissue, it records nothing, it touches nothing, and moving it changes no
// model and no recording. The contacts the player places are separate objects that stay where they were put.
//
// It has its own position and attitude in the scene (controller.s and controller.body); the camera is elsewhere and
// follows. Scale: about 15 µm long — the size of a cell body — so that it reads beside neurons without filling the view.
import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CapsuleGeometry, CylinderGeometry, Group, LatheGeometry, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector2, type Mesh } from 'three';
import { controller } from './controller';
import { rt } from './runtime';
import { useWorld } from './worldStore';

/** Length of the craft from nose to tail ring, µm (for the camera and for tests that ask how big the player is). */
export const CRAFT_LENGTH_UM = 17.5;

export function Craft() {
  const root = useRef<Group>(null), arm = useRef<Group>(null), fore = useRef<Group>(null), lens = useRef<Mesh>(null), tip = useRef<Mesh>(null);
  const inspect = useWorld((s) => s.ctl.mode === 'orbit'), first = useWorld((s) => s.ctl.viewKind === 'first');
  const made = useMemo(() => {
    // the hull: a slim pearl body, a little flattened; its long axis is the craft's forward (−z)
    const profile = [[0, -8.6], [1.15, -8.25], [2.25, -6.9], [2.95, -4.4], [3.3, -1.2], [3.2, 1.8], [2.75, 4.4], [2.1, 6.1]].map(([r, z]) => new Vector2(r, z));
    const hull = new LatheGeometry(profile, 44);
    hull.rotateX(Math.PI / 2); hull.scale(1, 0.8, 1); hull.computeVertexNormals();
    // the tail: a graphite cone that ends in an open ring (what you see most of, flying behind it)
    const tailProfile = [[2.1, 6.1], [2.2, 6.5], [1.85, 8.3], [1.45, 8.9], [1.2, 8.6], [1.05, 7.2]].map(([r, z]) => new Vector2(r, z));
    const tail = new LatheGeometry(tailProfile, 36);
    tail.rotateX(Math.PI / 2); tail.scale(1, 0.8, 1); tail.computeVertexNormals();
    const tailRing = new TorusGeometry(1.32, 0.16, 10, 36); tailRing.scale(1, 0.8, 1);
    const collar = new TorusGeometry(3.26, 0.34, 12, 48); collar.scale(1, 0.8, 1);
    const pod = new CapsuleGeometry(0.82, 4.6, 6, 14); pod.rotateX(Math.PI / 2);
    const bezel = new TorusGeometry(1.5, 0.28, 10, 32), eye = new SphereGeometry(1.3, 24, 16); eye.scale(1, 1, 0.55);
    const strut = new CylinderGeometry(0.22, 0.22, 1, 8), knuckle = new SphereGeometry(0.42, 12, 10), probe = new SphereGeometry(0.46, 14, 12), light = new SphereGeometry(0.3, 10, 8);
    // a cool white, so that it stays pearl under the block's rosy light and is never mistaken for tissue
    const pearl = new MeshPhysicalMaterial({ color: '#E4EDF7', emissive: '#1C222C', emissiveIntensity: 0.5, roughness: 0.26, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.18, sheen: 0.35, sheenColor: '#DCE8FF', sheenRoughness: 0.5 });
    const graphite = new MeshStandardMaterial({ color: '#262A34', roughness: 0.42, metalness: 0.75 });
    const optic = new MeshStandardMaterial({ color: '#0B2530', emissive: '#7FE7FF', emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.2 });
    const glow = new MeshStandardMaterial({ color: '#0B2530', emissive: '#63C9E0', emissiveIntensity: 0.9, roughness: 0.3 });
    const gold = new MeshStandardMaterial({ color: '#F0C590', emissive: '#FFB060', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.8 });
    const nav = new MeshStandardMaterial({ color: '#2A1A10', emissive: '#FFC56B', emissiveIntensity: 1.2 });
    return { hull, tail, tailRing, collar, pod, bezel, eye, strut, knuckle, probe, light, pearl, graphite, optic, glow, gold, nav };
  }, []);
  useEffect(() => () => { for (const v of Object.values(made)) v.dispose(); }, [made]);

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const s = controller.s, b = controller.body, c = controller.camPose();
    g.position.set(s.pos[0], s.pos[1], s.pos[2]);
    g.rotation.set(b.pitch, b.yaw, b.roll, 'YXZ');
    // in first person the camera is inside it: it is not drawn once the camera has arrived
    const d = Math.hypot(c.pos[0] - s.pos[0], c.pos[1] - s.pos[1], c.pos[2] - s.pos[2]);
    g.visible = d > 9;
    // the measuring arm folds under the hull and reaches forward while a contact is in hand
    const want = rt.tool ? 1 : 0, k = 1 - Math.exp(-dt / 0.14);
    if (arm.current && fore.current) {
      arm.current.userData.t = (arm.current.userData.t ?? 0) + (want - (arm.current.userData.t ?? 0)) * k;
      const t = arm.current.userData.t as number;
      arm.current.rotation.x = -0.25 - 0.95 * t; fore.current.rotation.x = 1.75 - 1.5 * t;
    }
    if (lens.current) (lens.current.material as MeshStandardMaterial).emissiveIntensity = 1.35 + 0.25 * Math.sin(clock.elapsedTime * 1.3);
    if (tip.current) (tip.current.material as MeshStandardMaterial).emissiveIntensity = 0.5 + 1.6 * want;
  });

  return (
    <group ref={root} name="player-craft">
      <mesh geometry={made.hull} material={made.pearl} />
      <mesh geometry={made.tail} material={made.graphite} />
      <mesh geometry={made.tailRing} material={made.glow} position={[0, 0, 8.7]} />
      <mesh geometry={made.collar} material={made.graphite} position={[0, 0, 0.4]} />
      {/* two outboard pods on thin wings */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh material={made.graphite} position={[sx * 4.7, -0.45, 1.9]} rotation={[0, 0, sx * -0.07]}><boxGeometry args={[4.2, 0.24, 2.6]} /></mesh>
          <group position={[sx * 6.9, -0.6, 1.7]}>
            <mesh geometry={made.pod} material={made.pearl} />
            <mesh geometry={made.light} material={made.nav} position={[0, 0, 3.15]} />
            <mesh geometry={made.light} material={made.graphite} position={[0, 0, -3.15]} scale={1.5} />
          </group>
        </group>
      ))}
      {/* the optical element: what the craft "looks" with */}
      <mesh geometry={made.bezel} material={made.graphite} position={[0, 0, -7.75]} />
      <mesh ref={lens} geometry={made.eye} material={made.optic} position={[0, 0, -7.9]} />
      {/* a dorsal fin, so that its attitude can be read from behind */}
      <mesh material={made.graphite} position={[0, 3.3, 3.6]} rotation={[-0.2, 0, 0]}><boxGeometry args={[0.26, 2.2, 3.8]} /></mesh>
      <mesh geometry={made.light} material={made.optic} position={[0, 4.5, 4.9]} />
      {/* the measuring arm: shoulder under the nose, elbow, and a tip that glows while a contact is in hand */}
      <group ref={arm} position={[1.3, -2.2, -4]} rotation={[-0.25, 0, 0]}>
        <mesh geometry={made.knuckle} material={made.graphite} />
        <mesh geometry={made.strut} material={made.pearl} position={[0, 0, -2.3]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 4.6, 1]} />
        <group ref={fore} position={[0, 0, -4.6]} rotation={[1.75, 0, 0]}>
          <mesh geometry={made.knuckle} material={made.graphite} />
          <mesh geometry={made.strut} material={made.pearl} position={[0, 0, -2.1]} rotation={[Math.PI / 2, 0, 0]} scale={[0.85, 4.2, 0.85]} />
          <mesh ref={tip} geometry={made.probe} material={made.gold} position={[0, 0, -4.3]} />
        </group>
      </group>
      {/* while the camera is away looking at something, the craft says which one it is */}
      {inspect && !first && <Html position={[0, 8.5, 0]} center zIndexRange={[4, 0]}><span className="w-tag" data-testid="craft-tag">your craft · waiting here</span></Html>}
    </group>
  );
}
