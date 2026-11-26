// The one block of tissue the journey takes place in.
//
//   the five-cell circuit                  the timing experiment (LIF model);
//   recording contacts P1 and P2           placed, moved and left behind by the player. Each is a point at which the
//                                          synthetic observation model is evaluated (model/observe.ts) — their positions
//                                          are the experiment's own state, in model coordinates (circuitLab.ts);
//   the electrode array + 24 units         the decoder task (population model, feature-level surrogate). Its eight
//                                          contacts are NOT P1/P2 and P1/P2 never feed the decoder;
//   one reconstructed neuron (H01)         structure only: an exemplar from published data, with no model attached;
//   everything else                        scenery and landmarks.
// The block is ILLUSTRATIVE: a representative arrangement drawn for learning. It is not the tissue under the atlas
// point that was entered, and the atlas contains no cells. The open space the craft flies through is a display
// choice (most cells and nearly all fibres are left out) — not a gap that exists in tissue.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CylinderGeometry, Quaternion, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import { controller } from '../controller';
import { boundOf, lookDir, type PickBody } from '../flight';
import { workshopCircuit } from '../model/circuits';
import { CONTACT_IDS, type ContactId } from '../model/journey';
import { ARRAY_CENTRE, ARRAY_TIPS, BLOCK, CIRCUIT_CENTRE, EXEMPLAR, HOME, OVERVIEW, UNIT_POS, VESSEL, exemplarToScene, modelToScene, sceneToModel, type V3 } from '../model/layout';
import { ampAtUv, distUm } from '../model/observe';
import { PILOT_UNITS } from '../model/pilot';
import { setBodies } from '../pickRegistry';
import { rt, type SceneSpec } from '../runtime';
import { WorldCanvas, type BlockScenery, type SkeletonCell } from '../WorldCanvas';
import { useWorld } from '../worldStore';
import { CONTACT_SITE, contactAt, isContactId, useLab } from './circuitLab';
import { useTask } from './decoderTask';
import { EXEMPLAR_ID, loadExemplar, useExemplar } from './exemplar';

const CIRCUIT = workshopCircuit(0);
/** Radius the reconstructed cell's body is drawn with, µm (the asset's own estimate, rounded). */
const EXEMPLAR_SOMA_UM = 4.8;
export const SPEC: SceneSpec = {
  key: 'journey-cortex-2',
  cells: [
    ...CIRCUIT.cells.map((x) => ({ id: x.id, label: x.label, pos: x.pos as V3, radius: x.kind === 'inh' ? 7.6 : 9.2, tint: (x.id === 'A' || x.id === 'B' ? 'input' : x.kind === 'inh' ? 'inh' : 'exc') as 'input' | 'inh' | 'exc', shape: (x.kind === 'inh' ? 'multipolar' : 'pyramidal') as 'multipolar' | 'pyramidal' })),
    ...PILOT_UNITS.map((u, i) => ({ id: `u${u.id}`, label: `Unit ${u.id + 1}`, pos: UNIT_POS[i], radius: [8.6, 7.6, 7][u.rank], tint: (['near', 'mid', 'far'] as const)[u.rank], shape: 'pyramidal' as const })),
    // after the cells of the two models, so that their numbers in the scene's arrays stay what the models expect
    { id: EXEMPLAR_ID, label: 'Reconstructed neuron', pos: EXEMPLAR.origin, radius: EXEMPLAR_SOMA_UM, tint: 'exemplar' as const, shape: 'skeleton' as const, context: true },
  ],
  links: CIRCUIT.conns.map((k) => ({ id: k.id, from: k.from, to: k.to, inhibitory: k.w < 0 })),
  sites: ARRAY_TIPS.map((p, ch) => ({ id: `ch${ch + 1}`, label: `Array contact ${ch + 1}`, pos: p, radius: 11 })),
  home: HOME, overview: OVERVIEW,
};
export const isUnit = (id: string) => /^u\d+$/.test(id);
export const isContact = (id: string) => /^ch\d$/.test(id);
export const isCircuitCell = (id: string) => CIRCUIT.cells.some((c) => c.id === id);
/** Where the whole of the reconstructed neuron is, for looking at all of it: a point up its apical side, and a radius. */
export const EXEMPLAR_VIEW = { centre: [EXEMPLAR.origin[0], EXEMPLAR.origin[1] + 85, EXEMPLAR.origin[2]] as V3, radius: 150 };

/** What the stage knows that the click handler needs: where a contact would be put down right now. */
export const stage = { preview: null as V3 | null };

const SHANK_TOP = BLOCK.max[1] + 160;
function along(a: V3, b: V3, step: number, r: number): Array<{ p: V3; r: number }> {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(d / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ p: [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n] as V3, r }));
}
const chain = (pts: V3[], step: number, r: number) => pts.slice(1).flatMap((p, i) => along(pts[i], p, step, r));
const BLOCK_SCENERY: BlockScenery = {
  box: BLOCK,
  avoid: [
    ...SPEC.cells.map((c) => ({ p: c.pos, r: 64 })),
    ...ARRAY_TIPS.flatMap((t) => along(t, [t[0], SHANK_TOP, t[2]], 70, 46)),
    // the reconstructed neuron's arbor, the vessel, the first view, and the lines of sight between the places
    ...along([EXEMPLAR.origin[0], EXEMPLAR.origin[1] - 110, EXEMPLAR.origin[2]], [EXEMPLAR.origin[0], EXEMPLAR.origin[1] + 300, EXEMPLAR.origin[2]], 60, 135),
    ...chain(VESSEL.trunk, 80, 34), ...chain(VESSEL.branch, 80, 30),
    ...along(HOME.pos, CIRCUIT_CENTRE, 80, 110),
    ...along(CIRCUIT_CENTRE, ARRAY_CENTRE, 110, 84),
  ],
  vessels: [VESSEL.trunk, VESSEL.branch],
  scaleBar: [-70, -150, 150],
};

const UP = new Vector3(0, 1, 0);
/** One electrode of the array: an insulated shank that narrows to an exposed metal tip. `site` = index of its flash in rt.site. */
function Electrode({ tip, axis, length, radius, site, lost }: { tip: V3; axis: V3; length: number; radius: number; site: number; lost?: boolean }) {
  const metal = useRef<MeshStandardMaterial>(null);
  const q = useMemo(() => new Quaternion().setFromUnitVectors(UP, new Vector3(...axis)), [axis]);
  const shank = useMemo(() => new CylinderGeometry(radius * 1.9, radius, length, 18, 1), [radius, length]);
  useEffect(() => () => shank.dispose(), [shank]);
  const tipLen = radius * 5.2;
  useFrame(() => { if (metal.current) metal.current.emissiveIntensity = lost ? 0.02 : 0.32 + 3.2 * rt.site[site]; });
  return (
    <group position={tip} quaternion={q}>
      {/* insulated shank, starting where the exposed tip ends */}
      <mesh geometry={shank} position={[0, tipLen + length / 2, 0]}><meshStandardMaterial color={lost ? '#2B2838' : '#6C7AA6'} roughness={0.34} metalness={0.55} emissive="#1B2242" emissiveIntensity={0.6} /></mesh>
      {/* the exposed tip is the recording contact */}
      <mesh position={[0, tipLen / 2, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[radius, tipLen, 18]} /><meshStandardMaterial ref={metal} color={lost ? '#3A3644' : '#F0C590'} roughness={0.28} metalness={0.85} emissive="#FFB060" emissiveIntensity={0.3} /></mesh>
    </group>
  );
}

/** The decoder's electrode array. Its eight contacts belong to the population model and to nothing else. */
function Hardware() {
  const lost = useTask((s) => s.info?.cond.lost ?? []), overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  useEffect(() => {
    setBodies('array', ARRAY_TIPS.map((t, ch): PickBody => {
      const segs = Float32Array.of(t[0], t[1] + 16, t[2], t[0], SHANK_TOP, t[2], 6);
      return { kind: 'site', id: `ch${ch + 1}`, centre: t, radius: 9, spherePart: 'contact', segs, partNames: ['shank'], bound: boundOf(segs, t, 9) };
    }));
    return () => setBodies('array', null);
  }, []);
  return (
    <>
      {ARRAY_TIPS.map((t, ch) => <Electrode key={ch} tip={t} axis={[0, 1, 0]} length={SHANK_TOP - t[1]} radius={3.1} site={1 + ch} lost={lost.includes(ch)} />)}
      {overview && (
        <>
          <Html position={[CIRCUIT_CENTRE[0], 250, CIRCUIT_CENTRE[2]]} center zIndexRange={[3, 0]}><span className="w-tag accent" data-testid="zone-circuit">Five-cell circuit · LIF model · contacts P1 and P2</span></Html>
          <Html position={[ARRAY_CENTRE[0], 250, ARRAY_CENTRE[2]]} center zIndexRange={[3, 0]}><span className="w-tag accent" data-testid="zone-array">Electrode array · a different model: 24 units, 8 contacts</span></Html>
          <Html position={[EXEMPLAR_VIEW.centre[0], EXEMPLAR_VIEW.centre[1] + 230, EXEMPLAR_VIEW.centre[2]]} center zIndexRange={[3, 0]}><span className="w-tag" data-testid="zone-exemplar">Reconstructed neuron · structure only</span></Html>
        </>
      )}
    </>
  );
}

// ── the two recording contacts ──────────────────────────────────────────────────────────────────────────────────
const LEAD_UM = 44, BEAD_UM = 2.4;
const CONTACT_COL: Record<ContactId, string> = { P1: '#FFD08A', P2: '#9FE8C0' };
const AXES: Record<string, { dir: V3; col: string; plus: string; minus: string }> = {
  x: { dir: [1, 0, 0], col: '#FF9CA8', plus: 'x +', minus: 'x −' },
  y: { dir: [0, 1, 0], col: '#8CFFB5', plus: 'towards the surface', minus: 'deeper' },
  z: { dir: [0, 0, 1], col: '#8FB7FF', plus: 'z +', minus: 'z −' },
};
const HANDLE_UM = 24;

/** One contact: a metal bead where it records, and a short lead with a ring that carries its name so that it can be found again. */
function ContactMark({ id }: { id: ContactId }) {
  const at = useLab((s) => (s.drag?.id === id ? s.drag.pos : s.lab.contacts[id]));
  const selected = useWorld((s) => s.selected?.kind === 'site' && s.selected.id === id), hovered = useWorld((s) => s.hovered?.kind === 'site' && s.hovered.id === id);
  const metal = useRef<MeshStandardMaterial>(null);
  useFrame(() => { if (metal.current) metal.current.emissiveIntensity = 0.3 + 3.4 * rt.site[CONTACT_SITE[id]] + (selected ? 0.5 : hovered ? 0.25 : 0); });
  if (!at) return null;
  const p = modelToScene(at), col = CONTACT_COL[id];
  return (
    <group position={p} name={`contact-${id}`}>
      <mesh><sphereGeometry args={[BEAD_UM, 22, 16]} /><meshStandardMaterial ref={metal} color="#F0C590" roughness={0.26} metalness={0.86} emissive="#FFB060" emissiveIntensity={0.3} /></mesh>
      <mesh position={[0, BEAD_UM + LEAD_UM / 2, 0]}><cylinderGeometry args={[0.55, 0.55, LEAD_UM, 8]} /><meshStandardMaterial color={col} roughness={0.4} metalness={0.5} emissive={col} emissiveIntensity={0.25} /></mesh>
      <mesh position={[0, BEAD_UM + LEAD_UM, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.3, 0.6, 8, 24]} /><meshStandardMaterial color={col} roughness={0.35} metalness={0.4} emissive={col} emissiveIntensity={selected ? 1.5 : hovered ? 1 : 0.55} /></mesh>
      <Html position={[0, BEAD_UM + LEAD_UM + 9, 0]} center zIndexRange={[5, 0]}><span className={`w-tag${selected ? ' accent' : ' warm'}`} data-testid={`contact-tag-${id}`}>{selected ? '◉ ' : ''}{id}{selected || hovered ? ' · recording contact' : ''}</span></Html>
    </group>
  );
}

/** Arrows along the three axes of the block through the selected contact: drag one to slide the contact along that line. */
function Gizmo({ id }: { id: ContactId }) {
  const at = useLab((s) => (s.drag?.id === id ? s.drag.pos : s.lab.contacts[id]));
  const [k, setK] = useState(1), [hot, setHot] = useState('');
  const p = at ? modelToScene(at) : null;
  // the arrows keep a usable size on screen: they grow with the camera's distance, in coarse steps
  useFrame(() => {
    if (!p) return;
    const c = controller.camPose().pos, d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]), want = Math.max(0.55, Math.min(6, d / 120)), q = Math.round(Math.log(want) / Math.log(1.18));
    const next = Math.pow(1.18, q);
    if (Math.abs(next - k) > 1e-6) setK(next);
  });
  useEffect(() => {
    if (!p) { setBodies('handles', null); return; }
    const L = HANDLE_UM * k;
    setBodies('handles', Object.entries(AXES).map(([ax, a]): PickBody => {
      const segs = Float32Array.of(p[0] - a.dir[0] * L, p[1] - a.dir[1] * L, p[2] - a.dir[2] * L, p[0] + a.dir[0] * L, p[1] + a.dir[1] * L, p[2] + a.dir[2] * L, 1.5 * k);
      return { kind: 'handle', id: `${id}:${ax}`, segs, partNames: [ax], bound: boundOf(segs) };
    }));
    return () => setBodies('handles', null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, p?.[0], p?.[1], p?.[2], k]);
  // which arrow the pointer is on (handles are not "hovered things", so the stage asks for itself, a few times a second)
  const n = useRef(0);
  useFrame(() => {
    if (++n.current % 5 || controller.manipulating) return;
    const a = controller.captured ? ([0, 0] as [number, number]) : controller.pointer, hit = a ? controller.hitAt(a[0], a[1]) : null;
    const next = hit?.kind === 'handle' ? hit.id : '';
    if (next !== hot) setHot(next);
  });
  if (!p) return null;
  const L = HANDLE_UM * k;
  return (
    <group position={p} name="contact-gizmo">
      {Object.entries(AXES).map(([ax, a]) => {
        const on = hot === `${id}:${ax}`, rot: [number, number, number] = ax === 'x' ? [0, 0, -Math.PI / 2] : ax === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
        return (
          <group key={ax} rotation={rot}>
            <mesh><cylinderGeometry args={[0.42 * k, 0.42 * k, 2 * L - 5 * k, 8]} /><meshBasicMaterial color={a.col} fog={false} transparent opacity={on ? 1 : 0.8} depthTest={false} /></mesh>
            <mesh position={[0, L - 1.6 * k, 0]}><coneGeometry args={[(on ? 2.4 : 1.8) * k, 4.6 * k, 14]} /><meshBasicMaterial color={a.col} fog={false} depthTest={false} /></mesh>
            <mesh position={[0, -L + 1.6 * k, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[(on ? 2.4 : 1.8) * k, 4.6 * k, 14]} /><meshBasicMaterial color={a.col} fog={false} depthTest={false} /></mesh>
            {on && <Html position={[0, L + 4 * k, 0]} center zIndexRange={[6, 0]}><span className="w-tag accent" data-testid="handle-tag">drag: {a.minus} ↔ {a.plus}</span></Html>}
          </group>
        );
      })}
    </group>
  );
}

function ContactsLayer() {
  const p1 = useLab((s) => (s.drag?.id === 'P1' ? s.drag.pos : s.lab.contacts.P1)), p2 = useLab((s) => (s.drag?.id === 'P2' ? s.drag.pos : s.lab.contacts.P2));
  const sel = useWorld((s) => s.selected), tool = useLab((s) => s.tool);
  // each contact can be pointed at: its bead, or the lead that carries its ring
  useEffect(() => {
    const bodies: PickBody[] = [];
    for (const [id, m] of [['P1', p1], ['P2', p2]] as const) {
      if (!m) continue;
      const p = modelToScene(m), segs = Float32Array.of(p[0], p[1] + BEAD_UM, p[2], p[0], p[1] + BEAD_UM + LEAD_UM + 3, p[2], 2.6);
      bodies.push({ kind: 'site', id, centre: p, radius: 4.4, spherePart: 'contact', segs, partNames: ['lead'], bound: boundOf(segs, p, 4.4) });
    }
    setBodies('contacts', bodies);
    return () => setBodies('contacts', null);
  }, [p1, p2]);
  // dragging an arrow slides the contact along that arrow's line: the point of the line nearest to where you aim
  useEffect(() => {
    let g: null | { id: ContactId; axis: V3; p0: V3; s0: number } = null;
    const param = (o: V3, d: V3, p0: V3, a: V3): number | null => {
      const w: V3 = [p0[0] - o[0], p0[1] - o[1], p0[2] - o[2]], b = a[0] * d[0] + a[1] * d[1] + a[2] * d[2], den = 1 - b * b;
      if (den < 2e-3) return null;   // aiming along the arrow: no position on it can be told apart
      return (b * (d[0] * w[0] + d[1] * w[1] + d[2] * w[2]) - (a[0] * w[0] + a[1] * w[1] + a[2] * w[2])) / den;
    };
    controller.onManip = {
      start: (hit) => {
        const [cid, ax] = hit.id.split(':'), m = isContactId(cid) ? contactAt(cid) : null, a = AXES[ax];
        if (!isContactId(cid) || !m || !a) return false;
        const p0 = modelToScene(m), ray = controller.aim();
        g = { id: cid, axis: a.dir, p0, s0: (ray && param(ray.o, ray.d, p0, a.dir)) || 0 };
        useLab.getState().dragTo(cid, m);
        return true;
      },
      move: (o, d) => {
        if (!g) return;
        const s = param(o, d, g.p0, g.axis);
        if (s == null || !Number.isFinite(s)) return;
        const by = Math.max(-900, Math.min(900, s - g.s0));
        useLab.getState().dragTo(g.id, sceneToModel([g.p0[0] + g.axis[0] * by, g.p0[1] + g.axis[1] * by, g.p0[2] + g.axis[2] * by]));
      },
      end: () => { if (g) { g = null; useLab.getState().dragEnd(true); } },
      cancel: () => { g = null; useLab.getState().dragEnd(false); },
    };
    return () => { controller.onManip = null; };
  }, []);
  const gizmo = !tool && sel?.kind === 'site' && isContactId(sel.id) ? sel.id : null;
  return (
    <>
      {CONTACT_IDS.map((id) => <ContactMark key={id} id={id} />)}
      {gizmo && <Gizmo id={gizmo} />}
    </>
  );
}

/** How far in front of the craft a contact is put down when the aim meets nothing, µm. */
export const ARM_REACH_UM = 58;
const STANDOFF_UM = 6;
/** Where a contact held ready would be put down for the present aim: just outside whatever is aimed at, or at arm's reach in front of the craft. */
export function placementFor(): { pos: V3; on: string } | null {
  const ray = controller.aim();
  if (!ray) return null;
  const at = controller.captured ? ([0, 0] as [number, number]) : controller.pointer!, hit = controller.hitAt(at[0], at[1]);
  const c = controller.camPose().pos, s = controller.s.pos;
  let p: V3, on = '';
  if (hit && hit.exact && hit.kind !== 'handle' && hit.kind !== 'link' && hit.t < 520) {
    const t = Math.max(1, hit.t - STANDOFF_UM);
    p = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t]; on = hit.id;
  } else {
    const t = Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]) + ARM_REACH_UM;
    p = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
  }
  return { pos: [0, 1, 2].map((k) => Math.max(BLOCK.min[k], Math.min(BLOCK.max[k], p[k]))) as V3, on };
}
/** Straight ahead of the craft at arm's reach (for placing without a pointer). */
export function armPoint(): V3 {
  const s = controller.s, f = lookDir(s.yaw, s.pitch);
  return [0, 1, 2].map((k) => Math.max(BLOCK.min[k], Math.min(BLOCK.max[k], s.pos[k] + f[k] * ARM_REACH_UM))) as V3;
}
/** The model cell nearest to a point, how far, and how large its spike would be there. */
export function nearestCell(p: V3): { id: string; distUm: number; ampUv: number } {
  let best = CIRCUIT.cells[0], d = Infinity;
  for (const c of CIRCUIT.cells) { const x = distUm(sceneToModel(p), c.pos as V3); if (x < d) { d = x; best = c; } }
  return { id: best.id, distUm: d, ampUv: ampAtUv(d) };
}

/** While a contact is held ready: a ghost of it where it would go, a line from the craft that shows how deep that is, and what it would hear there. */
function PlacePreview() {
  const tool = useLab((s) => s.tool);
  const ghost = useRef<Group>(null), line = useRef<Mesh>(null), n = useRef(0);
  const [info, setInfo] = useState('');
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3(), q: new Quaternion() }), []);
  useEffect(() => { if (!tool) { stage.preview = null; setInfo(''); } }, [tool]);
  useFrame(() => {
    const g = ghost.current, l = line.current;
    if (!g || !l) return;
    const pl = tool ? placementFor() : null;
    stage.preview = pl ? pl.pos : null;
    g.visible = l.visible = !!pl;
    if (!pl) return;
    g.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
    // the line runs from the craft to the place: its length is the depth of the placement, seen in the scene itself
    const s = controller.s.pos;
    v.a.set(s[0], s[1] - 2.4, s[2]); v.b.set(pl.pos[0], pl.pos[1], pl.pos[2]);
    const len = v.a.distanceTo(v.b);
    l.position.copy(v.a).add(v.b).multiplyScalar(0.5);
    l.quaternion.copy(v.q.setFromUnitVectors(UP, v.b.clone().sub(v.a).normalize()));
    l.scale.set(1, Math.max(0.01, len), 1);
    if (++n.current % 6 === 0) {
      const near = nearestCell(pl.pos), run = useLab.getState().lab.result.run, fires = run.spikes[run.circuit.cells.findIndex((c) => c.id === near.id)]?.length > 0;
      const text = `${tool} here · ${near.distUm.toFixed(0)} µm from ${near.id} · ${near.id}’s spike would be ${near.ampUv.toFixed(0)} µV${fires ? '' : ` (${near.id} does not fire in this run)`}`;
      if (text !== info) setInfo(text);
    }
  });
  if (!tool) return null;
  const col = CONTACT_COL[tool];
  return (
    <>
      <group ref={ghost} visible={false} name="contact-preview">
        <mesh><sphereGeometry args={[BEAD_UM, 18, 12]} /><meshBasicMaterial color="#FFE2B0" fog={false} transparent opacity={0.85} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[6, 0.35, 8, 32]} /><meshBasicMaterial color={col} fog={false} transparent opacity={0.9} /></mesh>
        <mesh><torusGeometry args={[6, 0.35, 8, 32]} /><meshBasicMaterial color={col} fog={false} transparent opacity={0.5} /></mesh>
        <Html position={[0, 12, 0]} center zIndexRange={[6, 0]}><span className="w-tag accent" data-testid="preview-tag">{info || `${tool} here`}</span></Html>
      </group>
      <mesh ref={line} visible={false}><cylinderGeometry args={[0.22, 0.22, 1, 6]} /><meshBasicMaterial color={col} fog={false} transparent opacity={0.6} /></mesh>
    </>
  );
}

const ROLE: Record<string, string> = { A: 'input', B: 'input', I: 'inhibitory', T: 'does it fire?', D: 'fires if T does', [EXEMPLAR_ID]: 'human temporal cortex · no model' };
export function CortexStage({ active }: { active: boolean }) {
  const asset = useExemplar((s) => s.asset);
  useEffect(() => { loadExemplar(); }, []);
  const skeleton = useMemo<SkeletonCell | null>(() => (asset ? { id: EXEMPLAR_ID, nodes: asset.nodes, place: exemplarToScene } : null), [asset]);
  return (
    <WorldCanvas spec={SPEC} block={BLOCK_SCENERY} active={active} embodied skeleton={skeleton} tag={(id) => ROLE[id] ?? (isUnit(id) ? `contact ${PILOT_UNITS[+id.slice(1)].ch + 1} · population model` : isContact(id) ? 'decoder array' : '')}>
      <Hardware />
      <ContactsLayer />
      <PlacePreview />
    </WorldCanvas>
  );
}
