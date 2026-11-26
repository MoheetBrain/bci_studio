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
/** The player's craft: where it is and where it is aimed. */
const pose = () => page.evaluate(() => window.__world.controller.pose());
/** The camera: a different thing, which follows the craft. */
const cam = () => page.evaluate(() => { const c = window.__world.controller.camPose(); return { pos: [...c.pos], yaw: c.yaw, pitch: c.pitch }; });
/** Put the craft at the circuit's viewing place (as “Go to → the circuit” does, without the flight). */
const atCircuit = async () => { await page.evaluate(() => { const c = window.__world.controller; if (c.viewKind !== 'third') c.setView('third'); c.home([60, 46, 250], [28, 2, 0]); window.__world.store.getState().select(null); }); await wait(250); };
const screenOf = (p) => page.evaluate((q) => window.__world.screenOf(q), p);
const sel = () => page.evaluate(() => window.__world.store.getState().selected);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const J = () => page.evaluate(() => { const s = window.__journey.store.getState(); return { place: s.place, station: s.station, level: s.level, beats: s.beats, owner: s.owner, declared: s.declared, visited: s.visited }; });
const lab = () => page.evaluate(() => { const s = window.__lab.store.getState(), l = s.lab; return { digest: l.result.digest, runs: l.history.length, fired: l.result.firedMs, follower: l.result.followerMs, peak: l.result.peakMv, tMs: window.__lab.playheadMs(), paused: s.paused, setup: l.setup, baseDigest: l.baseline.digest, events: s.rec.P1?.events ?? [], contacts: l.contacts, baseContacts: l.baselineContacts, future: l.future.length, seed: l.seed, tool: s.tool, focus: s.focus, speed: s.speed, watched: s.watched }; });
const taskNow = () => page.evaluate(() => { const t = window.__task.task.cur, s = window.__task.store.getState(); return { status: s.status, paused: s.paused, bin: t?.bin ?? 0, cursor: t?.cursor ?? null, intent: t?.intent ?? null, decoded: t?.decoded ?? null, base: t?.base ?? null, terms: t?.terms ?? null, termOf: t?.termOf ?? null, hits: t?.hits ?? 0, counts: t?.counts ?? null, decoder: s.info?.decoderId, lost: s.info?.cond.lost ?? [], cal: s.info?.calibration?.id ?? 0 }; });
const cellPos = (id) => page.evaluate((k) => { const c = window.__journey.spec.cells.find((x) => x.id === k) ?? window.__journey.spec.sites.find((x) => x.id === k); return c.pos; }, id);
const active = () => page.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? 'page' : a.closest('[data-world-view]') ? 'world' : (a.getAttribute('data-testid') ?? a.tagName); });
const settle = () => page.waitForFunction(() => !window.__world.controller.transitioning, null, { timeout: 8000 });
const fresh = async () => { await page.goto(`${BASE}/#/world`); await page.evaluate(() => { localStorage.removeItem('hbci.world.journey.v1'); localStorage.removeItem('hbci.world.journey.v2'); localStorage.removeItem('hbci.world.pad'); localStorage.removeItem('hbci.world.keys.v1'); }); await page.reload(); await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(700); };
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
  await atCircuit();
  const at = await screenOf(await cellPos('T'));
  assert(at.visible, 'T is in view from the circuit’s viewing place');
  await page.mouse.click(at.x, at.y); await wait(250);
  eq((await sel())?.id, 'T', 'click selects T');
  assert(await page.locator(T('cell-tag-T')).isVisible(), 'the cell is named in the scene');
  // pause so that screen and model can be compared at one instant
  await worldFocus(); await page.keyboard.press('Space'); await wait(200);
  const l = await lab();
  assert(l.paused, 'paused');
  const want = await page.evaluate(() => { const r = window.__lab.store.getState().lab.result.run, i = r.circuit.cells.findIndex((c) => c.id === 'T'); return r.v[i][Math.min(r.nSteps, window.__lab.clock.step())]; });
  near(parseFloat((await txt('cell-v')).replace('−', '-')), want, 0.06, 'the card shows the membrane potential the run holds at the playhead');
  // selecting changed nothing about who owns the keys: still Explore
  eq(await attr('journey', 'data-input'), 'explore', 'selecting something leaves the player flying');
  const before = await pose(), camBefore = await cam();
  await page.keyboard.press('KeyF'); await settle(); await wait(150);
  eq(await attr('journey', 'data-mode'), 'orbit', 'focus is an orbit'); eq(await attr('journey', 'data-input'), 'inspect', 'and is shown as Inspect');
  const closer = await cam(), parked = await pose();
  assert(dist(closer.pos, await cellPos('T')) < dist(camBefore.pos, await cellPos('T')), 'the camera moved towards the cell');
  assert(dist(parked.pos, before.pos) < 1e-9, 'the craft stayed where it was');
  assert(await page.locator(T('craft-tag')).count() > 0, 'and says so in the scene');
  await page.keyboard.press('KeyR'); await settle(); await wait(250);
  const back = await pose(), camBack = await cam();
  assert(dist(back.pos, before.pos) < 1e-9 && Math.abs(back.yaw - before.yaw) < 1e-9 && Math.abs(back.pitch - before.pitch) < 1e-9, 'the craft is exactly where and as it was');
  assert(dist(camBack.pos, camBefore.pos) < 0.5, `Return brings the camera back behind the craft (${dist(camBack.pos, camBefore.pos).toFixed(2)} µm off)`);
  await page.keyboard.press('Space'); await wait(100);
  return `card ${await txt('cell-v')} = run value ${want.toFixed(1)} mV at the playhead; F inspects (craft parked), R returns the camera to the craft`;
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

await step('10 outside the cells: a recording contact reads a different quantity (µV, not mV) and counts the target’s spike and little else', async () => {
  if ((await lab()).fired == null) { await page.evaluate(() => window.__lab.store.getState().change({ bMs: 14 })); await wait(200); }
  // the contact is put at a declared point beside T by command here; placing it with the pointer is tested in the embodied suite
  await page.evaluate((p) => window.__lab.store.getState().place('P1', p), PROBE_TIP); await wait(200);
  await page.selectOption(T('goto'), 'P1'); await settle(); await wait(200);
  eq((await sel())?.kind, 'site', 'the contact is selected as a recording site, not as a cell');
  assert(await page.locator(T('contact-tag-P1')).isVisible(), 'and it is named in the scene');
  const uv = await txt('contact-uv');
  assert(/µV/.test(uv), `the contact reads microvolts (${uv})`);
  const mine = probeRecording(makeRun({ ...defaultSetup(0), bMs: 14 }).run, PROBE_TIP), l = await lab();
  eq(JSON.stringify(l.events.map((e) => [e.ms, e.cell])), JSON.stringify(mine.events.map((e) => [e.ms, e.cell])), 'the events on screen are the ones an independent run of the generator gives');
  const t = mine.events.find((e) => e.cell === 'T');
  assert(t && t.ampUv > 80, `T’s spike is ${t?.ampUv.toFixed(0)} µV at the contact`);
  await page.click(T('level-understand')); await wait(200);
  assert((await txt('say-probe')).includes(`${mine.ampsUv.T.toFixed(0)} µV`), 'the sentence gives T’s size there');
  assert(mine.events.filter((e) => e.cell && e.cell !== 'T').length === 0, 'no other cell’s spike crosses the threshold from here');
  assert(/does not|Not a recording|generated signal/i.test(await txt('card')), 'the card says it is a generated signal');
  eq((await lab()).digest, l.digest, 'placing a contact left the run’s fingerprint alone');
  await shot('06-contact');
  await page.keyboard.press('Escape'); await settle();
  return `P1 counts ${mine.events.length} crossing(s) in this run; T’s is ${t.ampUv.toFixed(0)} µV (threshold ${mine.thresholdUv} µV), independent computation agrees`;
});

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

// ══ the embodied build: a craft that is flown, things that are pointed at whole, contacts that are placed and left ══
const hov = () => page.evaluate(() => window.__world.store.getState().hovered);
const craftAndCam = () => page.evaluate(() => { const c = window.__world.controller; return { craft: [...c.s.pos], yaw: c.s.yaw, pitch: c.s.pitch, body: { ...c.body }, cam: [...c.cam.pos], auto: !!c.auto, mode: c.mode, view: c.viewKind }; });
/** Screen points on a body of the scene's picking list: the middles of `n` of its branch segments (those that are in view and not under a panel). */
const pointsOn = (kind, id, n) => page.evaluate(({ kind, id, n }) => {
  const W = window.__world, b = W.controller.bodies.find((x) => x.kind === kind && x.id === id), out = [];
  if (!b?.segs) return out;
  const m = b.segs.length / 7, stepBy = Math.max(1, Math.floor(m / (n * 6)));
  for (let i = 0; i < m && out.length < n * 6; i += stepBy) {
    const p = [(b.segs[i * 7] + b.segs[i * 7 + 3]) / 2, (b.segs[i * 7 + 1] + b.segs[i * 7 + 4]) / 2, (b.segs[i * 7 + 2] + b.segs[i * 7 + 5]) / 2], s = W.screenOf(p);
    if (!s.visible) continue;
    const top = document.elementFromPoint(s.x, s.y);
    if (top && top.closest('[data-world-view]')) out.push({ x: s.x, y: s.y, part: b.partNames?.[b.parts ? b.parts[i] : 0] ?? '' });
  }
  return out;
}, { kind, id, n });
/** Hover each point and report what the application says is aimed at there. */
const aimAt = async (pts) => { const got = []; for (const p of pts) { await page.mouse.move(p.x, p.y); await wait(110); got.push({ ...p, hit: await hov() }); } return got; };
const recOf = (id) => page.evaluate((k) => { const r = window.__lab.store.getState().rec[k]; return r ? { trace: Array.from(r.trace), events: r.events.map((e) => [e.ms, e.cell]) } : null; }, id);
const spikesNow = () => page.evaluate(() => JSON.stringify(window.__lab.store.getState().lab.result.run.spikes));
const sameArr = (a, b, tol = 0) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

await step('20 the player is a craft in the scene: it has its own place and aim, the keys move IT, and the camera follows from behind', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fresh(); await goIn(); await worldFocus();
  const a = await craftAndCam(), boom = dist(a.craft, a.cam);
  assert(boom > 50 && boom < 80, `the camera is ${boom.toFixed(0)} µm from the craft, not at it`);
  assert(a.cam[1] > a.craft[1], 'and above it');
  const on = await screenOf(a.craft);
  assert(on.visible && on.y > 450, 'the craft is on screen, below the centre of the view');
  await shot('20-craft-first-view');
  // fly forward and turn while sampling both: the craft translates and turns, the camera keeps its station behind it, nothing jumps
  const samples = [];
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 24; i++) { if (i === 8) { await page.mouse.move(700, 300); await page.mouse.down(); } if (i > 8 && i < 18) await page.mouse.move(700 - (i - 8) * 22, 300); if (i === 18) await page.mouse.up(); samples.push(await craftAndCam()); await wait(40); }
  await page.keyboard.up('KeyW'); await wait(700);
  const b = await craftAndCam();
  assert(dist(a.craft, b.craft) > 60, `the craft flew ${dist(a.craft, b.craft).toFixed(0)} µm`);
  assert(Math.abs(b.yaw - a.yaw) > 0.2, 'and turned');
  let worstCraft = 0, worstCam = 0, minBoom = 1e9, maxBoom = 0;
  for (let i = 1; i < samples.length; i++) { worstCraft = Math.max(worstCraft, dist(samples[i].craft, samples[i - 1].craft)); worstCam = Math.max(worstCam, dist(samples[i].cam, samples[i - 1].cam)); const d = dist(samples[i].craft, samples[i].cam); minBoom = Math.min(minBoom, d); maxBoom = Math.max(maxBoom, d); }
  assert(worstCraft < 30 && worstCam < 45, `no jump between samples (craft ≤ ${worstCraft.toFixed(0)} µm, camera ≤ ${worstCam.toFixed(0)} µm per ~45 ms)`);
  assert(minBoom > boom * 0.5 && maxBoom < boom * 1.6, `the camera stayed with the craft (${minBoom.toFixed(0)}–${maxBoom.toFixed(0)} µm from it)`);
  // the drawn craft turns towards the aim and arrives there
  assert(Math.abs(b.body.yaw - b.yaw) < 0.05, 'the craft’s drawn heading has caught up with its aim');
  const still = await craftAndCam(); await wait(300);
  assert(dist(still.craft, (await craftAndCam()).craft) < 0.01, 'and it holds still when the keys are released');
  eq(await attr('journey', 'data-input'), 'explore', 'Explore is shown as the input mode');
  assert((await txt('owner')).includes('keys fly your craft'), 'with what the keys do in it');
  assert((await J()).beats.explore, 'the route noticed the flying');
  return `camera ${boom.toFixed(0)} µm behind/above the craft; W + drag: craft flew ${dist(a.craft, b.craft).toFixed(0)} µm and turned ${Math.abs(b.yaw - a.yaw).toFixed(2)} rad with the camera ${minBoom.toFixed(0)}–${maxBoom.toFixed(0)} µm from it; largest step between samples ${worstCraft.toFixed(0)} µm`;
});

await step('21 one player state: first person, Inspect and Return never move the craft; a movement key or a new command interrupts from where things are — nothing snaps', async () => {
  await page.evaluate(() => { const c = window.__world.controller; if (c.viewKind !== 'third') c.setView('third'); c.home(window.__journey.spec.home.pos, window.__journey.spec.home.lookAt); window.__world.store.getState().select(null); }); await wait(300); await worldFocus();
  const a = await craftAndCam();
  await page.keyboard.press('KeyV'); await settle(); await wait(150);
  const fp = await craftAndCam();
  eq(await attr('journey', 'data-view'), 'first', 'first person is shown'); assert(dist(fp.craft, a.craft) < 1e-9 && fp.yaw === a.yaw && fp.pitch === a.pitch, 'the player is in the same place, aimed the same way');
  assert(dist(fp.cam, fp.craft) < 4, 'the camera is in the craft');
  await shot('21-first-person');
  // pointing works the same from inside
  const inside = await aimAt((await pointsOn('context', 'h01', 4)).slice(0, 12));
  assert(inside.some((p) => p.hit?.id === 'h01'), 'in first person a branch of the neuron still resolves to the neuron');
  await page.keyboard.press('KeyV'); await settle(); await wait(150);
  const tp = await craftAndCam();
  assert(dist(tp.cam, a.cam) < 0.6 && dist(tp.craft, a.craft) < 1e-9, 'back in third person the camera is where it was');
  // Inspect the neuron, then press a movement key: flying resumes from the craft's own place, the camera comes back continuously
  await page.evaluate(() => window.__world.store.getState().select({ kind: 'context', id: 'h01' }));
  await page.keyboard.press('KeyF'); await wait(700);
  eq(await attr('journey', 'data-input'), 'inspect', 'Inspect');
  const insp = await craftAndCam();
  assert(dist(insp.craft, a.craft) < 1e-9, 'the craft waits where it was'); assert(dist(insp.cam, a.cam) > 100, 'while the camera has gone to look');
  await shot('21-inspect-neuron');
  const trail = [];
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 16; i++) { trail.push(await craftAndCam()); await wait(35); }
  await page.keyboard.up('KeyW'); await settle(); await wait(200);
  eq(trail[1].mode, 'fly', 'the first movement key leaves Inspect');
  let step = 0; for (let i = 1; i < trail.length; i++) step = Math.max(step, dist(trail[i].cam, trail[i - 1].cam));
  assert(step < 60, `the camera came back without a cut (largest step ${step.toFixed(0)} µm per ~40 ms)`);
  assert(dist(trail[1].cam, trail[0].cam) <= step, 'and its first step is not its largest: it starts from rest (the exact curve is unit-tested)');
  assert(dist(trail[0].craft, a.craft) < 3 && dist(trail[1].craft, trail[0].craft) < 15, 'the craft carried on from its own place');
  eq(await attr('journey', 'data-input'), 'explore', 'Explore again');
  // a journey the craft makes by itself is interrupted where the craft IS, not at its destination
  await page.selectOption(T('goto'), 'circuit'); await wait(350);
  eq(await attr('journey', 'data-travelling'), '1', 'the craft is flying itself to the circuit'); assert((await txt('owner')).includes('any movement key takes over'), 'and the mode line says how to take over');
  await worldFocus(); await page.keyboard.down('KeyS'); await wait(60);
  const cut = await craftAndCam(); await wait(120); await page.keyboard.up('KeyS'); await wait(500);
  const after = await craftAndCam();
  assert(!cut.auto, 'the key ended the journey'); assert(dist(after.craft, [60, 46, 250]) > 25, `it did not jump to the destination (${dist(after.craft, [60, 46, 250]).toFixed(0)} µm short)`);
  assert(dist(after.craft, cut.craft) < 40, 'it carried on from where it was');
  // …and a second command sent mid-journey starts from where the craft is
  await page.selectOption(T('goto'), 'circuit'); await wait(250); const m1 = await craftAndCam();
  await page.selectOption(T('goto'), 'array'); const m2 = await craftAndCam(); await wait(60); const m3 = await craftAndCam();
  assert(dist(m1.craft, m2.craft) < 60 && dist(m2.craft, m3.craft) < 60, `a new destination is taken up from the present position (${dist(m1.craft, m2.craft).toFixed(0)} µm, then ${dist(m2.craft, m3.craft).toFixed(0)} µm between samples — no jump to either place)`);
  await page.selectOption(T('goto'), 'circuit'); await settle(); await wait(200);
  assert(dist((await craftAndCam()).craft, [60, 46, 250]) < 0.5, 'left alone, the craft arrives at the circuit’s viewing place');
  return `V: same pose, camera in the craft; Inspect: craft parked, W returns to flying with the camera moving ≤ ${step.toFixed(0)} µm per sample; an interrupted journey stops ${dist(after.craft, [60, 46, 250]).toFixed(0)} µm short of its destination`;
});

await step('22 pointing: the body and every branch of a neuron resolve to that one neuron, from more than one side; selecting it does not stop the flying; a context cell says it has no model', async () => {
  await page.selectOption(T('goto'), 'circuit'); await settle(); await atCircuit(); await worldFocus();
  const tally = (got, id) => ({ own: got.filter((p) => p.hit?.id === id).length, other: got.filter((p) => p.hit && p.hit.id !== id).length, none: got.filter((p) => !p.hit).length, parts: [...new Set(got.filter((p) => p.hit?.id === id).map((p) => p.hit.part))] });
  // what is under the pointer is what the application's own ray test says is nearest there (so "other" means: something is in front)
  const front = async (pts) => page.evaluate((pts) => pts.map((p) => { const r = document.querySelector('[data-testid="world-view"] canvas').getBoundingClientRect(), h = window.__world.controller.hitAt(((p.x - r.left) / r.width) * 2 - 1, 1 - ((p.y - r.top) / r.height) * 2); return h ? h.id : null; }), pts);
  const view1 = await aimAt(await pointsOn('cell', 'T', 5)), t1 = tally(view1, 'T');
  eq(JSON.stringify(view1.map((p) => p.hit?.id ?? null)), JSON.stringify(await front(view1)), 'the highlight is always the nearest thing under the pointer');
  assert(t1.own >= 8 && t1.parts.length >= 2, `from the front, ${t1.own} of ${view1.length} points on T’s branches resolve to T (${t1.parts.join(', ')})`);
  const body = await screenOf(await cellPos('T')); await page.mouse.move(body.x, body.y); await wait(150);
  eq((await hov())?.id, 'T', 'its body resolves to T'); eq((await hov())?.part, 'cell body', 'and is called the cell body');
  assert((await txt('aim-tag')).length > 0, 'what is aimed at is named beside the pointer');
  await shot('22-point-branch');
  // from another side
  await page.evaluate(() => { const c = window.__world.controller; c.home([-150, 90, -120], [28, 2, 0]); }); await wait(300);
  const view2 = await aimAt(await pointsOn('cell', 'T', 5)), t2 = tally(view2, 'T');
  assert(t2.own >= 8, `from behind and above, ${t2.own} of ${view2.length} resolve to T`);
  // click a branch: the neuron is selected, the part is named, and the keys still fly
  const br = view2.find((p) => p.hit?.id === 'T' && p.hit.part !== 'cell body');
  await page.mouse.move(br.x, br.y); await wait(120); await page.mouse.click(br.x, br.y); await wait(250);
  const s1 = await sel();
  eq(s1?.id, 'T', 'a click on a branch selects the neuron'); assert(s1.part && s1.part !== 'cell body', `with the part pointed at (${s1.part})`);
  assert((await txt('card-part')).includes(s1.part), 'the card names that part'); assert(await has('cell-v'), 'and shows the neuron’s membrane potential — one value for the whole cell');
  eq(await attr('journey', 'data-input'), 'explore', 'the input mode is still Explore');
  const p0 = await pose(); await worldFocus(); await hold('KeyW', 300); await wait(400);
  assert(dist((await pose()).pos, p0.pos) > 15, 'with something selected, W still flies the craft');
  eq((await sel())?.id, 'T', 'and the selection is kept');
  // a context cell: selectable, named, and honest
  const ctxId = await page.evaluate(() => { const W = window.__world, c = W.controller; let best = null; for (const b of c.bodies) { if (b.kind !== 'context' || !b.id.startsWith('ctx')) continue; const s = W.screenOf(b.centre); if (!s.visible) continue; const top = document.elementFromPoint(s.x, s.y); if (!top?.closest('[data-world-view]')) continue; const h = c.hitAt(((s.x - top.getBoundingClientRect().left) / top.getBoundingClientRect().width) * 2 - 1, 1 - ((s.y - top.getBoundingClientRect().top) / top.getBoundingClientRect().height) * 2); if (h && h.id === b.id) { best = { id: b.id, x: s.x, y: s.y }; break; } } return best; });
  assert(ctxId, 'a context cell is in clear view');
  await page.mouse.move(ctxId.x, ctxId.y); await wait(150);
  eq((await hov())?.kind, 'context', 'a context cell answers to the pointer');
  await page.mouse.click(ctxId.x, ctxId.y); await wait(250);
  eq((await sel())?.id, ctxId.id, 'and can be selected');
  assert(/No dynamic model is attached/.test(await txt('card-nomodel')), 'its card says no dynamic model is attached');
  assert(!(await has('cell-v')) && !(await has('contact-uv')), 'and shows no membrane potential and no trace');
  await shot('22-context-cell');
  // the craft is not something the aim can land on
  assert(await page.evaluate(() => window.__world.controller.bodies.every((b) => !/craft|player/i.test(b.id))), 'the player’s craft is not in the list of things that can be aimed at');
  // at low detail, pointing is as reliable
  await page.evaluate(() => window.__world.store.setState({ quality: 'low' })); await wait(900);
  const low = tally(await aimAt(await pointsOn('cell', 'T', 5)), 'T');
  await page.evaluate(() => window.__world.store.setState({ quality: 'high' })); await wait(900);
  assert(low.own >= 8, `at low detail ${low.own} points on T still resolve to T`);
  await page.keyboard.press('Escape'); await wait(100);
  return `T: ${t1.own}/${view1.length} branch points from the front (${t1.parts.join(', ')}), ${t2.own}/${view2.length} from behind — the rest had something nearer in front; click on its ${s1.part} selects T and W still flies; ${ctxId.id}: “no dynamic model”; low detail ${low.own}/${low.own + low.other + low.none}`;
});

await step('23 the reconstructed neuron: structure from published data, named with its source and licence, with no model and no trace; the tissue can be thinned and brought back', async () => {
  await page.evaluate(() => { const c = window.__world.controller; c.home(window.__journey.spec.home.pos, window.__journey.spec.home.lookAt); window.__world.store.getState().select(null); }); await wait(400);
  const got = await aimAt(await pointsOn('context', 'h01', 5)), own = got.filter((p) => p.hit?.id === 'h01');
  assert(own.length >= 10 && new Set(own.map((p) => p.hit.part)).size >= 2, `${own.length} of ${got.length} points on its branches resolve to the one neuron`);
  await page.mouse.click(own[0].x, own[0].y); await wait(250);
  eq((await sel())?.id, 'h01', 'selected');
  const card = await txt('card');
  assert(/human temporal cortex/.test(card) && /No dynamic model is attached/.test(card) && /not from the precentral gyrus/.test(card), 'the card says what it is and what it is not');
  assert(!(await has('cell-v')), 'no membrane potential is shown for it');
  await page.click(`${T('card-source')} summary`); await wait(100);
  const src = await txt('card-source');
  assert(/Shapson-Coe/.test(src) && /CC BY 4\.0/.test(src) && /H01 release/.test(src), 'source, citation and licence are one click away');
  // reveal: isolate, denser, and back — display only
  const d0 = (await lab()).digest, n0 = await page.evaluate(() => window.__world.controller.bodies.length);
  await page.click(T('card-isolate')); await wait(400);
  eq(await attr('journey', 'data-reveal'), 'isolate', 'isolated'); await shot('23-isolated');
  await page.click(T('reveal-dense')); await wait(1400);
  const n1 = await page.evaluate(() => window.__world.controller.bodies.length);
  assert(n1 > n0 + 100, `the denser view draws ${n1 - n0} more context cells, and they can be pointed at`); await shot('23-dense');
  assert(/sparser than tissue/.test(await txt('reveal-note')), 'and says it is still sparser than tissue');
  await page.click(T('reveal-explore')); await wait(500);
  eq(await page.evaluate(() => window.__world.controller.bodies.length), n0, 'back to the readable view: the same scene as before');
  assert(/gaps are not in tissue/.test(await txt('reveal-note')), 'which says its open space is a display choice');
  eq((await lab()).digest, d0, 'no model changed through any of it');
  await page.keyboard.press('Escape'); await wait(100);
  return `${own.length}/${got.length} branch points → the one neuron (${[...new Set(own.map((p) => p.hit.part))].join(', ')}); card: temporal cortex, CC BY 4.0, no model; isolate / denser (+${n1 - n0} cells) / readable are display-only`;
});

await step('24 placing: a contact is taken in hand, previewed where it would go, put down with a click, and is then exactly where the model says it is', async () => {
  await page.selectOption(T('goto'), 'circuit'); await settle();
  await page.evaluate(() => window.__lab.store.getState().reset()); await atCircuit(); await worldFocus();
  // make T fire first, at the cell that causes it: select B, 8 ms earlier
  const bAt = await screenOf(await cellPos('B')); await page.mouse.click(bAt.x, bAt.y); await wait(200);
  eq((await sel())?.id, 'B', 'B selected where it is');
  await page.click(T('bMs-earlier4')); await page.click(T('bMs-earlier4')); await wait(300);
  const fired = await lab();
  assert(fired.fired != null, 'T fires');
  await page.click(T('level-observe')); await wait(150); await page.keyboard.press('Escape'); await wait(100);
  // Escape puts a contact in hand away without placing it
  await page.click(T('contact-P1')); await wait(150);
  eq(await attr('journey', 'data-tool'), 'P1', 'P1 is in hand'); assert((await txt('owner')).includes('keys still fly'), 'and the keys still fly');
  const k0 = await pose(); await worldFocus(); await hold('KeyD', 200); await wait(300);
  assert(dist((await pose()).pos, k0.pos) > 5, 'with a contact in hand the craft still flies');
  await page.keyboard.press('Escape'); await wait(150);
  eq(await attr('journey', 'data-tool'), '', 'Escape puts it away'); eq((await lab()).contacts.P1, null, 'nothing was placed');
  // take it again, aim at T: the preview says where and what it would hear; click puts it down
  await atCircuit(); await page.click(T('contact-P1')); await wait(150);
  const tPos = await cellPos('T'), at = await screenOf(tPos);
  await page.mouse.move(at.x + 4, at.y - 2); await wait(450);
  const tag = await txt('preview-tag');
  assert(/P1 here · \d+ µm from T/.test(tag), `the preview says where it would go (“${tag}”)`);
  await shot('24-preview');
  await page.mouse.click(at.x + 4, at.y - 2); await wait(300);
  const l1 = await lab(), p1 = l1.contacts.P1;
  assert(p1 && p1.every(Number.isFinite), 'P1 is placed');
  const dT = dist(p1, tPos);
  assert(dT > 9 && dT < 22, `just outside T’s body (${dT.toFixed(1)} µm from its centre: its 9 µm radius plus a stand-off)`);
  eq(l1.runs, fired.runs + 1, 'one step of the history'); eq(l1.digest, fired.digest, 'the circuit’s run is the same run'); eq(await attr('journey', 'data-tool'), '', 'the hand is empty again');
  eq((await sel())?.id, 'P1', 'and P1 is selected');
  // the drawn contact is at the model's coordinates: its label is where the model position projects to
  const tagBox = await page.locator(T('contact-tag-P1')).boundingBox(), want = await screenOf([p1[0], p1[1] + 2.4 + 44 + 9, p1[2]]);
  assert(Math.abs(tagBox.x + tagBox.width / 2 - want.x) < 6 && Math.abs(tagBox.y + tagBox.height / 2 - want.y) < 6, `the contact is drawn where the model has it (label ${Math.hypot(tagBox.x + tagBox.width / 2 - want.x, tagBox.y + tagBox.height / 2 - want.y).toFixed(1)} px from the projected position)`);
  const where = await txt('contact-where');
  assert(where.includes(`x ${p1[0].toFixed(1).replace('-', '−')}`), 'and the card gives the same coordinates');
  // P2 in open space: at arm's reach in front of the craft
  await page.click(T('contact-P2')); await wait(150);
  const open = await page.evaluate(() => { const W = window.__world, c = W.controller, r = document.querySelector('[data-testid="world-view"] canvas').getBoundingClientRect(); for (let y = 0.3; y < 0.75; y += 0.05) for (let x = 0.3; x < 0.7; x += 0.05) { const px = r.left + x * r.width, py = r.top + y * r.height, top = document.elementFromPoint(px, py); if (top?.closest('[data-world-view]') && !c.hitAt(x * 2 - 1, 1 - y * 2)) return { x: px, y: py }; } return null; });
  assert(open, 'there is open space in view to put P2 in');
  await page.mouse.move(open.x, open.y); await wait(350); await page.mouse.click(open.x, open.y); await wait(300);
  const l2 = await lab(), p2 = l2.contacts.P2, cm = await cam(), reach = dist(cm.pos, (await pose()).pos) + 58;
  assert(p2 && Math.abs(dist(p2, cm.pos) - reach) < 2, `P2 is at arm’s reach in front of the craft (${dist(p2, cm.pos).toFixed(0)} µm along the aim; the craft is ${(reach - 58).toFixed(0)} µm from the camera)`);
  eq(JSON.stringify(l2.contacts.P1), JSON.stringify(p1), 'placing P2 did not move P1'); eq(l2.digest, fired.digest, 'nor change the run');
  assert((await J()).beats.place, 'the route noticed that both contacts are down');
  await page.click(T('level-understand')); await wait(300); await shot('24-both-placed');
  kept = { p1, p2, digest: fired.digest };
  return `P1 snapped ${dT.toFixed(1)} µm from T’s centre (preview: “${tag}”); P2 at arm’s reach ${dist(p2, cm.pos).toFixed(0)} µm from the camera; each one step; run fingerprint ${fired.digest} unchanged; drawn where the model has them`;
});

await step('25 moving P1: its samples become exactly the declared function of its new place; P2’s samples and every spike time do not change; flying changes neither', async () => {
  const before = { p1: await recOf('P1'), p2: await recOf('P2'), spikes: await spikesNow(), l: await lab() };
  await page.click(T('t-keep')); await wait(150);
  eq(JSON.stringify((await lab()).baseContacts), JSON.stringify(before.l.contacts), 'the baseline now holds both contact positions');
  // flying, turning, changing the view and inspecting: neither recording changes (nothing is selected, so no arrow is there to grab)
  await page.evaluate(() => window.__world.store.getState().select(null)); await wait(120);
  await worldFocus(); await hold('KeyA', 350); await page.mouse.move(720, 260); await page.mouse.down(); await page.mouse.move(660, 290, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('KeyV'); await wait(300); await page.keyboard.press('KeyV'); await wait(300);
  const flown = { p1: await recOf('P1'), p2: await recOf('P2'), l: await lab() };
  assert(sameArr(flown.p1.trace, before.p1.trace) && sameArr(flown.p2.trace, before.p2.trace), 'after flying and changing the view, both recordings are identical sample by sample');
  eq(flown.l.digest, before.l.digest, 'and so is the run'); eq(flown.l.runs, before.l.runs, 'and no step was added');
  // drag P1's x arrow
  await atCircuit(); await page.click(T('contact-P1')); await wait(350);
  const h = await page.evaluate(() => { const W = window.__world, b = W.controller.bodies.find((x) => x.kind === 'handle' && x.id === 'P1:x'); if (!b) return null; const s = b.segs, a = W.screenOf([s[0] * 0.2 + s[3] * 0.8, s[1], s[2]]), e = W.screenOf([s[3], s[4], s[5]]); return { a, e }; });
  assert(h && h.a.visible, 'P1’s arrows are drawn when it is selected');
  await page.mouse.move(h.a.x, h.a.y); await wait(300);
  assert(/drag/.test(await txt('handle-tag')), 'the arrow under the pointer says what dragging it does');
  const dx = Math.sign(h.e.x - h.a.x) || 1;
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(h.a.x + dx * i * 8, h.a.y + (h.e.y - h.a.y) / Math.max(1, Math.abs(h.e.x - h.a.x)) * i * 8); await wait(25); }
  await wait(120);
  const during = await lab(), live = await page.evaluate(() => window.__lab.contactAt('P1'));
  eq(during.runs, before.l.runs, 'while dragging, nothing has joined the history yet'); assert(dist(live, before.l.contacts.P1) > 3, 'but the contact is already following the pointer');
  await shot('25-dragging');
  await page.mouse.up(); await wait(300);
  const after = await lab(), q1 = after.contacts.P1;
  eq(after.runs, before.l.runs + 1, 'the whole drag is ONE step');
  assert(Math.abs(q1[0] - before.l.contacts.P1[0]) > 3 && Math.abs(q1[1] - before.l.contacts.P1[1]) < 0.11 && Math.abs(q1[2] - before.l.contacts.P1[2]) < 0.11, `it slid along x only (${(q1[0] - before.l.contacts.P1[0]).toFixed(1)} µm)`);
  eq(JSON.stringify(after.contacts.P2), JSON.stringify(before.l.contacts.P2), 'P2 is where it was');
  const now = { p1: await recOf('P1'), p2: await recOf('P2') };
  assert(sameArr(now.p2.trace, before.p2.trace), 'P2’s samples are identical, all of them'); eq(JSON.stringify(now.p2.events), JSON.stringify(before.p2.events), 'P2’s events too');
  eq(await spikesNow(), before.spikes, 'every spike time of the circuit is the same'); eq(after.digest, before.l.digest, 'the run’s fingerprint is the same');
  // an independent computation here, from the model's source, of what a contact at the new place records under the same seed
  const mine = probeRecording(makeRun(after.setup).run, q1, after.seed, 0);
  assert(sameArr(now.p1.trace, Array.from(mine.trace), 1e-4), 'P1’s samples are exactly the observation function at its new position (independent computation, every sample)');
  assert(!sameArr(now.p1.trace, before.p1.trace), 'and differ from those at the old position');
  // nearer to the cell that fires → larger, by the declared rule; the sentence says the spikes are the same
  await page.selectOption(T('nudge-ref'), 'T'); const d0 = parseFloat(await txt('nudge-dist'));
  await page.click(T('nudge-nearer')); await wait(150);
  const d1 = parseFloat(await txt('nudge-dist'));
  assert(d1 <= d0 - 4 || d1 === 0, `“Nearer to T” moved it ${d0} → ${d1} µm`);
  const cmp = await txt('say-compare');
  assert(/P1 moved/.test(cmp) && /the circuit’s spikes are the same ones as in the baseline/.test(cmp), 'the comparison says the spikes are the same and only P1’s record differs');
  await shot('25-moved');
  // undo / redo
  const mid = await lab();
  await page.click(T('t-undo')); await wait(150);
  eq(JSON.stringify((await lab()).contacts.P1), JSON.stringify(q1), 'Undo takes the last move back');
  await page.click(T('t-redo')); await wait(150);
  eq(JSON.stringify((await lab()).contacts.P1), JSON.stringify(mid.contacts.P1), 'Redo does it again');
  await page.click(T('t-undo')); await page.click(T('t-undo')); await wait(200);
  eq(JSON.stringify((await lab()).contacts.P1), JSON.stringify(before.l.contacts.P1), 'a second Undo takes the drag back as one step: P1 is where it was placed');
  await page.click(T('t-redo')); await page.click(T('t-redo')); await wait(200);
  // pause, step, replay: the contact's reading is the recording at the playhead
  await worldFocus(); await page.keyboard.press('Space'); await wait(150);
  const t0 = (await lab()).tMs; await wait(300);
  eq((await lab()).tMs, t0, 'paused: the playhead holds');
  const shown = parseFloat((await txt('contact-uv')).replace('−', '-')), atHead = await page.evaluate(() => { const r = window.__lab.store.getState().rec.P1; return r.trace[Math.min(r.trace.length - 1, window.__lab.clock.step())]; });
  near(shown, atHead, 0.6, 'the card shows the recording’s sample at the playhead');
  await page.keyboard.press('Period'); await wait(150);
  near((await lab()).tMs - t0, 0.25, 1e-6, 'Step advances a quarter of a millisecond');
  await page.click(T('t-replay')); await wait(200);
  assert((await lab()).tMs < 2 && !(await lab()).paused, 'Replay starts the same recording again');
  // extreme places: exactly on a cell, and far outside the block
  await page.evaluate((p) => window.__lab.store.getState().place('P2', p), await cellPos('T')); await wait(200);
  await page.click(T('contact-P2')); await wait(200);
  const onCell = await recOf('P2');
  assert(onCell.trace.every(Number.isFinite), 'a contact exactly on a cell body records finite numbers'); assert(/0 µm/.test(await txt('contact-table')) && /240 µV/.test(await txt('contact-table')), 'at the largest size the rule gives (240 µV)');
  await page.evaluate(() => window.__lab.store.getState().place('P2', [1e9, 1e9, -1e9])); await wait(200);
  const edge = (await lab()).contacts.P2;
  assert(edge.every(Number.isFinite) && edge[0] === 1040 && edge[1] === 540 && edge[2] === -1420, 'asked to go outside the block, it stops at the block’s edge'); assert(/edge of the block/.test(await txt('contact-where')), 'and the card says so');
  assert((await recOf('P2')).trace.every(Number.isFinite), 'and still records finite numbers');
  await page.click(T('t-undo')); await page.click(T('t-undo')); await wait(200);
  eq(JSON.stringify((await lab()).contacts.P2), JSON.stringify(before.l.contacts.P2), 'both are undone');
  kept = { ...kept, p1: (await lab()).contacts.P1, p2: (await lab()).contacts.P2, runs: (await lab()).runs, base: JSON.stringify((await lab()).baseContacts) };
  return `drag = 1 step, x only (${(q1[0] - before.l.contacts.P1[0]).toFixed(1)} µm); P2 identical (${before.p2.trace.length} samples), spikes identical, fingerprint ${after.digest}; P1 = independent probeRecording at the new place (≤1e-4 µV); nearer ${d0} → ${d1} µm; flying/view changes: no difference; on a cell and at the block edge: finite`;
});

await step('26 left behind: the contacts stay when the craft flies away, when the player goes out to the brain and back, and after a reload; an older save is read', async () => {
  const want = JSON.stringify({ P1: kept.p1, P2: kept.p2 });
  await page.evaluate(() => window.__world.store.getState().select(null)); await wait(120);
  await worldFocus(); await hold('KeyS', 900); await hold('KeyE', 500); await wait(400);
  const far = await pose();
  eq(JSON.stringify((await lab()).contacts), want, 'after flying away the contacts are where they were put');
  assert(await page.locator(T('contact-tag-P1')).count() > 0 && await page.locator(T('contact-tag-P2')).count() > 0, 'and both are still named in the scene');
  // out to the brain and back
  await page.click(T('map')); await page.waitForSelector(`${T('journey')}[data-place="brain"]`, { timeout: 20000 }); await wait(400);
  await goIn('resume');
  eq(JSON.stringify((await lab()).contacts), want, 'back from the brain: the same contacts');
  assert(dist((await pose()).pos, far.pos) < 1, 'and the craft is back where it was left');
  // reload the page
  await wait(600); await page.reload(); await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(500);
  assert(await has('resume'), 'after a reload the entrance offers the way back');
  const re = await lab();
  eq(JSON.stringify(re.contacts), want, 'after a reload: the same contacts'); eq(re.runs, kept.runs, 'the same history'); eq(re.digest, kept.digest, 'the same run');
  eq(JSON.stringify(re.baseContacts), kept.base, 'the same baseline layout'); eq(re.seed, 20261125, 'the same seed');
  await goIn('resume');
  assert(dist((await pose()).pos, far.pos) < 30, 'and the craft comes back to about where it was');
  await shot('26-after-reload');
  // a save written by the previous version of the world: its experiment is kept, with no contact placed
  await page.evaluate(() => { const old = { visited: true, beats: { explore: true, record: true }, level: 'understand', station: 'circuit', guide: true, declared: false, history: [{ setup: { variant: 0, aMs: 10, bMs: 22, conn: {}, extra: [], glT: null }, label: 'The circuit as you found it' }, { setup: { variant: 0, aMs: 10, bMs: 14, conn: {}, extra: [], glT: null }, label: 'When input B fires: 22 ms → 14 ms' }], baseline: { variant: 0, aMs: 10, bMs: 22, conn: {}, extra: [], glT: null }, pose: { pos: [60, 46, 250], yaw: 0.1, pitch: -0.1 }, entry: null, dragLooks: false, lookScale: 1 }; localStorage.removeItem('hbci.world.journey.v2'); localStorage.setItem('hbci.world.journey.v1', JSON.stringify(old)); Storage.prototype.setItem = () => {}; /* nothing more is written before the reload */ });
  await page.reload(); await page.waitForSelector(`${T('brain-stage')}[data-ready="1"]`, { timeout: 30000 }); await wait(400);
  const old = await lab();
  eq(old.runs, 2, 'an older save’s history is read'); assert(old.fired != null, 'with its last run current'); eq(JSON.stringify(old.contacts), JSON.stringify({ P1: null, P2: null }), 'and no contact placed (that version had a fixed probe)');
  assert(await has('resume'), 'the way back is offered for it too');
  return `contacts unchanged after flying ${dist(far.pos, [60, 46, 250]).toFixed(0)} µm away, after brain → back, and after a reload (history ${kept.runs} steps, fingerprint ${kept.digest}); a version-1 save restores its 2-step experiment with no contacts`;
});

await step('27 two models, kept apart: P1 and P2 are never decoder inputs, and the decoder’s eight contacts are not theirs', async () => {
  await fresh(); await goIn();
  await page.evaluate((p) => { const s = window.__lab.store.getState(); s.place('P1', p); s.place('P2', [p[0] - 150, p[1] + 30, p[2] + 60]); }, PROBE_TIP);
  await page.selectOption(T('goto'), 'array'); await page.waitForSelector(T('declare'), { timeout: 10000 }); await page.click(T('declare-ok'));
  await page.waitForFunction(() => window.__task.store.getState().status === 'ready' && !!window.__task.store.getState().info?.calibration, null, { timeout: 120000 });
  await settle(); await wait(600);
  assert(!(await has('contacts')), 'at the array the P1/P2 controls are not offered');
  const t0 = await page.evaluate(() => { const i = window.__task.store.getState().info; return { cal: i.calibration.id, cond: JSON.stringify(i.cond), dec: i.decoderId, thr: JSON.stringify(i.calibration.thresholdsUv), ch: i.calibration.thresholdsUv.length }; });
  eq(t0.ch, 8, 'the decoder has eight contacts');
  await worldFocus(); await page.keyboard.press('KeyC'); await wait(200);
  eq(await attr('journey', 'data-tool'), '', 'a recording contact cannot be taken in hand here'); assert(/never feed the decoder/.test(await txt('notice')), 'and the reason is given');
  // moving P1 while the task runs changes nothing of the task
  await page.evaluate((p) => window.__lab.store.getState().place('P1', [p[0] + 30, p[1], p[2]]), PROBE_TIP); await wait(400);
  const t1 = await page.evaluate(() => { const i = window.__task.store.getState().info; return { cal: i.calibration.id, cond: JSON.stringify(i.cond), dec: i.decoderId, thr: JSON.stringify(i.calibration.thresholdsUv) }; });
  eq(JSON.stringify({ ...t1 }), JSON.stringify({ cal: t0.cal, cond: t0.cond, dec: t0.dec, thr: t0.thr }), 'the decoder’s calibration, thresholds and conditions are untouched by moving P1');
  await page.click(T('btn-model')); await wait(200);
  assert(/P1 and P2\. They observe the five-cell circuit and are never an input of this decoder/.test(await txt('panel-model')), 'the “what is this” panel says so');
  await page.keyboard.press('Escape'); await wait(100);
  // Decoder Pilot: the keys are the intent; the craft does not move
  await page.click(T('t-pilot')); await settle(); await wait(300);
  eq(await attr('journey', 'data-input'), 'pilot', 'Decoder Pilot is shown as the input mode');
  const c0 = await pose(); await worldFocus(); await hold('KeyW', 500); await wait(200);
  assert(dist((await pose()).pos, c0.pos) < 1e-9, 'in Decoder Pilot the movement keys do not move the craft');
  await page.keyboard.press('Escape'); await wait(200);
  eq(await attr('journey', 'data-input'), 'explore', 'Escape gives the keys back to flying');
  await hold('KeyW', 300); await wait(300);
  assert(dist((await pose()).pos, c0.pos) > 10, 'and W flies the craft again');
  return `decoder: ${t0.ch} contacts, calibration ${t0.cal} unchanged by moving P1; P1/P2 cannot be taken at the array; Decoder Pilot keys leave the craft still, Esc returns to Explore`;
});

await step('28 mouse look refused: the player is told what still works, and it does', async () => {
  await page.selectOption(T('goto'), 'circuit'); await settle(); await atCircuit(); await worldFocus();
  await page.evaluate(() => { HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('refused (test)')); }; });
  const y0 = (await pose()).yaw;
  await page.keyboard.press('KeyL'); await wait(500);
  eq(await attr('journey', 'data-captured'), '0', 'the mouse was not captured');
  assert(/Dragging the scene looks around just the same/.test(await txt('notice')), 'the player is told what happened and what still works');
  await page.mouse.move(720, 300); await page.mouse.down(); await page.mouse.move(620, 320, { steps: 8 }); await page.mouse.up(); await wait(200);
  assert(Math.abs((await pose()).yaw - y0) > 0.1, 'dragging turns the view');
  const p = await pose(); await hold('KeyW', 300); await wait(300);
  assert(dist((await pose()).pos, p.pos) > 15, 'and the keys fly');
  return 'capture refused → notice shown; drag-look and flying unaffected';
});

const env = await page.evaluate(() => { const c = document.createElement('canvas'), gl = c.getContext('webgl2'), dbg = gl?.getExtension('WEBGL_debug_renderer_info'); return { ua: navigator.userAgent, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, size: `${innerWidth} × ${innerHeight}` }; });
await browser.close();
const errs = [...new Set(consoleErrors)].filter((e) => !/pointer ?lock|PointerLock|WrongDocumentError|SecurityError/i.test(e));
const passed = results.filter((r) => r.ok).length;
const report = [
  'The world (#/world) — end-to-end test (embodied build: craft, whole-object pointing, placed contacts)',
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
