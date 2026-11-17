// End-to-end acceptance walkthrough against the PRODUCTION build, in a real Chrome driven by playwright-core:
//   open → brain → hover a motor-region parcel → select + cited explanation → electrode → signal chain + ADC →
//   implemented digital blocks → pause / scrub computed traces → supporting research → back to the same region.
// Plus: no hidden-object picking, isolate / restore, camera interruption, keyboard and touch equivalents, load-failure
// states, phone viewport, and basic accessibility checks.
//
//   npm run build && node tests/e2e/walkthrough.mjs            (headless; functional evidence only)
//   HEADED=1 node tests/e2e/walkthrough.mjs                    (visible window on the real GPU)
//
// Writes docs/evidence/e2e-report.txt and docs/evidence/screenshots/*.png. Exit code 1 if any step fails.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5199, BASE = `http://127.0.0.1:${PORT}`;
const shots = join(root, 'docs/evidence/screenshots');
mkdirSync(shots, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not found — run npm run build first'); process.exit(2); }

const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
  if (i === 59) { console.error('preview server did not start:\n' + serverLog); process.exit(2); }
}

const results = [];
const consoleErrors = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const info = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, info: info ?? '' }); console.log(`✓ ${name}${info ? ` — ${info}` : ''}`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, info: String(e?.message ?? e).split('\n')[0] }); console.log(`✗ ${name} — ${String(e?.message ?? e).split('\n')[0]}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
const shot = (name, p = page) => p.screenshot({ path: join(shots, `${name}.png`) });
const T = (id) => `[data-testid="${id}"]`;
const store = (expr) => page.evaluate(`(() => { const s = window.__atlas.store.getState(); return ${expr}; })()`);
const settle = (ms = 250) => page.waitForTimeout(ms);
let env = {};

// ── 1 · the brain is the home screen ────────────────────────────────────────────────────────────────────────────
await step('open the studio: the first screen is the 3D brain atlas', async () => {
  await page.goto(BASE);
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await page.waitForSelector(`${T('atlas-viewport')} canvas`);
  await page.waitForFunction(() => window.__atlasPerf && window.__atlasPerf.bvhCount >= 251, null, { timeout: 30000 });
  const s = await store('({ n: s.structures.size, groups: s.groups.size, sel: s.selectedId, ws: location.hash })');
  eq(s.n, 251, 'structures loaded');
  env = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="atlas-viewport"] canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { ua: navigator.userAgent, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', canvas: [c.width, c.height], dpr: devicePixelRatio };
  });
  // the canvas actually contains a rendered brain (not a blank frame): sample pixels through a screenshot
  const png = await page.locator(T('atlas-viewport')).screenshot();
  assert(png.length > 40000, `viewport screenshot is suspiciously small (${png.length} bytes)`);
  await shot('01-home-brain');
  return `${s.n} structures, ${s.groups} groups; renderer: ${env.renderer}`;
});

await step('no permanent label cloud; hint invites hovering', async () => {
  assert(await page.locator(T('atlas-hint')).isVisible(), 'hint missing');
  eq(await page.locator(T('atlas-hover-tag')).isVisible(), false, 'hover tag visible before hovering');
  eq(await page.locator(T('region-inspector')).count(), 0, 'inspector open with no selection');
});

// ── 2 · hover and select the motor-region parcel ────────────────────────────────────────────────────────────────
let pt;
await step('hover the left precentral gyrus: the tag names exactly that structure', async () => {
  pt = await page.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  assert(pt, 'left precentral gyrus has no visible point in the home view');
  await page.mouse.move(pt.x - 40, pt.y - 40); await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForFunction(() => window.__atlas.store.getState().hoverId === 'left_precentral_gyrus', null, { timeout: 3000 });
  const tag = await page.locator(`${T('atlas-hover-tag')} .atlas-tag-name`).innerText();
  eq(tag.toLowerCase(), 'left precentral gyrus', 'hover tag');
  await shot('02-hover-precentral');
  return `at (${Math.round(pt.x)}, ${Math.round(pt.y)})`;
});

await step('picking resolves real ids: five other structures hover as themselves', async () => {
  const ids = ['left_postcentral_gyrus', 'left_superior_frontal_gyrus', 'left_superior_temporal_gyrus', 'left_frontal_pole', 'left_lateral_occipital_gyrus'];
  const seen = [];
  for (const id of ids) {
    const p = await page.evaluate((i) => window.__atlas.screenPointOf(i), id);
    if (!p) continue; // not visible from this view
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForFunction((i) => window.__atlas.store.getState().hoverId === i, id, { timeout: 3000 });
    const name = (await page.locator(`${T('atlas-hover-tag')} .atlas-tag-name`).innerText()).toLowerCase();
    eq(name, id.replace(/_/g, ' '), `hover over ${id}`);
    seen.push(id);
  }
  assert(seen.length >= 4, `only ${seen.length} of ${ids.length} test structures were visible`);
  return `${seen.length} structures`;
});

await step('click selects it and opens a concise, cited explanation with the gyrus ≠ M1 caution', async () => {
  await page.mouse.move(pt.x, pt.y, { steps: 3 });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector(T('region-inspector'));
  eq((await page.locator(T('region-title')).innerText()).toLowerCase(), 'left precentral gyrus', 'inspector title');
  const caution = await page.locator(T('region-caution')).innerText();
  assert(/≠/.test(caution) && /cell architecture/.test(caution) && /bounded approximation/.test(caution), 'caution text incomplete');
  const cites = await page.locator(`${T('region-inspector')} .cite`).count();
  assert(cites >= 6, `only ${cites} citations in the inspector`);
  eq((await page.locator(T('region-chip')).innerText()).toLowerCase().includes('left precentral gyrus'), true, 'region chip');
  await shot('03-selected-precentral-inspector');
  return `${cites} citation chips`;
});

await step('"M1" search finds the gyrus and carries the caveat; nothing is named M1', async () => {
  await page.fill(T('atlas-search'), 'M1');
  await page.waitForSelector(`${T('atlas-search-results')} .atlas-hit`);
  const txt = await page.locator(T('atlas-search-results')).innerText();
  assert(/left precentral gyrus/i.test(txt) && /not identical/i.test(txt), `results: ${txt.slice(0, 120)}`);
  await shot('04-search-m1');
  await page.keyboard.press('Escape');
});

// ── 3 · display rules ───────────────────────────────────────────────────────────────────────────────────────────
await step('hidden structures are never picked: hiding the gyrus exposes what lies behind it', async () => {
  // the inspector has opened and the viewport is narrower now: find the gyrus again
  await settle(400);
  pt = await page.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  assert(pt, 'gyrus not visible after the inspector opened');
  eq((await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), pt)).id, 'left_precentral_gyrus', 'before hiding');
  await page.locator(`${T('region-inspector')} button:has-text("Hide")`).first().click();
  await settle();
  const hit = await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), pt);
  assert(!hit || hit.id !== 'left_precentral_gyrus', 'picked a hidden structure');
  await page.mouse.move(pt.x + 2, pt.y + 2); await page.mouse.move(pt.x, pt.y, { steps: 2 });
  await settle();
  const hov = await store('s.hoverId');
  assert(hov !== 'left_precentral_gyrus', 'hovered a hidden structure');
  await page.locator(T('tb-restore')).click();
  await settle();
  eq((await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), pt)).id, 'left_precentral_gyrus', 'after restore');
  return `behind it: ${hit ? hit.id : 'nothing'}`;
});

await step('see-through cortex does not steal the pointer; the selection stays opaque', async () => {
  await page.evaluate(() => { const s = window.__atlas.store.getState(); s.setCortexOpacity(0.2); });
  await settle();
  // the selected gyrus stays opaque and pickable while the rest of the cortex is see-through
  eq((await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), pt)).id, 'left_precentral_gyrus', 'selected structure under a transparent cortex');
  const other = await page.evaluate(() => window.__atlas.screenPointOf('left_superior_frontal_gyrus'));
  eq(other, null, 'a see-through gyrus must not be pickable anywhere');
  await page.evaluate(() => window.__atlas.store.getState().select(null));
  await settle(400);
  const hit = await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), pt);
  const tissue = hit ? await page.evaluate((id) => window.__atlas.store.getState().structures.get(id).tissue, hit.id) : null;
  assert(tissue !== 'cortex' && tissue !== 'sulcus', `picked ${hit?.id} (${tissue}) through a 20 % cortex`);
  await shot('05-cortex-transparent');
  const legend = await page.locator(T('atlas-legend')).innerText();
  assert(/Cortex at 20% opacity/.test(legend) && /passes through/.test(legend), 'legend does not explain the transparency');
  await page.evaluate(() => { const s = window.__atlas.store.getState(); s.setCortexOpacity(1); s.select('left_precentral_gyrus'); });
  return `through the cortex: ${hit ? `${hit.id} (${tissue})` : 'nothing'}`;
});

await step('isolate, show in context, restore', async () => {
  await page.locator(`${T('region-inspector')} button:has-text("Isolate")`).click();
  await settle();
  let v = await store('({ hidden: Object.values(s.vis).filter((x) => x === "hidden").length })');
  eq(v.hidden, 250, 'isolate hides the other 250 structures');
  await shot('06-isolated');
  await page.locator(`${T('region-inspector')} button:has-text("Show in context")`).click();
  await settle();
  v = await store('({ faded: Object.values(s.vis).filter((x) => x === "faded").length })');
  eq(v.faded, 250, 'context fades the other 250 structures');
  const through = await page.evaluate(() => { const p = window.__atlas.screenPointOf('left_precentral_gyrus'); return p ? window.__atlas.pickAt(p.x, p.y)?.id : null; });
  eq(through, 'left_precentral_gyrus', 'the selection is still pickable among faded context');
  await shot('07-context');
  await page.locator(`${T('region-inspector')} button:has-text("Restore all")`).click();
  await settle();
  eq(await store('Object.keys(s.vis).length'), 0, 'restore');
});

await step('hemisphere toggle and cutaway with a legend entry; picks respect the cut', async () => {
  await page.locator(T('tb-hemi-right')).click();
  await settle();
  eq(await store('s.hemi.right'), false, 'right hemisphere hidden');
  await page.locator(T('tb-hemi-right')).click();
  await page.locator(T('tb-cut')).click();
  await page.locator(T('cut-x')).click();
  await settle(400);
  const clip = await store('s.clip');
  eq(clip.axis, 'x', 'sagittal cut active');
  // every pick must lie on the kept side of the plane
  const bad = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="atlas-viewport"]').getBoundingClientRect();
    const c = window.__atlas.store.getState().clip; let n = 0, wrong = 0;
    for (let i = 0; i < 400; i++) {
      const h = window.__atlas.pickAt(r.left + r.width * (0.2 + 0.6 * ((i * 37) % 100) / 100), r.top + r.height * (0.2 + 0.6 * ((i * 61) % 100) / 100));
      if (!h) continue; n++;
      if (c.keep === '-' ? h.pointRasMm[0] > c.posMm + 1e-6 : h.pointRasMm[0] < c.posMm - 1e-6) wrong++;
    }
    return { n, wrong };
  });
  assert(bad.n > 50, `only ${bad.n} picks landed on the cut brain`);
  eq(bad.wrong, 0, 'picks on the removed side of the cut');
  await shot('08-cutaway-panel');
  // close the panel: the legend (hidden while the panel says the same thing) now carries the cut description
  await page.locator(T('tb-cut')).click();
  await settle();
  assert(/cut at R =/.test(await page.locator(T('atlas-legend')).innerText()), 'legend does not describe the cut');
  await page.evaluate(() => window.__atlas.store.getState().camera({ kind: 'view', view: 'right' }));
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 3000 });
  await settle(200);
  await shot('08-cutaway');
  await page.locator(T('tb-cut')).click();
  await page.locator(T('cut-none')).click();
  await page.locator(T('tb-cut')).click();
  await page.locator(T('tb-reset')).click();
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 3000 });
  return `${bad.n} picks, all on the kept side`;
});

await step('camera: a programmatic transition is interrupted by user input', async () => {
  await page.evaluate(() => { const s = window.__atlas.store.getState(); s.camera({ kind: 'view', view: 'posterior' }); });
  await page.waitForTimeout(80);
  const during = await page.evaluate(() => window.__atlas.cameraState());
  eq(during.transitioning, true, 'transition should be running');
  const box = await page.locator(T('atlas-viewport')).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.5 + 30, box.y + box.height * 0.3 + 10, { steps: 3 });
  const after = await page.evaluate(() => window.__atlas.cameraState());
  await page.mouse.up();
  eq(after.transitioning, false, 'the drag did not cancel the transition');
  await page.locator(T('tb-reset')).click();
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 3000 });
});

await step('keyboard equivalents: rotate, zoom, step through structures, fit, clear', async () => {
  await page.locator(T('atlas-viewport')).focus();
  const p0 = (await page.evaluate(() => window.__atlas.cameraState())).position;
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('+');
  const p1 = (await page.evaluate(() => window.__atlas.cameraState())).position;
  assert(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) > 0.01, 'arrow keys did not move the camera');
  const before = await store('s.selectedId');
  await page.keyboard.press(']');
  const next = await store('s.selectedId');
  assert(next && next !== before, 'stepping with ] did not change the selection');
  await page.keyboard.press('[');
  eq(await store('s.selectedId'), before, 'stepping back with [');
  await page.keyboard.press('f');
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 3000 });
  await page.keyboard.press('Escape');
  eq(await store('s.selectedId'), null, 'Escape clears the selection');
  await page.keyboard.press('0');
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 3000 });
});

await step('tree: keyboard navigation selects a structure; focus highlights it in 3D', async () => {
  await page.locator(T('browse-toggle')).click();
  await page.waitForSelector(T('atlas-tree'));
  await page.fill(T('atlas-search'), 'left central sulcus');
  await page.keyboard.press('Enter');
  await settle(700);
  eq(await store('s.selectedId'), 'left_central_sulcus', 'search + Enter selects');
  const row = page.locator(`${T('atlas-tree')} [data-id="left_central_sulcus"]`);
  eq(await row.getAttribute('aria-selected'), 'true', 'tree row selected');
  await row.focus();
  await page.keyboard.press('ArrowDown');
  const hov = await store('s.hoverId');
  assert(hov && hov !== 'left_central_sulcus', 'arrow key did not move the tree focus / 3D highlight');
  await page.keyboard.press('Enter');
  eq(await store('s.selectedId'), hov, 'Enter selects the focused row');
  await shot('09-tree');
  await page.locator(T('browse-toggle')).click();
  await page.evaluate(() => { const s = window.__atlas.store.getState(); s.select('left_precentral_gyrus'); s.camera({ kind: 'reset' }); });
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 3000 });
});

await step('a structure without curated text says so instead of inventing an explanation', async () => {
  const id = await store('[...s.structures.values()].find((x) => x.name === "left cuneus").id');
  await page.evaluate((i) => window.__atlas.store.getState().select(i), id);
  eq(await store('s.selectedId'), id, 'selected the test structure');
  await page.waitForSelector(T('region-no-card'), { timeout: 5000 });
  assert(/No curated explanation yet/.test(await page.locator(T('region-no-card')).innerText()), 'missing-content state');
  await page.evaluate(() => window.__atlas.store.getState().select('left_precentral_gyrus'));
});

// ── 4 · electrode, signal chain, ADC ────────────────────────────────────────────────────────────────────────────
await step('expose the illustrative electrode: neural interface keeps the region and separates mV from µV', async () => {
  await page.locator(T('to-interface')).click();
  await page.waitForSelector(T('interface-workspace'));
  eq((await page.locator(T('iface-region')).innerText()).toLowerCase(), 'left precentral gyrus', 'region carried over');
  const cmp = await page.locator(T('iface-compare')).innerText();
  assert(/mV/.test(cmp) && /µV/.test(cmp) && /smaller/.test(cmp), cmp);
  const before = cmp;
  await page.locator(T('iface-distance')).fill('100');
  await settle();
  const after = await page.locator(T('iface-compare')).innerText();
  assert(after !== before && /100 µm/.test(after), 'moving the contact did not change the computed amplitude');
  await page.locator(T('iface-distance')).fill('35');
  await shot('10-neural-interface');
  return after.replace(/\s+/g, ' ').slice(0, 90);
});

await step('signal journey: stages, external-vs-implemented labels, three kinds of multiplexer', async () => {
  await page.locator(T('to-signal')).click();
  await page.waitForSelector(T('signal-workspace'));
  eq(await page.locator(`${T('chain')} button`).count(), 8, 'eight stages');
  for (const [id, label] of [['afe', 'External hardware'], ['adc', 'External hardware'], ['digital', 'Implemented in our RTL']]) {
    await page.locator(T(`stage-${id}`)).click();
    assert((await page.locator(T('stage-realisation')).innerText()).includes(label), `${id} should be labelled "${label}"`);
  }
  for (const id of ['routing', 'amux', 'digital']) {
    await page.locator(T(`stage-${id}`)).click();
    assert(/Not to be confused/.test(await page.locator(T('stage-inspector')).innerText()), `${id}: no disambiguation note`);
  }
  await page.locator(T('stage-source')).click();
  for (let i = 0; i < 3; i++) await page.locator(T('next-stage')).click();
  eq(await page.locator(T('stage-title')).innerText(), 'Analogue front end', 'next-stage ×3 from the source');
  await page.locator(T('prev-stage')).click();
  assert((await page.locator(T('stage-title')).innerText()).startsWith('Electrode routing'), 'previous stage');
  await shot('11-signal-journey');
});

await step('ADC consequences are computed: bit depth and gain change the LSB; saturation is reported', async () => {
  const lsb = async () => (await page.locator(`${T('consequences')} tr:nth-child(2) td.mono`).innerText()).trim();
  const a = await lsb();
  await page.locator(T('prm-bits')).fill('8');
  await settle();
  const b = await lsb();
  assert(a !== b, 'changing the resolution did not change the input-referred LSB');
  eq(a, '0.046 µV', 'LSB at 16 bits, gain 400, ±0.6 V');
  eq(b, '11.72 µV', 'LSB at 8 bits');
  await page.locator(T('prm-bits')).fill('16');
  await page.locator(T('preset-saturation')).click();
  await page.waitForSelector(T('alert-afe-clip'));
  assert(/saturated for 100\.0 %/.test(await page.locator(T('alert-afe-clip')).innerText()), 'saturation not reported');
  await shot('12-saturation');
  await page.locator(T('preset-aliasing')).click();
  const alias = await page.locator(T('alias-note')).innerText();
  assert(/7\.0 kHz/.test(alias) && /3\.0 kHz/.test(alias), `alias note: ${alias}`);
  await shot('13-aliasing');
  await page.locator(T('preset-spikes')).click();
  assert(/11 detected, 0 missed, 0 false events/.test(await page.locator(T('detection')).innerText()), 'default detection summary changed');
  return `${a} → ${b}; alias 7 kHz → 3 kHz`;
});

await step('play, pause, scrub: the numbers at an instant are reproduced exactly', async () => {
  const read = async () => ({ t: await page.locator(T('clock-t')).innerText(), n: await page.locator(T('clock-n')).innerText(), code: await page.locator(T('now-code')).innerText(), ev: await page.locator(T('now-events')).innerText() });
  const seek = async (v) => { await page.locator(T('scrub')).fill(String(v)); await settle(80); };
  await seek(61.37);
  const a = await read();
  eq(a.n, 'n = 1841', 'sample index at 61.37 ms and 30 kS/s');
  await seek(180); const far = await read();
  assert(far.n !== a.n, 'scrubbing did not move');
  await seek(61.37);
  const again = await read();
  eq(JSON.stringify(again), JSON.stringify(a), 'state after scrubbing away and back');
  await page.locator(T('restart')).click();
  await page.locator(T('speed')).selectOption('100');
  await page.locator(T('play')).click();
  await page.waitForTimeout(700);
  await page.locator(T('play')).click();
  const t1 = parseFloat(await page.locator(T('clock-t')).innerText());
  assert(t1 > 20 && t1 < 150, `after ~0.7 s at 100 ms/s the playhead is at ${t1} ms`);
  await page.waitForTimeout(300);
  eq(parseFloat(await page.locator(T('clock-t')).innerText()), t1, 'playhead moved while paused');
  await page.locator(T('zoom-8')).click();
  await shot('14-scrub-zoom');
  await page.locator(T('zoom-all')).click();
  return `n = 1841, code ${a.code}, ${a.ev} events so far`;
});

// ── 5 · real implemented digital blocks ─────────────────────────────────────────────────────────────────────────
await step('our chip: real instances with source lines, executed suites, and what is not implemented', async () => {
  await page.locator(T('nav-chip')).click();
  await page.waitForSelector(T('chip-map'));
  await page.waitForSelector(T('chip-insp-title'));
  eq(await page.locator(T('chip-insp-title')).innerText(), 'u_state', 'default selection');
  eq(await page.locator(T('chip-insp-src')).innerText(), 'rtl/hbci_event_core.v:85', 'source reference');
  await page.waitForSelector(`${T('src-excerpt')} .hit`);
  assert(/u_state/.test(await page.locator(`${T('src-excerpt')} .hit`).innerText()), 'excerpt does not show the instantiation line');
  await page.locator(T('inst-u_core.u_readout.u_fstate')).click();
  eq(await page.locator(T('chip-insp-src')).innerText(), 'rtl/hbci_readout_core.v:199', 'u_fstate source reference');
  const miles = await page.locator(`${T('milestones')} li`).evaluateAll((els) => els.map((e) => `${e.querySelector('.mile-label').textContent}=${e.dataset.reached}`));
  eq(miles.join(','), 'Written as RTL=true,Simulated and checked=true,Synthesised to gates=true,Placed and routed=true,Fabricated=false,Measured on silicon=false,Tested with tissue=false', 'milestones');
  for (const id of ['electrodes', 'afe', 'adc']) assert(/Not implemented/.test(await page.locator(T(`concept-${id}`)).innerText()), `${id} not marked as not implemented`);
  await page.locator(T('path-event')).click();
  assert((await page.locator('.inst.on-path').count()) >= 9, 'EVENT path highlight');
  await page.locator(T('orphan-hbci_onchip_mlp')).click();
  assert(await page.locator(T('chip-not-in-top')).isVisible() && await page.locator(T('chip-no-suite')).isVisible(), 'orphan module warnings');
  const checks = await page.locator(`${T('checks')} li.pass`).count();
  eq(checks, 3, 'three executed model-vs-RTL checks shown as passing');
  await shot('15-our-chip');
  return miles.filter((m) => m.endsWith('true')).length + ' milestones reached, 3 not';
});

await step('the existing full chip studio still runs inside the new shell', async () => {
  await page.locator(T('open-studio')).click();
  await page.waitForSelector('.chip-studio-body .app', { timeout: 30000 });
  await page.waitForSelector('.chip-studio-body canvas', { timeout: 30000 });
  await settle(1500);
  await shot('16-existing-chip-studio');
  await page.locator(T('back-to-map')).click();
  await page.waitForSelector(T('chip-map'));
});

// ── 6 · supporting research, then back to the same region ───────────────────────────────────────────────────────
await step('research: cited passages with exact locations; unsupported questions are refused', async () => {
  await page.locator(T('nav-research')).click();
  await page.waitForSelector(`${T('svc')}[data-state="ready"]`, { timeout: 10000 });
  assert(/Passages, not answers/.test(await page.locator(T('no-model')).innerText()), 'no-model statement missing');
  await page.fill(T('research-q'), 'AFE versus ADC');
  await page.locator(T('research-go')).click();
  await page.waitForSelector(T('hit'));
  const locs = await page.locator(T('hit-loc')).allInnerTexts();
  assert(locs.some((l) => /^chip\/docs\/AFE_ADC_DECISION\.md:\d+-\d+/.test(l)), `no AFE_ADC_DECISION passage in ${locs.slice(0, 4)}`);
  eq(await page.locator(T('results')).getAttribute('data-unsupported'), 'false', 'supported');
  await page.locator(`${T('hit')} button:has-text("Show the whole passage")`).first().click();
  await page.waitForSelector(T('passage'));
  await shot('17-research');
  await page.fill(T('research-q'), 'serotonin reuptake inhibitor dosage');
  await page.locator(T('research-go')).click();
  await page.waitForSelector(T('unsupported'));
  assert(/does not support this query/.test(await page.locator(T('unsupported')).innerText()), 'unsupported banner');
  await shot('18-research-unsupported');
  assert((await page.locator(`${T('missing')} li`).count()) >= 4, 'missing-sources list');
  assert(/left precentral gyrus/i.test(await page.locator(T('region-sources')).innerText()), 'region sources');
  return `${locs.length} passages; first: ${locs[0]}`;
});

await step('return to the same brain region: selection and view survived the whole journey', async () => {
  await page.locator(T('region-chip')).click();
  await page.waitForSelector(`${T('atlas-viewport')} canvas`);
  await page.waitForFunction(() => !window.__atlas.cameraState().transitioning, null, { timeout: 4000 });
  eq(await store('s.selectedId'), 'left_precentral_gyrus', 'selection');
  eq((await page.locator(T('region-title')).innerText()).toLowerCase(), 'left precentral gyrus', 'inspector');
  const p = await page.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  assert(p, 'the region is not in view after returning');
  await shot('19-back-to-region');
});

await step('reload keeps the selected region', async () => {
  await page.reload();
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  eq(await store('s.selectedId'), 'left_precentral_gyrus', 'selection after reload');
});

// ── 7 · accessibility basics ────────────────────────────────────────────────────────────────────────────────────
await step('accessibility: every control has a name; landmarks, live region and focus are in place', async () => {
  const report = {};
  for (const ws of ['brain', 'interface', 'signal', 'chip', 'research']) {
    await page.locator(T(`nav-${ws}`)).click();
    await settle(500);
    report[ws] = await page.evaluate(() => {
      const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || (e.labels?.[0]?.textContent ?? '')).trim();
      const unnamed = [...document.querySelectorAll('button, a[href], input, select, [role="button"], [role="treeitem"], [role="option"]')].filter(visible).filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 80));
      const imgs = [...document.querySelectorAll('svg[role="img"], canvas[role="img"], img')].filter(visible).filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('alt'))).length;
      return { unnamed, imgs, main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav[aria-label]').length, h1: document.querySelectorAll('h1').length };
    });
    assert(report[ws].unnamed.length === 0, `${ws}: unnamed controls: ${report[ws].unnamed.join(' | ')}`);
    eq(report[ws].imgs, 0, `${ws}: images without a text alternative`);
    eq(report[ws].main, 1, `${ws}: <main> landmark`);
  }
  await page.locator(T('nav-brain')).click();
  await settle(300);
  const vp = page.locator(T('atlas-viewport'));
  eq(await vp.getAttribute('role'), 'application', 'viewport role');
  assert(/Arrow keys rotate/.test(await vp.getAttribute('aria-label')), 'viewport instructions');
  assert(/Selected: left precentral gyrus/i.test(await page.locator('#atlas-live').innerText()), 'live region announces the selection');
  // keyboard reachability: Tab from the top reaches the journey bar and the search field
  // start from the first control of the journey bar and walk forward with Tab
  await page.locator(T('nav-brain')).focus();
  eq(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'nav-brain', 'the first journey step is focusable');
  const order = ['nav-brain'];
  for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName)); }
  assert(order.includes('nav-research') && order.includes('atlas-viewport') && order.includes('atlas-search'), `tab order: ${order.join(' → ')}`);
  const focusRing = await page.evaluate(() => { const b = document.querySelector('[data-testid="nav-signal"]'); b.focus(); return getComputedStyle(b).outlineStyle; });
  return `tab order starts ${order.slice(0, 6).join(' → ')}; focus outline "${focusRing}"`;
});

// ── 8 · failure states ──────────────────────────────────────────────────────────────────────────────────────────
await step('load failure: when the atlas cannot be fetched the app says so and shows no substitute', async () => {
  const p2 = await ctx.newPage();
  await p2.route('**/atlas/spl-nac/chunk-cortex.bin', (r) => r.abort());
  await p2.goto(BASE);
  await p2.waitForSelector(T('atlas-error'), { timeout: 15000 });
  const txt = await p2.locator(T('atlas-error')).innerText();
  assert(/could not be loaded/.test(txt) && /No substitute brain/.test(txt), txt);
  eq(await p2.locator(`${T('atlas-viewport')} canvas`).count(), 0, 'a canvas was shown despite the failure');
  await shot('20-atlas-load-failure', p2);
  await p2.close();
});

await step('load failure: search service down → explicit state, inventory still shown', async () => {
  const p2 = await ctx.newPage();
  await p2.route('**/api/corpus/**', (r) => r.abort());
  await p2.goto(`${BASE}/#/research`);
  await p2.waitForSelector(`${T('svc')}[data-state="unavailable"]`, { timeout: 15000 });
  assert(/Search is unavailable/.test(await p2.locator(T('svc')).innerText()), 'unavailable message');
  await p2.waitForSelector(`${T('missing')} li`);
  await shot('21-search-unavailable', p2);
  await p2.close();
});

await step('WebGL unavailable: explicit message, no fake brain', async () => {
  const c2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await c2.addInitScript(() => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : orig.call(this, t, ...a); }; });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.waitForSelector(T('atlas-webgl-fallback'), { timeout: 20000 });
  assert(/no substitute picture/.test(await p2.locator(T('atlas-webgl-fallback')).innerText()), 'fallback text');
  assert(await p2.locator(T('atlas-search')).isVisible(), 'search should remain usable without WebGL');
  await shot('22-webgl-unavailable', p2);
  await c2.close();
});

// ── 9 · phone viewport and touch ────────────────────────────────────────────────────────────────────────────────
await step('phone viewport (390 × 844, touch): tap selects, layout fits, journey reachable', async () => {
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p2 = await c2.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(BASE);
  await p2.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await p2.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } window.__atlas.store.getState().select(null); });
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: join(shots, '23-phone-home.png') });
  const p = await p2.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  assert(p, 'gyrus not visible on the phone layout');
  await p2.touchscreen.tap(p.x, p.y);
  await p2.waitForSelector(T('region-inspector'));
  eq((await p2.locator(T('region-title')).innerText()).toLowerCase(), 'left precentral gyrus', 'tap selects');
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `horizontal overflow of ${overflow}px`);
  await p2.screenshot({ path: join(shots, '24-phone-selected.png') });
  for (const ws of ['interface', 'signal', 'chip', 'research']) {
    await p2.locator(T(`nav-${ws}`)).scrollIntoViewIfNeeded();
    await p2.locator(T(`nav-${ws}`)).tap();
    await p2.waitForTimeout(700);
    const o = await p2.evaluate(() => { const el = document.querySelector('.shell-pane:not([style*="none"]) .page') ?? document.documentElement; return el.scrollWidth - el.clientWidth; });
    assert(o <= 2, `${ws}: horizontal overflow of ${o}px on a phone`);
    await p2.screenshot({ path: join(shots, `25-phone-${ws}.png`) });
  }
  eq(errs.length, 0, `page errors on phone: ${errs[0]}`);
  await c2.close();
});

await step('no console errors during the whole desktop walkthrough', async () => {
  const real = consoleErrors.filter((e) => !/net::ERR_FAILED|Failed to load resource/.test(e));
  eq(real.length, 0, `console errors: ${real.slice(0, 2).join(' | ')}`);
});

// headless timings: recorded for completeness, explicitly NOT a performance claim
const perf = await page.evaluate(() => {
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null; };
  const P = window.__atlasPerf;
  return P ? { pickN: P.pickMs.length, pickP50: q(P.pickMs, 0.5), pickP95: q(P.pickMs, 0.95), bvhMs: Math.round(P.bvhBuiltMs) } : null;
}).catch(() => null);

await browser.close();
stop();

const failed = results.filter((r) => !r.ok);
const lines = [
  `# End-to-end walkthrough — ${new Date().toISOString()}`,
  `Build: production (vite preview, ${BASE}). Browser: ${env.ua ?? 'unknown'}`,
  `Mode: ${process.env.HEADED ? 'headed' : 'headless'}; WebGL renderer: ${env.renderer}; canvas ${env.canvas?.join('×')} at devicePixelRatio ${env.dpr}.`,
  `Result: ${results.length - failed.length}/${results.length} steps passed.`,
  '',
  ...results.map((r) => `${r.ok ? '✓' : '✗'} ${r.name}${r.info ? `\n    ${r.info}` : ''}  (${r.ms} ms)`),
  '',
  perf && perf.pickN ? `Pick timing in THIS run (CPU ray casts; ${perf.pickN} samples): p50 ${perf.pickP50} ms, p95 ${perf.pickP95} ms; BVH build ${perf.bvhMs} ms.` : '',
  process.env.HEADED ? '' : 'This was a headless run (no display): the renderer above is what the browser reported, but frame pacing without a display is not representative. Interactive measurements are in docs/evidence/performance.txt.',
  `Screenshots: docs/evidence/screenshots/ (${results.length ? 'captured from the running application in this run' : ''}).`,
].filter((l) => l !== '');
writeFileSync(join(root, 'docs/evidence/e2e-report.txt'), lines.join('\n') + '\n');
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
