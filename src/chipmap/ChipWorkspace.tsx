// "Our chip": what the Hamiltonian digital design actually contains, traced to source, in three separate layers:
//   1 · implemented digital design — modules and instances read from the RTL snapshot (file:line);
//   2 · tested behaviour          — the executed suites that exercise each module, and the model-vs-RTL checks;
//   3 · conceptual external hardware — everything drawn for context that does not exist in the repository.
// The full existing studio (3D die, circuit diagrams, gates, physical layout, signal lab) is one click away.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useHierarchy, srcRef, type ChipHierarchy, type ChipInstance, type ChipModule } from './useHierarchy';
import { CONCEPTUAL, DIGITAL_PATHS, MILESTONES } from './chipFacts';
import { STAGES } from '../journey/stages';
import { useShell } from '../shell/shellStore';
import { useAtlas } from '../atlas/atlasStore';
import { EvidenceTag } from '../science/Cite';
import './chip.css';

const ChipStudio = lazy(() => import('../App'));
const RTL = import.meta.glob('../../chip/rtl/*.v', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

interface Checks { ranAt: string; chipCommit: string; note: string; results: Array<{ id: string; what: string; passed: boolean; output: string[]; covers: string[] }> }

function useJson<T>(file: string): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}artifacts/${file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (live) setState({ data: d as T, error: null }); })
      .catch((e) => { if (live) setState({ data: null, error: `${file}: ${e instanceof Error ? e.message : String(e)}` }); });
    return () => { live = false; };
  }, [file]);
  return state;
}

function SourceExcerpt({ file, line, before = 1, after = 9 }: { file: string; line: number; before?: number; after?: number }) {
  const [text, setText] = useState<string[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setText(null); setErr(false);
    const load = RTL[`../../chip/${file}`];
    if (!load) { setErr(true); return; }
    load().then((t) => { if (live) setText(t.split('\n')); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [file]);
  if (err) return <p className="warn-text">Source file {file} is not available in this build.</p>;
  if (!text) return <p className="muted">Loading source…</p>;
  const a = Math.max(1, line - before), b = Math.min(text.length, line + after);
  return (
    <pre className="src" aria-label={`Verilog source, ${file} lines ${a} to ${b}`} data-testid="src-excerpt">
      {text.slice(a - 1, b).map((l, i) => (
        <span key={i} className={a + i === line ? 'src-line hit' : 'src-line'}><span className="ln">{a + i}</span>{l || ' '}{'\n'}</span>
      ))}
    </pre>
  );
}

/** Nested boxes built from the extracted instance tree: hierarchy, not placement. */
function Tree({ h, parent, depth, selected, onSelect, highlight }: { h: ChipHierarchy; parent: string; depth: number; selected: string | null; onSelect: (p: string) => void; highlight: Set<string> }) {
  const kids = h.instances.filter((i) => i.depth === depth && i.path.startsWith(parent + '/') && i.path.split('/').length === parent.split('/').length + 1);
  if (!kids.length) return null;
  return (
    <div className={`tree-kids depth-${depth}`}>
      {kids.map((i) => {
        const hasKids = h.instances.some((k) => k.path.startsWith(i.path + '/'));
        return (
          <div key={i.path} className={`inst${hasKids ? ' has-kids' : ''}${selected === i.path ? ' selected' : ''}${highlight.size && !highlight.has(i.path) ? ' dim' : ''}${highlight.has(i.path) ? ' on-path' : ''}`}>
            <button type="button" className="inst-btn" onClick={() => onSelect(i.path)} aria-pressed={selected === i.path} data-testid={`inst-${i.path.split('/').slice(1).join('.')}`} title={`${i.module} — ${srcRef(i.file, i.line)}`}>
              <span className="inst-n mono">{i.name}</span>
              <span className="inst-m mono">{i.module}</span>
            </button>
            {hasKids && <Tree h={h} parent={i.path} depth={depth + 1} selected={selected} onSelect={onSelect} highlight={highlight} />}
          </div>
        );
      })}
    </div>
  );
}

function InstanceInspector({ h, inst, mod }: { h: ChipHierarchy; inst: ChipInstance | null; mod: ChipModule }) {
  const suites = h.suites.filter((s) => s.covers.includes(mod.name));
  const stages = STAGES.filter((s) => inst && s.chipInstances?.includes(inst.path));
  const go = useShell((s) => s.go);
  return (
    <aside className="card chip-insp" aria-label="Selected block" data-testid="chip-inspector">
      <div className="layer-tag l1">Layer 1 · implemented digital design</div>
      <h2 className="mono" data-testid="chip-insp-title">{inst ? inst.name : mod.name}</h2>
      <dl className="rec">
        {inst && <><dt>Instance path</dt><dd className="mono">{inst.path.split('/').join(' / ')}</dd></>}
        <dt>Module</dt><dd className="mono">{mod.name}</dd>
        {inst && <><dt>Instantiated at</dt><dd className="mono" data-testid="chip-insp-src">{srcRef(inst.file, inst.line)}</dd></>}
        <dt>Defined at</dt><dd className="mono">{mod.file}:{mod.lineStart}–{mod.lineEnd}</dd>
        <dt>Commit</dt><dd className="mono">{h.source.commit.slice(0, 7)} <span className="muted">(chip repository snapshot)</span></dd>
      </dl>
      <h3>What the source says it is</h3>
      {mod.doc ? <p className="doc">“{mod.doc.length > 520 ? mod.doc.slice(0, 520).replace(/\s+\S*$/, '') + ' …' : mod.doc}” <span className="muted">— {mod.docFrom}, {mod.file}</span></p> : <p className="muted">This module has no descriptive comment in the source.</p>}
      {inst && <><h3>Instantiation</h3><SourceExcerpt file={inst.file} line={inst.line} /></>}
      <details>
        <summary>Ports ({mod.ports.length})</summary>
        <table className="ports"><tbody>
          {mod.ports.map((p) => <tr key={p.name}><td className={`dir dir-${p.dir}`}>{p.dir}</td><td className="mono">{p.range ?? ''}{p.signed ? ' signed' : ''}</td><td className="mono">{p.name}</td></tr>)}
        </tbody></table>
      </details>
      <div className="layer-tag l2">Layer 2 · tested behaviour</div>
      {suites.length ? (
        <>
          <p>{suites.length} executed suite{suites.length > 1 ? 's' : ''} exercise this module ({suites.reduce((a, s) => a + (s.checks ?? 0), 0)} checks, all recorded as passing on {h.verification.ranAt.slice(0, 10)}).</p>
          <details>
            <summary>Suites</summary>
            <ul className="suites">
              {suites.map((s) => <li key={s.name}><span className="mono">{s.name}</span> <span className={`st st-${s.status}`}>{s.status}</span> <span className="muted">{s.checks} checks · {s.kind}{s.testbench ? ` · ${s.testbench}` : s.method ? ` · ${s.method}` : ''}</span></li>)}
            </ul>
            <p className="muted">A suite is linked to a module when the module is inside the device under test of its testbench ({'“'}covers{'”'} = instantiated, not line coverage).</p>
          </details>
        </>
      ) : <p className="warn-text" data-testid="chip-no-suite">No executed suite in the recorded verification exercises this module.</p>}
      {!mod.inChipTop && <p className="warn-text" data-testid="chip-not-in-top">This module is in the source tree but is not instantiated under {h.top}: it is not part of the chip.</p>}
      {stages.length > 0 && <p className="muted">Appears in the signal journey at: {stages.map((s) => s.title).join(', ')}. <button type="button" className="btn-link inline" onClick={() => go('signal')}>Open the journey</button></p>}
    </aside>
  );
}

function ChipMap() {
  const { data: h, error } = useHierarchy();
  const checks = useJson<Checks>('studio_checks.json');
  const manifest = useJson<{ files: string[]; git_rev: string; generated_at: string }>('manifest.json');
  const [selected, setSelected] = useState<string | null>('hbci02_chip_top/u_core/u_readout/u_event/u_state');
  const [pathId, setPathId] = useState<string | null>(null);
  const [orphan, setOrphan] = useState<string | null>(null);
  const setChipView = useShell((s) => s.setChipView);
  const openResearch = useShell((s) => s.openResearch);
  const region = useAtlas((s) => s.nameOf(s.selectedId));
  const highlight = useMemo(() => new Set(pathId ? DIGITAL_PATHS.find((p) => p.id === pathId)!.instances : []), [pathId]);

  if (error) return <div className="page"><div className="page-inner"><div className="card" role="alert" data-testid="chip-error"><strong>The chip hierarchy could not be loaded.</strong><p>{error}. Run <code>npm run chip:extract</code>. No placeholder diagram is shown.</p></div></div></div>;
  if (!h) return <div className="shell-loading" role="status">Reading the chip hierarchy…</div>;
  const inst = orphan ? null : h.instances.find((i) => i.path === selected) ?? null;
  const mod = orphan ? h.modules.find((m) => m.name === orphan)! : inst ? h.modules.find((m) => m.name === inst.module)! : h.modules.find((m) => m.name === h.top)!;
  const orphans = h.modules.filter((m) => !m.inChipTop);
  const has = (re: RegExp) => !!manifest.data?.files.some((f) => re.test(f));
  const artifactFor: Record<string, boolean | null> = { rtl: true, sim: h.verification.passing === h.verification.suites, synth: manifest.data ? has(/^synth_stats\.json$/) : null, layout: manifest.data ? has(/^layout_v04\/.*\.gds\.gz$/) : null };

  return (
    <div className="page chip" data-testid="chip-map">
      <div className="page-inner">
        <header className="jr-header">
          <div>
            <h1>Our chip, traced to source</h1>
            <p className="lede">
              The Hamiltonian design in this repository is a <strong>digital</strong> block: it starts at 16-bit samples and ends at records and predictions.
              Everything before the samples and after the pins is drawn for context only.{region && <> Samples in this story would come, illustratively, from an electrode in the {region}.</>}
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setChipView('studio')} data-testid="open-studio">Open the full chip studio (3D die, circuits, gates, layout) →</button>
        </header>

        <section className="card" aria-label="Which milestones have been reached">
          <h2>How real is it?</h2>
          <ol className="miles" data-testid="milestones">
            {MILESTONES.map((m) => {
              const present = artifactFor[m.id];
              const ok = m.reached && present !== false;
              return (
                <li key={m.id} className={ok ? 'yes' : 'no'} data-reached={ok}>
                  <span className="mile-mark" aria-hidden="true">{ok ? '✓' : '✕'}</span>
                  <span className="mile-label">{m.label}</span>
                  <span className="mile-basis">{m.basis}{present === false ? ' — artifact missing in this build' : ''}</span>
                </li>
              );
            })}
          </ol>
          <p className="muted">Each step is a separate achievement. RTL that simulates correctly is not a synthesised netlist; a routed layout is not a fabricated chip; a fabricated chip is not a device tested with tissue.</p>
        </section>

        <div className="chip-grid">
          <section className="card chip-diagram" aria-label="Block diagram of the chip hierarchy and its surroundings">
            <div className="row diagram-head">
              <h2>Block map</h2>
              <span className="row paths" role="group" aria-label="Highlight a record path">
                {DIGITAL_PATHS.map((p) => <button key={p.id} type="button" className={`btn${pathId === p.id ? ' on' : ''}`} aria-pressed={pathId === p.id} onClick={() => setPathId(pathId === p.id ? null : p.id)} data-testid={`path-${p.id}`} title={p.summary}>{p.title}</button>)}
              </span>
            </div>
            {pathId && <p className="path-note" data-testid="path-note">{DIGITAL_PATHS.find((p) => p.id === pathId)!.summary}</p>}
            <div className="map">
              <div className="concept-col" aria-label="Conceptual hardware upstream of the chip">
                <div className="layer-tag l3">Layer 3 · conceptual — not in this repository</div>
                {CONCEPTUAL.filter((c) => c.side === 'upstream').map((c) => (
                  <div key={c.id} className="concept" data-testid={`concept-${c.id}`}>
                    <strong>{c.name}</strong><span className="concept-status">{c.status}</span>
                    <span className="concept-quote">“{c.quote}” — <span className="mono">{c.doc}</span></span>
                  </div>
                ))}
                <div className="flow">16-bit samples over SPI ↓</div>
              </div>
              <div className="top-col">
                <div className="layer-tag l1">Layer 1 · implemented digital design (RTL, commit {h.source.commit.slice(0, 7)})</div>
                <div className={`inst top has-kids${selected === h.top && !orphan ? ' selected' : ''}`}>
                  <button type="button" className="inst-btn" onClick={() => { setOrphan(null); setSelected(h.top); }} data-testid="inst-top"><span className="inst-n mono">{h.top}</span><span className="inst-m">chip top · 14 signal pins</span></button>
                  <Tree h={h} parent={h.top} depth={1} selected={orphan ? null : selected} onSelect={(p) => { setOrphan(null); setSelected(p); }} highlight={highlight} />
                </div>
                <p className="muted">Boxes show which block contains which (hierarchy). They are not positions on silicon; for placed-and-routed geometry open Physical layout in the full studio.</p>
                {orphans.length > 0 && (
                  <div className="orphans" data-testid="orphans">
                    <span className="muted">In the source tree but <strong>not part of the chip top</strong>:</span>
                    {orphans.map((m) => <button key={m.name} type="button" className={`btn mono${orphan === m.name ? ' on' : ''}`} onClick={() => setOrphan(m.name)} data-testid={`orphan-${m.name}`}>{m.name}</button>)}
                  </div>
                )}
              </div>
              <div className="concept-col" aria-label="What does not exist downstream of the chip">
                <div className="flow">↓ records, predictions (pins)</div>
                <div className="layer-tag l3">Layer 3 · conceptual / absent</div>
                {CONCEPTUAL.filter((c) => c.side === 'downstream').map((c) => (
                  <div key={c.id} className="concept" data-testid={`concept-${c.id}`}>
                    <strong>{c.name}</strong><span className="concept-status">{c.status}</span>
                    <span className="concept-quote">“{c.quote}” — <span className="mono">{c.doc}</span></span>
                  </div>
                ))}
                <button type="button" className="btn btn-link" onClick={() => openResearch('AFE ADC not implemented')}>Read the project documents behind these statements</button>
              </div>
            </div>
          </section>
          <InstanceInspector h={h} inst={inst} mod={mod} />
        </div>

        <section className="card" aria-label="Model versus RTL checks executed for this build">
          <div className="layer-tag l2">Layer 2 · tested behaviour</div>
          <h2>Digital paths checked at this revision <EvidenceTag kind="measured" title="Outputs of RTL simulation recorded as traces, compared with the studio's models by scripts that were executed for this build." /></h2>
          <p className="muted">{h.verification.passing} of {h.verification.suites} recorded suites pass ({h.verification.simulator.split(' (')[0]}; lint: {h.verification.lint.warnings} warnings). Below: the studio’s own models compared with the recorded RTL traces.</p>
          {checks.error && <p className="warn-text" role="alert" data-testid="checks-missing">The check results are not available ({checks.error}). Run <code>npm run check:rtl</code>; until then no agreement with the RTL is claimed on this screen.</p>}
          {checks.data && (
            <ul className="checks" data-testid="checks">
              {checks.data.results.map((c) => (
                <li key={c.id} className={c.passed ? 'pass' : 'fail'}>
                  <div className="row"><span className={`st st-${c.passed ? 'pass' : 'fail'}`}>{c.passed ? 'pass' : 'FAIL'}</span><strong className="mono">{c.id}</strong><span>{c.what}</span></div>
                  <pre className="out">{c.output.join('\n')}</pre>
                </li>
              ))}
              <li className="meta muted">Executed {checks.data.ranAt.replace('T', ' ').slice(0, 16)} UTC against chip commit {checks.data.chipCommit.slice(0, 7)}. {checks.data.note}</li>
            </ul>
          )}
          <p className="muted">Agreement is shown for these recorded stimuli only. It does not prove the model and the RTL agree for every input, and it says nothing about silicon.</p>
        </section>
      </div>
    </div>
  );
}

export default function ChipWorkspace() {
  const view = useShell((s) => s.chipView);
  const setChipView = useShell((s) => s.setChipView);
  if (view === 'studio') {
    return (
      <div className="chip-studio" data-testid="chip-studio">
        <div className="chip-studio-bar">
          <button type="button" className="btn" onClick={() => setChipView('map')} data-testid="back-to-map">← Source-traced map</button>
          <span className="muted">Full chip studio: semantic zoom from system to physical layout, with its own evidence labels.</span>
        </div>
        <div className="chip-studio-body">
          <Suspense fallback={<div className="shell-loading" role="status">Loading the chip studio…</div>}><ChipStudio /></Suspense>
        </div>
      </div>
    );
  }
  return <ChipMap />;
}
