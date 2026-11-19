// Linked representation views: one channel, one interval, every representation.
// Raw input, band-pass output, band energy, legacy events, spectrum and output records all refer to the
// SAME source interval; selecting a sample follows it through the readout core.
import { useEffect, useMemo } from 'react';
import { useArtifacts } from '../artifacts/load';
import { useScene } from '../state/sceneStore';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { RECORD_BITS, RTL_SHA256_AT_BUILD } from '../model/system';
import type { ProcMode } from '../model/types';
import { Plot } from './Plot';
import { spectrum } from './spectrum';
import { cssVar, plotPalette, withAlpha } from '../model/theme';
import { buildRtl, useV03, v03Flow, type ReprData } from './v03Store';

const MODES: ProcMode[] = ['EVENT', 'RAW', 'FEATURE', 'HYBRID'];
const TYPE_NAME = ['RAW', 'EVENT', 'FEATURE'];
const KEEPS: Record<ProcMode, { keeps: string; loses: string }> = {
  RAW: { keeps: 'every digital value entering the core, with channel and sample index', loses: 'nothing after the ADC during the session (each sample still costs an 89-bit record)' },
  EVENT: { keeps: 'time, channel, polarity and magnitude of threshold crossings', loses: 'the waveform, sub-threshold activity and band power' },
  FEATURE: { keeps: 'band energy per channel per window', loses: 'waveform shape, phase, out-of-band content and timing within the window' },
  HYBRID: { keeps: 'raw samples and band energies together', loses: 'nothing RAW keeps, but payload exceeds RAW alone' },
};
const C = {
  get grid() { return plotPalette().grid; },
  get x() { return plotPalette().raw; },
  get y() { return plotPalette().filtered; },
  get e() { return plotPalette().energy; },
  get ev() { return plotPalette().event; },
  get band() { return withAlpha(cssVar('--mode-feature'), 0.12); },
  get sel() { return plotPalette().selection; },
  get txt() { return plotPalette().text; },
  get truth() { return plotPalette().truth; },
};

function axisLabel(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.fillStyle = C.txt;
  g.font = '10px SF Mono, Menlo, monospace';
  g.fillText(s, x, y);
}

export function Representations() {
  const v = useV03();
  const trace = useArtifacts((a) => a.traceV03);
  const procMode = useScene((s) => s.procMode);
  const setProcMode = useScene((s) => s.setProcMode);
  const theme = useScene((s) => s.theme);
  const rtl = useMemo(() => (trace ? buildRtl(trace) : null), [trace]);
  const d: ReprData = v.source === 'rtl' && rtl ? rtl : v.demo;
  const ch = Math.min(v.ch, d.channels.length - 1);
  const cv = d.channels[ch];
  const T = cv.x.length;
  const t0 = Math.max(0, Math.min(v.t0, T - 17));
  const t1 = Math.min(T - 1, Math.max(v.t1, t0 + 16));
  const sel = v.sel !== null && v.sel >= 0 && v.sel < T ? v.sel : null;
  const stale = v.source === 'rtl' && trace && RTL_SHA256_AT_BUILD !== 'unknown' && trace.rtl_sha256 !== RTL_SHA256_AT_BUILD;
  const tx = (t: number, w: number) => 34 + ((t - t0) / (t1 - t0)) * (w - 40);
  const fromFrac = (fx: number, w: number) => Math.round(t0 + ((fx * w - 34) / (w - 40)) * (t1 - t0));

  // follow-the-sample animation through the die / block diagram
  useEffect(() => {
    if (v.flowStage === null || sel === null) return;
    const gi = cv.gi[sel];
    const emitsF = !!cv.done[sel];
    const emitsE = d.events[ch].some((e) => e.t === sel);
    const stages = v03Flow(procMode, { feature: emitsF, event: emitsE });
    if (v.flowStage >= stages.length) { v.setFlowStage(null); return; }
    useScene.getState().setActiveBlocks(stages[v.flowStage], ch);
    const id = window.setTimeout(() => useV03.getState().setFlowStage(v.flowStage! + 1), 650);
    void gi;
    return () => window.clearTimeout(id);
  }, [v.flowStage, sel, procMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const spec = useMemo(() => ({ x: spectrum(cv.x.slice(t0, t1 + 1), d.fs), y: spectrum(cv.y.slice(t0, t1 + 1), d.fs) }), [cv, t0, t1, d.fs]);
  const giLo = cv.gi[t0];
  const giHi = cv.gi[t1];
  const recs = useMemo(() => d.records[procMode].filter((r) => r.ts >= giLo && r.ts <= giHi), [d, procMode, giLo, giHi]);
  const recsCh = recs.filter((r) => r.ch === ch);
  const sampleBits = (giHi - giLo + 1) * 16;
  const bursts = d.truth.bursts.filter((b) => b.ch === ch);

  function drawSignal(arr: number[], color: string, label: string, opts?: { band?: boolean }) {
    return (g: CanvasRenderingContext2D, w: number, h: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let t = t0; t <= t1; t++) { lo = Math.min(lo, arr[t]); hi = Math.max(hi, arr[t]); }
      if (hi - lo < 1) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08;
      lo -= pad; hi += pad;
      const ty = (val: number) => h - 4 - ((val - lo) / (hi - lo)) * (h - 8);
      if (opts?.band) for (const b of bursts) {
        g.fillStyle = C.truth;
        const a = Math.max(t0, b.t0), z = Math.min(t1, b.t1);
        if (z > a) g.fillRect(tx(a, w), 0, tx(z, w) - tx(a, w), h);
      }
      g.strokeStyle = C.grid;
      g.beginPath(); g.moveTo(34, ty(0)); g.lineTo(w, ty(0)); g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.beginPath();
      for (let t = t0; t <= t1; t++) g.lineTo(tx(t, w), ty(arr[t]));
      g.stroke();
      g.lineWidth = 1;
      if (sel !== null && sel >= t0 && sel <= t1) {
        g.strokeStyle = C.sel;
        g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(tx(sel, w), 0); g.lineTo(tx(sel, w), h); g.stroke();
        g.setLineDash([]);
        g.fillStyle = C.sel;
        g.beginPath(); g.arc(tx(sel, w), ty(arr[sel]), 3, 0, Math.PI * 2); g.fill();
      }
      axisLabel(g, label, 4, 12);
      axisLabel(g, String(Math.round(hi)), 4, 24);
      axisLabel(g, String(Math.round(lo)), 4, h - 4);
    };
  }

  const jr = sel !== null ? journey(d, ch, sel, procMode) : null;

  return (
    <div className="repr" data-testid="repr-view">
      <div className="repr-head">
        <div className="seg">
          <button className={v.source === 'demo' ? 'on' : ''} onClick={() => v.setSource('demo')}>DEMO model</button>
          <button className={v.source === 'rtl' ? 'on' : ''} disabled={!rtl} onClick={() => v.setSource('rtl')}
            title={rtl ? 'Actual hbci_readout_core values from the Icarus run' : 'rtl_trace_v03.json not generated yet (make artifacts)'}>RTL trace</button>
        </div>
        <EvidenceBadge e={d.source === 'rtl' ? 'RTL' : 'DEMO'} />
        {stale && <span className="stale" title={`trace rtl_sha256 ${trace!.rtl_sha256.slice(0, 10)}… ≠ current rtl/*.v ${RTL_SHA256_AT_BUILD.slice(0, 10)}…`}>STALE TRACE: RTL changed since this trace was generated</span>}
        <div className="chips">
          {d.channels.map((_, c) => (
            <button key={c} className={`chip${c === ch ? ' on' : ''}`} onClick={() => v.setCh(c)} title={d.truth.channels.find((x) => x.ch === c)?.description}>{c}</button>
          ))}
        </div>
        <span className="faint repr-desc">{d.truth.channels.find((x) => x.ch === ch)?.description}</span>
        <div className="seg" title="Readout mode (cfg_mode), shared with the die view">
          {MODES.map((m) => <button key={m} className={procMode === m ? 'on' : ''} onClick={() => setProcMode(m)}>{m}</button>)}
        </div>
        {v.source === 'demo' && (
          <>
            <label className="faint">noise <input type="range" min={0} max={600} step={10} value={v.noise} onChange={(e) => v.setNoise(+e.target.value)} /></label>
            <button className="btn sm" onClick={v.injectBurst} title="Add a 100 Hz burst to this channel inside the interval (DEMO stimulus only)">+ 100 Hz burst</button>
          </>
        )}
        <span className="mono faint">t {t0}–{t1} · {((t1 - t0 + 1) / d.fs * 1000).toFixed(0)} ms @ {d.fs} S/s</span>
      </div>
      <div className="repr-body">
        <div className="repr-plots">
          <Plot height={34} testId="repr-overview" deps={[d, ch, t0, t1, sel, theme]} title="Whole recording: drag to choose the interval"
            onDrag={(a, b, done) => { if (done) { v.setInterval(a * (T - 1), b * (T - 1)); } }}
            draw={(g, w, h) => {
              let lo = Infinity, hi = -Infinity;
              for (const val of cv.x) { lo = Math.min(lo, val); hi = Math.max(hi, val); }
              const ty = (val: number) => h - 2 - ((val - lo) / (hi - lo + 1)) * (h - 4);
              g.fillStyle = withAlpha(cssVar('--accent'), 0.15);
              g.fillRect((t0 / (T - 1)) * w, 0, ((t1 - t0) / (T - 1)) * w, h);
              g.strokeStyle = cssVar('--fg-tertiary');
              g.beginPath();
              for (let t = 0; t < T; t++) g.lineTo((t / (T - 1)) * w, ty(cv.x[t]));
              g.stroke();
              axisLabel(g, 'drag to select interval', w - 150, 11);
            }} />
          <Plot height={78} testId="repr-raw" deps={[d, ch, t0, t1, sel, theme]} onClick={(fx, _fy, w) => v.select(fromFrac(fx, w))}
            draw={drawSignal(cv.x, C.x, 'RAW input x (ADC codes)', { band: true })} />
          <Plot height={70} testId="repr-filtered" deps={[d, ch, t0, t1, sel, theme]} onClick={(fx, _fy, w) => v.select(fromFrac(fx, w))}
            draw={drawSignal(cv.y, C.y, `band-pass y (${d.config.feature.b0 === 1801 ? '70–150 Hz' : 'custom'})`)} />
          <Plot height={52} testId="repr-energy" deps={[d, ch, t0, t1, sel, theme]}
            draw={(g, w, h) => {
              const es = d.energy[ch].filter((e) => e.t >= t0 && e.t <= t1);
              const win = 1 << d.config.feature.winLog2;
              const max = Math.max(1, ...d.energy[ch].map((e) => e.e));
              for (const e of es) {
                const x1 = tx(e.t, w), x0 = tx(e.t - win + 1, w);
                const bh = (e.e / max) * (h - 14);
                g.fillStyle = e.sat ? plotPalette().fp : C.e;
                g.fillRect(Math.max(34, x0), h - 2 - bh, Math.max(1, x1 - x0 - 1), bh);
              }
              axisLabel(g, `band energy per ${win}-sample window (FEATURE)`, 4, 11);
            }} />
          <Plot height={26} testId="repr-events" deps={[d, ch, t0, t1, theme]}
            draw={(g, w, h) => {
              for (const e of d.events[ch]) if (e.t >= t0 && e.t <= t1) { g.fillStyle = C.ev; g.fillRect(tx(e.t, w) - 1, 4, 2, h - 8); }
              for (const s of d.truth.spikes) if (s.ch === ch && s.t >= t0 && s.t <= t1) { g.fillStyle = cssVar('--ev-scripted'); g.fillRect(tx(s.t, w) - 3, h - 3, 6, 2); }
              axisLabel(g, 'EVENT raster (legacy core)', 4, 11);
            }} />
          <div className="faint repr-note">Shaded violet = ground-truth burst; violet ticks = injected spikes. Click the RAW or band-pass plot to follow one sample.</div>
        </div>
        <div className="repr-side">
          <div className="repr-card">
            <div className="cd-k">Spectrum of this interval (Hann, N={spec.x.n})</div>
            <Plot height={110} testId="repr-spectrum" deps={[spec, theme]}
              draw={(g, w, h) => {
                const fmax = d.fs / 2;
                const fx = (f: number) => 30 + (f / fmax) * (w - 34);
                const all = [...spec.x.db, ...spec.y.db];
                const hi = Math.max(...all, -10), lo = hi - 70;
                const ty = (db: number) => h - 12 - ((Math.max(lo, db) - lo) / (hi - lo)) * (h - 20);
                g.fillStyle = C.band;
                g.fillRect(fx(70), 0, fx(150) - fx(70), h - 12);
                for (const [arr, col] of [[spec.x, C.x], [spec.y, C.y]] as const) {
                  g.strokeStyle = col; g.beginPath();
                  arr.f.forEach((f, k) => g.lineTo(fx(f), ty(arr.db[k])));
                  g.stroke();
                }
                for (const f of [0, 250, 500, 750, 1000]) if (f <= fmax) axisLabel(g, `${f}`, fx(f) - 6, h - 1);
                axisLabel(g, 'Hz', w - 18, h - 1);
                axisLabel(g, 'x', 34, 10); g.fillStyle = C.y; g.fillText('y', 46, 10);
              }} />
          </div>
          <div className="repr-card">
            <div className="cd-k">{procMode} keeps / loses</div>
            <div style={{ fontSize: 11 }}><b style={{ color: 'var(--green)' }}>keeps</b> {KEEPS[procMode].keeps}</div>
            <div style={{ fontSize: 11 }}><b style={{ color: 'var(--red)' }}>loses</b> {KEEPS[procMode].loses}</div>
            <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>
              interval payload: {recs.length} records × {RECORD_BITS} b = {(recs.length * RECORD_BITS / 1000).toFixed(1)} kbit
              <span className="faint"> (sample values alone: {(sampleBits / 1000).toFixed(1)} kbit, all channels)</span>
            </div>
            {d.stats[procMode] && <div className="mono faint" style={{ fontSize: 10 }}>RTL run: {d.stats[procMode]!.drops} drops · {(d.stats[procMode]!.recordBits / 1000).toFixed(1)} kbit total</div>}
          </div>
          <div className="repr-card" data-testid="sample-journey">
            <div className="cd-k">Follow one sample {jr && <button className="btn sm" onClick={() => v.setFlowStage(0)} data-testid="follow-sample">▶ through the circuit</button>}</div>
            {!jr ? <div className="faint" style={{ fontSize: 11 }}>Click a point on the RAW or band-pass plot.</div> : (
              <div className="journey">
                {jr.map((row, k) => (
                  <div key={k} className="jr-row">
                    <div className="jr-stage">{row.stage}<span className="mono faint"> {row.module}</span></div>
                    <div className="mono">{row.value}</div>
                    {row.detail && <div className="faint">{row.detail}</div>}
                  </div>
                ))}
                <div className="faint" style={{ fontSize: 10 }}>Source: {d.source === 'rtl' ? 'rtl_trace_v03.json (Icarus, actual RTL values)' : 'lab/featureModel.ts (DEMO, bit-accurate port of the spec)'}</div>
              </div>
            )}
          </div>
          <div className="repr-card">
            <div className="cd-k">{procMode} records in interval (ch {ch}: {recsCh.length} of {recs.length})</div>
            <div className="evlist" style={{ maxHeight: 120 }}>
              <table>
                <thead><tr><th>type</th><th>ch</th><th>seq</th><th>ts</th><th>data</th><th>flags</th></tr></thead>
                <tbody>
                  {recsCh.slice(0, 200).map((r, k) => (
                    <tr key={k} onClick={() => { const t = cv.gi.indexOf(r.ts); if (t >= 0) v.select(t); }}>
                      <td>{TYPE_NAME[r.type]}</td><td>{r.ch}</td><td>{r.seq}</td><td>{r.ts}</td>
                      <td>{r.type === 1 ? `${(r.data >> 16) & 1 ? '−' : '+'}${r.data & 0xffff}` : r.data}</td>
                      <td>{r.flags & 2 ? <span className="fp">GAP</span> : ''}{r.flags & 1 ? <span className="fp"> SAT</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The numeric journey of one sample through the selected mode's data path. */
function journey(d: ReprData, ch: number, t: number, mode: ProcMode) {
  const cv = d.channels[ch];
  const f = d.config.feature;
  const gi = cv.gi[t];
  const x = cv.x[t];
  const x1 = t > 0 ? cv.x[t - 1] : 0, x2 = t > 1 ? cv.x[t - 2] : 0;
  const y1 = t > 0 ? cv.y[t - 1] : 0, y2 = t > 1 ? cv.y[t - 2] : 0;
  const p = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
  const yRe = Math.max(-32768, Math.min(32767, Math.floor((p + 8192) / 16384)));
  const win = 1 << f.winLog2;
  const rows: { stage: string; module: string; value: string; detail?: string }[] = [
    { stage: 'Input code', module: 'in_sample', value: `x = ${x}  (ch ${ch}, sample index i = ${gi}, t = ${(t / d.fs * 1000).toFixed(1)} ms)`, detail: 'ADC codes; dimensionless. What the core receives, not the biological voltage.' },
  ];
  const recordsHere = d.records[mode].filter((r) => r.ts === gi && r.ch === ch);
  if (mode === 'RAW' || mode === 'HYBRID') {
    const rr = recordsHere.find((r) => r.type === 0);
    rows.push({ stage: 'RAW path', module: 'raw_gen → u_records', value: rr ? `RAW record seq ${rr.seq}: data = ${rr.data}` : 'no RAW record (outside session?)', detail: 'The value is copied unchanged, so it can be reconstructed exactly.' });
  }
  if (mode === 'FEATURE' || mode === 'HYBRID') {
    rows.push({ stage: 'Band-pass filter', module: 'u_biquad', value: `p = ${f.b0}·${x} + ${f.b1}·${x1} + ${f.b2}·${x2} − (${f.a1})·${y1} − ${f.a2}·${y2} = ${p}`, detail: `y = sat16((p + 8192) >>> 14) = ${yRe}${d.source === 'rtl' ? `; RTL produced y = ${cv.y[t]} ${cv.y[t] === yRe ? '✓ match' : '✗ MISMATCH'}` : ''}` });
    const accAfter = cv.acc[t] + cv.y[t] * cv.y[t];
    rows.push({ stage: 'Energy window', module: 'u_energy', value: `acc ${cv.acc[t]} + y² ${cv.y[t] * cv.y[t]} = ${accAfter}`, detail: `sample ${cv.cnt[t] + 1} of ${win} in this window${cv.done[t] ? ': window complete' : ''}` });
    const fr = recordsHere.find((r) => r.type === 2);
    if (fr) rows.push({ stage: 'FEATURE record', module: 'u_records', value: `energy = acc >> ${f.energyShift} = ${fr.data}${fr.flags & 1 ? ' (SAT)' : ''}`, detail: `seq ${fr.seq}; the waveform inside the window is not recoverable from this number` });
  }
  if (mode === 'EVENT') {
    const er = recordsHere.find((r) => r.type === 1);
    rows.push({ stage: 'Event decision', module: 'u_event (legacy)', value: er ? `FIRE: polarity ${(er.data >> 16) & 1 ? '−' : '+'}, magnitude ${er.data & 0xffff}` : 'no event at this sample', detail: `|residual| ≥ ${d.config.core.threshold} with hysteresis ${d.config.core.hysteresis} and refractory ${d.config.core.refractory}` });
  }
  rows.push({ stage: 'Output', module: 'rec_*', value: recordsHere.length ? recordsHere.map((r) => `${TYPE_NAME[r.type]}#${r.seq}`).join(', ') : 'no record from this sample', detail: `${recordsHere.length * RECORD_BITS} bits leave the chip for this sample in ${mode} mode` });
  return rows;
}
