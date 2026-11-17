// Run the studio-model-versus-RTL checks and record what actually happened in public/artifacts/studio_checks.json,
// which the "Our chip" screen displays. Nothing in that file is typed by hand.
//   node scripts/run-checks.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS = [
  { id: 'check:model', script: 'scripts/check-demo-vs-rtl.mjs', what: 'EVENT path: studio model vs the RTL trace of the synthetic 8-channel scenario (rtl_trace.json)', covers: ['hbci_event_core'] },
  { id: 'check:v03', script: 'scripts/check-v03-vs-rtl.mjs', what: 'FEATURE and RAW paths: studio model vs the RTL trace of the v0.3 readout core (rtl_trace_v03.json)', covers: ['hbci_readout_core'] },
  { id: 'check:v04', script: 'scripts/check-v04-vs-rtl.mjs', what: 'On-chip decoder: quantiser, MLP, CRC and latency vs the RTL traces (rtl_trace_v04.json, rtl_trace_v04_real.json)', covers: ['hbci_ai_decoder'] },
];
const snapshot = JSON.parse(readFileSync(join(root, 'chip/SNAPSHOT.json'), 'utf8'));
const results = CHECKS.map((c) => {
  const r = spawnSync(process.execPath, [join(root, c.script)], { cwd: root, encoding: 'utf8' });
  const output = (r.stdout + r.stderr).trim().split('\n').filter((l) => !/ExperimentalWarning|--trace-warnings/.test(l));
  console.log(`${r.status === 0 ? '✓' : '✗'} ${c.id}\n  ${output.join('\n  ')}`);
  return { ...c, exitCode: r.status, passed: r.status === 0, output };
});
writeFileSync(join(root, 'public/artifacts/studio_checks.json'), JSON.stringify({
  generatedBy: 'scripts/run-checks.mjs', ranAt: new Date().toISOString(), node: process.version,
  chipCommit: snapshot.commit,
  note: 'These compare the studio\'s TypeScript models with recorded RTL simulation traces (fixtures). They do not re-run the Verilog.',
  results,
}, null, 1));
process.exit(results.every((r) => r.passed) ? 0 : 1);
