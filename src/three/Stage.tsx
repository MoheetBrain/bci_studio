// Level stages, level-to-level transitions ("dive into the chip"), and per-frame drivers
// (assembly animation, smoothed explode, lid, clocks, floor height, reduced-motion mirror).
import { CHIP_W } from './geometry';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, type Group } from 'three';
import { LevelContext, PresetContext } from './levelContext';
import type { Preset } from '../model/types';
import {
  LEVELS_3D,
  damp,
  easeInOutCubic,
  explodeLocal,
  is3DLevel,
  levelGroups,
  motionRate,
  presetGroups,
  registry,
  runtime,
  smoothstep,
  useView,
  type Level3D,
} from './viewStore';
import { useScene } from '../state/sceneStore';
import { PKG } from './PackageScene';
import { DIE_SIZE } from './dieLayout';

export const ASSEMBLY_SECONDS = 2.6;
const ASSEMBLY_SECONDS_REDUCED = 0.45;
const TRANSITION_SECONDS = 1.25;
const TRANSITION_SECONDS_REDUCED = 0.15;

/** Floor (grid + grounded shadow) height per level: just under the lowest part, assembled and exploded. */
export const FLOOR: Record<Level3D, { base: number; drop: number }> = {
  system: { base: -0.62, drop: -2.45 },
  package: { base: -0.3, drop: -0.82 },
  die: { base: -0.16, drop: 0 },
};

/** Hero part of a parent level that the child level "zooms out of", and the size ratio. */
const PAIRS: Record<string, { parent: Level3D; child: Level3D; hero: string; heroY: number; ratio: number }> = {
  'system>package': { parent: 'system', child: 'package', hero: 'sys.hbci01', heroY: 0.08, ratio: CHIP_W / PKG.sub.w },
  'package>die': { parent: 'package', child: 'die', hero: 'pkg.die', heroY: PKG.sub.t / 2 + PKG.die.t / 2, ratio: PKG.die.w / DIE_SIZE },
};

export function initialLevel3D(): Level3D {
  const l = useScene.getState().level;
  return is3DLevel(l) ? l : 'system';
}

export function LevelStage({ level, children }: { level: Level3D; children: ReactNode }) {
  const ref = useRef<Group>(null!);
  useLayoutEffect(() => {
    const g = ref.current;
    levelGroups[level] = g;
    g.visible = runtime.levelActive[level];
    return () => {
      if (levelGroups[level] === g) delete levelGroups[level];
    };
  }, [level]);
  return (
    <LevelContext.Provider value={level}>
      <group ref={ref}>{children}</group>
    </LevelContext.Provider>
  );
}

/**
 * One System-level preset. Both presets stay mounted; the inactive one cross-fades out and is
 * hidden (so it is never picked, framed or rendered). The group keeps an identity transform.
 */
export function PresetStage({ preset, children }: { preset: Preset; children: ReactNode }) {
  const ref = useRef<Group>(null!);
  useLayoutEffect(() => {
    const g = ref.current;
    presetGroups[preset] = g;
    const on = useScene.getState().preset === preset;
    runtime.presetOpacity[preset] = on ? 1 : 0;
    g.visible = on;
    return () => {
      if (presetGroups[preset] === g) delete presetGroups[preset];
    };
  }, [preset]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = useScene.getState().preset === preset ? 1 : 0;
    const other: Preset = preset === 'bench' ? 'cortical' : 'bench';
    let v = runtime.presetOpacity[preset];
    // fade the outgoing preset quickly; fade the incoming one in once the other is mostly gone
    if (!(target === 1 && runtime.presetOpacity[other] > 0.4)) v += (target - v) * damp(dt, motionRate(target ? 5 : 9));
    if (Math.abs(v - target) < 0.003) v = target;
    runtime.presetOpacity[preset] = v;
    ref.current.visible = v > 0.003;
  }, -1);
  return (
    <PresetContext.Provider value={preset}>
      <group ref={ref}>{children}</group>
    </PresetContext.Provider>
  );
}

interface Transition {
  kind: 'down' | 'up' | 'cross';
  from: Level3D;
  to: Level3D;
  parent: Level3D;
  child: Level3D;
  pivot: Vector3;
  ratio: number;
  t: number;
  seconds: number;
}

function resetGroup(l: Level3D, active: boolean) {
  const g = levelGroups[l];
  runtime.levelActive[l] = active;
  runtime.levelOpacity[l] = active ? 1 : 0;
  if (!g) return;
  g.position.set(0, 0, 0);
  g.scale.setScalar(1);
  g.visible = active;
}

/** Drives transitions and all per-frame shared values. Runs before parts (priority -2). */
export function Drivers({ floorRef }: { floorRef: React.RefObject<Group> }) {
  const tr = useRef<Transition | null>(null);

  useLayoutEffect(() => {
    let last3d = initialLevel3D();
    for (const l of LEVELS_3D) resetGroup(l, l === last3d);
    runtime.explode = useScene.getState().explode;

    const start = (from: Level3D, to: Level3D) => {
      // finish a running transition immediately
      if (tr.current) {
        for (const l of LEVELS_3D) resetGroup(l, l === tr.current.to);
        tr.current = null;
      }
      let down: (typeof PAIRS)[string] | undefined = PAIRS[`${from}>${to}`];
      let up: (typeof PAIRS)[string] | undefined = PAIRS[`${to}>${from}`];
      // The chip is not part of the cortical concept scene: never zoom "into" it from there.
      if (useScene.getState().preset !== 'bench' && (down ?? up)?.parent === 'system') down = up = undefined;
      const pair = down ?? up;
      const pivot = new Vector3();
      if (pair) {
        const pg = levelGroups[pair.parent];
        const hero = registry.get(pair.hero);
        if (pg && hero) {
          pg.position.set(0, 0, 0);
          pg.scale.setScalar(1);
          pg.updateMatrixWorld(true);
          hero.getWorldPosition(pivot);
          pg.worldToLocal(pivot);
          pivot.y += pair.heroY;
        }
      }
      tr.current = {
        kind: down ? 'down' : up ? 'up' : 'cross',
        from,
        to,
        parent: pair?.parent ?? from,
        child: pair?.child ?? to,
        pivot,
        ratio: pair?.ratio ?? 1,
        t: 0,
        seconds: useScene.getState().reducedMotion ? TRANSITION_SECONDS_REDUCED : TRANSITION_SECONDS,
      };
      runtime.levelActive[from] = true;
      runtime.levelActive[to] = true;
      const fg = levelGroups[from], tg = levelGroups[to];
      if (fg) fg.visible = true;
      if (tg) tg.visible = true;
      runtime.transitionActive = true;
      useView.getState().setTransitioning(true);
    };

    return useScene.subscribe((s, p) => {
      if (s.level === p.level || !is3DLevel(s.level) || s.level === last3d) return;
      const from = last3d;
      last3d = s.level;
      start(from, s.level);
    });
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = useScene.getState();
    runtime.reducedMotion = s.reducedMotion;
    runtime.paused = s.paused;
    runtime.clock += dt;
    if (!s.paused) runtime.time += dt;

    // assembly animation (Separate / Assemble)
    if (s.mode !== 'idle' && !s.paused) {
      const secs = s.reducedMotion ? ASSEMBLY_SECONDS_REDUCED : ASSEMBLY_SECONDS;
      const dir = s.mode === 'assembling' ? -1 : 1;
      const v = s.explode + (dir * dt) / secs;
      if (dir < 0 && v <= 0) useScene.setState({ explode: 0, mode: 'idle' });
      else if (dir > 0 && v >= 1) useScene.setState({ explode: 1, mode: 'idle' });
      else useScene.setState({ explode: v });
    }
    const target = useScene.getState().explode;
    runtime.explode += (target - runtime.explode) * damp(dt, motionRate(s.mode === 'idle' ? 7 : 24));

    const v = useView.getState();
    runtime.lidLift += (v.lidLift - runtime.lidLift) * damp(dt, motionRate(4.5));
    runtime.lidOpacity += (v.lidOpacity - runtime.lidOpacity) * damp(dt, motionRate(6));

    // level transition
    const T = tr.current;
    if (T) {
      T.t = Math.min(1, T.t + dt / T.seconds);
      const e = easeInOutCubic(T.t);
      if (T.kind === 'cross') {
        const deeper = LEVELS_3D.indexOf(T.to) > LEVELS_3D.indexOf(T.from);
        const fg = levelGroups[T.from], tg = levelGroups[T.to];
        fg?.scale.setScalar(1 + (deeper ? 0.6 : -0.4) * e);
        tg?.scale.setScalar((deeper ? 0.6 : 1.6) + (deeper ? 0.4 : -0.6) * e);
        runtime.levelOpacity[T.from] = 1 - smoothstep(0, 0.7, e);
        runtime.levelOpacity[T.to] = smoothstep(0.3, 1, e);
      } else {
        // parent zooms around the hero until the hero fills the child's frame
        const k = T.kind === 'down' ? e : 1 - e;
        const sc = 1 + (1 / T.ratio - 1) * k;
        const pg = levelGroups[T.parent], cg = levelGroups[T.child];
        if (pg) {
          pg.scale.setScalar(sc);
          pg.position.copy(T.pivot).multiplyScalar(-sc * k);
        }
        if (cg) {
          cg.scale.setScalar(T.ratio * sc);
          cg.position.copy(T.pivot).multiplyScalar(sc * (1 - k));
        }
        runtime.levelOpacity[T.parent] = 1 - smoothstep(0.3, 0.85, k);
        runtime.levelOpacity[T.child] = smoothstep(0.12, 0.6, k);
      }
      if (T.t >= 1) {
        for (const l of LEVELS_3D) resetGroup(l, l === T.to);
        tr.current = null;
        runtime.transitionActive = false;
        useView.getState().setTransitioning(false);
      }
    }

    // floor (grid + grounded shadow) follows the current level and sinks as the assembly separates
    const g = floorRef.current;
    if (g) {
      const cur = tr.current?.to ?? (LEVELS_3D.find((l) => runtime.levelActive[l]) ?? 'system');
      const f = FLOOR[cur];
      const gy = f.base + f.drop * explodeLocal(runtime.explode);
      g.position.y += (gy - g.position.y) * damp(dt, motionRate(tr.current ? 3 : 10));
    }
  }, -2);

  return null;
}
