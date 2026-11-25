// A live, replayable run of the Instrument-flight field: the LIF circuit keeps stepping, the player issues commands,
// and the past can be visited again exactly.
//
//   · every scientific action is a timestamped command in a log (silence a cell, place a contact);
//   · a checkpoint of the model state is kept every 10 ms of model time;
//   · REWIND restores a checkpoint and replays the log, so the same spikes happen again at the same times;
//   · a command issued while replaying starts a NEW run (new id, the old one recorded as its parent) from that moment:
//     the log after it is dropped — a counterfactual, not an edit of history.
//
// Pure module: the renderer only reads from it. Unit-tested in tests/world-lif.test.ts.
import { advance, cloneState, createState, digestState, sortCommands, type LifCircuit, type LifCommand, type LifCommandKind, type LifState } from './lif.ts';
import { fieldCircuit, type FieldTruth } from './circuits.ts';
import { contactTrace, type Placement, type Vec3 } from './observe.ts';

export const FIELD_CHECKPOINT_STEPS = 200;
const KEEP_CHECKPOINTS = 80;
const KEEP_SPIKES_MS = 900;

export interface ContactCommand { seq: number; atStep: number; slot: 1 | 2; pos: Vec3 }
export interface FieldExport {
  format: 'hbci.world.field-run'; version: 1;
  runId: string; parentRunId: string | null;
  seed: number; modelRevision: string; dtMs: number;
  headStep: number; digest: string;
  commands: LifCommand[]; contacts: ContactCommand[];
}

let runCounter = 0;
const newRunId = (seed: number) => `field-${seed}-${(++runCounter).toString(36)}-${Date.now().toString(36)}`;

export class FieldRun {
  readonly circuit: LifCircuit;
  readonly truth: FieldTruth;
  readonly seed: number;
  runId: string;
  parentRunId: string | null = null;
  state: LifState;
  /** The furthest step this run has reached (the present); `state.step` is behind it while replaying. */
  head = 0;
  commands: LifCommand[] = [];
  contacts: ContactCommand[] = [];
  /** Spike times per cell, ms (recent history only). */
  spikes: number[][];
  private cursor = 0;
  private seq = 0;
  private checkpoints: Array<{ step: number; state: LifState }> = [];

  constructor(seed: number) {
    const f = fieldCircuit(seed);
    this.circuit = f.circuit; this.truth = f.truth; this.seed = f.circuit.seed;
    this.state = createState(this.circuit);
    this.spikes = this.circuit.cells.map(() => []);
    this.runId = newRunId(this.seed);
  }

  get step(): number { return this.state.step; }
  get timeMs(): number { return this.state.step * this.circuit.dt; }
  get replaying(): boolean { return this.state.step < this.head; }
  get oldestStep(): number { return this.checkpoints[0]?.step ?? 0; }

  /** Advance to a step (never backwards). Costs nothing when already there. */
  advanceTo(step: number): void {
    const c = this.circuit, s = this.state;
    while (s.step < step) {
      if (s.step % FIELD_CHECKPOINT_STEPS === 0 && !this.checkpoints.some((k) => k.step === s.step)) {
        this.checkpoints.push({ step: s.step, state: cloneState(s) });
        if (this.checkpoints.length > KEEP_CHECKPOINTS) this.checkpoints.shift();
      }
      const to = Math.min(step, (Math.floor(s.step / FIELD_CHECKPOINT_STEPS) + 1) * FIELD_CHECKPOINT_STEPS);
      this.cursor = advance(c, s, to, this.commands, this.cursor, { spike: (i, t) => this.spikes[i].push(t) });
    }
    if (s.step > this.head) this.head = s.step;
    const cut = this.timeMs - KEEP_SPIKES_MS;
    for (const sp of this.spikes) { let n = 0; while (n < sp.length && sp[n] < cut) n++; if (n > 64) sp.splice(0, n); }
  }

  /** If the run is replaying, make the present moment the head of a new run and drop what came after. */
  private branchIfReplaying(): void {
    if (!this.replaying) return;
    const k = this.state.step;
    this.commands = this.commands.filter((c) => c.atStep < k);
    this.contacts = this.contacts.filter((c) => c.atStep < k);
    this.checkpoints = this.checkpoints.filter((c) => c.step <= k);
    this.cursor = this.commands.length;
    this.head = k;
    this.parentRunId = this.runId; this.runId = newRunId(this.seed);
  }

  /** Issue a scientific command now. Returns it (with its step and sequence number). */
  issue(kind: LifCommandKind, target: string, value: number): LifCommand {
    this.branchIfReplaying();
    const cmd: LifCommand = { seq: this.seq++, atStep: this.state.step, kind, target, value };
    this.commands = sortCommands([...this.commands, cmd]);
    return cmd;
  }
  /** Put a contact at a position (scene µm) from now on. */
  place(slot: 1 | 2, pos: Vec3): ContactCommand {
    this.branchIfReplaying();
    const cmd: ContactCommand = { seq: this.seq++, atStep: this.state.step, slot, pos: [pos[0], pos[1], pos[2]] };
    this.contacts.push(cmd);
    return cmd;
  }
  placements(slot: 1 | 2): Placement[] { return this.contacts.filter((c) => c.slot === slot && c.atStep <= this.state.step); }
  /** Is a cell silenced at the present step of this run? */
  silenced(cell: number): boolean { return !this.state.cellOn[cell]; }

  /** Go back `ms` of model time (to the nearest checkpoint at or before it). The log is kept and will replay. */
  rewind(ms: number): number {
    const want = Math.max(this.oldestStep, this.state.step - Math.round(ms / this.circuit.dt));
    let cp = this.checkpoints[0];
    for (const k of this.checkpoints) if (k.step <= want) cp = k;
    if (!cp) return this.state.step;
    this.state = cloneState(cp.state);
    this.cursor = this.commands.filter((c) => c.atStep < cp.step).length;
    const t = cp.step * this.circuit.dt;
    for (const sp of this.spikes) { let n = sp.length; while (n > 0 && sp[n - 1] >= t) n--; sp.length = n; }
    return cp.step;
  }

  /** The synthetic recording of a contact over a stretch of model time ending at the present, µV. */
  trace(slot: 1 | 2, nSamples: number, opts: { noNoise?: boolean; only?: number } = {}): { fromStep: number; uv: Float32Array } {
    const fromStep = Math.max(0, this.state.step - nSamples);
    return { fromStep, uv: contactTrace({ cells: this.circuit.cells.map((c) => c.pos), spikes: this.spikes, placements: this.placements(slot), seed: this.seed, slot, fromStep, n: this.state.step - fromStep, dtMs: this.circuit.dt, ...opts }) };
  }

  digest(): string { return digestState(this.state); }

  export(): FieldExport {
    return {
      format: 'hbci.world.field-run', version: 1, runId: this.runId, parentRunId: this.parentRunId, seed: this.seed, modelRevision: this.circuit.revision,
      dtMs: this.circuit.dt, headStep: this.state.step, digest: this.digest(), commands: this.commands.filter((c) => c.atStep <= this.state.step), contacts: this.contacts.filter((c) => c.atStep <= this.state.step),
    };
  }

  /** Rebuild a run from an export by replaying its commands; `matches` says whether it ended in the same state. */
  static import(x: FieldExport): { run: FieldRun; matches: boolean } {
    if (x?.format !== 'hbci.world.field-run' || x.version !== 1) throw new Error('not a field-run export');
    const run = new FieldRun(x.seed);
    if (run.circuit.revision !== x.modelRevision) throw new Error(`model revision ${x.modelRevision} is not the one in this build (${run.circuit.revision})`);
    run.commands = sortCommands(x.commands); run.contacts = x.contacts.slice().sort((a, b) => a.atStep - b.atStep || a.seq - b.seq);
    run.seq = Math.max(0, ...x.commands.map((c) => c.seq + 1), ...x.contacts.map((c) => c.seq + 1));
    run.parentRunId = x.runId;
    run.advanceTo(x.headStep);
    return { run, matches: run.digest() === x.digest };
  }
}
