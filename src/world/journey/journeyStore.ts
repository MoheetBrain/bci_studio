// Where the player is in the journey, and what of it is remembered between visits.
//
//   place     brain     the whole brain (the atlas's own surface and labels);
//             cortex    one block of ILLUSTRATIVE tissue under the region that was entered — not cells from the atlas;
//             entering / leaving   the reversible move between the two.
//   station   inside the cortex, which model is running: the five-cell circuit (timing experiment) or the array's
//             population (decoder task). They are different models; only one advances at a time.
//   level     how much explanation is on screen: observe (the scene and one sentence), understand (the linked
//             traces), inspect (equations, parameters, units, sources).
//
// The experiment itself lives in circuitLab.ts and decoderTask.ts and is not reset by moving between places.
import { create } from 'zustand';
import type { WorkshopSetup } from '../model/circuits';

export type Place = 'brain' | 'entering' | 'cortex' | 'leaving';
export type Station = 'circuit' | 'array';
export type Level = 'observe' | 'understand' | 'inspect';
export interface RegionPick { id: string; name: string; hemisphere: string; tissue: string; group: string | null; enterable: boolean }

/** The steps of the authored route. Each is ticked by something that actually happened, in any order. */
export const BEATS = [
  { id: 'arrive', place: 'brain', prompt: 'Drag to turn the brain. Move over it to name its parts.' },
  { id: 'enter', place: 'brain', prompt: 'Go in where the glow is: the left precentral gyrus.' },
  { id: 'explore', place: 'cortex', prompt: 'You are an observer inside the tissue. W A S D to fly, drag to look. Fly up to a cell.' },
  { id: 'notice', place: 'cortex', prompt: 'Two input cells fire, one after the other. Watch the cell they both reach — T. Does it fire?' },
  { id: 'change', place: 'cortex', prompt: 'Change one cause: select input cell B and make it fire earlier.' },
  { id: 'compare', place: 'cortex', prompt: 'Open the trace and compare with the baseline. Why did the outcome change?' },
  { id: 'record', place: 'cortex', prompt: 'Now look at it from outside: select the probe beside T. What does an electrode see?' },
  { id: 'engineer', place: 'cortex', prompt: 'Counts like that are all a decoder gets. Go to the electrode array and run the control task.' },
  { id: 'disrupt', place: 'cortex', prompt: 'Break it: lose three contacts. Watch the cursor.' },
  { id: 'recover', place: 'cortex', prompt: 'Get control back — by switching decoder, by recalibrating, or by restoring the contacts.' },
  { id: 'return', place: 'cortex', prompt: 'Go back out to the brain whenever you like (the map, bottom left). Nothing is lost.' },
] as const;
export type BeatId = (typeof BEATS)[number]['id'];

const KEY = 'hbci.world.journey.v1';
interface Saved {
  visited: boolean; beats: Partial<Record<BeatId, boolean>>; level: Level; station: Station; guide: boolean; declared: boolean;
  history: Array<{ setup: WorkshopSetup; label: string }>; baseline: WorkshopSetup | null;
  pose: { pos: [number, number, number]; yaw: number; pitch: number } | null;
  entry: { id: string; name: string } | null;
  dragLooks: boolean; lookScale: number;
}
function load(): Partial<Saved> {
  try { const x = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return x && typeof x === 'object' ? x : {}; } catch { return {}; }
}
const saved = typeof localStorage === 'undefined' ? {} : load();

interface JourneyState {
  place: Place;
  station: Station;
  level: Level;
  /** What is selected on the whole brain (an atlas structure). */
  region: RegionPick | null;
  hoverRegion: { id: string; name: string } | null;
  /** The atlas structure the cortex was entered from. */
  entry: { id: string; name: string } | null;
  beats: Partial<Record<BeatId, boolean>>;
  guide: boolean;
  /** True once the cortex has been entered in this browser. */
  visited: boolean;
  /** The "this is a different model" statement has been read. */
  declared: boolean;
  /** Who the keyboard belongs to right now. */
  owner: 'observer' | 'pilot' | 'interface';
  /** What a visit left behind, for "return to where you were". */
  resume: Pick<Saved, 'history' | 'baseline' | 'pose' | 'station'> | null;
  dragLooks: boolean; lookScale: number;
  tick: (b: BeatId) => void;
  set: (p: Partial<JourneyState>) => void;
  remember: (p: Partial<Saved>) => void;
  forget: () => void;
}

let pending: Partial<Saved> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
function write(p: Partial<Saved>): void {
  pending = { ...pending, ...p };
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { localStorage.setItem(KEY, JSON.stringify({ ...load(), ...pending })); } catch { /* storage unavailable: nothing is remembered */ }
    pending = {};
  }, 400);
}

export const useJourney = create<JourneyState>((set, get) => ({
  place: 'brain', station: 'circuit', level: saved.level ?? 'observe',
  region: null, hoverRegion: null, entry: saved.entry ?? null,
  beats: saved.beats ?? {}, guide: saved.guide ?? true, visited: !!saved.visited, declared: !!saved.declared, owner: 'observer',
  resume: saved.visited && saved.history?.length ? { history: saved.history, baseline: saved.baseline ?? null, pose: saved.pose ?? null, station: saved.station ?? 'circuit' } : null,
  dragLooks: !!saved.dragLooks, lookScale: typeof saved.lookScale === 'number' ? saved.lookScale : 1,
  tick: (b) => { if (get().beats[b]) return; const beats = { ...get().beats, [b]: true }; set({ beats }); write({ beats }); },
  set: (p) => {
    set(p);
    const keep: Partial<Saved> = {};
    for (const k of ['level', 'station', 'guide', 'declared', 'visited', 'entry', 'dragLooks', 'lookScale'] as const) if (k in p) (keep as Record<string, unknown>)[k] = (p as Record<string, unknown>)[k];
    if (Object.keys(keep).length) write(keep);
  },
  remember: (p) => write(p),
  forget: () => { try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ } pending = {}; set({ beats: {}, visited: false, declared: false, resume: null, guide: true, level: 'observe', station: 'circuit', entry: null }); },
}));

/**
 * The next step of the route for the place the player is in: the first one not yet done that comes AFTER the last one
 * done there. A step that was skipped is not brought up again — the route follows the player, not the other way round.
 */
export function nextBeat(s: Pick<JourneyState, 'beats' | 'place'>): (typeof BEATS)[number] | null {
  const here = s.place === 'brain' || s.place === 'leaving' ? 'brain' : 'cortex', list = BEATS.filter((b) => b.place === here);
  let last = -1;
  list.forEach((b, i) => { if (s.beats[b.id]) last = i; });
  return list.slice(last + 1).find((b) => !s.beats[b.id]) ?? null;
}
