// <Part id=…>: wraps the geometry of one registry component. Handles real raycast picking
// (hover / click / double-click), staggered explode offsets, "move for inspection" offsets,
// isolate/hide fades, ghosting, x-ray shells, soft rim tints (signal path, lab activity) and labels.
// Selection and hover are drawn by the screen-space outline pass (Outline.tsx), not by colour.
import { useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Color, type Group, type Material, type Mesh, type Object3D } from 'three';
import { useScene, isVisible } from '../state/sceneStore';
import { COMPONENTS, ancestorsOf } from '../model/components';
import { patchRim } from './materials';
import { damp, explodeLocal, motionRate, registry, runtime, useView } from './viewStore';
import { LevelContext, PresetContext } from './levelContext';
import { labelRegistry, labelShown } from './labels';
import { themeColors } from './theme';

type V3 = [number, number, number];

interface MatBase {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

const COL_XRAY = new Color('#aab3bb').multiplyScalar(0.3);
const ZERO: V3 = [0, 0, 0];

/** Time of the last inspection-gizmo drag end; clicks right after it are not selections. */
export const gizmoGuard = { until: 0 };
export function clickBlocked(): boolean {
  return runtime.transitionActive || useView.getState().inspectionDragging || performance.now() < gizmoGuard.until;
}

function addScaled(t: Color, c: Color, k: number) {
  t.r += c.r * k;
  t.g += c.g * k;
  t.b += c.b * k;
}

function isLabActive(id: string, blocks: string[]): boolean {
  if (blocks.length === 0) return false;
  if (blocks.includes(id)) return true;
  if (id === 'sys.hbci01' || id === 'pkg.die') return blocks.some((b) => b.startsWith('rtl.') || b === 'die.pads');
  return false;
}

/** Visit the meshes owned by `self` (not those of nested parts). */
function forOwn(root: Object3D, self: Object3D, cb: (o: Mesh) => void) {
  const ch = root.children;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c !== self && c.userData.partRoot) continue;
    const m = c as Mesh;
    if (m.isMesh || (c as unknown as { isSprite?: boolean }).isSprite) cb(m);
    forOwn(c, self, cb);
  }
}

export interface PartProps {
  /** Registry id. Omit for non-pickable decoration that still fades with the level. */
  id?: string;
  position?: V3;
  rotation?: V3;
  /** Explode offset at explode = 1. */
  offset?: V3;
  /** Stagger delay for the explode animation (0..0.5). */
  delay?: number;
  /** X-ray turns this part into a translucent shell. */
  shell?: boolean;
  /** Local anchor for labels and signal-path lines. */
  anchor?: V3;
  /** Render an automatic label at the anchor. */
  label?: 'left' | 'right' | false;
  /** Leader-line height in px (vary it to keep neighbouring labels apart). */
  lead?: number;
  /** Label text (defaults to the registry name). */
  labelText?: string;
  children?: ReactNode;
}

export function Part({ id, position = ZERO, rotation, offset, delay = 0, shell, anchor = [0, 0.2, 0], label = 'right', lead, labelText, children }: PartProps) {
  const level = useContext(LevelContext);
  const preset = useContext(PresetContext);
  const outer = useRef<Group>(null!);
  const inner = useRef<Group>(null!);
  const ancestors = useMemo(() => (id ? ancestorsOf(id) : []), [id]);
  const st = useRef({ vis: 1, ghost: 1, xr: 1, dim: 1, rim: new Color(0, 0, 0), rimT: new Color(), insp: [0, 0, 0] as V3 });

  useLayoutEffect(() => {
    const o = outer.current;
    o.userData.partRoot = true;
    o.userData.partId = id;
    o.userData.anchor = anchor;
    if (id) {
      registry.set(id, o);
      return () => {
        if (registry.get(id) === o) registry.delete(id);
      };
    }
  }, [id]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const o = outer.current;
    const s = useScene.getState();
    const S = st.current;
    // explode offset (staggered) + smoothed "move for inspection" offset
    const k = offset ? explodeLocal(runtime.explode, delay) : 0;
    const want = (id && s.inspectionOffsets[id]) || ZERO;
    const ki = damp(dt, motionRate(16));
    S.insp[0] += (want[0] - S.insp[0]) * ki;
    S.insp[1] += (want[1] - S.insp[1]) * ki;
    S.insp[2] += (want[2] - S.insp[2]) * ki;
    if (offset || id) {
      o.position.set(
        position[0] + (offset ? offset[0] * k : 0) + S.insp[0],
        position[1] + (offset ? offset[1] * k : 0) + S.insp[1],
        position[2] + (offset ? offset[2] * k : 0) + S.insp[2],
      );
    }
    if (!runtime.levelActive[level]) return;

    const sel = s.selectedId;
    const visT = id ? (isVisible(s, id) ? 1 : 0) : s.isolateId ? 0 : 1;
    const inSel = !!id && !!sel && (id === sel || ancestors.includes(sel));
    const ghostT = s.ghostOthers && sel && !inSel ? 0.14 : 1;
    const xrT = shell && s.xray ? 0.07 : 1;
    const dimT = id ? runtime.dimTarget.get(id) ?? 1 : 1;
    const kf = damp(dt, motionRate(9));
    S.vis += (visT - S.vis) * kf;
    S.ghost += (ghostT - S.ghost) * kf;
    S.xr += (xrT - S.xr) * kf;
    S.dim += (dimT - S.dim) * damp(dt, motionRate(6));
    const presetF = preset ? runtime.presetOpacity[preset] : 1;
    const f = S.vis * S.ghost * S.xr * S.dim * runtime.levelOpacity[level] * presetF;

    // soft tints: signal path (info blue) and lab activity (channel colour or accent). No pulsing glow.
    S.rimT.setRGB(0, 0, 0);
    if (id) {
      if (runtime.pathSet.has(id)) addScaled(S.rimT, themeColors.accent, 0.28);
      if (isLabActive(id, s.activeBlocks)) {
        const c = s.pulseChannel !== null ? themeColors.ch[s.pulseChannel % 8] : themeColors.accent;
        addScaled(S.rimT, c, runtime.motion ? 0.42 + 0.14 * Math.sin(runtime.clock * 5) : 0.5);
      }
    }
    if (shell && s.xray) S.rimT.add(COL_XRAY);
    S.rim.lerp(S.rimT, damp(dt, motionRate(14)));

    const meshVisible = f > 0.004;
    forOwn(inner.current, o, (m) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material as Material];
      for (const mat of mats) {
        if (!mat) continue;
        let b = mat.userData.__base as MatBase | undefined;
        if (!b) {
          b = { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite };
          mat.userData.__base = b;
          patchRim(mat);
        }
        const baseOp = (mat.userData.baseOpacity as number | undefined) ?? b.opacity;
        const op = baseOp * f;
        mat.opacity = op;
        mat.transparent = b.transparent || op < 0.995;
        mat.depthWrite = op > 0.6 ? b.depthWrite : false;
        const rim = mat.userData.rim as { value: Color } | undefined;
        if (rim) rim.value.copy(S.rim).multiplyScalar(Math.min(1, f * 1.4));
      }
      if (!m.userData.selfVisible) m.visible = meshVisible;
    });
    inner.current.userData.noPick = f < 0.05 || (shell && s.xray);
  });

  const handlers = id
    ? {
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (useScene.getState().hoveredId !== id) useScene.getState().hover(id);
        },
        onPointerOut: () => {
          if (useScene.getState().hoveredId === id) useScene.getState().hover(null);
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 5 || clickBlocked()) return;
          useScene.getState().select(id);
        },
        onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (clickBlocked()) return;
          const s = useScene.getState();
          if (COMPONENTS[id]?.enter && COMPONENTS[id].enter !== s.level) s.enter(id);
          else {
            s.select(id);
            s.requestFit();
          }
        },
      }
    : {};

  return (
    <group ref={outer} position={position} rotation={rotation}>
      <group ref={inner} {...handlers}>
        {children}
      </group>
      {id && label && <PartLabel id={id} position={anchor} side={label} lead={lead} text={labelText} />}
    </group>
  );
}

/**
 * Html callout: a dot at the anchor, a thin vertical leader and a tag. Shows only when the label
 * policy allows it and the part is visible. The LabelLayout pass pushes tags apart vertically via
 * the `--dy` custom property; the leader stretches with it, so the tag always points at its own part.
 */
export function PartLabel({ id, position, side = 'right', text, lead = 40, cls }: { id: string; position: V3; side?: 'left' | 'right'; text?: string; lead?: number; cls?: string }) {
  const level = useContext(LevelContext);
  const preset = useContext(PresetContext);
  const show = useScene((s) => labelShown(s, id, level, preset));
  const ghost = useScene((s) => s.ghostOthers && !!s.selectedId && s.selectedId !== id && !ancestorsOf(id).includes(s.selectedId));
  const selected = useScene((s) => s.selectedId === id);
  const hovered = useScene((s) => s.hoveredId === id);
  const transitioning = useView((s) => s.transitioning);
  // The silicon die inside a closed, opaque package: never point the callout at the lid instead.
  const dieHidden = useView((s) => s.dieOccluded) && id === 'pkg.die' && level === 'package';
  const anchorRef = useRef<Group>(null!);
  const elRef = useRef<HTMLDivElement | null>(null);
  const register = (el: HTMLDivElement | null) => {
    if (elRef.current && elRef.current !== el) labelRegistry.delete(elRef.current);
    elRef.current = el;
    if (el) {
      const tag = el.querySelector<HTMLElement>('.lbl3d-tag');
      labelRegistry.set(el, { obj: anchorRef.current, el, lead, side, w: tag?.offsetWidth ?? 120, h: tag?.offsetHeight ?? 22 });
    }
  };
  const c = COMPONENTS[id];
  const canEnter = !!c?.enter && c.enter !== level;
  const visible = show && !transitioning && !dieHidden;
  return (
    <group ref={anchorRef} position={position}>
      {visible && (
        <Html zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={register}
            className={`lbl3d ${side}${ghost ? ' ghost' : ''}${selected ? ' sel' : ''}${hovered ? ' hov' : ''}${cls ? ` ${cls}` : ''}`}
            style={{ ['--lead' as string]: `${lead}px` }}
            data-label={id}
          >
            <span className="lbl3d-dot" />
            <span className="lbl3d-lead" aria-hidden />
            <button
              className="lbl3d-tag"
              title={`${c?.name ?? id} — click to select${canEnter ? `, double-click to explore inside (${c!.enter})` : ''}`}
              onPointerEnter={() => useScene.getState().hover(id)}
              onPointerLeave={() => useScene.getState().hoveredId === id && useScene.getState().hover(null)}
              onClick={() => !clickBlocked() && useScene.getState().select(id)}
              onDoubleClick={() => (canEnter ? useScene.getState().enter(id) : useScene.getState().requestFit())}
            >
              <i className={`ev-dot ev-${c?.evidence ?? 'CONCEPT'}`} />
              {text ?? c?.name ?? id}
            </button>
          </div>
        </Html>
      )}
    </group>
  );
}
