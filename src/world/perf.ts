// A small recorder for frame times and input response, so that performance is measured on the machine that plays
// rather than assumed. "Response" here is the time from an input event to the start of the next rendered frame —
// it leaves out the display's own scan-out and so is NOT a hardware input-to-photon latency.
const N = 24000;
const frames = new Float32Array(N), responses = new Float32Array(4000);
let nFrames = 0, nResp = 0, last = 0, started = 0, recording = false;
const pending: number[] = [];
const work = new Float32Array(N);
let nWork = 0, workT0 = 0;

export const perf = {
  start(): void { nFrames = 0; nResp = 0; nWork = 0; last = 0; pending.length = 0; started = performance.now(); recording = true; },
  /** Around everything the page does for one frame (all canvases): main-thread time, NOT the GPU's. */
  begin(): void { workT0 = performance.now(); },
  end(): void { if (recording && workT0 && nWork < N) work[nWork++] = performance.now() - workT0; },
  stop(): void { recording = false; },
  get recording(): boolean { return recording; },
  /** Call at the start of every rendered frame. */
  frame(now: number): void {
    if (!recording) { last = now; return; }
    if (last && nFrames < N) frames[nFrames++] = now - last;
    last = now;
    while (pending.length) { const t = pending.pop()!; if (nResp < responses.length && now >= t) responses[nResp++] = now - t; }
  },
  /** Call with the timestamp of an input event. */
  input(t: number): void { if (recording && pending.length < 8) pending.push(t); },
  report(): Record<string, unknown> {
    const q = (a: Float32Array, n: number, p: number) => { if (!n) return null; const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y); return +s[Math.min(n - 1, Math.floor(p * n))].toFixed(2); };
    const f = frames.subarray(0, nFrames);
    let over100 = 0, worst = 0; for (const v of f) { if (v > 100) over100++; if (v > worst) worst = v; }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      seconds: +((performance.now() - started) / 1000).toFixed(1), frames: nFrames,
      frameMs: { median: q(frames, nFrames, 0.5), p95: q(frames, nFrames, 0.95), p99: q(frames, nFrames, 0.99), worst: +worst.toFixed(1), over100ms: over100 },
      responseMs: { n: nResp, median: q(responses, nResp, 0.5), p95: q(responses, nResp, 0.95) },
      workMs: { n: nWork, median: q(work, nWork, 0.5), p95: q(work, nWork, 0.95), p99: q(work, nWork, 0.99) },
      jsHeapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      visible: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    };
  },
};
