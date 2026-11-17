// Signal-path overlay for the system/package levels: dashed arcs in the accent colour between the
// anchors of consecutive components on the `feeds` chain, with small travelling markers (static
// when motion is reduced or paused).
import { useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Color, Object3D, Vector3, type InstancedMesh, type MeshBasicMaterial } from 'three';
import { LevelContext } from './levelContext';
import { arcPoints } from './geometry';
import { levelGroups, partAnchorWorld, runtime } from './viewStore';
import { themeColors } from './theme';
import { COMPONENTS, COMPONENT_LIST, ancestorsOf } from '../model/components';
import { useScene, isVisible } from '../state/sceneStore';
import type { Level } from '../model/types';

const POOL = 12;
const SEG = 28;

/** Ids and edges of the signal path through `sel` (both directions) on `level`. */
export function computePath(sel: string | null, level: Level, on: boolean): { set: Set<string>; edges: [string, string][] } {
  const set = new Set<string>();
  if (!on) return { set, edges: [] };
  const all: [string, string][] = [];
  for (const c of COMPONENT_LIST) {
    if (c.level !== level) continue;
    for (const f of c.feeds ?? []) if (COMPONENTS[f]?.level === level) all.push([c.id, f]);
  }
  const inEdges = (id: string) => all.some(([a, b]) => a === id || b === id);
  if (!sel || !inEdges(sel)) {
    // No selection (or a container such as rtl.core): the whole chain below it.
    const scoped = all.filter(([a, b]) => !sel || sel === a || sel === b || (ancestorsOf(a).includes(sel) && ancestorsOf(b).includes(sel)));
    scoped.forEach(([a, b]) => (set.add(a), set.add(b)));
    return { set, edges: scoped };
  }
  const walk = (start: string, dir: 'down' | 'up') => {
    const out = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const [a, b] of all) {
        const next = dir === 'down' ? (a === cur ? b : null) : b === cur ? a : null;
        if (next && !out.has(next)) {
          out.add(next);
          stack.push(next);
        }
      }
    }
    return out;
  };
  const down = walk(sel, 'down');
  const up = walk(sel, 'up');
  down.forEach((x) => set.add(x));
  up.forEach((x) => set.add(x));
  const edges = all.filter(([a, b]) => (down.has(a) && down.has(b)) || (up.has(a) && up.has(b)));
  return { set, edges };
}

/** Keeps runtime.pathSet / pathEdges in sync with the store. Mount once inside the Canvas. */
export function PathSync() {
  useLayoutEffect(() => {
    const update = () => {
      const s = useScene.getState();
      const r = computePath(s.selectedId, s.level, s.highlightPath);
      runtime.pathSet = r.set;
      runtime.pathEdges = r.edges;
    };
    update();
    return useScene.subscribe((s, p) => {
      if (s.selectedId !== p.selectedId || s.highlightPath !== p.highlightPath || s.level !== p.level) update();
    });
  }, []);
  return null;
}


export function SignalPathArcs() {
  const level = useContext(LevelContext);
  const lines = useRef<(React.ElementRef<typeof Line> | null)[]>([]);
  const pulses = useRef<InstancedMesh>(null!);
  const init = useMemo(() => Array.from({ length: SEG + 1 }, (_, i) => [i * 0.01, 0, 0] as [number, number, number]), []);
  const colors = useMemo(() => Array.from({ length: SEG + 1 }, () => new Color('#ffffff')), []);
  const tmp = useMemo(() => ({ a: new Vector3(), b: new Vector3(), o: new Object3D(), buf: [] as number[] }), []);

  useLayoutEffect(() => {
    lines.current.forEach((l) => l && (l.visible = false));
    pulses.current.count = 0;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = useScene.getState();
    const g = levelGroups[level as 'system'];
    const on = s.highlightPath && s.level === level && runtime.levelActive[level as 'system'] && !runtime.transitionActive && !!g;
    let used = 0;
    let n = 0;
    if (on) {
      for (const [ida, idb] of runtime.pathEdges) {
        if (used >= POOL) break;
        if (COMPONENTS[ida]?.level !== level || !isVisible(s, ida) || !isVisible(s, idb)) continue;
        if (!partAnchorWorld(ida, tmp.a) || !partAnchorWorld(idb, tmp.b)) continue;
        g!.worldToLocal(tmp.a);
        g!.worldToLocal(tmp.b);
        const lift = 0.25 + tmp.a.distanceTo(tmp.b) * 0.12;
        arcPoints(tmp.a, tmp.b, lift, SEG, tmp.buf);
        const line = lines.current[used];
        if (line) {
          line.visible = true;
          line.geometry.setPositions(tmp.buf);
          line.computeLineDistances();
          const mat = line.material as unknown as { dashOffset: number; color: Color };
          mat.color.copy(themeColors.accent);
          if (runtime.motion) mat.dashOffset -= dt * 1.4;
        }
        // three markers per edge travelling a → b (held still when motion is reduced)
        for (let k = 0; k < 3; k++) {
          const u = ((runtime.reducedMotion ? 0.35 : runtime.clock * 0.45) + k / 3) % 1;
          const i = Math.min(SEG - 1, Math.floor(u * SEG));
          const f = u * SEG - i;
          const bf = tmp.buf;
          tmp.o.position.set(
            bf[i * 3] + (bf[i * 3 + 3] - bf[i * 3]) * f,
            bf[i * 3 + 1] + (bf[i * 3 + 4] - bf[i * 3 + 1]) * f,
            bf[i * 3 + 2] + (bf[i * 3 + 5] - bf[i * 3 + 2]) * f,
          );
          tmp.o.updateMatrix();
          pulses.current.setMatrixAt(n++, tmp.o.matrix);
        }
        used++;
      }
    }
    for (let i = used; i < POOL; i++) {
      const l = lines.current[i];
      if (l) l.visible = false;
    }
    pulses.current.count = n;
    pulses.current.instanceMatrix.needsUpdate = true;
    (pulses.current.material as MeshBasicMaterial).color.copy(themeColors.accent);
  });

  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <Line
          key={i}
          ref={(l) => (lines.current[i] = l)}
          points={init}
          vertexColors={colors}
          color="#176b62"
          lineWidth={1.8}
          dashed
          dashSize={0.22}
          gapSize={0.1}
          transparent
          opacity={0.9}
          toneMapped={false}
          raycast={() => null}
        />
      ))}
      <instancedMesh ref={pulses} args={[undefined, undefined, POOL * 3]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[0.045, 12, 8]} />
        <meshBasicMaterial color="#176b62" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
