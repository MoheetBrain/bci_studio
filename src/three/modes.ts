// v0.3 readout-core processing modes as seen on the die: which data path generates records.
// Colours come from the shared CSS tokens (--mode-*) so the 3D view, badges and plots agree.
import type { ProcMode } from '../model/types';
import { subscribeTheme3D, theme3d } from './theme';

export const PROC_MODES: ProcMode[] = ['EVENT', 'RAW', 'FEATURE', 'HYBRID'];

/**
 * Die data paths. 'all' = shared input/output plumbing used by every mode. 'ai' = the on-chip decoder (v0.4): the
 * FEATURE tap is not gated by cfg_mode, so the decoder path is active in every mode while session_en & ai_en.
 */
export type DiePath = 'event' | 'raw' | 'feature' | 'ai' | 'all';

/** Live colour per path (object identity is stable; values follow the theme). */
export const PATH_COLOR: Record<Exclude<DiePath, 'all'>, string> = {
  event: theme3d.mode.EVENT,
  raw: theme3d.mode.RAW,
  feature: theme3d.mode.FEATURE,
  ai: theme3d.ai,
};

/** Live colour per mode (object identity is stable; values follow the theme). */
export const MODE_COLOR: Record<ProcMode, string> = { ...theme3d.mode };

function sync() {
  PATH_COLOR.event = theme3d.mode.EVENT;
  PATH_COLOR.raw = theme3d.mode.RAW;
  PATH_COLOR.feature = theme3d.mode.FEATURE;
  PATH_COLOR.ai = theme3d.ai;
  for (const m of PROC_MODES) MODE_COLOR[m] = theme3d.mode[m];
}
subscribeTheme3D(sync);

/** True if `p` generates records in mode `m` (spec: docs/V03_READOUT_SPEC.md). */
export function pathActive(p: DiePath, m: ProcMode): boolean {
  if (p === 'all' || p === 'ai') return true;
  if (p === 'event') return m === 'EVENT';
  if (p === 'raw') return m === 'RAW' || m === 'HYBRID';
  return m === 'FEATURE' || m === 'HYBRID';
}

/** Die path of a component id (RTL blocks), from its registry modes. */
export function pathOfModes(modes: ProcMode[] | undefined): DiePath {
  if (!modes || modes.length === 0 || modes.length === 4) return 'all';
  if (modes.includes('EVENT')) return 'event';
  if (modes.includes('RAW')) return 'raw';
  return 'feature';
}
