import type { StepResult, CoreConfig } from './model';
import { FLOW_STAGES } from './labStore';

/** The numeric journey of one sample through the core, stage by stage. */
export function Pipeline({ step, cfg, stage, source }: {
  step: StepResult | null;
  cfg: CoreConfig;
  stage: number | null;
  source: 'demo' | 'rtl';
}) {
  if (!step) return <div className="pipe empty faint">Step or play to follow a sample through the core.</div>;
  const rearmLevel = cfg.hysteresis >= cfg.threshold ? 1 : cfg.threshold - cfg.hysteresis;
  const cells: { k: number; title: string; body: React.ReactNode; tone?: 'ok' | 'no' | 'fire' }[] = [
    { k: 0, title: `ch${step.ch} sample`, body: <><b>x = {step.x}</b><span>index i = {step.i}</span></> },
    { k: 2, title: 'channel state', body: <><span>⌊b⌋ = {step.baseInt}</span><span>armed {step.armed} · refr {step.refr}{step.primed ? '' : ' · unprimed'}</span></> },
    { k: 3, title: 'baseline subtraction', body: <><b>r = {step.x} − {step.baseInt} = {step.res}</b><span>{step.primed ? 'b ← b + (x−b)≫' + cfg.alphaShift : 'first sample primes b'}</span></> },
    {
      k: 4, title: 'threshold', tone: step.above ? 'ok' : 'no',
      body: <><b>|r| = {step.mag} {step.above ? '≥' : '<'} {cfg.threshold}</b><span>re-arm if |r| &lt; {rearmLevel}: {step.rearm ? 'yes' : 'no'}</span></>,
    },
    {
      k: 5, title: 'hysteresis / refractory', tone: step.fire ? 'fire' : 'no',
      body: <><b>{step.fire ? 'FIRE' : 'no event'}</b><span>{!step.armed ? 'not armed' : step.refr ? `refractory ${step.refr}` : step.above ? 'armed, refr 0' : 'below threshold'}</span></>,
    },
    {
      k: 7, title: 'event packet', tone: step.fire ? 'fire' : undefined,
      body: step.fire
        ? <><b className="mono">{`{ch:${step.ch}, ts:${step.i}, pol:${step.pol}, mag:${step.mag}}`}</b><span>52 bits out · raw waveform discarded</span></>
        : <span className="faint">nothing sent</span>,
    },
  ];
  return (
    <div className="pipe" data-testid="pipeline">
      {cells.map((c, j) => {
        const active = stage !== null && (stage === c.k || (c.k === 0 && stage <= 1) || (c.k === 5 && stage === 6));
        return (
          <div key={c.k} style={{ display: 'contents' }}>
            {j > 0 && <div className={`pipe-arrow${active ? ' on' : ''}`}>→</div>}
            <div className={`pipe-cell${active ? ' on' : ''}${c.tone ? ' ' + c.tone : ''}`} title={FLOW_STAGES[c.k]?.label}>
              <div className="pipe-title">{c.title}</div>
              {c.body}
            </div>
          </div>
        );
      })}
      <div className="pipe-src faint">{source === 'rtl' ? 'values read from the RTL trace' : 'values from the DEMO model'}</div>
    </div>
  );
}
