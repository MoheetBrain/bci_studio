// The Decoder pilot's session lives in a worker: fitting decoders and stepping the population never run on the thread
// that draws. Every request gets one reply; a calibration also sends progress and can be stopped between its steps
// (a stopped calibration leaves the session exactly as it was). If a worker cannot be started the same code runs on
// the main thread — identical numbers, just not off-thread.
import { PilotSession, type PilotCalibration, type PilotCondition, type PilotDecoderId, type PilotEvaluation, type PilotExport, type PilotFault, type PilotSnapshot } from './model/pilot';

export interface PilotInfo { runId: string; seed: number; bin: number; decoderId: PilotDecoderId; cond: PilotCondition; calibration: PilotCalibration | null; evaluation: PilotEvaluation | null; hits: number; misses: number }
export type PilotReq =
  | { op: 'new'; seed: number } | { op: 'step'; code: number } | { op: 'calibrate' } | { op: 'cancel' }
  | { op: 'fault'; fault: PilotFault } | { op: 'clear' } | { op: 'decoder'; id: PilotDecoderId } | { op: 'centre' } | { op: 'evaluate' }
  | { op: 'export' } | { op: 'import'; data: PilotExport };
export interface PilotReply { info?: PilotInfo; snap?: PilotSnapshot; data?: PilotExport; matches?: boolean; cancelled?: boolean }
export interface PilotProgress { done: number; total: number; what: string }

type Msg = { id: number; ok?: boolean; res?: PilotReply; error?: string; progress?: PilotProgress };

export type PilotHandler = (req: PilotReq, progress: (p: PilotProgress) => void) => Promise<PilotReply>;

/** The session's logic, shared by the worker and the main-thread fallback. */
export function makeHandler(): PilotHandler {
  let s = new PilotSession(7), busy = false, cancel = false;
  const info = (): PilotInfo => ({ runId: s.runId, seed: s.seed, bin: s.bin, decoderId: s.decoderId, cond: s.cond, calibration: s.calibration, evaluation: s.evaluation, hits: s.hits, misses: s.misses });
  const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
  return async (req, progress) => {
    if (req.op === 'cancel') { cancel = true; return {}; }
    if (busy) throw new Error('the session is calibrating');
    switch (req.op) {
      case 'new': s = new PilotSession(req.seed); return { info: info() };
      case 'step': return { snap: s.step(req.code) };
      case 'calibrate': {
        busy = true; cancel = false;
        try {
          const g = s.calibrateSteps();
          for (;;) {
            const r = g.next();
            if (r.done) return { info: info() };
            progress(r.value);
            await breathe();                      // lets a "cancel" message in between two steps
            if (cancel) return { info: info(), cancelled: true };
          }
        } finally { busy = false; }
      }
      case 'fault': s.fault(req.fault); return { info: info() };
      case 'clear': s.clearFaults(); return { info: info() };
      case 'decoder': s.setDecoder(req.id); return { info: info() };
      case 'centre': s.centre(); return { info: info() };
      case 'evaluate': s.evaluate(); return { info: info() };
      case 'export': return { data: s.export() };
      case 'import': { const r = PilotSession.import(req.data); s = r.session; return { info: info(), matches: r.matches }; }
    }
  };
}

export class PilotHost {
  private worker: Worker | null = null;
  private local: PilotHandler | null = null;
  private next = 1;
  private pending = new Map<number, { resolve: (r: PilotReply) => void; reject: (e: Error) => void; progress?: (p: PilotProgress) => void }>();
  readonly offThread: boolean;

  constructor() {
    try {
      this.worker = new Worker(new URL('./pilot.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Msg>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        if (e.data.progress) { p.progress?.(e.data.progress); return; }
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.res ?? {}); else p.reject(new Error(e.data.error ?? 'pilot session failed'));
      };
      this.worker.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'pilot worker failed')); this.pending.clear(); };
    } catch { this.worker = null; }
    this.offThread = !!this.worker;
  }

  call(req: PilotReq, progress?: (p: PilotProgress) => void): Promise<PilotReply> {
    const w = this.worker;
    if (w) return new Promise((resolve, reject) => { const id = this.next++; this.pending.set(id, { resolve, reject, progress }); w.postMessage({ id, req }); });
    this.local ??= makeHandler();
    return this.local(req, progress ?? (() => undefined));
  }
  dispose(): void { this.worker?.terminate(); this.worker = null; this.pending.clear(); }
}
