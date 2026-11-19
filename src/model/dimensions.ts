// Size & scale facts with provenance. Every number here is either KNOWN (a cited measurement or
// specification), TARGET (a comparison target, not a changed requirement), ILLUSTRATIVE (scene geometry
// with no physical size) or UNKNOWN (no layout exists). Scene coordinates are never converted to millimetres.
import type { ArtifactState } from '../artifacts/load';
import type { ComponentInfo } from './types';
import { kindOf } from './kind';

export type Provenance = 'KNOWN' | 'TARGET' | 'ILLUSTRATIVE' | 'UNKNOWN';

export const PROVENANCE_HELP: Record<Provenance, string> = {
  KNOWN: 'A measured or specified size with a cited source.',
  TARGET: 'A comparison target used for scale literacy. Not a measured part and not a changed requirement.',
  ILLUSTRATIVE: 'Drawn in scene units for the 3D view. It has no millimetre size and must not be measured.',
  UNKNOWN: 'No layout or physical design exists yet, so the size is unknown.',
};

export interface SizeRecord {
  /** Component id or a reference id (ref.*). */
  id: string;
  label: string;
  provenance: Provenance;
  /** Millimetres; null when not established or not applicable. */
  width_mm: number | null;
  length_mm: number | null;
  thickness_mm: number | null;
  source: string;
  /** Why quantitative measurement is disabled (ILLUSTRATIVE / UNKNOWN). */
  why?: string;
  /** Extra honest context (e.g. standard-cell area that is not a die size). */
  note?: string;
  /** True when the record describes a reference object rather than the selected component. */
  reference?: boolean;
  /** Software functions have no physical size at all. */
  notPhysical?: boolean;
}

export const MICRO_SD: SizeRecord = {
  id: 'ref.microsd',
  label: 'microSD card (reference)',
  provenance: 'KNOWN',
  width_mm: 11.0,
  length_mm: 15.0,
  thickness_mm: 1.0,
  source: 'SD Association, SD Specifications Part 1 Physical Layer Simplified Specification, microSD form factor: 15.0 × 11.0 × 1.0 mm.',
  reference: true,
};

export const TARGET_20: SizeRecord = {
  id: 'ref.target20',
  label: '20 × 20 mm footprint target (comparison only)',
  provenance: 'TARGET',
  width_mm: 20,
  length_mm: 20,
  thickness_mm: null,
  source: 'Comparison target chosen for the studio\'s scale panel (UI refresh brief, 2026-10-21). A visual reference only; no thickness; not a changed requirement of the project.',
  reference: true,
};

/** The v0.2 event-core layout die from layout_summary.json (genuine LibreLane run), or null if absent. */
export function v02DieRecord(a: Pick<ArtifactState, 'layout'>): SizeRecord | null {
  const l = a.layout;
  if (!l) return null;
  return {
    id: 'ref.v02die',
    label: 'v0.2 event-core layout die (not the v0.3 readout chip)',
    provenance: 'KNOWN',
    width_mm: l.die.width_um / 1000,
    length_mm: l.die.height_um / 1000,
    thickness_mm: null,
    source: `layout/layout_summary.json: ${l.design} placed and routed by ${l.flow.name} on ${l.pdk.name} ${l.pdk.scl}; die ${l.die.width_um.toFixed(3)} × ${l.die.height_um.toFixed(3)} µm. Die thickness is not part of the layout result.`,
    note: 'This is the layout of hbci_event_core (v0.2) only. The v0.4 chip has no published layout and its die size is unknown.',
    reference: true,
  };
}

/** The v0.3 readout-core layout die from layout_v03/layout_summary.json (genuine LibreLane run; DSP only, not the v0.4 chip). */
export function v03DieRecord(a: Pick<ArtifactState, 'layoutV03'>): SizeRecord | null {
  const l = a.layoutV03;
  if (!l) return null;
  return {
    id: 'ref.v03die',
    label: 'v0.3 readout-core layout die (DSP only, not the v0.4 chip)',
    provenance: 'KNOWN',
    width_mm: l.die.width_um / 1000,
    length_mm: l.die.height_um / 1000,
    thickness_mm: null,
    source: `layout_v03/layout_summary.json: ${l.design} placed and routed by ${l.flow.name} on ${l.pdk.name} ${l.pdk.scl}; die ${l.die.width_um.toFixed(3)} × ${l.die.height_um.toFixed(3)} µm. Die thickness is not part of the layout result.`,
    note: 'This is the layout of hbci_readout_core (v0.3) only: no AI decoder, register file or BIST. The v0.4 chip has no published layout.',
    reference: true,
  };
}

/** The v0.4 chip-top layout die from layout_v04/layout_summary.json (genuine LibreLane run of hbci02_chip_top), or null if absent. */
export function v04DieRecord(a: Pick<ArtifactState, 'layoutV04'>): SizeRecord | null {
  const l = a.layoutV04;
  if (!l) return null;
  return {
    id: 'ref.v04die',
    label: 'v0.4 chip-top layout die (hbci02_chip_top)',
    provenance: 'KNOWN',
    width_mm: l.die.width_um / 1000,
    length_mm: l.die.height_um / 1000,
    thickness_mm: null,
    source: `layout_v04/layout_summary.json: ${l.design} placed and routed by ${l.flow.name} on ${l.pdk.name} ${l.pdk.scl}; die ${l.die.width_um.toFixed(3)} × ${l.die.height_um.toFixed(3)} µm. Die thickness is not part of the layout result.`,
    note: 'The die of the v0.4 chip top (DSP core + on-chip decoder + register file + BIST + serial wrappers). No padframe, package or fabrication; the 3D package and die are still drawn in scene units.',
    reference: true,
  };
}

/** The v0.4 chip logic (hbci02_digital_top): UNKNOWN size until its layout is published; cell area is not a die size. */
export function v03CoreRecord(a: Pick<ArtifactState, 'sky130V03' | 'sky130V04'>): SizeRecord {
  const s4 = a.sky130V04;
  const s = a.sky130V03;
  const src = s4
    ? `sky130_stats_v04.json: hbci02_digital_top, ${s4.cells.toLocaleString('en-GB')} ${s4.library} cells, cell area ${Math.round(s4.cell_area_um2).toLocaleString('en-GB')} µm² (${(s4.cell_area_um2 / 1e6).toFixed(3)} mm²)${s ? `; the v0.3 readout core alone: ${Math.round(s.cell_area_um2).toLocaleString('en-GB')} µm²` : ''}.`
    : s
      ? `sky130_stats_v03.json: ${s.cells.toLocaleString('en-GB')} ${s.library} cells, cell area ${Math.round(s.cell_area_um2).toLocaleString('en-GB')} µm² (${(s.cell_area_um2 / 1e6).toFixed(3)} mm²). No v0.4 mapping loaded.`
      : 'No SKY130 mapping artifact loaded (sky130_stats_v04.json / sky130_stats_v03.json).';
  return {
    id: 'ref.v04core',
    label: 'v0.4 chip logic (hbci02_digital_top: DSP core + AI decoder)',
    provenance: 'UNKNOWN',
    width_mm: null,
    length_mm: null,
    thickness_mm: null,
    source: src,
    why: 'This block has no die outline of its own; the whole v0.4 chip top does, on the Physical layout level, when its artifact is published.',
    note: s4 || s ? 'The quoted figure is standard-cell area only (sum of library cell footprints): no floorplan, routing, clock tree, I/O ring or utilisation margin. It is not a die size.' : undefined,
    reference: true,
  };
}

const ILLUSTRATIVE_WHY = 'This part is drawn in scene units for the 3D view. No physical design exists, so it has no millimetre size and the studio never converts scene coordinates to millimetres.';

/** Size record for the selected component. */
export function sizeRecordFor(c: ComponentInfo, a: Pick<ArtifactState, 'layout' | 'layoutV03' | 'layoutV04' | 'sky130V03' | 'sky130V04'>): SizeRecord {
  if (kindOf(c) === 'software') {
    return {
      id: c.id, label: c.name, provenance: 'UNKNOWN', width_mm: null, length_mm: null, thickness_mm: null,
      source: 'Software function that runs on a computer outside the body.',
      why: 'Not a physical object: it has no size.', notPhysical: true,
    };
  }
  if (c.id === 'rtl.core') {
    const d = v02DieRecord(a);
    if (d) return { ...d, id: c.id, label: `${c.name} · v0.2 layout die`, reference: false };
    return { id: c.id, label: c.name, provenance: 'UNKNOWN', width_mm: null, length_mm: null, thickness_mm: null, source: 'layout_summary.json not loaded.', why: 'The v0.2 layout artifact is missing, so no die size can be shown.' };
  }
  if (c.id === 'rtl.readout') {
    const d = v03DieRecord(a);
    if (d) return { ...d, id: c.id, label: `${c.name} · v0.3 layout die`, reference: false };
  }
  if (c.id === 'sys.hbci01' || c.id === 'pkg.die' || c.id === 'rtl.top04' || c.id === 'die.pads' || c.id === 'layout.floorplan') {
    const d4 = v04DieRecord(a);
    if (d4) {
      const what = c.id === 'sys.hbci01' ? 'The package drawn here is illustrative (scene units); the die inside has this layout size. ' : c.id === 'pkg.die' || c.id === 'die.pads' ? 'The die drawn here is illustrative (scene units); the genuine die has this size. ' : '';
      return { ...d4, id: c.id, label: `${c.name} · v0.4 chip-top layout die`, reference: false, note: `${what}${d4.note}` };
    }
  }
  if (c.id === 'sys.hbci01' || c.id === 'pkg.die' || c.id === 'rtl.readout' || c.id.startsWith('rtl.') || c.id === 'layout.floorplan' || c.id === 'die.pads') {
    const v3 = v03CoreRecord(a);
    const what = c.id === 'sys.hbci01' ? 'The package is illustrative (scene units). ' : c.id === 'pkg.die' ? 'The die drawn here is illustrative (scene units). ' : '';
    return {
      id: c.id, label: c.name, provenance: 'UNKNOWN', width_mm: null, length_mm: null, thickness_mm: null,
      source: v3.source,
      why: `${what}${v3.why}`,
      note: v3.note,
    };
  }
  // Package parts, bench parts and the cortical concept: scene geometry without physical size.
  const cortical = c.id.startsWith('cx.');
  return {
    id: c.id, label: c.name, provenance: 'ILLUSTRATIVE', width_mm: null, length_mm: null, thickness_mm: null,
    source: cortical ? 'Procedural concept geometry (three/CorticalScene.tsx). Layers are drawn with exaggerated thickness so they can be told apart.' : 'Procedural concept geometry (three/*Scene.tsx).',
    why: ILLUSTRATIVE_WHY,
    note: cortical ? 'The cortical concept has no physical dimensions at all; its layer thicknesses are exaggerated for visibility.' : undefined,
  };
}

/** Reference objects for the orthographic comparison, in the order they are drawn. */
export function referenceRecords(a: Pick<ArtifactState, 'layout' | 'layoutV03' | 'layoutV04' | 'sky130V03' | 'sky130V04'>): SizeRecord[] {
  const out: SizeRecord[] = [TARGET_20, MICRO_SD];
  const d = v02DieRecord(a);
  if (d) out.push(d);
  const d3 = v03DieRecord(a);
  if (d3) out.push(d3);
  const d4 = v04DieRecord(a);
  if (d4) out.push(d4);
  out.push(v03CoreRecord(a));
  return out;
}

export function fmtMm(v: number | null): string {
  if (v === null) return '—';
  if (v < 1) return `${v.toFixed(3)} mm`;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} mm`;
}
