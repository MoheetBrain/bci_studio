// End-to-end acceptance test of the Neuroverse toys, in a real Chrome against the production build.
//
//   npm run build && node tests/e2e/neuroverse.mjs            (HEADED=1 to watch)
//
// Each step does what a player would do (keys, pointer, buttons) and asserts on what the application itself reports:
// the rig's pose, the model's state and fingerprints, the text on screen. It writes
// docs/evidence/neuroverse/e2e-report.txt and docs/evidence/neuroverse/screens/*.png.
//
// What this suite can and cannot establish: that the controls and the models behave as documented. It says nothing
// about whether a person enjoys a toy or learns from it — that needs the playtest in docs/NEUROVERSE_PLAYTEST.md.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5197, BASE = `http://127.0.0.1:${PORT}`;
const out = join(root, 'docs/evidence/neuroverse'), shots = join(out, 'screens');
mkdirSync(shots, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }

const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
  if (i === 59) { console.error('preview server did not start:\n' + serverLog); process.exit(2); }
}

const results = [], consoleErrors = [], notes = [];
const step = async (name, fn) => {
  // ONLY=A (or B, C) runs one toy's steps, for debugging; a full run is what the report is written from
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const t0 = Date.now();
  try { const info = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, info: info ?? '' }); console.log(`✓ ${name}${info ? ` — ${info}` : ''}`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, info: String(e?.message ?? e).split('\n')[0] }); console.log(`✗ ${name} — ${String(e?.message ?? e).split('\n')[0]}`); try { await page.screenshot({ path: join(shots, `FAILED-${results.length}.png`) }); } catch { /* no page */ } }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol, msg) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg}: ${a} vs ${b} (tolerance ${tol})`); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const T = (id) => `[data-testid="${id}"]`;
const txt = (id) => page.locator(T(id)).first().innerText();
const attr = (id, a) => page.locator(T(id)).first().getAttribute(a);
const wait = (ms) => page.waitForTimeout(ms);
const pose = () => page.evaluate(() => window.__world.controller.pose());
const view = () => page.evaluate(() => window.__world.controller.view());
const setPose = (p) => page.evaluate((q) => { const c = window.__world.controller; c.flyFromHere(); c.setPose(q); }, p);
const screenOf = (p) => page.evaluate((q) => window.__world.screenOf(q), p);
const sel = () => page.evaluate(() => window.__world.store.getState().selected);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
/** Back to the default keys and travel speed, so that a failed step cannot spoil the next. */
const resetControls = () => page.evaluate(() => { const w = window.__world; if (!w) return; w.controller.setKeys({ ...w.defaultKeys }); w.controller.s.speedLevel = 3; w.controller.s.vel = [0, 0, 0]; if (w.controller.context !== 'explore') w.controller.setContext('explore'); w.store.getState().setPanel(null); });
const openToy = async (id, ready) => { await resetControls(); await page.goto(`${BASE}/#/world`); await page.waitForSelector(T('world-chooser')); await page.click(T(`toy-${id}`)); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForFunction(() => window.__world?.store.getState().ready && window.__world.rt.frames > 5, null, { timeout: 20000 }); await wait(400); };
/** Click on empty scene so that the page (not a form control) has the keyboard. */
const focusScene = async () => { await page.evaluate(() => document.activeElement?.blur?.()); };
const viewShare = () => page.evaluate(() => document.querySelector('[data-testid="world-view"]').getBoundingClientRect().height / innerHeight);

/** Leave the Time workshop paused in the middle of a run (Space at the end of a run would restart it instead). */
const pauseWorkshop = async () => { await page.click(T('t-replay')); await wait(400); await page.keyboard.press('Space'); await wait(120); eq(await attr('world', 'data-paused'), '1', 'Space paused the model (a button clicked with the mouse does not keep the keyboard)'); };

// ══ entry ═══════════════════════════════════════════════════════════════════════════════════════════════════════
await step('entry: the chooser offers three toys; the classic studio is one click away and unchanged; the brain has a way in', async () => {
  await page.goto(`${BASE}/#/world`);
  await page.waitForSelector(T('world-chooser'));
  for (const t of ['flight', 'workshop', 'pilot']) assert(await page.locator(T(`toy-${t}`)).isVisible(), `toy ${t} is offered`);
  assert(/→/.test(await txt('world-order')), 'a suggested order is shown');
  assert(!(await page.locator('.shell-bar').isVisible()), 'the classic dock is hidden inside the world');
  await shot('01-chooser');
  await page.click(T('chooser-classic'));
  await page.waitForSelector(T('atlas-viewport'), { timeout: 20000 });
  for (const n of ['world', 'brain', 'experiment', 'interface', 'signal', 'chip', 'decoder', 'research']) assert(await page.locator(T(`nav-${n}`)).count() === 1, `dock entry ${n}`);
  await page.waitForSelector(T('enter-world'), { timeout: 30000 });
  await page.click(T('enter-world'));
  await page.waitForSelector(T('world-chooser'));
  return 'chooser ↔ classic studio; all seven classic scenes still in the dock';
});

// ══ Toy B · Time workshop (also carries the shared control checks) ═════════════════════════════════════════════════
let t0load = 0;
await step('B · agency within ten seconds: the scene is ready and a key moves the rig', async () => {
  t0load = Date.now();
  await openToy('workshop', T('workshop'));
  const readyMs = Date.now() - t0load, p0 = await pose();
  await focusScene();
  await hold('KeyW', 350);
  const p1 = await pose(), moved = dist(p0.pos, p1.pos);
  assert(moved > 5, `W moved the rig ${moved.toFixed(1)} µm`);
  assert(readyMs < 10000, `ready after ${readyMs} ms`);
  const share = await viewShare();
  assert(share >= 0.74, `the 3D view takes ${(share * 100).toFixed(0)} % of the height`);
  await shot('02-workshop');
  return `ready ${readyMs} ms after opening; first key press moved the rig ${moved.toFixed(0)} µm; the world takes ${(share * 100).toFixed(0)} % of the screen height`;
});

await step('B · flight: forward follows the view, keys released means stopped, Shift brakes sooner, E rises, the wheel changes speed not scale', async () => {
  await setPose({ pos: [0, 40, 320], yaw: 0, pitch: 0 }); await focusScene();
  await hold('KeyW', 600);
  const a = await pose();
  assert(a.pos[2] < 320 - 30 && Math.abs(a.pos[0]) < 1e-6 && Math.abs(a.pos[1] - 40) < 1e-6, `forward is −z: ${a.pos.map((v) => v.toFixed(1))}`);
  await wait(750);
  const b = await pose(); await wait(250); const c = await pose();
  eq(dist(b.pos, c.pos), 0, 'no drift after releasing the keys');
  // braking: fly, then compare the coasting distance with and without the brake
  const coast = async (brake) => { await setPose({ pos: [0, 40, 320], yaw: 0, pitch: 0 }); await page.keyboard.down('KeyW'); await wait(500); const p = await pose(); await page.keyboard.up('KeyW'); if (brake) await page.keyboard.down('ShiftLeft'); await wait(350); if (brake) await page.keyboard.up('ShiftLeft'); return dist(p.pos, (await pose()).pos); };
  const free = await coast(false), braked = await coast(true);
  assert(braked < free * 0.75, `braking distance ${braked.toFixed(1)} µm vs ${free.toFixed(1)} µm without`);
  await setPose({ pos: [0, 40, 320], yaw: 0, pitch: 0 });
  await hold('KeyE', 400);
  const up = await pose();
  assert(up.pos[1] > 50 && Math.abs(up.pos[2] - 320) < 1e-6, 'E goes straight up');
  const lv0 = (await view()).speedLevel;
  await page.mouse.move(720, 300); await page.mouse.wheel(0, -200); await wait(120);
  const lv1 = (await view()).speedLevel;
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -200);
  await wait(120);
  const lvMax = (await view()).speedLevel;
  assert(lv1 > lv0 && lvMax === 5, `speed level ${lv0} → ${lv1} → capped at ${lvMax}`);
  near((await pose()).pos[2], 320, 1e-6, 'the wheel did not move the rig or change the scale');
  await page.mouse.wheel(0, 100); await wait(120);
  eq((await view()).speedLevel, 4, 'one wheel notch down is one level down');
  await resetControls();
  return `stop without drift; braking distance ${braked.toFixed(0)} µm vs ${free.toFixed(0)} µm; speed levels bounded (15–480 µm/s)`;
});

await step('B · looking and selecting without capture: a drag turns the view and selects nothing; a click selects the cell under the pointer', async () => {
  await setPose({ pos: [28, 46, 318], yaw: 0, pitch: -0.12 }); await page.evaluate(() => window.__world.store.getState().select(null));
  const p0 = await pose();
  await page.mouse.move(700, 150); await page.mouse.down(); await page.mouse.move(820, 190, { steps: 10 }); await page.mouse.up(); await wait(120);
  const p1 = await pose();
  assert(Math.abs(p1.yaw - p0.yaw) > 0.1 && dist(p0.pos, p1.pos) === 0, 'the drag turned the view and did not move the rig');
  eq(await sel(), null, 'a drag selects nothing');
  await setPose({ pos: [28, 46, 318], yaw: 0, pitch: -0.12 }); await wait(150);
  const tPos = await page.evaluate(() => window.__world.rt.spec.cells.find((c) => c.id === 'T').pos), s = await screenOf(tPos);
  assert(s.visible, 'the target cell is in view');
  await page.mouse.click(s.x, s.y); await wait(150);
  eq((await sel())?.id, 'T', 'the click selected the cell under the pointer');
  assert(/Target cell T/.test(await txt('aim')), 'the selection is named in words');
  assert(/◉/.test(await txt('cell-tag-T')), 'and marked on the cell itself, not by colour alone');
  // a connection can be selected too
  const link = await page.evaluate(() => { const l = window.__world.controller.pickables.find((p) => p.kind === 'link' && p.id === 'T>D'); return l.points[7]; });
  const ls = await screenOf(link);
  await page.mouse.click(ls.x, ls.y); await wait(150);
  eq((await sel())?.id, 'T>D', 'the connection under the pointer');
  assert(/T → D/.test(await txt('wk-link-info')), 'its weight and delay are shown');
  return 'drag = look, click = select (cell and connection)';
});

await step('B · the camera never changes the model: with the model paused, flying and looking leave its clock and fingerprint untouched', async () => {
  await pauseWorkshop();
  const before = await page.evaluate(() => ({ step: window.__workshop.clock.step(), digest: window.__workshop.store.getState().result.digest, act: Array.from(window.__world.rt.act.slice(0, 5)) }));
  const p0 = await pose();
  await hold('KeyW', 400); await hold('KeyD', 300);
  await page.mouse.move(700, 150); await page.mouse.down(); await page.mouse.move(600, 220, { steps: 8 }); await page.mouse.up(); await wait(200);
  const after = await page.evaluate(() => ({ step: window.__workshop.clock.step(), digest: window.__workshop.store.getState().result.digest, act: Array.from(window.__world.rt.act.slice(0, 5)) }));
  assert(dist(p0.pos, (await pose()).pos) > 20, 'the rig did move while the model was paused');
  eq(JSON.stringify(after), JSON.stringify(before), 'model clock, fingerprint and displayed state');
  await page.keyboard.press('Space'); await wait(250);
  eq(await attr('world', 'data-paused'), '0', 'Space resumed it');
  assert(await page.evaluate((s) => window.__workshop.clock.step() > s, before.step), 'the model clock runs again');
  return `paused at step ${before.step}; moved the rig; fingerprint ${before.digest} unchanged`;
});

await step('B · mouse capture: the capturing click selects nothing, the mouse turns the view, a click selects what is under the centre mark, release clears held keys', async () => {
  await setPose({ pos: [28, 46, 318], yaw: 0.6, pitch: 0 }); await page.evaluate(() => window.__world.store.getState().select(null));
  await page.click(T('btn-capture')); await wait(350);
  const real = await page.evaluate(() => !!document.pointerLockElement);
  if (!real) {
    // Headless Chrome refuses pointer lock. Everything the PAGE does with a captured mouse is still exercised, by
    // presenting it with the same signals the browser would give: the lock element and the pointerlockchange event.
    await page.evaluate(() => { window.__lock = document.querySelector('[data-testid="world-view"] canvas'); Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => window.__lock ?? null }); document.dispatchEvent(new Event('pointerlockchange')); });
    notes.push('Pointer capture: headless Chrome does not grant pointer lock, so the browser’s grant was simulated (lock element + pointerlockchange) and the page’s own handling — look, centre-mark selection, release, forgetting held keys — was tested against that. The real grant is checked in a visible window by tests/e2e/neuroverse-perf.mjs.');
    await wait(150);
  }
  const releaseLock = async () => { if (real) await page.evaluate(() => document.exitPointerLock()); else await page.evaluate(() => { window.__lock = null; document.dispatchEvent(new Event('pointerlockchange')); }); await wait(200); };
  eq(await attr('world', 'data-captured'), '1', 'captured');
  assert(await page.locator(T('reticle')).isVisible(), 'the centre mark is shown');
  eq(await sel(), null, 'the click that captured the mouse selected nothing');
  const p0 = await pose();
  await page.mouse.move(760, 320); await page.mouse.move(820, 340, { steps: 6 }); await wait(120);
  const p1 = await pose();
  assert(p1.yaw !== p0.yaw || p1.pitch !== p0.pitch, 'mouse movement turned the view');
  // aim the centre mark at cell T and click
  const aim = await page.evaluate(() => { const c = window.__world.controller, t = window.__world.rt.spec.cells.find((x) => x.id === 'T').pos, p = c.s.pos, dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2]; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; });
  await page.evaluate((a) => { const c = window.__world.controller; c.s.yaw = a.yaw; c.s.pitch = a.pitch; }, aim);
  await wait(450);
  assert(/Target cell T/.test(await txt('aim')), `the thing under the centre mark is named: ${await txt('aim')}`);
  await page.mouse.down(); await page.mouse.up(); await wait(150);
  eq((await sel())?.id, 'T', 'click with capture selects through the centre mark');
  await page.keyboard.down('KeyW'); await wait(150);
  // a real Esc is handled by the browser itself (it ends the capture); here the capture is ended the same way the browser would report it
  await releaseLock();
  eq(await attr('world', 'data-captured'), '0', 'released');
  eq(await page.evaluate(() => window.__world.controller.held.size), 0, 'held keys were forgotten on release');
  await page.keyboard.up('KeyW'); await wait(800);
  const p2 = await pose(); await wait(250);
  eq(dist(p2.pos, (await pose()).pos), 0, 'the rig is not still flying after release');
  await page.evaluate(() => { delete document.pointerLockElement; });
  return `capture (${real ? 'granted by the browser' : 'simulated grant'}) → look → select through the centre mark → release clears held keys`;
});

await step('B · focus and return: F looks at the selection from outside it on a stable pivot; Return restores the exact pose; neither touches the model clock', async () => {
  await setPose({ pos: [-80, 70, 240], yaw: -0.3, pitch: -0.1 }); await focusScene();
  await pauseWorkshop();
  await page.evaluate(() => window.__world.store.getState().select({ kind: 'cell', id: 'T' }));
  const step0 = await page.evaluate(() => window.__workshop.clock.step()), p0 = await pose();
  await page.keyboard.press('KeyF'); await wait(500);
  eq(await attr('world', 'data-mode'), 'orbit', 'focus mode');
  const o = await page.evaluate(() => ({ orbit: window.__world.controller.orbit, t: window.__world.rt.spec.cells.find((c) => c.id === 'T') }));
  eq(JSON.stringify(o.orbit.pivot), JSON.stringify(o.t.pos), 'the pivot is the cell centre');
  const p1 = await pose();
  assert(dist(p1.pos, o.t.pos) > o.t.radius * 3, 'the view is outside the cell');
  assert(/Focused on/.test(await txt('mode-pill')), 'the new context is announced');
  await shot('03-workshop-focus');
  await page.mouse.move(700, 200); await page.mouse.down(); await page.mouse.move(800, 240, { steps: 8 }); await page.mouse.up(); await wait(150);
  const p2 = await pose();
  near(dist(p2.pos, o.t.pos), dist(p1.pos, o.t.pos), 1e-6, 'orbiting keeps the distance to the pivot');
  await page.keyboard.press('KeyR'); await wait(500);
  eq(await attr('world', 'data-mode'), 'fly', 'back in flight');
  eq(JSON.stringify(await pose()), JSON.stringify(p0), 'Return restored the exact pose');
  eq(await page.evaluate(() => window.__workshop.clock.step()), step0, 'the model clock did not move');
  // overview and back, by key and by button
  await page.keyboard.press('KeyM'); await wait(500);
  assert(/Overview/.test(await txt('mode-pill')), 'overview');
  assert(await page.locator(T('cell-tag-A')).isVisible() && await page.locator(T('cell-tag-D')).isVisible(), 'the overview names every cell');
  await shot('04-workshop-overview');
  await page.click(T('btn-return')); await wait(500);
  eq(JSON.stringify(await pose()), JSON.stringify(p0), 'Return from the overview restored the pose too');
  // the list is a way to focus without flying
  await page.selectOption(T('goto'), 'D'); await wait(500);
  eq(await attr('world', 'data-mode'), 'orbit', 'chosen from the list → focused');
  await page.keyboard.press('Escape'); await wait(450);
  eq(await attr('world', 'data-mode'), 'fly', 'Esc leaves focus');
  await focusScene(); await page.keyboard.press('Space');
  return 'pivot = cell centre; pose restored exactly; model clock untouched';
});

await step('B · reduced motion and the near-surface cutaway: no camera glide when asked; inside a cell body the view is cut away, says so, and Overview still works', async () => {
  await page.click(T('btn-controls')); await page.waitForSelector(T('panel-controls'));
  await page.check(T('reduced-motion')); await page.keyboard.press('Escape'); await wait(100);
  assert(!(await page.locator(T('panel-controls')).isVisible()), 'Esc closed the panel');
  await setPose({ pos: [-80, 70, 240], yaw: -0.3, pitch: -0.1 });
  await page.evaluate(() => window.__world.store.getState().select({ kind: 'cell', id: 'T' }));
  const glide = await page.evaluate(() => { const c = window.__world.controller; c.act('focus'); return c.transitioning; });
  eq(glide, false, 'focus is immediate with reduced motion');
  await page.keyboard.press('KeyR'); await wait(60);
  await page.click(T('btn-controls')); await page.uncheck(T('reduced-motion')); await page.keyboard.press('Escape');
  const withGlide = await page.evaluate(() => { const c = window.__world.controller; c.act('focus'); return c.transitioning; });
  eq(withGlide, true, 'and glides otherwise');
  await page.keyboard.press('KeyR'); await wait(450);
  // fly into the target cell
  const t = await page.evaluate(() => window.__world.rt.spec.cells.find((c) => c.id === 'T').pos);
  await setPose({ pos: [t[0], t[1], t[2] + 4], yaw: 0, pitch: 0 }); await wait(250);
  eq(await attr('world', 'data-cutaway'), '1', 'the cutaway is on');
  assert(/Display cutaway/.test(await txt('cutaway')) && /Nothing in the model changed/.test(await txt('cutaway')), 'and is named as a viewing aid');
  await shot('05-workshop-inside-cell');
  const hit = await page.evaluate(() => window.__world.controller.hitAt(0, 0));
  assert(hit === null || hit.id !== 'T', 'the body you are inside is not what the centre mark picks');
  await page.keyboard.press('KeyM'); await wait(500);
  assert(/Overview/.test(await txt('mode-pill')), 'Overview is available from inside a cell');
  eq(await attr('world', 'data-cutaway'), '0', 'and clears the cutaway');
  await page.keyboard.press('KeyR'); await wait(450);
  await setPose({ pos: [28, 46, 318], yaw: 0, pitch: -0.12 });
  return 'reduced motion respected; cutaway announced; recoverable from inside a cell';
});

await step('B · keys can be remapped, every key has a button, and typing in a field never flies the rig', async () => {
  await page.click(T('btn-controls')); await page.waitForSelector(T('panel-controls'));
  await page.click(T('key-forward')); await page.keyboard.press('KeyI'); await wait(100);
  eq((await page.locator(T('key-forward')).innerText()).trim(), 'I', 'forward is now I');
  await page.keyboard.press('Escape'); await focusScene();
  const p0 = await pose();
  await hold('KeyW', 300);
  eq(dist(p0.pos, (await pose()).pos), 0, 'W no longer moves');
  await hold('KeyI', 300);
  assert(dist(p0.pos, (await pose()).pos) > 5, 'I does');
  await page.click(T('btn-controls')); await page.click(T('keys-default')); await page.keyboard.press('Escape');
  eq(await page.evaluate(() => window.__world.controller.keys.forward), 'KeyW', 'defaults restored');
  // the on-screen pad
  const p1 = await pose();
  const pad = await page.locator(T('pad-forward')).boundingBox();
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2); await page.mouse.down(); await wait(350); await page.mouse.up(); await wait(800);
  assert(dist(p1.pos, (await pose()).pos) > 5, 'the on-screen forward button flies');
  // typing
  const p2 = await pose(), paused = await attr('world', 'data-paused');
  await page.click(T('wk-a-num')); await page.keyboard.type('wasdf m'); await wait(200);
  eq(dist(p2.pos, (await pose()).pos), 0, 'typing letters in a number field does not move the rig');
  eq(await attr('world', 'data-mode'), 'fly', 'nor focus or open the overview');
  eq(await attr('world', 'data-paused'), paused, 'nor pause the model');
  await page.fill(T('wk-a-num'), '10'); await focusScene();
  // the arrow keys are a second set of movement keys
  const p3 = await pose(); await hold('ArrowUp', 250);
  assert(dist(p3.pos, (await pose()).pos) > 3, 'arrow keys move as well');
  await setPose({ pos: [28, 46, 318], yaw: 0, pitch: -0.12 });
  return 'remap W → I and back; on-screen pad works; text entry is left alone';
});

await step('B · cause and consequence: two inputs fire the target only when close in time; the baseline stays on the same axes', async () => {
  await page.click(T('t-reset')); await wait(200);
  eq(await attr('workshop', 'data-fired'), '0', 'default (B 12 ms after A): no spike');
  assert(/short of its/.test(await txt('wk-sentence')), `the sentence says how far short: ${await txt('wk-sentence')}`);
  const run0 = await attr('workshop', 'data-run');
  await page.click(T('t-compare')); await wait(100);
  await page.fill(T('wk-b-num'), '14'); await wait(200);
  eq(await attr('workshop', 'data-fired'), '1', 'B 4 ms after A: T fires');
  const s = await txt('wk-sentence');
  assert(/fired at 17\.\d ms/.test(s) && /D followed/.test(s) && /Baseline: T stayed/.test(s), `sentence: ${s}`);
  const st = await page.evaluate(() => { const w = window.__workshop.store.getState(); return { parent: w.result.recipe.parentRunId, base: w.baseline?.recipe.runId, steps: w.result.run.nSteps, dt: w.result.run.dt }; });
  eq(st.base, run0, 'the baseline is the first run'); assert(!!st.parent, 'the new run records its parent');
  await wait(3800);
  await shot('06-workshop-fired-vs-baseline');
  // the scene shows the same run: T's flash follows its spike time
  await page.click(T('t-replay')); await wait(120);
  const live = await page.evaluate(async () => { const w = window.__workshop, sp = w.store.getState().result.run.spikes[3][0]; let seenBefore = 0, seenAfter = 0; const t0 = performance.now(); while (performance.now() - t0 < 5000) { const t = w.clock.step() * 0.05, f = window.__world.rt.flash[3]; if (t < sp - 0.1 && f > 0.01) seenBefore++; if (t > sp && t < sp + 0.5 && f > 0.3) seenAfter++; if (t > sp + 2) break; await new Promise((r) => requestAnimationFrame(r)); } return { sp, seenBefore, seenAfter }; });
  assert(live.seenBefore === 0 && live.seenAfter > 0, `T lit up at its spike (${live.sp.toFixed(2)} ms) and not before: ${JSON.stringify(live)}`);
  await page.click(T('t-compare'));
  return `${s}`;
});

await step('B · a second cause: with the inhibitory connection on, order matters; the leak narrows the window; any connection can be cut', async () => {
  await page.fill(T('wk-a-num'), '20'); await page.fill(T('wk-b-num'), '22'); await wait(120);
  eq(await attr('workshop', 'data-fired'), '1', 'B 2 ms after A fires without inhibition');
  await page.check(T('wk-inhibit')); await wait(150);
  eq(await attr('workshop', 'data-fired'), '0', 'the same timing with I → T on does not');
  await page.fill(T('wk-b-num'), '17'); await wait(150);
  eq(await attr('workshop', 'data-fired'), '1', 'B 3 ms BEFORE A fires even with inhibition');
  await shot('07-workshop-inhibition');
  await page.uncheck(T('wk-inhibit'));
  await page.fill(T('wk-a-num'), '10'); await page.fill(T('wk-b-num'), '18'); await wait(120);
  eq(await attr('workshop', 'data-fired'), '1', '8 ms apart fires at τ = 15 ms');
  await page.fill(T('wk-tau-num'), '8'); await wait(150);
  eq(await attr('workshop', 'data-fired'), '0', 'but not when T leaks faster (τ = 8 ms)');
  await page.fill(T('wk-tau-num'), '15'); await wait(120);
  // cut T → D through the scene
  await page.evaluate(() => window.__world.store.getState().select({ kind: 'link', id: 'T>D' })); await wait(100);
  await page.click(T('wk-link-toggle')); await wait(150);
  const d = await page.evaluate(() => { const r = window.__workshop.store.getState().result; return { t: r.firedMs, d: r.followerMs, on: window.__world.rt.linkOn[4] }; });
  assert(d.t != null && d.d == null && d.on === 0, `T fires, D no longer follows: ${JSON.stringify(d)}`);
  await page.click(T('wk-link-toggle'));
  return 'inhibition makes order matter; leak narrows the window; T → D can be cut';
});

await step('B · time control: step moves the model 0.25 ms and stays paused; the timeline can be scrubbed and its handles dragged; a pulse at the playhead branches a run', async () => {
  await page.click(T('t-reset')); await wait(150);
  await pauseWorkshop();
  const s0 = await page.evaluate(() => window.__workshop.clock.step());
  await page.keyboard.press('Period'); await wait(80);
  const s1 = await page.evaluate(() => window.__workshop.clock.step());
  eq(s1 - s0, 5, 'one step = 5 grid points = 0.25 ms'); eq(await attr('world', 'data-paused'), '1', 'still paused');
  // a button reached with the keyboard keeps the focus and Space presses it, as a keyboard user expects
  await page.locator(T('t-step')).focus(); await page.keyboard.press('Space'); await wait(80);
  eq(await page.evaluate(() => window.__workshop.clock.step()) - s1, 5, 'Space on a keyboard-focused Step button steps'); eq(await attr('world', 'data-paused'), '1', 'and does not toggle the pause');
  await focusScene();
  await page.click(T('t-step')); await wait(80);
  eq(await page.evaluate(() => window.__workshop.clock.step()) - s1, 10, 'the Step button does the same with the mouse');
  const box = await page.locator(T('wk-timeline')).boundingBox(), xOf = (ms) => box.x + 64 + (ms / 60) * (box.width - 64 - 14);
  await page.mouse.click(xOf(30), box.y + 70); await wait(100);
  near(await page.evaluate(() => window.__workshop.clock.step() * 0.05), 30, 0.3, 'clicking the timeline moves the playhead there');
  // drag handle B from 22 ms to 13 ms
  await page.mouse.move(xOf(22), box.y + 8); await page.mouse.down(); await page.mouse.move(xOf(13), box.y + 8, { steps: 10 }); await page.mouse.up(); await wait(200);
  near(await page.evaluate(() => window.__workshop.store.getState().setup.bMs), 13, 0.3, 'handle B was dragged to 13 ms');
  eq(await attr('workshop', 'data-fired'), '1', 'and the model answered');
  // pulse at the playhead while paused
  await page.fill(T('wk-b-num'), '40'); await wait(100);
  await pauseWorkshop();
  await page.mouse.click(xOf(12), box.y + 70); await wait(100);
  const before = await page.evaluate(() => { const r = window.__workshop.store.getState().result; return { id: r.recipe.runId, v: Array.from(r.run.v[3].slice(0, 241)), fired: r.firedMs }; });
  eq(before.fired, null, 'A alone at 10 ms does not fire T');
  await page.click(T('wk-pulse-b')); await wait(200);
  const after = await page.evaluate(() => { const r = window.__workshop.store.getState().result; return { id: r.recipe.runId, parent: r.recipe.parentRunId, v: Array.from(r.run.v[3].slice(0, 241)), fired: r.firedMs, extra: r.recipe.parameters.extra }; });
  eq(after.parent, before.id, 'the new run names its parent');
  eq(JSON.stringify(after.v), JSON.stringify(before.v), 'everything before the pulse is identical');
  assert(after.fired != null && after.extra.length === 1 && Math.abs(after.extra[0].ms - 12) < 0.3, `the added pulse made T fire: ${JSON.stringify(after.extra)} → ${after.fired}`);
  return `step 0.25 ms; scrub; drag B; pulse at ${after.extra[0].ms} ms → child run, shared past, T fired at ${after.fired.toFixed(1)} ms`;
});

await step('B · optional challenge, predict-first on a new condition, and a run that survives export → import', async () => {
  await page.click(T('t-reset')); await wait(150);
  await page.click(T('wk-challenge-open'));
  eq(await attr('wk-challenge', 'data-done'), '0', 'goal 1 not done yet');
  await page.fill(T('wk-b-num'), '12'); await wait(150);
  eq(await attr('wk-challenge', 'data-done'), '1', 'goal 1: T fired');
  await page.click(T('wk-next-goal'));
  const edge = await page.evaluate(() => window.__workshop.firingEdge(window.__workshop.store.getState().setup).hi);
  await page.fill(T('wk-b-num'), String(10 + edge + 2)); await wait(120); await page.click(T('wk-mark-edge'));
  eq(await attr('wk-edge-result', 'data-ok'), '0', 'two milliseconds too late is not the edge');
  await page.fill(T('wk-b-num'), String(10 + edge - 0.25)); await wait(120); await page.click(T('wk-mark-edge'));
  eq(await attr('wk-edge-result', 'data-ok'), '1', 'within half a millisecond is');
  await page.click(T('wk-next-goal'));
  await page.check(T('wk-inhibit')); await page.fill(T('wk-b-num'), '7'); await wait(150);
  eq(await attr('wk-challenge', 'data-done'), '1', 'goal 3: fired with inhibition on');
  await page.uncheck(T('wk-inhibit'));
  await page.locator(T('wk-challenge')).getByText('Close').click();
  // predict first
  await page.fill(T('wk-b-num'), '16'); await wait(100);
  await page.click(T('wk-new-condition')); await page.waitForSelector(T('wk-predict'));
  const variant = +(await attr('workshop', 'data-variant'));
  assert(variant > 0, 'a new variant of the circuit');
  assert(/Say what you expect/.test(await txt('wk-sentence')), 'the outcome is hidden until a prediction is made');
  eq(await page.evaluate(() => Math.max(...window.__world.rt.flash.slice(0, 5))), 0, 'in the scene as well');
  const truth = (await attr('workshop', 'data-fired')) === '1';
  await page.click(T(truth ? 'wk-predict-no' : 'wk-predict-yes')); await wait(150);
  eq(await attr('wk-predict-result', 'data-right'), '0', 'a wrong prediction is told so');
  assert(/0 of 1/.test(await txt('wk-predict-result')), 'and counted');
  await shot('08-workshop-predict');
  // export, change something, import
  await page.click(T('btn-runs')); await page.waitForSelector(T('panel-runs'));
  const file = await page.locator(T('run-export')).inputValue(), digest = await attr('workshop', 'data-digest'), parsed = JSON.parse(file);
  assert(parsed.format === 'hbci.world.workshop-run' && parsed.recipe.modelRevision && parsed.recipe.dtMs === 0.05 && parsed.recipe.units.voltage === 'mV' && parsed.commands.length >= 2, 'the file names the model, its revision, step, units and commands');
  await page.keyboard.press('Escape');
  await page.fill(T('wk-b-num'), '33'); await wait(120);
  assert((await attr('workshop', 'data-digest')) !== digest, 'a different run now');
  await page.click(T('btn-runs')); await page.fill(T('run-import'), file); await page.click(T('run-load')); await wait(200);
  eq(await attr('run-msg', 'data-ok'), '1', 'the replay matches the file');
  eq(await attr('workshop', 'data-digest'), digest, 'same fingerprint as when it was saved');
  // a tampered file is noticed
  parsed.commands[parsed.commands.length - 1].atStep += 40;
  await page.fill(T('run-import'), JSON.stringify(parsed)); await page.click(T('run-load')); await wait(200);
  eq(await attr('run-msg', 'data-ok'), '0', 'a changed command log does not match');
  await page.keyboard.press('Escape');
  return `challenge goals checked by the model (edge ${edge} ms); variant ${variant} predicted first; export → import fingerprint ${digest}`;
});

await step('B · what is this: every representation states its class, what it leaves out, and its source', async () => {
  await page.click(T('btn-model')); await page.waitForSelector(T('panel-model'));
  const t = await txt('panel-model');
  for (const w of ['PUBLISHED MODEL', 'ILLUSTRATIVE', 'Leaves out', 'leaky integrate-and-fire', 'not the cells at any atlas location', 'Neuronal Dynamics']) assert(t.includes(w), `the panel mentions “${w}”`);
  assert(/bead ending excites; a flat bar inhibits/.test(await txt('legend')), 'the scene’s non-colour cues are explained');
  await shot('09-workshop-what-is-this');
  await page.keyboard.press('Escape');
  assert(/ILLUSTRATIVE/.test(await txt('world-crumbs')), 'the scene is labelled where you are');
  assert(/LIF circuit · run/.test(await txt('world-running')), `what is running is always stated: ${await txt('world-running')}`);
  return 'model card, limits, source link, legend';
});

// ══ Toy A · Instrument flight ═════════════════════════════════════════════════════════════════════════════════════
let truth = null;
await step('A · a live field: the model runs on its own, nothing is recorded until a contact is placed, and the wiring is not shown', async () => {
  await openToy('flight', T('flight'));
  const t0 = await page.evaluate(() => window.__flight.eng.run.timeMs); await wait(600);
  const t1 = await page.evaluate(() => window.__flight.eng.run.timeMs);
  near(t1 - t0, 15, 6, 'model time advances at 25 ms per second');
  assert(/Nothing is being recorded yet/.test(await txt('fl-line')), 'no contact, no recording');
  eq(await page.evaluate(() => window.__world.rt.spec.links.length), 0, 'no connections are drawn');
  truth = await page.evaluate(() => { const r = window.__flight.eng.run; return { driver: r.truth.driver, followers: r.truth.followers, cells: r.circuit.cells.map((c) => ({ id: c.id, pos: c.pos })) }; });
  const share = await viewShare();
  assert(share >= 0.74, `the 3D view takes ${(share * 100).toFixed(0)} % of the height`);
  await shot('10-flight');
  return `10 cells, seed 1; the world takes ${(share * 100).toFixed(0)} % of the screen height`;
});

const flightState = () => page.evaluate(() => { const r = window.__flight.eng.run; return { step: r.step, digest: r.digest(), trace: Array.from(r.trace(1, 400).uv).reduce((a, v) => a + Math.round(v * 100), 0), contacts: r.contacts.length }; });
await step('A · the recording comes from where the contact is: flying and looking do not change it; placing the contact does', async () => {
  const d = truth.cells[truth.driver].pos;
  await setPose({ pos: [d[0], d[1] + 4, d[2] + 56], yaw: 0, pitch: -0.07 }); await focusScene(); await wait(200);
  const tip = await page.evaluate(() => window.__flight.probeTip());
  await page.keyboard.press('KeyC'); await wait(200);
  const placed = await page.evaluate(() => window.__flight.eng.run.contacts.slice(-1)[0]);
  eq(JSON.stringify(placed.pos.map((v) => +v.toFixed(6))), JSON.stringify(tip.map((v) => +v.toFixed(6))), 'the logged position is the probe tip');
  const dUm = dist(placed.pos, d);
  assert(dUm > 15 && dUm < 30, `the contact is ${dUm.toFixed(1)} µm from the driver’s body`);
  assert(await page.locator(T('fl-contact-tag-1')).isVisible(), 'a marker stays where the contact was put');
  await wait(2600);
  const stats = await page.evaluate(() => window.__flight.eng.stats[0]), expected = (120 * 30) / dUm;
  assert(stats.events >= 1, 'spikes are detected');
  near(stats.maxUv, expected, 5 * 6, `largest spike vs the 1/distance rule (${expected.toFixed(0)} µV)`);
  // pause the model; move the camera; nothing about the recording changes
  await page.keyboard.press('Space'); await wait(120);
  const a = await flightState();
  await hold('KeyS', 500); await hold('KeyA', 300);
  await page.mouse.move(700, 200); await page.mouse.down(); await page.mouse.move(560, 260, { steps: 8 }); await page.mouse.up(); await wait(150);
  const b = await flightState();
  eq(JSON.stringify(b), JSON.stringify(a), 'model step, fingerprint, trace and command log after moving the camera');
  await page.keyboard.press('Space'); await wait(300);
  // unpaused: flying away still does not move the contact
  const c0 = await page.evaluate(() => window.__flight.eng.run.placements(1).slice(-1)[0].pos);
  await hold('KeyS', 600);
  eq(JSON.stringify(await page.evaluate(() => window.__flight.eng.run.placements(1).slice(-1)[0].pos)), JSON.stringify(c0), 'the contact stays put while the rig flies');
  await shot('11-flight-contact');
  return `contact 1 placed ${dUm.toFixed(0)} µm from a cell body: largest spike ${stats.maxUv.toFixed(0)} µV (rule: ${expected.toFixed(0)} µV); camera movement changed nothing`;
});

await step('A · a second contact elsewhere hears the same cells at other sizes; generator truth is one click away and says what it is', async () => {
  const far = truth.cells.map((c, i) => ({ i, d: dist(c.pos, truth.cells[truth.driver].pos) })).sort((x, y) => y.d - x.d)[0], f = truth.cells[far.i].pos;
  await page.click(T('fl-slot-2'));
  await setPose({ pos: [f[0], f[1] + 4, f[2] + 56], yaw: 0, pitch: -0.07 }); await wait(150);
  await page.click(T('fl-place')); await wait(2600);
  const s = await page.evaluate(() => window.__flight.eng.stats);
  assert(s[0] && s[1], 'both contacts are recording');
  await page.click(T('fl-truth-toggle')); await wait(100);
  const t = await txt('fl-truth');
  assert(/GENERATOR TRUTH/.test(t) && /µm →/.test(t), 'labelled as the generator’s own knowledge');
  await page.click(T('fl-truth-toggle')); await page.click(T('fl-slot-1'));
  return `contact 1 largest ${s[0].maxUv.toFixed(0)} µV, contact 2 largest ${s[1].maxUv.toFixed(0)} µV`;
});

await step('A · intervention and comparison: keep a window, silence the leading cell, and the wave stops at the contact; waking it brings it back', async () => {
  const d = truth.cells[truth.driver];
  await page.evaluate((id) => window.__world.store.getState().select({ kind: 'cell', id }), d.id); await wait(100);
  await page.click(T('t-compare')); await wait(100);
  assert(/Kept for comparison/.test(await txt('fl-line')), 'the kept window is named');
  const before = await page.evaluate(() => window.__flight.eng.stats[0]);
  await page.click(T('fl-silence')); await wait(3200);
  const after = await page.evaluate(() => { const r = window.__flight.eng.run; return { stats: window.__flight.eng.stats[0], dim: window.__world.rt.dim[r.truth.driver], last: r.commands.slice(-1)[0] }; });
  eq(after.last.kind, 'cell-on', 'the silencing is a logged command'); eq(after.dim, 1, 'the cell is drawn as silenced');
  assert(/silenced/.test(await txt(`cell-tag-${d.id}`)), 'and its label says so (not only its colour)');
  assert(before.events >= 1 && after.stats.maxUv < before.maxUv / 3, `the big spikes are gone: ${before.maxUv.toFixed(0)} → ${after.stats.maxUv.toFixed(0)} µV`);
  const followersQuiet = await page.evaluate(() => { const r = window.__flight.eng.run, t = r.timeMs; return r.truth.followers.every((f) => !r.spikes[f].some((s) => s > t - 50)); });
  assert(followersQuiet, 'no follower fired in the last 50 ms');
  await shot('12-flight-silenced-vs-kept');
  await page.click(T('fl-silence')); await wait(2600);
  const back = await page.evaluate(() => window.__flight.eng.stats[0]);
  assert(back.maxUv > before.maxUv * 0.7, 'waking the cell restores the wave');
  await page.click(T('t-compare'));
  return `largest spike at the contact ${before.maxUv.toFixed(0)} µV → ${after.stats.maxUv.toFixed(0)} µV with the leader silenced → ${back.maxUv.toFixed(0)} µV after waking it`;
});

await step('A · virtual state inspection, stepping, and an exact replay of the last 200 ms', async () => {
  await page.click(T('fl-inspect')); await wait(200);
  assert(await page.evaluate(() => !!window.__flight.store.getState().inspect), 'the membrane trace of the selected cell is shown');
  await focusScene(); await page.keyboard.press('Space'); await wait(120);
  const s0 = await page.evaluate(() => window.__flight.eng.run.step);
  await page.keyboard.press('Period'); await wait(150);
  eq(await page.evaluate(() => window.__flight.eng.run.step) - s0, 20, 'one step = 1 ms of model time');
  const mark = await page.evaluate(() => { const r = window.__flight.eng.run; return { step: r.step, digest: r.digest(), id: r.runId, spikes: JSON.stringify(r.spikes) }; });
  await page.click(T('t-replay')); await wait(500);
  assert(await page.evaluate(() => window.__flight.eng.run.replaying), 'the run is replaying its own past');
  assert(/replaying the past/.test(await txt('world-running')), 'and says so');
  await page.waitForFunction((s) => window.__flight.eng.run.step >= s, mark.step, { timeout: 15000 });
  await page.keyboard.press('Space'); await wait(120);
  const again = await page.evaluate((s) => { const r = window.__flight.eng.run; return { same: r.step === s, digest: r.digest(), id: r.runId }; }, mark.step);
  // the replay may have run a few steps past the mark before the pause landed: compare at the mark by replaying once more
  const exact = await page.evaluate((m) => { const r = window.__flight.eng.run; r.rewind(400); r.advanceTo(m.step); return { digest: r.digest(), spikes: JSON.stringify(r.spikes.map((sp) => sp.filter((t) => t < m.step * 0.05))) === JSON.stringify(JSON.parse(m.spikes).map((sp) => sp.filter((t) => t < m.step * 0.05))) }; }, mark);
  eq(exact.digest, mark.digest, 'the state at the same step is identical, bit for bit');
  assert(exact.spikes, 'the same spikes at the same times');
  eq(again.id, mark.id, 'watching the past again is still the same run');
  await page.evaluate(() => { const f = window.__flight; f.clock.seek(f.eng.run.step); });
  await page.keyboard.press('Space'); await page.click(T('fl-inspect'));
  return `step 1 ms; replayed to step ${mark.step}: fingerprint ${mark.digest} reproduced`;
});

await step('A · the question: a wrong answer reveals nothing; the right one draws the wiring; a new field has a new leader; the run exports and replays', async () => {
  const wrong = truth.cells.find((_, i) => i !== truth.driver && !truth.followers.includes(i));
  await page.evaluate((id) => window.__world.store.getState().select({ kind: 'cell', id }), wrong.id); await wait(100);
  await page.click(T('fl-guess')); await wait(150);
  eq(await attr('flight', 'data-revealed'), '0', 'not revealed'); assert(/Tries so far: 1/.test(await txt('fl-wrong')), 'the try is counted');
  await page.evaluate((id) => window.__world.store.getState().select({ kind: 'cell', id }), truth.cells[truth.driver].id); await wait(100);
  const p0 = await pose();
  await page.click(T('fl-guess')); await wait(400);
  eq(await attr('flight', 'data-revealed'), '1', 'revealed');
  eq(await page.evaluate(() => window.__world.rt.spec.links.length), 6, 'the six connections are drawn');
  eq(JSON.stringify(await pose()), JSON.stringify(p0), 'revealing the wiring did not move the rig');
  await page.keyboard.press('KeyM'); await wait(700);
  await shot('13-flight-revealed');
  await page.keyboard.press('KeyR'); await wait(450);
  // export → import
  await page.click(T('btn-runs')); await page.waitForSelector(T('panel-runs'));
  const file = await page.locator(T('run-export')).inputValue(), x = JSON.parse(file);
  assert(x.format === 'hbci.world.field-run' && x.contacts.length >= 2 && x.commands.length >= 2 && x.digest, `the file carries contacts, commands and a fingerprint: ${x.format}, ${x.contacts?.length} contacts, ${x.commands?.length} commands, run ${x.runId} ← ${x.parentRunId}`);
  await page.fill(T('run-import'), file); await page.click(T('run-load')); await wait(300);
  eq(await attr('run-msg', 'data-ok'), '1', 'replaying the file gives the same state');
  await page.keyboard.press('Escape');
  await page.click(T('fl-new')); await wait(400);
  const next = await page.evaluate(() => ({ seed: window.__flight.eng.run.seed, driver: window.__flight.eng.run.truth.driver, revealed: window.__flight.store.getState().revealed, links: window.__world.rt.spec.links.length }));
  assert(next.seed !== 1 && !next.revealed && next.links === 0, 'a new field hides its wiring again');
  return `wrong guess counted, right guess reveals 6 connections; export → import matches; new field seed ${next.seed} (leader differs: ${next.driver !== truth.driver})`;
});

// ══ Toy C · Decoder pilot ═════════════════════════════════════════════════════════════════════════════════════════
const pilot = () => page.evaluate(() => { const p = window.__pilot, s = p.store.getState(), c = p.eng.cur; return { status: s.status, off: s.offThread, info: s.info, bin: c?.bin ?? 0, intent: c?.intent, decoded: c?.decoded, cursor: c?.cursor, target: c?.target, hits: c?.hits ?? 0, fit: c?.fit }; });
/** A scripted player: holds the keys that point at the target (released when close), for a given time. */
const recalibrate = async () => { const id = +(await attr('pilot', 'data-calibration')); await page.click(T('pl-calibrate')); await page.waitForSelector(`${T('pilot')}[data-status="ready"][data-calibration="${id + 1}"]`, { timeout: 20000 }); await wait(120); };
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

await step('C · calibration is an explicit job off the main thread, with three separate sets of reaches; without it the cursor cannot move', async () => {
  await openToy('pilot', T('pilot'));
  await page.waitForSelector(`${T('pilot')}[data-status="ready"][data-calibration="1"]`, { timeout: 20000 });
  const p = await pilot(), c = p.info.calibration, e = p.info.evaluation;
  eq(p.off, true, 'the session runs in a worker');
  assert(new Set([c.trainSeed, c.heldOutSeed, e.evalSeed]).size === 3, 'fitting, held-out and evaluation reaches come from three seeds');
  eq(c.trainBins, 630, '20 reaches for fitting'); eq(c.heldOutBins, 310, '10 others for scoring');
  for (const d of ['linear', 'kalman', 'mlp8']) assert(c.scores[d].r2 > 0.45 && c.scores[d].r2 < 0.85, `${d} held-out R² ${c.scores[d].r2}`);
  const t = await txt('pl-scores');
  assert(t.includes(c.scores.linear.r2.toFixed(2)), 'the scores on screen are the calibration’s');
  assert(/Surrogate: waveform stages bypassed/.test(await page.locator('.wd-tools').innerText()), 'the bypass is stated next to the controls');
  const share = await viewShare();
  assert(share >= 0.74, `the 3D view takes ${(share * 100).toFixed(0)} % of the height`);
  await shot('14-pilot-explore');
  return `held-out R² linear ${c.scores.linear.r2.toFixed(2)}, Kalman ${c.scores.kalman.r2.toFixed(2)}, MLP ${c.scores.mlp8.r2.toFixed(2)}; the world takes ${(share * 100).toFixed(0)} % of the screen height`;
});

await step('C · two input contexts, never both: in Explore the keys fly the rig and intend nothing; in Pilot they are the intent and the rig stays put; switching forgets held keys', async () => {
  await focusScene();
  const p0 = await pose();
  await page.keyboard.down('KeyD'); await wait(500);
  const mid = await pilot();
  await page.keyboard.up('KeyD'); await wait(200);
  assert(dist(p0.pos, (await pose()).pos) > 10, 'Explore: D flew the rig');
  eq(JSON.stringify(mid.intent), '[0,0]', 'Explore: the intended velocity stayed zero');
  await page.keyboard.press('KeyP'); await wait(700);
  eq(await attr('world', 'data-context'), 'pilot', 'Pilot context');
  assert(/the movement keys are now your intended velocity/i.test(await txt('world-notice')), 'the change is announced');
  const p1 = await pose();
  await page.keyboard.down('KeyD'); await wait(500);
  const during = await pilot();
  eq(JSON.stringify(during.intent), '[1,0]', 'Pilot: D is “intend right at full speed”');
  eq(dist(p1.pos, (await pose()).pos), 0, 'Pilot: the rig did not move');
  // switch context with D still held: the key must be forgotten on both sides
  await page.keyboard.press('KeyP'); await wait(600);
  eq(await attr('world', 'data-context'), 'explore', 'back to Explore');
  eq(await page.evaluate(() => window.__world.controller.held.size), 0, 'held keys were cleared by the switch');
  const p2 = await pose(); await wait(300);
  eq(dist(p2.pos, (await pose()).pos), 0, 'the still-held D does not fly the rig');
  eq(JSON.stringify((await pilot()).intent), '[0,0]', 'and intends nothing');
  await page.keyboard.up('KeyD');
  // Shift = gently; window blur clears held keys
  await page.click(T('pl-pilot')); await wait(600);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await wait(300);
  const slow = await pilot();
  near(slow.intent[1], 0.45, 1e-6, 'Shift + W intends up at 45 %');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await wait(250);
  eq(await page.evaluate(() => window.__world.controller.held.size), 0, 'losing the window forgets held keys');
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  await page.keyboard.press('Escape'); await wait(500);
  eq(await attr('world', 'data-context'), 'explore', 'Esc leaves Pilot');
  eq(JSON.stringify(await pose()), JSON.stringify(p2), 'and the rig is back where Explore left it');
  return 'Explore: rig moves, intent 0. Pilot: intent set, rig still. Held keys cleared on switch and on blur';
});

let base = null;
await step('C · piloting: the cursor follows the decoded velocity, not the keys; targets are reached', async () => {
  await page.click(T('pl-pilot')); await wait(700);
  const h0 = (await pilot()).hits;
  await steer(12000);
  const p = await pilot();
  base = { hits: p.hits - h0, fit: p.fit };
  assert(base.hits >= 3, `targets reached in 12 s: ${base.hits}`);
  assert(p.fit > 0, `tracking R² ${p.fit}`);
  const trail = await page.evaluate(() => { const e = window.__pilot.eng, n = Math.min(160, e.histN); let diff = 0; for (let k = 0; k < n; k++) diff += Math.abs(e.hist[k * 4] - e.hist[k * 4 + 2]) + Math.abs(e.hist[k * 4 + 1] - e.hist[k * 4 + 3]); return diff / n; });
  assert(trail > 0.05, 'decoded velocity is not a copy of the intended velocity');
  assert(/Targets reached/.test(await txt('pl-task')) && /Tracking R²/.test(await txt('pl-task')), 'the task readout');
  await shot('15-pilot-piloting');
  return `${base.hits} targets in 12 s (scripted player), tracking R² ${p.fit.toFixed(2)}; mean |decoded − intended| ${trail.toFixed(2)}`;
});

await step('C · break the loop and recover it two ways: lost contacts cripple the linear decoder; the Kalman filter still tracks; recalibration restores the score', async () => {
  await page.click(T('pl-fault-lost')); await wait(400);
  const f = await pilot();
  eq(JSON.stringify(f.info.cond.lost), '[0,3,5]', 'three contacts are lost');
  eq(await attr('pl-contact-1', 'data-lost'), '1', 'and marked as lost in the scene');
  const now = f.info.evaluation.scores, was = f.info.calibration.scores;
  assert(now.linear.r2 < was.linear.r2 - 0.25, `linear R² ${was.linear.r2.toFixed(2)} → ${now.linear.r2.toFixed(2)}`);
  assert(now.kalman.r2 > now.linear.r2 + 0.1, `Kalman scores better now (${now.kalman.r2.toFixed(2)})`);
  assert(/Conditions have changed since calibration/.test(await txt('pl-line')) && /Kalman filter scores/.test(await txt('pl-line')), `the line says what changed: ${await txt('pl-line')}`);
  const h0 = f.hits; await steer(12000);
  const broken = await pilot(), hitsBroken = broken.hits - h0;
  await shot('16-pilot-lost-contacts');
  // way back 1: another decoder (nothing refitted)
  await page.click(T('pl-dec-kalman')); await wait(300);
  eq(await attr('pilot', 'data-decoder'), 'kalman', 'Kalman now moves the cursor'); eq(await attr('pilot', 'data-calibration'), String(f.info.calibration.id), 'no recalibration happened');
  const h1 = (await pilot()).hits; await steer(12000);
  const kal = await pilot(), hitsKal = kal.hits - h1;
  // way back 2: recalibrate the linear decoder on the contacts that are left
  await page.click(T('pl-dec-linear')); await wait(200);
  await recalibrate();
  const re = await pilot();
  eq(JSON.stringify(re.info.calibration.cond.lost), '[0,3,5]', 'the new calibration was made under the present conditions');
  assert(re.info.calibration.scores.linear.r2 > now.linear.r2 + 0.3, `recalibrated linear R² ${re.info.calibration.scores.linear.r2.toFixed(2)}`);
  assert(re.info.calibration.heldOutSeed !== f.info.calibration.heldOutSeed && re.info.calibration.trainSeed !== f.info.calibration.trainSeed, 'on new fitting and new held-out reaches');
  const h2 = re.hits; await steer(12000);
  const fixed = await pilot(), hitsFixed = fixed.hits - h2;
  // the scripted player is a crude pilot, so the live task is asked only for the direction of the effect
  assert(hitsKal > hitsBroken && hitsFixed > hitsBroken, `targets in 12 s: broken ${hitsBroken}, Kalman ${hitsKal}, recalibrated ${hitsFixed}`);
  assert(kal.fit > broken.fit && fixed.fit > broken.fit, `tracking R²: broken ${broken.fit.toFixed(2)}, Kalman ${kal.fit.toFixed(2)}, recalibrated ${fixed.fit.toFixed(2)}`);
  await shot('17-pilot-recalibrated');
  return `lost contacts, linear: ${hitsBroken} targets / 12 s, tracking R² ${broken.fit.toFixed(2)} → Kalman (no refit): ${hitsKal} targets, R² ${kal.fit.toFixed(2)} → linear recalibrated: ${hitsFixed} targets, R² ${fixed.fit.toFixed(2)} (held-out R² ${now.linear.r2.toFixed(2)} → ${re.info.calibration.scores.linear.r2.toFixed(2)})`;
});

await step('C · noise is not fully recoverable, and the app says only what its model supports', async () => {
  await page.click(T('pl-clear')); await wait(300);
  await recalibrate();
  const clean = (await pilot()).info.calibration.scores.linear.r2;
  await page.click(T('pl-fault-noise')); await wait(300);
  const noisy = (await pilot()).info.evaluation.scores.linear.r2;
  assert(noisy < 0, `with thresholds left where they were, the linear decoder is worse than guessing the mean (R² ${noisy.toFixed(1)})`);
  await recalibrate();
  const rec = (await pilot()).info.calibration;
  assert(rec.scores.linear.r2 > 0.05 && rec.scores.linear.r2 < clean - 0.15, `recalibration helps but does not restore: ${clean.toFixed(2)} → ${noisy.toFixed(1)} → ${rec.scores.linear.r2.toFixed(2)}`);
  assert(rec.thresholdsUv[0] > 30, 'the thresholds were re-estimated for the new noise');
  await page.click(T('btn-model')); await page.waitForSelector(T('panel-model'));
  const t = await txt('panel-model');
  for (const w of ['Nothing here reads a brain', 'Feature-level surrogate', 'HYPOTHESIS', 'No confidence interval is shown', 'not a model of any particular']) assert(t.includes(w), `the panel says “${w}”`);
  await page.keyboard.press('Escape');
  return `held-out R² (linear): clean ${clean.toFixed(2)} → noise with old thresholds ${noisy.toFixed(1)} → recalibrated ${rec.scores.linear.r2.toFixed(2)}`;
});

await step('C · pause, step, a stoppable calibration, and a replay of the whole session from its log', async () => {
  await focusScene(); await page.keyboard.press('Space'); await wait(250);
  const b0 = (await pilot()).bin; await wait(400);
  eq((await pilot()).bin, b0, 'paused: no bins are computed');
  const p0 = await pose(); await hold('ArrowLeft', 250);
  eq(await attr('world', 'data-context'), 'pilot', 'still in Pilot'); eq(dist(p0.pos, (await pose()).pos), 0, 'the rig stays');
  await page.keyboard.press('Period'); await wait(250);
  eq((await pilot()).bin, b0 + 1, 'Step computes exactly one 50 ms bin');
  await page.keyboard.press('Space'); await wait(200);
  // stop a calibration between its steps
  const calBefore = (await pilot()).info.calibration.id;
  await page.click(T('pl-calibrate'));
  const stopped = await page.evaluate(async () => { const b = document.querySelector('[data-testid="pl-cancel"]'); if (b) { b.click(); return true; } return false; });
  await page.waitForSelector(`${T('pilot')}[data-status="ready"]`, { timeout: 20000 }); await wait(150);
  const calAfter = (await pilot()).info.calibration.id, note = await txt('world-notice');
  if (calAfter === calBefore) assert(/stopped/.test(note), 'a stopped calibration says so and leaves the decoders alone');
  else notes.push('The calibration finished before the Stop click could land (it takes well under a second on this machine); the stop path is covered by the unit test instead.');
  // replay the whole session from its command log
  await page.click(T('t-replay'));
  await page.waitForFunction(() => /Replayed all \d+ bins/.test(document.querySelector('[data-testid="world-notice"]')?.textContent ?? ''), null, { timeout: 30000 });
  const r = await txt('world-notice');
  assert(/identical/.test(r), `replay: ${r}`);
  return `${r}${calAfter === calBefore && stopped ? ' · a calibration was stopped mid-way and changed nothing' : ''}`;
});

await step('C · the full recording chain is still there: the link opens the Experiment scene of the classic studio', async () => {
  await page.keyboard.press('Escape'); await wait(300);
  await page.click(T('pl-full-chain'));
  await page.waitForSelector(T('nav-experiment'), { timeout: 20000 });
  eq(await page.locator(T('nav-experiment')).getAttribute('aria-current'), 'page', 'the Experiment scene');
  assert(await page.locator('.shell-bar').isVisible(), 'with the classic dock');
  await page.click(T('nav-world')); await page.waitForSelector(T('world'), { timeout: 20000 });
  eq(await attr('world', 'data-toy'), 'pilot', 'and back to the toy');
  return 'Pilot ↔ Experiment (full chain) ↔ Pilot';
});

// ══ across the toys ═══════════════════════════════════════════════════════════════════════════════════════════════
await step('all toys: every control has a name, the keyboard focus is visible, and switching toys many times does not pile up memory', async () => {
  await openToy('workshop', T('workshop'));
  const a = await page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('.world button, .world select, .world input, .world textarea')) { const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.closest('label')?.textContent || '').trim(); if (!name) bad.push(el.outerHTML.slice(0, 80)); } return bad; });
  eq(a.length, 0, `controls without an accessible name: ${a.slice(0, 2).join(' | ')}`);
  await page.locator(T('t-pause')).focus(); await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), who: document.activeElement.getAttribute('data-testid') }; });
  assert(ring.style !== 'none' && ring.width >= 2, `no visible focus ring on ${ring.who}`);
  const heap = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const geo = () => page.evaluate(() => { const c = document.querySelector('[data-testid="world-view"] canvas'); return c ? 1 : 0; });
  const cycle = async () => { for (const t of ['flight', 'workshop', 'pilot']) { await page.click(T('world-back')); await page.click(T(`toy-${t}`)); await page.waitForFunction(() => window.__world.store.getState().ready, null, { timeout: 20000 }); await wait(350); } };
  await cycle(); const h1 = await heap();
  for (let i = 0; i < 4; i++) await cycle();
  const h2 = await heap(); eq(await geo(), 1, 'one canvas');
  const grew = (h2 - h1) / 1048576;
  notes.push(`JS heap after 1 cycle of the three toys: ${(h1 / 1048576).toFixed(1)} MB; after 5 cycles: ${(h2 / 1048576).toFixed(1)} MB (no forced garbage collection, so this is an upper bound on growth).`);
  assert(grew < 60, `heap grew ${grew.toFixed(1)} MB over 4 further cycles`);
  return `all controls named; focus ring on ${ring.who}; heap ${(h1 / 1048576).toFixed(0)} → ${(h2 / 1048576).toFixed(0)} MB over 12 further scene changes`;
});

await step('no errors were written to the browser console during the whole run', async () => {
  const real = consoleErrors.filter((e) => !/pointer ?lock|PointerLock|The user has exited the lock/i.test(e));
  eq(real.length, 0, `console errors: ${real.slice(0, 3).join(' | ')}`);
  return `${consoleErrors.length - real.length} pointer-lock notices ignored`;
});

const env = await page.evaluate(() => { const c = document.createElement('canvas'), gl = c.getContext('webgl2'), dbg = gl?.getExtension('WEBGL_debug_renderer_info'); return { ua: navigator.userAgent, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, size: `${innerWidth} × ${innerHeight}` }; });
await browser.close();
const passed = results.filter((r) => r.ok).length;
const report = [
  'Neuroverse toys — end-to-end acceptance test',
  `Run: ${new Date().toISOString()}   Build: production (vite preview)   Viewport: ${env.size}, device pixel ratio ${env.dpr}, ${process.env.HEADED ? 'visible window' : 'headless'}`,
  `Browser: ${env.ua}`,
  `Graphics: ${env.gpu}`,
  '',
  `${passed} of ${results.length} steps passed.`,
  '',
  ...results.map((r, i) => `${r.ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${r.name}\n          ${r.info}  [${(r.ms / 1000).toFixed(1)} s]`),
  '',
  'Notes',
  ...(notes.length ? notes.map((n) => `  · ${n}`) : ['  · none']),
  '',
  'What this does not show: that anyone enjoys a toy, understands more after playing, or that the models are biologically valid.',
  'Those need the playtest (docs/NEUROVERSE_PLAYTEST.md) and an expert review; neither has been done.',
  '',
].join('\n');
writeFileSync(join(out, 'e2e-report.txt'), report);
console.log(`\n${passed} of ${results.length} steps passed. Report: docs/evidence/neuroverse/e2e-report.txt`);
process.exit(passed === results.length ? 0 : 1);
