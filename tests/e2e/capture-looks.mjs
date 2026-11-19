// Same-camera comparison captures of the brain's rendering: the old look, a stock-PBR attempt, and the tissue shader.
//
//   node tests/e2e/capture-looks.mjs [--base http://127.0.0.1:5180] [--out docs/evidence/cinematic/looks] [--only tissue]
//
// Every capture uses the same viewport (1440 × 900, device pixel ratio 1) and the same camera pose, so the images
// differ only in geometry / material / lighting. The app selects the rendering with ?look=legacy|pbr|tissue.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:5180');
const out = resolve(root, arg('out', 'docs/evidence/cinematic/looks'));
const only = arg('only', '');
const dpr = Number(arg('dpr', '1'));
mkdirSync(out, { recursive: true });

/** Fixed poses (metres, display space). 'hero' is the opening shot; 'close' looks along the left central region. */
const POSES = {
  hero: null,
  close: { position: [-0.205, 0.135, -0.03], target: [-0.03, 0.035, 0.0] },
  top: { position: [0.0, 0.42, 0.012], target: [0.0017, -0.0113, 0.0084] },
};

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
const errors = [];
let hero = null;
for (const look of ['tissue', 'pbr', 'legacy']) {
  if (only && only !== look) continue;
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${look}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${look}: ${e.message}`));
  await page.goto(`${BASE}/?look=${look}#/brain`);
  await page.waitForSelector('[data-testid="atlas-workspace"][data-status="ready"]', { timeout: 60000 });
  await page.waitForSelector('[data-testid="atlas-viewport"] canvas');
  await page.waitForTimeout(1200);
  if (!hero) hero = await page.evaluate(() => window.__atlas.cameraState());
  for (const [name, pose] of Object.entries(POSES)) {
    const p = pose ?? hero;
    await page.evaluate((q) => window.__atlas.store.getState().camera({ kind: 'pose', position: q.position, target: q.target, instant: true }), p);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${name}-${look}.png`) });
  }
  const info = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="atlas-viewport"] canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', coverage: window.__atlas.coverage?.() };
  });
  console.log(look, JSON.stringify(info));
  await page.close();
}
await browser.close();
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
console.log('wrote', out);
