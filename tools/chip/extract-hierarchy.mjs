// Extract the module / instance hierarchy of the Hamiltonian chip straight from the RTL snapshot (chip/rtl/*.v),
// and link it to the executed verification suites (public/artifacts/verification.json) through the testbenches in
// chip/tb. Output: public/artifacts/chip_hierarchy.json.
//
//   node tools/chip/extract-hierarchy.mjs
//
// This is a mechanical reading of the source: a block exists in the output only if a `module` or an instantiation of
// a known module exists in the Verilog. Nothing is added by hand. It is a text-level parser for this codebase's
// plain Verilog-2005 style (one statement per instantiation, ANSI port lists); it is not a general Verilog front end.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const snapshot = JSON.parse(readFileSync(join(root, 'chip/SNAPSHOT.json'), 'utf8'));
const TOP = 'hbci02_chip_top';

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

function parseFile(rel) {
  const raw = readFileSync(join(root, 'chip', rel), 'utf8');
  const src = stripComments(raw);
  const rawLines = raw.split('\n');
  const modules = [];
  const re = /\bmodule\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('endmodule', m.index);
    if (end < 0) throw new Error(`${rel}: module ${m[1]} has no endmodule`);
    const lineStart = lineOf(src, m.index), lineEnd = lineOf(src, end);
    // the comment block directly above the module (its own description in the source)
    const doc = [];
    for (let l = lineStart - 2; l >= 0; l--) {
      const t = rawLines[l].trim();
      if (t.startsWith('//')) { const c = t.replace(/^\/\/\s?/, ''); if (!/^[=\-─]{4,}$/.test(c)) doc.unshift(c); }
      else if (t === '' && doc.length === 0) continue;
      else break;
    }
    const body = src.slice(m.index, end);
    const headerEnd = body.indexOf(');');
    const header = body.slice(0, headerEnd);
    const ports = [...header.matchAll(/\b(input|output|inout)\s+(?:wire\s+|reg\s+)?(signed\s+)?(\[[^\]]+\]\s*)?([A-Za-z_]\w*)/g)]
      .map((p) => ({ dir: p[1], signed: !!p[2], range: p[3]?.trim() ?? null, name: p[4] }));
    const params = [...header.matchAll(/\bparameter\s+(?:integer\s+|signed\s+|\[[^\]]+\]\s*)*([A-Za-z_]\w*)\s*=\s*([^,\n)]+)/g)].map((p) => ({ name: p[1], default: p[2].trim() }));
    modules.push({ name: m[1], file: rel, lineStart, lineEnd, doc: doc.join(' ').replace(/\s+/g, ' ').trim(), ports, params, bodyOffset: m.index, body });
  }
  // The file's leading comment block describes the module the file is named after.
  const header = [];
  for (const l of rawLines) {
    const t = l.trim();
    if (!t.startsWith('//')) break;
    const c = t.replace(/^\/\/\s?/, '');
    if (!/^[=\-─]{4,}$/.test(c)) header.push(c);
  }
  const primary = modules.find((mod) => mod.name === rel.replace(/^.*\//, '').replace(/\.v$/, ''));
  if (primary && header.length) {
    const text = header.join(' ').replace(/\s+/g, ' ').trim();
    primary.doc = primary.doc && !text.includes(primary.doc) ? `${primary.doc}. ${text}` : text;
    primary.docFrom = 'file header comment';
  }
  for (const mod of modules) mod.docFrom ??= mod.doc ? 'comment above the module' : 'none';
  return { rel, src, modules };
}

const rtlFiles = readdirSync(join(root, 'chip/rtl')).filter((f) => f.endsWith('.v')).sort().map((f) => `rtl/${f}`);
const parsed = rtlFiles.map(parseFile);
const modules = parsed.flatMap((p) => p.modules.map((mod) => ({ ...mod, src: p.src })));
const names = new Set(modules.map((mod) => mod.name));

// instantiations: `<module> [#( ... )] <instance> (`
const INST = /(^|[;\n])\s*([A-Za-z_]\w*)\s*(?:#\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\))?\s*([A-Za-z_]\w*)\s*\(/g;
for (const mod of modules) {
  mod.instances = [];
  let m;
  INST.lastIndex = 0;
  while ((m = INST.exec(mod.body))) {
    if (!names.has(m[2]) || m[2] === mod.name) continue;
    const at = mod.bodyOffset + m.index + m[0].indexOf(m[4]);
    mod.instances.push({ name: m[4], module: m[2], file: mod.file, line: lineOf(mod.src, at), parameters: m[3] ? m[3].replace(/\s+/g, ' ').trim() : null });
  }
}
const byName = new Map(modules.map((mod) => [mod.name, mod]));
if (!byName.has(TOP)) throw new Error(`top module ${TOP} not found in chip/rtl`);

// elaborate the tree under the chip top
const tree = [];
const walk = (modName, path, depth) => {
  for (const inst of byName.get(modName).instances) {
    const p = `${path}/${inst.name}`;
    tree.push({ path: p, name: inst.name, module: inst.module, parentModule: modName, depth, file: inst.file, line: inst.line, parameters: inst.parameters });
    walk(inst.module, p, depth + 1);
  }
};
walk(TOP, TOP, 1);
const reachable = new Set([TOP, ...tree.map((t) => t.module)]);

// testbenches → which RTL modules they instantiate (the devices under test)
const tbs = readdirSync(join(root, 'chip/tb')).filter((f) => f.endsWith('.v')).sort().map((f) => {
  const src = stripComments(readFileSync(join(root, 'chip/tb', f), 'utf8'));
  const duts = new Set();
  let m;
  INST.lastIndex = 0;
  while ((m = INST.exec(src))) if (names.has(m[2])) duts.add(m[2]);
  return { file: `tb/${f}`, name: f.replace(/\.v$/, ''), duts: [...duts] };
});
// every module contained in a DUT is exercised by that testbench (transitively)
const contained = (modName, acc = new Set()) => { acc.add(modName); for (const i of byName.get(modName).instances) contained(i.module, acc); return acc; };

// Which testbench a suite runs. Suites named after a testbench link by name; the others follow the chip repository's
// Makefile (read at the snapshot commit): STREAM_TB → the event core, TB3 → the readout core, TBAI → the decoder,
// TB4 → the digital top, TBC → the chip top; two suites are tool proofs without a testbench.
const SUITE_RULES = [
  { match: /^(random_vs_golden|gate_level_vs_golden|scenario_trace|mutation_sanity)$/, tb: 'tb/tb_hbci_stream.v' },
  { match: /^v03_legacy_preserved$/, duts: ['hbci_event_core'], method: 'legacy-equivalence script (scripts/legacy_check.py)' },
  { match: /^v03_/, tb: 'tb/tb_hbci_readout.v' },
  { match: /^ai_formal$/, duts: ['hbci_ai_decoder'], method: 'formal proofs (SymbiYosys)' },
  { match: /^ai_/, tb: 'tb/tb_hbci_ai_decoder.v' },
  { match: /^(top_|v04_)/, tb: 'tb/tb_hbci02_top.v' },
  { match: /^chip_/, tb: 'tb/tb_hbci02_chip.v' },
  { match: /^yosys_equiv/, duts: ['hbci_event_core'], method: 'logic equivalence check (Yosys)' },
];
const kindOf = (name) => (/formal/.test(name) ? 'formal proof' : /equiv/.test(name) ? 'equivalence check' : /gate_level/.test(name) ? 'gate-level simulation of the synthesised netlist'
  : /mutation/.test(name) ? 'mutation sanity (the tests must catch injected faults)' : /trace/.test(name) ? 'RTL simulation producing a studio trace' : 'RTL simulation');

const verification = JSON.parse(readFileSync(join(root, 'public/artifacts/verification.json'), 'utf8'));
const suites = verification.suites.map((s) => {
  const named = tbs.find((t) => s.name === t.name);
  const rule = named ? null : SUITE_RULES.find((r) => r.match.test(s.name));
  const tb = named ?? (rule?.tb ? tbs.find((t) => t.file === rule.tb) : null) ?? null;
  if (rule?.tb && !tb) throw new Error(`suite ${s.name}: testbench ${rule.tb} not found in chip/tb`);
  const duts = tb ? tb.duts : rule?.duts ?? [];
  for (const d of duts) if (!byName.has(d)) throw new Error(`suite ${s.name}: unknown module ${d}`);
  const covers = [...new Set(duts.flatMap((d) => [...contained(d)]))].sort();
  return {
    name: s.name, status: s.status, checks: s.checks ?? null, errors: s.errors ?? null, tests: (s.tests ?? []).length,
    kind: kindOf(s.name), testbench: tb?.file ?? null, method: rule?.method ?? null,
    linkBasis: named ? 'suite is named after its testbench' : rule ? 'chip repository Makefile at the snapshot commit' : 'none',
    duts, covers,
  };
});
const suitesOf = (modName) => suites.filter((s) => s.covers.includes(modName)).map((s) => s.name);

const out = {
  generatedBy: 'tools/chip/extract-hierarchy.mjs',
  source: { repository: snapshot.repository, commit: snapshot.commit, commitDate: snapshot.commitDate, rtlSha256: snapshot.rtlSha256, files: rtlFiles },
  verification: { simulator: verification.simulator, ranAt: verification.ran_at, lint: verification.lint, suites: suites.length, passing: suites.filter((s) => s.status === 'pass').length },
  top: TOP,
  modules: modules.map((mod) => ({
    name: mod.name, file: mod.file, lineStart: mod.lineStart, lineEnd: mod.lineEnd, doc: mod.doc, docFrom: mod.docFrom,
    ports: mod.ports, params: mod.params, instances: mod.instances,
    inChipTop: reachable.has(mod.name),
    suites: suitesOf(mod.name),
  })),
  instances: tree,
  suites,
};
writeFileSync(join(root, 'public/artifacts/chip_hierarchy.json'), JSON.stringify(out, null, 1));
console.log(`${modules.length} modules in ${rtlFiles.length} files; ${tree.length} instances under ${TOP}; ${suites.length} suites (${out.verification.passing} passing)`);
for (const t of tree) console.log(`${'  '.repeat(t.depth)}${t.name} : ${t.module}   (${t.file}:${t.line})`);
const unreachable = modules.filter((mod) => !reachable.has(mod.name)).map((mod) => mod.name);
console.log(`not instantiated under ${TOP}: ${unreachable.join(', ') || '(none)'}`);
console.log(`suites not linked to any module: ${suites.filter((s) => !s.duts.length).map((s) => s.name).join(', ') || '(none)'}`);
for (const t of tbs) console.log(`  ${t.file} instantiates ${t.duts.join(', ')}`);
