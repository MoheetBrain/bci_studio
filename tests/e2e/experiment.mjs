// End-to-end acceptance test of the interactive BCI experiment, in a real Chrome against the production build.
//
//   npm run build && node tests/e2e/experiment.mjs            (HEADED=1 to watch)
//
// Each step does what a visitor would do (pointer, keyboard, controls) and asserts on what the application itself
// reports: atlas ids from ray casts, the simulated session's numbers on screen, store state. It writes
// docs/evidence/experiment/e2e-report.txt and docs/evidence/experiment/screens/*.png.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5196, BASE = `http://127.0.0.1:${PORT}`;
const out = join(root, 'docs/evidence/experiment'), shots = join(out, 'screens');
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

const results = [], consoleErrors = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const info = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, info: info ?? '' }); console.log(`✓ ${name}${info ? ` — ${info}` : ''}`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, info: String(e?.message ?? e).split('\n')[0] }); console.log(`✗ ${name} — ${String(e?.message ?? e).split('\n')[0]}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name, p = page) => p.screenshot({ path: join(shots, `${name}.png`) });
const T = (id) => `[data-testid="${id}"]`;
const txt = (id, p = page) => p.locator(T(id)).first().innerText();
const settle = (ms = 900) => page.waitForTimeout(ms);
const num = (s) => parseFloat(String(s).replace(/−/g, '-').replace(/[^\d.eE+-]/g, ''));
const implant = () => page.evaluate(() => { const s = window.__atlas.implant.getState(); return { placing: s.placing, placement: s.placement, preview: s.preview }; });
const sel = () => page.evaluate(() => window.__atlas.store.getState().selectedId);
const pointOf = (id) => page.evaluate((i) => window.__atlas.screenPointOf(i), id);
const cameraIdle = async () => { for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => window.__atlas.cameraState()?.transitioning))) return; await page.waitForTimeout(100); } };
/** Set a range input to a position (0…1 for the experiment's sliders, a plain value for the scrubber). */
const setRange = (id, v) => page.evaluate(([i, val]) => {
  const el = document.querySelector(`[data-testid="${i}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(val));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, v]);
const resultN = () => page.evaluate(() => +(document.querySelector('[data-testid="experiment-signal"]')?.dataset.result ?? -1));
/** Do something that changes the simulation and wait until the new result is on screen. */
const recompute = async (fn) => {
  const before = await resultN();
  await fn();
  await page.waitForFunction((b) => { const el = document.querySelector('[data-testid="experiment-signal"]'); return el && +el.dataset.result > b && el.dataset.status === 'ready'; }, before, { timeout: 30000 });
  await page.waitForTimeout(120);
};
const stage = async (n) => { await page.click(T(`stage-${n}`)); await page.waitForSelector(`${T('experiment-signal')}[data-stage="${n}"]`); await page.waitForTimeout(350); };
/** Back to the default settings (so that a failed step cannot spoil the next). */
const fresh = async () => { const dirty = await page.evaluate(() => { const s = window.__exp.getState(); return JSON.stringify([s.motor, s.visual, s.decoderId, s.motorCalib, s.visualCalib]); }); await page.click(T('exp-reset')); await page.waitForFunction((d) => { const el = document.querySelector('[data-testid="experiment-signal"]'); const s = window.__exp.getState(); return el?.dataset.status === 'ready' && (JSON.stringify([s.motor, s.visual, s.decoderId, s.motorCalib, s.visualCalib]) !== d || true); }, dirty, { timeout: 30000 }); await page.waitForTimeout(700); await page.waitForSelector(`${T('experiment-signal')}[data-status="ready"]`, { timeout: 30000 }); };
const seek = async (s) => { await setRange('tp-scrub', s); await page.waitForTimeout(150); };
const readout = async (box, label) => page.evaluate(([b, l]) => { for (const d of document.querySelectorAll(`[data-testid="${b}"] > div`)) if (d.querySelector('dt')?.innerText.toLowerCase().startsWith(l.toLowerCase())) return d.querySelector('dd').innerText; return null; }, [box, label]);
let env = {}, motorPlacement = null;

// ── 0 · the brain is prominent ──────────────────────────────────────────────────────────────────────────────────
await step('the brain fills the stage, at a large and at a small window size', async () => {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await settle(1300);
  env = await page.evaluate(() => { const c = document.querySelector('[data-testid="atlas-viewport"] canvas'); const gl = c.getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { ua: navigator.userAgent, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' }; });
  const big = await page.evaluate(() => window.__atlas.coverage());
  assert(big.h >= 0.55 && big.h <= 0.86, `1440 × 900: brain is ${(big.h * 100).toFixed(0)} % of the stage height`);
  await shot('01-brain-home');
  await page.setViewportSize({ width: 820, height: 620 });
  await settle(700);
  const small = await page.evaluate(() => window.__atlas.coverage());
  assert(Math.max(small.h, small.w) >= 0.5, `820 × 620: brain is ${(small.h * 100).toFixed(0)} % of the height, ${(small.w * 100).toFixed(0)} % of the width`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(700);
  return `1440 × 900: ${(big.h * 100).toFixed(0)} % of the height, ${(big.w * 100).toFixed(0)} % of the width · 820 × 620: ${(small.h * 100).toFixed(0)} % / ${(small.w * 100).toFixed(0)} % (the old opening shot was about 30 % in a small pane)`;
});

// ── 1 · attach ──────────────────────────────────────────────────────────────────────────────────────────────────
await step('acceptance 1 — Add BCI: the device follows the pointer over the surface, names the region, and attaches on a click', async () => {
  eq(await page.locator(T('bci-bar')).getAttribute('data-state'), 'none', 'no device at the start');
  await page.click(T('bci-add'));
  eq(await page.locator(T('bci-bar')).getAttribute('data-state'), 'placing', 'placing');
  const a = await pointOf('left_superior_frontal_gyrus'), b = await pointOf('left_precentral_gyrus');
  assert(a && b, 'both regions are in view');
  await page.mouse.move(a.x, a.y); await settle(250);
  const p1 = (await implant()).preview;
  eq(p1?.regionId, 'left_superior_frontal_gyrus', 'the preview is on the region under the pointer'); eq(p1.compatible, true, 'cortex can be used');
  await page.mouse.move(b.x, b.y, { steps: 8 }); await settle(250);
  const p2 = (await implant()).preview;
  eq(p2?.regionId, 'left_precentral_gyrus', 'the preview follows the pointer');
  assert(Math.hypot(p2.pointRasMm[0] - p1.pointRasMm[0], p2.pointRasMm[1] - p1.pointRasMm[1], p2.pointRasMm[2] - p1.pointRasMm[2]) > 5, 'the device moved over the surface');
  eq(await page.locator(T('atlas-hover-tag')).getAttribute('data-attach'), 'yes', 'the tag invites a click');
  await shot('02-placing');
  // somewhere that is not cortex cannot be used
  const cb = await page.evaluate(() => { const st = window.__atlas.store.getState(); for (const s of st.structures.values()) if (s.tissue === 'cerebellum') { const p = window.__atlas.screenPointOf(s.id); if (p) return p; } return null; });
  if (cb) { await page.mouse.move(cb.x, cb.y, { steps: 6 }); await settle(250); const pc = (await implant()).preview; eq(pc?.compatible, false, 'the cerebellum is refused'); await page.mouse.click(cb.x, cb.y); await settle(200); eq((await implant()).placement, null, 'a click there attaches nothing'); }
  await page.mouse.move(b.x, b.y, { steps: 6 }); await settle(200);
  await page.mouse.click(b.x, b.y);
  await settle(400); await cameraIdle();
  const im = await implant();
  eq(im.placing, false, 'placing ended'); eq(im.placement?.regionId, 'left_precentral_gyrus', 'attached to the region that was clicked');
  eq(await sel(), 'left_precentral_gyrus', 'that region is selected');
  eq(await page.locator(T('bci-bar')).getAttribute('data-state'), 'attached', 'the bar shows the device');
  eq(await page.locator(T('bci-actions')).getAttribute('data-attached'), 'yes', 'the card shows it too');
  motorPlacement = im.placement;
  await shot('03-attached-motor');
  return `attached at R ${im.placement.pointRasMm[0].toFixed(1)}, A ${im.placement.pointRasMm[1].toFixed(1)}, S ${im.placement.pointRasMm[2].toFixed(1)} mm on the left precentral gyrus; the cerebellum ${cb ? 'was refused' : 'was not in view'}`;
});

await step('acceptance 2 — the device stays on its spot of cortex while the brain is turned', async () => {
  await page.keyboard.press('Escape'); await settle(900); await cameraIdle();       // close the card; the device stays
  const before = await page.evaluate(() => window.__atlas.anchorScreen());
  assert(before?.onScreen && before.pickedId === 'left_precentral_gyrus' && before.distanceMm < 1, `before turning: the surface under the anchor is ${before?.pickedId} (${before?.distanceMm} mm away)`);
  const seen = [];
  const vp = page.locator(T('atlas-viewport'));
  await vp.focus();
  for (const key of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowRight']) {
    await page.keyboard.press(key); await settle(250);
    const a = await page.evaluate(() => window.__atlas.anchorScreen());
    seen.push(a);
    // the drawn device is exactly at its placement, whatever the camera does
    assert(a.deviceOffsetMm < 0.01, `after ${key}: the device is ${a.deviceOffsetMm.toFixed(3)} mm from its placement`);
    // and wherever that spot faces the camera unobstructed, the surface seen there is the same point of the same region
    if (a.onScreen && a.distanceMm !== null && a.distanceMm < 1) eq(a.pickedId, 'left_precentral_gyrus', `after ${key}: the surface under the device`);
  }
  // and with a mouse drag
  const box = await vp.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.82); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.8, { steps: 8 }); await page.mouse.up(); await settle(500);
  const after = await page.evaluate(() => window.__atlas.anchorScreen());
  const im = await implant();
  eq(JSON.stringify(im.placement.pointRasMm), JSON.stringify(motorPlacement.pointRasMm), 'the placement itself did not change');
  const moved = Math.max(...[...seen, after].map((a) => Math.hypot(a.x - before.x, a.y - before.y)));
  assert(moved > 25, `its position on screen moved with the brain (up to ${moved.toFixed(0)} px)`);
  const checked = seen.filter((a) => a.onScreen && a.distanceMm !== null && a.distanceMm < 1).length;
  assert(checked >= 3, `the anchor could be seen and checked from ${checked} directions`);
  await shot('04-rotated');
  await page.keyboard.press('0'); await settle(900); await cameraIdle();
  return `turned through ${seen.length} views and a drag: the device never left its placement (< 0.01 mm); in the ${checked} views where its spot faces the camera, the surface picked under it is the same point of the left precentral gyrus (within ${Math.max(...seen.filter((a) => a.distanceMm !== null && a.distanceMm < 1).map((a) => a.distanceMm)).toFixed(2)} mm); on screen it travelled up to ${moved.toFixed(0)} px`;
});

await step('the device can be dragged to another place, removed, re-attached from the card, and survives a reload', async () => {
  const a = await page.evaluate(() => window.__atlas.anchorScreen());
  // find a pixel on the enclosure (it floats above the anchor)
  const grab = await page.evaluate(([x, y]) => { for (let dy = 0; dy >= -60; dy -= 4) for (const dx of [0, -8, 8, -16, 16]) if (window.__atlas.deviceAt(x + dx, y + dy)) return { x: x + dx, y: y + dy }; return null; }, [a.x, a.y]);
  assert(grab, 'the enclosure can be found under the pointer');
  const to = await pointOf('left_postcentral_gyrus');
  assert(to, 'the postcentral gyrus is in view');
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 14 }); await settle(200);
  eq((await implant()).placing, true, 'dragging the device moves it');
  await page.mouse.up(); await settle(500); await cameraIdle();
  const moved = (await implant()).placement;
  eq(moved.regionId, 'left_postcentral_gyrus', 'dropped on the postcentral gyrus');
  await page.waitForSelector(T('bci-no-experiment'));
  await shot('05-moved-no-experiment');
  await page.click(T('bci-remove')); await settle(200);
  eq((await implant()).placement, null, 'removed');
  eq(await page.locator(T('bci-bar')).getAttribute('data-state'), 'none', 'the bar offers Add BCI again');
  await page.evaluate(() => { const s = window.__atlas.store.getState(); s.select('left_precentral_gyrus'); s.camera({ kind: 'fit', ids: ['left_precentral_gyrus'] }); });
  await page.click(T('bci-attach-here')); await settle(500);
  const again = (await implant()).placement;
  eq(again?.regionId, 'left_precentral_gyrus', 'attached from the card');
  await page.reload();
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await settle(800);
  const kept = (await implant()).placement;
  eq(JSON.stringify(kept), JSON.stringify(again), 'the placement is still there after a reload');
  motorPlacement = kept;
  return 'dragged precentral → postcentral (no experiment offered there), removed, re-attached from the card, kept across a reload';
});

// ── 3 · region-specific explanations ────────────────────────────────────────────────────────────────────────────
let motorText = '';
await step('acceptance 3 — motor and occipital cortex give different, sourced explanations; other regions say what is not known', async () => {
  const read = async (id) => {
    await page.evaluate((i) => { const s = window.__atlas.store.getState(); s.select(i); }, id);
    await page.waitForSelector(T('region-brief')); await settle(250);
    const o = { depth: await page.locator(T('region-brief')).getAttribute('data-depth'), relation: (await page.locator(T('brief-relation')).count()) ? await txt('brief-relation') : '', tabs: {} };
    const links = new Set();
    for (const t of ['anatomy', 'function', 'bci', 'signals', 'unknowns']) { await page.click(T(`brief-tab-${t}`)); o.tabs[t] = await txt(`brief-panel-${t}`); for (const h of await page.locator(`${T(`brief-panel-${t}`)} a.cite`).evaluateAll((a) => a.map((x) => x.href))) links.add(h); }
    o.neighbours = await page.evaluate(() => { document.querySelector('[data-testid="brief-tab-anatomy"]').click(); return 0; }).then(async () => { await settle(80); return page.locator(`${T('brief-neighbours')} li`).count(); });
    o.cites = links.size;
    return o;
  };
  const m = await read('left_precentral_gyrus');
  await shot('06-brief-motor');
  const v = await read('left_lateral_occipital_gyrus');
  await page.click(T('brief-tab-bci')); await settle(100);
  await shot('07-brief-occipital');
  const x = await read('left_supramarginal_gyrus');
  eq(m.depth, 'dossier', 'motor: full dossier'); eq(v.depth, 'dossier', 'occipital: full dossier'); eq(x.depth, 'atlas-only', 'supramarginal: atlas only');
  assert(/primary motor cortex/i.test(m.relation) && /area 4/i.test(m.relation), 'motor: says how the gyrus relates to M1');
  assert(/visual/i.test(v.relation) && /lateral occipital/i.test(v.relation), 'occipital: says how the gyrus relates to the functional areas');
  assert(/cursor/i.test(m.tabs.bci) && /Kalman/i.test(m.tabs.bci), 'motor BCI: cursor control and decoders');
  assert(/preferred/i.test(m.tabs.function) && /monkey/i.test(m.tabs.function), 'motor function: direction tuning, with the species');
  assert(/phosphenes/i.test(v.tabs.bci) && /No cursor-control/i.test(v.tabs.bci), 'occipital BCI: stimulation evidence, and no cursor control');
  assert(/objects/i.test(v.tabs.function), 'occipital function: object-related responses');
  assert(/broadband/i.test(v.tabs.signals) && /spike|action potential/i.test(m.tabs.signals), 'different signals are expected');
  assert(/cannot be told from this atlas/i.test(m.tabs.unknowns) && /cannot reconstruct what a person sees/i.test(v.tabs.unknowns), 'each says what is not known');
  for (const t of ['anatomy', 'function', 'bci', 'signals', 'unknowns']) assert(m.tabs[t] !== v.tabs[t] && m.tabs[t].length > 200 && v.tabs[t].length > 200, `${t}: substantial and different`);
  assert(m.cites >= 12 && v.cites >= 12, `sources are linked (${m.cites} and ${v.cites} distinct sources)`);
  assert(m.neighbours >= 3 && v.neighbours >= 3 && x.neighbours >= 3, 'neighbouring regions are listed from the atlas');
  assert(/No reviewed/i.test(x.tabs.function) && /no claim/i.test(x.tabs.bci), 'an unwritten region says so instead of guessing');
  motorText = m.tabs.function;
  return `precentral: ${m.cites} distinct linked sources, ${m.neighbours} bordering regions · lateral occipital: ${v.cites} sources, ${v.neighbours} borders · supramarginal gyrus: atlas-derived anatomy only, “no reviewed text” for the rest`;
});

// ── 4–9 · the motor experiment ──────────────────────────────────────────────────────────────────────────────────
await step('acceptance 4 — Start experiment: a simulated recording that plays, pauses and scrubs', async () => {
  await page.evaluate(() => window.__atlas.store.getState().select('left_precentral_gyrus'));
  await page.waitForSelector(T('bci-start'));
  await page.click(T('bci-start'));
  await page.waitForSelector(`${T('experiment-workspace')}[data-kind="motor"]`, { timeout: 8000 });
  await page.waitForSelector(`${T('experiment-signal')}[data-status="ready"]`, { timeout: 40000 });
  await settle(1800);
  eq(await txt('experiment-title'), 'Movement: from intention to a cursor', 'title');
  const t0 = num(await txt('tp-clock'));
  await page.click(T('tp-play')); await settle(1200);
  eq(await page.locator(T('tp-play')).getAttribute('data-playing'), 'true', 'playing');
  const t1 = num(await txt('tp-clock'));
  assert(t1 > t0 + 0.5, `the clock runs (${t0} → ${t1} s)`);
  await shot('08-experiment-tissue');
  await page.click(T('tp-play')); await settle(200);
  const t2 = num(await txt('tp-clock')); await settle(600);
  eq(num(await txt('tp-clock')), t2, 'paused: the clock stands still');
  const dec0 = await txt('now-decoded');
  await seek(6.4);
  eq(num(await txt('tp-clock')), 6.4, 'scrubbed to 6.4 s');
  assert((await txt('now-decoded')) !== dec0, 'the decoded output is a function of the timeline position');
  await page.click(T('tp-reset')); eq(num(await txt('tp-clock')), 0, 'back to the start');
  await seek(6.4);
  return `played ${t0.toFixed(2)} → ${t1.toFixed(2)} s, paused, scrubbed to 6.400 s; ${await txt('exp-status')}`;
});

await step('acceptance 5 — moving the electrode away or adding noise changes the computed waveform', async () => {
  await stage(3);
  await page.click(T('jump-next')); await settle(300);
  const amp0 = num(await readout('electrode-readouts', 'Its spike')), snr0 = num(await readout('electrode-readouts', 'Spike ÷ noise')), d0 = num(await readout('electrode-readouts', 'This contact'));
  eq(num(await txt('tissue-distance')), d0, 'the 3D scene and the readout agree on the distance');
  await shot('09-electrode-near');
  await recompute(() => setRange('knob-distance', (120 - 25) / 175));
  const dist = num(await txt('knob-distance-out'));
  const amp1 = num(await readout('electrode-readouts', 'Its spike')), snr1 = num(await readout('electrode-readouts', 'Spike ÷ noise')), d1 = num(await readout('electrode-readouts', 'This contact'));
  assert(Math.abs(dist - 120) <= 5 && d1 === d0 + (dist - 45), `nominal distance ${dist} µm; this contact’s nearest neuron ${d0} → ${d1} µm`);
  assert(amp1 < amp0 * 0.55, `the spike shrank from ${amp0} to ${amp1} µV`);
  assert(Math.abs(amp1 - (120 * 30) / d1) <= 1, `and it is the stated 1 / distance rule (120 µV × 30 µm / ${d1} µm)`);
  eq(num(await txt('tissue-distance')), d1, 'the 3D scene shows the new distance');
  await shot('10-electrode-far');
  await stage(6);
  const from1 = (await readout('dsp-readouts', 'Crossings from a model neuron')).split(' of ').map(num);
  await stage(3);
  await recompute(() => setRange('knob-distance', (45 - 25) / 175));
  const sig0 = num(await readout('electrode-readouts', 'Noise in the detector'));
  await recompute(() => setRange('knob-noise', (21 - 1) / 39));
  const sig1 = num(await readout('electrode-readouts', 'Noise in the detector'));
  assert(sig1 > sig0 * 2.2, `the noise estimate rose from ${sig0} to ${sig1} µV`);
  await stage(6);
  const from0 = await (async () => { await stage(3); await recompute(() => setRange('knob-noise', (7 - 1) / 39)); await stage(6); return (await readout('dsp-readouts', 'Crossings from a model neuron')).split(' of ').map(num); })();
  assert(from1[0] < from0[0] * 0.6, `fewer of the neuron’s spikes are detected from far away (${from1[0]} vs ${from0[0]})`);
  return `${d0} → ${d1} µm: nearest spike ${amp0} → ${amp1} µV, spike ÷ noise ${snr0} → ${snr1}, detected spikes on this contact ${from0[0]} → ${from1[0]} · noise 7 → 21 µV: estimate ${sig0} → ${sig1} µV`;
});

await step('acceptance 6 — amplification, sampling, quantisation and digital processing can each be inspected and broken', async () => {
  await fresh();
  await stage(4);
  eq(await page.locator(T('fe-clipped')).count(), 0, 'no clipping with the default front end');
  for (const w of ['wave-fe-in', 'wave-fe-hp', 'wave-fe-out']) assert(await page.locator(T(w)).count(), `${w} is shown`);
  await recompute(() => page.click(T('knob-hp-0')));
  assert(/AC-coupled/.test(await txt('fe-clipped')), 'DC-coupled: the offset times the gain saturates the amplifier, and the page says why');
  await shot('11-frontend-dc-saturated');
  await recompute(() => page.click(T('knob-hp-300')));
  eq(await page.locator(T('fe-clipped')).count(), 0, 'restored');
  await shot('12-frontend');
  await stage(5);
  await page.waitForSelector(`${T('adc-table')} tbody tr`);
  const bits12 = await page.locator(`${T('adc-table')} td.bits`).first().innerText();
  eq(bits12.length, 12, '12-bit codes are 12 bits long');
  const code = num(await txt('adc-code-now')), row = await page.evaluate(() => [...document.querySelector('[data-testid="adc-table"] tr.is-now').children].map((c) => c.innerText));
  eq(parseInt(row[4], 2) > 2047 ? parseInt(row[4], 2) - 4096 : parseInt(row[4], 2), code, 'the stored bits are the code, in two’s complement');
  assert(Math.abs(num(row[2]) - code * (1000 / 2048)) <= 1000 / 4096 + 0.011, `the code is the voltage rounded to the nearest step (${row[2]} ↔ code ${code})`);
  await shot('13-adc');
  await recompute(() => setRange('knob-bits', (8 - 4) / 12));
  eq((await page.locator(`${T('adc-table')} td.bits`).first().innerText()).length, 8, '8-bit codes are 8 bits long');
  const lsb8 = num(await readout('adc-readouts', 'One step at the electrode'));
  assert(Math.abs(lsb8 - (1e6 / 128 / 500)) < 0.6, `one step = ${lsb8} µV at the electrode for 8 bits and × 500`);
  await recompute(() => page.click(T('knob-fs-3000')));
  assert(/folded back/.test(await txt('adc-alias')), 'a low-pass corner above the Nyquist frequency is reported as aliasing');
  await shot('14-adc-aliasing');
  await recompute(() => page.click(T('knob-fs-30000')));
  await recompute(() => setRange('knob-bits', (12 - 4) / 12));
  await stage(6);
  await page.click(T('jump-next')); await settle(250);
  const thr = num(await readout('dsp-readouts', 'Threshold')), at = num(await txt('wave-dsp-out-now'));
  assert(at < -thr, `at a counted crossing the detector input (${at} µV) is below the threshold (−${Math.abs(thr)} µV)`);
  const withCar = (await readout('dsp-readouts', 'Crossings from a model neuron')).split(' of ').map(num);
  await shot('15-dsp');
  await recompute(() => page.click(T('toggle-car')));
  const noCar = (await readout('dsp-readouts', 'Crossings from a model neuron')).split(' of ').map(num);
  assert(noCar[1] - noCar[0] > withCar[1] - withCar[0] + 5, `without the common average, artefacts are counted as spikes (${noCar[1] - noCar[0]} vs ${withCar[1] - withCar[0]} false crossings)`);
  await recompute(() => page.click(T('toggle-car')));
  return `DC coupling saturates the amplifier; a 12-bit code and its bits match the sampled voltage; 3 kS/s with a 7.5 kHz filter is flagged as aliasing; threshold −${Math.abs(thr)} µV; false crossings on this contact ${withCar[1] - withCar[0]} with the common average, ${noCar[1] - noCar[0]} without`;
});

await step('acceptance 7 — the decoder produces numbers from the features, and they add up', async () => {
  await fresh();
  await stage(7);
  await seek(6.4);
  const terms = async (id) => page.evaluate((i) => [...document.querySelectorAll(`[data-testid="${i}"] .exp-term:not(.total) output`)].map((o) => parseFloat(o.innerText.replace('−', '-'))), id);
  const tx = await terms('terms-x'), sx = num(await txt('terms-x-sum')), ty = await terms('terms-y'), sy = num(await txt('terms-y-sum'));
  eq(tx.length, 9, 'a bias and eight channel terms');
  assert(Math.abs(tx.reduce((a, v) => a + v, 0) - sx) < 0.006 && Math.abs(ty.reduce((a, v) => a + v, 0) - sy) < 0.006, `the terms add up to the output (${sx}, ${sy})`);
  const dec = (await readout('decoder-readouts', 'Decoded velocity')).match(/-?[\d.]+/g).map(Number);
  assert(Math.abs(dec[0] - sx) < 0.011 && Math.abs(dec[1] - sy) < 0.011, 'that output is the decoded velocity');
  assert(/±/.test(await readout('decoder-readouts', 'Uncertainty')), 'an uncertainty is shown');
  const inputs = await page.locator(`${T('decoder-inputs')} tbody tr`).count();
  eq(inputs, 8, 'eight inputs');
  await shot('16-decoder-linear');
  const r2 = num(await txt('r2-now-linear'));
  assert(r2 > 0.5 && r2 < 0.95, `held-out R² ${r2}`);
  await recompute(() => page.click(T('decoder-pick-kalman')));
  const kx = num(await txt('terms-x-sum'));
  assert(kx !== sx, 'another decoder gives another number from the same features');
  assert(/carried from the last bin/.test(await txt('terms-x')), 'the Kalman filter’s carried-over state is shown as a term');
  await shot('17-decoder-kalman');
  await recompute(() => page.click(T('decoder-pick-mlp8')));
  eq((await terms('terms-x')).length, 9, 'the network’s output is a bias and eight hidden-unit terms');
  await recompute(() => page.click(T('decoder-pick-linear')));
  return `at 6.40 s the linear decoder’s nine terms sum to (${sx}, ${sy}) = the decoded velocity; Kalman gives ${kx} for x from the same counts; held-out R² ${r2}`;
});

await step('acceptance 8 — a prediction can be traced back: decoder → detector → samples → amplifier → electrode → neuron', async () => {
  await fresh();
  await stage(7);
  let found = null, idx = -1;
  for (const t of [6.4, 6.45, 6.5, 6.55, 6.6, 6.7, 6.8, 7.0, 7.2, 7.4, 7.6]) {
    await seek(t);
    const lines = await page.locator(`${T('trace-panel')} .exp-events li`).allInnerTexts();
    idx = lines.findIndex((l) => l.includes('nearest neuron'));
    if (idx >= 0) { found = t; break; }
  }
  assert(found !== null, 'a bin with a crossing caused by the nearest model neuron');
  const item = page.locator(`${T('trace-panel')} .exp-events li`).nth(idx);
  const line = await item.innerText();
  const evT = num(line);
  await shot('18-trace-panel');
  await item.locator(T('trace-to-6')).click();
  await page.waitForSelector(`${T('experiment-signal')}[data-stage="6"]`); await settle(300);
  // both numbers are three-decimal displays of the same sample time; a sample that falls on a half millisecond
  // (one in fifteen does at 30 kHz) can round either way, so they may differ by one unit of the last digit
  assert(Math.abs(num(await txt('tp-clock')) - evT) <= 0.0011, `the playhead is on the crossing: clock ${await txt('tp-clock')}, crossing ${evT}`);
  const thr = num(await readout('dsp-readouts', 'Threshold'));
  assert(num(await txt('wave-dsp-out-now')) < -thr, 'the detector input is below threshold there');
  await shot('19-trace-detector');
  await stage(5);
  const code = num(await txt('adc-code-now'));
  assert(Number.isFinite(code), `the ADC code at that instant is ${code}`);
  await stage(4);
  const vOut = num(await txt('wave-fe-out-now'));
  await stage(3);
  const share = num(await txt('wave-share-now')), elec = num(await txt('wave-elec-now'));
  await stage(2);
  const vm = num(await txt('wave-vm-now'));
  assert(vm > -60, `the nearest neuron is mid-spike at that instant (membrane potential ${vm} mV)`);
  await settle(1200);
  await shot('20-trace-neuron');
  return `bin at ${found} s → crossing at ${evT.toFixed(4)} s (“${line.split('\n')[1] ?? ''}”) → detector below −${Math.abs(thr)} µV → ADC code ${code} → amplifier ${vOut} V → contact ${elec} µV, of which the neuron ${share} µV → membrane potential ${vm} mV`;
});

await step('acceptance 9 — provenance and assumptions are visible at every stage, in three synchronised representations', async () => {
  await fresh();
  const seen = new Set();
  for (let n = 1; n <= 8; n++) {
    await stage(n);
    const prov = await page.evaluate(() => [...document.querySelectorAll('[data-testid="explain-prov"] [data-prov]')].map((e) => e.dataset.prov));
    assert(prov.length >= 1, `stage ${n} carries a provenance label`);
    prov.forEach((p) => seen.add(p));
    const assume = await page.locator(`${T('assumptions')} li`).count();
    assert(assume >= 2, `stage ${n} lists its assumptions (${assume})`);
    assert((await page.locator(`${T('assumptions')} a.cite`).count()) >= 1, `stage ${n} links its sources`);
  }
  assert(await page.locator('.exp-kicker [data-prov="simulated"]').count(), 'the scene itself is labelled SIMULATED');
  // one state, three representations
  await stage(4);
  await page.click(T('mode-math')); await settle(150);
  assert(await page.locator(`${T('explain-math')} .eq`).count(), 'physics & maths: equations');
  const before = await txt('explain-math');
  await page.click(T('mode-engineering')); await settle(150);
  assert(await page.locator(`${T('explain-engineering')} .exp-spec`).count(), 'engineering: a specification table');
  await recompute(() => setRange('knob-gain', Math.log(1000 / 20) / Math.log(5000 / 20)));
  const gain = num(await txt('knob-gain-out'));
  assert(new RegExp(`× ${gain}`).test(await txt('explain-engineering')), 'the engineering view shows the new gain');
  await shot('21-mode-engineering');
  await page.click(T('mode-math')); await settle(150);
  const after = await txt('explain-math');
  assert(after !== before && /At 1 kHz: × 9\d\d/.test(after), `the maths view shows the same change (${after.match(/At 1 kHz: × \d+/)?.[0]})`);
  await shot('22-mode-math');
  await stage(8);
  eq(await page.locator(`${T('experiment-signal')}`).getAttribute('data-mode'), 'math', 'the representation stays when the stage changes');
  await page.click(T('mode-cinematic'));
  await recompute(() => page.click(T('exp-reset')));
  // the same labels exist on the brain: device = illustrative, borders = atlas-derived
  return `labels seen across the eight stages: ${[...seen].join(', ')}; a gain change made in the engineering view is the number in the maths view`;
});

await step('the cursor reaches its targets, and a broken recording stops it', async () => {
  await fresh();
  await stage(8);
  const ok = (await readout('output-readouts', 'Targets reached')).split(' of ').map(num);
  assert(ok[0] >= 5 && ok[0] === ok[1], `${ok[0]} of ${ok[1]} targets reached`);
  await seek(9);
  await shot('23-output-cursor');
  await stage(3);
  await recompute(() => setRange('knob-distance', 1));
  await stage(7);
  assert(await page.locator(T('decoder-drifted')).count(), 'the page says the decoders are being used outside their calibration');
  const r2 = num(await txt('r2-now-linear'));
  await stage(8);
  const far = (await readout('output-readouts', 'Targets reached')).split(' of ').map(num);
  assert(far[0] < ok[0], `with the electrode 200 µm away fewer targets are reached (${far[0]} of ${far[1]})`);
  await stage(7);
  await recompute(() => page.click(T('recalibrate')));
  eq(await page.locator(T('decoder-drifted')).count(), 0, 'after recalibrating the warning is gone');
  const r2b = num(await txt('r2-now-linear'));
  await recompute(() => page.click(T('exp-reset')));
  return `as calibrated: ${ok[0]} of ${ok[1]} targets · electrode at 200 µm: ${far[0]} of ${far[1]}, held-out R² ${r2} · recalibrated there: R² ${r2b}`;
});

await step('Follow signal: the tour plays and moves on through the stages by itself', async () => {
  await page.click(T('follow-signal'));
  eq(await page.locator(T('experiment-signal')).getAttribute('data-stage'), '1', 'the tour starts at the tissue');
  eq(await page.locator(T('tp-play')).getAttribute('data-playing'), 'true', 'and plays');
  await page.waitForSelector(`${T('experiment-signal')}[data-stage="2"]`, { timeout: 12000 });
  await page.waitForSelector(`${T('experiment-signal')}[data-stage="3"]`, { timeout: 12000 });
  const speed = await page.locator(T('tp-speed')).inputValue();
  eq(speed, '0.01', 'a spike is shown a hundred times slower than real time');
  await page.click(T('follow-signal')); await settle(200);
  eq(await page.locator(T('tp-play')).getAttribute('data-playing'), 'false', 'stopping the tour pauses');
  return 'tissue → neuron → electrode in sequence, slowing to 1/100 of real time for the spike; stopped on request';
});

// ── the visual experiment ───────────────────────────────────────────────────────────────────────────────────────
await step('milestone 4 — on occipital cortex the same device records a different signal for a different task', async () => {
  await page.click(T('nav-brain')); await settle(500);
  await page.evaluate(() => { const s = window.__atlas.store.getState(); s.select('left_lateral_occipital_gyrus'); s.camera({ kind: 'fit', ids: ['left_lateral_occipital_gyrus'] }); });
  await page.click(T('bci-attach-here')); await settle(900); await cameraIdle();
  eq((await implant()).placement.regionId, 'left_lateral_occipital_gyrus', 'device moved to the lateral occipital gyrus');
  await shot('24-attached-occipital');
  await page.click(T('bci-start'));
  await page.waitForSelector(`${T('experiment-workspace')}[data-kind="visual"]`, { timeout: 8000 });
  await page.waitForSelector(`${T('experiment-signal')}[data-status="ready"]`, { timeout: 40000 });
  await settle(1800);
  eq(await txt('experiment-title'), 'Vision: from a picture to a report', 'title');
  await shot('25-visual-tissue');
  await stage(3);
  eq(await page.locator(T('knob-distance')).count(), 0, 'no electrode-distance control: the model has no law for it and says so');
  await stage(6);
  await shot('26-visual-dsp');
  await stage(7);
  await seek(5.6);
  assert(/%/.test(await txt('p-on')), 'the decoder reports a probability');
  await shot('27-visual-decoder');
  await stage(8);
  const obj = (await readout('output-readouts', 'Intact objects detected')).split(' of ').map(num), scr = (await readout('output-readouts', 'Scrambled pictures detected')).split(' of ').map(num);
  const which = (await readout('output-readouts', 'Which object')).split(' of ').map(num), fa = (await readout('output-readouts', 'False alarms')).split(' of ').map(num);
  eq(obj[0], obj[1], 'every intact object is detected');
  assert(scr[0] < scr[1], 'some weakly driving pictures are missed');
  assert(which[0] <= which[1] * 0.6, 'which object: chance');
  assert(fa[0] <= fa[1] * 0.05, 'few false alarms');
  const limits = await txt('visual-limits');
  assert(/chance by construction/.test(limits) && /nothing here to steer/.test(limits) && /not evidence for it/.test(limits), 'the limits are stated on the page');
  await shot('28-visual-output');
  await recompute(async () => { await stage(6); await page.click(T('toggle-car')); });
  await stage(8);
  const noCar = (await readout('output-readouts', 'Intact objects detected')).split(' of ').map(num)[0] + (await readout('output-readouts', 'Scrambled pictures detected')).split(' of ').map(num)[0];
  assert(noCar < obj[0] + scr[0], 'leaving the mains hum in hides pictures');
  await recompute(() => page.click(T('exp-reset')));
  return `intact objects ${obj[0]} of ${obj[1]}, scrambled ${scr[0]} of ${scr[1]}, false alarms ${fa[0]} of ${fa[1]} bins, which object ${which[0]} of ${which[1]} (chance 1 in 4); with the hum left in only ${noCar} pictures are detected`;
});

// ── decoder lab ─────────────────────────────────────────────────────────────────────────────────────────────────
await step('milestone 6 — decoder comparison: held-out scores, costs, a Pareto frontier, and a preference that follows the constraints', async () => {
  await page.click(T('view-lab'));
  await page.waitForSelector(T('decoder-lab'), { timeout: 90000 });
  eq(await page.locator(`${T('lab-table')} tbody tr`).count(), 5, 'five decoders');
  assert(/synthetic teaching data/.test(await txt('lab-caveat')) && /does not establish/.test(await txt('lab-caveat')), 'the page says what the numbers are not');
  const pick0 = await page.locator(T('lab-verdict')).getAttribute('data-pick');
  await shot('29-lab');
  await setRange('lab-cycles', Math.log(30 / 15) / Math.log(400 / 15)); await settle(200);
  const pick1 = await page.locator(T('lab-verdict')).getAttribute('data-pick');
  assert(pick1 !== pick0, `a 30-cycle budget changes the preferred decoder (${pick0} → ${pick1})`);
  assert(/Ruled out/.test(await txt('lab-verdict')), 'and the page says which were ruled out and why');
  eq(await page.locator(T(`pareto-${pick0}`)).getAttribute('data-feasible'), 'false', 'the former choice is marked as over budget');
  await page.click(T('lab-lost-4')); await settle(200);
  const pick2 = await page.locator(T('lab-verdict')).getAttribute('data-pick');
  await shot('30-lab-constrained');
  assert(/outperformed/.test(await txt('lab-real')) && /not part of this build/.test(await txt('lab-real')), 'findings from real recordings are kept apart, and the missing real-data benchmark is stated');
  const lin = await page.locator(`${T('lab-row-linear')} td`).allInnerTexts();
  eq(lin[6], '18', 'the linear decoder: 18 cycles');
  await page.click(T('view-signal'));
  return `no budget: ${pick0} · 30 cycles: ${pick1} · 30 cycles and four channels lost: ${pick2}`;
});

// ── robustness ──────────────────────────────────────────────────────────────────────────────────────────────────
await step('no device, an unsupported region, a phone-sized window', async () => {
  await page.click(T('nav-brain')); await settle(300);
  await page.click(T('bci-bar-remove')); await settle(200);
  await page.click(T('nav-experiment'));
  await page.waitForSelector(T('experiment-empty'));
  assert(/Attach the virtual BCI first/.test(await txt('experiment-empty')), 'without a device the scene asks for one');
  await shot('31-experiment-empty');
  await page.click(T('exp-attach-motor'));
  await page.waitForSelector(`${T('experiment-signal')}[data-status="ready"]`, { timeout: 40000 });
  eq((await implant()).placement.regionId, 'left_precentral_gyrus', 'one click attaches it to a region that has an experiment');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => consoleErrors.push('phone: ' + String(e)));
  await pp.goto(BASE + '/#/brain');
  await pp.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await pp.waitForTimeout(900);
  await pp.tap(T('bci-add'));
  const pt = await pp.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus') ?? window.__atlas.screenPointOf('left_superior_frontal_gyrus'));
  await pp.touchscreen.tap(pt.x, pt.y); await pp.waitForTimeout(700);
  const reg = await pp.evaluate(() => window.__atlas.implant.getState().placement?.regionId);
  assert(reg, 'a tap attaches the device on a phone');
  await shot('32-phone-brain', pp);
  await pp.evaluate(() => { const s = window.__atlas.bestSite('left_precentral_gyrus'); window.__atlas.implant.getState().attach(s); });
  await pp.goto(BASE + '/#/experiment');
  await pp.waitForSelector(`${T('experiment-signal')}[data-status="ready"]`, { timeout: 60000 });
  await pp.waitForTimeout(800);
  const wide = await pp.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  assert(wide <= 2, `no sideways scrolling on a phone (${wide} px)`);
  await shot('33-phone-experiment', pp);
  await phone.close();
  return `empty state offers a one-click attachment; on a 390-px phone a tap attached the device to the ${reg.replace(/_/g, ' ')} and the experiment fits the width`;
});

await step('nothing was logged as an error', async () => {
  const real = consoleErrors.filter((e) => !/GL Driver Message|GPU stall|WebGL: INVALID_OPERATION: getParameter/.test(e));
  assert(real.length === 0, `${real.length} console error(s): ${real.slice(0, 3).join(' | ')}`);
  return `${consoleErrors.length - real.length} graphics-driver notices ignored`;
});

await browser.close();
const pass = results.filter((r) => r.ok).length;
const lines = [
  `# Interactive BCI experiment — end-to-end acceptance test`, `# ${new Date().toISOString()} · production build · ${env.renderer ?? ''}`, `# ${env.ua ?? ''}`, '',
  ...results.map((r) => `${r.ok ? '✓' : '✗'} ${r.name}  (${(r.ms / 1000).toFixed(1)} s)\n    ${r.info}`), '',
  `${pass} of ${results.length} steps passed.`,
];
writeFileSync(join(out, 'e2e-report.txt'), lines.join('\n') + '\n');
console.log(`\n${pass} of ${results.length} steps passed.`);
void motorText;
process.exit(pass === results.length ? 0 : 1);
