// Runs the browser DEMO model of the v0.3 readout core (src/lab/featureModel.ts) on the stimulus recorded
// in rtl_trace_v03.json and compares it with the values the Verilog produced:
//  - every accepted sample: y, ysat, acc, cnt, done (FEATURE path internals)
//  - FEATURE records (ch, ts, data, sat flag), RAW records (ch, ts, data), EVENT records (ch, ts, data)
// Exit code 1 on any mismatch. Usage (from studio/): node scripts/check-v03-vs-rtl.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(root, 'src/lab/featureModel.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral',
  loader: { '.json': 'json' },
});
const m = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const tr = JSON.parse(readFileSync(join(root, 'public/artifacts/rtl_trace_v03.json'), 'utf8'));
const c = tr.config;
const feat = { b0: c.b0, b1: c.b1, b2: c.b2, a1: c.a1, a2: c.a2, winLog2: c.win_log2, energyShift: c.energy_shift };
const N = tr.profile.num_channels;
const st = Array.from({ length: N }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0, acc: 0n, cnt: 0, sat: false }));
let agree = 0;
const bad = [];
const feats = [];
for (const s of tr.samples) {
  const r = m.stepFeature(st[s.ch], s.x, feat);
  const diff = ['y', 'ysat', 'acc', 'cnt', 'done'].filter((k) => r[k] !== s[k]);
  if (diff.length === 0) agree++; else if (bad.length < 5) bad.push({ i: s.i, ch: s.ch, diff: diff.map((k) => `${k}: demo=${r[k]} rtl=${s[k]}`) });
  if (r.done) feats.push({ ch: s.ch, ts: s.i, data: r.energy, sat: r.esat });
}
console.log(`FEATURE internals: ${agree}/${tr.samples.length} samples agree on y, ysat, acc, cnt, done`);
const rtlF = tr.runs.FEATURE.records.filter((r) => r.type === 2);
const fOk = rtlF.length === feats.length && rtlF.every((r, k) => {
  const d = feats.find((f) => f.ts === r.ts && f.ch === r.ch);
  return d && d.data === r.data && d.sat === (r.flags & 1);
});
console.log(`FEATURE records: rtl=${rtlF.length} demo=${feats.length} ${fOk ? 'all match (ch, ts, energy, sat)' : 'MISMATCH'}`);
const rawRtl = tr.runs.RAW.records.filter((r) => r.type === 0);
const rawOk = rawRtl.length === tr.samples.length && rawRtl.every((r) => { const s = tr.samples.find((q) => q.i === r.ts); return s && s.x === r.data && s.ch === r.ch; });
console.log(`RAW records: ${rawRtl.length} vs ${tr.samples.length} samples ${rawOk ? 'exact (value, channel, index)' : 'MISMATCH'}`);
if (bad.length) console.log('first mismatches:', JSON.stringify(bad, null, 1));
process.exit(agree === tr.samples.length && fOk && rawOk ? 0 : 1);
