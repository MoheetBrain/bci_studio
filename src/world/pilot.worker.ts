/// <reference lib="webworker" />
// Hosts the Decoder pilot's session off the main thread (see pilotHost.ts).
import { makeHandler, type PilotReq } from './pilotHost';

const handle = makeHandler();
self.onmessage = async (e: MessageEvent<{ id: number; req: PilotReq }>) => {
  const { id, req } = e.data, post = (m: unknown) => (self as unknown as Worker).postMessage(m);
  try { post({ id, ok: true, res: await handle(req, (progress) => post({ id, progress })) }); }
  catch (err) { post({ id, ok: false, error: err instanceof Error ? err.message : String(err) }); }
};
