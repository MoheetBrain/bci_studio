// Runs the browser DEMO model (src/lab/model.ts) on the stimulus recorded in the RTL trace and
// compares every sample with the values the Verilog actually produced. Exit code 1 on mismatch.
// Usage: node scripts/check-demo-vs-rtl.mjs   (from studio/)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: [join(root, 'src/lab/model.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const tr = JSON.parse(readFileSync(join(root, 'public/artifacts/rtl_trace.json'), 'utf8'));
const cfg = { threshold: tr.config.threshold, hysteresis: tr.config.hysteresis, refractory: tr.config.refractory, alphaShift: tr.config.alpha_shift };
const st = mod.freshState();
let agree = 0, fires = 0;
const bad = [];
for (const s of tr.samples) {
  const r = mod.stepCore(st[s.ch], s.i, s.ch, s.x, cfg);
  const fields = ['base', 'res', 'mag', 'above', 'rearm', 'armed', 'refr', 'primed', 'fire'];
  const diff = fields.filter((f) => r[f] !== s[f]);
  if (diff.length === 0) agree++; else if (bad.length < 5) bad.push({ i: s.i, ch: s.ch, diff: diff.map((f) => `${f}: demo=${r[f]} rtl=${s[f]}`) });
  fires += r.fire;
}
console.log(`DEMO model vs RTL trace: ${agree}/${tr.samples.length} samples agree on all 9 fields; demo events=${fires}, rtl events=${tr.events.length}`);
if (bad.length) { console.log('first mismatches:', JSON.stringify(bad, null, 1)); process.exit(1); }
if (fires !== tr.events.length) { console.log('event count mismatch'); process.exit(1); }
console.log('PASS');
