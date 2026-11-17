// The chip hierarchy extracted from the RTL snapshot by tools/chip/extract-hierarchy.mjs
// (public/artifacts/chip_hierarchy.json). Loaded once; a failed load is reported, never papered over.
import { useEffect, useState } from 'react';

export interface ChipPort { dir: 'input' | 'output' | 'inout'; signed: boolean; range: string | null; name: string }
export interface ChipModule {
  name: string; file: string; lineStart: number; lineEnd: number; doc: string;
  ports: ChipPort[]; params: Array<{ name: string; default: string }>;
  instances: Array<{ name: string; module: string; file: string; line: number; parameters: string | null }>;
  inChipTop: boolean;
  suites: string[];
}
export interface ChipInstance { path: string; name: string; module: string; parentModule: string; depth: number; file: string; line: number; parameters: string | null }
export interface ChipSuite {
  name: string; status: string; checks: number | null; errors: number | null; tests: number; kind: string;
  testbench: string | null; method: string | null; linkBasis: string; duts: string[]; covers: string[];
}
export interface ChipHierarchy {
  generatedBy: string;
  source: { repository: string; commit: string; commitDate: string; rtlSha256: string; files: string[] };
  verification: { simulator: string; ranAt: string; lint: { tool: string; warnings: number; errors: number }; suites: number; passing: number };
  top: string;
  modules: ChipModule[];
  instances: ChipInstance[];
  suites: ChipSuite[];
}

let cache: Promise<ChipHierarchy> | null = null;
export function loadHierarchy(): Promise<ChipHierarchy> {
  cache ??= fetch(`${import.meta.env.BASE_URL}artifacts/chip_hierarchy.json`).then((r) => {
    if (!r.ok) throw new Error(`chip_hierarchy.json: HTTP ${r.status}`);
    return r.json() as Promise<ChipHierarchy>;
  }).catch((e) => { cache = null; throw e; });
  return cache;
}

export function useHierarchy(): { data: ChipHierarchy | null; error: string | null } {
  const [data, setData] = useState<ChipHierarchy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadHierarchy().then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);
  return { data, error };
}

/** `rtl/hbci_event_core.v:85` */
export const srcRef = (file: string, line: number) => `${file}:${line}`;
