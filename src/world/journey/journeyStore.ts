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
// The experiment itself lives in circuitLab.ts and decoderTask.ts and is not reset by moving between places. What is
// stored, in which version, and how an older record is read: model/saved.ts.
import { create } from 'zustand';
import { BLOCK } from '../model/layout';
import type { SavedLab } from '../model/journey';
import { SAVE_KEY, SAVE_KEY_V1, readSaved, type Level, type Saved, type SavedPose, type Station } from '../model/saved';

export type { Level, Station } from '../model/saved';
export type Place = 'brain' | 'entering' | 'cortex' | 'leaving';
export interface RegionPick { id: string; name: string; hemisphere: string; tissue: string; group: string | null; enterable: boolean }

/** The steps of the authored route. Each is ticked by something that actually happened, in any order. */
export const BEATS = [
  { id: 'arrive', place: 'brain', prompt: 'Drag to turn the brain. Move over it to name its parts.' },
  { id: 'enter', place: 'brain', prompt: 'Go in where the glow is: the left precentral gyrus.' },
  { id: 'explore', place: 'cortex', prompt: 'The pearl craft in front of you is you. W A S D fly it, E and Q go up and down, drag to look. Fly up beside the large neuron ahead.' },
  { id: 'point', place: 'cortex', prompt: 'Point at any branch of a neuron. The whole cell lights up: a branch belongs to its neuron. Click to keep it selected.' },
  { id: 'notice', place: 'cortex', prompt: 'Beyond it are five model cells. Two inputs fire, one after the other. Watch the cell they both reach — T. Does it fire?' },
  { id: 'change', place: 'cortex', prompt: 'Change one cause, where it is: select input cell B and make it fire earlier.' },
  { id: 'compare', place: 'cortex', prompt: 'Open the trace and compare with the baseline. Why did the outcome change?' },
  { id: 'place', place: 'cortex', prompt: 'Now record it from outside. Take contact P1 and put it down near T; then put P2 somewhere further away.' },
  { id: 'move', place: 'cortex', prompt: 'Move P1 nearer to a cell that fires and leave P2 where it is. Same spikes, same noise: only what P1 records changes.' },
  { id: 'engineer', place: 'cortex', prompt: 'Counts like those are all a decoder gets. Go to the electrode array and run the control task.' },
  { id: 'disrupt', place: 'cortex', prompt: 'Break it: lose three contacts. Watch the cursor.' },
  { id: 'recover', place: 'cortex', prompt: 'Get control back — by switching decoder, by recalibrating, or by restoring the contacts.' },
  { id: 'return', place: 'cortex', prompt: 'Go back out to the brain whenever you like (the map, bottom left). Your contacts stay where you put them.' },
] as const;
export type BeatId = (typeof BEATS)[number]['id'];

function stored(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } }
function load(): Saved { return readSaved(typeof localStorage === 'undefined' ? null : stored(SAVE_KEY), typeof localStorage === 'undefined' ? null : stored(SAVE_KEY_V1), BLOCK); }
const saved = load();

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
  /** What a visit left behind, for "return to where you were": the experiment (with its contacts) and, separately, where the craft was. */
  resume: { lab: SavedLab | null; pose: SavedPose | null; station: Station } | null;
  dragLooks: boolean; lookScale: number;
  viewKind: 'third' | 'first';
  tick: (b: BeatId) => void;
  set: (p: Partial<JourneyState>) => void;
  remember: (p: Partial<Saved>) => void;
  forget: () => void;
}

let pending: Partial<Saved> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
function flush(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!Object.keys(pending).length) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...load(), ...pending, v: 2 })); } catch { /* storage unavailable: nothing is remembered */ }
  pending = {};
}
function write(p: Partial<Saved>): void {
  pending = { ...pending, ...p };
  if (!timer) timer = setTimeout(flush, 400);
}
/** Write what is waiting to be stored now (the page is going away). */
export const flushSaved = flush;

export const useJourney = create<JourneyState>((set, get) => ({
  place: 'brain', station: 'circuit', level: saved.level,
  region: null, hoverRegion: null, entry: saved.entry,
  beats: saved.beats as Partial<Record<BeatId, boolean>>, guide: saved.guide, visited: saved.visited, declared: saved.declared, owner: 'observer',
  resume: saved.visited && saved.lab ? { lab: saved.lab, pose: saved.pose, station: saved.station } : null,
  dragLooks: saved.dragLooks, lookScale: saved.lookScale, viewKind: saved.viewKind,
  tick: (b) => { if (get().beats[b]) return; const beats = { ...get().beats, [b]: true }; set({ beats }); write({ beats: beats as Record<string, boolean> }); },
  set: (p) => {
    set(p);
    const keep: Partial<Saved> = {};
    for (const k of ['level', 'station', 'guide', 'declared', 'visited', 'entry', 'dragLooks', 'lookScale', 'viewKind'] as const) if (k in p) (keep as Record<string, unknown>)[k] = (p as Record<string, unknown>)[k];
    if (Object.keys(keep).length) write(keep);
  },
  remember: (p) => write(p),
  forget: () => { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(SAVE_KEY_V1); } catch { /* nothing to forget */ } pending = {}; set({ beats: {}, visited: false, declared: false, resume: null, guide: true, level: 'observe', station: 'circuit', entry: null }); },
}));
/** How the tissue was last shown (read once, when the world opens). */
export const savedReveal = saved.reveal;

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
