// Level 4, tab (a): one genuine SKY130 standard cell. Polygons from the v0.2 layout's GDSII,
// transistors from the PDK SPICE netlist, a schematic derived from that netlist's connectivity.
import { useMemo, useState, type ReactNode } from 'react';
import { EvidenceBadge } from '../../ui/EvidenceBadge';
import { CellCanvas, LSTYLE, lkey, styleOf, type Hover } from './CellCanvas';
import { SpSchematic } from './SpSchematic';
import { deriveCell, describe, type CellDoc, type CellIndex, type Expr, type SpiceDevice } from './netlist';

export interface PdkState {
  pick: string | null;
  vis: Record<string, boolean>;
  showGates: boolean;
  showLabels: boolean;
}

export const DEFAULT_VIS: Record<string, boolean> = Object.fromEntries(Object.entries(LSTYLE).map(([k, s]) => [k, s.on]));
const BASIC = DEFAULT_VIS;

function Missing({ path, extra }: { path: string; extra?: string }) {
  return (
    <div className="cv-missing" role="alert" data-testid="cell-missing">
      <b>Missing artifact:</b> <code>{path}</code>
      {extra && <p>{extra}</p>}
      <p>Make it with <code>make cells</code> (runs <code>/usr/bin/python3 -I scripts/extract_cells.py</code>). It reads the v0.2 layout
        {' '}<code>studio/public/artifacts/layout/hbci_event_core.gds.gz</code> (from <code>make layout</code>) and, for layer names and
        transistors, the SKY130 PDK inside the hbci-eda VM (start it with <code>make eda-vm</code>).</p>
    </div>
  );
}

const maxFingers = (e: Expr): number => (e.k === 'dev' ? e.names.length : Math.max(...e.items.map(maxFingers)));
const um = (v: number | null) => (v === null ? 'n/a' : v.toFixed(2));
const typeName = (d: SpiceDevice) => (d.type === 'p' ? 'PMOS' : d.type === 'n' ? 'NMOS' : '?');

export function PdkCell({ index, doc, docMissing, st, set }: {
  index: CellIndex | null | 'missing';
  doc: CellDoc | null | 'missing';
  docMissing: string | null;
  st: PdkState;
  set: (p: Partial<PdkState>) => void;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const [hl, setHl] = useState<string | null>(null);
  const spice = doc && doc !== 'missing' && doc.spice !== 'unavailable' ? doc.spice : null;
  const der = useMemo(() => (spice ? deriveCell(spice) : null), [spice]);

  return (
    <div className="cv-body" data-testid="cell-pdk">
      <div className="cv-caution" role="note" data-testid="cell-caution">
        <span aria-hidden="true" className="cv-caution-i">!</span>
        <span><b>One standard cell. Not the layout of the v0.3 die (none exists).</b> These are the real polygons of a SKY130 cell as stored
          {' '}in the v0.2 event core&apos;s final GDSII.</span>
        <EvidenceBadge e="LAYOUT" />
      </div>

      {index === 'missing' && <Missing path="studio/public/artifacts/cells/index.json" />}
      {index === null && <p className="cv-loading">Loading cell data…</p>}
      {index && index !== 'missing' && (
        <>
          <div className="cv-pickrow">
            <span className="cv-k">Cell</span>
            <div className="cv-seg" role="radiogroup" aria-label="Standard cell">
              {index.cells.map((c) => (
                <button
                  key={c.cell}
                  role="radio"
                  aria-checked={st.pick === c.cell}
                  className={`seg-btn cv-segbtn${st.pick === c.cell ? ' on' : ''}`}
                  onClick={() => { set({ pick: c.cell }); setHover(null); setHl(null); }}
                  data-testid={`cell-pick-${c.short_name}`}
                >
                  <b>{c.short_name}</b> <code>{c.cell}</code>
                </button>
              ))}
            </div>
            {doc && doc !== 'missing' && (
              <span className="cv-facts">
                <b>{doc.size_um.width.toFixed(2)} µm</b> wide × <b>{doc.size_um.height.toFixed(2)} µm</b> tall
                {' · '}used <b>{doc.instances_in_v02_design.count}×</b> in the v0.2 event core
              </span>
            )}
          </div>

          {doc === 'missing' && <Missing path={`studio/public/artifacts/cells/${docMissing ?? '?'}`} />}
          {doc === null && <p className="cv-loading">Loading {st.pick}…</p>}
          {doc && doc !== 'missing' && (
            <>
              <div className="cv-grid">
                <section className="cv-card" aria-label="Cell polygons">
                  <h3>Real polygons from the GDSII <EvidenceBadge e="LAYOUT" /></h3>
                  <CellCanvas doc={doc} vis={st.vis} showGates={st.showGates} showLabels={st.showLabels} hover={hover} setHover={setHover} />
                  <HoverInfo doc={doc} hover={hover} />
                  <LayerToggles doc={doc} st={st} set={set} />
                </section>

                <section className="cv-card" aria-label="Transistors">
                  <h3>How polygons make transistors</h3>
                  <p>Where a red <b>polysilicon</b> strip crosses green <b>diffusion</b>, it makes a transistor: the strip is the gate, and the
                    diffusion on each side becomes source and drain. Transistors inside the <b>n-well</b> (dark-green outline) are PMOS; the
                    others sit on p-type silicon and are NMOS. The blue layers are wires, and the small crossed squares are contacts between layers.</p>
                  <GateCheck doc={doc} />

                  <h3>Transistors in the PDK netlist</h3>
                  {spice ? (
                    <>
                      <div className="cv-tablewrap">
                        <table className="cv-table" data-testid="cell-transistors">
                          <thead><tr><th>Device</th><th>Type</th><th>Gate</th><th>Channel between</th><th>W × L (µm)</th></tr></thead>
                          <tbody>
                            {[...spice.devices].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'p' ? -1 : 1)).map((d) => (
                              <tr key={d.name} onPointerEnter={() => setHl(d.name)} onPointerLeave={() => setHl(null)} className={hl === d.name ? 'hl' : ''}>
                                <td><code>{d.name}</code></td>
                                <td className="cv-tycell"><span className={`cv-ty ${d.type}`}>{typeName(d)}</span> <code className="cv-model" title={d.model}>{d.model.replace('sky130_fd_pr__', '')}</code></td>
                                <td><code>{d.g}</code></td>
                                <td><code>{d.d}</code> ↔ <code>{d.s}</code></td>
                                <td className="num">{um(d.w_um)} × {um(d.l_um)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="cv-small">Body (bulk) connections: {der?.bulks.map((b) => `${b.type === 'p' ? 'PMOS' : 'NMOS'} → ${b.net}`).join(', ')}.
                        {' '}Pins: <code>{spice.pins.join(' ')}</code>. Values from <code>{spice.subckt_header.split(/\s+/)[1]}</code> in the PDK SPICE file; units: {spice.unit_rule}</p>
                    </>
                  ) : (
                    <div className="cv-missing">Transistor list unavailable: {doc.spice_unavailable_reason ?? 'the PDK SPICE file could not be read'}. Run <code>make eda-vm</code>, then <code>make cells</code>.</div>
                  )}

                  {spice && der && (
                    <>
                      <h3>Schematic derived from the netlist</h3>
                      {der.ok && der.pu && der.pd ? (
                        <>
                          <div className="cv-schwrap">
                            <SpSchematic pu={der.pu} pd={der.pd} top={der.power} bottom={der.ground} out={der.output} hl={hl} showNames nodeLabels
                              title={`Transistor schematic of ${doc.cell} derived from the PDK SPICE netlist`} />
                          </div>
                          <ul className="cv-derived">
                            <li><b>Pull-up</b> ({der.power} → {der.output}): {describe(der.pu)}.</li>
                            <li><b>Pull-down</b> ({der.output} → {der.ground}): {describe(der.pd)}{der.pd.k === 'ser' && der.pd.nodes.length ? `, joined at internal net ${der.pd.nodes.join(', ')}` : ''}.</li>
                            {(maxFingers(der.pu) > 1 || maxFingers(der.pd) > 1) && (
                              <li><b>×{Math.max(maxFingers(der.pu), maxFingers(der.pd))} fingers</b>: transistors with the same gate and the same connections, side by side. They act as one wider transistor, which is how the <code>_2</code> (drive strength 2) cells get more current.</li>
                            )}
                          </ul>
                          <TruthLine der={der} />
                          <p className="cv-small">Computed in the browser from the SPICE connectivity: parallel devices share both channel nets, series devices
                            {' '}meet at a net used by nothing else. Treating each MOSFET as an ideal switch gives the logic only, not timing.</p>
                        </>
                      ) : (
                        <p className="cv-missing">Not drawn: {der.reason}.</p>
                      )}
                    </>
                  )}
                </section>
              </div>
              <Provenance doc={doc} index={index} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function HoverInfo({ doc, hover }: { doc: CellDoc; hover: Hover }) {
  let body: ReactNode = <span className="muted">Hover a shape to see its layer. Drag to pan; + and − zoom; double-click to fit.</span>;
  if (hover?.kind === 'poly') {
    const l = doc.layers.find((x) => lkey(x) === hover.key);
    const pts = l?.polygons[hover.i];
    if (l && pts) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      body = (
        <>
          <b>{l.lyp_name ?? `${l.layer}/${l.datatype}`}</b> — {styleOf(l).plain || `${l.name} ${l.purpose}`}
          <span className="cv-hspan"> Shape {hover.i + 1} of {l.polygons.length}: x {Math.min(...xs).toFixed(3)}–{Math.max(...xs).toFixed(3)} µm,
            {' '}y {Math.min(...ys).toFixed(3)}–{Math.max(...ys).toFixed(3)} µm{l.from_paths ? ' (stored as GDS PATH, drawn with its width)' : ''}.</span>
        </>
      );
    }
  } else if (hover?.kind === 'gate') {
    const g = doc.gate_regions_derived?.regions?.[hover.i];
    if (g) {
      body = (
        <>
          <b>Transistor gate</b> (derived from the polygons): poly over diffusion {g.in_nwell ? 'inside the n-well → PMOS' : 'outside the n-well → NMOS'}.
          <span className="cv-hspan"> W {g.w_um.toFixed(2)} µm × L {g.l_um.toFixed(2)} µm{g.implant ? `; ${g.implant === 'psdm' ? 'p+' : 'n+'} implant (${g.implant})` : ''}{g.under_hvtp ? '; under hvtp' : ''}.</span>
        </>
      );
    }
  }
  return <div className="cv-hover" data-testid="cell-hover">{body}</div>;
}

function LayerToggles({ doc, st, set }: { doc: CellDoc; st: PdkState; set: (p: Partial<PdkState>) => void }) {
  const layers = [...doc.layers].sort((a, b) => styleOf(a).z - styleOf(b).z);
  const hasGates = doc.gate_regions_derived?.status === 'ok';
  const all = Object.fromEntries(doc.layers.map((l) => [lkey(l), true]));
  return (
    <div className="cv-layers" data-testid="cell-layers">
      <div className="cv-layers-h">
        <span className="cv-k">Layers in this cell ({layers.length})</span>
        <button className="btn sm" onClick={() => set({ vis: { ...st.vis, ...BASIC } })}>Basic</button>
        <button className="btn sm" onClick={() => set({ vis: { ...st.vis, ...all } })}>All</button>
      </div>
      <div className="cv-chips">
        {layers.map((l) => {
          const k = lkey(l);
          const s = styleOf(l);
          // swatches sit on the canvas colour so light layer colours stay visible in the light theme
          const sw = s.kind === 'fill'
            ? { background: `linear-gradient(${s.color}, ${s.color}), #0d1117`, opacity: 0.9 }
            : { background: '#0d1117', border: `2px ${s.kind === 'contact' ? 'solid' : 'dashed'} ${s.color}` };
          return (
            <label key={k} className={`cv-chip${st.vis[k] ? ' on' : ''}`} title={`${l.lyp_name ?? k}: ${s.plain}`}>
              <input type="checkbox" checked={!!st.vis[k]} onChange={(e) => set({ vis: { ...st.vis, [k]: e.target.checked } })} />
              <i className="cv-sw" style={sw} />
              <span>{s.short}</span>
              <code>{k}</code>
            </label>
          );
        })}
      </div>
      <div className="cv-chips">
        {hasGates && (
          <label className={`cv-chip${st.showGates ? ' on' : ''}`} title="Poly overlapping diffusion, computed by scripts/extract_cells.py from the polygons (not an LVS extraction)">
            <input type="checkbox" checked={st.showGates} onChange={(e) => set({ showGates: e.target.checked })} />
            <i className="cv-sw" style={{ border: '2px solid #fde047', background: 'rgba(253,224,71,.25)' }} />
            <span>transistor gates</span><code>derived: poly ∩ diff</code>
          </label>
        )}
        <label className={`cv-chip${st.showLabels ? ' on' : ''}`} title="Pin names from the GDS TEXT records on the *.label layers">
          <input type="checkbox" checked={st.showLabels} onChange={(e) => set({ showLabels: e.target.checked })} />
          <i className="cv-sw" style={{ background: '#ffffff', borderRadius: '50%', width: 10, height: 10 }} />
          <span>pin labels</span><code>GDS TEXT</code>
        </label>
      </div>
    </div>
  );
}

function GateCheck({ doc }: { doc: CellDoc }) {
  const c = doc.gate_vs_spice;
  const g = doc.gate_regions_derived;
  if (!c || !g || g.status !== 'ok') {
    return <p className="cv-small">Geometry check not available{g?.reason ? `: ${g.reason}` : ''}.</p>;
  }
  const sz = (s: number[][]) => s.map(([w, l]) => `W ${w.toFixed(2)} × L ${l.toFixed(2)} µm`).join(', ');
  return (
    <div className={`cv-check${c.all_match ? ' ok' : ' bad'}`} data-testid="cell-gate-check">
      <b>{c.all_match ? 'Check passed' : 'Check failed'}:</b> the polygons contain {c.p.geometry.count} poly-over-diffusion regions inside the n-well
      {' '}({sz(c.p.geometry.sizes_um)}) and {c.n.geometry.count} outside it ({sz(c.n.geometry.sizes_um)}). The PDK netlist lists
      {' '}{c.p.spice.count} PMOS ({sz(c.p.spice.sizes_um)}) and {c.n.spice.count} NMOS ({sz(c.n.spice.sizes_um)}){c.all_match ? ': they match.' : ': they do not match.'}
      <span className="cv-small"> Derived by the extraction script from the shapes (yellow outlines); it is not an LVS run and does not say which region is which device.</span>
    </div>
  );
}

function TruthLine({ der }: { der: ReturnType<typeof deriveCell> }) {
  return (
    <div className="cv-truth">
      <span className="cv-k">Switch-level reading</span>
      <table className="cv-table cv-tt">
        <thead><tr>{der.inputs.map((i) => <th key={i}>{i}</th>)}<th>{der.output}</th></tr></thead>
        <tbody>{der.truth.map((t, i) => <tr key={i}>{der.inputs.map((p) => <td key={p}>{t.v[p]}</td>)}<td><b>{t.y}</b></td></tr>)}</tbody>
      </table>
      {der.func && <span className="cv-func">{der.func}</span>}
    </div>
  );
}

function Provenance({ doc, index }: { doc: CellDoc; index: CellIndex }) {
  const s = doc.source;
  const ln = doc.layer_names_source;
  const sp = doc.spice !== 'unavailable' ? doc.spice : null;
  const inst = doc.instances_in_v02_design;
  return (
    <details className="cv-prov" data-testid="cell-provenance">
      <summary>Provenance: where every shape and number comes from</summary>
      <dl>
        <div><dt>Geometry</dt><dd>Structure <code>{s.structure}</code> in <code>{s.gds}</code> (final GDSII of the v0.2 event-core place-and-route).
          {' '}sha256 of the .gz: <code className="cv-hash">{s.gds_gz_sha256}</code>; of the GDSII stream: <code className="cv-hash">{s.gds_stream_sha256}</code>.</dd></div>
        <div><dt>Units</dt><dd>1 database unit = {doc.gds_units.um_per_dbu} µm (GDS UNITS record); {doc.gds_units.rounding}. Size from {doc.bbox_source}.</dd></div>
        <div><dt>Used in v0.2</dt><dd>{inst.count} instances in top structure <code>{inst.top_structure}</code>, out of {inst.all_cell_instances_in_top.toLocaleString('en-GB')} cell
          {' '}instances in its GDS{inst.fill_decap_tap_instances_in_top !== undefined ? ` (${inst.fill_decap_tap_instances_in_top.toLocaleString('en-GB')} of them filler, decap or well-tap cells)` : ''}. {inst.method}.
          {' '}This count is for the v0.2 event-core layout; the v0.3 and v0.4 layouts are separate runs (Physical layout level).</dd></div>
        <div><dt>PDK</dt><dd>{s.pdk}, open_pdks <code>{s.open_pdks_rev}</code>, library <code>{s.scl}</code>. Licence: {s.licence}.</dd></div>
        <div><dt>Layer names</dt><dd>{typeof ln === 'string' ? ln : <>{ln.file} (sha256 <code className="cv-hash">{ln.sha256}</code>). Colours here follow the studio, not the PDK file.</>}</dd></div>
        <div><dt>Transistors</dt><dd>{sp ? <>{sp.file} (sha256 <code className="cv-hash">{sp.sha256}</code>), <code>{sp.subckt_header}</code>. {sp.terminal_order}.</> : `unavailable: ${doc.spice_unavailable_reason ?? ''}`}</dd></div>
        <div><dt>Derived here</dt><dd>Gate regions (poly ∩ diff) and the schematic are computed from the data above; they are labelled “derived”.</dd></div>
        <div><dt>Extracted</dt><dd><code>{s.extracted_by}</code> at {s.extracted_at}. Rebuild with <code>make cells</code>. Index generated {index.generated_at}.</dd></div>
      </dl>
      {sp && (
        <>
          <div className="cv-k">PDK SPICE subcircuit (verbatim)</div>
          <pre className="cv-pre">{sp.subckt_text.join('\n')}</pre>
        </>
      )}
    </details>
  );
}
