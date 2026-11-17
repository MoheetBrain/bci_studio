// "Explore my chip": eight short, skippable, interactive lessons in a docked, non-modal panel over the centre
// viewport (the chip stays visible behind it). State lives in useMicro().course: { lesson, step, done }.
// step 0..n-1 are the lesson's steps, step n is its optional check. Esc closes the panel (when expanded).
// Every number in the lessons carries its source: RTL, SYNTH, DEMO, DERIVED (from the RTL trace) or EDUCATIONAL.
import { useEffect, useRef, useState } from 'react';
import { useMicro } from '../microStore';
import { useScene } from '../../state/sceneStore';
import { LESSONS, type CheckDef } from './lessons';
import './course.css';

/** Open the course at a lesson (0-based), first step. */
export function startCourse(lesson = 0) {
  const l = Math.max(0, Math.min(LESSONS.length - 1, Math.round(lesson)));
  useMicro.getState().setCourse({ lesson: l, step: 0 });
}

function closeCourse() {
  useMicro.getState().setCourse({ lesson: null });
}

function Check({ check, lessonIdx }: { check: CheckDef; lessonIdx: number }) {
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [lessonIdx]);
  const chosen = pick !== null ? check.options[pick] : null;
  return (
    <div className="c-check-q" data-testid="course-check">
      <p className="c-lead"><b>{check.q}</b></p>
      <div className="c-options" role="group" aria-label="Answers">
        {check.options.map((o, k) => (
          <button
            key={k}
            className={`c-option${pick === k ? (o.correct ? ' right' : ' wrong') : ''}`}
            aria-pressed={pick === k}
            onClick={() => setPick(k)}
          >
            <span className="c-option-mark" aria-hidden>{pick === k ? (o.correct ? '✓' : '✗') : String.fromCharCode(65 + k)}</span>
            {o.text}
          </button>
        ))}
      </div>
      <div className="c-feedback" aria-live="polite">
        {chosen && (
          <div className={`c-callout ${chosen.correct ? 'c-ok' : 'c-warn'}`}>
            <b>{chosen.correct ? 'Correct.' : 'Not quite.'}</b> {chosen.why}
          </div>
        )}
      </div>
      <p className="c-hint">This check is optional. Nothing is graded.</p>
    </div>
  );
}

export function CourseOverlay() {
  const lesson = useMicro((m) => m.course.lesson);
  if (lesson === null) return null;
  return <CoursePanel />;
}

function CoursePanel() {
  const course = useMicro((m) => m.course);
  const setCourse = useMicro((m) => m.setCourse);
  const reduced = useScene((s) => s.reducedMotion);
  const [collapsed, setCollapsed] = useState(false);
  const [showList, setShowList] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const li = Math.max(0, Math.min(LESSONS.length - 1, course.lesson ?? 0));
  const L = LESSONS[li];
  const nSteps = L.steps.length;
  const step = Math.max(0, Math.min(nSteps, course.step));
  const onCheck = step === nSteps;
  const last = li === LESSONS.length - 1;

  // Esc closes the expanded panel. Document listener + stopPropagation runs before App's window listener (level back).
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return; // let an open drop-down close first
      e.stopPropagation();
      closeCourse();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [collapsed]);

  // Opening: move keyboard focus into the panel.
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);

  // New lesson or step: scroll to top and, if the learner was working in the panel, focus the step heading.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    const a = document.activeElement;
    if (panelRef.current && a && panelRef.current.contains(a)) headRef.current?.focus({ preventScroll: true });
  }, [li, step]);

  // Reaching the check page means every step of the lesson was seen: tick it in the lesson list.
  useEffect(() => {
    if (onCheck && !course.done.includes(li)) setCourse({ done: [...course.done, li].sort((a, b) => a - b) });
  }, [onCheck, li]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (lesson: number, s: number) => { setCourse({ lesson: lesson, step: s }); setShowList(false); };
  const back = () => {
    if (step > 0) go(li, step - 1);
    else if (li > 0) go(li - 1, LESSONS[li - 1].steps.length);
  };
  const next = () => {
    if (!onCheck) go(li, step + 1);
    else if (!last) go(li + 1, 0);
    else closeCourse();
  };
  const nextLabel = onCheck ? (last ? 'Finish course' : 'Next lesson ›') : step === nSteps - 1 ? 'Check yourself ›' : 'Next ›';

  if (collapsed) {
    return (
      <button className="course-pill" onClick={() => setCollapsed(false)} data-testid="course-pill" aria-label={`Expand the course: lesson ${li + 1}, ${L.title}`}>
        <span className="course-pill-k">Explore my chip</span>
        <span>Lesson {li + 1}/{LESSONS.length}: {L.title}</span>
        <span aria-hidden>▴</span>
      </button>
    );
  }

  const Body = L.Body;
  return (
    <section
      ref={panelRef}
      className={`course${reduced ? ' reduce' : ''}`}
      role="region"
      aria-label="Explore my chip course"
      tabIndex={-1}
      data-testid="course"
    >
      <header className="course-head">
        <div className="course-head-t">
          <div className="course-kicker">Explore my chip · Lesson {li + 1} of {LESSONS.length}</div>
          <h2 className="course-title">{L.title}</h2>
        </div>
        <div className="course-head-b">
          <button className={`btn sm${showList ? ' on' : ''}`} aria-expanded={showList} aria-controls="course-list" onClick={() => setShowList(!showList)}>Lessons</button>
          <button className="btn sm course-icon" aria-label="Collapse the course panel" title="Collapse" onClick={() => setCollapsed(true)}>–</button>
          <button className="btn sm course-icon" aria-label="Close the course (Esc)" title="Close (Esc)" onClick={closeCourse} data-testid="course-close">×</button>
        </div>
      </header>

      {showList && (
        <ol className="course-list" id="course-list">
          {LESSONS.map((l, k) => {
            const done = course.done.includes(k);
            return (
              <li key={l.id}>
                <button className={k === li ? 'cur' : undefined} aria-current={k === li ? 'step' : undefined} onClick={() => go(k, 0)}>
                  <span className={`course-tick${done ? ' done' : ''}`} aria-label={done ? 'done' : 'not done yet'}>{done ? '✓' : k + 1}</span>
                  <span>{l.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="course-steps" aria-label="Steps of this lesson">
        {L.steps.map((s, k) => (
          <button key={s} className={`course-dot${k === step ? ' cur' : ''}${k < step ? ' seen' : ''}`} onClick={() => go(li, k)} aria-current={k === step ? 'step' : undefined} title={s}>
            <span className="sr">Step {k + 1}: </span>{k + 1}
          </button>
        ))}
        <button className={`course-dot chk${onCheck ? ' cur' : ''}`} onClick={() => go(li, nSteps)} aria-current={onCheck ? 'step' : undefined} title="Optional check">?<span className="sr"> Check</span></button>
        <span className="course-steps-t">{onCheck ? 'Check yourself' : `Step ${step + 1} of ${nSteps}`}</span>
      </div>

      <div className="course-body" ref={bodyRef}>
        <h3 className="course-step-title" ref={headRef} tabIndex={-1}>{onCheck ? 'Check yourself (optional)' : L.steps[step]}</h3>
        {onCheck ? (
          <>
            <Check check={L.check} lessonIdx={li} />
            {!last && <p className="c-hint">Next: lesson {li + 2}, {LESSONS[li + 1].title}.</p>}
            {last && <p className="c-hint">That was the last lesson. You can reopen any lesson from the Lessons list.</p>}
          </>
        ) : (
          <Body key={L.id} step={step} />
        )}
      </div>

      <footer className="course-foot">
        <button className="btn sm" onClick={back} disabled={li === 0 && step === 0}>‹ Back</button>
        {!onCheck && !last && <button className="btn sm course-skip" onClick={() => go(li + 1, 0)}>Skip lesson</button>}
        <span className="course-foot-sp" />
        <button className="btn sm primary" onClick={next} data-testid="course-next">{nextLabel}</button>
      </footer>
    </section>
  );
}
