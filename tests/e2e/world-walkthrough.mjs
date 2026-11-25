// One continuous screen recording of the integrated world (production build), for review:
// whole brain → going in → flight → changing one cause → replay and comparison → the probe → the electrode array →
// the decoder task, broken and recovered → back out to the brain.
//
//   npm run build && node tests/e2e/world-walkthrough.mjs
//
// Writes docs/evidence/world/video/world-walkthrough.mp4 (1280 × 800). The frames come from the browser's own
// screencast of the page (Chrome DevTools Protocol) while a script presses keys and moves the pointer; they are joined,
// untouched, by the ffmpeg already installed on this machine. Nothing is composited or edited, and it is ONE take.
// The screencast does not draw the pointer, so the page draws a small ring where the pointer is.
//
// A recording shows that movement, intervention, replay, comparison and decoder control work together. It does not
// show that the experience is enjoyable — only a person playing can show that.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5194, BASE = `http://127.0.0.1:${PORT}`;
const outDir = join(root, 'docs/evidence/world/video'), tmp = join(outDir, '_tmp');
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal', '--window-size=1280,887'] });   // 887: leaves an 800 px page in headless Chrome
const T = (id) => `[data-testid="${id}"]`;
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const ctx = await browser.newContext({ viewport: null });   // the screencast records the real window, so no emulated viewport
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page), frames = [];
cdp.on('Page.screencastFrame', (f) => {
  const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(join(tmp, file), Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await page.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:99999;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #000;pointer-events:none;left:-99px;top:-99px';
    document.body.appendChild(d);
    addEventListener('pointermove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    addEventListener('pointerdown', () => { d.style.background = 'rgba(127,231,255,.7)'; }, true);
    addEventListener('pointerup', () => { d.style.background = 'none'; }, true);
  });
});
const wait = (ms) => page.waitForTimeout(ms), hold = async (k, ms) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); };
const drag = async (x0, y0, x1, y1, steps = 26) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up(); };
const glide = async (x, y) => { await page.mouse.move(x, y, { steps: 18 }); };
const click = async (id) => { const b = await page.locator(T(id)).first().boundingBox(); if (b) await glide(b.x + b.width / 2, b.y + b.height / 2); await wait(180); await page.click(T(id)); };
const settle = () => page.waitForFunction(() => !window.__world.controller.transitioning, null, { timeout: 8000 });
const world = () => page.evaluate(() => document.querySelector('[data-world-view]').focus());
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

await page.goto(`${BASE}/#/world`);
await page.evaluate(() => { localStorage.removeItem('hbci.world.journey.v1'); localStorage.removeItem('hbci.world.pad'); });
await page.reload();
await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 });
await wait(900);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 84, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 });
await wait(900);

// ARRIVE — turn the brain, name a region, come back to the way in
await drag(520, 330, 700, 300); await wait(1100);
await drag(700, 300, 600, 360); await wait(900);
await page.evaluate(() => window.__brain.api.home()); await wait(1000);
const other = await page.evaluate(() => window.__brain.api.screenOf('left_superior_temporal_gyrus'));
if (other) { await glide(other.x, other.y); await wait(900); await page.mouse.click(other.x, other.y); await wait(1500); await page.keyboard.press('Escape'); }
const way = await page.evaluate(() => window.__brain.api.screenOf('left_precentral_gyrus'));
if (way) { await glide(way.x, way.y); await wait(800); await page.mouse.click(way.x, way.y); await wait(1700); }
// ENTER
await click('region-enter');
await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 });
await settle(); await wait(1600);
// EXPLORE — fly and look; the model keeps running; pause it and keep moving
await world();
await hold('KeyW', 1500); await drag(640, 260, 560, 290); await hold('KeyD', 700); await hold('KeyW', 600); await wait(500);
await page.mouse.move(640, 300); await page.mouse.wheel(0, -200); await wait(900);
await page.keyboard.press('Space'); await wait(500); await hold('KeyA', 700); await drag(600, 280, 690, 260); await wait(500); await page.keyboard.press('Space');
// NOTICE — the target cell, and one whole replay
await page.selectOption(T('goto'), 'T'); await settle(); await wait(900);
await click('t-replay'); await wait(7200);
await page.keyboard.press('KeyR'); await settle(); await wait(500);
// CHANGE — one cause: when input B fires
await page.selectOption(T('goto'), 'B'); await settle(); await wait(900);
await click('bMs-earlier4'); await wait(700); await click('bMs-earlier4'); await wait(1200);
await page.keyboard.press('KeyR'); await settle(); await wait(5200);
// COMPARE — the linked trace against the baseline; then a second cause, undone
await page.selectOption(T('goto'), 'T'); await settle(); await wait(2600);
const tr = await page.locator(T('trace')).boundingBox();
if (tr) { await drag(tr.x + tr.width * 0.42, tr.y + tr.height * 0.55, tr.x + tr.width * 0.30, tr.y + tr.height * 0.55, 30); await wait(900); }
await click('t-replay'); await wait(3200);
await page.selectOption(T('goto'), 'I'); await settle(); await wait(700);
await click('card-inhibit'); await wait(5200);
await click('t-undo'); await wait(2600);
// RECORD — what an electrode sees
await page.selectOption(T('goto'), 'probe'); await settle(); await wait(1200);
await click('t-replay'); await wait(4800);
await page.keyboard.press('KeyR'); await settle(); await wait(400);
// ENGINEER — the array: a different model, declared; then the control task
await page.selectOption(T('goto'), 'array'); await settle(); await wait(2400);
await click('declare-ok');
await page.waitForFunction(() => window.__task.store.getState().status === 'ready' && window.__task.store.getState().info?.calibration, null, { timeout: 20000 });
await wait(900);
await world(); await hold('KeyW', 500); await drag(560, 300, 640, 280); await wait(600);   // still an observer: the keys fly
await click('t-pilot'); await settle(); await wait(700);
await world(); await steer(9000);
await click('t-fault-lost'); await world(); await steer(8000);                       // three contacts lost
await click('dec-kalman'); await world(); await steer(8000);                          // way back 1: another decoder, nothing refitted
await click('dec-linear'); await click('t-calibrate'); await wait(1100); await world(); await steer(7500);   // way back 2: recalibrate
await page.keyboard.press('Escape'); await wait(900);
// RETURN — back out; the experiment is still there
await click('map');
await page.waitForSelector(`${T('journey')}[data-place="brain"]`, { timeout: 12000 }); await wait(2600);
await cdp.send('Page.stopScreencast'); await wait(200);
await ctx.close(); await browser.close();

if (frames.length < 200) { console.error(`only ${frames.length} frames were captured`); process.exit(1); }
// each frame is shown until the next one arrives (the screencast only sends a frame when the page changes)
writeFileSync(join(tmp, 'list.txt'), frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`);
const out = join(outDir, 'world-walkthrough.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', out]);
rmSync(tmp, { recursive: true, force: true });
console.log(`world-walkthrough.mp4  ${frames.length} screencast frames over ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s, ${(statSync(out).size / 1048576).toFixed(1)} MB`);
process.exit(0);
