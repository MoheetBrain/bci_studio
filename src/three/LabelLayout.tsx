// Vertical de-confliction of label tags: every frame, project each mounted label's anchor, sort the
// tags by screen y and push overlapping tags apart (upwards, lengthening their leaders) by writing
// the `--dy` custom property. Tags never move sideways, so a label always sits above its own part.
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { labelRegistry, type LabelEntry } from './labels';

const _v = new Vector3();
const GAP = 6;

interface Item {
  e: LabelEntry;
  x0: number;
  x1: number;
  /** Tag centre y with no extra offset. */
  y: number;
  dy: number;
}

const items: Item[] = [];

export function LabelLayout() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    items.length = 0;
    if (labelRegistry.size < 2) {
      labelRegistry.forEach((e) => e.el.style.setProperty('--dy', '0px'));
      return;
    }
    const hw = size.width / 2, hh = size.height / 2;
    labelRegistry.forEach((e) => {
      if (!e.el.isConnected) return;
      e.obj.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(e.obj.matrixWorld).project(camera);
      if (_v.z > 1 || _v.z < -1) return;
      const sx = _v.x * hw + hw;
      const sy = -_v.y * hh + hh;
      const x0 = e.side === 'right' ? sx + 4 : sx - 4 - e.w;
      items.push({ e, x0, x1: x0 + e.w, y: sy - e.lead - e.h / 2, dy: 0 });
    });
    // lowest tag first; each later (higher) tag is pushed up until it clears every conflicting tag below it
    items.sort((a, b) => b.y - a.y);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let y = it.y;
      for (let j = 0; j < i; j++) {
        const o = items[j];
        if (it.x1 < o.x0 - GAP || it.x0 > o.x1 + GAP) continue;
        const oy = o.y - o.dy;
        const minY = oy - (o.e.h + it.e.h) / 2 - GAP;
        if (y > minY) y = minY;
      }
      it.dy = it.y - y;
    }
    for (const it of items) it.e.el.style.setProperty('--dy', `${it.dy > 0.5 ? Math.round(it.dy) : 0}px`);
  }, 3);
  return null;
}
