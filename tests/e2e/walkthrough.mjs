// End-to-end walkthrough of the studio in a real Chrome, against the production build.
//
//   npm run build && node tests/e2e/walkthrough.mjs            (HEADED=1 to watch)
//
// Every step drives the running application the way a visitor would (pointer, keyboard) and asserts on what the
// application reports — real atlas ids from ray casts, store state, text on screen. It writes
// docs/evidence/e2e-report.txt and captures docs/evidence/cinematic/screens/*.png as it goes.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5197, BASE = `http://127.0.0.1:${PORT}`;
const shots = join(root, 'docs/evidence/cinematic/screens');
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
const near = (a, b, tol, msg) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg}: expected ${b} ± ${tol}, got ${a}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name, p = page) => p.screenshot({ path: join(shots, `${name}.png`) });
const T = (id) => `[data-testid="${id}"]`;
const store = (expr, p = page) => p.evaluate(`(() => { const s = window.__atlas.store.getState(); return ${expr}; })()`);
const settle = (ms = 900) => page.waitForTimeout(ms);
const num = (s) => parseFloat(String(s).replace(/[^\d.eE+-]/g, ''));
let env = {};

// ── the brain ───────────────────────────────────────────────────────────────────────────────────────────────────
await step('open the studio: the first screen is a large, continuous 3D brain', async () => {
  await page.goto(BASE);
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await page.waitForSelector(`${T('atlas-viewport')} canvas`);
  await settle(1200);
  const s = await store('({ n: s.structures.size, tri: s.specimen.meta.mesh.triangles, onSurface: s.specimen.surfaceIds.size, sel: s.selectedId, mode: s.viewMode })');
  eq(s.n, 251, 'atlas structures'); eq(s.sel, null, 'nothing selected at start'); eq(s.mode, 'solid', 'solid view');
  env = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="atlas-viewport"] canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { ua: navigator.userAgent, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', canvas: [c.width, c.height], dpr: devicePixelRatio };
  });
  const cov = await page.evaluate(() => window.__atlas.coverage());
  assert(cov.h >= 0.6 && cov.h <= 0.85, `brain fills ${(cov.h * 100).toFixed(0)} % of the stage height (wanted 60–85 %)`);
  eq(await page.locator(T('region-inspector')).count(), 0, 'no card before a selection');
  eq(await page.locator(T('nav-brain')).getAttribute('aria-current'), 'page', 'Brain is the current scene');
  await shot('01-home');
  return `${s.n} structures behind one surface of ${s.tri.toLocaleString()} triangles; ${s.onSurface} regions reach it; fills ${(cov.h * 100).toFixed(0)} % of the height; ${env.renderer}`;
});

await step('hover names the exact atlas region under the pointer; nothing is labelled until then', async () => {
  eq(await page.locator(T('atlas-hover-tag')).isVisible(), false, 'no tag before hovering');
  const ids = ['left_precentral_gyrus', 'left_postcentral_gyrus', 'left_superior_temporal_gyrus', 'left_superior_frontal_gyrus'];
  const seen = [];
  for (const id of ids) {
    const p = await page.evaluate((i) => window.__atlas.screenPointOf(i), id);
    assert(p, `${id} has no visible point from the opening view`);
    await page.mouse.move(p.x, p.y);
    await page.waitForFunction((i) => window.__atlas.store.getState().hoverId === i, id, { timeout: 3000 });
    const tag = (await page.locator(T('atlas-hover-tag')).innerText()).toLowerCase();
    assert(tag.includes(id.replace(/_/g, ' ').replace(/^left /, '')), `tag "${tag}" does not name ${id}`);
    seen.push(id);
    if (id === ids[0]) await shot('02-hover');
  }
  return `${seen.length} regions hovered as themselves`;
});

await step('left is the subject’s left: mirrored structures are picked on opposite sides of the mid-plane', async () => {
  await page.locator(T('view-menu')).click();
  await page.locator(T('view-superior')).click();
  await settle(1100);
  const l = await page.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus')), r = await page.evaluate(() => window.__atlas.screenPointOf('right_precentral_gyrus'));
  assert(l && r, 'both precentral gyri visible from above');
  const hl = await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), l), hr = await page.evaluate((p) => window.__atlas.pickAt(p.x, p.y), r);
  eq(hl.id, 'left_precentral_gyrus', 'pick on the left'); eq(hr.id, 'right_precentral_gyrus', 'pick on the right');
  // every pick across the top of the brain: a structure named left_… lies on the −x side of the atlas's fitted
  // mid-sagittal plane and one named right_… on the +x side (2 mm of slack at the fissure)
  const sweep = await page.evaluate(() => {
    const A = window.__atlas, st = A.store.getState(), pl = st.manifest.space.midSagittalPlane;
    const rect = document.querySelector('[data-testid="atlas-viewport"] canvas').getBoundingClientRect();
    let left = 0, right = 0; const wrong = [];
    for (let i = 0; i < 900; i++) {
      const h = A.pickAt(rect.left + rect.width * (0.2 + 0.6 * ((i * 37) % 101) / 101), rect.top + rect.height * (0.12 + 0.76 * ((i * 61) % 97) / 97));
      if (!h) continue;
      const side = /^left_|_left_/.test(h.id) ? -1 : /^right_|_right_/.test(h.id) ? 1 : 0;
      if (!side) continue;
      const d = h.pointRasMm[0] - (pl.a + pl.b * h.pointRasMm[1] + pl.c * h.pointRasMm[2]);
      if (side < 0) left++; else right++;
      if (d * side < -2) wrong.push(`${h.id} at ${d.toFixed(1)} mm`);
    }
    return { left, right, wrong };
  });
  assert(sweep.left > 100 && sweep.right > 100, `too few sided picks: ${sweep.left} left, ${sweep.right} right`);
  eq(sweep.wrong.length, 0, `structures picked on the wrong side: ${sweep.wrong.slice(0, 3).join('; ')}`);
  // on screen, seen from above with the front of the brain up, the subject's left is the viewer's left
  assert(l.x < r.x, 'left gyrus is drawn to the left of the right one from above');
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await settle(1100);
  return `${sweep.left} left-named and ${sweep.right} right-named picks, all on their own side of the mid-plane`;
});

await step('click selects: the camera reframes, the rest recedes, and one card opens with one invitation', async () => {
  const before = await page.evaluate(() => window.__atlas.cameraState());
  const p = await page.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector(T('region-inspector'));
  await settle(1300);
  eq(await store('s.selectedId'), 'left_precentral_gyrus', 'selected id');
  const after = await page.evaluate(() => window.__atlas.cameraState());
  assert(Math.hypot(...after.position.map((v, i) => v - before.position[i])) > 0.03, 'camera did not move');
  assert(/precentral gyrus/i.test(await page.locator(T('region-title')).innerText()), 'card title');
  assert((await page.locator(T('region-summary')).innerText()).length > 40, 'summary text');
  assert(/not the same as|M1|primary motor/i.test(await page.locator(T('region-caution')).innerText()), 'gyrus ≠ M1 caution');
  eq(await page.locator(`${T('region-inspector')} .btn-primary`).count(), 1, 'exactly one primary invitation');
  eq(await page.locator(T('atlas-hover-tag')).isVisible(), false, 'hover tag hidden on the selected region');
  assert(/precentral gyrus/i.test(await page.locator(T('region-chip')).innerText()), 'region chip');
  // the smoothed selection mask on the surface is non-empty and partial (a border exists)
  const mask = await page.evaluate(() => { const a = window.__atlas.store.getState().specimen.geometry.getAttribute('aSelW').array; let on = 0, mid = 0; for (const v of a) { if (v > 250) on++; else if (v > 5) mid++; } return { on, mid, n: a.length }; });
  assert(mask.on > 2000 && mask.mid > 200, `selection mask: ${JSON.stringify(mask)}`);
  await shot('03-selected');
  await page.locator(T('insight-more')).click();
  assert(/Label value/i.test(await page.locator(T('insight-details')).innerText()), 'atlas record in details');
  await page.locator(T('insight-more')).click();
  return `${mask.on} surface vertices inside the selection, ${mask.mid} on its border`;
});

await step('view modes: X-ray shows the atlas bodies inside a glass shell; Regions draws borders; Solid restores', async () => {
  await page.locator(T('mode-xray')).click(); await settle(700);
  eq(await store('s.shell()'), 'ghost', 'shell in X-ray');
  const inner = await page.evaluate(() => { const p = window.__atlas.screenPointOf('left_thalamus') ?? window.__atlas.screenPointOf('left_putamen'); return p ? window.__atlas.pickAt(p.x, p.y)?.id : null; });
  assert(inner && !/gyrus/.test(inner), `expected an inner body under the pointer in X-ray, got ${inner}`);
  await shot('04-xray');
  await page.locator(T('mode-parcels')).click(); await settle(900);
  eq(await store('s.viewMode'), 'parcels', 'regions mode');
  const classes = await page.evaluate(() => { const a = window.__atlas.store.getState().specimen.geometry.getAttribute('aParcelA').array; let n = 0; for (let i = 0; i < a.length; i += 97) if (a[i] > 0) n++; return n; });
  assert(classes > 50, 'region-class fields were not computed');
  assert(/tints only tell neighbours apart/i.test(await page.locator(T('atlas-legend')).innerText()), 'note that the tints carry no meaning');
  await shot('05-regions');
  await page.locator(T('mode-solid')).click(); await settle(500);
  eq(await store('s.shell()'), 'solid', 'solid again');
  return `X-ray pick: ${inner}`;
});

await step('slice: the cut face shows the subject’s MRI, faces the viewer, and names what is under the pointer', async () => {
  await page.locator(T('mode-slice')).click();
  await page.waitForFunction(() => window.__atlas.store.getState().slices.status === 'ready', null, { timeout: 15000 });
  await settle(900);
  const c = await store('s.clip');
  eq(c.axis, 'x', 'opens on a sagittal cut');
  eq(c.keep, '+', 'the camera is on the left, so the right half is kept and the cut faces the viewer');
  assert(/T1 MRI \(measured\)/.test(await page.locator(T('slice-state')).innerText()), 'slice state text');
  // a point on the cut face: the pick comes from the label volume
  const hit = await page.evaluate(() => {
    const A = window.__atlas, r = document.querySelector('[data-testid="atlas-viewport"] canvas').getBoundingClientRect();
    const seen = new Set();
    for (let i = 0; i < 400; i++) { const h = A.pickAt(r.left + r.width * (0.25 + 0.5 * ((i * 37) % 101) / 101), r.top + r.height * (0.2 + 0.6 * ((i * 61) % 97) / 97)); if (h && Math.abs(h.pointRasMm[0] - A.store.getState().clip.posMm) < 0.6) seen.add(h.id); }
    return [...seen];
  });
  assert(hit.length >= 5, `only ${hit.length} structures were picked on the cut face`);
  assert(hit.some((id) => /corpus_callosum|thalam|ventricle|pons|cerebell|brainstem|midbrain/.test(id)), `no midline structure among ${hit.slice(0, 6)}`);
  await shot('06-slice');
  await page.locator(T('cut-y')).click(); await settle(500);
  eq(await store('s.clip.axis'), 'y', 'coronal');
  await page.locator(T('cut-flip')).click();
  const flipped = await store('s.clip.keep');
  await page.locator(T('cut-pos')).fill('-20'); await settle(300);
  eq(await store('s.clip.posMm'), -20, 'slice position');
  await page.locator(T('mode-solid')).click(); await settle(400);
  eq(await store('s.clip.axis'), 'none', 'leaving the slice view removes the cut');
  return `${hit.length} structures named on the cut face (e.g. ${hit.slice(0, 3).join(', ')}); flip → keep ${flipped}`;
});

await step('finder (⌘K): a deep structure is found by name and revealed inside the glass shell; its invitation is a real MRI slice', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page.waitForSelector(T('finder'));
  await page.keyboard.type('hippocampus');
  await page.waitForTimeout(300);
  await shot('07-finder');
  await page.keyboard.press('Enter');
  await settle(1300);
  eq(await page.locator(T('finder')).count(), 0, 'finder closed');
  eq(await store('s.selectedId'), 'left_hippocampus', 'selected by search');
  eq(await store('s.shell()'), 'ghost', 'surface turns see-through for a structure beneath it');
  await shot('08-deep-structure');
  await page.locator(T('to-slice')).click();
  await page.waitForFunction(() => window.__atlas.store.getState().viewMode === 'slice', null, { timeout: 5000 });
  await settle(900);
  const c = await store('({ axis: s.clip.axis, pos: s.clip.posMm, b: s.structures.get("left_hippocampus").boundsMm })');
  eq(c.axis, 'y', 'coronal cut');
  assert(c.pos > c.b[0][1] && c.pos < c.b[1][1], `cut at A ${c.pos} is outside the structure (${c.b[0][1]} … ${c.b[1][1]})`);
  await shot('09-slice-through');
  await page.locator(T('to-slice')).click(); await settle(500);
  eq(await store('s.viewMode'), 'solid', 'back to the whole brain');
  // "/" also opens the finder; Escape closes it without changing the selection
  await page.keyboard.press('/'); await page.waitForSelector(T('finder')); await page.keyboard.press('Escape');
  eq(await store('s.selectedId'), 'left_hippocampus', 'selection kept');
  return `coronal cut at A ${c.pos} mm through the hippocampus`;
});

await step('isolate, hide, hemisphere and restore keep picking honest', async () => {
  await store('(s.select("left_precentral_gyrus"), 1)'); await settle(300);
  await page.locator(`${T('region-inspector')} button:has-text("Isolate")`).click(); await settle(500);
  eq(await store('s.shell()'), 'hidden', 'isolated: no shell');
  await page.locator(`${T('region-inspector')} button:has-text("Isolate")`).click();
  await page.locator(`${T('region-inspector')} button:has-text("Hide")`).click(); await settle(500);
  const p = await page.evaluate(() => window.__atlas.screenPointOf('left_postcentral_gyrus'));
  const picked = await page.evaluate(() => { const A = window.__atlas, r = document.querySelector('[data-testid="atlas-viewport"] canvas').getBoundingClientRect(); const ids = new Set(); for (let i = 0; i < 500; i++) { const h = A.pickAt(r.left + r.width * (0.2 + 0.6 * ((i * 37) % 101) / 101), r.top + r.height * (0.15 + 0.7 * ((i * 61) % 97) / 97)); if (h) ids.add(h.id); } return [...ids]; });
  assert(!picked.includes('left_precentral_gyrus'), 'a hidden region was picked');
  assert(p && picked.length > 10, 'other regions are still pickable');
  await page.locator(T('view-menu')).click();
  await page.locator(T('tb-hemi-left')).click(); await settle(400);
  const afterHemi = await page.evaluate(() => { const A = window.__atlas, r = document.querySelector('[data-testid="atlas-viewport"] canvas').getBoundingClientRect(); const ids = new Set(); for (let i = 0; i < 500; i++) { const h = A.pickAt(r.left + r.width * (0.2 + 0.6 * ((i * 37) % 101) / 101), r.top + r.height * (0.15 + 0.7 * ((i * 61) % 97) / 97)); if (h) ids.add(h.id); } return [...ids]; });
  assert(afterHemi.length > 5 && afterHemi.every((id) => !/^left_/.test(id)), `left structures picked with the left hemisphere off: ${afterHemi.filter((id) => /^left_/.test(id)).slice(0, 3)}`);
  await page.locator(T('tb-restore')).click(); await settle(400);
  await page.keyboard.press('Escape');
  eq(await store('Object.keys(s.hidden).length'), 0, 'nothing hidden after restore');
  eq(await store('s.hemi.left && s.hemi.right'), true, 'both hemispheres back');
  return `${picked.length} regions pickable with one hidden; ${afterHemi.length} with the left hemisphere off (none of them left)`;
});

await step('keyboard: orbit, zoom, step, frame, clear — and user input interrupts a camera move', async () => {
  await page.locator(T('atlas-viewport')).focus();
  const c0 = await page.evaluate(() => window.__atlas.cameraState());
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('+');
  const c1 = await page.evaluate(() => window.__atlas.cameraState());
  assert(Math.hypot(...c1.position.map((v, i) => v - c0.position[i])) > 0.005, 'arrow keys / + did not move the camera');
  await store('(s.select("left_precentral_gyrus"), 1)');
  await page.keyboard.press('n');
  const next = await store('s.selectedId');
  assert(next && next !== 'left_precentral_gyrus', 'n did not step to another structure');
  await page.keyboard.press('f'); await page.waitForTimeout(120);
  eq((await page.evaluate(() => window.__atlas.cameraState())).transitioning, true, 'f starts a camera move');
  await page.keyboard.press('ArrowRight');
  eq((await page.evaluate(() => window.__atlas.cameraState())).transitioning, false, 'a key press interrupts it');
  await page.keyboard.press('Escape');
  eq(await store('s.selectedId'), null, 'Escape clears the selection');
  await page.keyboard.press('0'); await settle(1000);
  return `n stepped to ${next}`;
});

await step('About this brain states what is measured, what is rendering, the limits and the licence', async () => {
  await page.locator(T('about-open')).click();
  const txt = await page.locator(T('about-sheet')).innerText();
  for (const re of [/not a validated pial surface/, /no registration is involved/i, /visual treatment/i, /Nothing on this stage shows neural activity/, /not a medical device/, /3D Slicer License/, /not MNI space/]) assert(re.test(txt), `About sheet lacks ${re}`);
  await shot('10-about');
  await page.keyboard.press('Escape');
  eq(await page.locator(T('about-sheet')).count(), 0, 'closed with Escape');
});

// ── the walkthrough: brain → neurons → signal → chip → decoder ────────────────────────────────────────────────
await step('dive: the invitation flies into the region and hands over to the Neurons scene', async () => {
  const p = await page.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector(T('to-interface'));
  await settle(900);
  const d0 = await page.evaluate(() => { const c = window.__atlas.cameraState(); return Math.hypot(...c.position.map((v, i) => v - c.target[i])); });
  await page.locator(T('to-interface')).click();
  await page.waitForTimeout(450);
  const d1 = await page.evaluate(() => { const c = window.__atlas.cameraState(); return Math.hypot(...c.position.map((v, i) => v - c.target[i])); });
  assert(d1 < d0 * 0.8, `camera did not fly in (${d0.toFixed(3)} → ${d1.toFixed(3)} m)`);
  await page.waitForSelector(T('interface-workspace'), { timeout: 5000 });
  assert(/Beneath the left precentral gyrus/i.test(await page.locator(T('interface-title')).innerText()), 'the region is carried into the scene');
  await page.waitForSelector(`${T('interface-workspace')} canvas`);
  eq(await page.locator(T('nav-interface')).getAttribute('aria-current'), 'page', 'dock shows Neurons');
  return `camera ${d0.toFixed(2)} m → ${d1.toFixed(2)} m, then the Neurons scene`;
});

await step('neurons: the timeline plays in stated slow motion, pauses, and scrubbing reproduces the same numbers', async () => {
  eq(await page.locator(T('tp-play')).getAttribute('data-playing'), 'true', 'plays on arrival');
  await page.waitForTimeout(700);
  await page.locator(T('tp-play')).click();
  eq(await page.locator(T('tp-play')).getAttribute('data-playing'), 'false', 'paused');
  const clock = await page.locator(T('tp-clock')).innerText();
  assert(num(clock) > 0.5, `clock did not advance: ${clock}`);
  // seek to the first spike: the membrane is positive there, and the contact dips
  await page.locator(T('tp-scrub')).fill('12.3'); await page.waitForTimeout(200);
  const a = [await page.locator(T('wave-vm-now')).innerText(), await page.locator(T('wave-ve-now')).innerText()];
  await page.locator(T('tp-scrub')).fill('60'); await page.waitForTimeout(150);
  await page.locator(T('tp-scrub')).fill('12.3'); await page.waitForTimeout(200);
  const b = [await page.locator(T('wave-vm-now')).innerText(), await page.locator(T('wave-ve-now')).innerText()];
  eq(b.join('|'), a.join('|'), 'the same time gives the same values');
  await page.locator(T('tp-reset')).click();
  near(num(await page.locator(T('wave-vm-now')).innerText()), -65, 0.2, 'rest potential at t = 0');
  await shot('11-neurons');
  return `clock ${clock}; at 12.30 ms: membrane ${a[0]}, contact ${a[1]}`;
});

await step('neurons: changing a variable changes the 3D scene and the plots — distance scales the contact’s spike, not the neuron', async () => {
  const amp = async () => num(await page.locator(T('amp-out')).innerText());
  await page.locator(T('knob-distance')).fill('30'); await page.waitForTimeout(250);
  near(await amp(), 120, 0.5, 'spike at 30 µm');
  eq((await page.locator(T('distance-tag')).innerText()).trim(), '30 µm', 'the 3D distance label follows');
  await page.locator(T('knob-distance')).fill('120'); await page.waitForTimeout(250);
  near(await amp(), 30, 0.5, 'spike at 120 µm');
  await page.locator(T('knob-current')).fill('0'); await page.waitForTimeout(250);
  assert(/no spikes/i.test(await page.locator(`${T('interface-workspace')} .knob`).first().innerText()), 'no current → no spikes');
  await page.locator(T('knob-current')).fill('10'); await page.locator(T('knob-distance')).fill('60'); await page.waitForTimeout(250);
  assert(/Fires 6\d times a second/.test(await page.locator(`${T('interface-workspace')} .knob`).first().innerText()), 'about 68 spikes a second at 10 µA/cm²');
  return '30 µm → 120 µV, 120 µm → 30 µV; 0 current → silence; 10 µA/cm² → about 68 spikes a second';
});

await step('detail levels: Mathematical shows the equations and gates; Engineering shows the numbers the electronics get', async () => {
  eq(await page.locator(T('hh-equations')).count(), 0, 'no equations at the intuitive level');
  await page.locator(T('level-math')).click();
  assert(/gNa·m³h/.test(await page.locator(T('hh-equations')).innerText()), 'Hodgkin–Huxley equation');
  for (const w of ['wave-m', 'wave-h', 'wave-n']) await page.waitForSelector(T(w));
  await shot('12-neurons-math');
  await page.locator(T('level-engineering')).click();
  assert(/Noise \(stated\)/i.test(await page.locator(T('neuron-readouts')).innerText()), 'engineering readouts');
  await page.locator(T('level-intuitive')).click();
  await page.locator(`${T('interface-evidence')} summary`).click();
  const ev = await page.locator(T('interface-evidence')).innerText();
  assert(/squid giant axon/.test(ev) && /not a model of a human cortical neuron/.test(ev) && /atlas contains no cellular data/.test(ev), 'what is real / what is a drawing');
});

await step('prediction 1 (all-or-nothing): commit to an answer, get feedback, then the scene shows the model’s result', async () => {
  const t = 'predict-all-or-nothing';
  await page.locator(T(t)).scrollIntoViewIfNeeded();
  eq(await page.locator(T(t)).getAttribute('data-answered'), 'no', 'unanswered at first');
  eq(await page.locator(T(`${t}-feedback`)).count(), 0, 'no feedback before a prediction');
  await page.locator(T(`${t}-taller`)).click();
  eq(await page.locator(T(t)).getAttribute('data-answered'), 'wrong', 'a wrong answer is marked as such');
  assert(/Not in this model/.test(await page.locator(T(`${t}-feedback`)).innerText()), 'feedback for the wrong answer');
  await page.locator(T(`${t}-try`)).click(); await page.waitForTimeout(300);
  eq((await page.locator(T('current-out')).innerText()).trim(), '20.0 µA/cm²', 'the scene applied the change');
  const res = await page.locator(T(`${t}-result`)).innerText();
  const m = /rate (\d+) → (\d+) spikes a second\. The first spike peaks at (-?\d+) → (-?\d+) mV; later ones at (-?\d+) → (-?\d+) mV/.exec(res);
  assert(m && +m[2] > +m[1] * 1.15 && Math.abs(+m[4] - +m[3]) <= 3 && +m[6] <= +m[5], `model result does not show "more often, not taller": ${res}`);
  await shot('13-neurons-predict');
  await page.locator(T('tp-play')).click().catch(() => {});
  return res;
});

await step('signal: the rail leads on; stages are labelled by who implements them; prediction 2 (aliasing) runs the model', async () => {
  await page.locator(T('rail-next')).click();
  await page.waitForSelector(T('signal-workspace'));
  eq(await page.locator(`${T('chain')} button`).count(), 8, 'eight stages');
  assert(/Our chip/.test(await page.locator(T('stage-digital')).innerText()), 'the digital stage is ours');
  await shot('14-signal');
  const t = 'predict-aliasing';
  await page.locator(T(t)).scrollIntoViewIfNeeded();
  await page.locator(T(`${t}-folded`)).click();
  eq(await page.locator(T(t)).getAttribute('data-answered'), 'right', 'correct answer recognised');
  await page.locator(T(`${t}-try`)).click(); await page.waitForTimeout(500);
  eq(await page.locator(T('preset-aliasing')).getAttribute('aria-pressed'), 'true', 'the aliasing example was loaded');
  await page.locator(T(t)).scrollIntoViewIfNeeded();
  const res = await page.locator(T(`${t}-result`)).innerText();
  assert(/7 kHz tone sampled at 10 kS\/s appears at 3\.0 kHz/.test(res), `model result: ${res}`);
  return res;
});

await step('chip: source-traced map, honest milestones, and the original chip studio still runs inside the new shell', async () => {
  await page.locator(T('rail-next')).scrollIntoViewIfNeeded();
  await page.locator(T('rail-next')).click();
  await page.waitForSelector(T('chip-map'));
  const miles = await page.locator(`${T('milestones')} li`).allInnerTexts();
  assert(miles.some((m) => /Fabricated/.test(m)) && miles.length >= 6, 'milestones');
  await shot('15-chip');
  await page.locator(T('open-studio')).click();
  await page.waitForSelector(`${T('chip-studio')} .app`, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const studio = await page.evaluate(() => { const a = document.querySelector('[data-testid="chip-studio"] .app'); const r = a.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, buttons: a.querySelectorAll('button').length, bg: getComputedStyle(a).backgroundColor }; });
  assert(studio.w > 1000 && studio.h > 500 && studio.buttons > 10, `studio not laid out: ${JSON.stringify(studio)}`);
  assert(studio.top >= 64, 'the studio starts below the floating bar');
  await shot('16-chip-studio');
  await page.locator(T('back-to-map')).click();
  await page.waitForSelector(T('chip-map'));
  return `${miles.length} milestones; original studio ${Math.round(studio.w)}×${Math.round(studio.h)} px with ${studio.buttons} controls`;
});

await step('decoder: every frame’s totals are re-added in the page and match the RTL trace', async () => {
  await page.locator(T('rail-next')).scrollIntoViewIfNeeded();
  await page.locator(T('rail-next')).click();
  await page.waitForSelector(T('decoder-diagram'), { timeout: 15000 });
  await page.locator(T('tp-play')).click().catch(() => {});
  eq(await page.locator(`${T('frame-strip')} button`).count(), 32, '32 frames');
  const seen = [];
  for (const f of [0, 1, 11, 31]) {
    await page.locator(T(`frame-${f}`)).click();
    await page.locator(T('tp-scrub')).fill(String(f * 20 + 19)); await page.waitForTimeout(150);
    eq((await page.locator(T('dec-check')).innerText()).trim(), 'matches RTL ✓', `frame ${f}`);
    seen.push(`${f}: ${(await page.locator(T('dec-verdict')).textContent()).trim()}`);
  }
  // one product per clock cycle
  await page.locator(T('tp-scrub')).fill('1'); await page.waitForTimeout(120);
  assert(/^34 × 114 = 3,876$/.test((await page.locator(T('dec-product')).textContent()).trim()), `first product: ${await page.locator(T('dec-product')).textContent()}`);
  assert(/frame 0 · cycle 1\/18/.test(await page.locator(T('tp-clock')).innerText()), 'the clock counts engine cycles');
  await page.locator(T('tp-scrub')).fill('9'); await page.waitForTimeout(120);
  await shot('17-decoder');
  const limits = await page.locator(T('decoder-limits')).innerText();
  for (const re of [/has not been fabricated/, /DANDI 000019/, /does not say which class index means speech/, /Single subject, single session/]) assert(re.test(limits), `limits text lacks ${re}`);
  return seen.join('; ');
});

await step('prediction 3 (one dominant channel) and the what-if control, clearly marked as a software re-run', async () => {
  const t = 'predict-one-channel';
  await page.locator(T(t)).scrollIntoViewIfNeeded();
  await page.locator(T(`${t}-flips`)).click();
  eq(await page.locator(T(t)).getAttribute('data-answered'), 'right', 'correct answer recognised');
  await page.locator(T(`${t}-try`)).click(); await page.waitForTimeout(300);
  const out = await page.locator(T('whatif-out')).innerText();
  assert(/Channel 7: 127 → 0/.test(out) && /flipped/.test(out), `what-if output: ${out}`);
  eq((await page.locator(T('dec-check')).innerText()).trim(), 'what-if', 'the check no longer claims to be the RTL');
  eq((await page.locator(T('dec-rtl-cls')).innerText()).trim(), 'class 1', 'the RTL’s own answer stays visible');
  await page.locator(T('decoder-diagram')).scrollIntoViewIfNeeded();
  await shot('18-decoder-whatif');
  await page.locator(T('whatif-clear')).click();
  eq((await page.locator(T('dec-check')).innerText()).trim(), 'matches RTL ✓', 'back to the RTL values');
  return out.replace(/\s+/g, ' ');
});

await step('research: cited passages with exact locations; unsupported questions are refused', async () => {
  await page.locator(T('nav-research')).click();
  await page.waitForSelector(`${T('svc')}[data-state="ready"]`, { timeout: 10000 });
  assert(/Passages, not answers/.test(await page.locator(T('no-model')).innerText()), 'no-model statement missing');
  await page.fill(T('research-q'), 'AFE versus ADC');
  await page.locator(T('research-go')).click();
  await page.waitForSelector(T('hit'));
  const locs = await page.locator(T('hit-loc')).allInnerTexts();
  assert(locs.some((l) => /^chip\/docs\/AFE_ADC_DECISION\.md:\d+-\d+/.test(l)), `no AFE_ADC_DECISION passage in ${locs.slice(0, 4)}`);
  await shot('19-research');
  await page.fill(T('research-q'), 'serotonin reuptake inhibitor dosage');
  await page.locator(T('research-go')).click();
  await page.waitForSelector(T('unsupported'));
  assert(/does not support this query/.test(await page.locator(T('unsupported')).innerText()), 'unsupported banner');
  return `${locs.length} passages; first: ${locs[0]}`;
});

await step('return to the brain: the region and the view survived the whole journey, and a reload keeps the region', async () => {
  await page.locator(T('region-chip')).click();
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`);
  await settle(1000);
  eq(await store('s.selectedId'), 'left_precentral_gyrus', 'selection after the journey');
  await page.waitForSelector(T('region-inspector'));
  await page.reload();
  await page.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  eq(await store('s.selectedId'), 'left_precentral_gyrus', 'selection after reload');
});

// ── accessibility and failure states ────────────────────────────────────────────────────────────────────────────
await step('accessibility: named controls, landmarks, visible focus, and text contrast on the dark stage', async () => {
  const a = await page.evaluate(() => {
    const unnamed = [...document.querySelectorAll('button, [role="button"], input, select')].filter((el) => {
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return false;
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent || '').trim();
      return !name;
    }).map((el) => el.outerHTML.slice(0, 90));
    const lum = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const [r, g, b] = m[1].split(',').map((v) => parseFloat(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const stage = 'rgb(6, 10, 20)';
    const pairs = [['.dock-label', stage], ['.dock-scale', stage], ['.insight-summary', 'rgb(11, 17, 32)'], ['.insight-kicker', 'rgb(11, 17, 32)'], ['.region-chip-name', stage], ['.stage-hint', stage], ['.seg-btn', 'rgb(10, 15, 29)']]
      .map(([sel, bg]) => { const el = document.querySelector(sel); return el ? { sel, ratio: +ratio(getComputedStyle(el).color, bg).toFixed(2) } : { sel, ratio: null }; });
    return { unnamed, pairs, main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav[aria-label]').length, live: !!document.querySelector('#atlas-live[aria-live]') };
  });
  eq(a.unnamed.length, 0, `controls without an accessible name: ${a.unnamed.slice(0, 2).join(' | ')}`);
  eq(a.main, 1, 'one main landmark'); assert(a.nav >= 1 && a.live, 'navigation landmark and live region');
  for (const p of a.pairs) assert(p.ratio === null || p.ratio >= 4.5, `${p.sel} contrast ${p.ratio} : 1 is below 4.5 : 1`);
  // keyboard focus is visible on the dock
  await page.locator(T('nav-brain')).focus();
  const ring = await page.evaluate(() => { const el = document.activeElement; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); return getComputedStyle(el).outlineStyle; });
  await page.keyboard.press('Tab');
  const ring2 = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, who: document.activeElement.getAttribute('data-testid') }; });
  void ring;
  assert(ring2.style !== 'none' && parseFloat(ring2.width) >= 2, `no visible focus ring on ${ring2.who}: ${JSON.stringify(ring2)}`);
  return `contrast: ${a.pairs.filter((p) => p.ratio).map((p) => `${p.sel} ${p.ratio}`).join(', ')}; focus ring on ${ring2.who}`;
});

await step('reduced motion: nothing plays by itself and camera moves are instant', async () => {
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await p2.waitForTimeout(800);
  const pt = await p2.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  await p2.mouse.click(pt.x, pt.y);
  await p2.waitForTimeout(120);
  eq((await p2.evaluate(() => window.__atlas.cameraState())).transitioning, false, 'no camera tween');
  await p2.locator(T('to-interface')).click();
  await p2.waitForSelector(T('interface-workspace'), { timeout: 3000 });
  await p2.waitForTimeout(600);
  eq(await p2.locator(T('tp-play')).getAttribute('data-playing'), 'false', 'the neuron timeline does not autoplay');
  eq((await p2.locator(T('tp-clock')).innerText()).trim(), '0.00 ms', 'time stands still until Play is pressed');
  await p2.goto(`${BASE}/#/decoder`); await p2.waitForSelector(T('decoder-diagram'));
  eq(await p2.locator(T('tp-play')).getAttribute('data-playing'), 'false', 'the decoder timeline does not autoplay');
  await c2.close();
});

await step('load failure: when the atlas cannot be fetched the app says so and shows no substitute', async () => {
  const c2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await c2.route('**/atlas/spl-nac/specimen.bin', (r) => r.abort());
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.waitForSelector(`${T('atlas-workspace')}[data-status="error"]`, { timeout: 20000 });
  eq(await p2.locator(`${T('atlas-viewport')} canvas`).count(), 0, 'no canvas, no placeholder brain');
  assert(/could not be loaded|failed/i.test(await p2.locator(T('atlas-workspace')).innerText()), 'explicit error text');
  await c2.close();
});

await step('WebGL unavailable: an explicit message and working non-3D scenes, no fake brain', async () => {
  const c2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await c2.addInitScript(() => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : orig.call(this, t, ...a); }; });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.waitForSelector(T('atlas-webgl-fallback'), { timeout: 20000 });
  assert(/WebGL/.test(await p2.locator(T('atlas-webgl-fallback')).innerText()), 'fallback names WebGL');
  await shot('20-no-webgl', p2);
  // the finder still lists and selects real structures; the decoder scene needs no WebGL at all
  await p2.keyboard.press('Meta+k'); await p2.keyboard.type('thalamus'); await p2.waitForTimeout(250); await p2.keyboard.press('Enter');
  assert(/thalam/i.test(await store('s.selectedId', p2)), 'selection without WebGL');
  await p2.goto(`${BASE}/#/decoder`); await p2.waitForSelector(T('decoder-diagram'));
  await c2.close();
});

await step('phone viewport (390 × 844, touch): the brain fills the screen, a tap selects, every scene fits the width', async () => {
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p2 = await c2.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(String(e)));
  await p2.goto(BASE);
  await p2.waitForSelector(`${T('atlas-workspace')}[data-status="ready"]`, { timeout: 30000 });
  await p2.waitForTimeout(1200);
  const cov = await p2.evaluate(() => window.__atlas.coverage());
  assert(cov.w > 0.6, `brain fills only ${(cov.w * 100).toFixed(0)} % of the phone width`);
  await shot('21-phone-home', p2);
  const pt = await p2.evaluate(() => window.__atlas.screenPointOf('left_precentral_gyrus'));
  await p2.touchscreen.tap(pt.x, pt.y);
  await p2.waitForSelector(T('region-inspector'));
  await p2.waitForTimeout(900);
  await shot('22-phone-selected', p2);
  const overflow = {};
  for (const w of ['brain', 'interface', 'signal', 'chip', 'decoder', 'research']) {
    await p2.goto(`${BASE}/#/${w}`); await p2.waitForTimeout(w === 'chip' || w === 'decoder' ? 1500 : 700);
    overflow[w] = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (w === 'interface') await shot('23-phone-neurons', p2);
    if (w === 'decoder') await shot('24-phone-decoder', p2);
  }
  for (const [w, o] of Object.entries(overflow)) assert(o <= 1, `${w} overflows the phone width by ${o} px`);
  eq(errs.length, 0, `page errors on phone: ${errs[0]}`);
  await c2.close();
  return `brain fills ${(cov.w * 100).toFixed(0)} % of the width; no horizontal overflow in any of the six scenes`;
});

await step('no console errors during the whole desktop walkthrough', async () => {
  const real = consoleErrors.filter((e) => !/net::ERR_FAILED|Failed to load resource/.test(e));
  eq(real.length, 0, `console errors: ${real.slice(0, 2).join(' | ')}`);
});

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
  process.env.HEADED ? '' : 'This was a headless run: frame pacing without a display is not representative. Interactive timings are measured separately, in a visible window, by tests/e2e/perf.mjs.',
  'Screenshots: docs/evidence/cinematic/screens/ (captured from the running application in this run).',
].filter((l) => l !== '');
writeFileSync(join(root, 'docs/evidence/e2e-report.txt'), lines.join('\n') + '\n');
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
