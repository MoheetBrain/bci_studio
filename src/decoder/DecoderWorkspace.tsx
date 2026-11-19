// Decoder: how eight numbers become a prediction on the chip, one clock cycle at a time.
//
// Every value in the diagram comes from artifacts/rtl_trace_v04_real.json: a Verilog simulation of the integrated
// digital top fed with recorded human ECoG samples, running a decoder that was trained offline in software. The chip
// has not been fabricated; nothing here was computed by silicon, and the model's accuracy figures are an offline,
// single-subject, single-session software evaluation (chip/docs/ML_EVALUATION.md).
import { useEffect, useMemo, useState } from 'react';
import type { RtlTraceV04 } from '../artifacts/types';
import { EvidenceTag } from '../science/Cite';
import { JourneyRail, LevelSwitch, Predict, Transport, useLevel, useTimeline, type PredictTask } from '../kit/kit';
import { useShell } from '../shell/shellStore';
import { contributions, decide, stateAt, stepsPerFrame, totalSteps, withInput, type LinearModel } from './steps';
import './decoder.css';

const SPEEDS = [
  { value: 4, label: '4 cycles a second' },
  { value: 16, label: '16 cycles a second' },
  { value: 80, label: '80 cycles a second' },
];
const POS = '#7FE7FF', NEG = '#FF7FB0';
const num = (v: number) => v.toLocaleString('en-GB');

function useTrace() {
  const [state, setState] = useState<{ trace: RtlTraceV04 | null; error: string | null }>({ trace: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}artifacts/rtl_trace_v04_real.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<RtlTraceV04>; })
      .then((trace) => { if (live) setState({ trace, error: null }); })
      .catch((e: unknown) => { if (live) setState({ trace: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, []);
  return state;
}

export default function DecoderWorkspace() {
  const { trace, error } = useTrace();
  if (error) return <div className="page cine"><div className="page-inner"><div className="card" role="alert" data-testid="decoder-error"><strong>The decoder trace could not be loaded.</strong><p>{error}. The scene draws only what the RTL trace contains, so nothing is shown in its place.</p></div></div></div>;
  if (!trace) return <div className="shell-loading cine" role="status">Reading the RTL trace…</div>;
  if (!trace.model.linear || trace.model.NO !== 2) return <div className="page cine"><div className="page-inner"><div className="card" role="alert"><strong>This trace does not hold the two-output linear decoder this scene draws.</strong><p>Open the full chip studio for other model shapes.</p></div></div></div>;
  return <DecoderScene trace={trace} />;
}

function DecoderScene({ trace }: { trace: RtlTraceV04 }) {
  const level = useLevel((s) => s.level);
  const setChipView = useShell((s) => s.setChipView), go = useShell((s) => s.go);
  const model: LinearModel = useMemo(() => ({ NO: trace.model.NO, W2: trace.model.W2, b2: trace.model.b2 }), [trace]);
  const cycles = trace.latency.engine_start_to_fifo, S = stepsPerFrame(cycles), nFrames = trace.frames.length, total = totalSteps(nFrames, cycles);
  const tl = useTimeline(total - 0.001, 16);
  const [whatIf, setWhatIf] = useState<{ frame: number; ch: number; value: number } | null>(null);

  useEffect(() => {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) tl.setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameIdx = Math.max(0, Math.min(nFrames - 1, Math.floor(tl.t / S) || 0));
  const frame = trace.frames[frameIdx];
  const inf = trace.inferences.find((i) => i.frame_id === frame.frame_id && i.ts === frame.ts_last) ?? trace.inferences[frameIdx];
  const active = whatIf && whatIf.frame === frameIdx ? whatIf : null;
  const x = active ? withInput(frame.x, active.ch, active.value) : frame.x;
  const st = stateAt(tl.t, nFrames, cycles, model, x);
  const contrib = contributions(model, x);
  const result = decide(model, x);
  const rtlOk = !active && result.logits.every((v, o) => v === inf.logits[o]) && result.cls === inf.cls;
  const maxC = useMemo(() => Math.max(1, ...trace.frames.flatMap((f) => contributions(model, f.x).flat().map(Math.abs))), [trace, model]);
  const maxL = useMemo(() => Math.max(1, ...trace.inferences.flatMap((i) => i.logits.map(Math.abs))) * 1.1, [trace]);
  const electrodes = trace.source.model.channels ?? [];
  const winMs = trace.profile.sample_rate_hz ? ((1 << trace.config.win_log2) / trace.profile.sample_rate_hz) * 1000 : null;
  const metrics = (trace.source.model.metrics as Record<string, Record<string, unknown>> | undefined)?.quantised;
  const ci = metrics?.frame_balanced_acc_ci95 as number[] | undefined;

  // the prediction task, answered by the same arithmetic
  const task: PredictTask = useMemo(() => {
    const f0 = trace.frames[0], before = decide(model, f0.x), after = decide(model, withInput(f0.x, 7, 0));
    const flips = after.cls !== before.cls;
    return {
      id: 'one-channel',
      question: `In frame 0 the decoder answers class ${before.cls} with a comfortable margin. Channel 7 has by far the largest weights (${model.W2[0][7]} and ${model.W2[1][7]}). If channel 7’s input were 0 instead of ${f0.x[7]}, would the answer change?`,
      options: [{ id: 'flips', label: 'Yes — the other class would win' }, { id: 'stays', label: 'No — seven other channels still agree' }],
      correct: flips ? 'flips' : 'stays',
      explain: flips
        ? `Channel 7 alone moves the two totals by ${num(Math.abs(model.W2[0][7] * f0.x[7]))} and ${num(Math.abs(model.W2[1][7] * f0.x[7]))}, more than the whole margin of ${num(before.margin)}. A linear decoder is a weighted vote, and here one voter outweighs the rest — which is also why a dead or noisy electrode on that channel would matter.`
        : 'The other seven channels carry enough weight between them to keep the order of the totals.',
      wrong: { stays: 'Count the weights, not the channels.' },
      tryLabel: 'Set channel 7 to 0 in frame 0',
    };
  }, [trace, model]);

  // diagram geometry
  const inY = (k: number) => 86 + k * 52, outY = (o: number) => 190 + o * 190;
  const edgeState = (o: number, k: number) => { const i = o * 8 + k; return st.current && st.current.o === o && st.current.k === k ? 'now' : i < st.macsDone ? 'done' : 'todo'; };
  const accX = (v: number) => 840 + (v / maxL) * 110;

  return (
    <div className="scene cine" data-testid="decoder-workspace">
      <div className="scene-stage">
        <div className="scene-grid" aria-hidden="true" />
        <header className="scene-head">
          <div className="scene-kicker">
            <span>Decoder · 8 inputs → 2 outputs</span>
            <EvidenceTag kind="measured" title="Values from an RTL simulation trace of the digital design, fed with recorded ECoG samples. The chip has not been fabricated." />
          </div>
          <h1>Eight numbers in, one answer out</h1>
          <p>
            {level === 'intuitive' && <>Each input says how much fast activity one electrode saw{winMs ? <> in the last {winMs.toFixed(0)} ms</> : null}. The chip multiplies each by a learned weight, adds them up twice — once per possible answer — and the larger total wins.</>}
            {level === 'math' && <>total<sub>o</sub> = b<sub>o</sub> + Σ<sub>k</sub> W<sub>o,k</sub>·x<sub>k</sub>. The answer is the larger total; the margin is the gap between them.</>}
            {level === 'engineering' && <>One 8-bit × 8-bit multiply-accumulate per clock cycle into a 32-bit sum: {model.NO}·8 products + 2 cycles = {cycles} cycles from engine start to the prediction FIFO.</>}
          </p>
        </header>

        <svg className="dec-diagram" viewBox="0 0 1000 560" role="img" aria-label={`Decoder diagram for frame ${frame.frame_id}: eight inputs, sixteen weighted connections, two running totals. ${st.complete ? `Class ${result.cls} wins by ${result.margin}.` : `${st.macsDone} of 16 products added.`}`} data-testid="decoder-diagram">
          <defs>
            <filter id="dec-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {/* connections */}
          {[0, 1].flatMap((o) => x.map((_, k) => {
            const c = contrib[o][k], s = edgeState(o, k), w = 0.8 + (Math.abs(c) / maxC) * 7;
            return <line key={`${o}-${k}`} x1={232} y1={inY(k)} x2={676} y2={outY(o)} stroke={c >= 0 ? POS : NEG} strokeWidth={w} strokeLinecap="round"
              opacity={s === 'todo' ? 0.1 : s === 'done' ? 0.55 : 1} filter={s === 'now' ? 'url(#dec-glow)' : undefined} className={`dec-edge ${s}`} />;
          }))}
          {/* inputs */}
          {x.map((v, k) => (
            <g key={k} className={`dec-in${st.current?.k === k ? ' now' : ''}${active?.ch === k ? ' whatif' : ''}`}>
              <text x={18} y={inY(k) - 5} className="dec-lbl">channel {k}</text>
              <text x={18} y={inY(k) + 11} className="dec-sub">{electrodes[k] !== undefined ? `electrode ${electrodes[k]}` : ''}</text>
              <rect x={104} y={inY(k) - 7} width={110} height={14} rx={3} className="dec-track" />
              <line x1={159} y1={inY(k) - 10} x2={159} y2={inY(k) + 10} className="dec-zero" />
              <rect x={v >= 0 ? 159 : 159 + (v / 128) * 55} y={inY(k) - 7} width={Math.abs(v / 128) * 55} height={14} rx={2} className="dec-bar" />
              <circle cx={232} cy={inY(k)} r={7} className="dec-node" />
              <text x={214} y={inY(k) - 12} textAnchor="end" className="dec-val" data-testid={`dec-x-${k}`}>{v}</text>
            </g>
          ))}
          <text x={104} y={52} className="dec-head">input x (−128 … 127)</text>
          {/* outputs and running totals */}
          {[0, 1].map((o) => {
            const won = st.complete && result.cls === o;
            return (
              <g key={o} className={`dec-out${won ? ' won' : ''}${st.current?.o === o ? ' now' : ''}`}>
                <circle cx={700} cy={outY(o)} r={24} className="dec-node big" />
                <text x={700} y={outY(o) + 5} textAnchor="middle" className="dec-outlbl">{o}</text>
                <text x={700} y={outY(o) - 34} textAnchor="middle" className="dec-lbl">class {o}</text>
                <rect x={730} y={outY(o) - 9} width={220} height={18} rx={4} className="dec-track" />
                <line x1={840} y1={outY(o) - 14} x2={840} y2={outY(o) + 14} className="dec-zero" />
                <rect x={Math.min(840, accX(st.acc[o]))} y={outY(o) - 9} width={Math.abs(accX(st.acc[o]) - 840)} height={18} rx={3} className="dec-acc" />
                <text x={950} y={outY(o) - 16} textAnchor="end" className="dec-val" data-testid={`dec-acc-${o}`}>{num(st.acc[o])}</text>
                <text x={730} y={outY(o) + 28} className="dec-sub">running total{st.complete ? ' = final' : ''}</text>
              </g>
            );
          })}
          <text x={730} y={52} className="dec-head">totals (start at the bias)</text>
          {/* the product being added now */}
          {st.current && (
            <g className="dec-now" transform={`translate(${454 - 86}, ${(inY(st.current.k) + outY(st.current.o)) / 2 - 15})`}>
              <rect width={172} height={30} rx={8} />
              <text x={86} y={20} textAnchor="middle" data-testid="dec-product">{model.W2[st.current.o][st.current.k]} × {x[st.current.k]} = {num(contrib[st.current.o][st.current.k])}</text>
            </g>
          )}
          {/* verdict */}
          <g className={`dec-verdict${st.complete ? ' shown' : ''}`} transform="translate(730, 458)">
            <rect width={220} height={62} rx={12} />
            <text x={14} y={25} className="dec-vt" data-testid="dec-verdict">{st.complete ? `class ${result.cls} wins` : st.phase === 'latch' ? 'eight inputs latched' : 'adding…'}</text>
            <text x={14} y={46} className="dec-sub">{st.complete ? `margin ${num(result.margin)}${active ? ' · what-if' : ''}` : `${st.macsDone} of 16 products`}</text>
          </g>
        </svg>

        <div className="scene-foot">
          <FrameStrip trace={trace} current={frameIdx} onPick={(f) => { tl.setPlaying(false); tl.seek(f * S); }} />
          <Transport tl={tl} duration={total - 0.001} speeds={SPEEDS} step={1} label="Decoder timeline" clock="Hardware time: clock cycles of the decoder engine, from the RTL trace. Playback speed is yours."
            format={(t) => { const s = stateAt(t, nFrames, cycles, model, x); return `frame ${s.frame} · ${s.cycle ? `cycle ${s.cycle}/${cycles}` : s.phase === 'latch' ? 'inputs' : 'result'}`; }} />
          <JourneyRail prev={{ to: 'chip', label: 'Where this sits in the chip', cue: 'RTL' }} next={{ to: 'research', label: 'Read the evidence behind the scenes', cue: 'sources' }} />
        </div>
      </div>

      <aside className="scene-side" aria-label="Frame details and controls">
        <LevelSwitch />

        <section className="panel" data-testid="decoder-frame">
          <h2>This frame <EvidenceTag kind="measured" title="From the RTL simulation trace." /></h2>
          <dl className="readouts">
            <div><dt>Frame</dt><dd>{frame.frame_id} <small>of {nFrames}</small></dd></div>
            <div><dt>Sample time</dt><dd>{frame.ts_last} <small>samples</small></dd></div>
            <div><dt>Engine cycle</dt><dd>{st.cycle || '—'} <small>/ {cycles}</small></dd></div>
            <div><dt>RTL answer</dt><dd data-testid="dec-rtl-cls">class {inf.cls}</dd></div>
            <div><dt>RTL margin</dt><dd>{num(inf.margin)}</dd></div>
            <div><dt>Recomputed here</dt><dd data-testid="dec-check" className={rtlOk ? 'ok-text' : active ? '' : 'bad-text'}>{active ? 'what-if' : rtlOk ? 'matches RTL ✓' : 'differs ✗'}</dd></div>
          </dl>
          {level !== 'intuitive' && (
            <div className="eq" data-testid="dec-equation">{[0, 1].map((o) => `total${o} = ${model.b2[o]} + ${model.W2[o].map((w, k) => `${w}·${x[k]}`).join(' + ').replace(/\+ -/g, '− ')}\n       = ${num(result.logits[o])}`).join('\n')}</div>
          )}
          {level === 'engineering' && (
            <p className="small">
              Three clocks are in play. <strong>Sample time</strong>: one input summarises {1 << trace.config.win_log2} samples{winMs ? <> ({winMs.toFixed(1)} ms of recording)</> : null}. <strong>Hardware time</strong>: {cycles} engine cycles per frame, {trace.latency.frame_complete_to_engine_start} cycles after the frame completes.
              <strong> Playback time</strong>: whatever speed you choose. Counters in this run: {trace.counters.ai_frames} frames, {trace.counters.ai_pred} predictions, {trace.counters.ai_pred_drop} dropped; {trace.checks.passed}/{trace.checks.total} trace checks passed.
            </p>
          )}
        </section>

        <section className="panel" aria-label="What if one input were different">
          <h2>What if… <span className="dec-soft">software re-run, not RTL</span></h2>
          <div className="knob">
            <label htmlFor="wi-ch">Change the input of</label>
            <select id="wi-ch" value={active?.ch ?? 7} onChange={(e) => setWhatIf({ frame: frameIdx, ch: +e.target.value, value: active?.value ?? frame.x[+e.target.value] })} data-testid="whatif-ch">
              {frame.x.map((_, k) => <option key={k} value={k}>channel {k}</option>)}
            </select>
            <input type="range" min={-128} max={127} step={1} value={active?.value ?? frame.x[active?.ch ?? 7]} aria-label="New input value"
              onChange={(e) => { tl.setPlaying(false); setWhatIf({ frame: frameIdx, ch: active?.ch ?? 7, value: +e.target.value }); tl.seek(frameIdx * S + S - 1); }} data-testid="whatif-value" />
            <span className="small" data-testid="whatif-out">
              {active
                ? <>Channel {active.ch}: {frame.x[active.ch]} → <strong>{active.value}</strong>. Answer: class {result.cls}{result.cls !== inf.cls ? <> — <strong>flipped</strong> from the RTL’s class {inf.cls}</> : <> (unchanged)</>}, margin {num(result.margin)}.</>
                : <>Drag to replace one input in this frame and watch the totals. The RTL’s own values come back when you move to another frame.</>}
            </span>
          </div>
          {active && <button type="button" className="btn" onClick={() => setWhatIf(null)} data-testid="whatif-clear">Back to the RTL values</button>}
        </section>

        <Predict task={task}
          onTry={() => { tl.setPlaying(false); setWhatIf({ frame: 0, ch: 7, value: 0 }); tl.seek(S - 1); }}
          result={(() => { const b = decide(model, trace.frames[0].x), a = decide(model, withInput(trace.frames[0].x, 7, 0)); return <>Frame 0, channel 7: {trace.frames[0].x[7]} → 0. Totals {num(b.logits[0])} / {num(b.logits[1])} → {num(a.logits[0])} / {num(a.logits[1])}: class {b.cls} → class {a.cls}.</>; })()} />

        <section className="panel" data-testid="decoder-limits">
          <h2>What this is, and is not</h2>
          <p><strong>Is:</strong> a Verilog simulation of the digital design, fed with recorded human ECoG samples (public dataset DANDI 000019, one participant, one session), running a decoder trained offline in software to tell overt speech from silence. Every input, product count and total above is the simulation’s; this page re-adds them and checks they agree.</p>
          <p><strong>Is not:</strong> silicon — the chip has not been fabricated or measured. Not a clinical or real-time result. The trace does not say which class index means speech, and carries no labels for these {nFrames} frames, so no accuracy is shown for them.</p>
          {typeof metrics?.frame_balanced_acc === 'number' && (
            <p className="small">Offline software evaluation of this model (not RTL, not hardware): balanced accuracy per frame {(100 * (metrics.frame_balanced_acc as number)).toFixed(0)} %{ci ? <> (95 % interval {(100 * ci[0]).toFixed(0)}–{(100 * ci[1]).toFixed(0)} %)</> : null} on {String(metrics.n_frames)} held-out frames from the same session. Single subject, single session.</p>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => { setChipView('studio'); go('chip'); }} data-testid="decoder-to-studio">Open the full chip studio →</button>
          </div>
        </section>
      </aside>
    </div>
  );
}

/** One cell per frame: which class the RTL chose and by how much. Click to jump. */
function FrameStrip({ trace, current, onPick }: { trace: RtlTraceV04; current: number; onPick: (f: number) => void }) {
  const max = Math.max(1, ...trace.inferences.map((i) => i.margin));
  return (
    <div className="dec-strip" role="group" aria-label="Frames in this run: class chosen by the RTL and its margin" data-testid="frame-strip">
      {trace.inferences.map((i, f) => (
        <button key={f} type="button" className={`dec-cell c${i.cls}${f === current ? ' current' : ''}`} onClick={() => onPick(f)} aria-label={`Frame ${f}: class ${i.cls}, margin ${i.margin}`} aria-current={f === current ? 'step' : undefined} data-testid={`frame-${f}`}>
          <i style={{ height: `${8 + (i.margin / max) * 92}%` }} />
        </button>
      ))}
      <span className="dec-strip-key"><b className="c0" /> class 0 <b className="c1" /> class 1 · bar height = margin (RTL)</span>
    </div>
  );
}
