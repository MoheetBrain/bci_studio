// One "session" = everything the Experiment scene shows for one set of parameters: the calibration the decoders were
// fitted on, how each decoder scores on a run it never saw, and the recorded run itself. Runs in a worker; pure.
import { DECODERS, LIVE_DECODERS, decoderSpec, runModel, score, type Cost, type Dataset, type Model, type Score } from './decoders.ts';
import { DEFAULT_MOTOR, RUN_S, TASK_SEED, clampMotor, simulateMotor, summariseClosed, toDataset, type ClosedSummary, type MotorParams, type MotorRun } from './motor.ts';
import { DEFAULT_VISUAL, VIS_RUN_S, VIS_TASK_SEED, clampVisual, fitVisual, simulateVisual, summariseVisual, type VisualModel, type VisualParams, type VisualRun, type VisualSummary } from './visual.ts';

export type ExpKind = 'motor' | 'visual';
export const FIT_SEED = 5;

export interface DecoderInfo {
  id: string; name: string; family: Model['family']; uses: Model['uses']; blurb: string;
  cost: Cost; uncertainty: string; view: Record<string, unknown>;
  /** Scored on a run it was not fitted to, recorded under the calibration's own conditions. */
  heldOut: Score;
  /** The same decoder scored on a held-out run recorded under the CURRENT conditions (no refitting). */
  heldOutNow: Score;
}

export interface MotorSession {
  kind: 'motor';
  run: MotorRun;
  summary: ClosedSummary;
  decoderId: string;
  decoders: DecoderInfo[];
  /** The recording conditions the decoders were fitted under. */
  calib: MotorParams;
  /** True when the run's conditions differ from the calibration's. */
  drifted: boolean;
  trainBins: number; heldOutBins: number;
  computeMs: number;
}
export interface VisualSession {
  kind: 'visual';
  run: VisualRun;
  summary: VisualSummary;
  model: VisualModel;
  calib: VisualParams;
  drifted: boolean;
  trainBins: number;
  computeMs: number;
}
export type Session = MotorSession | VisualSession;

/** The parameters that change what is recorded (the display channel does not). */
const recKey = (p: MotorParams | VisualParams) => JSON.stringify({ ...p, focusCh: 0 });
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

interface MotorCal { train: Dataset; models: Map<string, Model>; heldOut: Dataset; scores: Map<string, Score> }
const motorCals = new Map<string, MotorCal>();
export function motorCalibration(calib: MotorParams): MotorCal {
  const key = recKey(clampMotor(calib));
  let c = motorCals.get(key);
  if (!c) {
    const train = toDataset(simulateMotor(calib, { mode: 'calibration', taskSeed: TASK_SEED.calibration, durationS: RUN_S.calibration }));
    const heldOut = toDataset(simulateMotor(calib, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: RUN_S.heldOut }));
    c = { train, models: new Map(), heldOut, scores: new Map() };
    if (motorCals.size > 6) motorCals.clear();
    motorCals.set(key, c);
  }
  return c;
}
export function motorModel(calib: MotorParams, id: string): { model: Model; heldOut: Score } {
  const c = motorCalibration(calib);
  let m = c.models.get(id);
  if (!m) { m = decoderSpec(id).fit(c.train, FIT_SEED); c.models.set(id, m); c.scores.set(id, score(runModel(m, c.heldOut), c.heldOut)); }
  return { model: m, heldOut: c.scores.get(id)! };
}

export function motorSession(params: MotorParams, decoderId: string, calib: MotorParams = DEFAULT_MOTOR): MotorSession {
  const t0 = now();
  const p = clampMotor(params), cp = clampMotor(calib);
  const c = motorCalibration(cp);
  const drifted = recKey(p) !== recKey(cp);
  const heldNow = drifted ? toDataset(simulateMotor(p, { mode: 'calibration', taskSeed: TASK_SEED.heldOut, durationS: RUN_S.heldOut })) : c.heldOut;
  const decoders: DecoderInfo[] = LIVE_DECODERS.map((id) => {
    const spec = decoderSpec(id), { model, heldOut } = motorModel(cp, id);
    return { id, name: model.name, family: model.family, uses: model.uses, blurb: spec.blurb, cost: model.cost, uncertainty: model.uncertainty, view: model.view, heldOut, heldOutNow: drifted ? score(runModel(model, heldNow), heldNow) : heldOut };
  });
  const id = (LIVE_DECODERS as readonly string[]).includes(decoderId) ? decoderId : 'linear';
  const run = simulateMotor(p, { mode: 'closed', taskSeed: TASK_SEED.closed, durationS: RUN_S.closed, model: motorModel(cp, id).model }, true);
  const count = (d: Dataset) => d.valid.reduce((a, v) => a + v, 0);
  return { kind: 'motor', run, summary: summariseClosed(run), decoderId: id, decoders, calib: cp, drifted, trainBins: count(c.train), heldOutBins: count(c.heldOut), computeMs: now() - t0 };
}

const visualCals = new Map<string, { model: VisualModel; bins: number }>();
export function visualSession(params: VisualParams, calib: VisualParams = DEFAULT_VISUAL): VisualSession {
  const t0 = now();
  const p = clampVisual(params), cp = clampVisual(calib), key = recKey(cp);
  let c = visualCals.get(key);
  if (!c) {
    const cal = simulateVisual(cp, { mode: 'calibration', taskSeed: VIS_TASK_SEED.calibration, durationS: VIS_RUN_S.calibration });
    c = { model: fitVisual(cal), bins: cal.valid.reduce((a, v) => a + v, 0) };
    if (visualCals.size > 6) visualCals.clear();
    visualCals.set(key, c);
  }
  const run = simulateVisual(p, { mode: 'test', taskSeed: VIS_TASK_SEED.test, durationS: VIS_RUN_S.test, model: c.model }, true);
  return { kind: 'visual', run, summary: summariseVisual(run, c.model), model: c.model, calib: cp, drifted: recKey(p) !== key, trainBins: c.bins, computeMs: now() - t0 };
}

export { DECODERS };
