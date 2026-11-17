// Microscope state shared by the die map, the module view, the signal inspector, the cell view and the
// "Explore my chip" course. Owned by the main agent: add fields if needed, do not rename existing ones.
// Nothing here is evidence: it only records what the learner is looking at.
import { create } from 'zustand';

/**
 * Netlist scope: the v0.3 readout core top (v03), the legacy event core inside it (event), the v0.4 integrated
 * top hbci02_digital_top (v04) or the on-chip decoder hbci_ai_decoder (ai). All from rtl_modules.json.
 */
export type NetScope = 'v03' | 'event' | 'v04' | 'ai';

/** What the line / signal inspector is showing. */
export type SignalRef =
  /** A die-map route (conceptual drawing) identified by its DieEdge id (dieLayout.ts). */
  | { kind: 'route'; edge: string }
  /** A real net of the netlist (rtl_modules.json), e.g. 'bq_y'. */
  | { kind: 'net'; net: string; scope: NetScope }
  /** An instance-to-instance bundle of nets (netlist "airline"), e.g. 'u_fstate>u_biquad'. */
  | { kind: 'pair'; pair: string; scope: NetScope };

/** Lines drawn on the die: the conceptual routes, or straight netlist "airlines". */
export type LineMode = 'concept' | 'netlist';

/** Which tab the cell level (Level 4) shows. */
export type CellTab = 'pdk' | 'tutorial';

export interface MicroState {
  /** Selected line / net / bundle for the signal inspector (null = inspector closed). */
  signal: SignalRef | null;
  /** The route / bundle a net was opened from (for "back"). */
  prevSignal: SignalRef | null;
  /** Sample cursor into rtl_trace_v03.json samples[] (accepted-sample index i). */
  cursor: number;
  /** Sample cursor into the separate v0.2 event-core trace (rtl_trace.json) for the legacy blocks. */
  legacyCursor: number;
  /** Show binary next to decimal values. */
  showBits: boolean;
  /** Die line drawing mode. */
  lineMode: LineMode;
  /** Selected illustrative die pad (index into the drawn pads), null = none. */
  pad: number | null;
  /** "What am I looking at?" card. */
  helpOpen: boolean;
  /** Focus mode: side panels and the lab drawer collapsed (previous layout remembered). */
  focus: { on: boolean; prev: { leftOpen: boolean; rightOpen: boolean; labSize: string } | null };
  /** Level 4 tab. */
  cellTab: CellTab;
  /** Explore-my-chip course: lesson index (0..6) or null when closed, the step inside it, completed lessons. */
  course: { lesson: number | null; step: number; done: number[] };
  /** Module view (Level 1/2): which sub-view is shown. */
  moduleTab: 'dataflow' | 'compute';
  /** Module view: step inside the worked computation (0 = state read … 4 = output). */
  computeStep: number;
  /** Physical-layout level: which tab is shown ('layout' = the genuine v0.2 GDS, 'layout_v04' = the v0.4 chip top when published). */
  layoutTab: 'concept' | 'layout' | 'layout_v03' | 'layout_v04';
  /** Die route / netlist line under the pointer (for the hover tooltip). */
  hoverRoute: string | null;

  setSignal: (s: SignalRef | null) => void;
  setCursor: (i: number) => void;
  setLegacyCursor: (i: number) => void;
  setShowBits: (v: boolean) => void;
  setLineMode: (m: LineMode) => void;
  setPad: (i: number | null) => void;
  setHelpOpen: (v: boolean) => void;
  setFocus: (on: boolean, prev?: MicroState['focus']['prev']) => void;
  setCellTab: (t: CellTab) => void;
  setCourse: (c: Partial<MicroState['course']>) => void;
  setModuleTab: (t: MicroState['moduleTab']) => void;
  setComputeStep: (n: number) => void;
  setLayoutTab: (t: MicroState['layoutTab']) => void;
  setHoverRoute: (id: string | null) => void;
}

export const useMicro = create<MicroState>((set, get) => ({
  signal: null,
  prevSignal: null,
  cursor: 250,
  legacyCursor: 105,
  showBits: false,
  lineMode: 'concept',
  pad: null,
  helpOpen: false,
  focus: { on: false, prev: null },
  cellTab: 'pdk',
  course: { lesson: null, step: 0, done: [] },
  moduleTab: 'dataflow',
  computeStep: 0,
  layoutTab: 'layout',
  hoverRoute: null,

  setSignal: (s) => {
    const cur = get().signal;
    const prev = s && s.kind === 'net' && cur && cur.kind !== 'net' ? cur : s && s.kind !== 'net' ? null : get().prevSignal;
    set({ signal: s, prevSignal: s ? prev : null, pad: s ? null : get().pad });
  },
  setCursor: (i) => set({ cursor: Math.max(0, Math.round(i)) }),
  setLegacyCursor: (i) => set({ legacyCursor: Math.max(0, Math.round(i)) }),
  setShowBits: (v) => set({ showBits: v }),
  setLineMode: (m) => set({ lineMode: m }),
  setPad: (i) => set({ pad: i, signal: i !== null ? null : get().signal }),
  setHelpOpen: (v) => set({ helpOpen: v }),
  setFocus: (on, prev) => set({ focus: { on, prev: prev === undefined ? get().focus.prev : prev } }),
  setCellTab: (t) => set({ cellTab: t }),
  setCourse: (c) => set({ course: { ...get().course, ...c } }),
  setModuleTab: (t) => set({ moduleTab: t }),
  setComputeStep: (n) => set({ computeStep: Math.max(0, Math.min(4, n)) }),
  setLayoutTab: (t) => set({ layoutTab: t }),
  setHoverRoute: (id) => get().hoverRoute !== id && set({ hoverRoute: id }),
}));
