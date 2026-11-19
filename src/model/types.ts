// Shared types for the HBCI studio. Owned by the main agent; treat as a contract.

/** Engineering evidence that supports a view or a component. */
export type Evidence = 'CONCEPT' | 'DEMO' | 'SCRIPTED' | 'RTL' | 'SYNTH' | 'LAYOUT' | 'MEASURED';

/** v0.3 processing modes of hbci_readout_core (cfg_mode). */
export type ProcMode = 'EVENT' | 'RAW' | 'FEATURE' | 'HYBRID';

/** System presets shown on the System level. */
export type Preset = 'bench' | 'cortical';

/** Semantic zoom levels, in drill-down order (top navigation). */
export type Level = 'system' | 'package' | 'die' | 'circuit' | 'module' | 'gates' | 'cell' | 'layout';

export const LEVELS: { id: Level; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'package', label: 'Package' },
  { id: 'die', label: 'Die' },
  { id: 'circuit', label: 'Circuit' },
  { id: 'module', label: 'Module' },
  { id: 'gates', label: 'Gates' },
  { id: 'cell', label: 'Cell & transistor' },
  { id: 'layout', label: 'Physical Layout' },
];

/** Implementation status shown in the inspector, from least to most real. */
export type ImplStatus =
  | 'conceptual'
  | 'simulated'
  | 'synthesised'
  | 'physically designed'
  | 'manufactured'
  | 'tested';

export type PhysicalKind =
  | 'digital logic'
  | 'analog circuit'
  | 'mixed-signal circuit'
  | 'sensor'
  | 'conductor'
  | 'mechanical structure'
  | 'software / compute'
  | 'power electronics';

export interface ComponentInfo {
  id: string;
  name: string;
  parent: string | null;
  /** Level whose viewport shows this component. */
  level: Level;
  evidence: Evidence;
  status: ImplStatus;
  physical: PhysicalKind;
  purpose: string;
  input: string;
  transformation: string;
  output: string;
  constraints: string[];
  /** Code or artifact paths that back this view; empty for concepts. */
  source: string[];
  beginner: string;
  technical: string;
  /** Double-click target: the level to enter when inspecting deeper. */
  enter?: Level;
  /** For RTL blocks: Verilog module name and instance name. */
  rtlModule?: string;
  rtlInstance?: string;
  /** For RTL blocks: the source lines of `rtlModule`'s file that implement this block (shown by the inspector). */
  rtlLines?: [number, number];
  /** Ids of components that sit on the signal path immediately after this one. */
  feeds?: string[];
  /** Which System-level preset shows it (default: bench). */
  preset?: Preset;
  /** Lesson: what changes if this component is removed. */
  remove?: string;
  /** For RTL blocks: the processing modes whose data path uses this block. */
  modes?: ProcMode[];
}
