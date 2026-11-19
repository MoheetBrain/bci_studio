// Talks to the simulation worker. One request at a time per kind matters to the caller, not here: every request gets
// its own reply, and the store ignores replies that are no longer wanted. Falls back to the main thread if a worker
// cannot be started (the result is identical, only slower to appear).
import type { BenchResult } from './model/bench';
import type { MotorParams } from './model/motor';
import type { MotorSession, VisualSession } from './model/session';
import type { VisualParams } from './model/visual';

export type SimRequest =
  | { kind: 'motor'; params: MotorParams; decoderId: string; calib: MotorParams }
  | { kind: 'visual'; params: VisualParams; calib: VisualParams }
  | { kind: 'bench' };
export type SimReply = MotorSession | VisualSession | BenchResult;
export interface Progress { done: number; total: number; what: string }

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: SimReply) => void; reject: (e: Error) => void; onProgress?: (p: Progress) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; res?: SimReply; error?: string; progress?: Progress }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.progress) { p.onProgress?.(e.data.progress); return; }
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.res!); else p.reject(new Error(e.data.error ?? 'simulation failed'));
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'simulation worker failed')); pending.clear(); worker = null; };
  } catch {
    worker = null;
  }
  return worker;
}

export function simulate<T extends SimReply>(req: SimRequest, onProgress?: (p: Progress) => void): Promise<T> {
  const w = getWorker();
  if (w) {
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: SimReply) => void, reject, onProgress });
      w.postMessage({ id, req });
    });
  }
  return (async () => {
    const [{ motorSession, visualSession }, { runBenchmark }] = await Promise.all([import('./model/session'), import('./model/bench')]);
    if (req.kind === 'motor') return motorSession(req.params, req.decoderId, req.calib) as T;
    if (req.kind === 'visual') return visualSession(req.params, req.calib) as T;
    return runBenchmark((done, total, what) => onProgress?.({ done, total, what })) as T;
  })();
}
