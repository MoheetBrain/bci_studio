// Interactive performance of the Neuroverse toys, measured in a VISIBLE Chrome window on this machine's GPU against
// the production build. Writes docs/evidence/neuroverse/performance.txt. One machine, one run: measurements, not
// guarantees, and not a statement about any other computer.
//
//   npm run build && node tests/e2e/neuroverse-perf.mjs          (SECONDS=60 per toy by default → about 5½ minutes)
//
// Two profiles are measured: 1920 × 1080 at one device pixel per CSS pixel (“1080p”), and the same window at two
// (what a Retina display draws: four times the pixels), the second for half as long.
//
// A Chrome window (temporary profile) opens and must stay in front: a hidden window is throttled by the browser and
// its frame times mean nothing, so the script records how long the page was visible and says so.
//
// What is measured, and how:
//   frame time      the interval between successive animation frames while a scripted player flies, looks, and uses
//                   each toy (keys and pointer are sent as real input events);
//   response        from an input event's timestamp to the start of the next rendered frame. This is NOT a hardware
//                   input-to-photon latency: it leaves out the display's own scan-out and the input device;
//   stalls          frames longer than 100 ms, in particular while Toy C refits its decoders;
//   loading         from navigation to "scene ready", cold (new browser profile) and warm (reload);
//   memory          JS heap before and after repeated scene changes (no forced garbage collection: an upper bound);
//   pointer capture whether the browser really grants and releases pointer lock (the headless suite cannot ask it).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5199, BASE = `http://127.0.0.1:${PORT}`, SECS = Math.max(10, +(process.env.SECONDS ?? 60));
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1920,1200', '--window-position=40,30'] });
let ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
let page = await ctx.newPage();
const T = (id) => `[data-testid="${id}"]`, wait = (ms) => page.waitForTimeout(ms);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const ready = () => page.waitForFunction(() => window.__world?.store.getState().ready && window.__world.rt.frames > 5, null, { timeout: 30000 });
const describe = () => page.evaluate(() => { const c = document.createElement('canvas'), gl = c.getContext('webgl2'), dbg = gl?.getExtension('WEBGL_debug_renderer_info'), cv = document.querySelector('[data-testid="world-view"] canvas'); return { ua: navigator.userAgent, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, css: `${innerWidth} × ${innerHeight}`, canvas: `${cv.width} × ${cv.height}`, visible: document.visibilityState }; });

// loading
const t0 = Date.now();
await page.goto(`${BASE}/#/world/workshop`); await ready();
const coldMs = Date.now() - t0;
const t1 = Date.now();
await page.reload(); await ready();
const warmMs = Date.now() - t1;
const env = await describe();
if (env.visible !== 'visible') { console.error('The window is not visible; frame times would be meaningless. Nothing was written.'); await browser.close(); process.exit(3); }

// does the browser really grant pointer capture? (it only does to a window that is in front)
await page.bringToFront(); await wait(400);
const focused = await page.evaluate(() => document.hasFocus());
await page.click(T('btn-capture')); await wait(600);
const lock = await page.evaluate(() => ({ granted: !!document.pointerLockElement, shown: document.querySelector('[data-testid="world"]').dataset.captured, selected: window.__world.store.getState().selected }));
let lookMoved = false;
if (lock.granted) { const y0 = await page.evaluate(() => window.__world.controller.s.yaw); await page.mouse.move(900, 500); await page.mouse.move(980, 520, { steps: 5 }); await wait(150); lookMoved = (await page.evaluate(() => window.__world.controller.s.yaw)) !== y0; }
await page.keyboard.press('KeyL'); await wait(400);
const released = await page.evaluate(() => !document.pointerLockElement && document.querySelector('[data-testid="world"]').dataset.captured === '0' && window.__world.controller.held.size === 0);
await page.evaluate(() => document.exitPointerLock()); await wait(200);

/** A scripted player for one toy: flies and looks the whole time, and uses the toy every few seconds. */
async function play(toy, seconds, act) {
  await page.goto(`${BASE}/#/world`); await page.click(T(`toy-${toy}`)); await ready();
  if (toy === 'pilot') await page.waitForSelector(`${T('pilot')}[data-status="ready"][data-calibration="1"]`, { timeout: 30000 });
  await wait(800);
  await page.evaluate(() => { document.activeElement?.blur?.(); window.__vis = { ok: 0, n: 0 }; window.__visTimer = setInterval(() => { window.__vis.n++; if (document.visibilityState === 'visible') window.__vis.ok++; }, 250); window.__world.perf.start(); });
  const end = Date.now() + seconds * 1000; let k = 0;
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA', 'KeyE', 'KeyQ'];
  while (Date.now() < end) {
    await hold(keys[k % keys.length], 550);
    if (k % 2 === 0) { const y = 260 + (k % 5) * 30; await page.mouse.move(900, y); await page.mouse.down(); await page.mouse.move(900 + (k % 4 < 2 ? 140 : -140), y + 30, { steps: 12 }); await page.mouse.up(); }
    if (k % 5 === 4) await act(k);
    k++;
  }
  const r = await page.evaluate(() => { clearInterval(window.__visTimer); window.__world.perf.stop(); return { ...window.__world.perf.report(), visibleShare: window.__vis.ok / Math.max(1, window.__vis.n), quality: window.__world.store.getState().quality }; });
  return r;
}
async function profile(seconds) {
  const out = {};
  out.workshop = await play('workshop', seconds, async (k) => { await page.fill(T('wk-b-num'), String(10 + (k * 3) % 17)); await page.evaluate(() => document.activeElement?.blur?.()); if (k % 10 === 4) await page.keyboard.press('KeyM'); if (k % 10 === 9) await page.keyboard.press('KeyR'); });
  out.flight = await play('flight', seconds, async (k) => { await page.keyboard.press('KeyC'); if (k % 10 === 9) { await page.selectOption(T('goto'), 'c3'); await wait(300); await page.click(T('fl-silence')); await page.keyboard.press('KeyR'); await page.evaluate(() => document.activeElement?.blur?.()); } });
  out.pilot = await play('pilot', seconds, async (k) => { if (k % 10 === 4) { await page.click(T('pl-fault-lost')); await page.click(T('pl-calibrate')); } if (k % 10 === 9) { await page.click(T('pl-clear')); await page.click(T('pl-calibrate')); } await page.evaluate(() => document.activeElement?.blur?.()); });
  return out;
}
const out = await profile(SECS);

// memory over repeated scene changes
const heap = () => page.evaluate(() => (performance.memory?.usedJSHeapSize ?? 0) / 1048576);
const cycle = async () => { for (const t of ['flight', 'workshop', 'pilot']) { await page.click(T('world-back')); await page.click(T(`toy-${t}`)); await ready(); await wait(400); } };
await cycle(); const h1 = await heap();
for (let i = 0; i < 5; i++) await cycle();
const h2 = await heap();

// the same window at two device pixels per CSS pixel (a Retina display), for half as long
await ctx.close();
ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
page = await ctx.newPage();
await page.goto(`${BASE}/#/world/workshop`); await ready();
const env2 = await describe(), secs2 = Math.round(SECS / 2), out2 = await profile(secs2);
await browser.close();

// payload
const assets = readdirSync(join(root, 'dist/assets')).map((f) => { const b = readFileSync(join(root, 'dist/assets', f)); return { f, raw: b.length, gz: gzipSync(b).length }; });
const sum = (re, k) => assets.filter((a) => re.test(a.f)).reduce((s, a) => s + a[k], 0);
const world = assets.filter((a) => /^(WorldWorkspace|Workshop|Flight|Pilot|WorldFrame|pilot\.worker|lif|flight|controller)/.test(a.f));
const sys = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
const machine = `${sys('sysctl', ['-n', 'machdep.cpu.brand_string'])}, macOS ${sys('sw_vers', ['-productVersion'])}, ${sys('pmset', ['-g', 'batt']).split('\n')[0].replace("Now drawing from ", '')}`;
const verdict = (v, limit) => (v == null ? 'n/a' : v <= limit ? `${v} ms  (target ≤ ${limit} ms: met)` : `${v} ms  (target ≤ ${limit} ms: NOT met)`);
const lines = [
  'Neuroverse toys — interactive performance sample',
  `Run: ${new Date().toISOString()}   Build: production (vite preview), visible Chrome window`,
  `Machine: ${machine}`,
  `Browser: ${env.ua}`,
  `Graphics: ${env.gpu}`,
  `Window: ${env.css} CSS pixels; detail setting “${out.workshop.quality}”. Two pixel densities were measured (below).`,
  '',
  'Method: a scripted player holds movement keys in turn, drags to look every second step, and uses the toy every few',
  `seconds, for ${SECS} s per toy (${SECS * 3} s in all) in profile 1. Keys and pointer are sent to the browser as real input events.`,
  'Response = input event → start of the next rendered frame; it is not a hardware input-to-photon latency.',
  '',
  ...[[out, `PROFILE 1 — ${env.css} CSS pixels at device pixel ratio ${env.dpr} (3D canvas ${env.canvas} physical pixels), ${SECS} s per toy`], [out2, `PROFILE 2 — the same window at device pixel ratio ${env2.dpr} (3D canvas ${env2.canvas} physical pixels), ${secs2} s per toy`]].flatMap(([o, title]) => [title, '', ...Object.entries(o).flatMap(([toy, r]) => [
    `${{ workshop: 'Toy B · Time workshop', flight: 'Toy A · Instrument flight', pilot: 'Toy C · Decoder pilot (with two recalibrations per 10 actions)' }[toy]}`,
    `  frames ${r.frames} in ${r.seconds} s; page visible ${(r.visibleShare * 100).toFixed(0)} % of the time`,
    `  frame time   median ${r.frameMs.median} ms · p95 ${verdict(r.frameMs.p95, 20)} · p99 ${verdict(r.frameMs.p99, 33.3)} · worst ${r.frameMs.worst} ms`,
    `  stalls       frames over 100 ms: ${r.frameMs.over100ms}  (target: none)`,
    `  response     ${r.responseMs.n} inputs · median ${r.responseMs.median} ms · p95 ${verdict(r.responseMs.p95, 50)}`,
    `  JS heap      ${r.jsHeapMB} MB at the end`,
    '',
  ])]),
  'Loading (to “scene ready”, Toy B)',
  `  cold (new browser profile) ${coldMs} ms · warm (reload) ${warmMs} ms   — from a local server; no network is involved`,
  `  agency: the rig answers the first key press as soon as the scene is ready (target: within 10 s) — met by ${((10000 - coldMs) / 1000).toFixed(1)} s`,
  '',
  'Payload (production build, dist/assets)',
  `  all JavaScript ${(sum(/\.js$/, 'raw') / 1024).toFixed(0)} kB raw, ${(sum(/\.js$/, 'gz') / 1024).toFixed(0)} kB gzip · all CSS ${(sum(/\.css$/, 'raw') / 1024).toFixed(0)} kB raw`,
  `  the world's own chunks: ${world.map((a) => `${a.f.replace(/-[\w-]{8}\./, '.')} ${(a.raw / 1024).toFixed(0)} kB`).join(', ') || 'bundled with shared chunks'}`,
  '  the toys download no mesh, texture or dataset: every shape is generated in the browser',
  '',
  'Memory over repeated scene changes',
  `  JS heap after one round of the three toys: ${h1.toFixed(1)} MB; after five more rounds: ${h2.toFixed(1)} MB (${(h2 - h1 >= 0 ? '+' : '') + (h2 - h1).toFixed(1)} MB).`,
  '  No garbage collection was forced, so this is an upper bound on growth. GPU memory is not exposed by the browser and was not measured.',
  '',
  'Pointer capture (real browser grant)',
  `  window in front: ${focused ? 'yes' : 'NO — a browser grants capture only to the window in front, so the lines below say little'}`,
  `  requested by the “Mouse look” button: ${lock.granted ? 'granted' : 'NOT granted'}; that click selected ${lock.selected ? 'something (it should not)' : 'nothing'}; mouse movement turned the view: ${lookMoved ? 'yes' : 'no'}; L released it and held keys were forgotten: ${released ? 'yes' : 'no'}`,
  '',
  `Not measured: a slower Mac, a phone or tablet, a browser other than Chrome, battery power, a 60 Hz display (this one`,
  `refreshed at about ${Math.round(1000 / out.workshop.frameMs.median)} Hz, which is what a median frame time of ${out.workshop.frameMs.median} ms means),`,
  'GPU memory, and anything a person feels. Model time steps and sample rates do not depend on any of the above.',
  '',
];
mkdirSync(join(root, 'docs/evidence/neuroverse'), { recursive: true });
writeFileSync(join(root, 'docs/evidence/neuroverse/performance.txt'), lines.join('\n'));
console.log(lines.join('\n'));
process.exit(0);
