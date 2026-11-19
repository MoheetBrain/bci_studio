// A short screen recording of real interaction with the running application (production build), for review.
//
//   npm run build && node tests/e2e/record.mjs
//
// Writes docs/evidence/cinematic/interaction.mp4 (1280 × 720). Frames come from the browser's own screencast of the
// page (Chrome DevTools Protocol) and are joined, untouched, by the ffmpeg already installed on this machine; nothing
// is composited or edited. The screencast does not draw the pointer, so a small dot is injected to show it.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5196, BASE = `http://127.0.0.1:${PORT}`;
const outDir = join(root, 'docs/evidence/cinematic'), tmp = join(outDir, '_video');
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal', '--window-size=1280,807'] });   // 807: leaves a 720 px page in headless Chrome
const ctx = await browser.newContext({ viewport: null });   // the screencast records the real window, so no emulated viewport
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:99999;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 2px rgba(0,0,0,.45);pointer-events:none;left:-40px;top:-40px';
    document.body.appendChild(d);
    addEventListener('pointermove', (e) => { d.style.left = `${e.clientX}px`; d.style.top = `${e.clientY}px`; }, true);
  });
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', (f) => {
  const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(join(tmp, name), Buffer.from(f.data, 'base64'));
  frames.push({ name, t: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
const T = (id) => `[data-testid="${id}"]`;
const wait = (ms) => page.waitForTimeout(ms);
const glide = async (x, y, steps = 24) => { await page.mouse.move(x, y, { steps }); };
const point = (id) => page.evaluate((i) => window.__atlas.screenPointOf(i), id);

await page.goto(BASE);
await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
await wait(600);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 2 });
await wait(1400);
// orbit by dragging
await glide(520, 380); await page.mouse.down(); await glide(700, 350, 40); await glide(560, 400, 40); await page.mouse.up(); await wait(400);
// hover a few regions
for (const id of ['left_superior_frontal_gyrus', 'left_postcentral_gyrus', 'left_superior_temporal_gyrus', 'left_precentral_gyrus']) { const p = await point(id); if (p) { await glide(p.x, p.y, 30); await wait(650); } }
// select
await page.mouse.down(); await page.mouse.up(); await wait(1900);
// X-ray, regions, slice, back
for (const m of ['xray', 'parcels', 'slice', 'solid']) { const b = await page.locator(T(`mode-${m}`)).boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2, 18); await page.mouse.down(); await page.mouse.up(); await wait(m === 'slice' ? 2000 : 1500); }
// dive into the neurons
{ const b = await page.locator(T('to-interface')).boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2, 24); await page.mouse.down(); await page.mouse.up(); }
await page.waitForSelector(`${T('interface-workspace')} canvas`); await wait(4200);
// move the electrode away
{ const b = await page.locator(T('knob-distance')).boundingBox(); await glide(b.x + b.width * 0.22, b.y + b.height / 2, 20); await page.mouse.down(); await glide(b.x + b.width * 0.72, b.y + b.height / 2, 40); await page.mouse.up(); await wait(2200); }
// on to the decoder
await page.goto(`${BASE}/#/decoder`); await page.waitForSelector(T('decoder-diagram')); await wait(4500);
await cdp.send('Page.stopScreencast');
await wait(200);
await ctx.close();
await browser.close();

if (frames.length < 30) { console.error(`only ${frames.length} frames were captured`); process.exit(1); }
// each frame is shown until the next one arrives (the screencast only sends a frame when the page changes)
const list = frames.map((f, i) => `file '${f.name}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].name}'\n`;
writeFileSync(join(tmp, 'list.txt'), list);
const out = join(outDir, 'interaction.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', out]);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote docs/evidence/cinematic/interaction.mp4: ${frames.length} screencast frames over ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s, ${(statSync(out).size / 1048576).toFixed(1)} MB`);
process.exit(0);
