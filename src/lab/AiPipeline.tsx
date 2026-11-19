// On-chip AI (v0.4): the chronological pipeline "ADC-style input → DSP → neural features → local AI → prediction"
// for one frame of rtl_trace_v04.json (or rtl_trace_v04_real.json when it exists). Every number shown is the
// RTL's (Icarus run of hbci02_digital_top); where the browser re-runs a specification formula, the RTL value is
// shown first and the browser result next to it as a check. The model's placeholder / trained status is shown
// prominently because a placeholder model's classes mean nothing.
import { useEffect, useMemo } from 'react';
import { useArtifacts } from '../artifacts/load';
import type { RtlTraceV04 } from '../artifacts/types';
import { useScene } from '../state/sceneStore';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { COUNTER_MEANING, engineCycles, frameJourney, modelCrc, type FrameJourney } from '../model/aiDecoder';
import { useTraceV04, useV04 } from './v04Store';
import './ai.css';

const chColor = (ch: number) => `var(--ch${ch})`;
const fmt = (n: number) => n.toLocaleString('en-GB');
const hex = (n: number) => '0x' + (n >>> 0).toString(16).padStart(8, '0');

/** Tiny SVG trace of one channel's window samples (RTL values). */
function Spark({ xs, color }: { xs: number[]; color: string }) {
  const W = 150, H = 34;
  if (xs.length === 0) return <svg className="ai-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} />;
  const lo = Math.min(...xs, 0), hi = Math.max(...xs, 0);
  const span = hi - lo || 1;
  const x = (k: number) => 2 + (k / Math.max(1, xs.length - 1)) * (W - 4);
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  return (
    <svg className="ai-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label={`${xs.length} samples`}>
      <line x1={2} x2={W - 2} y1={y(0)} y2={y(0)} className="ai-spark-zero" />
      <polyline points={xs.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} style={{ stroke: color }} />
    </svg>
  );
}

function Check({ ok }: { ok: boolean }) {
  return <span className={`ai-chk ${ok ? 'ok' : 'bad'}`} title={ok ? 'browser re-run of the specification formula agrees with the RTL value' : 'MISMATCH between the RTL value and the browser re-run'}>{ok ? '✓' : '✗'}</span>;
}

function Stage({ k, title, module, ids, children, tone }: { k: number; title: string; module: string; ids: string[]; children: React.ReactNode; tone?: 'input' | 'dsp' | 'ai' | 'out' }) {
  const sel = useScene((s) => s.selectedId);
  const on = !!sel && ids.includes(sel);
  return (
    <section className={`ai-stage${on ? ' on' : ''} ${tone ?? ''}`} data-testid={`ai-stage-${k}`}>
      <header className="ai-stage-h">
        <span className="ai-stage-n">{k}</span>
        <div>
          <div className="ai-stage-t">{title}</div>
          <button className="ai-stage-m mono" onClick={() => { const s = useScene.getState(); s.select(ids[0]); if (s.level !== 'die') s.setLevel('die'); }} title="Show this block on the die">{module} ↗</button>
        </div>
      </header>
      <div className="ai-stage-b">{children}</div>
    </section>
  );
}

function ModelBanner({ t, file }: { t: RtlTraceV04; file: string }) {
  const trained = t.source.model.trained;
  const crcOk = modelCrc(t.model.words) === t.model.crc32;
  const q = t.source.model.metrics?.quantised;
  return (
    <div className={`ai-model ${trained ? 'trained' : 'placeholder'}`} data-testid="ai-model-banner">
      <b>{trained ? 'TRAINED MODEL (loaded over the bus)' : 'SYNTHETIC PLACEHOLDER MODEL'}</b>
      <span>{t.source.model.label}{t.source.model.file ? ` · ${t.source.model.file}` : ''}{t.source.model.git_rev ? ` @ ${t.source.model.git_rev}` : ''}</span>
      <span className="mono faint">
        {t.model.linear ? `linear 8→${t.model.NO} (Model A: the hidden layer is skipped)` : `MLP 8→${t.model.NH}→${t.model.NO}`} · s1 = {t.model.s1} · model_id 0x{t.model.model_id.toString(16)} · CRC-32 {hex(t.model.crc32)} <Check ok={crcOk} /> (browser CRC of the 46 words)
        · {file}
      </span>
      {q && trained && <span className="faint" title="Software evaluation of the exported model on held-out recorded frames (experiments/E02_onchip_decoder, not an RTL result and not a MEASURED one)">software eval (E02, not RTL): frame balanced acc {(q.frame_balanced_acc * 100).toFixed(0)}% · epoch balanced acc (majority) {(q.epoch_balanced_acc_majority * 100).toFixed(0)}% on {q.n_frames} frames</span>}
      {!trained && <span className="ai-warn">Its classes mean nothing about the signal.</span>}
    </div>
  );
}

export function AiPipeline() {
  const { trace: t, file, hasReal, hasSynth } = useTraceV04();
  const stream = useV04((s) => s.stream);
  const setStream = useV04((s) => s.setStream);
  const loaded = useArtifacts((a) => a.loaded);
  const frame = useV04((s) => s.frame);
  const setFrame = useV04((s) => s.setFrame);
  const ch = useV04((s) => s.ch);
  const setCh = useV04((s) => s.setCh);
  const fi = t ? Math.min(frame, t.frames.length - 1) : 0;
  const j: FrameJourney | null = useMemo(() => (t ? frameJourney(t, fi) : null), [t, fi]);

  // Light the decoder path on the die while this view is open.
  useEffect(() => {
    const s = useScene.getState();
    s.setActiveBlocks(['rtl.u_energy', 'rtl.ai_quant', 'rtl.ai_collect', 'rtl.ai_engine', 'rtl.ai_fifo'], null);
    return () => useScene.getState().setActiveBlocks([], null);
  }, [fi]);

  if (!t) {
    return (
      <div className="ai empty" data-testid="ai-pipeline">
        {loaded ? <div className="missing">rtl_trace_v04.json not generated yet (run <code>make artifacts</code>). Nothing is shown instead of it.</div> : <div className="faint">Loading the v0.4 trace…</div>}
      </div>
    );
  }
  const m = t.model;
  const fr = j!.frame;
  const inf = j!.inference;
  const pred = j!.prediction;
  const cyc = engineCycles(m);
  const lat = inf ? inf.done_cycle - inf.start_cycle : null;
  const cw = j!.channels[ch];
  const nFeat = j!.channels.filter((c) => c.feature).length;
  const chDesc = (c: number) => t.ground_truth?.channels.find((g) => g.ch === c)?.description ?? (t.source.model.channels ? `recording channel ${t.source.model.channels[c]} (${t.source.stream.label})` : t.source.stream.label);

  return (
    <div className="ai" data-testid="ai-pipeline">
      <div className="ai-head">
        <EvidenceBadge e="RTL" title="Every value: Icarus Verilog simulation of hbci02_digital_top, checked against the cycle-accurate Python model before the file was written." />
        <div className="seg" title="Which recorded stimulus the RTL was run on" data-testid="ai-stream">
          <button className={stream === 'real' && hasReal ? 'on' : ''} disabled={!hasReal} onClick={() => setStream('real')} title={hasReal ? 'rtl_trace_v04_real.json: recorded neural samples through the RTL' : 'rtl_trace_v04_real.json not generated'}>Recorded</button>
          <button className={stream === 'synthetic' || !hasReal ? 'on' : ''} disabled={!hasSynth} onClick={() => setStream('synthetic')} title={hasSynth ? 'rtl_trace_v04.json: the synthetic teaching signals through the RTL' : 'rtl_trace_v04.json not generated'}>Synthetic</button>
        </div>
        <span className="ai-src" title={t.source.stream.description ?? ''}><b>Input stream:</b> {t.source.stream.label} ({t.source.stream.kind}{t.source.stream.file ? `, ${t.source.stream.file}` : ''})</span>
        <label className="ai-pick">Frame
          <select value={fi} onChange={(e) => setFrame(+e.target.value)} data-testid="ai-frame-select">
            {t.frames.map((f, k) => {
              const p = t.predictions.find((q) => q.frame === f.frame_id && q.ts === f.ts_last);
              return <option key={k} value={k}>window {f.frame_id} · ts {f.ts_first}–{f.ts_last}{p ? ` · class ${p.cls}` : ' · no prediction'}</option>;
            })}
          </select>
        </label>
        <button className="btn sm" disabled={fi === 0} onClick={() => setFrame(fi - 1)}>◀</button>
        <button className="btn sm" disabled={fi >= t.frames.length - 1} onClick={() => setFrame(fi + 1)}>▶</button>
        <span className="mono faint">{t.frames.length} frames · {t.predictions.length} predictions · mode {t.config.mode} · window 2^{t.config.win_log2} = {j!.winSamples} samples · {t.checks.passed}/{t.checks.total} checks</span>
      </div>
      <ModelBanner t={t} file={file ?? 'rtl_trace_v04.json'} />
      <div className="ai-flow">
        <Stage k={1} title="ADC-style input: the 8 channels' samples of this window" module="in_sample → hbci_readout_core" ids={['rtl.readout', 'die.pads']} tone="input">
          <div className="ai-chrow">
            {j!.channels.map((c) => (
              <button key={c.ch} className={`ai-chbtn${c.ch === ch ? ' on' : ''}`} style={{ ['--cc' as string]: chColor(c.ch) }} onClick={() => setCh(c.ch)} title={chDesc(c.ch)}>
                <span className="mono">ch{c.ch}</span>
                <Spark xs={c.samples.map((s) => s.x)} color={chColor(c.ch)} />
                <span className="faint">{c.feature ? `i ${c.samples[0]?.i ?? '?'}–${c.feature.ts}` : 'not in frame'}</span>
              </button>
            ))}
          </div>
          <div className="ai-note">
            ch{ch}: {cw.samples.length} accepted samples (ADC codes, dimensionless), sample index i {cw.samples[0]?.i ?? '?'} to {cw.feature?.ts ?? '?'}, cycles {cw.samples[0]?.cycle ?? '?'}–{cw.samples[cw.samples.length - 1]?.cycle ?? '?'}.
            <span className="faint"> {chDesc(ch)}</span>
          </div>
          <div className="ai-vals mono">{cw.samples.map((s) => s.x).join(' ')}</div>
        </Stage>

        <Stage k={2} title="DSP: band-pass + window energy per channel (FEATURE)" module="u_biquad → u_energy" ids={['rtl.u_energy', 'rtl.u_biquad', 'rtl.u_fstate']} tone="dsp">
          <table className="ai-table">
            <thead><tr><th>ch</th><th>win_idx</th><th>ts (last sample)</th><th>energy E</th><th>sat</th><th>tap cycle</th></tr></thead>
            <tbody>
              {j!.channels.map((c) => (
                <tr key={c.ch} className={c.ch === ch ? 'on' : ''} onClick={() => setCh(c.ch)}>
                  <td className="mono" style={{ color: chColor(c.ch) }}>ch{c.ch}</td>
                  {c.feature ? <><td className="mono">{c.feature.win}</td><td className="mono">{c.feature.ts}</td><td className="mono">{fmt(c.feature.energy)}</td><td className="mono">{c.feature.sat}</td><td className="mono faint">{c.feature.cycle}</td></> : <td colSpan={5} className="faint">channel not in this frame</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ai-note faint">E = sat32(Σy² ≫ {t.config.energy_shift}) over {j!.winSamples} filtered samples; each row left the DSP core on the ai_feat_* tap at the cycle shown, with its window index. {nFeat}/{t.profile.num_channels} channels present.</div>
        </Stage>

        <Stage k={3} title="Quantiser: L = 64·log2(E), then x = sat_int8((L − centre) ≫ qshift)" module="u_quant · hbci_feat_quant" ids={['rtl.ai_quant']} tone="ai">
          <table className="ai-table">
            <thead><tr><th>ch</th><th>E</th><th>L (RTL)</th><th>check</th><th>centre</th><th>qshift</th><th>x (RTL)</th><th>check</th></tr></thead>
            <tbody>
              {j!.channels.map((c, k) => (
                <tr key={c.ch} className={c.ch === ch ? 'on' : ''}>
                  <td className="mono" style={{ color: chColor(c.ch) }}>ch{c.ch}</td>
                  {c.feature ? (
                    <>
                      <td className="mono">{fmt(c.feature.energy)}</td>
                      <td className="mono">{c.feature.L}</td><td><Check ok={j!.quantCheck[k].L === c.feature.L} /> <span className="faint mono">{j!.quantCheck[k].L}</span></td>
                      <td className="mono">{m.centre[c.ch]}</td><td className="mono">{m.qshift[c.ch]}</td>
                      <td className="mono"><b>{c.feature.x}</b></td><td><Check ok={j!.quantCheck[k].x === c.feature.x} /> <span className="faint mono">{j!.quantCheck[k].x}</span></td>
                    </>
                  ) : <td colSpan={7} className="faint">x = 0 (channel absent / masked)</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ai-note faint">L is 64 × the position of the leading 1 plus the six bits below it (≈ 64·log2 E). "check" = the same formula re-run in the browser from the RTL energy; the RTL value stands.</div>
        </Stage>

        <Stage k={4} title="Frame collector: one x from every channel, all from the same window index" module="u_collect · hbci_frame_collector" ids={['rtl.ai_collect']} tone="ai">
          <div className="ai-kv mono">
            <span>frame_id (window index)</span><b>{fr.frame_id}</b>
            <span>ts_first – ts_last</span><b>{fr.ts_first} – {fr.ts_last}</b><span className="faint">span {fr.ts_last - fr.ts_first} ≤ FRAME_SPAN {t.config.frame_span === 4294967295 ? 'disabled' : t.config.frame_span}</span>
            <span>ch_mask</span><b>0x{t.config.ch_mask.toString(16)}</b>
            <span>sat_mask</span><b>0b{fr.sat_mask.toString(2).padStart(8, '0')}</b>
            <span>complete at cycle</span><b>{fr.complete_cycle}</b>
          </div>
          <div className="ai-xrow">
            {fr.x.map((x, c) => <span key={c} className="ai-x" style={{ ['--cc' as string]: chColor(c) }}><small>x{c}</small><b className="mono">{x}</b></span>)}
          </div>
          <div className="ai-note faint">The frame moves to the 1-deep pending register and starts the engine {t.latency.frame_complete_to_engine_start} cycle(s) later. Rules: same win_idx or the frame is abandoned (counted as incomplete / duplicate / late / span).</div>
        </Stage>

        <Stage k={5} title={`Local AI: ${m.linear ? 'linear model 8→' + m.NO + ' (hidden layer skipped, h reads 0)' : 'MLP 8→' + m.NH + '→' + m.NO} on one shared multiplier`} module="u_engine · hbci_mlp_engine" ids={['rtl.ai_engine', 'rtl.ai_model']} tone="ai">
          {inf ? (
            <>
              <div className="ai-kv mono">
                <span>start → done cycles</span><b>{inf.start_cycle} → {inf.done_cycle}</b><span className="faint">{lat} cycles; formula {t.latency.formula} = {cyc} <Check ok={lat === cyc} /></span>
                {inf.aborted !== null && <><span>aborted</span><b>{String(inf.aborted)}</b></>}
              </div>
              {!m.linear && (
                <table className="ai-table">
                  <thead><tr><th>hidden h</th>{Array.from({ length: m.NH }, (_, k) => <th key={k}>h{k}</th>)}</tr></thead>
                  <tbody>
                    <tr><td className="faint">a1 = b1 + Σ W1·x (check)</td>{Array.from({ length: m.NH }, (_, k) => <td key={k} className="mono faint">{j!.mlpCheck.a1[k]}</td>)}</tr>
                    <tr><td>h = clamp(a1 ≫ {m.s1}, 0, 127) <b>RTL</b></td>{Array.from({ length: m.NH }, (_, k) => <td key={k} className="mono"><b>{inf.h[k]}</b> <Check ok={inf.h[k] === j!.mlpCheck.h[k]} /></td>)}</tr>
                  </tbody>
                </table>
              )}
              <table className="ai-table">
                <thead><tr><th>output</th>{inf.logits.map((_, o) => <th key={o}>logit{o}</th>)}</tr></thead>
                <tbody>
                  <tr><td className="faint">a2 = b2 + Σ W2·{m.linear ? 'x' : 'h'} (check)</td>{inf.logits.map((_, o) => <td key={o} className="mono faint">{j!.mlpCheck.a2[o]}</td>)}</tr>
                  <tr><td>logit <b>RTL</b></td>{inf.logits.map((l, o) => <td key={o} className={`mono${o === inf.cls ? ' win' : ''}`}><b>{l}</b> <Check ok={l === j!.mlpCheck.a2[o]} /></td>)}</tr>
                </tbody>
              </table>
              <div className="ai-kv mono">
                <span>class = argmax</span><b>{inf.cls}</b><span className="faint"><Check ok={inf.cls === j!.mlpCheck.cls} /> browser {j!.mlpCheck.cls}</span>
                <span>margin = logit{inf.cls} − best other</span><b>{fmt(inf.margin)}</b><span className="faint"><Check ok={inf.margin === j!.mlpCheck.margin} /> browser {fmt(j!.mlpCheck.margin)}</span>
              </div>
              {!t.source.model.trained && <div className="ai-warn">Placeholder model: this class and margin exercise the hardware only and mean nothing about the signal.</div>}
              {t.source.model.trained && <div className="ai-note faint">Class {inf.cls} is the trained model's output for this frame. Whether it is right is a software question (E02 evaluation), not something the RTL can tell; nothing here is MEASURED.</div>}
            </>
          ) : <div className="faint">No inference recorded for this frame (dropped while busy, or no verified model).</div>}
        </Stage>

        <Stage k={6} title="Prediction record that left the FIFO" module="prediction FIFO (hbci_ai_decoder top-level) → PRED_* registers / pred pins" ids={['rtl.ai_fifo', 'rtl.regs']} tone="out">
          {pred ? (
            <>
              <div className="ai-kv mono">
                <span>class</span><b>{pred.cls}</b>
                <span>margin</span><b>{fmt(pred.margin)}</b>
                <span>ts (ts_last)</span><b>{pred.ts}</b>
                <span>frame_id</span><b>{pred.frame}</b>
                <span>seq</span><b>{pred.seq}</b>
                <span>flags</span><b>0b{pred.flags.toString(2).padStart(4, '0')}</b><span className="faint">sat {pred.flags & 1} · gap {(pred.flags >> 1) & 1}</span>
                <span>popped at cycle</span><b>{pred.cycle}</b>
              </div>
              <div className="ai-lat">
                <span className="faint">Latency, cycles:</span>
                <span>window complete <b className="mono">{fr.complete_cycle}</b></span><span>→ engine start <b className="mono">+{inf ? inf.start_cycle - fr.complete_cycle : '?'}</b></span><span>→ done <b className="mono">+{lat ?? '?'}</b></span><span>→ host pop <b className="mono">+{inf ? pred.cycle - inf.done_cycle : '?'}</b> (testbench read)</span>
                <span className="faint">= {pred.cycle - fr.complete_cycle} cycles from the last sample of the window to the host reading the prediction; the engine itself: {t.latency.engine_start_to_fifo}.</span>
              </div>
            </>
          ) : <div className="faint">No prediction left the FIFO for this frame.</div>}
        </Stage>
      </div>
      <div className="ai-foot">
        <span className="faint">Counters at the end of the run (RTL): </span>
        {Object.entries(t.counters).filter(([k]) => k.startsWith('ai_')).map(([k, v]) => <span key={k} className="ai-ctr mono" title={COUNTER_MEANING[k] ?? k}>{k.replace('ai_', '')} {v}</span>)}
        <span className="faint"> · records {t.records.total} ({Object.entries(t.records.counts).map(([k, v]) => `${k} ${v}`).join(', ')}) · RTL sha256 {t.rtl_sha256.slice(0, 10)}… (the four v0.4 source files) · {t.evidence.note}</span>
      </div>
    </div>
  );
}
