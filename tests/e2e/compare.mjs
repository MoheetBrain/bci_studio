// Side-by-side sheets: before the cinematic rebuild vs after it. Pure layout of existing captures — no pixels of
// either side are altered, only scaled together onto one page.
//
//   node tests/e2e/compare.mjs
//
// Inputs:  docs/evidence/cinematic/looks/*.png     (same viewport AND same camera; tests/e2e/capture-looks.mjs)
//          docs/evidence/cinematic/baseline/*.png  (the application at df9ba12, captured before any edit)
//          docs/evidence/cinematic/screens/*.png   (this build; tests/e2e/walkthrough.mjs)
// Output:  docs/evidence/cinematic/compare/*.png
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'docs/evidence/cinematic'), out = join(dir, 'compare');
mkdirSync(out, { recursive: true });

const SHEETS = [
  { name: '01-brain-same-camera', title: 'Default brain — identical viewport (1440 × 900) and identical camera', note: 'Only geometry, material, lighting and stage differ. Left and middle are selectable in the running app with ?look=legacy and ?look=pbr.',
    cells: [['looks/hero-legacy.png', 'Before: 251 separate atlas parcels, matte standard material, light stage'], ['looks/hero-pbr.png', 'Candidate A: new continuous surface, stock physically-based material'], ['looks/hero-tissue.png', 'Chosen: new continuous surface, tissue shader']] },
  { name: '02-brain-close-same-camera', title: 'Close view of the left central region — identical viewport and camera', note: 'The parcel seams of the old geometry are visible on the left; the new surface is one sheet with baked fold occlusion.',
    cells: [['looks/close-legacy.png', 'Before'], ['looks/close-pbr.png', 'Candidate A: stock physically-based material'], ['looks/close-tissue.png', 'Chosen: tissue shader']] },
  { name: '03-brain-top-same-camera', title: 'From above — identical viewport and camera', note: '',
    cells: [['looks/top-legacy.png', 'Before'], ['looks/top-tissue.png', 'After']] },
  { name: '04-home-screen', title: 'Home screen as shipped — same viewport, each build’s own opening camera', note: 'Before: the application at commit df9ba12.',
    cells: [['baseline/01-home-brain.png', 'Before'], ['screens/01-home.png', 'After']] },
  { name: '05-selected-region', title: 'Selected region (left precentral gyrus)', note: '',
    cells: [['baseline/03-selected-precentral-inspector.png', 'Before'], ['screens/03-selected.png', 'After']] },
  { name: '06-cut-and-slice', title: 'Cutting the brain', note: 'Before: a clip plane through hollow parcel shells. After: the atlas subject’s own T1 MRI on the cut face (measured data).',
    cells: [['baseline/08-cutaway.png', 'Before'], ['screens/06-slice.png', 'After']] },
  { name: '07-microscopic-scene', title: 'Neurons and one electrode contact', note: 'Before: 2D schematic cards with a drawn spike template. After: a 3D schematic driven by the Hodgkin–Huxley model, with a seekable timeline.',
    cells: [['baseline/10-neural-interface.png', 'Before'], ['screens/11-neurons.png', 'After']] },
  { name: '08-acquisition-journey', title: 'Acquisition: electrode → amplifier → converter → samples', note: 'The model and its numbers are unchanged; the stage, the prediction task and the links to the neighbouring scenes are new.',
    cells: [['baseline/11-signal-journey.png', 'Before'], ['screens/14-signal.png', 'After']] },
  { name: '09-chip', title: 'Our chip', note: 'The source-traced map is unchanged in content. The decoder scene on the right is new and is driven by the real RTL trace.',
    cells: [['baseline/15-our-chip.png', 'Before'], ['screens/15-chip.png', 'After'], ['screens/17-decoder.png', 'New: decoder, one clock cycle at a time']] },
  { name: '10-phone', title: 'Phone viewport (390 × 844)', note: '',
    cells: [['baseline/23-phone-home.png', 'Before'], ['screens/21-phone-home.png', 'After'], ['screens/23-phone-neurons.png', 'After: Neurons']] },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 900 }, deviceScaleFactor: 1 })).newPage();
const tmp = join(out, '_sheet.html');
let made = 0;
for (const s of SHEETS) {
  const missing = s.cells.filter(([f]) => !existsSync(join(dir, f)));
  if (missing.length) { console.log(`skipped ${s.name}: missing ${missing.map(([f]) => f).join(', ')}`); continue; }
  const w = Math.floor((2400 - 40 - 16 * (s.cells.length - 1)) / s.cells.length);
  writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:20px;background:#0B0F1A;color:#E8EEF9;font:15px/1.4 -apple-system,system-ui,sans-serif;width:2360px}
    h1{font-size:22px;margin:0 0 4px} p{margin:0 0 14px;color:#A9B6CF}
    .row{display:flex;gap:16px;align-items:flex-start} figure{margin:0;width:${w}px}
    img{display:block;width:100%;border:1px solid #2A3550;border-radius:6px;background:#000}
    figcaption{padding:8px 2px 0;font-size:14px;color:#C9D3E8}
  </style><h1>${s.title}</h1><p>${s.note || '&nbsp;'}</p><div class="row">${s.cells.map(([f, c]) => `<figure><img src="${pathToFileURL(join(dir, f)).href}"><figcaption>${c} <span style="color:#6F7E9C">· ${f}</span></figcaption></figure>`).join('')}</div>`);
  await page.goto(pathToFileURL(tmp).href);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: true });
  made++;
}
rmSync(tmp, { force: true });
await browser.close();
console.log(`wrote ${made} comparison sheets to docs/evidence/cinematic/compare/`);
process.exit(0);
