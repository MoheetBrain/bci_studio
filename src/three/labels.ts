// Label policy ("focus" = the selection and its immediate neighbours, max 4; "all"; "none") and the
// screen-space registry used to de-conflict label tags vertically.
import type { Object3D } from 'three';
import { COMPONENTS, COMPONENT_LIST, childrenOf } from '../model/components';
import { isVisible, type SceneState } from '../state/sceneStore';
import type { Level, Preset } from '../model/types';

export const FOCUS_MAX = 4;

const cache = new Map<string, string[]>();

/** Ids whose labels show under the focus policy: the selection, what it feeds, its parent, its children
 * and what feeds it, restricted to the current level and capped at FOCUS_MAX. */
export function focusIds(sel: string | null, level: Level): string[] {
  const key = `${sel ?? ''}|${level}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: string[] = [];
  const c = sel ? COMPONENTS[sel] : null;
  if (c) {
    const push = (id?: string | null) => {
      if (id && COMPONENTS[id] && !out.includes(id)) out.push(id);
    };
    push(sel);
    (c.feeds ?? []).forEach(push);
    push(c.parent);
    // children that can be explored further (e.g. the silicon die inside the package) come first
    const kids = childrenOf(c.id);
    kids.filter((k) => k.enter).forEach((k) => push(k.id));
    kids.forEach((k) => push(k.id));
    COMPONENT_LIST.filter((x) => x.feeds?.includes(c.id)).forEach((x) => push(x.id));
  }
  const res = out.filter((id) => COMPONENTS[id].level === level).slice(0, FOCUS_MAX);
  cache.set(key, res);
  return res;
}

/** Whether the label of `id` (rendered by a part on `level` / `preset`) should be shown. */
export function labelShown(s: SceneState, id: string, level: Level, preset: Preset | null): boolean {
  if (!s.labels || s.labelPolicy === 'none') return false;
  if (s.level !== level || (preset && s.preset !== preset)) return false;
  if (!isVisible(s, id)) return false;
  if (s.labelPolicy === 'all') return true;
  return focusIds(s.selectedId, s.level).includes(id);
}

/** One mounted label: its 3D anchor object, root element, lead length and measured tag box. */
export interface LabelEntry {
  obj: Object3D;
  el: HTMLElement;
  lead: number;
  side: 'left' | 'right';
  w: number;
  h: number;
}

/** Mounted labels (keyed by their root element). The LabelLayout pass reads it every frame. */
export const labelRegistry = new Map<HTMLElement, LabelEntry>();
