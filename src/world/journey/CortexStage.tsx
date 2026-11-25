// The one block of tissue the journey takes place in.
//
//   the five-cell circuit + its probe      the timing experiment (LIF model; the probe is a synthetic observation);
//   the electrode array + 24 units         the decoder task (population model, feature-level surrogate);
//   everything else                        scenery.
// The block is ILLUSTRATIVE: a representative arrangement drawn for learning. It is not the tissue under the atlas
// point that was entered, and the atlas contains no cells.
import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CylinderGeometry, Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import { workshopCircuit } from '../model/circuits';
import { ARRAY_CENTRE, ARRAY_TIPS, BLOCK, CIRCUIT_CENTRE, HOME, OVERVIEW, PROBE_AXIS, PROBE_TIP, UNIT_POS, type V3 } from '../model/layout';
import { PILOT_UNITS } from '../model/pilot';
import { rt, type SceneSpec } from '../runtime';
import { WorldCanvas, type BlockScenery } from '../WorldCanvas';
import { useWorld } from '../worldStore';
import { useTask } from './decoderTask';

const CIRCUIT = workshopCircuit(0);
export const SPEC: SceneSpec = {
  key: 'journey-cortex',
  cells: [
    ...CIRCUIT.cells.map((x) => ({ id: x.id, label: x.label, pos: x.pos as V3, radius: x.kind === 'inh' ? 7.6 : 9.2, tint: (x.id === 'A' || x.id === 'B' ? 'input' : x.kind === 'inh' ? 'inh' : 'exc') as 'input' | 'inh' | 'exc', shape: (x.kind === 'inh' ? 'multipolar' : 'pyramidal') as 'multipolar' | 'pyramidal' })),
    ...PILOT_UNITS.map((u, i) => ({ id: `u${u.id}`, label: `Unit ${u.id + 1}`, pos: UNIT_POS[i], radius: [8.6, 7.6, 7][u.rank], tint: (['near', 'mid', 'far'] as const)[u.rank], shape: 'pyramidal' as const })),
  ],
  links: CIRCUIT.conns.map((k) => ({ id: k.id, from: k.from, to: k.to, inhibitory: k.w < 0 })),
  sites: [{ id: 'probe', label: 'Recording probe', pos: PROBE_TIP, radius: 10 }, ...ARRAY_TIPS.map((p, ch) => ({ id: `ch${ch + 1}`, label: `Contact ${ch + 1}`, pos: p, radius: 11 }))],
  home: HOME, overview: OVERVIEW,
};
export const isUnit = (id: string) => /^u\d+$/.test(id);
export const isContact = (id: string) => /^ch\d$/.test(id);

const SHANK_TOP = BLOCK.max[1] + 160;
function along(a: V3, b: V3, step: number, r: number): Array<{ p: V3; r: number }> {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(d / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ p: [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n] as V3, r }));
}
const BLOCK_SCENERY: BlockScenery = {
  box: BLOCK,
  avoid: [
    ...SPEC.cells.map((c) => ({ p: c.pos, r: 64 })),
    ...ARRAY_TIPS.flatMap((t) => along(t, [t[0], SHANK_TOP, t[2]], 70, 46)),
    ...along(PROBE_TIP, [PROBE_TIP[0] + PROBE_AXIS[0] * 700, PROBE_TIP[1] + PROBE_AXIS[1] * 700, PROBE_TIP[2] + PROBE_AXIS[2] * 700], 70, 42),
    // the first view, and the line of sight from the circuit to the array, are kept open
    ...along(HOME.pos, CIRCUIT_CENTRE, 80, 110),
    ...along(CIRCUIT_CENTRE, ARRAY_CENTRE, 110, 84),
  ],
  vessel: [[-800, -250, 320], [-360, -205, 130], [60, -268, -150], [470, -214, -430], [1020, -276, -780]],
  scaleBar: [-70, -170, 110],
};

const UP = new Vector3(0, 1, 0);
/** One electrode: an insulated shank that narrows to an exposed metal tip. `site` = index of its flash in rt.site. */
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

function Hardware() {
  const lost = useTask((s) => s.info?.cond.lost ?? []), overview = useWorld((s) => s.ctl.orbitLabel === 'Overview');
  return (
    <>
      <Electrode tip={PROBE_TIP} axis={PROBE_AXIS} length={760} radius={2.3} site={0} />
      {ARRAY_TIPS.map((t, ch) => <Electrode key={ch} tip={t} axis={[0, 1, 0]} length={SHANK_TOP - t[1]} radius={3.1} site={1 + ch} lost={lost.includes(ch)} />)}
      {overview && (
        <>
          <Html position={[CIRCUIT_CENTRE[0], 250, CIRCUIT_CENTRE[2]]} center zIndexRange={[3, 0]}><span className="w-tag accent" data-testid="zone-circuit">Five-cell circuit · LIF model · one probe</span></Html>
          <Html position={[ARRAY_CENTRE[0], 250, ARRAY_CENTRE[2]]} center zIndexRange={[3, 0]}><span className="w-tag accent" data-testid="zone-array">Electrode array · a different model: 24 units, 8 contacts</span></Html>
        </>
      )}
    </>
  );
}

const ROLE: Record<string, string> = { A: 'input', B: 'input', I: 'inhibitory', T: 'does it fire?', D: 'fires if T does', probe: 'synthetic observation' };
export function CortexStage({ active }: { active: boolean }) {
  return (
    <WorldCanvas spec={SPEC} block={BLOCK_SCENERY} active={active} tag={(id) => ROLE[id] ?? (isUnit(id) ? `contact ${PILOT_UNITS[+id.slice(1)].ch + 1} · population model` : isContact(id) ? 'array' : '')}>
      <Hardware />
    </WorldCanvas>
  );
}
