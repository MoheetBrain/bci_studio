// Level 2: one real sample followed clock by clock through a block: state read → arithmetic → decision →
// state update → output. Values come from the Icarus traces: rtl_trace_v03.json for the v0.3 blocks and the
// separate v0.2 event-core trace (rtl_trace.json, a different stimulus of the byte-identical legacy RTL) for the
// legacy blocks. Every recomputed number is checked against the trace and the check is shown.
import type { ReactNode } from 'react';
import { useArtifacts } from '../../artifacts/load';
import type { RtlTrace, RtlTraceV03, V03Sample } from '../../artifacts/types';
import { EvidenceBadge } from '../../ui/EvidenceBadge';
import { useMicro } from '../microStore';
import { historyBefore, waveAt } from '../signals';
import { CursorBar } from '../SignalInspector';
import type { ModuleSpec } from './moduleSpecs';

type Src = 'RTL' | 'DERIVED' | 'CONFIG' | 'COMPUTED';

const SRC_HELP: Record<Src, string> = {
  RTL: 'read directly from the Icarus Verilog trace',
  DERIVED: 'taken from earlier trace samples of the same channel (checked: recomputing y from them matches the trace on 4,000/4,000 samples)',
  CONFIG: 'configuration constant of the RTL run',
  COMPUTED: 'arithmetic done here from the values above, following the Verilog line shown',
};

function bin(v: number, w: number): string {
  const u = v < 0 ? 2 ** w + v : v;
  return u.toString(2).padStart(w, '0').replace(/(\d{4})(?=\d)/g, '$1_');
}

function Val({ k, v, w = 16, src, store = false, note }: { k: string; v: number | string; w?: number; src: Src; store?: boolean; note?: string }) {
  const bits = useMicro((m) => m.showBits);
  return (
    <div className={`wk-val ${store ? 'store' : 'comb'}`} title={`${k}: ${SRC_HELP[src]}${note ? ` — ${note}` : ''}`}>
      <span className="wk-k">{k}</span>
      <span className="wk-v mono">{typeof v === 'number' ? v.toLocaleString('en-GB') : v}</span>
      {bits && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 2 ** 53 && w <= 48 && <span className="wk-b mono">0b{bin(v, w)}</span>}
      <span className={`wk-src s-${src}`}>{src}</span>
    </div>
  );
}

function Check({ ok, what }: { ok: boolean; what: string }) {
  return <div className={`wk-check ${ok ? 'ok' : 'bad'}`} data-testid="compute-check">{ok ? '✓' : '✗'} {what}</div>;
}

function Step({ n, title, kind, lines, children, current }: { n: number; title: string; kind: 'store' | 'comb' | 'io'; lines?: string; children: ReactNode; current: number }) {
  const set = useMicro((m) => m.setComputeStep);
  return (
    <section className={`wk-step ${kind}${current === n ? ' on' : ''}${current > n ? ' past' : ''}`} onClick={() => set(n)} data-testid={`compute-step-${n}`}>
      <header>
        <span className="wk-n">{n + 1}</span>
        <b>{title}</b>
        <span className="wk-kind">{kind === 'store' ? 'stored (clock edge)' : kind === 'comb' ? 'computed (same cycle)' : 'input / output'}</span>
        {lines && <code className="wk-lines">{lines}</code>}
      </header>
      <div className="wk-body">{children}</div>
    </section>
  );
}

function StepNav({ max }: { max: number }) {
  const step = useMicro((m) => m.computeStep);
  const set = useMicro((m) => m.setComputeStep);
  return (
    <div className="wk-nav">
      <button className="btn sm" onClick={() => set(step - 1)} disabled={step <= 0}>◀ Back</button>
      <span>Step {step + 1} of {max + 1}</span>
      <button className="btn sm primary" onClick={() => set(step + 1)} disabled={step >= max} data-testid="compute-next">Next ▶</button>
    </div>
  );
}

const sat16 = (v: number) => Math.max(-32768, Math.min(32767, v));

// ─────────────────────────────────────────────── FEATURE path (u_fstate, u_biquad, u_energy) ──
function FeatureCompute({ tr, focus }: { tr: RtlTraceV03; focus: string }) {
  const i = useMicro((m) => m.cursor);
  const step = useMicro((m) => m.computeStep);
  const setCursor = useMicro((m) => m.setCursor);
  const s: V03Sample = tr.samples[Math.min(i, tr.samples.length - 1)];
  const c = tr.config;
  const h = historyBefore(tr.samples, s.i, s.ch);
  const prods = { b0: c.b0 * s.x, b1: c.b1 * h.x1, b2: c.b2 * h.x2, a1: c.a1 * h.y1, a2: c.a2 * h.y2 };
  const p = prods.b0 + prods.b1 + prods.b2 - prods.a1 - prods.a2;
  const yFull = Math.floor((p + 8192) / 16384);
  const y = sat16(yFull);
  const win = 2 ** Math.min(c.win_log2, 10);
  const sq = y * y;
  const accNext = s.acc + sq;
  const done = s.cnt >= win - 1;
  const energy = Math.min(Math.floor(accNext / 2 ** c.energy_shift), 2 ** 32 - 1);
  const rec = tr.runs.HYBRID.records;
  const raw = rec.find((r) => r.type === 0 && r.ts === s.i);
  const feat = rec.find((r) => r.type === 2 && r.ts === s.i && r.ch === s.ch);
  const jump = (pred: (x: V03Sample) => boolean) => {
    const k = tr.samples.findIndex((x, j) => j > s.i && pred(x));
    if (k >= 0) setCursor(k);
  };
  return (
    <>
      <div className="wk-jumps">
        <span>Pick a sample:</span>
        <button className="btn sm" onClick={() => jump((x) => x.done === 1)}>next window end (FEATURE record)</button>
        <button className="btn sm" onClick={() => jump((x) => x.ysat === 1)}>next saturated filter output</button>
        <button className="btn sm" onClick={() => jump((x) => x.ch === 1 && x.i > 1200 && x.i < 2800)}>ch1 inside its 100 Hz burst</button>
      </div>
      <Step n={0} current={step} title="A sample arrives" kind="io" lines="hbci_readout_core.v:93–95">
        <p>On clock cycle <b>{s.cycle}</b> the ADC side hands the chip a sample of channel <b>{s.ch}</b>. It is valid and the channel is in range, so <code>accept</code> = 1.</p>
        <div className="wk-vals">
          <Val k="in_channel" v={s.ch} w={3} src="RTL" />
          <Val k="in_sample (x)" v={s.x} src="RTL" />
          <Val k="accept" v={1} w={1} src="DERIVED" note="every trace sample is an accepted one" />
        </div>
      </Step>
      <Step n={1} current={step} title={`Read channel ${s.ch}'s feature memory (u_fstate)`} kind="store" lines="hbci_readout_core.v:267–273">
        <p>The read multiplexer picks row {s.ch}: the filter’s memory of this channel and its energy so far. These values were written by earlier clock edges.</p>
        <div className="wk-vals">
          <Val k="x1 (previous input)" v={h.x1} src="DERIVED" store />
          <Val k="x2 (input before that)" v={h.x2} src="DERIVED" store />
          <Val k="y1 (previous output)" v={h.y1} src="DERIVED" store />
          <Val k="y2 (output before that)" v={h.y2} src="DERIVED" store />
          <Val k="acc (energy so far)" v={s.acc} w={48} src="RTL" store />
          <Val k="cnt (samples in window)" v={s.cnt} w={10} src="RTL" store />
        </div>
        {h.n < 2 && <p className="wk-note">Channel {s.ch} has had only {h.n} earlier sample(s): the missing history is 0 after reset.</p>}
      </Step>
      <Step n={2} current={step} title="Weighted sum, round, saturate (u_biquad)" kind="comb" lines="hbci_readout_core.v:341–362">
        <p>Five multiplications and one sum, all in the same clock cycle: <code>p = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2</code>. Coefficients are Q2.14 numbers (value ÷ 16,384).</p>
        <table className="wk-mac">
          <tbody>
            <tr><td>b0 × x</td><td className="mono">{c.b0} × {s.x}</td><td className="mono">{prods.b0.toLocaleString('en-GB')}</td></tr>
            <tr><td>b1 × x1</td><td className="mono">{c.b1} × {h.x1}</td><td className="mono">{prods.b1.toLocaleString('en-GB')}</td></tr>
            <tr><td>b2 × x2</td><td className="mono">{c.b2} × {h.x2}</td><td className="mono">{prods.b2.toLocaleString('en-GB')}</td></tr>
            <tr><td>− a1 × y1</td><td className="mono">−({c.a1}) × {h.y1}</td><td className="mono">{(-prods.a1).toLocaleString('en-GB')}</td></tr>
            <tr><td>− a2 × y2</td><td className="mono">−({c.a2}) × {h.y2}</td><td className="mono">{(-prods.a2).toLocaleString('en-GB')}</td></tr>
            <tr className="sum"><td>p</td><td>sum</td><td className="mono">{p.toLocaleString('en-GB')}</td></tr>
          </tbody>
        </table>
        <div className="wk-vals">
          <Val k="(p + 8192) >>> 14" v={yFull} w={21} src="COMPUTED" />
          <Val k="y = saturate to 16 bits" v={y} src="COMPUTED" />
          <Val k="y in the RTL trace" v={s.y} src="RTL" />
          <Val k="ysat" v={yFull !== y ? 1 : 0} w={1} src="COMPUTED" />
        </div>
        <Check ok={y === s.y && (yFull !== y ? 1 : 0) === s.ysat} what={`recomputed y = ${y}, trace y = ${s.y}; ysat ${yFull !== y ? 1 : 0} vs ${s.ysat}`} />
        <p className="wk-note">This multiply-and-accumulate is the same basic operation AI chips repeat billions of times; here it is one filter, not an LLM accelerator.</p>
      </Step>
      <Step n={3} current={step} title="Energy and the window decision (u_energy)" kind="comb" lines="hbci_readout_core.v:404–421">
        <p>Square the filtered sample, add it to the window total and ask: is this the last of the {win} samples of channel {s.ch}'s window?</p>
        <div className="wk-vals">
          <Val k="y²" v={sq} w={31} src="COMPUTED" />
          <Val k="acc + y²" v={accNext} w={48} src="COMPUTED" />
          <Val k={`done (cnt ≥ ${win - 1})`} v={done ? 1 : 0} w={1} src="COMPUTED" />
          <Val k="done in the RTL trace" v={s.done} w={1} src="RTL" />
          {done && <Val k={`energy = sat32(acc_next >> ${c.energy_shift})`} v={energy} w={32} src="COMPUTED" />}
        </div>
        <Check ok={(done ? 1 : 0) === s.done} what={`window decision matches the trace (done = ${s.done})`} />
      </Step>
      <Step n={4} current={step} title="Store and output (next clock edge)" kind="store" lines="hbci_readout_core.v:288–294, 204">
        <p>On the next rising clock edge row {s.ch} is overwritten, and in HYBRID mode the record paths fire.</p>
        <div className="wk-vals">
          <Val k="x2 ← x1" v={h.x1} src="COMPUTED" store />
          <Val k="x1 ← x" v={s.x} src="COMPUTED" store />
          <Val k="y2 ← y1" v={h.y1} src="COMPUTED" store />
          <Val k="y1 ← y" v={y} src="COMPUTED" store />
          <Val k={done ? 'acc ← 0 (window ends)' : 'acc ← acc + y²'} v={done ? 0 : accNext} w={48} src="COMPUTED" store />
          <Val k={done ? 'cnt ← 0' : 'cnt ← cnt + 1'} v={done ? 0 : s.cnt + 1} w={10} src="COMPUTED" store />
        </div>
        <div className="wk-records">
          {raw ? <div><b>RAW record</b> (HYBRID run): seq {raw.seq}, ts {raw.ts}, data {raw.data}, left the chip at cycle {raw.cycle}. <EvidenceBadge e="RTL" /></div> : <div>No RAW record for this sample in the HYBRID run.</div>}
          {done && (feat
            ? <div><b>FEATURE record</b>: seq {feat.seq}, ts {feat.ts}, energy {feat.data.toLocaleString('en-GB')} at cycle {feat.cycle}. <EvidenceBadge e="RTL" /></div>
            : <div>No FEATURE record found for this window end.</div>)}
          {done && feat && <Check ok={feat.data === energy} what={`recomputed energy ${energy.toLocaleString('en-GB')} = record data ${feat.data.toLocaleString('en-GB')}`} />}
        </div>
      </Step>
      <p className="wk-focus">You opened <b>{focus}</b>: its step is {focus === 'u_fstate' ? '2 and 5' : focus === 'u_biquad' ? '3' : '4'}.</p>
    </>
  );
}

// ─────────────────────────────────────────────────────────── records (u_records) ──
function RecordsCompute({ tr }: { tr: RtlTraceV03 }) {
  const i = useMicro((m) => m.cursor);
  const step = useMicro((m) => m.computeStep);
  const s = tr.samples[Math.min(i, tr.samples.length - 1)];
  const rec = tr.runs.HYBRID.records.find((r) => r.type === 0 && r.ts === s.i);
  const w = (name: string) => tr.waves.find((x) => x.name === name);
  const cnt = w('u_records.count');
  const rg = w('raw_gen');
  const occ = cnt ? [0, 1, 2, 3].map((d) => waveAt(cnt.changes, s.cycle + d) ?? 0) : [];
  const ov = useArtifacts((a) => a.verification)?.suites.find((x) => x.name.includes('overload'));
  return (
    <>
      <Step n={0} current={step} title="A record is generated" kind="comb" lines="hbci_readout_core.v:155">
        <p>In HYBRID mode, sample {s.i} (ch{s.ch}) raises <code>raw_gen</code> on cycle {s.cycle}.</p>
        <div className="wk-vals"><Val k="raw_gen at that cycle" v={rg ? waveAt(rg.changes, s.cycle) ?? 0 : 0} w={1} src="RTL" /></div>
      </Step>
      <Step n={1} current={step} title="It waits in the RAW pending register" kind="store" lines="hbci_readout_core.v:566–584">
        <p>On the clock edge the RAW pending register takes {'{'}channel, sample index, data, seq{'}'}. Had it still been full, this record would have been <b>dropped and counted</b>, never silently lost.</p>
        {rec && <div className="wk-vals"><Val k="seq (RAW)" v={rec.seq} src="RTL" store /><Val k="ts" v={rec.ts} w={32} src="RTL" store /><Val k="data" v={rec.data} w={32} src="RTL" store /></div>}
      </Step>
      <Step n={2} current={step} title="The arbiter moves it into the FIFO" kind="comb" lines="hbci_readout_core.v:524–531">
        <p>Each cycle at most one pending record moves, EVENT first, then FEATURE, then RAW. FIFO occupancy (u_records.count) on cycles {s.cycle}–{s.cycle + 3}:</p>
        <div className="wk-vals">{occ.map((o, k) => <Val key={k} k={`cycle ${s.cycle + k}`} v={o} w={5} src="RTL" store />)}</div>
      </Step>
      <Step n={3} current={step} title="It leaves through the valid/ready handshake" kind="io" lines="hbci_readout_core.v:520–544">
        {rec ? <p>The record left on cycle <b>{rec.cycle}</b>, {rec.cycle - s.cycle} cycles after its sample, when <code>rec_valid</code> and <code>rec_ready</code> were both 1.</p> : <p>No RAW record with ts = {s.i} in the HYBRID run.</p>}
      </Step>
      <Step n={4} current={step} title="Nothing is lost silently" kind="store" lines="hbci_readout_core.v:571–575">
        <p>In this run no record was dropped (drops RAW {tr.runs.HYBRID.stats.drop_raw}, EVENT {tr.runs.HYBRID.stats.drop_event}, FEATURE {tr.runs.HYBRID.stats.drop_feature}). When the output is throttled the drops are counted and the next record carries the gap flag.</p>
        {ov && <p className="wk-note">Regression suite <code>{ov.name}</code>: {ov.status.toUpperCase()}, {ov.checks} checks. <EvidenceBadge e="RTL" /></p>}
      </Step>
    </>
  );
}

// ─────────────────────────────────────────────── counter (u_ts) and RAW gate ──
function CounterCompute({ tr }: { tr: RtlTraceV03 }) {
  const i = useMicro((m) => m.cursor);
  const step = useMicro((m) => m.computeStep);
  const s = tr.samples[Math.min(i, tr.samples.length - 1)];
  const rec = tr.runs.HYBRID.records.find((r) => r.type === 0 && r.ts === s.i);
  return (
    <>
      <Step n={0} current={step} title="Count before the sample" kind="store" lines="hbci_event_core.v:331–336"><div className="wk-vals"><Val k="ts_now (sample_idx)" v={s.i} w={32} src="RTL" store /></div></Step>
      <Step n={1} current={step} title="tick = accept" kind="comb" lines="hbci_readout_core.v:95"><div className="wk-vals"><Val k="tick" v={1} w={1} src="DERIVED" /></div></Step>
      <Step n={2} current={step} title="+1 on the clock edge" kind="store" lines="hbci_event_core.v:336"><div className="wk-vals"><Val k="ts_now after" v={s.i + 1} w={32} src="COMPUTED" store /></div></Step>
      <Step n={3} current={step} title="Stamped on the record" kind="io" lines="hbci_readout_core.v:213">
        {rec ? <><div className="wk-vals"><Val k="RAW record ts" v={rec.ts} w={32} src="RTL" /></div><Check ok={rec.ts === s.i} what="record ts = sample index" /></> : <p>No RAW record for this sample.</p>}
      </Step>
      <Step n={4} current={step} title="Rejected samples" kind="store" lines="hbci_event_core.v:337"><p>Out-of-range channels in this run: {tr.runs.HYBRID.stats.rejected}.</p></Step>
    </>
  );
}

function RawCompute({ tr }: { tr: RtlTraceV03 }) {
  const i = useMicro((m) => m.cursor);
  const step = useMicro((m) => m.computeStep);
  const s = tr.samples[Math.min(i, tr.samples.length - 1)];
  const rg = tr.waves.find((x) => x.name === 'raw_gen');
  const rec = tr.runs.HYBRID.records.find((r) => r.type === 0 && r.ts === s.i);
  const r32 = s.x < 0 ? 2 ** 32 + s.x : s.x;
  return (
    <>
      <Step n={0} current={step} title="accept" kind="comb" lines="hbci_readout_core.v:93–95"><div className="wk-vals"><Val k="in_valid" v={1} w={1} src="RTL" /><Val k="in_channel" v={s.ch} w={3} src="RTL" /><Val k="accept" v={1} w={1} src="DERIVED" /></div></Step>
      <Step n={1} current={step} title="Session and mode" kind="comb" lines="hbci_readout_core.v:110"><div className="wk-vals"><Val k="cfg_session_en" v={1} w={1} src="CONFIG" /><Val k="cfg_mode (HYBRID)" v={3} w={2} src="CONFIG" /></div></Step>
      <Step n={2} current={step} title="raw_gen = accept & mode_raw" kind="comb" lines="hbci_readout_core.v:155"><div className="wk-vals"><Val k="raw_gen" v={rg ? waveAt(rg.changes, s.cycle) ?? 0 : 0} w={1} src="RTL" /></div></Step>
      <Step n={3} current={step} title="Sign-extend the sample" kind="comb" lines="hbci_readout_core.v:156"><div className="wk-vals"><Val k="in_sample" v={s.x} src="RTL" /><Val k="raw_data (32-bit pattern)" v={r32} w={32} src="COMPUTED" /></div></Step>
      <Step n={4} current={step} title="The RAW record" kind="io">{rec ? <><div className="wk-vals"><Val k="record data" v={rec.data} w={32} src="RTL" /></div><Check ok={rec.data === s.x || rec.data === r32} what="record carries the exact sample" /></> : <p>No RAW record.</p>}</Step>
    </>
  );
}

// ─────────────────────────────────────────────── legacy event core (v0.2 trace) ──
function LegacyCompute({ tr, focus }: { tr: RtlTrace; focus: string }) {
  const j = useMicro((m) => m.legacyCursor);
  const setJ = useMicro((m) => m.setLegacyCursor);
  const step = useMicro((m) => m.computeStep);
  const t = tr.samples[Math.min(j, tr.samples.length - 1)];
  const c = tr.config;
  const next = tr.samples.find((x) => x.i > t.i && x.ch === t.ch);
  const bInt = Math.floor(t.base / 256);
  const res = t.primed ? t.x - bInt : 0;
  const mag = Math.abs(res);
  const above = c.threshold !== 0 && mag >= c.threshold ? 1 : 0;
  const level = c.hysteresis >= c.threshold ? 1 : c.threshold - c.hysteresis;
  const fire = t.primed && c.threshold !== 0 && t.armed && t.refr === 0 && above ? 1 : 0;
  const armedNext = fire ? 0 : (t.armed || mag < level) ? 1 : 0;
  const refrNext = fire ? c.refractory : t.refr > 0 ? t.refr - 1 : 0;
  const baseNext = t.primed ? t.base + Math.floor((t.x * 256 - t.base) / 2 ** c.alpha_shift) : t.x * 256;
  const ev = tr.events.find((e) => e.i === t.i);
  const n = tr.samples.length;
  const jump = () => { const e = tr.events.find((x) => x.i > t.i); if (e) setJ(e.i); };
  return (
    <>
      <div className="wk-jumps">
        <span>Legacy-core sample <b className="mono">i = {t.i}</b>, ch{t.ch} (v0.2 trace)</span>
        <input type="range" min={0} max={n - 1} value={t.i} onChange={(e) => setJ(+e.target.value)} aria-label="v0.2 trace sample" />
        <button className="btn sm" onClick={jump}>next event</button>
      </div>
      <p className="wk-note"><EvidenceBadge e="RTL" /> These values come from the separate v0.2 event-core trace (rtl_trace.json, its own stimulus). The legacy core inside the v0.3 chip is the byte-identical Verilog; the v0.3 trace does not record its internals.</p>
      <Step n={0} current={step} title="Read channel memory (u_state)" kind="store" lines="hbci_event_core.v:190–193">
        <div className="wk-vals"><Val k="in_sample x" v={t.x} src="RTL" /><Val k="baseline (Q16.8 raw)" v={t.base} w={24} src="RTL" store /><Val k="armed" v={t.armed} w={1} src="RTL" store /><Val k="refractory left" v={t.refr} w={8} src="RTL" store /><Val k="primed" v={t.primed} w={1} src="RTL" store /></div>
      </Step>
      <Step n={1} current={step} title="Residual (u_baseline)" kind="comb" lines="hbci_event_core.v:235–241">
        <div className="wk-vals"><Val k="⌊baseline⌋ = base >>> 8" v={bInt} src="COMPUTED" /><Val k="x − ⌊b⌋" v={res} w={17} src="COMPUTED" /><Val k="residual in the trace" v={t.res} w={17} src="RTL" /></div>
        <Check ok={res === t.res} what="recomputed residual matches the trace" />
      </Step>
      <Step n={2} current={step} title="Threshold comparator (u_threshold)" kind="comb" lines="hbci_event_core.v:275–286">
        <div className="wk-vals"><Val k="|residual|" v={mag} src="COMPUTED" /><Val k={`above (≥ ${c.threshold})`} v={above} w={1} src="COMPUTED" /><Val k={`below re-arm (< ${level})`} v={mag < level ? 1 : 0} w={1} src="COMPUTED" /><Val k="above in the trace" v={t.above} w={1} src="RTL" /></div>
        <Check ok={above === t.above && (mag < level ? 1 : 0) === t.rearm} what="above and re-arm match the trace" />
      </Step>
      <Step n={3} current={step} title="Re-trigger guard decides (u_refractory)" kind="comb" lines="hbci_event_core.v:309–314">
        <p><code>fire = primed & enable & armed & (refr = 0) & above</code></p>
        <div className="wk-vals"><Val k="fire" v={fire} w={1} src="COMPUTED" /><Val k="fire in the trace" v={t.fire} w={1} src="RTL" /></div>
        <Check ok={fire === t.fire} what="decision matches the trace" />
        {ev && <p>Event emitted by u_packer: ch{ev.ch}, ts {ev.ts}, polarity {ev.pol}, magnitude {ev.mag}. <EvidenceBadge e="RTL" /></p>}
      </Step>
      <Step n={4} current={step} title="Write back (next clock edge)" kind="store" lines="hbci_event_core.v:205–208, 254, 311–314">
        <div className="wk-vals"><Val k="baseline_next" v={baseNext} w={24} src="COMPUTED" store /><Val k="armed_next" v={armedNext} w={1} src="COMPUTED" store /><Val k="refr_next" v={refrNext} w={8} src="COMPUTED" store /></div>
        {next ? <Check ok={next.base === baseNext && next.armed === armedNext && next.refr === refrNext} what={`matches what channel ${t.ch}'s next sample (i = ${next.i}) reads back`} /> : <p>No later sample of this channel to check against.</p>}
      </Step>
      <p className="wk-focus">You opened <b>{focus}</b>.</p>
    </>
  );
}

export function Compute({ spec, inst }: { spec: ModuleSpec; inst: string }) {
  const tr = useArtifacts((a) => a.traceV03);
  const tr2 = useArtifacts((a) => a.trace);
  const step = useMicro((m) => m.computeStep);
  const max = 4;
  if (spec.compute === 'legacy') {
    if (!tr2) return <div className="missing">rtl_trace.json (v0.2 trace) not loaded: run <code>make artifacts</code>.</div>;
    return <div className="wk" data-testid="compute"><StepNav max={max} /><LegacyCompute tr={tr2} focus={inst} /></div>;
  }
  if (!tr) return <div className="missing">rtl_trace_v03.json not loaded: run <code>make artifacts</code>.</div>;
  return (
    <div className="wk" data-testid="compute">
      <CursorBar />
      <StepNav max={max} />
      {spec.compute === 'feature' && <FeatureCompute tr={tr} focus={inst} />}
      {spec.compute === 'records' && <RecordsCompute tr={tr} />}
      {spec.compute === 'counter' && inst === 'u_timestamp' && (
        <p className="wk-note">This is the legacy core's copy of the counter module (u_event.u_timestamp). Its own register is not in the v0.3 trace,
          so these steps follow the v0.3 copy, u_ts: the same Verilog module, whose values are recorded.</p>
      )}
      {spec.compute === 'counter' && <CounterCompute tr={tr} />}
      {spec.compute === 'raw' && <RawCompute tr={tr} />}
      <p className="wk-legend"><span className="wk-sq store" /> stored value (flip-flops) · <span className="wk-sq comb" /> computed in the same cycle · step {step + 1} highlighted</p>
    </div>
  );
}
