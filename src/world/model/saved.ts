// What the world remembers between visits, as a versioned record — and how an older record is read.
//
// Four kinds of state are kept apart in it, because they are different things:
//   navigation     where the player's craft was and how it was looked at (pose, third/first person). Never an input
//                  to a model or a recording;
//   instruments    where the two recording contacts are — inside `lab`, with the causes they were recorded under;
//   model          the experiment: every step's causes, the baseline, the seed of the observation noise (`lab`);
//   presentation   how much explanation and how much tissue is shown, the route's progress, preferences.
//
// Versions:
//   1   (key hbci.world.journey.v1) one fixed probe; history entries were {setup, label}; baseline was a set-up;
//       `pose` was the camera's.
//   2   (key hbci.world.journey.v2) contacts P1 and P2 are state: every history entry and the baseline carry a contact
//       layout; the seed is recorded; `pose` is the craft's.
// A version-1 record is read as: the same causes and history, no contact placed anywhere (the fixed probe is gone),
// the camera's pose taken as the craft's. Anything that is not a valid record of either version gives the defaults.
// Pure module. Unit-tested in tests/world-embodied.test.ts.
import type { WorkshopSetup } from './circuits.ts';
import { NO_CONTACTS, PROBE_SEED, contactPosition, type Contacts, type SavedEntry, type SavedLab } from './journey.ts';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'hbci.world.journey.v2';
export const SAVE_KEY_V1 = 'hbci.world.journey.v1';

export type Level = 'observe' | 'understand' | 'inspect';
export type Station = 'circuit' | 'array';
export type RevealMode = 'explore' | 'dense' | 'isolate';
export interface SavedPose { pos: [number, number, number]; yaw: number; pitch: number }
export interface Saved {
  v: 2;
  visited: boolean; beats: Record<string, boolean>; level: Level; station: Station; guide: boolean; declared: boolean;
  lab: SavedLab | null;
  pose: SavedPose | null;
  viewKind: 'third' | 'first';
  reveal: RevealMode;
  entry: { id: string; name: string } | null;
  dragLooks: boolean; lookScale: number;
}
export const DEFAULT_SAVED: Saved = {
  v: 2, visited: false, beats: {}, level: 'observe', station: 'circuit', guide: true, declared: false, lab: null, pose: null,
  viewKind: 'third', reveal: 'explore', entry: null, dragLooks: false, lookScale: 1,
};

type Box = { min: readonly number[]; max: readonly number[] };
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const oneOf = <T extends string>(x: unknown, list: readonly T[], d: T): T => (list.includes(x as T) ? (x as T) : d);

function setupOf(x: unknown): WorkshopSetup | null {
  if (!obj(x) || !fin(x.variant) || !obj(x.conn) || !Array.isArray(x.extra)) return null;
  const t = (v: unknown) => v === null || fin(v);
  if (!t(x.aMs) || !t(x.bMs)) return null;
  return x as unknown as WorkshopSetup;
}
function contactsOf(x: unknown, box: Box): Contacts {
  if (!obj(x)) return { ...NO_CONTACTS };
  return { P1: contactPosition(x.P1 as number[] | null, box), P2: contactPosition(x.P2 as number[] | null, box) };
}
function poseOf(x: unknown, box: Box): SavedPose | null {
  if (!obj(x) || !Array.isArray(x.pos) || x.pos.length < 3 || !x.pos.slice(0, 3).every(fin) || !fin(x.yaw) || !fin(x.pitch)) return null;
  const p = x.pos as number[];
  return { pos: [0, 1, 2].map((k) => Math.max(box.min[k], Math.min(box.max[k], p[k]))) as [number, number, number], yaw: x.yaw, pitch: Math.max(-1.5, Math.min(1.5, x.pitch)) };
}
function labOf(x: unknown, box: Box): SavedLab | null {
  if (!obj(x) || !Array.isArray(x.history) || !x.history.length) return null;
  const history: SavedEntry[] = [];
  for (const h of x.history) {
    const setup = obj(h) ? setupOf(h.setup) : null;
    if (!setup) return null;
    history.push({ setup, contacts: contactsOf((h as Record<string, unknown>).contacts, box), label: typeof (h as Record<string, unknown>).label === 'string' ? ((h as Record<string, unknown>).label as string) : '' });
  }
  const b = obj(x.baseline) ? setupOf(x.baseline.setup) : null;
  return { history, baseline: b ? { setup: b, contacts: contactsOf((x.baseline as Record<string, unknown>).contacts, box) } : null, seed: fin(x.seed) ? x.seed : PROBE_SEED };
}
function common(x: Record<string, unknown>): Pick<Saved, 'visited' | 'beats' | 'level' | 'station' | 'guide' | 'declared' | 'entry' | 'dragLooks' | 'lookScale'> {
  const beats: Record<string, boolean> = {};
  if (obj(x.beats)) for (const [k, v] of Object.entries(x.beats)) if (v === true) beats[k] = true;
  const e = x.entry;
  return {
    visited: x.visited === true, beats, level: oneOf(x.level, ['observe', 'understand', 'inspect'] as const, 'observe'), station: oneOf(x.station, ['circuit', 'array'] as const, 'circuit'),
    guide: x.guide !== false, declared: x.declared === true, entry: obj(e) && typeof e.id === 'string' && typeof e.name === 'string' ? { id: e.id, name: e.name } : null,
    dragLooks: x.dragLooks === true, lookScale: fin(x.lookScale) ? Math.max(0.5, Math.min(2, x.lookScale)) : 1,
  };
}

/**
 * A current record from whatever was stored: `v2` if there is one, else `v1` (the older format), else the defaults.
 * `box` is the block the craft and the contacts must be inside.
 */
export function readSaved(v2: unknown, v1: unknown, box: Box): Saved {
  if (obj(v2) && v2.v === 2) {
    return { v: 2, ...common(v2), lab: labOf(v2.lab, box), pose: poseOf(v2.pose, box), viewKind: oneOf(v2.viewKind, ['third', 'first'] as const, 'third'), reveal: oneOf(v2.reveal, ['explore', 'dense', 'isolate'] as const, 'explore') };
  }
  if (obj(v1)) {
    // version 1: the history is a list of {setup, label}; the baseline is a set-up; no contact was state
    const hist = Array.isArray(v1.history) ? v1.history : [];
    const lab = labOf({ history: hist.map((h) => (obj(h) ? { setup: h.setup, label: h.label } : null)), baseline: v1.baseline ? { setup: v1.baseline } : null }, box);
    // a step of the old route that no longer exists (the fixed probe) is dropped; the rest of the progress is kept
    const c = common(v1); delete c.beats.record;
    return { v: 2, ...c, lab, pose: poseOf(v1.pose, box), viewKind: 'third', reveal: 'explore' };
  }
  return { ...DEFAULT_SAVED, beats: {} };
}
