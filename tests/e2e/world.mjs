// End-to-end test of the integrated world (#/world), in a real Chrome against the production build.
//
//   npm run build && node tests/e2e/world.mjs            (HEADED=1 to watch)
//
// Each step does what a player would do (keys, pointer, buttons) and asserts on what the application itself reports:
// the camera's pose, the models' state and fingerprints, the text on screen. Where the screen states a result, the
// same result is recomputed HERE, in this Node process, from the model's source — so "the displayed consequence matches
// the declared calculation" is checked against an independent run, not against the page's own copy.
// Writes docs/evidence/world/e2e-report.txt and docs/evidence/world/screens/*.png.
//
// What this cannot establish: that the world is enjoyable, that anyone learns from it, or that a model is
// biologically valid. Those need people and an expert; neither has happened.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { defaultSetup } from '../../src/world/model/circuits.ts';
import { probeRecording, whyTarget } from '../../src/world/model/journey.ts';
import { PROBE_TIP } from '../../src/world/model/layout.ts';
import { makeRun } from '../../src/world/model/workshopRun.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5198, BASE = `http://127.0.0.1:${PORT}`;
const out = join(root, 'docs/evidence/world'), shots = join(out, 'screens');
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
let kept = null;
const step = async (name, fn) => {
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
const has = async (id) => (await page.locator(T(id)).count()) > 0;
const wait = (ms) => page.waitForTimeout(ms);
const pose = () => page.evaluate(() => window.__world.controller.pose());
const screenOf = (p) => page.evaluate((q) => window.__world.screenOf(q), p);
const sel = () => page.evaluate(() => window.__world.store.getState().selected);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const J = () => page.evaluate(() => { const s = window.__journey.store.getState(); return { place: s.place, station: s.station, level: s.level, beats: s.beats, owner: s.owner, declared: s.declared, visited: s.visited }; });
const lab = () => page.evaluate(() => { const s = window.__lab.store.getState(), l = s.lab; return { digest: l.result.digest, runs: l.history.length, fired: l.result.firedMs, follower: l.result.followerMs, peak: l.result.peakMv, tMs: window.__lab.playheadMs(), paused: s.paused, setup: l.setup, baseDigest: l.baseline.digest, events: s.probe.events, focus: s.focus, speed: s.speed, watched: s.watched }; });
const taskNow = () => page.evaluate(() => { const t = window.__task.task.cur, s = window.__task.store.getState(); return { status: s.status, paused: s.paused, bin: t?.bin ?? 0, cursor: t?.cursor ?? null, intent: t?.intent ?? null, decoded: t?.decoded ?? null, base: t?.base ?? null, terms: t?.terms ?? null, termOf: t?.termOf ?? null, hits: t?.hits ?? 0, counts: t?.counts ?? null, decoder: s.info?.decoderId, lost: s.info?.cond.lost ?? [], cal: s.info?.calibration?.id ?? 0 }; });
const cellPos = (id) => page.evaluate((k) => { const c = window.__journey.spec.cells.find((x) => x.id === k) ?? window.__journey.spec.sites.find((x) => x.id === k); return c.pos; }, id);
const active = () => page.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? 'page' : a.closest('[data-world-view]') ? 'world' : (a.getAttribute('data-testid') ?? a.tagName); });
const settle = () => page.waitForFunction(() => !window.__world.controller.transitioning, null, { timeout: 8000 });
const fresh = async () => { await page.goto(`${BASE}/#/world`); await page.evaluate(() => { localStorage.removeItem('hbci.world.journey.v1'); localStorage.removeItem('hbci.world.pad'); localStorage.removeItem('hbci.world.keys.v1'); }); await page.reload(); await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(700); };
const goIn = async (button = 'enter') => { await page.click(T(button)); await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 }); await page.waitForFunction(() => window.__world.rt.frames > 8, null, { timeout: 20000 }); await settle(); await wait(500); };
/** Fly with keys only when the world has the keyboard: press on empty scene first (top middle, away from every panel). */
const worldFocus = () => page.evaluate(() => document.querySelector('[data-world-view]').focus());
const viewShare = () => page.evaluate(() => document.querySelector('[data-testid="world-view"]').getBoundingClientRect().height / innerHeight);
/** An idealised player of the cursor task: pushes toward the target in one of eight directions. */
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

// ══ the entrance ════════════════════════════════════════════════════════════════════════════════════════════════
await step('1 entrance: #/world opens on the whole brain with one obvious action — no chooser, no questionnaire, no page scroll', async () => {
  const t0 = Date.now();
  await fresh();
  const loadMs = Date.now() - t0;
  eq(await has('world-chooser'), false, 'the prototype chooser is not on the primary route');
  assert(await page.locator(T('enter')).isVisible(), 'the way in is visible');
  eq((await txt('enter')).trim(), 'Enter the left precentral gyrus →', 'the first action says what it does');
  const words = await page.evaluate(() => document.querySelector('[data-testid="journey"]').innerText.trim().split(/\s+/).length);
  assert(words < 60, `the entrance carries ${words} words of text (limit 60): no wall of prose`);
  const st = await page.evaluate(() => window.__brain.api.state());
  assert(st.coverage > 0.6, `the brain spans ${(st.coverage * 100).toFixed(0)} % of the height of the view`);
  const scroll = await page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight - innerHeight, y: scrollY }));
  assert(scroll.doc <= 0 && scroll.y === 0, 'nothing to scroll');
  eq((await J()).place, 'brain', 'place');
  await shot('01-entrance');
  return `brain on screen ${(st.coverage * 100).toFixed(0)} % of the view’s height; ${words} words of text; ready ${(loadMs / 1000).toFixed(1)} s after two page loads (cold cache not measured here)`;
});

await step('2 whole brain: drag turns it, hover names the atlas region, a click selects it; the precentral gyrus is not passed off as M1', async () => {
  const a0 = await page.evaluate(() => window.__brain.api.state());
  await page.mouse.move(560, 380); await page.mouse.down(); await page.mouse.move(700, 340, { steps: 12 }); await page.mouse.up(); await wait(900);
  const a1 = await page.evaluate(() => window.__brain.api.state());
  assert(Math.abs(a1.az - a0.az) > 0.3, `the drag turned the brain (${(a1.az - a0.az).toFixed(2)} rad)`);
  eq(await has('region-card'), false, 'a drag selects nothing');
  // the same without a pointer: arrow keys turn it, + moves closer, 0 is the opening view
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Equal'); await wait(200);
  const a2 = await page.evaluate(() => window.__brain.api.state());
  assert(Math.abs(a2.az - a1.az) > 0.15 && a2.dist < a1.dist, 'arrow keys turn the brain and + moves closer');
  await page.keyboard.press('Digit0'); await wait(1100);
  // hover: the tag carries the atlas's own name for the structure under the pointer
  const p = await page.evaluate(() => window.__brain.api.screenOf('left_precentral_gyrus'));
  assert(p, 'a visible point of the left precentral gyrus was found');
  await page.mouse.move(p.x, p.y); await wait(350);
  eq((await txt('brain-hover')).split('\n')[0].trim().toLowerCase(), 'left precentral gyrus', 'hover names the structure');
  await page.mouse.click(p.x, p.y); await wait(300);
  eq(await attr('region-card', 'data-region'), 'left_precentral_gyrus', 'selected region');
  const card = await txt('region-card');
  assert(/ATLAS LABEL/.test(card) && /area 4/.test(card) && /atlas does not contain/.test(card), 'the card says what the atlas labels and what it does not contain');
  assert(await has('region-enter'), 'this region can be entered');
  await shot('02-region-selected');
  // another region: named, selectable, and honestly not enterable
  const other = await page.evaluate(() => { const api = window.__brain.api; for (const id of ['left_superior_temporal_gyrus', 'left_middle_frontal_gyrus', 'left_angular_gyrus', 'left_supramarginal_gyrus']) { const q = api.screenOf(id); if (q) return { id, ...q }; } return null; });
  assert(other, 'another visible region was found');
  await page.mouse.click(other.x, other.y); await wait(300);
  eq(await attr('region-card', 'data-region'), other.id, 'the other region is selected');
  assert(/no circuit to enter here/.test(await txt('region-card')) && !(await has('region-enter')) && (await has('region-show')), 'no circuit is invented for it');
  await page.keyboard.press('Escape'); await wait(200);
  eq(await has('region-card'), false, 'Escape clears the selection');
  return `drag turned the view ${(a1.az - a0.az).toFixed(2)} rad; hover and click resolve atlas structures (also ${other.id.replace(/_/g, ' ')}, which offers no circuit)`;
});

await step('3 going in: a reversible dive with a statement of what changes; the tissue fills the view and the brain stays as a map', async () => {
  await page.click(T('enter'));
  await page.waitForSelector(`${T('veil')}[data-veil="in"], ${T('veil')}[data-veil="hold"]`, { timeout: 4000 });
  const veil = await txt('veil');
  assert(/atlas ends at the surface/.test(veil) && /illustrative/.test(veil) && /not cells from this brain/.test(veil) && /100 µm/.test(veil), 'the caption says the atlas ends and an illustration begins, with the scale');
  await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 20000 });
  await page.waitForFunction(() => window.__world.rt.frames > 8, null, { timeout: 20000 });
  await settle(); await wait(700);
  const j = await J();
  eq(j.station, 'circuit', 'arrives at the circuit'); assert(j.beats.enter && j.visited, 'the route knows');
  assert(/left precentral gyrus/.test(await txt('where')) && /ILLUSTRATIVE/.test(await txt('source-chip')), 'the location line names the region and says the tissue is illustrative');
  eq(await attr('brain-layer', 'data-as'), 'map', 'the brain is now the small map');
  const share = await viewShare();
  assert(share > 0.82, `the 3D view takes ${(share * 100).toFixed(0)} % of the window’s height at the “Observe” level`);
  assert(/Five-cell circuit/.test(await txt('running')) && /slow motion ×1\/200/.test(await txt('running')) && /model running/.test(await txt('running')), 'the status line says which model runs and how slowed down');
  eq((await txt('t-replay')).trim(), '↺ Replay the two inputs', 'the replay control says what it replays');
  await shot('03-arrived');
  return `3D view ${(share * 100).toFixed(0)} % of the window height; status: “${(await txt('running')).replace(/\s+/g, ' ').slice(0, 96)}…”`;
});

// ══ moving and selecting ════════════════════════════════════════════════════════════════════════════════════════
await step('4 flight: keys move the observer and it stops by itself; drag looks without selecting; the wheel glides; the model is untouched', async () => {
  await worldFocus();
  const d0 = (await lab()).digest, p0 = await pose();
  await hold('KeyW', 500); await wait(450);
  const p1 = await pose(); await wait(300); const p1b = await pose();
  const fwd = dist(p0.pos, p1.pos);
  assert(fwd > 30 && fwd < 110, `W for half a second moved ${fwd.toFixed(0)} µm`);
  assert(dist(p1.pos, p1b.pos) < 0.01, 'no drift after the key is released');
  // drag to look: the view turns, nothing is selected, the observer does not move
  await page.mouse.move(720, 300); await page.mouse.down(); await page.mouse.move(600, 330, { steps: 10 }); await page.mouse.up(); await wait(150);
  const p2 = await pose();
  assert(Math.abs(p2.yaw - p1b.yaw) > 0.15, 'the drag turned the view'); assert(dist(p2.pos, p1b.pos) < 0.01, 'and did not move the observer');
  eq(await sel(), null, 'a drag never selects');
  // wheel: a glide along the line of sight that ends by itself
  await page.mouse.move(720, 300); await page.mouse.wheel(0, -240); await wait(700);
  const p3 = await pose(); await wait(250); const p3b = await pose();
  assert(dist(p2.pos, p3.pos) > 12, `the wheel moved the observer ${dist(p2.pos, p3.pos).toFixed(0)} µm`); assert(dist(p3.pos, p3b.pos) < 0.01, 'and it came to rest');
  // brake: Shift makes movement precise
  await page.keyboard.down('ShiftLeft'); await hold('KeyW', 500); await page.keyboard.up('ShiftLeft'); await wait(300);
  const p4 = await pose();
  assert(dist(p3b.pos, p4.pos) < fwd * 0.4, 'with Shift held the same key moves much less');
  const l = await lab();
  eq(l.digest, d0, 'the run’s fingerprint is the same after flying around'); eq(l.runs, 1, 'no run was created by moving');
  assert((await J()).beats.explore, 'the route noticed that the player has flown');
  return `W 0.5 s → ${fwd.toFixed(0)} µm, stops dead; drag turned ${Math.abs(p2.yaw - p1b.yaw).toFixed(2)} rad; wheel glide ${dist(p2.pos, p3.pos).toFixed(0)} µm; with Shift ${dist(p3b.pos, p4.pos).toFixed(0)} µm; model fingerprint unchanged (${d0})`;
});

await step('5 mouse capture: the capturing click selects nothing; then the centre mark selects; Escape gives the pointer back and drops held keys', async () => {
  await page.evaluate(() => { const c = window.__world.controller; c.flyFromHere(); c.home(window.__journey.spec.home.pos, window.__journey.spec.home.lookAt); });
  await wait(200);
  await page.click(T('btn-capture')); await wait(250);
  await page.mouse.move(700, 300);                             // over the scene, as a captured pointer always is
  const real = await page.evaluate(() => !!document.pointerLockElement);
  if (!real) {
    assert(/did not hand over the mouse/.test(await txt('notice')), 'a refused capture is said, with the alternative');
    await page.evaluate(() => { window.__lock = document.querySelector('[data-testid="world-view"] canvas'); Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => window.__lock ?? null }); document.dispatchEvent(new Event('pointerlockchange')); });
    notes.push('Pointer capture: headless Chrome does not grant pointer lock. The refusal message was checked, then the browser’s grant was simulated (lock element + pointerlockchange) and the page’s own handling — reticle, centre-mark selection, release, forgetting held keys — was tested against that. The real grant, in a visible Chrome window, is recorded in docs/evidence/world/performance.txt; the embedded browser pane of the Claude app refused it when it was last tried there.');
  }
  await wait(150);
  eq(await attr('journey', 'data-captured'), '1', 'captured'); assert(await has('reticle'), 'the centre mark is shown');
  eq(await sel(), null, 'the click that asked for capture selected nothing');
  // aim the centre of the view at T, then click: the centre mark selects, wherever the pointer is
  const T0 = await cellPos('T');
  await page.evaluate((t) => { const c = window.__world.controller, p = c.pose(), dx = t[0] - p.pos[0], dy = t[1] - p.pos[1], dz = t[2] - p.pos[2]; c.setPose({ pos: p.pos, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }); }, T0);
  await wait(500);
  // a press without moving the mouse (moving it would turn the view, as it should while captured): the pointer is at
  // (700, 300), nowhere near T on screen — what is selected is what the centre mark is on
  const where = await screenOf(T0);
  assert(Math.hypot(where.x - 700, where.y - 300) > 60, 'the pointer is not over T');
  await page.mouse.down(); await page.mouse.up(); await wait(250);
  eq((await sel())?.id, 'T', 'the centre mark selected the target cell although the pointer was elsewhere');
  await page.keyboard.down('KeyW'); await wait(120);
  await page.evaluate(() => { window.__lock = null; document.dispatchEvent(new Event('pointerlockchange')); });
  await wait(200);
  eq(await attr('journey', 'data-captured'), '0', 'released');
  eq(await page.evaluate(() => window.__world.controller.held.size), 0, 'a key that was held when the pointer came back is forgotten');
  await wait(450);                                             // the observer coasts to rest within a few tenths of a second
  const a = await pose(); await wait(350); const b = await pose();
  await page.keyboard.up('KeyW');
  assert(dist(a.pos, b.pos) < 0.01, 'and although the key is still physically down, the observer has stopped');
  await page.evaluate(() => { delete document.pointerLockElement; });
  return `capture ${real ? 'granted by the browser' : 'refused by headless Chrome (message shown), then simulated'} → no selection on the capturing click → centre mark selects T → release forgets held keys`;
});

await step('6 selection: a click selects the cell under the pointer; its readout is the model’s value at the playhead; focus and exact return', async () => {
  await page.evaluate(() => { if (window.__lock !== undefined) { window.__lock = null; delete document.pointerLockElement; document.dispatchEvent(new Event('pointerlockchange')); } });
  await page.evaluate(() => { const c = window.__world.controller; c.home(window.__journey.spec.home.pos, window.__journey.spec.home.lookAt); window.__world.store.getState().select(null); });
  await wait(250);
  const at = await screenOf(await cellPos('T'));
  assert(at.visible, 'T is in view from the arrival pose');
  await page.mouse.click(at.x, at.y); await wait(250);
  eq((await sel())?.id, 'T', 'click selects T');
  assert(await page.locator(T('cell-tag-T')).isVisible(), 'the cell is named in the scene');
  // pause so that screen and model can be compared at one instant
  await worldFocus(); await page.keyboard.press('Space'); await wait(200);
  const l = await lab();
  assert(l.paused, 'paused');
  const want = await page.evaluate(() => { const r = window.__lab.store.getState().lab.result.run, i = r.circuit.cells.findIndex((c) => c.id === 'T'); return r.v[i][Math.min(r.nSteps, window.__lab.clock.step())]; });
  near(parseFloat((await txt('cell-v')).replace('−', '-')), want, 0.06, 'the card shows the membrane potential the run holds at the playhead');
  const before = await pose();
  await page.keyboard.press('KeyF'); await settle(); await wait(150);
  eq(await attr('journey', 'data-mode'), 'orbit', 'focus is an orbit');
  const closer = await pose();
  assert(dist(closer.pos, await cellPos('T')) < dist(before.pos, await cellPos('T')), 'focus moved towards the cell');
  await page.keyboard.press('KeyR'); await settle(); await wait(150);
  const back = await pose();
  assert(dist(back.pos, before.pos) < 1e-6 && Math.abs(back.yaw - before.yaw) < 1e-9 && Math.abs(back.pitch - before.pitch) < 1e-9, 'Return restores the pose exactly');
  await page.keyboard.press('Space'); await wait(100);
  return `card ${await txt('cell-v')} = run value ${want.toFixed(1)} mV at the playhead; F focuses, R returns to the exact pose`;
});

// ══ the experiment ══════════════════════════════════════════════════════════════════════════════════════════════
await step('7 pause: the model stops, the observer does not; Step advances a quarter of a millisecond', async () => {
  await worldFocus();
  await page.click(T('t-replay')); await wait(600);
  await page.keyboard.press('Space'); await wait(150);
  const a = await lab(), p0 = await pose();
  assert(a.paused && /paused/.test(await txt('t-time')) && /model paused — you can still move/.test(await txt('running')), 'paused, and the screen says so');
  await hold('KeyD', 450); await wait(350);
  const b = await lab(), p1 = await pose();
  eq(b.tMs, a.tMs, 'model time did not move while paused'); assert(dist(p0.pos, p1.pos) > 20, `the observer moved ${dist(p0.pos, p1.pos).toFixed(0)} µm while the model was paused`);
  await page.keyboard.press('Period'); await wait(120);
  near((await lab()).tMs - a.tMs, 0.25, 1e-9, 'one step is 0.25 ms of model time');
  await page.keyboard.press('Space'); await wait(500);
  assert((await lab()).tMs > a.tMs + 0.5 && !(await lab()).paused, 'Space resumes');
  return `paused at ${a.tMs.toFixed(2)} ms: observer moved ${dist(p0.pos, p1.pos).toFixed(0)} µm, model time unchanged; Step = +0.25 ms`;
});

await step('8 one cause: making input B fire 8 ms earlier is the only change — and the target fires; the screen’s numbers are the model’s', async () => {
  await page.click(T('t-reset')); await wait(300);
  const before = await lab();
  eq(before.fired, null, 'as found, T does not fire'); eq(before.runs, 1, 'first run');
  const said0 = await txt('say');
  assert(/did not fire/.test(said0) && /0\.7 mV short/.test(said0), `the sentence states the outcome: “${said0.split('\n')[0]}”`);
  await page.selectOption(T('goto'), 'B'); await settle(); await wait(200);
  eq((await sel())?.id, 'B', 'B selected');
  await page.click(T('bMs-earlier4')); await wait(120); await page.click(T('bMs-earlier4')); await wait(500);
  const l = await lab();
  eq(await attr('say', 'data-changes'), 'bMs', 'exactly one declared cause differs from the baseline');
  eq(l.setup.bMs, 14, 'B at 14 ms'); eq(l.runs, 3, 'two presses of “4 ms earlier” are two runs'); assert(l.fired != null && l.follower != null, 'T fired and D followed');
  // the same experiment, computed here from the model's source
  const mine = makeRun({ ...defaultSetup(0), bMs: 14 });
  eq(l.digest, mine.digest, 'the page’s run and an independent run of the model end in the same state');
  near(l.fired, mine.firedMs, 1e-9, 'same spike time');
  const said = await txt('say');
  assert(said.includes(`fired at ${mine.firedMs.toFixed(1)} ms`) && said.includes(`D followed at ${mine.followerMs.toFixed(1)} ms`), 'the sentence carries those numbers');
  eq((await J()).level, 'understand', 'the linked trace opened on the first change');
  const why = whyTarget(mine);
  assert((await txt('say-why')).includes(`${why.fromA.toFixed(1)} mV`) && (await txt('say-why')).includes(`${why.fromB.toFixed(1)} mV`), 'the explanation’s contributions are the model’s one-input runs');
  assert(/when input b fires \(22 ms → 14 ms\)/.test(await txt('say-compare')), 'the comparison names what was changed');
  // the scene shows it: at the model's spike time the target flashes and an event is on its way to D
  await page.evaluate((ms) => { window.__lab.store.setState({ loop: false }); window.__lab.seekMs(ms); window.__lab.clock.paused = true; }, mine.firedMs + 0.3);
  await wait(250);
  const scene = await page.evaluate(() => ({ flashT: window.__world.rt.flash[3], flashD: window.__world.rt.flash[4], pulses: window.__world.rt.pulses.map((p) => p.link) }));
  assert(scene.flashT > 0.3 && scene.flashD === 0 && scene.pulses.includes(4), `in the scene T has just fired (flash ${scene.flashT.toFixed(2)}), D has not yet, and an event is travelling T → D`);
  await shot('04-changed-fired');
  await page.evaluate(() => { window.__lab.store.setState({ loop: true }); window.__lab.replay(); });
  return `B 22 → 14 ms: T fires at ${mine.firedMs.toFixed(2)} ms, D at ${mine.followerMs.toFixed(2)} ms; fingerprint ${l.digest} equals an independent run; A contributes ${why.fromA.toFixed(1)} mV and B ${why.fromB.toFixed(1)} mV at that moment`;
});

await step('9 replay and compare: replaying is the same recording (not a new experiment); baseline, undo and reset restore exactly', async () => {
  const a = await lab();
  await page.click(T('t-replay')); await wait(900);
  const b = await lab();
  eq(b.digest, a.digest, 'same fingerprint after Replay'); eq(b.runs, a.runs, 'Replay does not create a run'); eq(JSON.stringify(b.events), JSON.stringify(a.events), 'the probe’s events are the same ones');
  assert(b.tMs > 1 && b.tMs < 20, 'it is playing again from the start');
  // a second change, then undo it
  await page.selectOption(T('goto'), 'I'); await settle(); await wait(150);
  await page.click(T('card-inhibit')); await wait(400);
  const c = await lab();
  eq(await attr('say', 'data-changes'), 'bMs,conn:I>T', 'two declared causes now differ from the baseline'); eq(c.runs, a.runs + 1, 'one more run');
  eq(c.digest, makeRun({ ...defaultSetup(0), bMs: 14, conn: { 'I>T': true } }).digest, 'independent run agrees');
  eq(c.fired, null, 'with inhibition on, the same timing no longer works');
  await shot('05-inhibition-compared');
  await page.click(T('t-undo')); await wait(300);
  const d = await lab();
  eq(d.digest, a.digest, 'Undo returns to the earlier run, to the bit'); eq(d.runs, a.runs, 'history is one shorter');
  await page.click(T('t-baseline')); await wait(300);
  const e = await lab();
  eq(e.digest, e.baseDigest, 'Back to baseline gives the baseline’s result'); eq(await attr('say', 'data-changes'), '', 'nothing differs');
  await page.click(T('t-undo')); await wait(250);
  eq((await lab()).digest, a.digest, 'and that, too, can be undone');
  await page.click(T('t-reset')); await wait(350);
  const f = await lab();
  eq(f.digest, makeRun(defaultSetup(0)).digest, 'Reset is the circuit as found'); eq(f.runs, 1, 'history cleared'); eq(f.baseDigest, f.digest, 'baseline restored'); eq(f.speed, 5, 'playback restored'); assert(!f.paused && f.tMs < 3, 'and it plays from the start');
  return `Replay: same fingerprint ${a.digest}, same run number; inhibition on → no spike (independent run agrees); Undo, Back to baseline and Reset each restore the expected fingerprint`;
});

await step('10 outside the cells: the probe is a different quantity (µV, not mV) and counts the target’s spike and little else', async () => {
  await page.selectOption(T('goto'), 'B'); await settle(); await page.click(T('bMs-earlier4')); await wait(100); await page.click(T('bMs-earlier4')); await wait(400);
  await page.selectOption(T('goto'), 'probe'); await settle(); await wait(200);
  eq((await sel())?.kind, 'site', 'the probe is selected as a recording site, not as a cell');
  assert(await page.locator(T('site-tag-probe')).isVisible(), 'a selection made from the list is named in the scene exactly as a hovered one is');
  const card = await txt('card');
  assert(/SYNTHETIC OBSERVATION/.test(card) && /µV/.test(card) && /Not a recording/.test(card), 'it is labelled a synthetic observation, in microvolts');
  const mine = probeRecording(makeRun({ ...defaultSetup(0), bMs: 14 }).run, PROBE_TIP), l = await lab();
  eq(JSON.stringify(l.events.map((e) => [e.ms, e.cell])), JSON.stringify(mine.events.map((e) => [e.ms, e.cell])), 'the page’s detected events are the ones an independent computation gives');
  const t = mine.events.find((e) => e.cell === 'T');
  assert(t && t.ampUv > 80, `T’s spike is ${t?.ampUv.toFixed(0)} µV at the probe`);
  assert((await txt('say-probe')).includes(`${t.ampUv.toFixed(0)} µV`), 'the sentence gives that size');
  // the two traces share a time axis but not a unit: the canvas is described as such
  assert(/millivolts/.test(await attr('trace', 'aria-label')) && /microvolts/.test(await attr('trace', 'aria-label')), 'the linked trace names both quantities');
  assert((await J()).beats.record, 'route step done');
  await shot('06-probe');
  return `probe counts ${mine.events.length} crossing(s) in this run; T’s is ${t.ampUv.toFixed(0)} µV (threshold ${mine.thresholdUv} µV), independent computation agrees`;
});

// ══ who owns the keyboard ═══════════════════════════════════════════════════════════════════════════════════════
await step('11 input ownership: a clicked button does not take the keys; a list or slider does, until Escape; a button reached with Tab behaves as a button', async () => {
  await page.click(T('btn-return')).catch(() => undefined); await wait(200);
  await page.click(T('t-replay')); await wait(250);
  eq(await active(), 'world', 'after a mouse click on a HUD button the keyboard is still the world’s');
  eq((await J()).owner, 'observer', 'the owner shown is the observer');
  await page.keyboard.press('Space'); await wait(120);
  assert((await lab()).paused, 'Space paused the model (it did not press the button again)');
  await page.keyboard.press('Space'); await wait(120);
  // a list takes the focus, and the keys with it
  await page.locator(T('t-speed')).focus(); await wait(120);
  eq((await J()).owner, 'interface', 'the owner shown is the interface control'); assert(/Esc returns them/.test(await txt('owner')), 'and the chip says how to get the keys back');
  const p0 = await pose(), t0 = await lab();
  await hold('KeyW', 350); await page.keyboard.press('Space'); await wait(250);
  const p1 = await pose(), t1 = await lab();
  assert(dist(p0.pos, p1.pos) < 1e-6, 'W does not fly while a control has the keyboard'); assert(!t1.paused && t1.tMs !== t0.tMs, 'and Space did not pause the model');
  await page.keyboard.press('Escape'); await wait(150);
  eq(await active(), 'world', 'Escape hands the keyboard back'); eq((await J()).owner, 'observer', 'owner: observer');
  await hold('KeyW', 300); await wait(300);
  assert(dist(p1.pos, (await pose()).pos) > 10, 'and W flies again');
  // a slider keeps its arrow keys
  await page.selectOption(T('goto'), 'B'); await settle(); await wait(150);
  const r0 = (await lab()).setup.bMs, q0 = await pose();
  await page.locator(T('bMs-range')).focus(); await page.keyboard.press('ArrowLeft'); await wait(250);
  near((await lab()).setup.bMs, r0 - 0.25, 1e-9, 'the arrow key moved the slider by one step'); assert(dist(q0.pos, (await pose()).pos) < 1e-6, 'and not the observer');
  await page.keyboard.press('Escape'); await wait(120);
  // a button reached with the keyboard is pressed by Space, as buttons are
  await page.locator(T('t-pause')).focus(); await page.keyboard.press('Space'); await wait(150);
  const paused = (await lab()).paused;
  eq(await active(), 't-pause', 'a button focused from the keyboard keeps the focus'); assert(paused, 'and Space pressed it');
  await page.keyboard.press('Space'); await wait(120); await page.keyboard.press('Escape'); await wait(100);
  await page.click(T('t-undo')); await wait(200);
  return 'clicked button → world keeps the keys (Space pauses); list and slider own their keys until Esc; Tab-focused button is pressed by Space';
});

// ══ the decoder ═════════════════════════════════════════════════════════════════════════════════════════════════
await step('12 a different model, declared: at the array the circuit stops, a statement says what does and does not carry over, then the task starts', async () => {
  const before = await lab();
  await page.selectOption(T('goto'), 'array'); await settle(); await wait(500);
  eq((await J()).station, 'array', 'station');
  assert(await page.locator(T('declare')).isVisible(), 'the statement is shown before anything runs');
  const d = await txt('declare');
  assert(/different model/i.test(d) && /24 model units/.test(d) && /Nothing computed in the circuit feeds the decoder/.test(d) && /Nothing here reads a brain/.test(d), 'it says what is different and what carries over');
  const b0 = (await taskNow()).bin; await wait(500);
  eq((await taskNow()).bin, b0, 'the task does not advance until the statement has been acknowledged');
  const mid = await lab(); await wait(400);
  eq((await lab()).tMs, mid.tMs, 'the five-cell circuit is not advancing'); eq((await lab()).digest, before.digest, 'and is untouched');
  const idle = await page.evaluate(() => Array.from(window.__world.rt.dim.slice(0, 5)));
  assert(idle.every((v) => v === 0.5), 'its cells are drawn idle');
  await shot('07-declared');
  await page.click(T('declare-ok'));
  await page.waitForFunction(() => window.__task.store.getState().status === 'ready' && window.__task.store.getState().info?.calibration, null, { timeout: 20000 });
  await page.waitForFunction((b) => (window.__task.task.cur?.bin ?? 0) > b + 4, b0, { timeout: 8000 });
  assert(/Electrode array/.test(await txt('where')) && /Decoder task/.test(await txt('running')) && /real time/.test(await txt('running')), 'location and status say what runs now');
  assert(/intent is zero until you take the controls/.test(await txt('running')), 'and that nothing is being steered yet');
  const z = await taskNow();
  eq(JSON.stringify(z.intent), '[0,0]', 'intent is zero');
  return 'statement shown; task waits for it; circuit frozen and untouched; then the task runs in real time with zero intent';
});

await step('13 piloting: the keys become the intent and nothing else — the observer does not move; the cursor moves by the decoder’s own terms', async () => {
  await worldFocus();
  await page.keyboard.press('KeyP'); await settle(); await wait(400);
  eq(await attr('journey', 'data-context'), 'pilot', 'pilot context'); eq((await J()).owner, 'pilot', 'owner: your intent');
  assert(/your intent/.test(await txt('owner')) && /intent/.test(await txt('move-note')), 'the screen says whose keys these are');
  const p0 = await pose(), c0 = await taskNow();
  await page.keyboard.down('KeyD'); await wait(900);
  const mid = await taskNow();
  await wait(500); await page.keyboard.up('KeyD'); await wait(200);
  const p1 = await pose(), c1 = await taskNow();
  assert(dist(p0.pos, p1.pos) < 1e-9 && p0.yaw === p1.yaw && p0.pitch === p1.pitch, 'the observer did not move at all while piloting');
  eq(JSON.stringify(mid.intent), '[1,0]', 'D is “intend right” at full speed');
  assert(c1.cursor[0] - c0.cursor[0] > 0.3, `the cursor went right by ${(c1.cursor[0] - c0.cursor[0]).toFixed(2)} of its workspace`);
  // routing, from the snapshots the page drew: decoded = base + Σ per-contact terms, and one bin's step = decoded × v_max × 50 ms
  const two = await page.evaluate(async () => { const t = window.__task.task; const wait = (c) => new Promise((r) => { const tick = () => (c() ? r() : setTimeout(tick, 8)); tick(); }); const b = t.cur.bin; await wait(() => t.cur.bin > b && t.prev && t.cur.bin === t.prev.bin + 1 && !t.cur.ended); return { prev: t.prev, cur: t.cur }; });
  eq(two.cur.termOf, 'channel', 'the linear decoder’s terms are per contact');
  for (let o = 0; o < 2; o++) {
    near(two.cur.terms[o].reduce((a, v) => a + v, two.cur.base[o]), two.cur.decoded[o], 1e-9, 'base + terms = decoded');
    near(two.cur.cursor[o] - two.prev.cursor[o], Math.max(-1.15, Math.min(1.15, two.prev.cursor[o] + two.cur.decoded[o] * 1.4 * 0.05)) - two.prev.cursor[o], 1e-9, 'cursor step = decoded velocity × bin');
  }
  // no key held → no intent
  await wait(200);
  eq(JSON.stringify((await taskNow()).intent), '[0,0]', 'with no key held the intent is zero');
  await shot('08-piloting');
  await page.keyboard.press('Escape'); await wait(250);
  eq(await attr('journey', 'data-context'), 'explore', 'Escape gives the keys back to the observer');
  await hold('KeyW', 300); await wait(300);
  assert(dist(p1.pos, (await pose()).pos) > 8, 'and they fly again');
  return `observer pose identical before and after piloting; cursor +${(c1.cursor[0] - c0.cursor[0]).toFixed(2)} for “right”; base + Σ contact terms = decoded to 1e-9; Esc returns the keys`;
});

await step('14 break and recover: three contacts lost → control degrades; a different decoder (no refit) and a recalibration (refit) both bring it back', async () => {
  await page.click(T('t-reset')); await page.waitForFunction(() => window.__task.store.getState().status === 'ready' && window.__task.store.getState().info?.calibration, null, { timeout: 20000 }); await wait(300);
  await worldFocus(); await page.keyboard.press('KeyP'); await settle(); await wait(300);
  const h0 = (await taskNow()).hits; await steer(12000); const ref = (await taskNow()).hits - h0;
  assert(ref >= 4, `reference: ${ref} targets in 12 s`);
  await page.click(T('t-fault-lost')); await wait(400); await worldFocus();
  eq(JSON.stringify((await taskNow()).lost), '[0,3,5]', 'contacts 1, 4 and 6 are lost');
  const h1 = (await taskNow()).hits; await steer(12000); const broken = (await taskNow()).hits - h1;
  const lostCounts = await page.evaluate(() => { const c = window.__task.task.cur.counts; return c[0] + c[3] + c[5]; });
  eq(lostCounts, 0, 'the lost contacts deliver nothing');
  assert(broken < ref, `with three contacts lost the same player reaches ${broken} (was ${ref})`);
  await shot('09-contacts-lost');
  // way back 1: another fitted decoder, nothing refitted
  const cal0 = (await taskNow()).cal;
  await page.click(T('dec-kalman')); await wait(300); await worldFocus();
  eq((await taskNow()).decoder, 'kalman', 'Kalman filter drives the cursor'); eq((await taskNow()).cal, cal0, 'no recalibration happened');
  const h2 = (await taskNow()).hits; await steer(12000); const kalman = (await taskNow()).hits - h2;
  // way back 2: the first decoder again, refitted under the present conditions
  await page.click(T('dec-linear')); await wait(200); await page.click(T('t-calibrate'));
  await page.waitForFunction((c) => window.__task.store.getState().status === 'ready' && (window.__task.store.getState().info?.calibration?.id ?? 0) > c, cal0, { timeout: 20000 });
  await wait(300); await worldFocus();
  const h3 = (await taskNow()).hits; await steer(12000); const recal = (await taskNow()).hits - h3;
  assert(Math.max(kalman, recal) > broken, `a recovery helped: Kalman without refit ${kalman}, recalibrated linear ${recal}, broken ${broken}`);
  assert(recal >= ref - 3, `after recalibration the player is back near the reference (${recal} vs ${ref})`);
  const j = await J();
  assert(j.beats.disrupt && j.beats.recover, 'the route’s break-and-recover steps were ticked by the task itself');
  await shot('10-recovered');
  // the whole session replays from its log to the same cursor path
  await page.keyboard.press('Escape'); await wait(150);
  await page.click(T('t-verify')); await page.waitForFunction(() => /cursor path is identical|path differs/.test(document.querySelector('[data-testid="notice"]').innerText), null, { timeout: 30000 });
  assert(/cursor path is identical/.test(await txt('notice')), 'replaying the command log reproduces the cursor path');
  await page.click(T('t-restore')); await wait(300);
  eq(JSON.stringify((await taskNow()).lost), '[]', 'contacts restored');
  notes.push(`Decoder task, scripted player, 12 s each: reference ${ref} targets; three contacts lost ${broken}; Kalman filter without refitting ${kalman}; linear after recalibration ${recal}. One session, one seed — an illustration of the mechanism, not a comparison of decoders.`);
  return `targets in 12 s — reference ${ref}; contacts lost ${broken}; Kalman (no refit) ${kalman}; recalibrated linear ${recal}; replay from the log: identical path`;
});

await step('15 the engineering behind it stays reachable and honest: the bypassed stages are named, and the full chain is one click away', async () => {
  await page.click(T('level-inspect')); await wait(200);
  const chain = await txt('chain');
  assert(/24 model units/.test(chain) && /approximated/.test(chain) && /fitted decoder/.test(chain), 'the chain strip marks the approximated stages');
  await page.click(T('btn-model')); await wait(250);
  const panel = await page.locator(T('panel-model')).evaluate((el) => el.textContent);
  assert(/Bypassed here/.test(panel) && /waveform synthesis, amplifier, ADC/.test(panel) && /Nothing computed in the five-cell circuit feeds the decoder/.test(panel), 'the panel states the approximation and the model boundary');
  assert(/counts per contact within ±30 %/.test(panel), 'and the tested correspondence with the full chain');
  await shot('11-inspect-decoder');
  kept = await page.evaluate(() => { window.__journey.store.getState().remember({ pose: window.__world.controller.pose() }); const l = window.__lab.store.getState().lab; return { digest: l.result.digest, runs: l.history.length }; });
  await wait(600);                                             // the visit is written to storage a moment after a change
  await page.click(T('open-experiment')); await wait(900);
  const ws = await page.evaluate(() => document.querySelector('.shell')?.getAttribute('data-workspace'));
  eq(ws, 'experiment', 'the Experiment scene (full chain) opened');
  await page.goto(`${BASE}/#/world`); await page.reload(); await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(500);
  return 'chain strip and panel name the bypassed stages; the Experiment scene opens from the panel';
});

// ══ coming back ═════════════════════════════════════════════════════════════════════════════════════════════════
await step('16 return: out to the brain and back in without losing the experiment — also after closing the page', async () => {
  assert(await page.locator(T('resume')).isVisible(), 'after a reload the entrance offers the way back to where the player was');
  await goIn('resume');
  const a = await lab();
  assert(kept && kept.runs > 1, 'there was an experiment to come back to');
  eq(a.runs, kept.runs, 'the history came back'); eq(a.digest, kept.digest, 'and the run is the same run (recomputed from its causes: same fingerprint)');
  await worldFocus(); await hold('KeyW', 400); await wait(400);
  const here = await pose();
  await page.click(T('map')); await page.waitForSelector(`${T('journey')}[data-place="brain"]`, { timeout: 12000 }); await wait(500);
  eq(await attr('brain-layer', 'data-as'), 'stage', 'the brain is the stage again');
  const st = await page.evaluate(() => window.__brain.api.state());
  assert(st.coverage > 0.6, 'composed as at the entrance');
  assert((await J()).beats.return, 'route step done');
  await shot('12-back-on-the-brain');
  await goIn('resume');
  const b = await lab(), back = await pose();
  eq(b.digest, a.digest, 'same run'); eq(b.runs, a.runs, 'same history');
  assert(dist(back.pos, here.pos) < 1 && Math.abs(back.yaw - here.yaw) < 1e-6, 'and the observer is where it was');
  return `history of ${a.runs} runs and fingerprint ${a.digest} survive a page reload and a trip out and back; the observer returns to its pose`;
});

await step('17 smaller windows: nothing essential is covered, the page never scrolls, and the world keeps most of the height', async () => {
  const rows = [];
  if ((await J()).station !== 'circuit') { await page.selectOption(T('goto'), 'circuit'); await settle(); await wait(300); }
  for (const [w, h] of [[1280, 720], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h }); await wait(500);
    for (const level of ['observe', 'understand']) {
      await page.click(T(`level-${level}`)); await wait(250);
      const r = await page.evaluate((ids) => {
        const bad = [];
        for (const id of ids) {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el) { bad.push(`${id}: missing`); continue; }
          const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          if (b.left < 0 || b.top < 0 || b.right > innerWidth + 0.5 || b.bottom > innerHeight + 0.5) { bad.push(`${id}: off screen`); continue; }
          const top = document.elementFromPoint(cx, cy);
          if (!(top && (el === top || el.contains(top) || top.contains(el)))) bad.push(`${id}: covered by ${top?.getAttribute('data-testid') ?? top?.className}`);
        }
        return { bad, share: document.querySelector('[data-testid="world-view"]').getBoundingClientRect().height / innerHeight, overflow: document.scrollingElement.scrollHeight - innerHeight };
      }, ['crumb-brain', 'btn-model', 'btn-controls', 'btn-studio', 't-replay', 't-pause', 't-step', 't-undo', 't-reset', 'level-observe', 'level-understand', 'level-inspect', 'map', 'goto', 'say', ...(level === 'understand' ? ['trace'] : [])]);
      eq(r.bad.join('; '), '', `${w}×${h} ${level}: every essential control is on screen and uncovered`);
      assert(r.overflow <= 0, `${w}×${h}: the page has nothing to scroll`);
      assert(r.share >= (level === 'observe' ? 0.8 : 0.6), `${w}×${h} ${level}: the 3D view has ${(r.share * 100).toFixed(0)} % of the height`);
      rows.push(`${w}×${h} ${level} ${(r.share * 100).toFixed(0)} %`);
    }
    // wheel and keys over the world do not scroll anything
    await worldFocus(); await page.mouse.move(w / 2, 220); await page.mouse.wheel(0, 400); await page.keyboard.press('Space'); await page.keyboard.press('Space'); await wait(200);
    const sc = await page.evaluate(() => ({ y: scrollY, main: document.querySelector('.shell-main')?.scrollTop ?? 0, j: document.querySelector('[data-testid="journey"]').scrollTop }));
    eq(sc.y + sc.main + sc.j, 0, `${w}×${h}: wheel and Space over the world scroll nothing`);
    if (w === 1024) await shot('13-small-window');
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await wait(300);
  return `share of the window height taken by the 3D view — ${rows.join('; ')}`;
});

await step('18 the studio is still there: a discreet menu opens the atlas, and the three earlier prototypes are kept as development aids', async () => {
  await page.click(T('btn-studio')); await wait(150);
  const menu = await txt('studio-menu');
  assert(/Atlas/.test(menu) && /Experiment/.test(menu) && /Chip/.test(menu) && /Decoder/.test(menu) && /Research/.test(menu) && /Prototype lab/.test(menu), 'every scene of the studio is listed');
  await page.click(T('studio-brain')); await wait(600);
  eq(await page.evaluate(() => document.querySelector('.shell').getAttribute('data-workspace')), 'brain', 'the classic atlas opened');
  assert(await page.locator(T('atlas-viewport')).isVisible(), 'with its own viewport');
  assert(await page.locator(T('nav-world')).isVisible(), 'and its dock leads back to the world');
  await page.click(T('nav-world')); await page.waitForSelector(T('journey'), { timeout: 10000 }); await wait(400);
  await page.goto(`${BASE}/#/world/dev`); await page.waitForSelector(T('world-chooser'), { timeout: 10000 });
  assert(/development aids/.test(await txt('world-chooser')), 'the chooser says what it is now');
  await page.click(T('toy-workshop')); await page.waitForSelector(T('workshop'), { timeout: 20000 }); await wait(600);
  assert(await page.locator(T('wk-timeline')).isVisible(), 'a prototype still opens');
  return 'Studio menu → classic atlas → back; #/world/dev → chooser → Time-workshop prototype';
});

await step('19 reduced motion: going in is a cut, not a flight', async () => {
  await page.goto(`${BASE}/#/world`); await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(400);
  await page.evaluate(() => window.__world.store.setState({ reducedMotion: true }));
  const t0 = Date.now();
  await page.click(T('enter')); await page.waitForSelector(`${T('journey')}[data-place="cortex"]`, { timeout: 8000 });
  const ms = Date.now() - t0; await wait(300);
  assert(ms < 1600, `arrived in ${ms} ms`);
  assert(!(await page.evaluate(() => window.__world.controller.transitioning)), 'no glide is running');
  assert(!(await has('reticle')), 'no capture was taken');
  await page.evaluate(() => window.__world.store.setState({ reducedMotion: false }));
  return `with “Reduce motion” on, the tissue is on screen ${ms} ms after the click and no camera glide runs`;
});

const env = await page.evaluate(() => { const c = document.createElement('canvas'), gl = c.getContext('webgl2'), dbg = gl?.getExtension('WEBGL_debug_renderer_info'); return { ua: navigator.userAgent, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, size: `${innerWidth} × ${innerHeight}` }; });
await browser.close();
const errs = [...new Set(consoleErrors)].filter((e) => !/pointer ?lock|PointerLock|WrongDocumentError|SecurityError/i.test(e));
const passed = results.filter((r) => r.ok).length;
const report = [
  'The integrated world (#/world) — end-to-end test',
  `Run: ${new Date().toISOString()}   Build: production (vite preview)   Viewport: ${env.size}, device pixel ratio ${env.dpr}, ${process.env.HEADED ? 'visible window' : 'headless'}`,
  `Browser: ${env.ua}`,
  `Graphics: ${env.gpu}`,
  '',
  `${passed} of ${results.length} steps passed.`,
  '',
  ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n          ${r.info}  [${(r.ms / 1000).toFixed(1)} s]`),
  '',
  'Notes',
  ...(notes.length ? notes.map((n) => `  · ${n}`) : ['  · none']),
  `  · Console errors during the run (pointer-lock refusals excluded): ${errs.length ? errs.slice(0, 5).join(' | ') : 'none'}`,
  '',
  'What this does not show: that anyone enjoys the world, understands more after playing, or that a model is biologically valid.',
  'No person has played it and no neuroscientist has reviewed it.',
  '',
].join('\n');
writeFileSync(join(out, 'e2e-report.txt'), report);
console.log(`\n${passed} of ${results.length} steps passed. Report: docs/evidence/world/e2e-report.txt`);
process.exit(passed === results.length ? 0 : 1);
