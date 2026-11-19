import { useEffect, useMemo, useRef, useState } from 'react';
import './lab.css';
import { currentData, liveStats, useLab } from './labStore';
import { NUM_CH } from './model';
import { WaveCanvas } from './WaveCanvas';
import { DigitalWaves } from './DigitalWaves';
import { Pipeline } from './Pipeline';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { useArtifacts } from '../artifacts/load';
import { useV03, type LabTab } from './v03Store';
import { Representations } from './Representations';
import { PayloadPanel } from './PayloadPanel';
import { LoopPanel } from './LoopPanel';
import { ExperimentPanel } from './ExperimentPanel';
import { AiPipeline } from './AiPipeline';
import './v03.css';

const TABS: { id: LabTab; label: string }[] = [
  { id: 'ai', label: 'On-chip AI (v0.4)' },
  { id: 'repr', label: 'Representations (v0.3)' },
  { id: 'signals', label: 'Event lab (v0.2)' },
  { id: 'payload', label: 'Payload' },
  { id: 'loop', label: 'READ–COMPUTE–FEEDBACK' },
  { id: 'experiment', label: 'Real-data test (E01)' },
];

function TabBar({ size, onSize }: { size: LabSize; onSize: (s: LabSize) => void }) {
  const tab = useV03((v) => v.tab);
  const setTab = useV03((v) => v.setTab);
  return (
    <div className="lab-tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t.id} role="tab" className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); if (size === 'collapsed') onSize('normal'); }} data-testid={`lab-tab-${t.id}`}>{t.label}</button>
      ))}
      <span className="spacer" />
      <button className="btn sm" onClick={() => onSize(size === 'tall' ? 'normal' : 'tall')} title="Resize the lab">{size === 'tall' ? '▼' : '▲'}</button>
      <button className="btn sm" onClick={() => onSize(size === 'collapsed' ? 'normal' : 'collapsed')}>{size === 'collapsed' ? 'Show' : 'Hide'}</button>
    </div>
  );
}

export type LabSize = 'collapsed' | 'normal' | 'tall';

export function LabPanel({ size, onSize }: { size: LabSize; onSize: (s: LabSize) => void }) {
  const tab = useV03((v) => v.tab);
  return (
    <div className="lab-wrap">
      <TabBar size={size} onSize={onSize} />
      {size !== 'collapsed' && (
        <div className="lab-tabbody">
          {tab === 'signals' && <EventLab size={size} onSize={onSize} />}
          {tab === 'repr' && <Representations />}
          {tab === 'payload' && <PayloadPanel />}
          {tab === 'loop' && <LoopPanel />}
          {tab === 'experiment' && <ExperimentPanel />}
          {tab === 'ai' && <AiPipeline />}
        </div>
      )}
    </div>
  );
}

function EventLab({ size, onSize }: { size: LabSize; onSize: (s: LabSize) => void }) {
  const s = useLab();
  const trace = useArtifacts((a) => a.trace);
  const loaded = useArtifacts((a) => a.loaded);
  const data = currentData(s);
  const [view, setView] = useState<'analog' | 'digital'>('analog');
  const [windowT, setWindowT] = useState(160);

  useEffect(() => {
    if (trace) useLab.getState().attachTrace(trace);
  }, [trace]);

  // Playback: advance the cursor in real time and react to events crossing it.
  const lastTs = useRef<number | null>(null);
  const acc = useRef(0);
  useEffect(() => {
    if (!s.playing) {
      lastTs.current = null;
      return;
    }
    let raf = 0;
    const tick = (ts: number) => {
      const st = useLab.getState();
      const d = currentData(st);
      if (lastTs.current !== null) acc.current += ((ts - lastTs.current) / 1000) * st.speed;
      lastTs.current = ts;
      const adv = Math.floor(acc.current);
      if (adv > 0) {
        acc.current -= adv;
        const from = st.cursor;
        const to = Math.min(d.N - 1, from + adv);
        const crossing = d.events.filter((e) => e.i > from && e.i <= to);
        const brk = crossing.find((e) => st.pauseOnEvent || (st.breakOnCh !== null && e.ch === st.breakOnCh));
        if (brk) {
          useLab.setState({ cursor: brk.i, playing: false, breakOnCh: null });
          st.startFlow(d.steps[brk.i]);
          return;
        }
        if (crossing.length && !st.flow) st.startFlow(d.steps[crossing[crossing.length - 1].i]);
        useLab.setState({ cursor: to, playing: to < d.N - 1 });
        if (to >= d.N - 1) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.playing]);

  // Keyboard: Space = play/pause, ←/→ = single-step (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const st = useLab.getState();
      if (e.code === 'Space') { e.preventDefault(); st.togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); st.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); st.step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Data-flow animation ticker.
  useEffect(() => {
    if (!s.flow) return;
    const id = window.setTimeout(() => useLab.getState().advanceFlow(), 520);
    return () => window.clearTimeout(id);
  }, [s.flow]);

  const stats = useMemo(() => liveStats(data, s.cursor), [data, s.cursor]);
  const focus = s.flow?.step ?? data.steps[s.cursor] ?? null;
  const visibleEvents = useMemo(() => data.events.map((e, k) => ({ e, k })).filter(({ e }) => e.i <= s.cursor).reverse().slice(0, 300), [data, s.cursor]);
  const isRtl = s.mode === 'rtl';
  const cycle = isRtl && trace ? trace.samples[Math.min(s.cursor, trace.samples.length - 1)]?.cycle ?? 0 : 0;

  if (size === 'collapsed') {
    return (
      <div className="lab-head">
        <button className="btn sm" onClick={() => onSize('normal')}>▲ Signal lab</button>
        <EvidenceBadge e={isRtl ? 'RTL' : 'DEMO'} />
        <span className="faint">{stats.events} events · {stats.samples} samples</span>
      </div>
    );
  }

  return (
    <div className="lab" data-testid="lab">
      <div className="lab-head">
        <div className="grp">
          <strong style={{ whiteSpace: 'nowrap' }}>Signal lab</strong>
          <div className="seg" role="tablist">
            <button className={!isRtl ? 'on' : ''} onClick={() => s.setMode('demo')}>DEMO model</button>
            <button className={isRtl ? 'on' : ''} onClick={() => s.setMode('rtl')} disabled={!s.rtl}
              title={s.rtl ? 'Play the trace recorded from the real Verilog testbench' : loaded ? 'rtl_trace.json missing: run make artifacts' : 'loading…'}>
              RTL trace
            </button>
          </div>
          <EvidenceBadge e={isRtl ? 'RTL' : 'DEMO'} />
        </div>
        <div className="grp">
          <button className="btn sm" onClick={() => s.step(-1)} title="Step back one sample">◀|</button>
          <button className="btn sm" onClick={s.togglePlay} data-testid="lab-play" style={{ minWidth: 54 }}>{s.playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button className="btn sm" onClick={() => s.step(1)} title="Single-step one sample" data-testid="lab-step">|▶</button>
          <div className="seg">
            {[60, 240, 960].map((v) => (
              <button key={v} className={s.speed === v ? 'on' : ''} onClick={() => s.setSpeed(v)} title={`${v} samples/s`}>{v === 60 ? '¼×' : v === 240 ? '1×' : '4×'}</button>
            ))}
          </div>
          <label title="Pause automatically at every event"><input type="checkbox" checked={s.pauseOnEvent} onChange={s.togglePauseOnEvent} />stop on event</label>
        </div>
        <div className="grp" title={isRtl ? 'Locked: the RTL trace was recorded with this configuration. Switch to DEMO to change parameters.' : ''}>
          <label>thr <input type="range" min={50} max={2000} step={10} value={isRtl ? data.cfg.threshold : s.cfg.threshold} disabled={isRtl}
            onChange={(e) => s.setCfg({ threshold: +e.target.value })} data-testid="lab-threshold" /><span className="val">{data.cfg.threshold}</span></label>
          <label>hyst <input type="range" min={0} max={800} step={10} value={data.cfg.hysteresis} disabled={isRtl}
            onChange={(e) => s.setCfg({ hysteresis: +e.target.value })} /><span className="val">{data.cfg.hysteresis}</span></label>
          <label>refr <input type="range" min={0} max={40} value={data.cfg.refractory} disabled={isRtl}
            onChange={(e) => s.setCfg({ refractory: +e.target.value })} /><span className="val">{data.cfg.refractory}</span></label>
          <label>noise <input type="range" min={0} max={500} step={5} value={s.gen.noise} disabled={isRtl}
            onChange={(e) => s.setGen({ noise: +e.target.value })} data-testid="lab-noise" /><span className="val">{isRtl ? '—' : s.gen.noise}</span></label>
        </div>
        <div className="grp">
          <div className="chips" aria-label="Channel">
            <button className={`chip${s.selectedCh === null ? ' on' : ''}`} onClick={() => s.selectCh(null)}>all</button>
            {Array.from({ length: NUM_CH }, (_, c) => (
              <button key={c} className={`chip${s.selectedCh === c ? ' on' : ''}`} onClick={() => s.selectCh(c)}>{c}</button>
            ))}
          </div>
          <button className="btn sm" onClick={s.inject} disabled={isRtl} data-testid="lab-inject"
            title={isRtl ? 'Injection changes the stimulus, so it is only available in DEMO mode' : `Inject a synthetic spike on channel ${s.selectedCh ?? 0} and follow it through the core`}>
            ⚡ Inject spike
          </button>
          {!isRtl && s.injected.length > 0 && <button className="btn sm" onClick={s.clearInjected}>clear ({s.injected.length})</button>}
        </div>
        <div className="grp">
          {isRtl && (
            <div className="seg">
              <button className={view === 'analog' ? 'on' : ''} onClick={() => setView('analog')}>Analog</button>
              <button className={view === 'digital' ? 'on' : ''} onClick={() => setView('digital')}>Digital</button>
            </div>
          )}
          <label>zoom <input type="range" min={40} max={600} step={10} value={windowT} onChange={(e) => setWindowT(+e.target.value)} style={{ width: 60 }} /></label>
          <button className="btn sm" onClick={() => onSize(size === 'tall' ? 'normal' : 'tall')}>{size === 'tall' ? '▼' : '▲'}</button>
          <button className="btn sm" onClick={() => onSize('collapsed')}>Hide</button>
        </div>
      </div>
      <div className="lab-body">
        <div className="lab-main">
          <div className="lab-canvas">
            {isRtl && view === 'digital' && trace ? (
              <DigitalWaves waves={trace.waves} cycle={cycle} span={windowT} highlight={(n) => s.flow !== null && /ev_|fire|above/.test(n)} />
            ) : (
              <WaveCanvas data={data} cursor={s.cursor} selectedCh={s.selectedCh} windowT={windowT}
                flowCh={s.flow?.step.ch ?? null}
                onSeek={(i, ch) => { s.setCursor(i); s.selectCh(ch); }} />
            )}
          </div>
          <Pipeline step={focus} cfg={data.cfg} stage={s.flow?.stage ?? null} source={s.mode} />
          <div className="lab-scrub">
            <span className="mono">i={s.cursor}</span>
            <input type="range" min={0} max={data.N - 1} value={s.cursor} onChange={(e) => s.setCursor(+e.target.value)} aria-label="Timeline" data-testid="lab-scrub" />
            <span className="mono">{data.N} samples · {data.T}/ch</span>
          </div>
        </div>
        <div className="lab-side">
          <div className="stats">
            <div className="stat"><div className="n">{stats.events}</div><div className="l">events</div></div>
            <div className="stat good"><div className="n">{stats.hits}</div><div className="l">hits</div></div>
            <div className="stat bad"><div className="n">{stats.misses}</div><div className="l">missed</div></div>
            <div className="stat bad"><div className="n">{stats.fp}</div><div className="l">false +</div></div>
          </div>
          <div className="lossy" title="Event packets carry only channel, time, polarity and magnitude. The raw waveform cannot be reconstructed from them.">
            Compression {Number.isFinite(stats.ratio) ? stats.ratio.toFixed(1) + '×' : '∞'} ({(stats.rawBits / 8 / 1024).toFixed(1)} KiB raw → {(stats.eventBits / 8 / 1024).toFixed(2)} KiB events) · <b>LOSSY</b>, raw signal not recoverable
          </div>
          {isRtl && s.crossCheck && (
            <div className={`crosscheck ${s.crossCheck.agree === s.crossCheck.compared ? 'ok' : 'bad'}`}
              title="The DEMO model run on the RTL stimulus, compared field-by-field (baseline, residual, armed, refractory, fire) with the values the RTL actually produced.">
              DEMO vs RTL cross-check: {s.crossCheck.agree}/{s.crossCheck.compared} samples agree
              {s.crossCheck.firstMismatch !== null && ` · first mismatch at i=${s.crossCheck.firstMismatch}`}
            </div>
          )}
          <div className="evlist">
            <table>
              <thead><tr><th>ts</th><th>ch</th><th>pol</th><th>mag</th><th>truth</th></tr></thead>
              <tbody>
                {visibleEvents.map(({ e, k }) => {
                  const fp = (data.score.eventMatch.get(k) ?? -1) < 0;
                  return (
                    <tr key={k} onClick={() => { s.setCursor(e.i); s.startFlow(data.steps[e.i]); }}>
                      <td>{e.ts}</td><td>{e.ch}</td><td>{e.pol ? '−' : '+'}</td><td>{e.mag}</td>
                      <td className={fp ? 'fp' : 'hit'}>{fp ? 'false +' : 'hit'}</td>
                    </tr>
                  );
                })}
                {visibleEvents.length === 0 && <tr><td colSpan={5} className="faint">No events yet. Press Play.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
