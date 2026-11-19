// SIGNAL INSPECTOR: explains a drawn die route, a real net, or a netlist bundle between two blocks.
// Names, widths, signedness and endpoints come from rtl_modules.json; values from rtl_trace_v03.json, labelled
// RTL / DERIVED / CONFIG or NO TRACE. Line thickness on the die never stands for physical width.
import { useMemo } from 'react';
import { useArtifacts } from '../artifacts/load';
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';
import type { ProcMode } from '../model/types';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { runtime } from '../three/viewStore';
import { instFriendly, INST_TO_ID } from './names';
import { useMicro, type NetScope, type SignalRef } from './microStore';
import { useTraceV04, useV04 } from '../lab/v04Store';
import { CLASS_LABEL, ROUTE_NETS, fmtValue, historyBefore, isGlue, netIndex, netValue, waveAt, type Net } from './signals';

const SRC_EV: Record<string, 'RTL' | 'DEMO' | 'CONCEPT'> = { RTL: 'RTL', DERIVED: 'RTL', CONFIG: 'RTL', 'NO TRACE': 'CONCEPT' };

/** Schematic bus notation: one line for a single wire, a slashed line with the width for a bus. */
export function BusGlyph({ width }: { width: number }) {
  return (
    <svg className="bus-glyph" viewBox="0 0 46 16" width="46" height="16" aria-label={width === 1 ? 'single wire' : `${width}-bit bus`}>
      {width === 1 ? (
        <line x1="2" y1="8" x2="44" y2="8" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <>
          <line x1="2" y1="8" x2="44" y2="8" stroke="currentColor" strokeWidth="3.2" />
          <line x1="19" y1="14" x2="27" y2="2" stroke="currentColor" strokeWidth="1.4" />
          <text x="29" y="6" fontSize="7" fill="currentColor">{width}</text>
        </>
      )}
    </svg>
  );
}

function endName(inst: string, port: string, scope: NetScope) {
  if (inst === '') {
    const f = scope === 'v03' ? 'Readout-core port (hbci_readout_core boundary)' : scope === 'event' ? 'Legacy core port (u_event boundary)' : scope === 'ai' ? 'Decoder port / top-level logic (hbci_ai_decoder boundary)' : 'Chip input / output port or register file (hbci02_digital_top)';
    return { friendly: f, lit: port };
  }
  return { friendly: instFriendly(inst), lit: `${inst}.${port}` };
}

function modesOfInst(inst: string): ProcMode[] {
  const id = INST_TO_ID[inst];
  return (id && COMPONENTS[id]?.modes) || [];
}

function followTo(inst: string, scope: NetScope) {
  const id = inst === '' ? (scope === 'ai' ? 'rtl.ai_fifo' : scope === 'v04' ? 'rtl.regs' : 'die.pads') : scope === 'event' && inst === 'u_event' ? 'rtl.core' : INST_TO_ID[inst];
  if (!id) return;
  const s = useScene.getState();
  s.select(id);
  if (s.level === 'die') s.requestFit();
}

/** Small step/line plot of the signal around the cursor. */
function Sparkline({ net }: { net: Net }) {
  const tr = useArtifacts((a) => a.traceV03);
  const i = useMicro((m) => m.cursor);
  const data = useMemo(() => {
    if (!tr || net.scope !== 'v03') return null;
    const s = tr.samples[Math.min(i, tr.samples.length - 1)];
    const WAVE: Record<string, string> = { in_valid: 'in_valid', in_channel: 'in_channel', in_sample: 'in_sample', raw_gen: 'raw_gen', event_gen: 'event_gen', feat_gen: 'feat_gen', bq_y: 'u_biquad.y', bq_ysat: 'u_biquad.ysat', rec_valid: 'rec_valid', rec_type: 'rec_type', rec_channel: 'rec_channel', rec_seq: 'rec_seq', rec_flags: 'rec_flags', rec_data: 'rec_data' };
    // per-channel quantities: plot this channel's sample history (what the per-channel memory sees)
    const perCh: Record<string, (k: number) => number> = {
      in_sample: (k) => tr.samples[k].x, bq_y: (k) => tr.samples[k].y, fs_acc: (k) => tr.samples[k].acc, fs_cnt: (k) => tr.samples[k].cnt,
      fs_x1: (k) => historyBefore(tr.samples, k, tr.samples[k].ch).x1, fs_y1: (k) => historyBefore(tr.samples, k, tr.samples[k].ch).y1,
      fs_x2: (k) => historyBefore(tr.samples, k, tr.samples[k].ch).x2, fs_y2: (k) => historyBefore(tr.samples, k, tr.samples[k].ch).y2,
    };
    if (perCh[net.net]) {
      const ks: number[] = [];
      for (let k = s.i; k >= 0 && ks.length < 32; k--) if (tr.samples[k].ch === s.ch) ks.unshift(k);
      const cur = ks.length - 1;
      for (let k = s.i + 1; k < tr.samples.length && ks.length < 48; k++) if (tr.samples[k].ch === s.ch) ks.push(k);
      return { pts: ks.map((k) => perCh[net.net](k)), cur, kind: 'analog' as const, caption: `ch${s.ch}: ${ks.length} samples of this channel around the cursor` };
    }
    const w = WAVE[net.net] ? tr.waves.find((x) => x.name === WAVE[net.net]) : null;
    if (w) {
      const c0 = s.cycle - 32, c1 = s.cycle + 32;
      const pts: number[] = [];
      for (let c = c0; c <= c1; c++) {
        const v = waveAt(w.changes, c);
        pts.push(v === null ? 0 : w.signed && v >= 2 ** (w.width - 1) ? v - 2 ** w.width : v);
      }
      return { pts, cur: 32, kind: w.width === 1 ? 'digital' as const : 'analog' as const, caption: `cycles ${c0}–${c1} (all channels interleaved)` };
    }
    return null;
  }, [tr, net, i]);
  if (!data) return null;
  const W = 300, H = 54;
  const lo = Math.min(...data.pts), hi = Math.max(...data.pts);
  const span = hi - lo || 1;
  const x = (k: number) => (k / Math.max(1, data.pts.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 6 - ((v - lo) / span) * (H - 12);
  const d = data.kind === 'digital'
    ? data.pts.map((v, k) => `${k === 0 ? 'M' : 'H'}${x(k)} V${y(v)}`).join(' ')
    : data.pts.map((v, k) => `${k === 0 ? 'M' : 'L'}${x(k)},${y(v)}`).join(' ');
  return (
    <figure className="si-spark" data-testid="si-spark">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-label={`waveform of ${net.net}`}>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <line x1={x(data.cur)} x2={x(data.cur)} y1="0" y2={H} stroke="var(--copper)" strokeWidth="1.2" strokeDasharray="3 2" />
      </svg>
      <figcaption>{data.caption}; dashed line = cursor. Source: rtl_trace_v03.json</figcaption>
    </figure>
  );
}

/** Sample cursor shared by the inspector and the module view. */
export function CursorBar({ compact = false }: { compact?: boolean }) {
  const tr = useArtifacts((a) => a.traceV03);
  const i = useMicro((m) => m.cursor);
  const setCursor = useMicro((m) => m.setCursor);
  const bits = useMicro((m) => m.showBits);
  const setBits = useMicro((m) => m.setShowBits);
  if (!tr) return <div className="si-missing">rtl_trace_v03.json not loaded: values cannot be shown (run <code>make artifacts</code>).</div>;
  const n = tr.samples.length;
  const s = tr.samples[Math.min(i, n - 1)];
  const sameCh = (dir: 1 | -1) => {
    for (let k = s.i + dir; k >= 0 && k < n; k += dir) if (tr.samples[k].ch === s.ch) return setCursor(k);
  };
  return (
    <div className={`si-cursor${compact ? ' compact' : ''}`} data-testid="cursor-bar">
      <div className="si-cursor-row">
        <span>Sample <b className="mono">i = {s.i}</b> · channel <b className="mono">ch{s.ch}</b> · clock cycle <b className="mono">{s.cycle}</b></span>
        <label className="si-bits"><input type="checkbox" checked={bits} onChange={(e) => setBits(e.target.checked)} /> Show bits</label>
      </div>
      <div className="si-cursor-row">
        <button className="btn sm" onClick={() => sameCh(-1)} title={`Previous sample of ch${s.ch}`}>◀ ch{s.ch}</button>
        <input type="range" min={0} max={n - 1} value={s.i} onChange={(e) => setCursor(+e.target.value)} aria-label="Sample index" />
        <button className="btn sm" onClick={() => sameCh(1)} title={`Next sample of ch${s.ch}`}>ch{s.ch} ▶</button>
      </div>
    </div>
  );
}

function NetRow({ net, onOpen }: { net: Net; onOpen: () => void }) {
  const tr = useArtifacts((a) => a.traceV03);
  const { trace: t4 } = useTraceV04();
  const frame = useV04((s) => s.frame);
  const i = useMicro((m) => m.cursor);
  const bits = useMicro((m) => m.showBits);
  const v = netValue(net, tr, i, { trace: t4, frame });
  return (
    <button className="si-netrow" onClick={onOpen} title={net.meaning} data-testid={`si-net-${net.net}`}>
      <code className="si-netname">{net.net}</code>
      <BusGlyph width={net.width} />
      <span className="si-netcls">{CLASS_LABEL[net.cls]}</span>
      <span className="si-netval mono">{fmtValue(v.v, net.width, net.signed, bits)}</span>
      <span className={`si-src src-${v.src.replace(' ', '')}`}>{v.src}</span>
    </button>
  );
}

function NetDetail({ net }: { net: Net }) {
  const tr = useArtifacts((a) => a.traceV03);
  const { trace: t4 } = useTraceV04();
  const frame = useV04((s) => s.frame);
  const i = useMicro((m) => m.cursor);
  const bits = useMicro((m) => m.showBits);
  const v = netValue(net, tr, i, { trace: t4, frame });
  const glue = isGlue(net);
  const drivers = glue ? net.drivers : net.drivers.slice(0, 1);
  const modes = [...new Set(net.sinks.flatMap((e) => modesOfInst(e.inst)))];
  const followable = net.sinks.filter((e) => e.inst !== '' || net.scope === 'v03');
  return (
    <div className="si-net" data-testid="si-net-detail">
      <div className="si-net-h">
        <code className="si-big">{net.net}</code>
        <span className="si-tag"><BusGlyph width={net.width} /> {net.width === 1 ? '1 wire (1 bit)' : `${net.width}-bit bus (${net.width} wires)`}</span>
        <span className="si-tag">{net.width > 1 ? (net.signed ? 'signed' : 'unsigned') : 'single bit'}</span>
        <span className="si-tag">{CLASS_LABEL[net.cls]}</span>
      </div>
      <p className="si-meaning">{net.meaning}</p>
      <div className="si-ends">
        <div>
          <div className="si-k">{glue ? 'Made by top-level logic from' : 'Comes from'}</div>
          {drivers.map((d) => {
            const e = endName(d.inst, d.port, net.scope);
            return <div key={`${d.inst}.${d.port}`} className="si-end">{e.friendly} <code>{e.lit}</code></div>;
          })}
          {net.expr && <pre className="si-expr">{net.expr}</pre>}
        </div>
        <div>
          <div className="si-k">Goes to</div>
          {net.sinks.map((d) => {
            const e = endName(d.inst, d.port, net.scope);
            return <div key={`${d.inst}.${d.port}`} className="si-end">{e.friendly} <code>{e.lit}</code></div>;
          })}
        </div>
      </div>
      <div className="si-value" data-testid="si-value">
        <div className="si-k">Value at the cursor</div>
        <div className="si-value-row">
          <span className="si-value-v mono">{v.v === null ? 'NO TRACE' : fmtValue(v.v, net.width, net.signed, bits)}</span>
          <span className={`si-src src-${v.src.replace(' ', '')}`}>{v.src}</span>
          <EvidenceBadge e={SRC_EV[v.src]} />
        </div>
        <div className="si-how">{v.how}</div>
      </div>
      <Sparkline net={net} />
      {modes.length > 0 && <div className="si-modes">Used by: {modes.join(' · ')}</div>}
      <div className="si-follow">
        <span className="si-k">Follow this signal →</span>
        {followable.map((d) => (
          <button key={`${d.inst}.${d.port}`} className="btn sm" onClick={() => followTo(d.inst, net.scope)}>{endName(d.inst, d.port, net.scope).friendly}</button>
        ))}
      </div>
    </div>
  );
}

export function SignalInspector({ docked = 'die' }: { docked?: 'die' | 'module' }) {
  const sig = useMicro((m) => m.signal);
  const setSignal = useMicro((m) => m.setSignal);
  const prev = useMicro((m) => m.prevSignal);
  const modules = useArtifacts((a) => a.modules);
  const tr = useArtifacts((a) => a.traceV03);
  const { trace: t4 } = useTraceV04();
  const frame4 = useV04((s) => s.frame);
  const idx = useMemo(() => netIndex(modules), [modules]);
  if (!sig) return null;
  const open = (net: string, scope: NetScope) => setSignal({ kind: 'net', net, scope });
  const back = (to: SignalRef) => setSignal(to);
  let body: React.ReactNode = null;
  let title = '';
  if (!modules) body = <div className="si-missing">rtl_modules.json not loaded: names and endpoints are unavailable (run <code>make artifacts</code>).</div>;
  else if (sig.kind === 'route') {
    const r = ROUTE_NETS[sig.edge];
    const e = runtime.dieEdges.find((x) => x.id === sig.edge);
    title = 'Drawn route';
    const nets = (r?.nets ?? []).map((n) => idx[r.scope].get(n)).filter(Boolean) as Net[];
    body = (
      <>
        <p className="si-concept"><EvidenceBadge e="CONCEPT" /> This copper line is a <b>drawing</b> of a real connection: its path, length and thickness are not a fabricated wire. The nets below are real (Yosys netlist).</p>
        {e && <div className="si-route-sig">{e.from.map((x) => COMPONENTS[x]?.name).filter(Boolean)[0] ?? 'inputs'} → {e.to.map((x) => COMPONENTS[x]?.name).filter(Boolean)[0] ?? 'outputs'}</div>}
        <div className="si-k">Real nets on this route ({nets.length})</div>
        <div className="si-netlist">{nets.map((n) => <NetRow key={n.net} net={n} onOpen={() => open(n.net, n.scope)} />)}</div>
        {r?.scope === 'event' && <p className="si-note">Legacy-core internals are not in the v0.3 trace, so their values read NO TRACE here. The module view uses the separate v0.2 trace.</p>}
        {(r?.scope === 'ai' || r?.scope === 'v04') && <p className="si-note">v0.4 values are those of frame {t4?.frames[frame4]?.frame_id ?? '?'} selected in the signal lab's on-chip AI view (rtl_trace_v04{t4?.source.model.trained ? '_real' : ''}.json). The v0.4 trace records features, frames, inferences and predictions, not every net per cycle.</p>}
      </>
    );
  } else if (sig.kind === 'net') {
    const n = idx[sig.scope].get(sig.net);
    title = 'Net';
    body = n ? <NetDetail net={n} /> : <div className="si-missing">Net {sig.net} is not in rtl_modules.json ({sig.scope}).</div>;
  } else {
    const [a, b] = sig.pair.split('>');
    const nets = [...idx[sig.scope].values()].filter((n) => n.net !== 'clk' && n.net !== 'rst_n' && n.drivers.some((d) => d.inst === a) && n.sinks.some((d) => d.inst === b));
    const bitsTot = nets.reduce((k, n) => k + n.width, 0);
    title = 'Netlist connection';
    body = (
      <>
        <p className="si-concept"><EvidenceBadge e="RTL" /> A straight line means only <b>these two blocks are connected</b> in the synthesised netlist; it is not a route or a wire shape.</p>
        <div className="si-route-sig">{instFriendly(a)} <code>{a || 'ports'}</code> → {instFriendly(b === '' ? '$out' : b)} <code>{b || 'ports'}</code></div>
        <div className="si-k">{nets.length} net{nets.length === 1 ? '' : 's'} · {bitsTot} bit{bitsTot === 1 ? '' : 's'} in total</div>
        <div className="si-netlist">{nets.map((n) => <NetRow key={n.net} net={n} onOpen={() => open(n.net, n.scope)} />)}</div>
      </>
    );
  }
  const scope4 = sig.kind !== 'route' ? sig.scope === 'ai' || sig.scope === 'v04' : !!ROUTE_NETS[sig.edge] && (ROUTE_NETS[sig.edge].scope === 'ai' || ROUTE_NETS[sig.edge].scope === 'v04');
  const prov = scope4
    ? (t4 ? `rtl_trace_v04${t4.source.model.trained ? '_real' : ''}.json (Icarus, hbci02_digital_top; RTL sha256 ${t4.rtl_sha256.slice(0, 10)}…)` : 'no v0.4 trace loaded')
    : tr ? `rtl_trace_v03.json (Icarus, HYBRID run; RTL sha256 ${tr.rtl_sha256.slice(0, 10)}…)` : 'no trace loaded';
  return (
    <aside className={`si si-${docked}`} data-testid="signal-inspector" role="dialog" aria-label="Signal inspector">
      <div className="si-h">
        <b>SIGNAL INSPECTOR</b>
        <span className="si-h-sub">{title}</span>
        <span className="vmb-sp" />
        {sig.kind === 'net' && prev && <button className="btn sm" onClick={() => back(prev)} data-testid="si-back">← {prev.kind === 'route' ? 'route' : 'connection'}</button>}
        <button className="btn sm" onClick={() => setSignal(null)} aria-label="Close signal inspector" data-testid="si-close">Close</button>
      </div>
      <div className="si-body">
        {body}
        {!scope4 && <CursorBar compact />}
        <div className="si-prov">Names, widths, endpoints: rtl_modules.json (Yosys netlist). Values: {prov}.</div>
      </div>
    </aside>
  );
}
