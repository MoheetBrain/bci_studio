// Interactive performance of the atlas, measured in a VISIBLE Chrome window on this machine's GPU, against the
// production build. Writes docs/evidence/performance.txt. These are measurements of one machine, not guarantees.
//
//   npm run build && node tests/e2e/perf.mjs
//
// A Chrome window (temporary profile) opens for about 15 seconds. Without a visible window, animation frames are
// throttled and frame times would be meaningless, so the script refuses to report if the page is not visible.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5198, BASE = `http://127.0.0.1:${PORT}`;
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,980', '--window-position=60,40'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
const tLoad = Date.now();
await page.goto(BASE);
await page.waitForSelector('[data-testid="atlas-workspace"][data-status="ready"]', { timeout: 30000 });
await page.waitForSelector('[data-testid="atlas-viewport"] canvas');
const readyMs = Date.now() - tLoad;
await page.waitForFunction(() => window.__atlasPerf && window.__atlasPerf.bvhCount >= 251, null, { timeout: 30000 });
await page.bringToFront();
await page.waitForTimeout(800);

const m = await page.evaluate(async () => {
  const A = window.__atlas, P = window.__atlasPerf;
  const st = A.store.getState();
  st.select(null); st.restoreAll(); st.camera({ kind: 'reset' });
  await new Promise((r) => setTimeout(r, 900));
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null; };
  const c = document.querySelector('[data-testid="atlas-viewport"] canvas');
  const gl = c.getContext('webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rect = c.getBoundingClientRect();
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  // 1 · ray-cast picking: 600 casts across the brain
  const picks = []; let hits = 0;
  for (let i = 0; i < 600; i++) {
    const x = rect.left + rect.width * (0.25 + 0.5 * ((i * 37) % 101) / 101), y = rect.top + rect.height * (0.2 + 0.6 * ((i * 61) % 97) / 97);
    const t0 = performance.now(); const h = A.pickAt(x, y); picks.push(performance.now() - t0); if (h) hits++;
  }
  // 2 · hover feedback: pointer event → highlighted frame presented (two animation frames later at most)
  const target = c.closest('[data-testid="atlas-viewport"]');
  const hov = [];
  for (let i = 0; i < 60; i++) {
    const x = rect.left + rect.width * (0.3 + 0.4 * ((i * 53) % 41) / 41), y = rect.top + rect.height * (0.3 + 0.4 * ((i * 29) % 37) / 37);
    const t0 = performance.now();
    target.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }));
    await raf(); await raf();
    hov.push(performance.now() - t0);
  }
  // 3 · idle for 2 s: demand rendering should draw nothing
  st.hover(null);
  await new Promise((r) => setTimeout(r, 500));
  const f0 = P.frameMs.length; let ticks = 0; const i0 = performance.now();
  while (performance.now() - i0 < 2000) { await raf(); ticks++; }
  const idleFrames = P.frameMs.length - f0;
  // 4 · continuous orbit for 5 s, one camera step per animation frame
  const ft = []; let last = performance.now(); const o0 = last;
  while (performance.now() - o0 < 5000) { const now = await raf(); ft.push(now - last); last = now; A.store.getState().camera({ kind: 'orbit', dAz: 0.03, dPolar: 0 }); }
  ft.shift();
  // 5 · the same orbit with a see-through cortex (transparent pass + deeper structures drawn)
  st.setCortexOpacity(0.3);
  await raf(); await raf();
  const ft2 = []; last = performance.now(); const o1 = last;
  while (performance.now() - o1 < 3000) { const now = await raf(); ft2.push(now - last); last = now; A.store.getState().camera({ kind: 'orbit', dAz: 0.03, dPolar: 0 }); }
  ft2.shift();
  st.setCortexOpacity(1);
  const res = performance.getEntriesByType('resource');
  const size = (re) => res.filter((e) => re.test(e.name)).reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0);
  const man = st.manifest;
  const geomBytes = man.structures.reduce((a, s) => a + s.vertexCount * 15 + s.indexCount * (s.vertexCount < 65536 ? 2 : 4), 0);
  return {
    ua: navigator.userAgent, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', visibility: document.visibilityState,
    viewportCss: [innerWidth, innerHeight], canvasPx: [c.width, c.height], dpr: devicePixelRatio, screenHz: null,
    triangles: man.totals.triangles, structures: man.totals.structures,
    pick: { n: picks.length, hits, p50: q(picks, 0.5), p95: q(picks, 0.95), max: q(picks, 1) },
    hover: { n: hov.length, p50: q(hov, 0.5), p95: q(hov, 0.95), max: q(hov, 1) },
    idle: { seconds: 2, rafTicks: ticks, framesRendered: idleFrames },
    orbit: { frames: ft.length, p50: q(ft, 0.5), p95: q(ft, 0.95), max: q(ft, 1) },
    orbitTransparent: { frames: ft2.length, p50: q(ft2, 0.5), p95: q(ft2, 0.95), max: q(ft2, 1) },
    bvhBuildMs: Math.round(P.bvhBuiltMs),
    payload: { atlas: size(/atlas\/spl-nac\//), js: size(/assets\/.*\.js/), css: size(/assets\/.*\.css/) },
    memory: { jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, geometryMB: +(geomBytes / 1048576).toFixed(1) },
  };
});
await browser.close();

if (m.visibility !== 'visible') { console.error('The page was not visible; frame timings would be meaningless. Nothing was written.'); process.exit(3); }
const dist = join(root, 'dist/assets');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const files = readdirSync(dist).map((f) => ({ f, n: statSync(join(dist, f)).size }));
const idx = files.filter((x) => /^index-.*\.js$/.test(x.f)).reduce((a, x) => a + x.n, 0);
const atlasDir = join(root, 'dist/atlas/spl-nac');
const atlasBytes = readdirSync(atlasDir).reduce((a, f) => a + statSync(join(atlasDir, f)).size, 0);
let hw = '';
try { hw = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(); } catch { /* not macOS */ }
const fps = (ms) => (ms ? (1000 / ms).toFixed(0) : '—');
const lines = [
  `# Atlas performance — measured ${new Date().toISOString()}`,
  '',
  'These are measurements on ONE machine in ONE run, with a visible Chrome window. They are not guarantees for other',
  'hardware, browsers, window sizes or system load. Targets from the brief: hover feedback within 100 ms; near 60 fps.',
  '',
  '## Conditions',
  `Machine: ${hw || 'unknown CPU'}`,
  `Browser: ${m.ua}`,
  `WebGL renderer: ${m.renderer}`,
  `Window: ${m.viewportCss.join(' × ')} CSS px; canvas ${m.canvasPx.join(' × ')} device px (devicePixelRatio ${m.dpr}, pixel ratio capped at 2)`,
  `Scene: ${m.structures} structures, ${m.triangles.toLocaleString()} triangles, one draw call per visible structure; production build`,
  '',
  '## Results',
  `Ray-cast pick (${m.pick.n} casts, ${m.pick.hits} hits):        p50 ${m.pick.p50} ms   p95 ${m.pick.p95} ms   max ${m.pick.max} ms`,
  `Hover feedback, pointer event → highlighted frame presented (${m.hover.n} moves): p50 ${m.hover.p50} ms   p95 ${m.hover.p95} ms   max ${m.hover.max} ms   (target ≤ 100 ms)`,
  `Frame time, continuous orbit, opaque cortex (${m.orbit.frames} frames):      p50 ${m.orbit.p50} ms (${fps(m.orbit.p50)} fps)   p95 ${m.orbit.p95} ms (${fps(m.orbit.p95)} fps)   max ${m.orbit.max} ms`,
  `Frame time, continuous orbit, cortex at 30 % (${m.orbitTransparent.frames} frames):  p50 ${m.orbitTransparent.p50} ms (${fps(m.orbitTransparent.p50)} fps)   p95 ${m.orbitTransparent.p95} ms (${fps(m.orbitTransparent.p95)} fps)   max ${m.orbitTransparent.max} ms`,
  `Idle, no input for ${m.idle.seconds} s: ${m.idle.framesRendered} frames rendered while the display ticked ${m.idle.rafTicks} times (demand rendering)`,
  `Picking acceleration (BVH for all ${m.structures} structures) built in ${m.bvhBuildMs} ms, in idle slices after first paint`,
  `Time from navigation to an interactive atlas (local server, warm disk): ${readyMs} ms`,
  '',
  '## Payload (production build, uncompressed on disk; a server that gzips would send less)',
  `Atlas data (manifest + 4 mesh chunks): ${kb(atlasBytes)}   — transferred in this run: ${kb(m.payload.atlas)}`,
  `Home-screen JavaScript (index chunk): ${kb(idx)}   — all JavaScript transferred for the home screen: ${kb(m.payload.js)}`,
  `The existing chip studio (${kb(files.filter((x) => /^App-.*\.js$/.test(x.f)).reduce((a, x) => a + x.n, 0))}) and the lesson screens load only when opened.`,
  '',
  '## Memory',
  `JavaScript heap after loading the atlas: ${m.memory.jsHeapMB ?? 'not reported by this browser'} MB`,
  `Vertex + index buffers handed to the GPU: about ${m.memory.geometryMB} MB (computed from the manifest; GPU memory itself is not observable from the page)`,
  '',
  '## Limits of this measurement',
  '- One run, one machine, one window size. No low-end or integrated-GPU device and no phone was measured.',
  '- Frame time is the interval between animation frames, so it cannot be shorter than the display refresh interval.',
  '- "Hover feedback" is measured from a synthetic pointer event to two animation frames later, which bounds the time to a presented frame from above.',
  '- The headless end-to-end run (docs/evidence/e2e-report.txt) is functional evidence only and is not a performance figure.',
];
mkdirSync(join(root, 'docs/evidence'), { recursive: true });
writeFileSync(join(root, 'docs/evidence/performance.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(0);
