/// <reference lib="webworker" />
// Runs the experiment models off the main thread, so the 3D scene never stalls while a simulation is recomputed.
import { runBenchmark } from './model/bench';
import { motorSession, visualSession } from './model/session';
import type { SimRequest, SimReply } from './simClient';

const buffersOf = (v: unknown, out: Set<ArrayBuffer>) => {
  if (!v || typeof v !== 'object') return;
  if (ArrayBuffer.isView(v)) { out.add(v.buffer as ArrayBuffer); return; }
  if (Array.isArray(v)) { for (const x of v) buffersOf(x, out); return; }
  for (const x of Object.values(v as Record<string, unknown>)) buffersOf(x, out);
};

self.onmessage = (e: MessageEvent<{ id: number; req: SimRequest }>) => {
  const { id, req } = e.data;
  try {
    let res: SimReply;
    if (req.kind === 'motor') res = motorSession(req.params, req.decoderId, req.calib);
    else if (req.kind === 'visual') res = visualSession(req.params, req.calib);
    else res = runBenchmark((done, total, what) => (self as unknown as Worker).postMessage({ id, progress: { done, total, what } }));
    // hand the big arrays of the fresh run over without copying (calibration caches are not part of the reply)
    const t = new Set<ArrayBuffer>();
    if (req.kind !== 'bench') buffersOf((res as { run: unknown }).run, t);
    (self as unknown as Worker).postMessage({ id, ok: true, res }, [...t]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
