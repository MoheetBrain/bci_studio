// Interactive performance of the studio, measured in a VISIBLE Chrome window on this machine's GPU, against the
// production build. Writes docs/evidence/performance.txt. These are measurements of one machine, not guarantees.
//
//   npm run build && node tests/e2e/perf.mjs
//
// A Chrome window (temporary profile) opens for about 40 seconds. Without a visible window, animation frames are
// throttled and frame times would be meaningless, so the script refuses to report if the page is not visible.
//
// Two profiles are measured: the machine as it is, and a deliberately constrained one (CPU slowed 4× through the
// browser's own throttle, 1280 × 720 window). The second is an emulation of a slower CPU on the SAME GPU — it is
// not a measurement of a low-end device.
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

/** Everything measured inside the page for one profile. */
const measure = () => window.__measure ??= (async () => {
  const A = window.__atlas, P = window.__atlasPerf;
  const st = () => A.store.getState();
  st().select(null); st().restoreAll(); st().camera({ kind: 'reset' });
  await new Promise((r) => setTimeout(r, 1000));
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
  st().hover(null);
  // 3 · selecting a region: store update + smoothed selection mask over the whole surface + next frame
  const ids = [...st().specimen.exposedIds].slice(0, 24), sel = [];
  for (const id of ids) { const t0 = performance.now(); st().select(id); await raf(); sel.push(performance.now() - t0); }
  st().select(null);
  // 4 · idle for 2 s: demand rendering should draw nothing
  await new Promise((r) => setTimeout(r, 500));
  const f0 = P.frames; let ticks = 0; const i0 = performance.now();
  while (performance.now() - i0 < 2000) { await raf(); ticks++; }
  const idleFrames = P.frames - f0;
  // 5 · continuous orbit, one camera step per animation frame: solid surface, then the glass shell with the inner bodies
  const orbit = async (ms) => { const ft = []; let last = performance.now(); const o0 = last; while (performance.now() - o0 < ms) { const now = await raf(); ft.push(now - last); last = now; st().camera({ kind: 'orbit', dAz: 0.03, dPolar: 0 }); } ft.shift(); return ft; };
  const ft = await orbit(5000);
  st().setViewMode('xray'); await raf(); await raf();
  const ft2 = await orbit(3000);
  // 6 · first opening of the Regions view (computes the border fields) and of the slice view (fetches the MRI)
  let t0 = performance.now(); st().setViewMode('parcels'); await raf(); const parcelsMs = performance.now() - t0;
  t0 = performance.now(); st().setViewMode('slice');
  while (st().slices.status === 'loading' || st().slices.status === 'idle') await new Promise((r) => setTimeout(r, 20));
  await raf(); const sliceMs = performance.now() - t0;
  const ft3 = await orbit(2000);
  st().setViewMode('solid');
  const res = performance.getEntriesByType('resource');
  const size = (re) => res.filter((e) => re.test(e.name)).reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0);
  const man = st().manifest, sp = st().specimen.meta.mesh;
  const geomBytes = man.structures.reduce((a, s) => a + s.vertexCount * 16 + s.indexCount * (s.vertexCount < 65536 ? 2 : 4), 0) + sp.vertexCount * (12 + 3 + 1 + 1 + 1 + 1 + 8) + sp.indexCount * 4;
  return {
    ua: navigator.userAgent, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', visibility: document.visibilityState,
    viewportCss: [innerWidth, innerHeight], canvasPx: [c.width, c.height], dpr: devicePixelRatio,
    surfaceTriangles: sp.triangles, structures: man.totals.structures, innerTriangles: man.totals.triangles,
    pick: { n: picks.length, hits, p50: q(picks, 0.5), p95: q(picks, 0.95), max: q(picks, 1) },
    hover: { n: hov.length, p50: q(hov, 0.5), p95: q(hov, 0.95), max: q(hov, 1) },
    select: { n: sel.length, p50: q(sel, 0.5), p95: q(sel, 0.95), max: q(sel, 1) },
    idle: { seconds: 2, rafTicks: ticks, framesRendered: idleFrames },
    orbit: { frames: ft.length, p50: q(ft, 0.5), p95: q(ft, 0.95), max: q(ft, 1) },
    orbitXray: { frames: ft2.length, p50: q(ft2, 0.5), p95: q(ft2, 0.95), max: q(ft2, 1) },
    orbitSlice: { frames: ft3.length, p50: q(ft3, 0.5), p95: q(ft3, 0.95), max: q(ft3, 1) },
    parcelsMs: Math.round(parcelsMs), sliceMs: Math.round(sliceMs), bvhBuildMs: Math.round(P.bvhBuiltMs),
    payload: { atlas: size(/atlas\/spl-nac\//), js: size(/assets\/.*\.js/), css: size(/assets\/.*\.css/) },
    memory: { jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, geometryMB: +(geomBytes / 1048576).toFixed(1) },
  };
})();

/** Frame pacing of a playing scene (Neurons or Decoder): intervals between animation frames for `ms`. */
const pace = (ms) => new Promise((resolve) => { const ft = []; let last = performance.now(); const t0 = last; const tick = (now) => { ft.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(tick); else { ft.shift(); const s = [...ft].sort((a, b) => a - b); resolve({ frames: ft.length, p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) }); } }; requestAnimationFrame(tick); });

async function profile({ viewport, cpu }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (cpu > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  const tLoad = Date.now();
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="atlas-workspace"][data-status="ready"]', { timeout: 60000 });
  await page.waitForSelector('[data-testid="atlas-viewport"] canvas');
  const readyMs = Date.now() - tLoad;
  await page.waitForFunction(() => window.__atlasPerf && window.__atlasPerf.bvhBuiltMs > 0, null, { timeout: 60000 });
  await page.bringToFront();
  await page.waitForTimeout(800);
  const m = await page.evaluate(measure);
  // the two animated scenes
  await page.goto(`${BASE}/#/interface`); await page.waitForSelector('[data-testid="interface-workspace"] canvas'); await page.waitForTimeout(800);
  if ((await page.locator('[data-testid="tp-play"]').getAttribute('data-playing')) !== 'true') await page.locator('[data-testid="tp-play"]').click();
  const neurons = await page.evaluate(pace, 3000);
  await page.goto(`${BASE}/#/decoder`); await page.waitForSelector('[data-testid="decoder-diagram"]'); await page.waitForTimeout(500);
  if ((await page.locator('[data-testid="tp-play"]').getAttribute('data-playing')) !== 'true') await page.locator('[data-testid="tp-play"]').click();
  const decoder = await page.evaluate(pace, 2000);
  await ctx.close();
  return { ...m, readyMs, neurons, decoder };
}

const full = await profile({ viewport: null, cpu: 1 });
const slow = await profile({ viewport: { width: 1280, height: 720 }, cpu: 4 });
await browser.close();

if (full.visibility !== 'visible') { console.error('The page was not visible; frame timings would be meaningless. Nothing was written.'); process.exit(3); }
const dist = join(root, 'dist/assets');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const files = readdirSync(dist).map((f) => ({ f, n: statSync(join(dist, f)).size }));
const idx = files.filter((x) => /^index-.*\.js$/.test(x.f)).reduce((a, x) => a + x.n, 0);
const atlasDir = join(root, 'dist/atlas/spl-nac');
const atlasFiles = readdirSync(atlasDir).map((f) => ({ f, n: statSync(join(atlasDir, f)).size }));
const first = atlasFiles.filter((x) => !/^slices-/.test(x.f) && !/LICENSE/.test(x.f)).reduce((a, x) => a + x.n, 0);
const slices = atlasFiles.filter((x) => /^slices-/.test(x.f)).reduce((a, x) => a + x.n, 0);
let hw = '';
try { hw = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(); } catch { /* not macOS */ }
const fps = (ms) => (ms ? (1000 / ms).toFixed(0) : '—');
const row = (label, a) => `${label.padEnd(58)} p50 ${String(a.p50).padStart(6)} ms (${fps(a.p50).padStart(3)} fps)   p95 ${String(a.p95).padStart(6)} ms (${fps(a.p95).padStart(3)} fps)${a.max !== undefined ? `   max ${a.max} ms` : ''}`;
const block = (m) => [
  `Window: ${m.viewportCss.join(' × ')} CSS px; canvas ${m.canvasPx.join(' × ')} device px (devicePixelRatio ${m.dpr}, pixel ratio capped at 2)`,
  `Time from navigation to an interactive brain (local server, warm disk): ${m.readyMs} ms`,
  `Ray-cast pick (${m.pick.n} casts, ${m.pick.hits} hits):`.padEnd(58) + ` p50 ${m.pick.p50} ms   p95 ${m.pick.p95} ms   max ${m.pick.max} ms`,
  `Hover feedback, pointer event → highlighted frame (${m.hover.n}):`.padEnd(58) + ` p50 ${m.hover.p50} ms   p95 ${m.hover.p95} ms   max ${m.hover.max} ms   (target ≤ 100 ms)`,
  `Select a region → next frame, incl. smoothed mask (${m.select.n}):`.padEnd(58) + ` p50 ${m.select.p50} ms   p95 ${m.select.p95} ms   max ${m.select.max} ms`,
  row(`Orbit, solid surface (${m.orbit.frames} frames):`, m.orbit),
  row(`Orbit, X-ray: glass shell + inner bodies (${m.orbitXray.frames} frames):`, m.orbitXray),
  row(`Orbit, slice with the MRI on the cut (${m.orbitSlice.frames} frames):`, m.orbitSlice),
  row(`Neurons scene playing (${m.neurons.frames} frames):`, m.neurons),
  row(`Decoder scene playing (${m.decoder.frames} frames):`, m.decoder),
  `Idle, no input for ${m.idle.seconds} s: ${m.idle.framesRendered} frames rendered while the display ticked ${m.idle.rafTicks} times (demand rendering)`,
  `First opening of the Regions view (border fields for the whole surface): ${m.parcelsMs} ms`,
  `First opening of the Slice view (fetch + inflate + upload two volumes): ${m.sliceMs} ms`,
  `Picking acceleration (BVH for the surface and all ${m.structures} bodies) built in ${m.bvhBuildMs} ms, in idle slices after first paint`,
];
const lines = [
  `# Studio performance — measured ${new Date().toISOString()}`,
  '',
  'These are measurements on ONE machine in ONE run, with a visible Chrome window. They are not guarantees for other',
  'hardware, browsers, window sizes or system load. Targets from the brief: hover feedback within 100 ms; near 60 fps.',
  '',
  '## Conditions',
  `Machine: ${hw || 'unknown CPU'}`,
  `Browser: ${full.ua}`,
  `WebGL renderer: ${full.renderer}`,
  `Scene: one continuous surface of ${full.surfaceTriangles.toLocaleString()} triangles (one draw call); ${full.structures} atlas bodies (${full.innerTriangles.toLocaleString()} triangles) drawn only when revealed; production build`,
  '',
  '## Profile A — this machine as it is',
  ...block(full),
  '',
  '## Profile B — constrained: CPU slowed 4× by the browser’s throttle, 1280 × 720 window',
  'This emulates a slower CPU on the same GPU. It is NOT a measurement of a low-end laptop or a phone: GPU speed,',
  'memory and thermal limits are unchanged. Read it as “what happens to the script-bound parts when the CPU is 4× slower”.',
  ...block(slow),
  '',
  '## Payload (production build, uncompressed on disk; a server that gzips would send less)',
  `Brain at first paint (manifest, surface, four body chunks): ${kb(first)}   — transferred in this run: ${kb(full.payload.atlas)} including the slice volumes`,
  `Slice volumes (MRI + region ids, gzip; fetched when the Slice view is first opened): ${kb(slices)}`,
  `Home-screen JavaScript (index chunk): ${kb(idx)}   — all JavaScript transferred for the home screen: ${kb(full.payload.js)}`,
  `The existing chip studio (${kb(files.filter((x) => /^App-.*\.js$/.test(x.f)).reduce((a, x) => a + x.n, 0))}) and the other scenes load only when opened.`,
  '',
  '## Memory',
  `JavaScript heap after the measurements above: ${full.memory.jsHeapMB ?? 'not reported by this browser'} MB`,
  `Vertex + index buffers handed to the GPU: about ${full.memory.geometryMB} MB (computed from the manifests; GPU memory itself is not observable from the page)`,
  '',
  '## Limits of this measurement',
  '- One run, one machine, one display. No integrated-GPU laptop and no physical phone was measured; Profile B only slows the CPU.',
  '- Frame time is the interval between animation frames, so it cannot be shorter than the display refresh interval.',
  '- "Hover feedback" is measured from a synthetic pointer event to two animation frames later, which bounds the time to a presented frame from above.',
  '- The headless end-to-end run (docs/evidence/e2e-report.txt) is functional evidence only and is not a performance figure.',
  '- Before this rebuild: docs/evidence/cinematic/baseline/performance-before.txt (different scene, same machine).',
];
mkdirSync(join(root, 'docs/evidence'), { recursive: true });
writeFileSync(join(root, 'docs/evidence/performance.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(0);
