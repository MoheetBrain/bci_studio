import { useEffect, useMemo, useRef, useState } from 'react';
import '../circuit/circuit.css';
import './gates.css';
import { useScene } from '../state/sceneStore';
import { useHw } from '../state/hwStore';
import { fetchText, useArtifacts } from '../artifacts/load';
import type { SchematicEntry } from '../artifacts/types';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { SourceView } from '../circuit/SourceView';
import { describeCell, isFlop, srcLines } from './cellInfo';
import { INSTANCE_MODULE, INSTANCE_MODULE_V03 } from '../circuit/rtlGraph';
import { COMPONENTS, INSTANCE_TO_ID } from '../model/components';
import { BLOCK_NAMES, INST_TO_ID } from '../micro/names';
import { useMicro } from '../micro/microStore';
import { explainGate } from '../micro/gateExplain';

interface YosysCell {
  type: string;
  attributes?: Record<string, string>;
  connections?: Record<string, (number | string)[]>;
  port_directions?: Record<string, string>;
}
interface YosysNetlist {
  modules: Record<string, {
    attributes?: Record<string, string>;
    ports?: Record<string, { direction: string; bits: (number | string)[] }>;
    cells?: Record<string, YosysCell>;
    netnames?: Record<string, { bits: (number | string)[]; hide_name?: number }>;
  }>;
}

/** Find the netlist module that corresponds to the schematic (top-most non-blackbox module). */
function pickModule(nl: YosysNetlist, base: string) {
  const names = Object.keys(nl.modules);
  const exact = names.find((n) => n === base) ?? names.find((n) => n.includes(base));
  const top = names.find((n) => nl.modules[n].attributes?.top);
  return exact ?? top ?? names[0];
}

export function GatesView() {
  const setViewEvidence = useScene((s) => s.setViewEvidence);
  const select = useScene((s) => s.select);
  const selectedId = useScene((s) => s.selectedId);
  const schematics = useArtifacts((a) => a.schematics);
  const loaded = useArtifacts((a) => a.loaded);
  const gatesModule = useHw((s) => s.gatesModule);
  const setGatesModule = useHw((s) => s.setGatesModule);
  const [kind, setKind] = useState<'gates' | 'rtl'>('gates');
  const [preferReduced, setPreferReduced] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [netlist, setNetlist] = useState<YosysNetlist | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [lineSel, setLineSel] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [explain, setExplain] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => setViewEvidence('SYNTH'), [setViewEvidence]);

  const entries = schematics?.entries ?? [];
  const modulesAvail = useMemo(() => [...new Set(entries.map((e) => e.module))], [entries]);
  const mod = gatesModule && modulesAvail.includes(gatesModule) ? gatesModule : modulesAvail[0] ?? null;
  const candidates = entries.filter((e) => e.module === mod && e.kind === kind);
  const entry: SchematicEntry | undefined =
    candidates.find((e) => e.reduced === preferReduced) ?? candidates[0];

  // Keep the inspector in sync with the module being viewed.
  useEffect(() => {
    const cur = useScene.getState().selectedId;
    if (cur && (COMPONENTS[cur]?.rtlModule === mod || (cur === 'rtl.raw_path' && mod === 'hbci_readout_core'))) return;
    const v03 = Object.keys(INSTANCE_MODULE_V03).find((k) => k !== '$raw' && INSTANCE_MODULE_V03[k] === mod);
    const inst = Object.keys(INSTANCE_MODULE).find((k) => INSTANCE_MODULE[k] === mod);
    if (v03) select(INST_TO_ID[v03]);
    else if (inst) select(INSTANCE_TO_ID[inst]);
    else if (mod === 'hbci_event_core') select('rtl.core');
    else if (mod === 'hbci_readout_core') select('rtl.readout');
  }, [mod, select]);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setNetlist(null);
    setPicked(null);
    setLineSel(null);
    setView({ x: 0, y: 0, k: 1 });
    if (!entry) return;
    void Promise.all([fetchText(`schematics/${entry.svg}`), fetchText(`schematics/${entry.netlist}`)]).then(([s, n]) => {
      if (cancelled) return;
      setSvg(s);
      try { setNetlist(n ? (JSON.parse(n) as YosysNetlist) : null); } catch { setNetlist(null); }
    });
    return () => { cancelled = true; };
  }, [entry?.svg, entry?.netlist]); // eslint-disable-line react-hooks/exhaustive-deps

  const nlMod = netlist && entry ? netlist.modules[pickModule(netlist, entry.module)] : null;
  const cells = nlMod?.cells ?? {};

  // Source line → cells mapping (from Yosys src attributes).
  const lineMap = useMemo(() => {
    const m = new Map<number, string[]>();
    Object.entries(cells).forEach(([name, c]) => {
      srcLines(c.attributes?.src).filter((l) => l.file.startsWith('rtl/')).forEach(({ line }) => {
        if (!m.has(line)) m.set(line, []);
        m.get(line)!.push(name);
      });
    });
    return m;
  }, [cells]);

  const highlighted = useMemo(() => {
    const s = new Set<string>();
    if (picked) s.add(picked);
    if (lineSel !== null) (lineMap.get(lineSel) ?? []).forEach((c) => s.add(c));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      Object.entries(cells).forEach(([n, c]) => {
        if (c.type.toLowerCase().includes(q) || describeCell(c.type).name.toLowerCase().includes(q)) s.add(n);
      });
    }
    return s;
  }, [picked, lineSel, query, lineMap, cells]);

  // Scale the schematic to fit the canvas.
  function fit() {
    const host = hostRef.current;
    const svgEl = host?.querySelector('svg');
    if (!host || !svgEl) return;
    const w = parseFloat(svgEl.getAttribute('width') ?? '') || svgEl.getBBox().width;
    const h = parseFloat(svgEl.getAttribute('height') ?? '') || svgEl.getBBox().height;
    const pad = 24;
    const k = Math.min(4, Math.max(0.1, Math.min((host.clientWidth - pad * 2) / w, (host.clientHeight - pad * 2) / h)));
    setView({ k, x: (host.clientWidth - w * k) / 2, y: (host.clientHeight - h * k) / 2 });
  }
  useEffect(() => {
    if (svg) requestAnimationFrame(fit);
  }, [svg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply highlight classes to the inline SVG.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('.gv-hl').forEach((el) => el.classList.remove('gv-hl'));
    host.querySelectorAll('.gv-dim').forEach((el) => el.classList.remove('gv-dim'));
    if (highlighted.size === 0) return;
    host.querySelectorAll('[id^="cell_"]').forEach((el) => {
      const name = el.id.slice(5);
      el.classList.add(highlighted.has(name) ? 'gv-hl' : 'gv-dim');
    });
  }, [highlighted, svg]);

  function onSvgClick(e: React.MouseEvent) {
    let el = e.target as Element | null;
    while (el && el !== hostRef.current) {
      if (el.id && el.id.startsWith('cell_')) {
        const name = el.id.slice(5);
        setPicked(name);
        setLineSel(null);
        setExplain(false);
        return;
      }
      el = el.parentElement;
    }
  }

  function onWheel(e: React.WheelEvent) {
    const r = hostRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k = Math.min(8, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
  }

  const pickedCell = picked ? cells[picked] : null;
  const pickedLines = pickedCell ? new Set(srcLines(pickedCell.attributes?.src).filter((l) => l.file.startsWith('rtl/')).map((l) => l.line)) : lineSel !== null ? new Set([lineSel]) : undefined;
  const typeHist = useMemo(() => {
    const h: Record<string, number> = {};
    Object.values(cells).forEach((c) => { h[c.type] = (h[c.type] ?? 0) + 1; });
    return Object.entries(h).sort((a, b) => b[1] - a[1]);
  }, [cells]);

  // Name the block these gates belong to: the selection if it is this module (hbci_timestamp has two instances),
  // else the first instance of this module in the v0.3 top, then in the legacy core.
  const selC = selectedId ? COMPONENTS[selectedId] : undefined;
  const instForMod = selC?.rtlModule === mod && selC.rtlInstance ? selC.rtlInstance
    : Object.keys(INSTANCE_MODULE_V03).find((k) => k !== '$raw' && INSTANCE_MODULE_V03[k] === mod) ?? Object.keys(INSTANCE_MODULE).find((k) => INSTANCE_MODULE[k] === mod);
  const modName = mod === 'hbci_event_core' ? BLOCK_NAMES['rtl.core'] : mod === 'hbci_readout_core' ? BLOCK_NAMES['rtl.readout']
    : instForMod ? BLOCK_NAMES[selC?.rtlModule === mod ? selectedId! : INST_TO_ID[instForMod]] : undefined;
  const gx = pickedCell ? explainGate(pickedCell.type) : null;

  if (loaded && !schematics) {
    return (
      <div className="gates"><div className="missing" style={{ margin: 40 }}>
        No synthesised schematics yet. Run <code>make artifacts</code> to synthesise the RTL with Yosys and export netlistsvg diagrams.
      </div></div>
    );
  }

  return (
    <div className="gates" data-testid="gates-view" data-module={mod ?? ''}>
      <div className="gates-main">
        <div className="gates-title">
          <div className="gates-name">
            <b>{modName?.friendly ?? mod}</b>
            <code>{instForMod ? `${instForMod} · ${mod}` : mod}</code>
          </div>
          <span className="gates-nt" title="No gate-level simulation was run. Values are known only at RTL ports (Level 1/2).">gate values: NO TRACE</span>
          <span style={{ flex: 1 }} />
          {modName && <button className="btn sm" onClick={() => useScene.getState().setLevel('module')} data-testid="gates-to-module">◀ Inside the block</button>}
          <button className="btn sm primary" onClick={() => { useMicro.getState().setCellTab('pdk'); useScene.getState().setLevel('cell'); }} data-testid="gates-to-cell"
            title="See one genuine SKY130 standard cell (from the v0.2 layout) and how transistors make a NAND">Next: a real standard cell ▶</button>
        </div>
        <div className="gates-bar">
          <EvidenceBadge e="SYNTH" />
          <select value={mod ?? ''} onChange={(e) => setGatesModule(e.target.value)} aria-label="Module">
            {modulesAvail.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="seg">
            <button className={kind === 'gates' ? 'on' : ''} onClick={() => setKind('gates')} title="After technology mapping to generic gates">Gates</button>
            <button className={kind === 'rtl' ? 'on' : ''} onClick={() => setKind('rtl')} title="Word-level RTL operators before mapping">RTL cells</button>
          </div>
          {candidates.length > 1 && (
            <label className="faint"><input type="checkbox" checked={preferReduced} onChange={(e) => setPreferReduced(e.target.checked)} /> reduced width</label>
          )}
          <input className="gates-search" placeholder="find cell type… (xor, dff, mux)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn sm" onClick={fit}>Fit</button>
          <span className="faint mono">{entry ? `${entry.cells} cells` : ''}</span>
        </div>
        {entry?.reduced && (
          <details className="warn-box gates-note" data-testid="gates-reduced-note">
            <summary>Reduced-width view: same Verilog, smaller numbers, so the drawing stays readable</summary>
            {entry.note ?? JSON.stringify(entry.params)}. Same RTL source, smaller widths.
          </details>
        )}
        {!entry?.reduced && entry?.note && <div className="gates-note faint">{entry.note}</div>}
        <div
          className="gates-canvas"
          ref={hostRef}
          onWheel={onWheel}
          onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
          onMouseMove={(e) => { if (drag.current) setView({ ...view, x: drag.current.vx + e.clientX - drag.current.x, y: drag.current.vy + e.clientY - drag.current.y }); }}
          onMouseUp={() => { drag.current = null; }}
          onMouseLeave={() => { drag.current = null; }}
          onClick={onSvgClick}
        >
          {svg ? (
            <div className="gates-svg" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="missing" style={{ margin: 40 }}>{entry ? 'Loading schematic…' : 'No schematic for this module/kind.'}</div>
          )}
        </div>
      </div>
      <div className="gates-side">
        <div className="cd-pad">
          <div className="cd-k">Selected cell</div>
          {pickedCell ? (
            <div className="gv-cell" data-testid="gate-cell">
              <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{picked}</div>
              <h3>{describeCell(pickedCell.type).name}</h3>
              <div className="mono cd-math">{pickedCell.type} · {describeCell(pickedCell.type).fn}</div>
              <div className="faint" style={{ fontSize: 11 }}>{isFlop(pickedCell.type) ? 'Storage element: holds one bit of state between clock edges.' : 'Combinational: output follows inputs within the same cycle.'}</div>
              <button className="btn sm" onClick={() => setExplain(!explain)} aria-expanded={explain} data-testid="explain-gate" style={{ alignSelf: 'flex-start', margin: '4px 0' }}>{explain ? 'Hide explanation' : 'Explain this gate'}</button>
              {explain && gx && (
                <div className="gv-explain" data-testid="gate-explain">
                  <p>{gx.plain}</p>
                  {gx.table && (
                    <table className="gv-tt">
                      <thead><tr>{gx.table.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>{gx.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j === r.length - 1 ? 'out' : ''}>{v}</td>)}</tr>)}</tbody>
                    </table>
                  )}
                  {gx.transistors && <p>{gx.transistors} <button className="linkish" onClick={() => { useMicro.getState().setCellTab('pdk'); useScene.getState().setLevel('cell'); }}>Go to Level 4 ▶</button></p>}
                  <p className="faint">Generic gate from Yosys technology mapping (SYNTH). These are not SKY130 cells, and no live value is available at gate level.</p>
                </div>
              )}
              <div className="cd-k">Pins</div>
              {Object.entries(pickedCell.connections ?? {}).map(([pin, bits]) => (
                <div key={pin} className="mono" style={{ fontSize: 11 }}>{pickedCell.port_directions?.[pin] === 'output' ? '→' : '←'} {pin}: net {bits.join(',')}</div>
              ))}
              <div className="cd-k">From source</div>
              <div className="mono faint" style={{ fontSize: 11 }}>{pickedCell.attributes?.src ?? 'no src attribute (introduced by optimisation)'}</div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>Click a gate or register in the schematic. Click a source line below to light up the gates synthesised from it.</div>
          )}
          <div className="cd-k">Cell types in this netlist</div>
          <div className="cd-hist">
            {typeHist.map(([t, n]) => (
              <button key={t} className={`chip${query === t ? ' on' : ''}`} onClick={() => setQuery(query === t ? '' : t)} title={describeCell(t).name}>{t.replace(/^\$_?|_$/g, '')} ×{n}</button>
            ))}
          </div>
          <div className="cd-k">Source → netlist mapping</div>
          <div className="gv-lines">
            {[...lineMap.entries()].sort((a, b) => a[0] - b[0]).map(([line, cs]) => (
              <button key={line} className={`gv-line${lineSel === line ? ' on' : ''}`} onClick={() => { setLineSel(lineSel === line ? null : line); setPicked(null); }}>
                <span className="mono">line {line}</span><span>{cs.length} cell{cs.length > 1 ? 's' : ''}</span>
              </button>
            ))}
            {lineMap.size === 0 && <div className="faint">No src attributes in this netlist.</div>}
          </div>
          {mod && <SourceView module={mod} highlightLines={pickedLines} maxHeight={360} />}
        </div>
      </div>
    </div>
  );
}
