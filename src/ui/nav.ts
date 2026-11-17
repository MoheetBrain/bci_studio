// Navigation helpers shared by the tree, the inspector and the viewport overlays.
import type { ComponentInfo, Level, Preset } from '../model/types';
import { COMPONENTS, ancestorsOf } from '../model/components';
import { useScene } from '../state/sceneStore';

/** The System preset that shows `c` (null when it is shown by both or is not on the System level). */
export function presetOf(c: ComponentInfo): Preset | null {
  if (c.level !== 'system') return null;
  const chain = [c.id, ...ancestorsOf(c.id)];
  if (chain.includes('cx.root')) return 'cortical';
  if (c.id === 'sys.hbci01') return null; // the chip stays reachable from both presets
  if (chain.includes('sys.root')) return 'bench';
  return c.preset ?? null;
}

/** Switch to the preset that shows `c`, if needed (setPreset clears the selection, so call it first). */
export function ensurePresetFor(c: ComponentInfo) {
  const s = useScene.getState();
  const p = presetOf(c);
  if (p && p !== s.preset) s.setPreset(p);
}

/** Select a component from outside the 3D view, navigating to the level (and preset) that shows it. */
export function selectAndNavigate(c: ComponentInfo) {
  const s = useScene.getState();
  // In the 2D circuit / module / gate views, RTL blocks stay in that view (it follows the selection).
  const stayIn2D = (s.level === 'circuit' || s.level === 'gates' || s.level === 'module') && c.id.startsWith('rtl.');
  ensurePresetFor(c);
  if (c.level !== s.level && !stayIn2D) s.setLevel(c.level);
  useScene.getState().select(c.id);
}

const LEVEL_NAME: Record<Level, string> = {
  system: 'the system',
  package: 'the package',
  die: 'the silicon die',
  circuit: 'its circuit',
  module: 'the module microscope',
  gates: 'its gates',
  cell: 'a standard cell',
  layout: 'its layout',
};

/**
 * What "Explore inside" opens for the selection while `level` is shown: the component's own
 * `enter` level, or — for the chip and its package parts while the package is shown — the die.
 */
export function exploreTarget(selId: string | null, level: Level): { id: string; level: Level; what: string } | null {
  if (!selId) return null;
  const c = COMPONENTS[selId];
  if (!c) return null;
  if (c.enter && c.enter !== level) return { id: c.id, level: c.enter, what: LEVEL_NAME[c.enter] };
  if (level === 'package' && (c.id === 'sys.hbci01' || c.id.startsWith('pkg.'))) return { id: 'pkg.die', level: 'die', what: LEVEL_NAME.die };
  return null;
}

/** Run "Explore inside" for the current selection (no-op when there is nothing to enter). */
export function exploreInside() {
  const s = useScene.getState();
  const t = exploreTarget(s.selectedId, s.level);
  if (t) s.enter(t.id);
}
