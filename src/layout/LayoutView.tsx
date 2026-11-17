import { useEffect, useMemo, useState } from 'react';
import { useMicro } from '../micro/microStore';
import { useScene } from '../state/sceneStore';
import { cssVar } from '../model/theme';
import { useArtifacts } from '../artifacts/load';
import type { CheckStatus, LayoutSummary } from '../artifacts/types';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { GdsViewer } from './GdsViewer';
import { INSTANCE_MODULE, INSTANCES } from '../circuit/rtlGraph';
import { COMPONENTS, INSTANCE_TO_ID } from '../model/components';

// v0.1 generic-synthesis cell counts, used only if synth_stats.json is missing.
const FALLBACK_CELLS: Record<string, number> = {
  hbci_channel_state: 803, hbci_baseline_ema: 479, hbci_threshold_detector: 332,
  hbci_timestamp: 188, hbci_event_packer: 149, hbci_refractory_ctrl: 44,
};

interface Rect { inst: string; x: number; y: number; w: number; h: number; cells: number }

/** Slice-and-dice treemap: alternating rows/columns proportional to cell count. */
function treemap(items: { inst: string; cells: number }[], x: number, y: number, w: number, h: number, vertical = true): Rect[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  const total = items.reduce((a, b) => a + b.cells, 0);
  let acc = 0;
  let split = 0;
  while (split < items.length - 1 && acc + items[split].cells <= total / 2) acc += items[split++].cells;
  if (split === 0) { acc = items[0].cells; split = 1; }
  const f = acc / total;
  const a = items.slice(0, split);
  const b = items.slice(split);
  return vertical
    ? [...treemap(a, x, y, w * f, h, !vertical), ...treemap(b, x + w * f, y, w * (1 - f), h, !vertical)]
    : [...treemap(a, x, y, w, h * f, !vertical), ...treemap(b, x, y + h * f, w, h * (1 - f), !vertical)];
}

export function LayoutView() {
  const setViewEvidence = useScene((s) => s.setViewEvidence);
  const select = useScene((s) => s.select);
  const selectedId = useScene((s) => s.selectedId);
  const synth = useArtifacts((a) => a.synth);
  const sky = useArtifacts((a) => a.sky130);
  const skyV04 = useArtifacts((a) => a.sky130V04);
  // Non-null only for a completed flow with a rendered GDS (see artifacts/load.ts).
  const layout = useArtifacts((a) => a.layout);
  const layoutV04 = useArtifacts((a) => a.layoutV04);
  const layoutV03 = useArtifacts((a) => a.layoutV03);
  const picked = useMicro((m) => m.layoutTab);
  const setPicked = useMicro((m) => m.setLayoutTab);
  const tab = picked === 'layout_v04' ? (layoutV04 ? 'layout_v04' : 'concept') : picked === 'layout_v03' ? (layoutV03 ? 'layout_v03' : 'concept') : picked === 'layout' ? (layout ? 'layout' : 'concept') : 'concept';
  const ART3 = `${import.meta.env.BASE_URL}artifacts/layout_v03/`;
  const ART4 = `${import.meta.env.BASE_URL}artifacts/layout_v04/`;
  const shown = tab === 'layout_v04' ? layoutV04 : tab === 'layout_v03' ? layoutV03 : tab === 'layout' ? layout : null;
  const shownArt = tab === 'layout_v04' ? ART4 : tab === 'layout_v03' ? ART3 : ART;

  useEffect(() => setViewEvidence(tab === 'concept' ? 'CONCEPT' : 'LAYOUT'), [tab, setViewEvidence]);

  const items = useMemo(() => INSTANCES.map((inst) => {
    const mod = INSTANCE_MODULE[inst];
    const real = synth?.modules.find((m) => m.module === mod)?.cells;
    return { inst, cells: real ?? FALLBACK_CELLS[mod] };
  }).sort((a, b) => b.cells - a.cells), [synth]);

  const D = 520;
  const core = 40;
  const rects = treemap(items, core, core, D - 2 * core, D - 2 * core);
  const total = items.reduce((a, b) => a + b.cells, 0);
  const selInst = selectedId ? COMPONENTS[selectedId]?.rtlInstance : undefined;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 380px' }} data-testid="layout-view">
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="gates-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--line-soft)' }}>
          <div className="seg">
            <button className={tab === 'concept' ? 'on' : ''} onClick={() => setPicked('concept')}>Conceptual floorplan</button>
            <button className={tab === 'layout' ? 'on' : ''} onClick={() => setPicked('layout')} disabled={!layout}
              data-testid="tab-genuine-layout"
              title={layout ? 'Placed-and-routed SKY130 HD layout of the v0.2 event core from the LibreLane flow (not the v0.4 chip)' : 'Unavailable: no PDK place-and-route flow has completed (run make layout)'}>
              Genuine layout v0.2 event core (GDSII)
            </button>
            <button className={tab === 'layout_v03' ? 'on' : ''} onClick={() => setPicked('layout_v03')} disabled={!layoutV03}
              data-testid="tab-genuine-layout-v03"
              title={layoutV03 ? 'Placed-and-routed SKY130 HD layout of the v0.3 readout core (DSP only, no decoder) from the LibreLane flow: not the v0.4 chip' : 'No v0.3 readout-core layout artifact (artifacts/layout_v03/)'}>
              Genuine layout v0.3 readout core (GDSII)
            </button>
            <button className={tab === 'layout_v04' ? 'on' : ''} onClick={() => setPicked('layout_v04')} disabled={!layoutV04}
              data-testid="tab-genuine-layout-v04"
              title={layoutV04 ? `Placed-and-routed layout of ${layoutV04.design} (v0.4) from the LibreLane flow` : 'No layout for v0.4 yet: the LibreLane run of hbci02_chip_top (physical/) has not been published to artifacts/layout_v04/'}>
              Genuine layout v0.4 chip {layoutV04 ? '(GDSII)' : '— none yet'}
            </button>
          </div>
          <EvidenceBadge e={tab === 'concept' ? 'CONCEPT' : 'LAYOUT'} />
          {tab === 'layout' && layout && <span className="faint" style={{ fontSize: 11 }}>v0.2 · {layout.pdk.name} · {layout.pdk.scl} · {layout.flow.name} · run {layout.flow.run_tag}</span>}
          {tab === 'layout_v03' && layoutV03 && <span className="faint" style={{ fontSize: 11 }}>v0.3 {layoutV03.design} · {layoutV03.pdk.name} · {layoutV03.pdk.scl} · {layoutV03.flow.name} · run {layoutV03.flow.run_tag}</span>}
          {tab === 'layout_v04' && layoutV04 && <span className="faint" style={{ fontSize: 11 }}>v0.4 {layoutV04.design} · {layoutV04.pdk.name} · {layoutV04.pdk.scl} · {layoutV04.flow.name} · run {layoutV04.flow.run_tag}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => { useMicro.getState().setCellTab('pdk'); useScene.getState().setLevel('cell'); }} title="Zoom into one genuine SKY130 standard cell from this layout" data-testid="layout-to-cell">One standard cell ▶</button>
        </div>
        <div className="layout-scope" data-testid="layout-scope">
          <b>{tab === 'layout' ? 'PHYSICAL LAYOUT: v0.2 EVENT CORE ONLY' : tab === 'layout_v03' ? 'PHYSICAL LAYOUT: v0.3 READOUT CORE ONLY (NO DECODER)' : tab === 'layout_v04' ? `PHYSICAL LAYOUT: v0.4 ${layoutV04?.design ?? 'hbci02_chip_top'}` : 'CONCEPTUAL FLOORPLAN: NOT A LAYOUT'}</b>
          <span>{tab === 'layout'
            ? 'This is the placed-and-routed v0.2 spike-event core (hbci_event_core) only. '
            : tab === 'layout_v03'
              ? 'This is the placed-and-routed v0.3 readout core (hbci_readout_core: DSP, records, RAW path) only; it contains no AI decoder. '
            : tab === 'layout_v04'
              ? 'This is the placed-and-routed v0.4 chip top from the LibreLane flow under physical/. Not fabricated. '
              : 'Box sizes come from generic gate counts of the v0.2 event-core blocks; nothing here is placed or routed. '}
            {tab !== 'layout_v04' && (layoutV04
              ? <>The v0.4 chip (hbci02_chip_top) has its own tab: <b>Genuine layout v0.4 chip</b>.</>
              : <>The v0.4 chip (DSP core + on-chip AI decoder + register file + BIST): <b className="layout-na">NO LAYOUT FOR v0.4 YET</b> the LibreLane run of hbci02_chip_top is in progress (physical/, docs/PHYSICAL.md) and has not been published to artifacts/layout_v04/, so none is drawn.</>)}</span>
        </div>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 0, padding: 16 }}>
          {tab === 'concept' ? (
            <svg viewBox={`0 0 ${D} ${D}`} style={{ width: '100%', height: '100%', maxWidth: 720 }} aria-label="Conceptual floorplan">
              <defs>
                <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="8" stroke={cssVar('--ev-concept')} strokeOpacity="0.12" strokeWidth="3" />
                </pattern>
              </defs>
              <rect x={4} y={4} width={D - 8} height={D - 8} rx={6} fill={cssVar('--surface-sunken')} stroke={cssVar('--ev-concept')} strokeDasharray="6 4" />
              {Array.from({ length: 40 }, (_, k) => {
                const side = Math.floor(k / 10);
                const p = 30 + (k % 10) * ((D - 60) / 9);
                const [x, y] = side === 0 ? [p, 12] : side === 1 ? [D - 20, p] : side === 2 ? [p, D - 20] : [12, p];
                return <rect key={k} x={x - 4} y={y - 4} width={8} height={8} fill={cssVar('--copper')} opacity={0.5} />;
              })}
              {rects.map((r) => {
                const id = INSTANCE_TO_ID[r.inst];
                const on = selInst === r.inst;
                return (
                  <g key={r.inst} onClick={() => select(id)} style={{ cursor: 'pointer' }}>
                    <rect x={r.x + 3} y={r.y + 3} width={r.w - 6} height={r.h - 6} rx={4}
                      fill={on ? cssVar('--accent-soft') : cssVar('--surface-panel')} stroke={on ? cssVar('--accent') : cssVar('--info')} strokeWidth={on ? 2 : 1} />
                    <rect x={r.x + 3} y={r.y + 3} width={r.w - 6} height={r.h - 6} rx={4} fill="url(#hatch)" />
                    <text x={r.x + 10} y={r.y + 22} fill={cssVar('--fg')} fontSize={Math.min(14, r.w / 10)} fontFamily="SF Mono, Menlo, monospace">{r.inst}</text>
                    <text x={r.x + 10} y={r.y + 38} fill={cssVar('--fg-secondary')} fontSize={Math.min(11, r.w / 12)}>{r.cells} cells · {((r.cells / total) * 100).toFixed(0)}%</text>
                  </g>
                );
              })}
              <text x={D / 2} y={D - 30} textAnchor="middle" fill={cssVar('--ev-concept')} fontSize={11}>CONCEPT · relative areas from generic cell counts · not placed, not routed</text>
            </svg>
          ) : shown ? (
            <GenuineLayout L={shown} art={shownArt} />
          ) : (
            <div className="missing" style={{ maxWidth: 560, textAlign: 'left' }} data-testid="layout-unavailable">
              <h3 style={{ marginTop: 0 }}>Genuine layout unavailable</h3>
              <p>No placed-and-routed layout has been exported. Showing one would mean inventing silicon geometry, so this view stays empty until a real flow produces GDSII.</p>
              <p className="muted">Run <span className="mono">make layout</span> (LibreLane on SKY130 HD in a Lima VM, see docs/PHYSICAL.md). The tab enables itself once <span className="mono">artifacts/layout/layout_summary.json</span> exists for a completed run.</p>
            </div>
          )}
        </div>
      </div>
      <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--surface-panel)', overflow: 'auto', padding: '12px 14px', fontSize: 'var(--fs-small)' }}>
        <div className="panel-title" style={{ padding: 0 }}>Physical design status</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <tbody>
            {statusRows(!!synth, !!(sky || skyV04), tab === 'concept' ? layout : shown, tab === 'layout_v04').map(([k, v, e]) => (
              <tr key={k}><td style={{ padding: '3px 0' }}>{k}</td><td className={v === 'done' || v === 'clean' || v === 'met' ? '' : 'faint'} style={{ color: STATUS_COLOR[v] }}>{v}</td><td className="mono faint">{e}</td></tr>
            ))}
          </tbody>
        </table>
        {shown && <LayoutMetrics L={shown} art={shownArt} />}
        {skyV04 && (
          <div style={{ border: '1px solid var(--ev-synth)', background: 'color-mix(in srgb, var(--ev-synth) 7%, var(--surface-panel))', borderRadius: 8, padding: '8px 10px', margin: '10px 0' }} data-testid="sky130-panel-v04">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}><EvidenceBadge e="SYNTH" /> <b>v0.4 hbci02_digital_top · SKY130 technology mapping</b></div>
            <div className="mono" style={{ fontSize: 11 }}>{skyV04.library} ({skyV04.corner})</div>
            <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>{skyV04.cells.toLocaleString()} standard cells · {skyV04.flops.toLocaleString()} flip-flops</div>
            <div className="mono" style={{ fontSize: 12 }}>{Math.round(skyV04.cell_area_um2).toLocaleString()} µm² cell area ({(skyV04.cell_area_um2 / 1e6).toFixed(4)} mm²)</div>
            <div className="mono faint" style={{ fontSize: 11 }}>of which sequential {Math.round(skyV04.sequential_area_um2).toLocaleString()} µm² · decoder alone 10,707 cells / 114,351 µm² (docs/ARCHITECTURE.md)</div>
            <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>{skyV04.note}</p>
          </div>
        )}
        {sky && (
          <div style={{ border: '1px solid var(--ev-synth)', background: 'color-mix(in srgb, var(--ev-synth) 7%, var(--surface-panel))', borderRadius: 8, padding: '8px 10px', margin: '10px 0' }} data-testid="sky130-panel">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}><EvidenceBadge e="SYNTH" /> <b>v0.2 event core · SKY130 technology mapping</b></div>
            <div className="mono" style={{ fontSize: 11 }}>{sky.library} ({sky.corner})</div>
            <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>{sky.cells} standard cells · {sky.flops} flip-flops</div>
            <div className="mono" style={{ fontSize: 12 }}>{sky.cell_area_um2.toLocaleString()} µm² cell area ({(sky.cell_area_um2 / 1e6).toFixed(4)} mm²)</div>
            <div className="mono faint" style={{ fontSize: 11 }}>of which sequential {sky.sequential_area_um2.toLocaleString()} µm²</div>
            <div className="cd-hist" style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
              {Object.entries(sky.cell_types).slice(0, 8).map(([k, v]) => <span key={k} className="chip" title={k}>{k.replace('sky130_fd_sc_hd__', '')} ×{v}</span>)}
            </div>
            <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>{sky.note}</p>
            <p className="faint" style={{ fontSize: 10, marginBottom: 0 }}>Library: {sky.library_source} · sha256 {sky.library_sha256.slice(0, 12)}…</p>
          </div>
        )}
        <p className="muted">Generic synthesis gives gate counts only. It does not establish timing closure, power, silicon area or fabrication readiness.</p>
        {shown ? (
          <p className="faint">Not covered by this layout: foundry sign-off, {tab === 'layout_v04' ? '' : 'an I/O ring or padframe, '}packaging, a routed-netlist gate-level simulation, or measured silicon. Nothing has been fabricated.</p>
        ) : (
          <p className="faint">Next physical milestone: run <span className="mono">make layout</span> (LibreLane on SKY130 HD: floorplan → placement → CTS → routing → DRC/LVS), then inspect the GDSII in KLayout.</p>
        )}
        {!layoutV04 && <p className="faint" data-testid="layout-v04-missing">v0.4 (hbci02_chip_top): no layout published yet. The status rows above describe {tab === 'layout' ? 'the v0.2 event core' : tab === 'layout_v03' ? 'the v0.3 readout core' : 'the v0.4 chip (SYNTH only)'}.</p>}
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string | undefined> = {
  done: 'var(--green)', clean: 'var(--green)', met: 'var(--green)', violations: 'var(--red)', 'not met': 'var(--amber)',
};

function statusRows(synth: boolean, sky: boolean, L: LayoutSummary | null, _v04 = false): [string, string, string][] {
  const ran = !!L;
  const signoff = L && L.checks.drc.status === 'pass' && L.checks.lvs.status === 'pass' && L.checks.antenna.status === 'pass';
  return [
    ['RTL simulation', 'done', 'RTL'],
    ['Generic synthesis (Yosys)', synth ? 'done' : 'pending', 'SYNTH'],
    ['PDK cell mapping (SKY130 HD)', sky ? 'done' : 'not run', sky ? 'SYNTH' : '—'],
    ['Floorplan / placement', ran ? 'done' : 'not run', ran ? 'LAYOUT' : '—'],
    ['Clock-tree synthesis', ran ? 'done' : 'not run', ran ? 'LAYOUT' : '—'],
    ['Routing', ran ? 'done' : 'not run', ran ? 'LAYOUT' : '—'],
    ['DRC / LVS / antenna', L ? (signoff ? 'clean' : 'violations') : 'not run', ran ? 'LAYOUT' : '—'],
    [L ? `Timing @ ${fmt(L.constraints.clock_mhz, 0)} MHz, all corners` : 'Static timing (STA)', L ? (L.checks.timing.status === 'pass' ? 'met' : 'not met') : 'not run', ran ? 'LAYOUT' : '—'],
    ['Fabrication', 'not planned', '—'],
  ];
}

function fmt(v: number | null | undefined, d = 2): string {
  return v === null || v === undefined ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

function powerRange(L: LayoutSummary): string | null {
  const e = Object.entries(L.power.by_corner_mw);
  if (e.length < 2) return null;
  const lo = e.reduce((a, b) => (b[1] < a[1] ? b : a));
  const hi = e.reduce((a, b) => (b[1] > a[1] ? b : a));
  return `range over ${e.length} corners: ${fmt(lo[1], 2)} mW (${lo[0]}) to ${fmt(hi[1], 2)} mW (${hi[0]})`;
}

function signed(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
}

function slackColor(v: number | null): string | undefined {
  return v !== null && v < 0 ? 'var(--red)' : undefined;
}

function Check({ label, status, detail }: { label: string; status: CheckStatus; detail: string }) {
  const c = status === 'pass' ? 'var(--green)' : status === 'fail' ? 'var(--red)' : 'var(--text-faint)';
  return (
    <tr>
      <td style={{ padding: '2px 0' }}>{label}</td>
      <td style={{ color: c, fontWeight: 600 }}>{status}</td>
      <td className="mono faint" style={{ fontSize: 11 }}>{detail}</td>
    </tr>
  );
}

const ART = `${import.meta.env.BASE_URL}artifacts/layout/`;

function GenuineLayout({ L, art }: { L: LayoutSummary; art: string }) {
  const [idx, setIdx] = useState(0);
  const img = L.images[Math.min(idx, L.images.length - 1)];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', height: '100%', minHeight: 0 }} data-testid="layout-genuine">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="seg">
          {L.images.map((im, i) => (
            <button key={im.file} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} title={im.caption}>{im.caption.split(':')[0]}</button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 11 }}>{img.caption}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GdsViewer image={img} src={art + img.file} />
      </div>
      <div className="faint" style={{ fontSize: 11 }}>
        LAYOUT · rendered in batch mode by {L.tools.klayout ?? 'KLayout'} straight from the final GDSII ({L.design}.gds); pixels are not retouched ·
        die {fmt(L.die.width_um, 1)} × {fmt(L.die.height_um, 1)} µm · not fabricated
      </div>
    </div>
  );
}

function LayoutMetrics({ L, art = ART }: { L: LayoutSummary; art?: string }) {
  const t = L.timing;
  const C = L.checks;
  const worst = t.corners.reduce<null | (typeof t.corners)[number]>((w, c) => (c.setup_ws_ns !== null && (w === null || (w.setup_ws_ns ?? Infinity) > c.setup_ws_ns) ? c : w), null);
  const tt = t.corners.find((c) => c.corner === L.pdk.default_corner);
  return (
    <div style={{ border: '1px solid var(--ev-layout)', background: 'color-mix(in srgb, var(--ev-layout) 7%, var(--surface-panel))', borderRadius: 8, padding: '8px 10px', margin: '10px 0' }} data-testid="layout-metrics">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><EvidenceBadge e="LAYOUT" /> <b>Place &amp; route, {L.pdk.scl}</b></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
        <tbody style={{ fontSize: 11.5 }}>
          <tr><td className="faint">die</td><td>{fmt(L.die.width_um, 2)} × {fmt(L.die.height_um, 2)} µm ({fmt(L.die.area_um2 / 1e6, 4)} mm²)</td></tr>
          <tr><td className="faint">core</td><td>{fmt(L.core.width_um, 2)} × {fmt(L.core.height_um, 2)} µm</td></tr>
          <tr><td className="faint">cells</td><td>{fmt(L.cells.stdcell, 0)} standard cells (incl. {fmt(L.cells.by_class.tap_cell ?? 0, 0)} well taps) + {fmt(L.cells.total - L.cells.stdcell, 0)} filler/decap</td></tr>
          <tr><td className="faint">buffers</td><td>{fmt(L.cells.by_class.timing_repair_buffer ?? 0, 0)} repair/timing · {fmt((L.cells.by_class.clock_buffer ?? 0) + (L.cells.by_class.clock_inverter ?? 0), 0)} clock tree</td></tr>
          <tr><td className="faint">flip-flops</td><td>{fmt(L.cells.sequential, 0)}</td></tr>
          <tr><td className="faint">utilisation</td><td>{fmt(L.area.utilization_pct, 1)} % of core (target {fmt(L.constraints.core_util_pct, 0)} % at floorplan)</td></tr>
          <tr><td className="faint">clock</td><td>{L.constraints.clock_port} @ {fmt(L.constraints.clock_period_ns, 2)} ns ({fmt(L.constraints.clock_mhz, 1)} MHz)</td></tr>
          <tr><td className="faint">setup</td><td style={{ color: slackColor(t.setup_ws_ns) }}>worst slack {signed(t.setup_ws_ns)} ns{worst ? ` (${worst.corner})` : ''} · WNS {fmt(t.setup_wns_ns, 3)} · TNS {fmt(t.setup_tns_ns, 2)} ns</td></tr>
          <tr><td className="faint">hold</td><td style={{ color: slackColor(t.hold_ws_ns) }}>worst slack {signed(t.hold_ws_ns)} ns · WNS {fmt(t.hold_wns_ns, 3)} · TNS {fmt(t.hold_tns_ns, 2)} ns</td></tr>
          {tt && <tr><td className="faint">typical</td><td>{tt.corner}: setup WS {fmt(tt.setup_ws_ns, 2)} ns, hold WS {fmt(tt.hold_ws_ns, 3)} ns</td></tr>}
          <tr><td className="faint">wire</td><td>{fmt(L.routing.wirelength_um, 0)} µm routed · {fmt(L.routing.vias, 0)} vias</td></tr>
        </tbody>
      </table>
      <div style={{ marginTop: 6, padding: '5px 7px', border: '1px dashed var(--ev-synth)', borderRadius: 6 }} data-testid="layout-power">
        <div><b style={{ color: 'var(--amber)' }}>Power: {L.power.label}</b> <span className="mono">{fmt(L.power.total_mw, 3)} mW</span> <span className="faint">({L.power.corner})</span></div>
        <div className="mono faint" style={{ fontSize: 11 }}>internal {fmt(L.power.internal_mw, 3)} · switching {fmt(L.power.switching_mw, 3)} mW · leakage {fmt(L.power.leakage_mw * 1e3, 3)} µW</div>
        {powerRange(L) && <div className="mono faint" style={{ fontSize: 11 }}>{powerRange(L)}</div>}
        <div className="faint" style={{ fontSize: 10.5 }}>{L.power.method}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
        <tbody>
          <Check label="DRC" status={C.drc.status} detail={`Magic ${fmt(C.drc.magic_errors, 0)} · KLayout ${fmt(C.drc.klayout_errors, 0)} · router ${fmt(C.drc.detailed_route_errors, 0)}`} />
          <Check label="LVS" status={C.lvs.status} detail={`Netgen: ${fmt(C.lvs.errors, 0)} errors`} />
          <Check label="Antenna" status={C.antenna.status} detail={`${fmt(C.antenna.violating_nets, 0)} nets · ${fmt(C.antenna.violating_pins, 0)} pins`} />
          <Check label="GDS XOR" status={C.xor.status} detail={`Magic vs KLayout stream-out: ${fmt(C.xor.differences, 0)}`} />
          <Check label="Timing" status={C.timing.status} detail={`${fmt(C.timing.setup_violations, 0)} setup · ${fmt(C.timing.hold_violations, 0)} hold endpoints (all corners)`} />
        </tbody>
      </table>
      <div className="mono faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        max slew {fmt(C.electrical.max_slew_violations, 0)} · max cap {fmt(C.electrical.max_cap_violations, 0)} · max fanout {fmt(C.electrical.max_fanout_violations, 0)} violations (worst corner)
      </div>
      {L.attempts && L.attempts.length > 1 && (
        <details style={{ marginTop: 6 }} data-testid="layout-attempts">
          <summary style={{ cursor: 'pointer' }}>Flow attempts ({L.attempts.length})</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }} className="mono">
            <thead><tr className="faint"><td>run</td><td>MHz</td><td>setup WS</td><td>slew</td><td>DRC/LVS</td></tr></thead>
            <tbody>
              {L.attempts.map((a) => (
                <tr key={a.run_tag} title={a.overrides.join('\n') || 'LibreLane defaults for these knobs'} style={{ fontWeight: a.published ? 700 : 400 }}>
                  <td>{a.run_tag}{a.published ? ' ★' : ''}</td><td>{fmt(a.clock_mhz, 0)}</td>
                  <td style={{ color: (a.setup_ws_ns ?? 0) < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(a.setup_ws_ns, 2)}</td>
                  <td>{fmt(a.max_slew_violations, 0)}</td><td>{a.drc_lvs_clean ? 'clean' : 'violations'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="faint" style={{ fontSize: 10.5 }}>★ = the run shown here. Setup WS is the worst slack over all {L.pdk.sta_corners.length} corners.</div>
        </details>
      )}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer' }}>Per-corner timing</summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }} className="mono">
          <thead><tr className="faint"><td>corner</td><td>setup WS</td><td>TNS</td><td>hold WS</td><td>slew</td></tr></thead>
          <tbody>
            {t.corners.map((c) => (
              <tr key={c.corner}>
                <td>{c.corner}</td>
                <td style={{ color: (c.setup_ws_ns ?? 0) < 0 ? 'var(--red)' : undefined }}>{fmt(c.setup_ws_ns, 2)}</td>
                <td>{fmt(c.setup_tns_ns, 1)}</td>
                <td style={{ color: (c.hold_ws_ns ?? 0) < 0 ? 'var(--red)' : undefined }}>{fmt(c.hold_ws_ns, 3)}</td>
                <td>{fmt(c.max_slew_violations, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="faint" style={{ fontSize: 10.5 }}>{t.note}</div>
      </details>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer' }}>Constraints, tools and files</summary>
        <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          <div>I/O delay {fmt(L.constraints.io_delay_pct, 0)} % · uncertainty {fmt(L.constraints.clock_uncertainty_ns, 2)} ns · clock slew {fmt(L.constraints.clock_transition_ns, 2)} ns · derate ±{fmt(L.constraints.timing_derate_pct, 0)} %</div>
          <div>max transition {fmt(L.constraints.max_transition_ns, 2)} ns · max fanout {L.constraints.max_fanout} · density {fmt(L.constraints.target_density_pct, 0)} % · aspect {fmt(L.constraints.aspect_ratio, 2)}</div>
          <div className="faint">reset: {L.constraints.reset}</div>
          <div className="faint">pins: {L.constraints.pin_placement}</div>
          <div className="faint">routing {L.constraints.routing_layers} · {L.constraints.synthesis}</div>
          <div className="faint">{L.constraints.config_file} · {L.constraints.sdc_file}</div>
          <div style={{ marginTop: 4 }}>LibreLane {L.flow.librelane} ({L.flow.steps} steps) · {L.pdk.name} open_pdks {L.pdk.open_pdks_rev.slice(0, 10)}</div>
          {Object.entries(L.tools).map(([k, v]) => <div key={k} className="faint">{k}: {v}</div>)}
          <div className="faint">{L.flow.host}</div>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(L.files).filter(([f]) => !f.endsWith('.png')).map(([f, n]) => (
              <a key={f} href={art + f} download style={{ color: 'var(--copper-hi)' }}>{f} ({(n / 1024).toFixed(0)} kB)</a>
            ))}
          </div>
        </div>
      </details>
      <p className="faint" style={{ fontSize: 10.5, marginBottom: 0 }}>{L.note}</p>
    </div>
  );
}
