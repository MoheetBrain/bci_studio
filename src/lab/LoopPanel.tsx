// The complete future READ → CHIP → DECODER → LLM → FEEDBACK loop with honest statuses, and a SCRIPTED
// illustration. No neural data is decoded and no model is called.
import { useTraceV04 } from './v04Store';
import { useState } from 'react';
import { LOOP, LOOP_COMPONENT } from '../model/system';
import { useScene } from '../state/sceneStore';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import type { Evidence } from '../model/types';
import { INDICATOR_MEANING, makeFeedback, validateFeedback, type FeedbackIndicator, type FeedbackMessage } from '../model/feedback';
import { useV03 } from './v03Store';

const STAGE_ID: Record<string, string> = LOOP_COMPONENT;

const SCRIPT = [
  { who: 'operator', text: 'Session started by the operator (cfg_session_en = 1).' },
  { who: 'chip', text: '' },
  { who: 'decoder', text: '' },
  { who: 'user', text: '(typed, not decoded) "Summarise what the chip recorded on channel 1."' },
  { who: 'llm', text: 'SCRIPTED reply: "Channel 1 shows a burst of 70–150 Hz band energy in the middle of the recording." This sentence was written in advance; no model read the data.' },
];

export function LoopPanel() {
  const select = useScene((s) => s.select);
  const setLevel = useScene((s) => s.setLevel);
  const demo = useV03((s) => s.demo);
  const { trace: t4 } = useTraceV04();
  const [step, setStep] = useState(0);
  const [msgs, setMsgs] = useState<FeedbackMessage[]>([]);
  const ch1Energy = demo.energy[1];
  const peak = ch1Energy.reduce((a, e) => (e.e > a.e ? e : a), { t: 0, e: 0, sat: false, seq: 0 });
  const chipLine = `Chip (DEMO model): ${demo.records.FEATURE.length} FEATURE records in this run; channel 1's band energy peaks at ${peak.e} near t = ${(peak.t / 2).toFixed(0)} ms. These are numbers, not thoughts.`;
  const decoderLine = t4
    ? `On-chip decoder (RTL, rtl_trace_v04${t4.source.model.trained ? '_real' : ''}.json): ${t4.frames.length} frames → ${t4.predictions.length} predictions, e.g. frame ${t4.predictions[0]?.frame ?? '?'} → class ${t4.predictions[0]?.cls ?? '?'}, margin ${t4.predictions[0]?.margin ?? '?'}. ${t4.source.model.trained ? 'Trained model.' : 'SYNTHETIC PLACEHOLDER MODEL: the class means nothing about the signal.'} A class and a margin are not a task variable with validated accuracy, and not a thought.`
    : 'On-chip decoder (RTL): no v0.4 trace loaded (run make artifacts).';

  const emit = (ind: FeedbackIndicator) => {
    const m = makeFeedback(ind, 'scripted', INDICATOR_MEANING[ind]);
    setMsgs((x) => [m, ...x].slice(0, 6));
  };

  return (
    <div className="loop" data-testid="loop-panel">
      <div className="loop-chain">
        {LOOP.map((s, k) => (
          <div key={s.id} style={{ display: 'contents' }}>
            {k > 0 && <div className="loop-arrow">→</div>}
            <button className={`loop-stage st-${s.status}${s.implemented ? ' impl' : ''}`} onClick={() => { select(STAGE_ID[s.id]); setLevel(s.id === 'loop.decoder' ? 'die' : 'system'); }} title={s.note}>
              <div className="loop-name">{s.name}</div>
              <EvidenceBadge e={s.status as Evidence} />
              <div className="loop-impl">{s.implemented ? (s.id === 'loop.decoder' ? 'on the chip (RTL)' : 'implemented (RTL)') : 'not implemented'}</div>
            </button>
          </div>
        ))}
        <div className="loop-return" title="Research branch: software-only contract, no stimulation">↩ feedback returns to the person: research branch, software only</div>
      </div>
      <div className="loop-body">
        <div className="loop-script">
          <div className="cd-k">Scripted walk-through <EvidenceBadge e="SCRIPTED" /></div>
          {SCRIPT.slice(0, step + 1).map((l, k) => (
            <div key={k} className={`loop-line who-${l.who}`}><b>{l.who}</b> {l.who === 'chip' ? chipLine : l.who === 'decoder' ? decoderLine : l.text}</div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="btn sm" disabled={step >= SCRIPT.length - 1} onClick={() => setStep(step + 1)} data-testid="loop-next">Next step</button>
            <button className="btn sm" onClick={() => { setStep(0); setMsgs([]); }}>Restart</button>
          </div>
        </div>
        <div className="loop-feedback">
          <div className="cd-k">Feedback contract hbci.feedback/0.1 (software only)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(INDICATOR_MEANING) as FeedbackIndicator[]).map((ind) => (
              <button key={ind} className="btn sm" onClick={() => emit(ind)} title={INDICATOR_MEANING[ind]}>{ind}</button>
            ))}
          </div>
          <div className="loop-msgs mono">
            {msgs.map((m, k) => {
              const problems = validateFeedback(m);
              return <div key={k}>{problems.length ? '✗' : '✓'} {JSON.stringify(m)}</div>;
            })}
            {msgs.length === 0 && <div className="faint">Emit an indicator to see a validated contract message. Delivered to a screen, never to tissue.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
