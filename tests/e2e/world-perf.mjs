// Interactive performance of the integrated world, measured in a VISIBLE Chrome window on this machine's GPU against
// the production build. Writes docs/evidence/world/performance.txt. One machine, one run: measurements, not
// guarantees, and not a statement about any other computer.
//
//   npm run build && node tests/e2e/world-perf.mjs          (SECONDS=30 per segment by default → about 5 minutes)
//
// A Chrome window (temporary profile) opens and must stay in front: a hidden window is throttled by the browser and
// its frame times mean nothing, so the script records how long the page was visible and says so.
//
// What is measured, and how:
//   frame interval   the time between successive animation frames of the page, sampled by the page's own
//                    requestAnimationFrame, while a scripted player uses each part of the journey with real input events.
//                    A display that refreshes at 120 Hz cannot show an interval shorter than 8.3 ms: a median at that
//                    value says the page kept up with THIS display, not how much faster it could have gone;
//   main-thread work how long the page's own code and draw-call submission take per frame (all canvases). This is the
//                    part of the frame budget that can be measured from inside the page. GPU time cannot be;
//   response         from an input event's timestamp to the start of the next rendered frame of the tissue view. NOT a
//                    hardware input-to-photon latency;
//   long frames      intervals over 33.3 ms (a missed frame at 30 Hz) and over 100 ms (a visible stall);
//   loading          to "brain on screen", cold (new browser profile) and warm (reload); and from the click on "Enter"
//                    to the tissue being flyable;
//   memory           JS heap before and after repeated trips in and out (no forced garbage collection: an upper bound);
//   pointer capture  whether the browser really grants and releases pointer lock (the headless suite cannot ask it).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5193, BASE = `http://127.0.0.1:${PORT}`, SECS = Math.max(8, +(process.env.SECONDS ?? 30));
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1920,1200', '--window-position=40,30'] });
let ctx, page;
const T = (id) => `[data-testid="${id}"]`, wait = (ms) => page.waitForTimeout(ms);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const drag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 14 }); await page.mouse.up(); };
const brainReady = () => page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 });
const inCortex = async () => { await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 }); await page.waitForFunction(() => window.__world.rt.frames > 8 && !window.__world.controller.transitioning, null, { timeout: 20000 }); };
const world = () => page.evaluate(() => document.querySelector('[data-world-view]').focus());
const describe = () => page.evaluate(() => { const c = document.createElement('canvas'), gl = c.getContext('webgl2'), dbg = gl?.getExtension('WEBGL_debug_renderer_info'), cv = document.querySelector('[data-testid="world-view"] canvas') ?? document.querySelector('[data-testid="brain-stage"] canvas'); return { ua: navigator.userAgent, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, css: `${innerWidth} × ${innerHeight}`, canvas: cv ? `${cv.width} × ${cv.height}` : '?', visible: document.visibilityState }; });

/** Sample the page's own frame intervals (and the world's work and response recorders) around `body`. */
async function measure(body) {
  await page.evaluate(() => {
    window.__fi = []; window.__vis = { ok: 0, n: 0 }; let last = 0;
    const tick = (t) => { if (last) window.__fi.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); };
    window.__raf = requestAnimationFrame(tick);
    window.__visTimer = setInterval(() => { window.__vis.n++; if (document.visibilityState === 'visible') window.__vis.ok++; }, 250);
    window.__world?.perf.start();
  });
  const t0 = Date.now();
  await body();
  return page.evaluate((secs) => {
    cancelAnimationFrame(window.__raf); clearInterval(window.__visTimer); window.__world?.perf.stop();
    const a = window.__fi.slice().sort((x, y) => x - y), q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : null);
    const p = window.__world?.perf.report() ?? {};
    return { seconds: secs, frames: a.length, median: q(0.5), p95: q(0.95), p99: q(0.99), worst: a.length ? +a[a.length - 1].toFixed(1) : null, over33: a.filter((v) => v > 33.4).length, over100: a.filter((v) => v > 100).length, over17: a.filter((v) => v > 17.5).length,
      visibleShare: window.__vis.ok / Math.max(1, window.__vis.n), work: p.workMs, response: p.responseMs, pick: p.pickMs, things: window.__world?.controller.bodies?.length ?? 0, heap: p.jsHeapMB, quality: window.__world?.store.getState().quality };
  }, +((Date.now() - t0) / 1000).toFixed(1));
}
const steer = async (ms) => {
  const end = Date.now() + ms; let held = new Set();
  while (Date.now() < end) {
    const s = await page.evaluate(() => { const c = window.__task.task.cur; return c ? { c: c.cursor, t: c.target } : null; }), want = new Set();
    if (s) { const dx = s.t[0] - s.c[0], dy = s.t[1] - s.c[1], d = Math.hypot(dx, dy); if (d > 0.1) { if (Math.abs(dx) > 0.38 * d) want.add(dx > 0 ? 'KeyD' : 'KeyA'); if (Math.abs(dy) > 0.38 * d) want.add(dy > 0 ? 'KeyW' : 'KeyS'); } }
    for (const k of held) if (!want.has(k)) await page.keyboard.up(k);
    for (const k of want) if (!held.has(k)) await page.keyboard.down(k);
    held = want; await wait(50);
  }
  for (const k of held) await page.keyboard.up(k);
};

async function profile(dpr, seconds, first) {
  ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', String(e).slice(0, 300)));
  const out = { dpr };
  const t0 = Date.now();
  await page.goto(`${BASE}/#/world`); await brainReady();
  out.coldMs = Date.now() - t0;
  const t1 = Date.now();
  await page.reload(); await brainReady();
  out.warmMs = Date.now() - t1;
  await page.bringToFront(); await wait(900);
  out.envBrain = await describe();
  if (out.envBrain.visible !== 'visible') { console.error('The window is not visible; frame times would be meaningless. Nothing was written.'); await browser.close(); process.exit(3); }
  // 1 · the whole brain: turning it, hovering over it
  out.brain = await measure(async () => {
    const end = Date.now() + seconds * 1000; let k = 0;
    while (Date.now() < end) { const y = 380 + (k % 3) * 60; await drag(820, y, 820 + (k % 2 ? -260 : 260), y + (k % 3 ? 40 : -40)); await page.mouse.move(700 + (k % 5) * 90, 420 + (k % 4) * 50, { steps: 8 }); await wait(250); k++; }
  });
  await page.evaluate(() => window.__brain.api.home()); await wait(900);
  // 2 · going in (dive, cross-fade, arrival glide)
  const t2 = Date.now();
  out.enter = await measure(async () => { await page.click(T('enter'), { timeout: 8000 }).catch(async (e) => { console.error('state at failure:', await page.evaluate(() => ({ place: document.querySelector('[data-testid="journey"]')?.dataset.place, hash: location.hash, cta: !!document.querySelector('[data-testid="cta"]'), card: document.querySelector('[data-testid="region-card"]')?.dataset.region }))); throw e; }); await inCortex(); await wait(400); });
  out.enterMs = Date.now() - t2 - 400;
  out.envCortex = await describe();
  // 2b · the first minute: fly the craft beside the reconstructed neuron, point along its branches (the pointer is
  //      over the scene, so "what is aimed at" is worked out throughout), look around, change between third and first person
  await world();
  out.approach = await measure(async () => {
    const end = Date.now() + seconds * 1000, keys = ['KeyW', 'KeyA', 'KeyW', 'KeyD', 'KeyE', 'KeyQ', 'KeyS']; let k = 0;
    while (Date.now() < end) {
      await hold(keys[k % keys.length], 420);
      await page.mouse.move(520 + (k % 7) * 140, 280 + (k % 5) * 100, { steps: 12 });
      if (k % 4 === 1) { const y = 300 + (k % 5) * 40; await drag(1000, y, 1000 + (k % 8 < 4 ? 130 : -130), y + 20); }
      if (k % 9 === 5) { await page.keyboard.press('KeyV'); await wait(500); await page.mouse.move(700 + (k % 3) * 200, 420, { steps: 10 }); await page.keyboard.press('KeyV'); }
      k++;
    }
  });
  // 2c · a close approach: the craft a few micrometres from the reconstructed neuron's body, its 12,687-node arbor all round
  await page.evaluate(() => { const c = window.__world.controller; if (c.viewKind !== 'third') c.setView('third'); c.home([58, 14, 372], [38, 10, 328]); }); await wait(500);
  out.close = await measure(async () => {
    const end = Date.now() + Math.max(6, seconds * 0.6) * 1000; let k = 0;
    while (Date.now() < end) {
      await page.mouse.move(600 + (k % 6) * 150, 300 + (k % 4) * 130, { steps: 14 });
      const y = 320 + (k % 4) * 50; await drag(960, y, 960 + (k % 2 ? 180 : -180), y + (k % 3 ? 30 : -30));
      await hold(k % 2 ? 'KeyA' : 'KeyD', 260);
      if (k % 5 === 3) { await page.keyboard.press('KeyV'); await wait(450); await page.keyboard.press('KeyV'); }
      k++;
    }
  });
  await page.selectOption(T('goto'), 'circuit'); await wait(1700);
  // 3 · the circuit: flying, looking, replaying, changing causes, moving a recording contact, with the linked trace open
  await page.click(T('level-understand')); await world();
  await page.evaluate(() => { const s = window.__lab.store.getState(); s.place('P1', [44, 2, 14]); s.place('P2', [-140, 30, 60]); });
  out.circuit = await measure(async () => {
    const end = Date.now() + seconds * 1000, keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA', 'KeyE', 'KeyQ']; let k = 0;
    while (Date.now() < end) {
      await hold(keys[k % keys.length], 520);
      if (k % 2 === 0) { const y = 260 + (k % 5) * 30; await drag(900, y, 900 + (k % 4 < 2 ? 150 : -150), y + 30); }
      if (k % 5 === 2) { await page.mouse.move(900, 320); await page.mouse.wheel(0, k % 10 === 2 ? -200 : 200); }
      if (k % 6 === 4) { await page.evaluate((b) => window.__lab.store.getState().change({ bMs: b }), 10 + (k * 3) % 17); }
      if (k % 4 === 3) { await page.evaluate((x) => window.__lab.store.getState().place('P1', [x, 2, 14]), 30 + (k * 7) % 40); }
      await page.mouse.move(640 + (k % 6) * 150, 300 + (k % 4) * 90, { steps: 8 });
      if (k % 12 === 9) { await page.keyboard.press('KeyM'); await wait(700); await page.keyboard.press('KeyR'); }
      k++;
    }
  });
  // 4 · the array: the decoder task while steering, with a fault and a recalibration (the fit runs in a worker)
  await page.selectOption(T('goto'), 'array'); await wait(1400);
  if (await page.locator(T('declare-ok')).count()) await page.click(T('declare-ok'));
  await page.waitForFunction(() => window.__task.store.getState().status === 'ready' && window.__task.store.getState().info?.calibration, null, { timeout: 30000 });
  await world(); await page.keyboard.press('KeyP'); await wait(1200);
  out.array = await measure(async () => {
    const third = (seconds * 1000) / 3;
    await steer(third);
    await page.click(T('t-fault-lost')); await world(); await steer(third * 0.6);
    await page.click(T('t-calibrate')); await world(); await steer(third * 1.4);
  });
  out.hits = await page.evaluate(() => window.__task.task.cur?.hits ?? 0);
  await page.keyboard.press('Escape'); await wait(300);
  if (first) {
    // real pointer capture (only a window in front is granted it)
    await page.selectOption(T('goto'), 'circuit'); await wait(1500);
    await page.bringToFront(); await wait(300);
    const focused = await page.evaluate(() => document.hasFocus());
    await page.click(T('btn-capture')); await wait(700);
    const lock = await page.evaluate(() => ({ granted: !!document.pointerLockElement, shown: document.querySelector('[data-testid="journey"]').dataset.captured, selected: window.__world.store.getState().selected, reticle: !!document.querySelector('[data-testid="reticle"]') }));
    let lookMoved = false;
    if (lock.granted) { const y0 = await page.evaluate(() => window.__world.controller.s.yaw); await page.mouse.move(900, 500); await page.mouse.move(980, 520, { steps: 5 }); await wait(150); lookMoved = (await page.evaluate(() => window.__world.controller.s.yaw)) !== y0; }
    await page.keyboard.press('Escape'); await wait(500);
    const released = await page.evaluate(() => !document.pointerLockElement && document.querySelector('[data-testid="journey"]').dataset.captured === '0' && window.__world.controller.held.size === 0);
    await page.evaluate(() => document.exitPointerLock()); await wait(200);
    out.capture = { focused, ...lock, lookMoved, released };
    // memory over repeated trips out to the brain and back in
    const heap = () => page.evaluate(() => (performance.memory?.usedJSHeapSize ?? 0) / 1048576);
    const trip = async () => { await page.click(T('map')); await page.waitForSelector(`${T('journey')}[data-place="brain"]`, { timeout: 15000 }); await wait(500); await page.click(T('resume')); await inCortex(); await wait(400); };
    await trip(); out.h1 = await heap();
    for (let i = 0; i < 6; i++) await trip();
    out.h2 = await heap();
  }
  await ctx.close();
  return out;
}

const A = await profile(1, SECS, true), B = await profile(2, Math.round(SECS / 2), false);
await browser.close();

const assets = readdirSync(join(root, 'dist/assets')).map((f) => { const b = readFileSync(join(root, 'dist/assets', f)); return { f, raw: b.length, gz: gzipSync(b).length }; });
const sum = (re, k) => assets.filter((a) => re.test(a.f)).reduce((s, a) => s + a[k], 0);
const worldChunks = assets.filter((a) => /^(Journey|WorldWorkspace|WorldFrame|pilot\.worker)/.test(a.f));
const sys = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
const machine = `${sys('sysctl', ['-n', 'machdep.cpu.brand_string'])}, macOS ${sys('sw_vers', ['-productVersion'])}, ${sys('pmset', ['-g', 'batt']).split('\n')[0].replace('Now drawing from ', '')}`;
const hz = Math.round(1000 / A.circuit.median), budget = 1000 / 60;
const row = (name, r) => [
  `${name}`,
  `  ${r.frames} frames in ${r.seconds} s; page visible ${(r.visibleShare * 100).toFixed(0)} % of the time; detail “${r.quality ?? 'high'}”`,
  `  frame interval   median ${r.median} ms · p95 ${r.p95} ms · p99 ${r.p99} ms · worst ${r.worst} ms`,
  `  long frames      over 16.7 ms (a missed frame at 60 Hz): ${r.over17} · over 33.3 ms: ${r.over33} · over 100 ms: ${r.over100}`,
  r.work?.n ? `  main-thread work median ${r.work.median} ms · p95 ${r.work.p95} ms · p99 ${r.work.p99} ms per frame  (${((100 * r.work.p95) / budget).toFixed(0)} % of a 60 Hz frame at p95)` : '  main-thread work not sampled (the tissue view was not drawing)',
  r.response?.n ? `  response         ${r.response.n} inputs · median ${r.response.median} ms · p95 ${r.response.p95} ms` : '  response         not sampled in this segment',
  r.pick?.n ? `  pointing         ${r.pick.n} “what is aimed at” tests among ${r.things} things · median ${r.pick.median} ms · p95 ${r.pick.p95} ms · p99 ${r.pick.p99} ms each (run every fourth frame)` : '  pointing         not sampled in this segment',
  '',
];
const lines = [
  'The world (#/world), embodied build — interactive performance sample',
  `Run: ${new Date().toISOString()}   Build: production (vite preview), visible Chrome window`,
  `Machine: ${machine}`,
  `Browser: ${A.envBrain.ua}`,
  `Graphics: ${A.envBrain.gpu}`,
  `Window: ${A.envBrain.css} CSS pixels. Two pixel densities were measured (below).`,
  '',
  `How to read this. This display refreshes at about ${hz} Hz, so no frame interval can be shorter than ${(1000 / hz).toFixed(1)} ms: a median at`,
  'that value means the page kept up with this display — it is a ceiling set by the display, not a measure of spare',
  'capacity. The target was 60 Hz (16.7 ms). “Main-thread work” is the part of each frame the page itself spends',
  '(scripts and submitting draw calls); what the GPU then spends cannot be read from inside a page and is not reported.',
  '',
  ...[[A, `PROFILE 1 — device pixel ratio ${A.dpr}: brain canvas ${A.envBrain.canvas}, tissue canvas ${A.envCortex.canvas} physical pixels; ${SECS} s per segment`], [B, `PROFILE 2 — device pixel ratio ${B.dpr} (a Retina display draws this): brain canvas ${B.envBrain.canvas}, tissue canvas ${B.envCortex.canvas} physical pixels; ${Math.round(SECS / 2)} s per segment`]].flatMap(([o, title]) => [
    title, '',
    ...row('Whole brain — turning it by dragging, hovering to name regions (460 k triangles, one draw call)', o.brain),
    ...row('Going in — dive, caption, cross-fade, the craft’s arrival (includes the first frames of the tissue view)', o.enter),
    ...row('First minute — flying the craft beside the reconstructed neuron, pointing along its branches, looking, third ↔ first person', o.approach),
    ...row('Close approach — the craft a few µm from the reconstructed neuron’s body: pointing, orbiting looks, side-slips, both views', o.close),
    ...row('Circuit — flying, looking, wheel glides, replay, new runs and a moved contact every few seconds, overview; linked traces open', o.circuit),
    ...row(`Electrode array — decoder task while steering; three contacts lost, then a recalibration in the worker (${o.hits} targets reached)`, o.array),
  ]),
  'Loading (from a local server; no network is involved)',
  `  to “brain on screen”: cold (new browser profile) ${A.coldMs} ms · warm (reload) ${A.warmMs} ms`,
  `  from the click on “Enter” to a flyable tissue view: ${A.enterMs} ms, of which about 2.5 s is the authored dive and arrival`,
  '',
  'Payload (production build, dist/assets)',
  `  all JavaScript ${(sum(/\.js$/, 'raw') / 1024).toFixed(0)} kB raw, ${(sum(/\.js$/, 'gz') / 1024).toFixed(0)} kB gzip · all CSS ${(sum(/\.css$/, 'raw') / 1024).toFixed(0)} kB raw`,
  `  the world's own chunks: ${worldChunks.map((a) => `${a.f.replace(/-[\w-]{8}\./, '.')} ${(a.raw / 1024).toFixed(0)} kB`).join(', ')}`,
  `  the brain is the atlas already in the studio (8.9 MB on disk); the tissue downloads one file — the reconstructed neuron, ${(statSync(join(root, 'public/world/h01-exemplar.json')).size / 1024).toFixed(0)} kB of JSON (12,687 nodes) — and every other shape is generated in the browser`,
  '',
  'Memory over repeated trips (out to the brain and back in)',
  `  JS heap after one trip: ${A.h1.toFixed(1)} MB; after six more: ${A.h2.toFixed(1)} MB (${(A.h2 - A.h1 >= 0 ? '+' : '') + (A.h2 - A.h1).toFixed(1)} MB).`,
  '  No garbage collection was forced, so this is an upper bound on growth. GPU memory is not exposed by the browser and was not measured.',
  '',
  'Pointer capture (real browser grant, profile 1)',
  `  window in front: ${A.capture.focused ? 'yes' : 'NO — a browser grants capture only to the window in front, so the line below says little'}`,
  `  requested by the “Mouse look” button: ${A.capture.granted ? 'granted' : 'NOT granted'}; centre mark shown: ${A.capture.reticle ? 'yes' : 'no'}; that click selected ${A.capture.selected ? 'something (it should not)' : 'nothing'}; mouse movement turned the view: ${A.capture.lookMoved ? 'yes' : 'no'}; Escape released it and held keys were forgotten: ${A.capture.released ? 'yes' : 'no'}`,
  '',
  'Adaptive detail',
  `  The world lowers its detail setting by itself when more than half of 150 consecutive frames take over 22.5 ms. In this run it ${[A.brain, A.circuit, A.array, B.circuit, B.array].some((r) => r.quality && r.quality !== 'high') ? 'DID so (see the “detail” noted per segment)' : 'never did: every segment stayed at “high”'}.`,
  '',
  'Not measured: any other computer, a phone or tablet, a browser other than Chrome, battery power, a 60 Hz display,',
  'GPU time or GPU memory, and anything a person feels. Model time steps and sample rates do not depend on any of the above.',
  '',
];
mkdirSync(join(root, 'docs/evidence/world'), { recursive: true });
writeFileSync(join(root, 'docs/evidence/world/performance.txt'), lines.join('\n'));
console.log(lines.join('\n'));
process.exit(0);
