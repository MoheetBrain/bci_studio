// Three short screen recordings of real interaction with the running toys (production build), for review.
//
//   npm run build && node tests/e2e/neuroverse-walkthrough.mjs
//
// Writes docs/evidence/neuroverse/video/toy-a-instrument-flight.mp4, toy-b-time-workshop.mp4 and
// toy-c-decoder-pilot.mp4 (1280 × 800). Frames come from the browser's own screencast of the page (Chrome DevTools
// Protocol) while a script presses keys and moves the pointer, and are joined, untouched, by the ffmpeg already
// installed on this machine; nothing is composited or edited. The screencast does not draw the pointer, so the page
// draws a small ring where the pointer is.
//
// A recording shows that movement, an intervention and its consequence work together. It does not show that the
// experience is enjoyable — only a person playing can show that.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5195, BASE = `http://127.0.0.1:${PORT}`;
const outDir = join(root, 'docs/evidence/neuroverse/video'), tmp = join(outDir, '_tmp');
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal', '--window-size=1280,887'] });   // 887: leaves an 800 px page in headless Chrome
const T = (id) => `[data-testid="${id}"]`;

async function record(name, toy, readySel, script) {
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
  const blur = () => page.evaluate(() => document.activeElement?.blur?.());
  const drag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 24 }); await page.mouse.up(); };
  await page.goto(`${BASE}/#/world/${toy}`);
  await page.waitForSelector(readySel, { timeout: 30000 });
  await page.waitForFunction(() => window.__world?.store.getState().ready && window.__world.rt.frames > 5, null, { timeout: 30000 });
  await wait(600);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 86, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 });
  await wait(500);
  await script({ page, wait, hold, blur, drag });
  await wait(600);
  await cdp.send('Page.stopScreencast'); await wait(200);
  await ctx.close();
  if (frames.length < 30) throw new Error(`${name}: only ${frames.length} frames were captured`);
  // each frame is shown until the next one arrives (the screencast only sends a frame when the page changes)
  writeFileSync(join(tmp, 'list.txt'), frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`);
  const out = join(outDir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${name}.mp4  ${frames.length} screencast frames over ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s, ${(statSync(out).size / 1048576).toFixed(1)} MB`);
}

await record('toy-b-time-workshop', 'workshop', T('workshop'), async ({ page, wait, hold, blur, drag }) => {
  await wait(3200);                                            // the default run: B comes 12 ms after A and T stays short
  await drag(640, 200, 520, 230); await hold('KeyW', 900); await hold('KeyD', 500); await wait(300);
  await page.click(T('t-compare'));                            // keep that run as the baseline
  await page.fill(T('wk-b-num'), '14'); await blur();          // bring B to 4 ms after A
  await wait(4600);                                            // T fires, D follows; the baseline stays dashed
  await page.check(T('wk-inhibit')); await blur(); await wait(4200);     // inhibition on: the same timing no longer works
  const box = await page.locator(T('wk-timeline')).boundingBox(), xOf = (ms) => box.x + 64 + (ms / 60) * (box.width - 64 - 14);
  await drag(xOf(14), box.y + 8, xOf(7), box.y + 8);           // drag B to before A
  await wait(4200);
  await page.keyboard.press('KeyM'); await wait(1600); await drag(640, 220, 760, 260); await wait(700);
  await page.keyboard.press('KeyR'); await wait(900);
  await page.selectOption(T('goto'), 'T'); await blur(); await wait(1600);
  await page.keyboard.press('KeyR'); await wait(900);
});

await record('toy-a-instrument-flight', 'flight', T('flight'), async ({ page, wait, hold, blur, drag }) => {
  await wait(1500);
  await hold('KeyW', 1400); await drag(640, 220, 560, 250); await hold('KeyW', 700); await wait(300);
  // go to the cell that (the script knows) leads, the way a player would after listening around: focus it, then fly in
  const lead = await page.evaluate(() => { const r = window.__flight.eng.run; return r.circuit.cells[r.truth.driver].id; });
  const other = await page.evaluate(() => { const r = window.__flight.eng.run; return r.circuit.cells[r.truth.independents[0]].id; });
  await page.selectOption(T('goto'), other); await blur(); await wait(1500);
  await page.click(T('btn-fly-here')); await hold('KeyW', 450); await wait(200);
  await page.keyboard.press('KeyC'); await wait(3200);        // contact 1 near a cell that takes no part
  await page.click(T('fl-slot-2'));
  await page.selectOption(T('goto'), lead); await blur(); await wait(1500);
  await page.click(T('btn-fly-here')); await hold('KeyW', 450); await wait(200);
  await page.keyboard.press('KeyC'); await wait(3200);        // contact 2 near the leader
  await page.click(T('t-compare')); await wait(600);          // keep this window
  await page.click(T('fl-silence')); await wait(4200);        // silence it: the wave stops
  await page.click(T('fl-guess')); await wait(900);           // name it: the wiring is drawn
  await page.keyboard.press('KeyM'); await wait(1500); await drag(640, 220, 760, 250); await wait(1500);
  await page.keyboard.press('KeyR'); await wait(800);
});

await record('toy-c-decoder-pilot', 'pilot', `${T('pilot')}[data-status="ready"][data-calibration="1"]`, async ({ page, wait, hold, blur, drag }) => {
  const steer = async (ms) => {
    const end = Date.now() + ms; let held = new Set();
    while (Date.now() < end) {
      const s = await page.evaluate(() => { const c = window.__pilot.eng.cur; return c ? { c: c.cursor, t: c.target } : null; }), want = new Set();
      if (s) { const dx = s.t[0] - s.c[0], dy = s.t[1] - s.c[1], d = Math.hypot(dx, dy); if (d > 0.1) { if (Math.abs(dx) > 0.38 * d) want.add(dx > 0 ? 'KeyD' : 'KeyA'); if (Math.abs(dy) > 0.38 * d) want.add(dy > 0 ? 'KeyW' : 'KeyS'); } }
      for (const k of held) if (!want.has(k)) await page.keyboard.up(k);
      for (const k of want) if (!held.has(k)) await page.keyboard.down(k);
      held = want; await wait(50);
    }
    for (const k of held) await page.keyboard.up(k);
  };
  await blur(); await hold('KeyW', 800); await drag(640, 220, 720, 240); await wait(500);   // Explore: the keys fly the rig
  await page.keyboard.press('KeyP'); await wait(1200);                                    // Pilot: the keys are the intent
  await steer(9000);
  await page.click(T('pl-fault-lost')); await blur(); await steer(8000);                     // three contacts lost
  await page.click(T('pl-dec-kalman')); await blur(); await steer(8000);                     // way back 1: another decoder
  await page.click(T('pl-dec-linear')); await page.click(T('pl-calibrate')); await blur(); await wait(900); await steer(7000);   // way back 2: recalibrate
  await page.keyboard.press('Escape'); await wait(1000);
});

await browser.close();
process.exit(0);
