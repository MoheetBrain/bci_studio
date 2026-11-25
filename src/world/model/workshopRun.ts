// A Time-workshop experiment as something that can be named, compared, saved and replayed:
// a recipe (which model, which numbers, which seed), the command log it stands for, and a fingerprint of the result.
// Pure module. Unit-tested in tests/world-lif.test.ts.
import { LIF_INTEGRATOR, LIF_RNG, LIF_UNITS, digestState, type LifCommand, type LifRun } from './lif.ts';
import { WORKSHOP_MS, firingWindow, runWorkshop, workshopCircuit, workshopCommands, type WorkshopSetup } from './circuits.ts';

export interface RunRecipe {
  runId: string;
  modelId: string;
  modelRevision: string;
  seed: number;
  rngVersion: string;
  integrator: string;
  dtMs: number;
  nSteps: number;
  parameters: WorkshopSetup;
  units: Record<string, string>;
  parentRunId: string | null;
}
export interface WorkshopExport { format: 'hbci.world.workshop-run'; version: 1; recipe: RunRecipe; commands: LifCommand[]; digest: string }

export interface WorkshopResult {
  recipe: RunRecipe;
  run: LifRun;
  digest: string;
  /** B − A, ms (null when either input is absent). */
  gapMs: number | null;
  /** When the target fired, ms (null = it did not). */
  firedMs: number | null;
  /** Highest membrane potential the target reached, mV, and the threshold it had to reach. */
  peakMv: number; thresholdMv: number;
  followerMs: number | null;
}

let counter = 0;
export function makeRun(setup: WorkshopSetup, parentRunId: string | null = null, runId?: string): WorkshopResult {
  const c = workshopCircuit(setup.variant), run = runWorkshop(setup, c), t = c.cells.findIndex((x) => x.id === 'T'), d = c.cells.findIndex((x) => x.id === 'D');
  let peak = -Infinity;
  for (const v of run.v[t]) if (v > peak) peak = v;
  const fired = run.spikes[t][0] ?? null;
  return {
    recipe: {
      runId: runId ?? `workshop-${setup.variant}-${(++counter).toString(36)}`, modelId: c.id, modelRevision: c.revision, seed: c.seed, rngVersion: LIF_RNG, integrator: LIF_INTEGRATOR, dtMs: c.dt,
      nSteps: run.nSteps, parameters: { ...setup, conn: { ...setup.conn }, extra: setup.extra.map((e) => ({ ...e })) }, units: { ...LIF_UNITS }, parentRunId,
    },
    run, digest: digestState(run.final),
    gapMs: setup.aMs != null && setup.bMs != null ? setup.bMs - setup.aMs : null,
    // when the target fired it was reset, so its highest value is the threshold it crossed
    firedMs: fired, peakMv: fired != null ? run.final.vth[t] : peak, thresholdMv: run.final.vth[t], followerMs: run.spikes[d][0] ?? null,
  };
}

export const exportRun = (r: WorkshopResult): WorkshopExport => ({ format: 'hbci.world.workshop-run', version: 1, recipe: r.recipe, commands: r.run.commands, digest: r.digest });

/** Rebuild a run from an export by running the model again; `matches` says whether it ended in the same state. */
export function importRun(x: WorkshopExport): { result: WorkshopResult; matches: boolean } {
  if (x?.format !== 'hbci.world.workshop-run' || x.version !== 1 || !x.recipe?.parameters) throw new Error('not a workshop-run export');
  const p = x.recipe.parameters, c = workshopCircuit(p.variant >>> 0);
  if (c.revision !== x.recipe.modelRevision) throw new Error(`model revision ${x.recipe.modelRevision} is not the one in this build (${c.revision})`);
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
  const setup: WorkshopSetup = {
    variant: p.variant >>> 0, aMs: num(p.aMs, 0, WORKSHOP_MS), bMs: num(p.bMs, 0, WORKSHOP_MS), glT: num(p.glT, 0.004, 0.08),
    conn: Object.fromEntries(Object.entries(p.conn ?? {}).filter(([k]) => c.conns.some((q) => q.id === k)).map(([k, v]) => [k, !!v])),
    extra: (Array.isArray(p.extra) ? p.extra : []).filter((e) => (e?.input === 'inA' || e?.input === 'inB') && Number.isFinite(e.ms)).slice(0, 16).map((e) => ({ input: e.input, ms: Math.max(0, Math.min(WORKSHOP_MS, e.ms)) })),
  };
  const result = makeRun(setup, x.recipe.runId);
  // the commands in the file must be the ones this recipe stands for
  const same = JSON.stringify(workshopCommands(c, setup).map((k) => [k.atStep, k.kind, k.target, k.value]).sort()) === JSON.stringify((x.commands ?? []).map((k) => [k.atStep, k.kind, k.target, k.value]).sort());
  return { result, matches: same && result.digest === x.digest };
}

/** The largest gap (B after A) at which the target still fires under a setup's connections and leak, to 0.25 ms. */
export const firingEdge = (setup: WorkshopSetup) => firingWindow(setup);
