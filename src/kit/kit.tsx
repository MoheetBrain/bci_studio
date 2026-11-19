// Shared scene furniture: a seekable timeline with transport controls, the detail-level switch, the
// predict-then-check task, and the rail that links one scene to the next.
//
// Time model: a scene's state is a pure function of its timeline position t (model time). Playback only moves t;
// it never integrates anything. `speed` is model time per second of wall time, so slow motion is explicit.
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShell, WORKSPACES, type Workspace } from '../shell/shellStore';
import './kit.css';

// ── detail level ────────────────────────────────────────────────────────────────────────────────────────────────
export type Level = 'intuitive' | 'math' | 'engineering';
export const LEVELS: Array<{ id: Level; label: string; hint: string }> = [
  { id: 'intuitive', label: 'Intuitive', hint: 'What happens, in plain words' },
  { id: 'math', label: 'Mathematical', hint: 'The equations and their variables' },
  { id: 'engineering', label: 'Engineering', hint: 'Numbers, limits and what the hardware must do' },
];
const LEVEL_KEY = 'hbci.level.v1';
const storedLevel = (): Level => {
  try { const v = localStorage.getItem(LEVEL_KEY); if (v === 'intuitive' || v === 'math' || v === 'engineering') return v; } catch { /* storage unavailable */ }
  return 'intuitive';
};
export const useLevel = create<{ level: Level; setLevel: (l: Level) => void }>((set) => ({
  level: storedLevel(),
  setLevel: (level) => { try { localStorage.setItem(LEVEL_KEY, level); } catch { /* storage unavailable */ } set({ level }); },
}));

export function LevelSwitch() {
  const level = useLevel((s) => s.level), setLevel = useLevel((s) => s.setLevel);
  return (
    <div className="seg level-switch" role="group" aria-label="Level of detail">
      {LEVELS.map((l) => (
        <button key={l.id} type="button" className={`seg-btn${level === l.id ? ' on' : ''}`} aria-pressed={level === l.id} title={l.hint} onClick={() => setLevel(l.id)} data-testid={`level-${l.id}`}>{l.label}</button>
      ))}
    </div>
  );
}

// ── timeline ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Timeline {
  t: number;
  playing: boolean;
  speed: number;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  reset: () => void;
  /** Current time without a re-render (for animation loops). */
  now: () => number;
}

/**
 * A timeline from 0 to `duration` (model units). While playing, t advances by wall-clock seconds × speed and stops at
 * the end. `fps` limits how often React re-renders (plots, readouts); animation loops read `now()` every frame.
 */
export function useTimeline(duration: number, initialSpeed: number, opts: { start?: number; fps?: number } = {}): Timeline {
  const [t, setT] = useState(opts.start ?? 0);
  const [playing, setPlayingState] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  const ref = useRef({ t: opts.start ?? 0, playing: false, speed: initialSpeed, duration, last: 0, lastRender: 0 });
  ref.current.speed = speed; ref.current.duration = duration;

  useEffect(() => { if (ref.current.t > duration) { ref.current.t = duration; setT(duration); } }, [duration]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const r = ref.current;
    r.last = performance.now();
    const tick = (now: number) => {
      // a stalled tab must not jump the timeline; and a frame timestamp can precede the moment Play was pressed,
      // so time never runs backwards either
      const dt = Math.max(0, Math.min(0.1, (now - r.last) / 1000));
      r.last = now;
      r.t = Math.max(0, Math.min(r.duration, r.t + dt * r.speed));
      if (now - r.lastRender > 1000 / (opts.fps ?? 30) || r.t >= r.duration) { r.lastRender = now; setT(r.t); }
      if (r.t >= r.duration) { r.playing = false; setPlayingState(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const seek = useCallback((x: number) => { const v = Math.max(0, Math.min(ref.current.duration, Number.isFinite(x) ? x : 0)); ref.current.t = v; setT(v); }, []);
  const setPlaying = useCallback((p: boolean) => {
    if (p && ref.current.t >= ref.current.duration) { ref.current.t = 0; setT(0); }      // play from the end restarts
    ref.current.playing = p; setPlayingState(p);
  }, []);
  const reset = useCallback(() => { ref.current.playing = false; setPlayingState(false); ref.current.t = 0; setT(0); }, []);
  const now = useCallback(() => ref.current.t, []);
  return { t, playing, speed, seek, setPlaying, setSpeed, reset, now };
}

export interface SpeedOption { value: number; label: string }

export function Transport(p: {
  tl: Timeline; duration: number; speeds: SpeedOption[];
  /** Formats a timeline position for display, e.g. "42.5 ms". */
  format: (t: number) => string;
  step: number;
  label: string;
  /** What kind of time this is, said once next to the clock. */
  clock: string;
}) {
  const { tl } = p;
  return (
    <div className="transport" role="group" aria-label={p.label} data-testid="transport">
      <button type="button" className="tp-btn tp-play" onClick={() => tl.setPlaying(!tl.playing)} aria-label={tl.playing ? 'Pause' : 'Play'} data-testid="tp-play" data-playing={tl.playing}>
        {tl.playing
          ? <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="2" width="3.6" height="12" rx="1" fill="currentColor" /><rect x="9.4" y="2" width="3.6" height="12" rx="1" fill="currentColor" /></svg>
          : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.2v11.6a.6.6 0 0 0 .9.5l9.2-5.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>}
      </button>
      <button type="button" className="tp-btn" onClick={() => tl.reset()} aria-label="Back to the start" title="Back to the start" data-testid="tp-reset">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 2v12M13.5 2.6v10.8a.5.5 0 0 1-.8.4L5.6 8.4a.5.5 0 0 1 0-.8l7.1-5.4a.5.5 0 0 1 .8.4z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      <input
        className="tp-scrub" type="range" min={0} max={p.duration} step={p.step} value={tl.t}
        onChange={(e) => { tl.setPlaying(false); tl.seek(+e.target.value); }}
        aria-label={`${p.label}: position`} aria-valuetext={p.format(tl.t)} data-testid="tp-scrub"
      />
      <output className="tp-clock mono" data-testid="tp-clock" title={p.clock}>{p.format(tl.t)}</output>
      <label className="tp-speed">
        <span className="sr-only">Playback speed</span>
        <select value={tl.speed} onChange={(e) => tl.setSpeed(+e.target.value)} data-testid="tp-speed" title="Playback speed">
          {p.speeds.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
    </div>
  );
}

// ── predict, then check ─────────────────────────────────────────────────────────────────────────────────────────
export interface PredictOption { id: string; label: string }
export interface PredictTask {
  id: string;
  question: string;
  options: PredictOption[];
  correct: string;
  /** Shown after answering: why, in the model's own terms. */
  explain: string;
  /** Per wrong option: what that answer would have meant. */
  wrong?: Record<string, string>;
  /** Label of the button that carries out the change in the scene. */
  tryLabel?: string;
}

/**
 * The learner commits to an answer before seeing the result. The answer is kept only in this browser (localStorage);
 * nothing is sent anywhere, and the studio makes no claim about what answering does for learning.
 */
export function Predict({ task, onTry, result }: { task: PredictTask; onTry?: () => void; result?: React.ReactNode }) {
  const key = `hbci.predict.${task.id}`;
  const [answer, setAnswer] = useState<string | null>(() => { try { return localStorage.getItem(key); } catch { return null; } });
  const [tried, setTried] = useState(false);
  const choose = (id: string) => { setAnswer(id); try { localStorage.setItem(key, id); } catch { /* storage unavailable */ } };
  const again = () => { setAnswer(null); setTried(false); try { localStorage.removeItem(key); } catch { /* storage unavailable */ } };
  const right = answer === task.correct;
  return (
    <section className="predict" aria-label="Predict, then check" data-testid={`predict-${task.id}`} data-answered={answer ? (right ? 'right' : 'wrong') : 'no'}>
      <div className="predict-kicker">Predict first</div>
      <p className="predict-q">{task.question}</p>
      <div className="predict-options" role="group" aria-label="Your prediction">
        {task.options.map((o) => (
          <button key={o.id} type="button" disabled={!!answer}
            className={`predict-opt${answer === o.id ? ' chosen' : ''}${answer && o.id === task.correct ? ' correct' : ''}${answer === o.id && !right ? ' incorrect' : ''}`}
            aria-pressed={answer === o.id} onClick={() => choose(o.id)} data-testid={`predict-${task.id}-${o.id}`}>{o.label}</button>
        ))}
      </div>
      {answer && (
        <div className="predict-feedback" role="status" data-testid={`predict-${task.id}-feedback`}>
          <strong>{right ? 'That is what the model does.' : 'Not in this model.'}</strong>{' '}
          {!right && task.wrong?.[answer] ? <>{task.wrong[answer]} </> : null}
          {task.explain}
          <div className="predict-actions">
            {onTry && <button type="button" className="btn btn-primary" onClick={() => { setTried(true); onTry(); }} data-testid={`predict-${task.id}-try`}>{task.tryLabel ?? 'Show me'}</button>}
            <button type="button" className="btn" onClick={again}>Ask me again</button>
          </div>
          {tried && result && <div className="predict-result" data-testid={`predict-${task.id}-result`}>{result}</div>}
        </div>
      )}
    </section>
  );
}

// ── the rail between scenes ─────────────────────────────────────────────────────────────────────────────────────
export function JourneyRail({ prev, next }: { prev?: { to: Workspace; label: string; cue: string }; next?: { to: Workspace; label: string; cue: string } }) {
  const go = useShell((s) => s.go);
  const name = (w: Workspace) => WORKSPACES.find((x) => x.id === w)?.label ?? w;
  return (
    <nav className="rail" aria-label="Previous and next scene">
      {prev ? (
        <button type="button" className="rail-btn prev" onClick={() => go(prev.to)} data-testid="rail-prev">
          <span className="rail-arrow" aria-hidden="true">←</span>
          <span><span className="rail-to">{name(prev.to)}</span><span className="rail-label">{prev.label}</span></span>
          <span className="rail-cue mono">{prev.cue}</span>
        </button>
      ) : <span />}
      {next ? (
        <button type="button" className="rail-btn next" onClick={() => go(next.to)} data-testid="rail-next">
          <span className="rail-cue mono">{next.cue}</span>
          <span><span className="rail-to">{name(next.to)}</span><span className="rail-label">{next.label}</span></span>
          <span className="rail-arrow" aria-hidden="true">→</span>
        </button>
      ) : <span />}
    </nav>
  );
}
