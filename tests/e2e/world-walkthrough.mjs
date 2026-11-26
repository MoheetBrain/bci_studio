// One continuous screen recording of the world (production build), for review:
// whole brain → going in → flying the craft beside a reconstructed neuron → pointing at a branch (the whole neuron
// answers) → Inspect, isolate, return → the circuit: one cause changed where it is, replay → contacts P1 and P2 placed
// → P1 moved (by its arrow, then by exact steps) while P2 stays: same spikes, same noise, a different recording →
// undo/redo → flying away → the electrode array and Decoder Pilot → out to the brain, back in, and a reload: the
// contacts are where they were left.
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
await page.evaluate(() => { localStorage.removeItem('hbci.world.journey.v1'); localStorage.removeItem('hbci.world.journey.v2'); localStorage.removeItem('hbci.world.pad'); });
await page.reload();
await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 });
await wait(900);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 84, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 });
await wait(900);
const scr = (p) => page.evaluate((q) => window.__world.screenOf(q), p);
/** Screen points along the branches of one thing in the scene (in view, not under a panel, and really the nearest thing there). */
const along = (kind, id, n) => page.evaluate(({ kind, id, n }) => {
  const W = window.__world, c = W.controller, b = c.bodies.find((x) => x.kind === kind && x.id === id), out = [];
  if (!b?.segs) return out;
  const r = document.querySelector('[data-testid="world-view"] canvas').getBoundingClientRect(), m = b.segs.length / 7;
  for (let i = 0; i < m && out.length < n; i += Math.max(1, Math.floor(m / 400))) {
    const s = W.screenOf([(b.segs[i * 7] + b.segs[i * 7 + 3]) / 2, (b.segs[i * 7 + 1] + b.segs[i * 7 + 4]) / 2, (b.segs[i * 7 + 2] + b.segs[i * 7 + 5]) / 2]);
    if (!s.visible || s.x < 260 || s.x > r.right - 330 || s.y < 110 || s.y > r.bottom - 90) continue;
    if (out.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 90)) continue;
    const h = c.hitAt(((s.x - r.left) / r.width) * 2 - 1, 1 - ((s.y - r.top) / r.height) * 2);
    if (h?.id === id && document.elementFromPoint(s.x, s.y)?.closest('[data-world-view]')) out.push({ x: s.x, y: s.y });
  }
  return out;
}, { kind, id, n });

// THE BRAIN — turn it, then go in where the glow is
await drag(520, 330, 690, 300); await wait(900);
await page.evaluate(() => window.__brain.api.home()); await wait(900);
const way = await page.evaluate(() => window.__brain.api.screenOf('left_precentral_gyrus'));
if (way) { await glide(way.x, way.y); await wait(700); await page.mouse.click(way.x, way.y); await wait(1500); }
await click('region-enter');
await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 });
// ARRIVE — the craft comes down beside the reconstructed neuron
await settle(); await wait(1800);
// FLY — the keys move the craft; the camera follows; look by dragging; look out of the craft and back
await world();
await hold('KeyW', 900); await drag(700, 300, 610, 320); await hold('KeyA', 600); await hold('KeyE', 450); await drag(640, 320, 720, 300); await wait(400);
await page.keyboard.press('KeyV'); await wait(1500); await drag(640, 300, 560, 310); await wait(600); await page.keyboard.press('KeyV'); await settle(); await wait(700);
// POINT — any branch of the neuron: the whole neuron lights, and says what it is
await page.evaluate(() => { const c = window.__world.controller; c.glideTo({ pos: [96, 44, 440], yaw: 0.42, pitch: -0.06 }, false); }); await settle(); await wait(500);
const twigs = await along('context', 'h01', 4);
for (const t of twigs) { await glide(t.x, t.y); await wait(900); }
if (twigs.length) { await page.mouse.click(twigs[twigs.length - 1].x, twigs[twigs.length - 1].y); await wait(2200); }
// selecting did not stop the flying
await world(); await hold('KeyD', 500); await wait(400);
// INSPECT — the camera leaves the craft to look at all of it; isolate it; bring the tissue back; return to the craft
await click('card-focus'); await settle(); await wait(900);
await drag(700, 330, 560, 300, 34); await wait(700);
await click('card-isolate'); await wait(2200);
await drag(620, 320, 760, 350, 34); await wait(900);
await click('card-isolate'); await wait(900);
await page.keyboard.press('KeyR'); await settle(); await wait(700);
await page.keyboard.press('Escape'); await wait(300);
// THE CIRCUIT — the craft flies itself there; one whole replay: T does not fire
await page.selectOption(T('goto'), 'circuit'); await settle(); await wait(700);
await click('t-replay'); await wait(6800);
// ONE CAUSE, WHERE IT IS — input cell B, 8 ms earlier: T fires
const bAt = await scr(await page.evaluate(() => window.__journey.spec.cells.find((c) => c.id === 'B').pos));
await glide(bAt.x, bAt.y); await wait(700); await page.mouse.click(bAt.x, bAt.y); await wait(1100);
await click('bMs-earlier4'); await wait(700); await click('bMs-earlier4'); await wait(6200);
await page.keyboard.press('Escape'); await wait(300);
// PLACE — P1 just outside T, P2 further away
await click('contact-P1'); await wait(500);
const tAt = await scr(await page.evaluate(() => window.__journey.spec.cells.find((c) => c.id === 'T').pos));
await glide(tAt.x - 160, tAt.y + 60); await wait(700); await glide(tAt.x + 4, tAt.y - 2); await wait(1500);
await page.mouse.click(tAt.x + 4, tAt.y - 2); await wait(1600);
await click('contact-P2'); await wait(500);
const open = await page.evaluate(() => { const c = window.__world.controller, r = document.querySelector('[data-testid="world-view"] canvas').getBoundingClientRect(); for (let y = 0.34; y < 0.7; y += 0.04) for (let x = 0.28; x < 0.5; x += 0.03) { const px = r.left + x * r.width, py = r.top + y * r.height; if (document.elementFromPoint(px, py)?.closest('[data-world-view]') && !c.hitAt(x * 2 - 1, 1 - y * 2)) return { x: px, y: py }; } return { x: r.left + r.width * 0.36, y: r.top + r.height * 0.5 }; });
await glide(open.x, open.y); await wait(1300); await page.mouse.click(open.x, open.y); await wait(1500);
await click('t-replay'); await wait(5200);
// MOVE — keep this layout as the baseline; slide P1 along its arrow, then by exact steps towards T. P2 is not touched.
await click('guide-act').catch(() => click('t-keep')); await wait(900);
await click('contact-P1'); await wait(900);
const h = await page.evaluate(() => { const W = window.__world, b = W.controller.bodies.find((x) => x.kind === 'handle' && x.id === 'P1:x'); if (!b) return null; const s = b.segs; return { a: W.screenOf([s[0] * 0.2 + s[3] * 0.8, s[1], s[2]]), e: W.screenOf([s[3], s[4], s[5]]) }; });
if (h) {
  const dx = Math.sign(h.e.x - h.a.x) || 1, slope = (h.e.y - h.a.y) / Math.max(1, Math.abs(h.e.x - h.a.x));
  await glide(h.a.x, h.a.y); await wait(900); await page.mouse.down();
  for (let i = 1; i <= 40; i++) { await page.mouse.move(h.a.x + dx * i * 3.2, h.a.y + slope * i * 3.2); await wait(45); }
  await wait(900); await page.mouse.up(); await wait(2400);
}
await page.selectOption(T('nudge-ref'), 'T'); await wait(500);
for (let i = 0; i < 5; i++) { await click('nudge-nearer'); await wait(650); }
await wait(1500); await click('t-replay'); await wait(4200);
await click('t-undo'); await wait(900); await click('t-undo'); await wait(900); await click('t-redo'); await wait(700); await click('t-redo'); await wait(1200);
await page.keyboard.press('Escape'); await wait(300);
// LEAVE THEM — fly away; the overview shows where everything is; back to the craft
await world(); await hold('KeyS', 1300); await hold('KeyE', 500); await drag(640, 300, 700, 330); await wait(700);
await page.keyboard.press('KeyM'); await settle(); await wait(2600);
await page.keyboard.press('KeyR'); await settle(); await wait(700);
// THE ARRAY — a different model, declared; Decoder Pilot: the keys are the intent and the craft holds still
await page.selectOption(T('goto'), 'array'); await settle(); await wait(1600);
await click('declare-ok');
await page.waitForFunction(() => window.__task.store.getState().status === 'ready' && window.__task.store.getState().info?.calibration, null, { timeout: 30000 });
await settle(); await wait(700);
await click('t-pilot'); await settle(); await wait(700);
await world(); await steer(8500);
await page.keyboard.press('Escape'); await wait(700);
await world(); await hold('KeyW', 600); await wait(500);                 // Explore again: the same keys fly the craft
// RETURN — out to the brain, back in: the craft and the contacts are where they were left
await click('map');
await page.waitForSelector(`${T('journey')}[data-place="brain"]`, { timeout: 12000 }); await wait(2200);
await click('resume');
await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 }); await settle(); await wait(900);
await page.selectOption(T('goto'), 'circuit'); await settle(); await wait(1600);
// …and after the page is loaded again
await wait(600); await page.reload();
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 84, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 }).catch(() => {});   // a reload may end the screencast: ask again (the same take continues)
await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(1500);
await click('resume');
await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 }); await settle(); await wait(900);
await page.selectOption(T('goto'), 'P1'); await settle(); await wait(3200);
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
