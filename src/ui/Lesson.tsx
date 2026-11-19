// Short, skippable lessons that drive the real studio (levels, selection, isolate, camera, lid, modes and the
// signal lab). No video, no canned frames, no auto-start. Lessons: 'chip' (Which part is the chip?),
// 'sample' (Follow one sample) and the legacy 9-step 'tour'. Auto-advance is off under reduced motion.
import { useEffect, useRef } from 'react';
import { useScene } from '../state/sceneStore';
import { useArtifacts } from '../artifacts/load';
import { useLab } from '../lab/labStore';
import { useV03 } from '../lab/v03Store';
import { useView } from '../three/viewStore';
import type { Evidence } from '../model/types';
import { EvidenceBadge } from './EvidenceBadge';
import './lessons.css';

export type LessonId = 'chip' | 'sample' | 'tour';
type At = (ms: number, fn: () => void) => void;
interface Step {
  title: string;
  body: string | (() => string);
  /** Auto-advance delay in seconds (ignored under reduced motion). Always ≥ 8 for the short lessons. */
  dur: number;
  run: (at: At) => void;
  legend?: boolean;
  /** Closing lines shown as a list (used for the die / package / system distinction). */
  lines?: string[];
}
interface LessonDef { id: LessonId; title: string; steps: Step[] }

const S = () => useScene.getState();
const L = () => useLab.getState();
const V = () => useV03.getState();
const W = () => useView.getState();
const READ_CHAIN = ['sys.electrode_array', 'sys.flex_interconnect', 'sys.connector', 'sys.afe', 'sys.adc', 'sys.hbci01'];

/** Lesson-local memory: what to restore on exit. */
const memo = { highlightPath: false, labStarted: false, isolated: false };

/** Sample followed by lesson 2: inside the channel-1 burst of both sources (RTL t 150–349, DEMO t 175–325) and the default interval 120–376. */
const SAMPLE_T = 250;
const rtlAvailable = () => !!useArtifacts.getState().traceV03;
const sourceWords = () => (rtlAvailable() ? 'actual RTL values from the Icarus trace (rtl_trace_v03.json)' : 'the educational DEMO model (featureModel.ts), not the Verilog');

const CHIP: LessonDef = {
  id: 'chip',
  title: 'Which part is the chip?',
  steps: [
    {
      title: 'The package',
      body: 'This is the HBCI-02 package: a lid on top, a substrate underneath, solder contacts below and, hidden inside, the die. Everything you see here is drawn in scene units; no package has been designed.',
      dur: 9,
      run: () => {
        if (S().level !== 'package') S().setLevel('package');
        if (W().exposeDie) W().toggleExposeDie();
        S().isolate(null);
        S().select('sys.hbci01');
        S().requestReset();
      },
    },
    {
      title: 'Lift the lid',
      body: 'Under the lid sits the silicon die: the small square that carries all of the chip\'s logic. It is the only part of this package with real, tested RTL behind it.',
      dur: 9,
      run: (at) => {
        if (S().level !== 'package') S().setLevel('package');
        if (!W().exposeDie) W().toggleExposeDie();
        S().isolate(null);
        S().select('pkg.die');
        at(500, () => S().requestFit());
      },
    },
    {
      title: 'The die on its own',
      body: 'Isolated, the die is just this square. Its drawn size is illustrative. Real sizes come only from place-and-route results on the Physical layout level: the v0.2 event core measured about 0.25 × 0.26 mm, the v0.3 readout core about 0.79 × 0.80 mm, and the v0.4 chip top about 1.04 × 1.05 mm when its artifact is published.',
      dur: 10,
      run: (at) => {
        S().select('pkg.die');
        S().isolate('pkg.die');
        memo.isolated = true;
        at(300, () => S().requestFit());
      },
    },
    {
      title: 'How it connects: bond wires',
      body: 'Hair-thin bond wires are the die\'s only electrical way in and out. Clock, reset, configuration and samples go in; records and status counters come out.',
      dur: 9,
      run: (at) => {
        S().isolate(null);
        memo.isolated = false;
        S().select('pkg.bonds');
        at(300, () => S().requestFit());
      },
    },
    {
      title: 'How it connects: package contacts',
      body: 'The substrate fans those wires out to solderable contacts on the underside. Substrate, wires and contacts are packaging, not the chip itself.',
      dur: 9,
      run: (at) => {
        S().select('pkg.pins');
        at(300, () => S().requestFit());
      },
    },
    {
      title: 'Where it sits in the system',
      body: 'On the bench prototype the packaged chip sits on a board between the ADC and the communication link. Electrodes, front end, ADC and link are concepts; the chip logic inside (DSP core + on-chip decoder) is RTL.',
      dur: 10,
      run: (at) => {
        S().isolate(null);
        if (S().level !== 'system') S().setLevel('system');
        if (S().preset !== 'bench') S().setPreset('bench');
        at(900, () => {
          S().select('sys.hbci01');
          S().requestFit();
        });
      },
    },
    {
      title: 'Die vs package vs system',
      body: 'Three different things share the name "chip" in everyday speech. Keep them apart:',
      lines: [
        'Die: the silicon with the logic. Real RTL, simulated and synthesised; size unknown (no v0.3 layout).',
        'Package: lid, substrate, bond wires and contacts around the die. Concept geometry in scene units.',
        'System: board, sensors, link and software around the package. Concept; the software stages are not implemented.',
      ],
      dur: 12,
      run: () => {
        if (S().level !== 'system') S().setLevel('system');
        S().select('sys.hbci01');
      },
    },
  ],
};

const SAMPLE: LessonDef = {
  id: 'sample',
  title: 'Follow one sample',
  steps: [
    {
      title: 'Open the signal lab',
      body: () => `Channel 1 of the synthetic teaching profile: 8 channels, 2,000 samples per second each, values in ADC codes (dimensionless). Source: ${sourceWords()}. The die view above will light up the path the sample takes.`,
      dur: 10,
      run: () => {
        L().setPlaying(false);
        const s = S();
        if (s.labSize === 'collapsed') s.setLabSize('normal');
        const v = V();
        v.setTab('repr');
        v.setSource(rtlAvailable() ? 'rtl' : 'demo');
        v.setCh(1);
        v.setInterval(120, 376);
        v.select(SAMPLE_T);
        memo.labStarted = true;
        if (S().level !== 'die') S().setLevel('die');
        S().setProcMode('RAW');
        S().select('rtl.readout');
      },
    },
    {
      title: 'One sample, in ADC codes',
      body: `The dashed marker in the lab is sample t = ${SAMPLE_T} of channel 1, inside the 100 Hz burst (interval t 120–376). Its value is an ADC code shown in the "Follow one sample" card; nothing has been converted to microvolts.`,
      dur: 9,
      run: () => {
        V().setTab('repr');
        V().setCh(1);
        V().select(SAMPLE_T);
        S().setProcMode('RAW');
      },
    },
    {
      title: 'RAW: straight through',
      body: 'In RAW mode the sample enters the readout core, passes the RAW path unchanged and is queued as an 89-bit record carrying its channel and sample index. Watch the die light up along that path.',
      dur: 10,
      run: (at) => {
        if (S().level !== 'die') S().setLevel('die');
        S().setProcMode('RAW');
        S().select('rtl.raw_path');
        V().select(SAMPLE_T);
        at(400, () => V().setFlowStage(0));
      },
    },
    {
      title: 'FEATURE: filter, then energy',
      body: 'In FEATURE mode the same sample updates the band-pass filter and the window energy. Only when a 32-sample window completes does one energy record leave: a measure of activity in the band, not a meaning.',
      dur: 10,
      run: (at) => {
        if (S().level !== 'die') S().setLevel('die');
        S().setProcMode('FEATURE');
        S().select('rtl.u_biquad');
        V().select(SAMPLE_T);
        at(400, () => V().setFlowStage(0));
      },
    },
    {
      title: 'Where implemented processing stops',
      body: 'Records leave the chip through the record multiplexer. Since v0.4 the chip also feeds every completed energy window into its on-chip decoder (raspberry block, RTL): the "On-chip AI" tab of the signal lab follows one frame through it. Beyond the chip, the communication link is a concept and the language model and feedback are software functions outside the body that are not built.',
      dur: 12,
      run: (at) => {
        V().setFlowStage(null);
        S().select('rtl.u_records');
        at(300, () => S().requestFit());
      },
    },
    {
      title: 'Back to the bench',
      body: 'Here is the packaged chip on the bench. Inside it, the DSP core and the on-chip decoder are RTL (synthesised; genuine layouts on the Physical layout level); everything after it exists only as labelled concepts or a scripted example. Nothing is MEASURED yet.',
      legend: true,
      dur: 10,
      run: (at) => {
        V().setFlowStage(null);
        S().setActiveBlocks([]);
        if (S().level !== 'system') S().setLevel('system');
        if (S().preset !== 'bench') S().setPreset('bench');
        at(900, () => {
          S().select('sys.hbci01');
          S().requestFit();
        });
      },
    },
  ],
};

const TOUR: LessonDef = {
  id: 'tour',
  title: '60-second tour',
  steps: [
    {
      title: 'The bench prototype: READ',
      body: 'Electrodes pick up microvolt signals, the analog front end amplifies them and the ADC turns them into numbers for HBCI-02. Electrodes, front end and ADC are concepts; the chip core is real RTL.',
      dur: 8,
      run: (at) => {
        if (S().level !== 'system') S().setLevel('system');
        S().setPreset('bench');
        S().setExplode(0.2);
        if (!S().highlightPath) S().toggle('highlightPath');
        S().requestReset();
        READ_CHAIN.forEach((_, i) => at(i * 900, () => S().setActiveBlocks(READ_CHAIN.slice(0, i + 1))));
      },
    },
    {
      title: 'Explode, then pick HBCI-02',
      body: 'Every part separates along its assembly axis. HBCI-02 is the block with a real hardware description behind it: a waveform-preserving readout core plus an on-chip decoder.',
      dur: 8,
      run: (at) => {
        S().setActiveBlocks([]);
        if (S().highlightPath) S().toggle('highlightPath');
        S().setMode('exploding');
        at(2300, () => {
          S().select('sys.hbci01');
          S().requestFit();
        });
      },
    },
    {
      title: 'Into the die: RAW mode',
      body: 'RAW: every digital sample passes straight through to the record multiplexer with its channel and sample index. Nothing is summarised, so a decoder can still use the whole waveform.',
      dur: 8,
      run: (at) => {
        S().setLevel('package');
        at(1400, () => {
          S().setLevel('die');
          S().setProcMode('RAW');
          S().select('rtl.raw_path');
        });
        at(2900, () => S().setActiveBlocks(['rtl.readout', 'rtl.raw_path', 'rtl.u_records']));
      },
    },
    {
      title: 'FEATURE mode: a summary',
      body: 'A band-pass biquad and a windowed energy turn many samples into one number per channel per window. Far less data, but the waveform cannot be rebuilt from it.',
      dur: 8,
      run: (at) => {
        if (S().level !== 'die') S().setLevel('die');
        S().setProcMode('FEATURE');
        S().select('rtl.u_biquad');
        S().setActiveBlocks(['rtl.u_fstate', 'rtl.u_biquad', 'rtl.u_energy', 'rtl.u_records']);
        at(3300, () => S().select('rtl.u_energy'));
      },
    },
    {
      title: 'Follow a sample',
      body: 'The signal lab injects a synthetic burst on channel 1 (DEMO model, not the Verilog) and follows one of its samples through the readout core in HYBRID mode: RAW lane and FEATURE path together.',
      dur: 8,
      run: (at) => {
        if (S().level !== 'die') S().setLevel('die');
        S().setActiveBlocks([]);
        S().setProcMode('HYBRID');
        S().select(null);
        L().setPlaying(false);
        if (S().labSize === 'collapsed') S().setLabSize('normal');
        const v = V();
        v.setTab('repr');
        v.setSource('demo');
        v.setCh(1);
        v.injectBurst();
        v.setFlowStage(0);
        memo.labStarted = true;
        at(3700, () => V().setFlowStage(0));
      },
    },
    {
      title: 'EVENT mode: the legacy comparator',
      body: 'The unchanged v0.2 core compares each sample with a threshold and reports only crossings. Compact, but lossy: the waveform is discarded.',
      dur: 8,
      run: () => {
        if (S().level !== 'die') S().setLevel('die');
        S().setProcMode('EVENT');
        S().select('rtl.core');
        if (memo.labStarted) V().setFlowStage(0);
      },
    },
    {
      title: 'Back to the system: the loop',
      body: 'After the chip: the small decoder now runs on the chip (RTL); larger decoding stays an external concept, the language model is a scripted example only, and the feedback path is a software-only research branch, not a neural sensation.',
      dur: 8,
      run: (at) => {
        if (memo.labStarted) V().setFlowStage(null);
        S().setActiveBlocks([]);
        S().setLevel('system');
        S().setPreset('bench');
        at(1500, () => {
          S().select('loop.ext_decoder');
          S().requestFit();
        });
        at(3500, () => S().select('loop.llm'));
        at(5000, () => {
          S().select('loop.feedback');
          S().requestReset();
        });
      },
    },
    {
      title: 'A different architecture (concept)',
      body: 'A thin film on the cortex instead of boards. Electrode sites, recording channels and processing channels (HBCI-02 has 8) are different counts. Nothing here is engineered or manufactured.',
      dur: 8,
      run: (at) => {
        if (S().level !== 'system') S().setLevel('system');
        S().setPreset('cortical');
        S().setExplode(0.75);
        at(3000, () => S().select('cx.electrode_film'));
      },
    },
    {
      title: 'What is real, what is concept',
      body: 'The evidence badge on every part tells you how real it is. Nothing is MEASURED yet.',
      dur: 8,
      legend: true,
      run: () => S().select(null),
    },
  ],
};

export const LESSONS: Record<LessonId, LessonDef> = { chip: CHIP, sample: SAMPLE, tour: TOUR };
/** Legacy export: the 9-step tour. */
export const LESSON = TOUR.steps;
const LEGEND: Evidence[] = ['RTL', 'SYNTH', 'LAYOUT', 'DEMO', 'SCRIPTED', 'CONCEPT'];

function lessonOf(id: string | null): LessonDef {
  return (id && LESSONS[id as LessonId]) || TOUR;
}

export function startLesson(id: LessonId = 'chip') {
  const s = S();
  memo.highlightPath = s.highlightPath;
  memo.labStarted = false;
  memo.isolated = false;
  s.setLessonStep(0, id);
}

export function exitLesson() {
  const s = S();
  if (s.lessonStep === null) return;
  s.setLessonStep(null, null);
  if (memo.labStarted) V().setFlowStage(null);
  s.setActiveBlocks([]);
  if (memo.isolated) s.isolate(null);
  if (s.highlightPath !== memo.highlightPath) s.toggle('highlightPath');
}

function go(step: number) {
  const def = lessonOf(S().lessonId);
  if (step < 0) step = 0;
  if (step >= def.steps.length) return exitLesson();
  S().setLessonStep(step, def.id);
}

/** Runs the current step (and its timers); renders the caption card. Mount once in the viewport overlay. */
export function LessonOverlay() {
  const step = useScene((s) => s.lessonStep);
  const lessonId = useScene((s) => s.lessonId);
  const reducedMotion = useScene((s) => s.reducedMotion);
  const timers = useRef<number[]>([]);
  const def = lessonOf(lessonId);

  useEffect(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (step === null) return;
    const st = def.steps[step];
    if (!st) return;
    const at: At = (ms, fn) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    st.run(at);
    if (!reducedMotion) at(Math.max(8, st.dur) * 1000, () => go(step + 1));
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // Re-run only when the step or lesson changes; toggling reduced motion mid-step should not replay the step.
  }, [step, lessonId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc exits the lesson (captured before the app's own Esc = "back" handler).
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      exitLesson();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  // Leaving the 3D levels (circuit / gates / layout) ends the lesson: the card lives in the 3D overlay.
  useEffect(
    () =>
      useScene.subscribe((s, p) => {
        if (s.lessonStep !== null && s.level !== p.level && !['system', 'package', 'die'].includes(s.level)) exitLesson();
      }),
    [],
  );

  if (step === null) return null;
  const st = def.steps[step];
  if (!st) return null;
  const n = def.steps.length;
  const body = typeof st.body === 'function' ? st.body() : st.body;
  return (
    <div className="lsn" role="dialog" aria-label={`Lesson: ${def.title}`} data-testid="lesson" data-lesson={def.id} data-step={step}>
      <div className="lsn-top">
        <span className="lsn-k">{def.title} · {step + 1}/{n}</span>
        {reducedMotion && <span className="lsn-rm" title="Reduced motion is on: steps do not advance by themselves">manual steps</span>}
      </div>
      <b className="lsn-title">{st.title}</b>
      <p className="lsn-body">{body}</p>
      {st.lines && (
        <ul className="lsn-lines">
          {st.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {st.legend && (
        <div className="lsn-legend">
          {LEGEND.map((e) => <EvidenceBadge key={e} e={e} />)}
        </div>
      )}
      {!reducedMotion && (
        <div className="lsn-bar" aria-hidden>
          <span key={`${def.id}-${step}`} className="lsn-fill" style={{ animationDuration: `${Math.max(8, st.dur)}s` }} />
        </div>
      )}
      <div className="lsn-actions">
        <button className="btn sm" onClick={() => go(step - 1)} disabled={step === 0} data-testid="lesson-back">◀ Back</button>
        <button className="btn sm primary" onClick={() => go(step + 1)} data-testid="lesson-next">{step === n - 1 ? 'Finish' : 'Next ▶'}</button>
        <span className="spacer" />
        <span className="faint lsn-esc">Esc exits</span>
        <button className="btn sm" onClick={exitLesson} data-testid="lesson-exit">Exit ✕</button>
      </div>
    </div>
  );
}

/** Entry points shown in the viewport title area when no lesson is running. */
export function LessonButton() {
  const running = useScene((s) => s.lessonStep !== null);
  if (running) return null;
  return (
    <div className="lsn-starts" data-testid="lesson-starts">
      <button className="lsn-start" onClick={() => startLesson('chip')} data-testid="lesson-start" title="7 steps: open the package, lift the lid, find the die, see where it sits in the system">▶ Which part is the chip?</button>
      <button className="lsn-start" onClick={() => startLesson('sample')} data-testid="lesson-start-sample" title="6 steps: one channel-1 sample through RAW and FEATURE, stopping where implemented processing stops">▶ Follow one sample</button>
    </div>
  );
}
