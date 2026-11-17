// Types of the Level 4 cell artifacts (scripts/extract_cells.py) and a switch-level reading of a
// transistor netlist: which devices are in series / in parallel between the output and a supply,
// computed from the SPICE connectivity (series-parallel reduction), never hard-coded.

export type Pt = [number, number];

export interface CellLayer {
  layer: number;
  datatype: number;
  name: string;
  purpose: string;
  lyp_name: string | null;
  polygons: Pt[][];
  from_paths?: { count: number; pathtypes: number[]; widths_um: number[]; note: string };
}

export interface CellLabel { text: string; layer: number; datatype: number; layer_name: string; x: number; y: number }

export interface SpiceDevice {
  name: string;
  type: 'n' | 'p' | '?';
  d: string; g: string; s: string; b: string;
  model: string;
  w_um: number | null;
  l_um: number | null;
  params: Record<string, string>;
}

export interface SpiceBlock {
  file: string;
  read_from?: string;
  sha256: string;
  subckt_header: string;
  subckt_text: string[];
  pins: string[];
  internal_nets: string[];
  devices: SpiceDevice[];
  terminal_order: string;
  unit_rule: string;
}

export interface GateRegion {
  x0: number; y0: number; x1: number; y1: number;
  l_um: number; w_um: number; orientation: string;
  in_nwell: boolean; under_hvtp: boolean; implant: string | null; type: 'n' | 'p';
}

export interface GateCompare {
  n: { geometry: { count: number; sizes_um: number[][] }; spice: { count: number; sizes_um: number[][] }; match: boolean };
  p: { geometry: { count: number; sizes_um: number[][] }; spice: { count: number; sizes_um: number[][] }; match: boolean };
  all_match: boolean;
}

export interface LayerNamesSource { file: string; read_from: string; sha256: string; format: string }

export interface CellDoc {
  cell: string;
  short_name: string;
  description: string;
  evidence: string;
  source: {
    gds: string; gds_gz_sha256: string; gds_stream_sha256: string; structure: string; top_structure: string;
    pdk: string; open_pdks_rev: string; scl: string; licence: string; extracted_by: string; extracted_at: string; note: string;
  };
  instances_in_v02_design: {
    count: number; top_structure: string; all_cell_instances_in_top: number;
    fill_decap_tap_instances_in_top?: number; method: string;
  };
  units: string;
  gds_units: { user_units_per_dbu: number; metres_per_dbu: number; um_per_dbu: number; coordinates_exact_to_3_decimals: boolean; rounding: string };
  bbox_um: [number, number, number, number];
  bbox_source: string;
  size_um: { width: number; height: number };
  extent_um: [number, number, number, number];
  layers: CellLayer[];
  labels: CellLabel[];
  spice: SpiceBlock | 'unavailable';
  spice_unavailable_reason?: string;
  layer_names_source: LayerNamesSource | string;
  gate_regions_derived: { status: string; method?: string; regions?: GateRegion[]; reason?: string } | null;
  gate_vs_spice: GateCompare | null;
  notes?: string[];
}

export interface CellIndexEntry {
  cell: string; short_name: string; description: string; file: string;
  instances_in_v02_design: number; size_um: { width: number; height: number };
  layers: number; labels: number; spice_devices: number | null; gate_check: boolean | null;
}

export interface CellIndex {
  evidence: string;
  generated_at: string;
  gds: string;
  open_pdks_rev: string;
  cells: CellIndexEntry[];
  command: string;
}

// ───────────────────────── series / parallel expressions ─────────────────────────

/** A two-terminal switch network. `ser.nodes[i]` is the net between items[i] and items[i+1]. */
export type Expr =
  | { k: 'dev'; type: 'n' | 'p'; gate: string; names: string[] }
  | { k: 'par'; items: Expr[] }
  | { k: 'ser'; items: Expr[]; nodes: string[] };

interface Edge { a: string; b: string; e: Expr }

export function reverseExpr(e: Expr): Expr {
  if (e.k === 'dev') return e;
  if (e.k === 'par') return { k: 'par', items: e.items.map(reverseExpr) };
  return { k: 'ser', items: [...e.items].reverse().map(reverseExpr), nodes: [...e.nodes].reverse() };
}

/** Parallel devices with the same gate and type are fingers of one wider switch. */
function mergeParallel(items: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const it of items) if (it.k === 'par') flat.push(...it.items); else flat.push(it);
  const out: Expr[] = [];
  for (const it of flat) {
    const same = it.k === 'dev' ? out.find((o) => o.k === 'dev' && o.gate === it.gate && o.type === it.type) : undefined;
    if (same && same.k === 'dev' && it.k === 'dev') same.names = [...same.names, ...it.names];
    else out.push(it.k === 'dev' ? { ...it, names: [...it.names] } : it);
  }
  return out.length === 1 ? out[0] : { k: 'par', items: out };
}

function mergeSeries(e1: Expr, node: string, e2: Expr): Expr {
  const items: Expr[] = [];
  const nodes: string[] = [];
  const push = (e: Expr) => {
    if (e.k === 'ser') { if (items.length) nodes.push(node); items.push(...e.items); nodes.push(...e.nodes); }
    else { if (items.length) nodes.push(node); items.push(e); }
  };
  push(e1);
  push(e2);
  return { k: 'ser', items, nodes };
}

/** Reduces a switch network between terminals `from` and `to`. Null if it is not series-parallel. */
export function reduceNetwork(devs: SpiceDevice[], from: string, to: string, keep: Set<string>): Expr | null {
  let edges: Edge[] = devs.map((d) => ({ a: d.d, b: d.s, e: { k: 'dev', type: d.type === 'p' ? 'p' : 'n', gate: d.g, names: [d.name] } }));
  if (edges.length === 0) return null;
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    // parallel: same unordered pair of nets
    const groups = new Map<string, Edge[]>();
    for (const ed of edges) {
      const key = [ed.a, ed.b].sort().join('\u0000');
      groups.set(key, [...(groups.get(key) ?? []), ed]);
    }
    const next: Edge[] = [];
    for (const g of groups.values()) {
      if (g.length === 1) { next.push(g[0]); continue; }
      const { a, b } = g[0];
      next.push({ a, b, e: mergeParallel(g.map((x) => (x.a === a ? x.e : reverseExpr(x.e)))) });
      changed = true;
    }
    edges = next;
    // series: an internal net (not a terminal or pin) touched by exactly two channels
    const deg = new Map<string, number>();
    for (const ed of edges) for (const n of [ed.a, ed.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
    const node = [...deg.entries()].find(([n, c]) => c === 2 && !keep.has(n))?.[0];
    if (node !== undefined) {
      const [e1, e2] = edges.filter((ed) => ed.a === node || ed.b === node);
      const left = e1.b === node ? e1 : { a: e1.b, b: e1.a, e: reverseExpr(e1.e) };
      const right = e2.a === node ? e2 : { a: e2.b, b: e2.a, e: reverseExpr(e2.e) };
      edges = [...edges.filter((ed) => ed !== e1 && ed !== e2), { a: left.a, b: right.b, e: mergeSeries(left.e, node, right.e) }];
      changed = true;
    }
    if (!changed) break;
  }
  if (edges.length !== 1) return null;
  const ed = edges[0];
  if (ed.a === from && ed.b === to) return ed.e;
  if (ed.a === to && ed.b === from) return reverseExpr(ed.e);
  return null;
}

/** Ideal-switch conduction: NMOS closes on 1, PMOS closes on 0. */
export function conducts(e: Expr, v: Record<string, 0 | 1>): boolean {
  if (e.k === 'dev') return e.type === 'n' ? v[e.gate] === 1 : v[e.gate] === 0;
  if (e.k === 'ser') return e.items.every((x) => conducts(x, v));
  return e.items.some((x) => conducts(x, v));
}

export function devName(e: Expr & { k: 'dev' }) {
  return `${e.type === 'p' ? 'PMOS' : 'NMOS'} ${e.gate}`;
}

/** Plain-English description of a network, e.g. "NMOS A (2 fingers: X0, X1) in series with NMOS B …". */
export function describe(e: Expr, withNames = true): string {
  if (e.k === 'dev') {
    const f = e.names.length > 1 ? ` (${e.names.length} fingers${withNames ? ': ' + e.names.join(', ') : ''})` : withNames ? ` (${e.names[0]})` : '';
    return devName(e) + f;
  }
  if (e.k === 'ser') return e.items.map((x) => describe(x, withNames)).join(' in series with ');
  return e.items.map((x) => describe(x, withNames)).join(' in parallel with ');
}

export interface Derived {
  ok: boolean;
  reason?: string;
  power: string;
  ground: string;
  output: string;
  inputs: string[];
  bulks: { type: 'n' | 'p'; net: string }[];
  pu: Expr | null;
  pd: Expr | null;
  truth: { v: Record<string, 0 | 1>; y: '0' | '1' | 'X' | 'Z' }[];
  func: string | null;
}

/** Reads a single-stage static CMOS cell from its SPICE subcircuit. */
export function deriveCell(sp: SpiceBlock): Derived {
  const pins = sp.pins;
  const power = pins.find((p) => /^(VPWR|VDD)$/i.test(p)) ?? '';
  const ground = pins.find((p) => /^(VGND|VSS)$/i.test(p)) ?? '';
  const chan = new Set(sp.devices.flatMap((d) => [d.d, d.s]));
  const gates = new Set(sp.devices.map((d) => d.g));
  const inputs = pins.filter((p) => gates.has(p) && !chan.has(p));
  const outs = pins.filter((p) => chan.has(p) && p !== power && p !== ground);
  const bulks: Derived['bulks'] = [];
  for (const d of sp.devices) if ((d.type === 'n' || d.type === 'p') && !bulks.some((b) => b.type === d.type && b.net === d.b)) bulks.push({ type: d.type, net: d.b });
  const base: Derived = { ok: false, power, ground, output: outs[0] ?? '', inputs, bulks, pu: null, pd: null, truth: [], func: null };
  if (!power || !ground) return { ...base, reason: 'no VPWR/VGND supply pins in the subcircuit header' };
  if (outs.length !== 1) return { ...base, reason: `expected one output pin, found ${outs.length}` };
  const internalGate = [...gates].find((g) => !pins.includes(g));
  if (internalGate) return { ...base, reason: `multi-stage cell (internal gate net ${internalGate}); not drawn` };
  const out = outs[0];
  const keep = new Set([...pins]);
  const pu = reduceNetwork(sp.devices.filter((d) => d.type === 'p'), power, out, keep);
  const pd = reduceNetwork(sp.devices.filter((d) => d.type === 'n'), out, ground, keep);
  if (!pu || !pd) return { ...base, reason: 'the transistor network is not series-parallel' };
  const truth: Derived['truth'] = [];
  for (let m = 0; m < 1 << inputs.length; m++) {
    const v: Record<string, 0 | 1> = {};
    inputs.forEach((p, i) => { v[p] = ((m >> (inputs.length - 1 - i)) & 1) as 0 | 1; });
    const up = conducts(pu, v);
    const dn = conducts(pd, v);
    truth.push({ v, y: up && !dn ? '1' : dn && !up ? '0' : up && dn ? 'X' : 'Z' });
  }
  return { ...base, ok: true, output: out, pu, pd, truth, func: nameFunction(inputs, truth, out) };
}

function nameFunction(inputs: string[], truth: Derived['truth'], out: string): string | null {
  const ys = truth.map((t) => t.y);
  const n = inputs.length;
  if (n === 1 && ys.join('') === '10') return `${out} = NOT ${inputs[0]}: an inverter`;
  if (n >= 2 && ys.slice(0, -1).every((y) => y === '1') && ys[ys.length - 1] === '0') return `${out} = NOT (${inputs.join(' AND ')}): a NAND`;
  if (n >= 2 && ys[0] === '1' && ys.slice(1).every((y) => y === '0')) return `${out} = NOT (${inputs.join(' OR ')}): a NOR`;
  return null;
}
