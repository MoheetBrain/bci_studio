// Re-runs the specification formulas of docs/AI_DECODER.md (src/model/aiDecoder.ts: 64·log2 quantiser, MLP, CRC-32)
// on the values recorded in rtl_trace_v04.json (and rtl_trace_v04_real.json when present) and compares them with
// what the Verilog produced: every feature's L and x, every inference's h / logits / class / margin, the model CRC
// and the engine latency. Exit code 1 on any mismatch. Usage (from studio/): node scripts/check-v04-vs-rtl.mjs
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: [join(root, 'src/model/aiDecoder.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral', loader: { '.json': 'json' } });
const m = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fail = 0;
for (const name of ['rtl_trace_v04.json', 'rtl_trace_v04_real.json']) {
  const p = join(root, 'public/artifacts', name);
  if (!existsSync(p)) { console.log(`${name}: absent (skipped)`); continue; }
  const t = JSON.parse(readFileSync(p, 'utf8'));
  const masked = (ch) => ((t.config.ch_mask >> ch) & 1) === 0;
  let qOk = 0;
  for (const f of t.features) {
    const L = m.logEnergy(f.energy);
    const x = masked(f.ch) ? 0 : m.quantise(L, t.model.centre[f.ch], t.model.qshift[f.ch]);
    if (L === f.L && x === f.x) qOk++; else if (qOk === 0 || fail < 3) console.log(`  quantiser mismatch ch${f.ch} win ${f.win}: rtl L=${f.L} x=${f.x} browser L=${L} x=${x}`);
  }
  let iOk = 0;
  for (const inf of t.inferences) {
    const c = m.runMlp(t.model, inf.x);
    const hOk = inf.h.every((h, k) => h === c.h[k]);
    const lOk = inf.logits.every((l, o) => l === c.a2[o]);
    if (hOk && lOk && inf.cls === c.cls && inf.margin === c.margin) iOk++; else console.log(`  mlp mismatch frame ${inf.frame_id}: rtl h=${inf.h} logits=${inf.logits} cls=${inf.cls} margin=${inf.margin}; browser h=${c.h} a2=${c.a2} cls=${c.cls} margin=${c.margin}`);
  }
  const crc = m.modelCrc(t.model.words);
  const lat = t.inferences.filter((i) => i.aborted === null).every((i) => i.done_cycle - i.start_cycle === m.engineCycles(t.model));
  const pOk = t.predictions.filter((p) => t.inferences.some((i) => i.frame_id === p.frame && i.ts === p.ts && i.cls === p.cls && i.margin === p.margin)).length;
  console.log(`${name}: ${t.source.model.trained ? 'trained model' : 'PLACEHOLDER model'} · ${t.frames.length} frames`);
  console.log(`  quantiser (L, x): ${qOk}/${t.features.length} features agree`);
  console.log(`  MLP (h, logits, class, margin): ${iOk}/${t.inferences.length} inferences agree`);
  console.log(`  CRC-32 of the 46 words: rtl 0x${(t.model.crc32 >>> 0).toString(16)} browser 0x${crc.toString(16)} ${crc === t.model.crc32 ? 'match' : 'MISMATCH'}`);
  console.log(`  engine latency = ${m.engineCycles(t.model)} cycles for every completed inference: ${lat ? 'yes' : 'NO'}`);
  console.log(`  predictions matching an inference (frame, ts, class, margin): ${pOk}/${t.predictions.length}`);
  if (qOk !== t.features.length || iOk !== t.inferences.length || crc !== t.model.crc32 || !lat || pOk !== t.predictions.length) fail++;
}
process.exit(fail ? 1 : 0);
