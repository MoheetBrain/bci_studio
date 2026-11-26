// Discrete state of the world route: which toy, what is selected, which panel is open. Everything that changes every
// frame lives in runtime.ts instead.
import { create } from 'zustand';
import type { ControllerView } from './controller';
import type { BodyHit } from './flight';

export type ToyId = 'workshop' | 'flight' | 'pilot';
export const TOYS: Array<{ id: ToyId; letter: 'A' | 'B' | 'C'; name: string; question: string; verb: string }> = [
  { id: 'flight', letter: 'A', name: 'Instrument flight', question: 'Is flying up to something and finding out what it is doing satisfying in itself?', verb: 'Fly, listen with a virtual contact, silence a cell, find the one that leads.' },
  { id: 'workshop', letter: 'B', name: 'Time workshop', question: 'Is it enjoyable to change one cause and discover why the result changes?', verb: 'Move two inputs in time, switch a connection, freeze, step, replay, compare.' },
  { id: 'pilot', letter: 'C', name: 'Decoder pilot', question: 'Does getting a real control loop to work, breaking it and repairing it, make you want another go?', verb: 'Steer a cursor through a fitted decoder, break the loop, recover it two ways.' },
];
/** What is selected or aimed at: the owner, and (where it has parts) the part that was pointed at. */
export interface Selection { kind: 'cell' | 'context' | 'site' | 'link' | 'landmark'; id: string; part?: string }
/** How much of the tissue is drawn: the readable exploration view, the denser context, or one thing on its own. */
export type Reveal = 'explore' | 'dense' | 'isolate';
export type Panel = null | 'controls' | 'model' | 'runs';
export type Quality = 'high' | 'balanced' | 'low';

const reduceQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function fromHash(): ToyId | null {
  const m = /^#\/world\/([a-z]+)/.exec(typeof location === 'undefined' ? '' : location.hash);
  return TOYS.some((t) => t.id === m?.[1]) ? (m![1] as ToyId) : null;
}

interface WorldState {
  toy: ToyId | null;
  selected: Selection | null;
  hovered: Selection | null;
  panel: Panel;
  ctl: ControllerView;
  /** One line that says what is running (model, run, time), written by the active toy a few times a second. */
  running: string;
  paused: boolean;
  ready: boolean;
  quality: Quality;
  reveal: Reveal;
  reducedMotion: boolean;
  /** A short message shown for a few seconds near the reticle (what just happened). */
  notice: { text: string; n: number } | null;
  setToy: (t: ToyId | null) => void;
  select: (s: Selection | null) => void;
  setPanel: (p: Panel) => void;
  say: (text: string) => void;
}

export const useWorld = create<WorldState>((set, get) => ({
  toy: fromHash(),
  selected: null, hovered: null, panel: null,
  ctl: { mode: 'fly', captured: false, context: 'explore', speedLevel: 3, canReturn: false, orbitLabel: '', cutaway: false, moving: false, viewKind: 'third', travelling: false },
  reveal: 'explore',
  running: '', paused: false, ready: false, quality: 'high', reducedMotion: !!reduceQuery?.matches,
  notice: null,
  setToy: (toy) => {
    if (typeof location !== 'undefined') history.replaceState(null, '', toy ? `#/world/${toy}` : '#/world/dev');
    set({ toy, selected: null, hovered: null, panel: null, running: '', paused: false, ready: false, notice: null });
  },
  select: (selected) => { const a = get().selected; if (a?.id !== selected?.id || a?.kind !== selected?.kind || a?.part !== selected?.part) set({ selected }); },
  setPanel: (panel) => set({ panel }),
  say: (text) => set({ notice: { text, n: (get().notice?.n ?? 0) + 1 } }),
}));

/** A selection for what was hit (a manipulation handle is not a thing to select). */
export function selectionOf(hit: BodyHit | null): Selection | null { return hit && hit.kind !== 'handle' ? { kind: hit.kind, id: hit.id, ...(hit.part ? { part: hit.part } : {}) } : null; }

reduceQuery?.addEventListener?.('change', (e) => useWorld.setState({ reducedMotion: e.matches }));
// a change of address is followed, never rewritten: #/world is the world, #/world/dev the prototype chooser
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => { const t = fromHash(); if (t !== useWorld.getState().toy && location.hash.startsWith('#/world')) useWorld.setState({ toy: t, selected: null, hovered: null, panel: null, running: '', paused: false, ready: false, notice: null }); });
