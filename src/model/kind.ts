// What kind of thing a component is, derived from the registry and shown wherever a component is named.
// A logical RTL module is NOT automatically a physical part: on the die map its position is conceptual,
// and it is not separately packaged. Kinds:
//   logical  — LOGICAL CIRCUIT: real Verilog logic (its drawn position is a separate, conceptual matter)
//   physical — PHYSICAL PART TYPE, CONCEPT GEOMETRY: a kind of part a real chip has (die, pads, package),
//              drawn here, not engineered; nothing has been fabricated
//   software — SOFTWARE FUNCTION: runs on a computer outside the body
//   concept  — CONCEPT: an idea shown for context
// "ACTUAL PHYSICAL COMPONENT" (something that exists as hardware) applies to nothing in this project yet;
// "REAL PLACE/ROUTE DATA" applies only to the v0.2 layout views, which are not registry components.
import type { ComponentInfo } from './types';

export type Kind = 'logical' | 'physical' | 'software' | 'concept';

export function kindOf(c: ComponentInfo): Kind {
  if (c.physical === 'software / compute') return 'software';
  if (c.id.startsWith('rtl.')) return 'logical';
  // The chip package, die and pads are physical part types even though their geometry is illustrative.
  if (c.id.startsWith('pkg.') || c.id === 'sys.hbci01' || c.id === 'die.pads') return 'physical';
  return 'concept';
}

export const KIND_LABEL: Record<Kind, string> = {
  logical: 'LOGICAL CIRCUIT',
  physical: 'PHYSICAL PART TYPE · CONCEPT GEOMETRY',
  software: 'SOFTWARE FUNCTION',
  concept: 'CONCEPT',
};

/** Short form for tight places (tree rows). */
export const KIND_SHORT: Record<Kind, string> = { logical: 'L', physical: 'P', software: 'S', concept: 'C' };

export const KIND_HELP: Record<Kind, string> = {
  logical: 'Real Verilog logic (simulated and synthesised). Where it is drawn on the die map is conceptual (the map is not the floorplan; genuine layouts are on the Physical layout level), and a logic block is not a separately packaged part.',
  physical: 'A kind of physical part every chip has (die, pads, package). Here its geometry is drawn for clarity, not engineered, and nothing has been fabricated.',
  software: 'A function that runs on a computer outside the chip, not a piece of implanted hardware.',
  concept: 'An idea shown for context. Not engineered, built or tested.',
};
