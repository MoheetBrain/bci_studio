// Which workspace is showing. The region selection is NOT stored here: it lives in atlasStore and is shared by all
// workspaces, so moving along the journey never loses "where in the brain" the learner is.
import { create } from 'zustand';

export type Workspace = 'world' | 'brain' | 'experiment' | 'interface' | 'signal' | 'chip' | 'decoder' | 'research';

/** The scenes of the studio, ordered by physical scale: tissue → cells → electronics → silicon → computation → evidence. */
export const WORKSPACES: Array<{ id: Workspace; label: string; scale: string; hint: string }> = [
  { id: 'world', label: 'World', scale: 'fly · µm', hint: 'Enter the neural world: three small playable toys in one representative circuit' },
  { id: 'brain', label: 'Brain', scale: '15 cm', hint: 'The whole brain: find and select a region' },
  { id: 'experiment', label: 'Experiment', scale: 'BCI · live', hint: 'Attach the virtual BCI, record simulated signals and follow them to a decoded output' },
  { id: 'interface', label: 'Neurons', scale: '1 mm', hint: 'Neurons and one electrode contact beneath the selected region' },
  { id: 'signal', label: 'Signal', scale: 'µV → bits', hint: 'Electrode → amplifier → ADC → digital samples' },
  { id: 'chip', label: 'Chip', scale: 'RTL', hint: 'What the Hamiltonian digital design implements, traced to source' },
  { id: 'decoder', label: 'Decoder', scale: '8 → 2', hint: 'How eight band energies become a prediction on the chip' },
  { id: 'research', label: 'Research', scale: 'sources', hint: 'Search the local source corpus and read the evidence' },
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
  /** The region finder (⌘K). */
  paletteOpen: boolean;
  setPalette: (open: boolean) => void;
  go: (w: Workspace) => void;
  openResearch: (query: string) => void;
  setChipView: (v: 'map' | 'studio') => void;
}

export const useShell = create<ShellState>((set) => ({
  workspace: fromHash(),
  researchQuery: '',
  chipView: 'map',
  paletteOpen: false,
  setPalette: (open) => set({ paletteOpen: open }),
  go: (w) => {
    // the world keeps its own sub-path (#/world/<toy>)
    if (typeof location !== 'undefined' && location.hash !== `#/${w}` && !(w === 'world' && location.hash.startsWith('#/world'))) history.replaceState(null, '', `#/${w}`);
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
