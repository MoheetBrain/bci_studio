// Which workspace is showing. The region selection is NOT stored here: it lives in atlasStore and is shared by all
// workspaces, so moving along the journey never loses "where in the brain" the learner is.
import { create } from 'zustand';

export type Workspace = 'brain' | 'interface' | 'signal' | 'chip' | 'research';

export const WORKSPACES: Array<{ id: Workspace; label: string; step: string; hint: string }> = [
  { id: 'brain', label: 'Brain', step: '1', hint: 'Anatomical atlas: find and select a region' },
  { id: 'interface', label: 'Neural interface', step: '2', hint: 'From cortical area to neurons and an electrode contact' },
  { id: 'signal', label: 'Signal journey', step: '3', hint: 'Electrode → analogue front end → ADC → digital processing → decoder' },
  { id: 'chip', label: 'Our chip', step: '4', hint: 'What the Hamiltonian digital design actually implements, traced to source' },
  { id: 'research', label: 'Research', step: '5', hint: 'Search the local source corpus and read the evidence' },
];

function fromHash(): Workspace {
  const m = /^#\/([a-z]+)/.exec(typeof location === 'undefined' ? '' : location.hash);
  const id = m?.[1] as Workspace | undefined;
  return id && WORKSPACES.some((w) => w.id === id) ? id : 'brain';
}

interface ShellState {
  workspace: Workspace;
  /** Query handed to the Research workspace (e.g. from a "supporting research" link). */
  researchQuery: string;
  /** Sub-view inside the chip workspace: the source-traced map, or the full existing studio. */
  chipView: 'map' | 'studio';
  go: (w: Workspace) => void;
  openResearch: (query: string) => void;
  setChipView: (v: 'map' | 'studio') => void;
}

export const useShell = create<ShellState>((set) => ({
  workspace: fromHash(),
  researchQuery: '',
  chipView: 'map',
  go: (w) => {
    if (typeof location !== 'undefined' && location.hash !== `#/${w}`) history.replaceState(null, '', `#/${w}`);
    set({ workspace: w });
  },
  openResearch: (query) => {
    if (typeof location !== 'undefined') history.replaceState(null, '', '#/research');
    set({ workspace: 'research', researchQuery: query });
  },
  setChipView: (v) => set({ chipView: v }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const w = fromHash();
    if (w !== useShell.getState().workspace) useShell.setState({ workspace: w });
  });
}
