// The Experiment scene: what the attached virtual BCI records, followed stage by stage to a decoded output.
// One simulated session, one timeline; every view on this page is a reading of that session at that time.
import { useEffect, useRef } from 'react';
import { useAtlas } from '../atlas/atlasStore';
import { bestSiteOf } from '../atlas/AtlasScene';
import { Transport, useTimeline, type SpeedOption } from '../kit/kit';
import { useShell } from '../shell/shellStore';
import { DecoderLab } from './DecoderLab';
import { Explain } from './explain';
import { MODES, STAGES, useExperiment } from './experimentStore';
import { experimentFor, useImplant } from './implantStore';
import { BIN_MS } from './model/motor';
import type { MotorSession, VisualSession } from './model/session';
import { OBJECTS } from './model/visual';
import { CursorPad } from './plots';
import { Prov } from './Prov';
import { AdcView, DecoderView, DspView, ElectrodeView, FrontEndView, NeuronView, OutputView, TissueBelow, type StageProps } from './stageViews';
import { TissueStage } from './TissueStage';
import '../journey/journey.css';
import '../kit/kit.css';
import './experiment.css';

const SPEEDS: SpeedOption[] = [{ value: 1, label: 'real time' }, { value: 0.25, label: '¼ ×' }, { value: 0.05, label: '1/20 ×' }, { value: 0.01, label: '1/100 ×' }, { value: 0.002, label: '1/500 ×' }];
/** The speed at which each stage's events can actually be seen. */
const STAGE_SPEED = { motor: [1, 0.01, 0.01, 0.01, 0.002, 0.05, 1, 1], visual: [1, 1, 0.25, 0.25, 0.05, 0.25, 1, 1] } as const;
const TOUR_MS = 7000;

function attachTo(name: string) {
  const a = useAtlas.getState();
  const target = [...a.structures.values()].find((x) => x.name === name);
  const site = target ? bestSiteOf(target.id) : null;
  if (!target || !site) return false;
  useImplant.getState().attach(site);
  a.select(target.id);
  return true;
}

function NoExperiment({ regionName }: { regionName: string | null }) {
  const go = useShell((s) => s.go);
  const ready = useAtlas((s) => s.status === 'ready');
  return (
    <div className="exp-empty" data-testid="experiment-empty">
      <h2>{regionName ? 'No experiment for this region yet' : 'Attach the virtual BCI first'}</h2>
      {regionName
        ? <p>The device is on the <strong>{regionName}</strong>. The studio will not invent what that cortex does or what an electrode there would record. Experiments exist for two regions:</p>
        : <p>An experiment needs a device on the cortex. Pick it up in the brain scene and attach it to a region — or use one of the two regions that have an experiment:</p>}
      <div className="exp-empty-actions">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => attachTo('left precentral gyrus')} data-testid="exp-attach-motor">Attach to the left precentral gyrus · movement</button>
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => attachTo('left lateral occipital gyrus')} data-testid="exp-attach-visual">Attach to the left lateral occipital gyrus · vision</button>
        <button type="button" className="btn" onClick={() => go('brain')} data-testid="exp-to-brain">Choose a place on the brain myself</button>
      </div>
      <p className="exp-fine">Educational simulator. Not a surgical planner; nothing here is a recording from a person.</p>
    </div>
  );
}

function NowBox({ s, t }: { s: MotorSession | VisualSession; t: number }) {
  if (s.kind === 'motor') {
    const r = s.run, k = Math.max(0, Math.min(r.nBins - 1, Math.floor((t * 1000) / BIN_MS + 1e-6)));
    return (
      <section className="exp-now" aria-label="The output right now" data-testid="now-box">
        <CursorPad run={r} k={k} size={148} />
        <dl>
          <dt>Intended</dt><dd className="mono" data-testid="now-intent">({r.intent[k * 2].toFixed(2)}, {r.intent[k * 2 + 1].toFixed(2)})</dd>
          <dt>Decoded</dt><dd className="mono" data-testid="now-decoded">({r.decoded[k * 2].toFixed(2)}, {r.decoded[k * 2 + 1].toFixed(2)})</dd>
          <dt>Decoder</dt><dd>{s.decoders.find((d) => d.id === s.decoderId)?.name}</dd>
        </dl>
      </section>
    );
  }
  const r = s.run, k = Math.max(0, Math.min(r.nBins - 1, Math.floor((t * 1000) / r.binMs + 1e-6)));
  const st = r.stim.find((x) => t >= x.onS && t < x.offS);
  return (
    <section className="exp-now" aria-label="The output right now" data-testid="now-box">
      <div className={`exp-screen${st ? ` ${st.kind}` : ''}`} aria-label="What is on the simulated screen">{st ? (st.kind === 'object' ? OBJECTS[st.identity] : 'scrambled') : 'blank'}</div>
      <dl>
        <dt>On the screen</dt><dd data-testid="now-truth">{st ? (st.kind === 'object' ? `intact object (${OBJECTS[st.identity]})` : 'scrambled picture') : 'nothing'}</dd>
        <dt>P(picture on)</dt><dd className="mono" data-testid="now-decoded">{r.valid[k] ? `${(r.decoded[k * 2] * 100).toFixed(0)} %` : '—'}</dd>
        <dt>P(intact)</dt><dd className="mono">{r.valid[k] ? `${(r.decoded[k * 2 + 1] * 100).toFixed(0)} %` : '—'}</dd>
      </dl>
    </section>
  );
}

function Signal({ s }: { s: MotorSession | VisualSession }) {
  const stage = useExperiment((x) => x.stage), mode = useExperiment((x) => x.mode), follow = useExperiment((x) => x.follow);
  const status = useExperiment((x) => x.status), nonce = useExperiment((x) => x.resultNonce);
  const setStage = useExperiment((x) => x.setStage), setFollow = useExperiment((x) => x.setFollow), reset = useExperiment((x) => x.resetParams);
  const tl = useTimeline(s.run.durationS, 1, { start: 2.2, fps: 30 });
  const speeds = STAGE_SPEED[s.kind];
  const scroller = useRef<HTMLDivElement | null>(null);

  // a stage is entered at the speed at which its events can be seen; the user can change it afterwards
  const lastStage = useRef(0);
  useEffect(() => {
    if (lastStage.current === stage) return;
    lastStage.current = stage;
    tl.setSpeed(speeds[stage - 1]);
    scroller.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  /** Put the playhead just before the next thing worth watching at this stage (a spike of the nearest neuron). */
  const cue = (n: number) => {
    if (s.kind !== 'motor' || n < 2 || n > 6) return;
    const u = s.run.units.find((x) => x.ch === s.run.params.focusCh && x.rank === 0)!;
    const sp = s.run.spikeT[u.id], from = Math.max(tl.now(), 1.3);
    for (let i = 0; i < sp.length; i++) if (sp[i] > from + 0.004) { tl.seek(sp[i] - (n === 5 ? 0.0006 : 0.004)); return; }
  };

  // the guided tour: play, and move on to the next stage every few seconds
  useEffect(() => {
    if (!follow || !tl.playing) return;
    const id = window.setTimeout(() => {
      const next = useExperiment.getState().stage + 1;
      if (next > 8) { setFollow(false); tl.setPlaying(false); return; }
      setStage(next); cue(next);
    }, TOUR_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, tl.playing, stage]);
  const startTour = () => { setStage(1); tl.seek(2.2); setFollow(true); tl.setPlaying(true); };
  const pick = (n: number) => { setFollow(false); setStage(n); };

  const sp: StageProps = { s, t: tl.t, tl, mode };
  const has3d = stage <= 3;
  return (
    <div className="exp-body" data-stage={stage} data-mode={mode} data-status={status} data-result={nonce} data-testid="experiment-signal">
      <nav className="exp-pipeline" aria-label="The signal’s path, stage by stage">
        {STAGES.map((g, i) => (
          <button key={g.id} type="button" className={`exp-stage${stage === g.n ? ' on' : ''}${g.n < stage ? ' done' : ''}`} aria-current={stage === g.n ? 'step' : undefined} onClick={() => pick(g.n)} data-testid={`stage-${g.n}`}>
            <span className="exp-stage-n mono">{g.n}</span>
            <span className="exp-stage-l">{g.label}<small>{g.sub}</small></span>
            {i < STAGES.length - 1 && <span className="exp-stage-arrow" aria-hidden="true">→</span>}
          </button>
        ))}
      </nav>

      <div className="exp-main">
        <div className="exp-view" ref={scroller}>
          {has3d && (
            <div className={`exp-3d${stage === 1 ? ' tall' : ''}`} data-testid="tissue-3d">
              <TissueStage run={s.run} now={tl.now} playing={tl.playing} speed={tl.speed} stage={stage} labels={mode !== 'cinematic' || stage > 1} />
              <div className="exp-3d-tags"><Prov kind="illustrative" note="shapes and positions" /><Prov kind="simulated" note="when cells fire" /></div>
              <p className="exp-3d-hint">Drag to look around · scroll to zoom</p>
            </div>
          )}
          <div className="exp-content" data-testid={`stage-view-${stage}`}>
            {stage === 1 && <TissueBelow {...sp} />}
            {stage === 2 && <NeuronView {...sp} />}
            {stage === 3 && <ElectrodeView {...sp} />}
            {stage === 4 && <FrontEndView {...sp} />}
            {stage === 5 && <AdcView {...sp} />}
            {stage === 6 && <DspView {...sp} />}
            {stage === 7 && <DecoderView {...sp} />}
            {stage === 8 && <OutputView {...sp} />}
          </div>
        </div>
        <aside className="exp-side">
          <Explain s={s} stage={stage} mode={mode} t={tl.t} />
          <NowBox s={s} t={tl.t} />
          <div className="exp-side-foot">
            <span className="exp-status" role="status" data-testid="exp-status">{status === 'computing' ? 'Recomputing the simulation…' : `Simulated in ${s.computeMs.toFixed(0)} ms · seed ${s.run.params.seed}`}</span>
            <button type="button" className="btn" onClick={reset} data-testid="exp-reset">Reset all settings</button>
          </div>
        </aside>
      </div>

      <div className="exp-transport">
        <button type="button" className={`btn btn-primary exp-follow${follow ? ' on' : ''}`} onClick={() => (follow ? (setFollow(false), tl.setPlaying(false)) : startTour())} data-testid="follow-signal" aria-pressed={follow}>
          {follow ? 'Stop the tour' : 'Follow signal ▶'}
        </button>
        <Transport tl={tl} duration={s.run.durationS} speeds={SPEEDS} format={(x) => `${x.toFixed(3)} s`} step={0.001} label="Simulated recording" clock="Time inside the simulated recording. Playback speed is relative to real time." />
        <div className="exp-step-btns" role="group" aria-label="Previous and next stage">
          <button type="button" className="btn" disabled={stage <= 1} onClick={() => pick(stage - 1)} data-testid="stage-prev">← {STAGES[Math.max(0, stage - 2)].label}</button>
          <button type="button" className="btn" disabled={stage >= 8} onClick={() => pick(stage + 1)} data-testid="stage-next">{STAGES[Math.min(7, stage)].label} →</button>
        </div>
      </div>
    </div>
  );
}

export default function ExperimentWorkspace() {
  const placement = useImplant((s) => s.placement);
  const regionName = useAtlas((s) => s.nameOf(placement?.regionId ?? null));
  const atlasReady = useAtlas((s) => s.status === 'ready');
  const kind = useExperiment((s) => s.kind), session = useExperiment((s) => s.session), status = useExperiment((s) => s.status), error = useExperiment((s) => s.error);
  const view = useExperiment((s) => s.view), mode = useExperiment((s) => s.mode);
  const setKind = useExperiment((s) => s.setKind), setView = useExperiment((s) => s.setView), setMode = useExperiment((s) => s.setMode), run = useExperiment((s) => s.run);
  const go = useShell((s) => s.go);
  const want = placement && atlasReady ? experimentFor(regionName) : null;
  useEffect(() => { if (atlasReady || !placement) setKind(want); }, [want, atlasReady, placement, setKind]);
  // test / diagnostics hook (no production behaviour depends on it)
  useEffect(() => { const w = window as unknown as Record<string, unknown>; w.__exp = useExperiment; return () => { delete w.__exp; }; }, []);

  return (
    <div className="scene cine exp" data-testid="experiment-workspace" data-kind={kind ?? 'none'}>
      <header className="exp-head">
        <div className="exp-title">
          <div className="exp-kicker">Experiment <Prov kind="simulated" title="Every signal in this scene is generated by a stated model. Nothing here was recorded from a person." /></div>
          <h1 data-testid="experiment-title">{view === 'lab' ? 'Decoder comparison' : kind === 'motor' ? 'Movement: from intention to a cursor' : kind === 'visual' ? 'Vision: from a picture to a report' : 'Virtual BCI'}</h1>
          {view === 'signal' && regionName && <button type="button" className="exp-where" onClick={() => go('brain')} title="Back to the device on the brain" data-testid="exp-where">Device on the {regionName} ↩</button>}
        </div>
        <div className="exp-switches">
          <div className="seg" role="group" aria-label="What to look at">
            <button type="button" className={`seg-btn${view === 'signal' ? ' on' : ''}`} aria-pressed={view === 'signal'} onClick={() => setView('signal')} data-testid="view-signal">Follow the signal</button>
            <button type="button" className={`seg-btn${view === 'lab' ? ' on' : ''}`} aria-pressed={view === 'lab'} onClick={() => setView('lab')} data-testid="view-lab">Decoder lab</button>
          </div>
          {view === 'signal' && kind && (
            <div className="seg" role="group" aria-label="How it is explained">
              {MODES.map((m) => <button key={m.id} type="button" className={`seg-btn${mode === m.id ? ' on' : ''}`} aria-pressed={mode === m.id} title={m.hint} onClick={() => setMode(m.id)} data-testid={`mode-${m.id}`}>{m.label}</button>)}
            </div>
          )}
        </div>
      </header>

      {view === 'lab' ? <DecoderLab /> : !kind ? <NoExperiment regionName={placement && atlasReady ? regionName : null} /> : session && session.kind === kind ? <Signal key={kind} s={session} /> : (
        <div className="exp-empty" role="status" data-testid="experiment-loading">
          {status === 'error'
            ? <><h2>The simulation failed</h2><p>{error}</p><button type="button" className="btn" onClick={run}>Try again</button></>
            : <><span className="loading-ring" aria-hidden="true" /><p>Calibrating the decoders and simulating the recording…</p></>}
        </div>
      )}
    </div>
  );
}
