// "Move for inspection": a translate-only gizmo on the selected part. It never moves the part's
// group directly (parts position themselves every frame); it drags a proxy and writes the world
// delta into useScene.inspectionOffsets, which Part.tsx applies as a presentation-only offset.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { Box3, Matrix4, Vector3, type Group } from 'three';
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';
import { registry, useView } from './viewStore';
import { visibleBox } from './CameraRig';
import { gizmoGuard } from './Part';

const _box = new Box3();

export function InspectionGizmo() {
  const on = useScene((s) => s.inspectionMode);
  const sel = useScene((s) => s.selectedId);
  const level = useScene((s) => s.level);
  const proxy = useRef<Group>(null!);
  const drag = useRef<{ id: string; start: Vector3; base: [number, number, number] | null; inv: Matrix4 } | null>(null);
  const tmp = useMemo(() => ({ a: new Vector3(), b: new Vector3() }), []);
  const target = on && sel && COMPONENTS[sel]?.level === level && registry.has(sel) ? sel : null;

  // keep the proxy on the part (its visible bounds centre) while not dragging
  useFrame(() => {
    if (!target || drag.current || !proxy.current) return;
    const o = registry.get(target);
    if (!o) return;
    visibleBox(o, _box);
    if (_box.isEmpty()) o.getWorldPosition(proxy.current.position);
    else _box.getCenter(proxy.current.position);
  });

  if (!target) return null;
  const S = useScene.getState;
  return (
    <>
      <group ref={proxy} />
      <TransformControls
        object={proxy}
        mode="translate"
        size={1}
        onMouseDown={() => {
          const o = registry.get(target);
          if (!o || !proxy.current) return;
          const parent = o.parent;
          const inv = new Matrix4();
          if (parent) {
            parent.updateWorldMatrix(true, false);
            inv.copy(parent.matrixWorld).invert();
          }
          const base = S().inspectionOffsets[target] ?? null;
          drag.current = { id: target, start: proxy.current.position.clone(), base, inv };
          useView.getState().pushInspectionUndo(target, base);
          useView.getState().setInspectionDragging(true);
        }}
        onObjectChange={() => {
          const d = drag.current;
          if (!d || !proxy.current) return;
          tmp.a.copy(d.start).applyMatrix4(d.inv);
          tmp.b.copy(proxy.current.position).applyMatrix4(d.inv);
          const b = d.base ?? [0, 0, 0];
          S().setInspectionOffset(d.id, [b[0] + tmp.b.x - tmp.a.x, b[1] + tmp.b.y - tmp.a.y, b[2] + tmp.b.z - tmp.a.z]);
        }}
        onMouseUp={() => {
          drag.current = null;
          useView.getState().setInspectionDragging(false);
          gizmoGuard.until = performance.now() + 350;
        }}
      />
    </>
  );
}
