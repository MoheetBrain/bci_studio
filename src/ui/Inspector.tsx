// Right sidebar: one inspector object, two modes. LEARN answers the six beginner questions in plain English
// with one visual and one next action; INSPECT shows the technical content with expandable detail.
// Evidence status (kind badge, evidence badge, implementation words) stays visible in both.
import { useState, type ReactNode } from 'react';
import { COMPONENTS, COMPONENT_LIST } from '../model/components';
import type { ComponentInfo, Evidence, ImplStatus, Level, Preset, ProcMode } from '../model/types';
import { useScene } from '../state/sceneStore';
import { useArtifacts } from '../artifacts/load';
import { LOOP, MISSION, MODES } from '../model/system';
import { MODE_COLOR, PROC_MODES } from '../three/modes';
import { useView } from '../three/viewStore';
import { useV03 } from '../lab/v03Store';
import { hasCuratedLearn, implementationWords, learnCopyFor, nextActionFor, type NextActionId } from '../model/explain';
import { fmtMm, PROVENANCE_HELP, sizeRecordFor } from '../model/dimensions';
import { EvidenceBadge, EVIDENCE_HELP, MANDATE_EVIDENCE, STUDIO_EVIDENCE } from './EvidenceBadge';
import { DecoderPanel, V04Netlist } from './InspectorV04';
import { V04_IDS } from '../model/components';
import { startCourse } from '../micro/course/Course';
import { BLOCK_NAMES } from '../micro/names';
import { KindBadge } from './KindBadge';
import { InspectorExtras } from './InspectorExtras';
import { openScalePanel, ScalePanel } from './ScalePanel';
import { startLesson } from './Lesson';
import { ensurePresetFor, presetOf, selectAndNavigate } from './nav';
import './ui.css';
import './panels.css';

const STEPS: { id: ImplStatus; label: string; help: string }[] = [
  { id: 'conceptual', label: 'Concept', help: 'An idea or illustrative geometry; nothing is implemented.' },
  { id: 'simulated', label: 'Simulated', help: 'Behaviour verified in simulation (Icarus Verilog testbench).' },
  { id: 'synthesised', label: 'Synthesised', help: 'Converted to logic gates by a synthesis tool (generic Yosys, no PDK).' },
  { id: 'physically designed', label: 'Physical', help: 'Placed and routed with a real process design kit (PDK).' },
  { id: 'manufactured', label: 'Fabricated', help: 'Manufactured on silicon or as a physical part.' },
  { id: 'tested', label: 'Tested', help: 'Measured and characterised on real hardware.' },
];

const EVIDENCE_ORDER: Evidence[] = MANDATE_EVIDENCE;
const IS_3D: Record<Level, boolean> = { system: true, package: true, die: true, circuit: false, module: false, gates: false, cell: false, layout: false };

const LEVEL_OVERVIEW: Record<Level, { title: string; text: string }> = {
  system: {
    title: 'System context · bench prototype',
    text: 'The modular bench assembly and the READ → CHIP → DECODER → LLM → FEEDBACK loop. The digital logic inside HBCI-02 (DSP core and, since v0.4, the on-chip decoder) exists as real, verified RTL. Electrodes, front end, ADC, package and link are concepts; a larger external decoder is a concept; the language model is a scripted example; the feedback path is a software-only research branch.',
  },
  package: {
    title: 'My chip · package',
    text: 'A conceptual package around the HBCI-02 die: lid, substrate, bond wires and board contacts. No package has been designed; the geometry is illustrative and has no millimetre size.',
  },
  die: {
    title: 'My chip · silicon die',
    text: 'hbci02_digital_top (rtl/): the v0.3 readout core (legacy EVENT core, RAW lane, FEATURE path, record multiplexer) on the left, the v0.4 on-chip AI decoder (quantiser → frame collector → model store with CRC → MLP engine → prediction FIFO) on the right, with the register file and BIST above it. Block identity is RTL; relative size comes from synthesis cell counts; placement is a concept. Switch cfg_mode to see which path generates records; the decoder is fed in every mode.',
  },
  circuit: { title: 'My chip · RTL circuit', text: 'The real connections between the chip\'s blocks, from the Yosys netlist: the v0.4 digital top, the on-chip decoder, the v0.3 readout core and the legacy event core. Box positions are arranged for reading.' },
  module: { title: 'My chip · module microscope', text: 'One block with its real ports and neighbours, a simplified drawing of what it computes, and one real sample followed step by step through it.' },
  gates: { title: 'My chip · gates', text: 'Generic logic gates produced by synthesis (no process design kit). Large modules are shown at reduced bit widths.' },
  cell: { title: 'My chip · standard cell & transistors', text: 'One genuine SKY130 standard cell from the v0.2 layout, and a separate educational animation of transistors forming a NAND gate.' },
  layout: { title: 'My chip · physical layout', text: 'Genuine placed-and-routed layouts, one tab each: the v0.2 event core, the v0.3 readout core (DSP only, no decoder) and the v0.4 chip top hbci02_chip_top (when its artifact is published; otherwise the tab says so). A conceptual floorplan is a separate tab. Nothing is fabricated.' },
};

const PRESET_OVERVIEW: Record<Preset, { title: string; text: string }> = {
  bench: LEVEL_OVERVIEW.system,
  cortical: {
    title: 'System context · thin cortical candidate',
    text: 'A conceptual future architecture: a thin electrode film on a curved cortical surface, a flexible substrate, candidate thinned electronics, encapsulation and an external relay. It is not engineered, not manufactured and has no physical dimensions. Electrode sites, recording channels and processing channels are different counts.',
  },
};

const LOOP_BY_ID = Object.fromEntries(LOOP.map((l) => [l.id, l]));

/* ───────────────────────────── shared pieces ── */

function Section({ title, children, right, testid }: { title: string; children: ReactNode; right?: ReactNode; testid?: string }) {
  return (
    <section className="ins-sec" data-testid={testid}>
      <h4>
        {title}
        {right}
      </h4>
      {children}
    </section>
  );
}

/** Collapsible section for dense technical content (equations, code, tables). */
function Expander({ title, children, defaultOpen = false, right, testid }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; testid?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`ins-sec ins-exp${open ? ' open' : ''}`} data-testid={testid}>
      <button className="ins-expander" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <svg viewBox="0 0 10 10" width="10" height="10" className={open ? 'open' : ''} aria-hidden>
          <path d="M3 1.5L7 5 3 8.5" />
        </svg>
        <span>{title}</span>
        {right && <span className="ins-exp-right">{right}</span>}
      </button>
      {open && <div className="ins-exp-body">{children}</div>}
    </section>
  );
}

function Chip({ c }: { c: ComponentInfo }) {
  return (
    <button className="ins-link" onClick={() => selectAndNavigate(c)} title={`Select ${c.name}`}>
      <i className={`ev-dot ev-${c.evidence}`} />
      {c.name}
    </button>
  );
}

/** Small mode label; the Learn / Inspect switch itself lives in the top bar. Clicking it toggles the mode. */
function ModeSwitch() {
  const mode = useScene((s) => s.uiMode);
  const setUiMode = useScene((s) => s.setUiMode);
  return (
    <button className="ins-modelbl" onClick={() => setUiMode(mode === 'learn' ? 'inspect' : 'learn')} title={mode === 'learn' ? 'Plain-English view. Click for technical detail.' : 'Technical view. Click for the plain-English explanation.'} data-testid="inspector-mode">
      {mode === 'learn' ? 'Learn' : 'Expert'} <span aria-hidden>⇄</span>
    </button>
  );
}

/** Always-visible identity: name, kind, evidence, implementation status in words. */
function Head({ c, showId }: { c: ComponentInfo; showId?: boolean }) {
  const coreReal = c.id === 'sys.hbci01' || c.id === 'pkg.die';
  const synthed = c.id.startsWith('rtl.') && c.evidence === 'RTL';
  const hasV03Layout = useArtifacts((a) => !!a.layoutV03);
  const hasV04Layout = useArtifacts((a) => !!a.layoutV04);
  const expert = useScene((s) => s.uiMode === 'inspect');
  const nm = BLOCK_NAMES[c.id];
  const lit = nm ? (nm.module && nm.module !== nm.inst ? `${nm.inst} · ${nm.module}` : nm.inst) : '';
  return (
    <header className="ins-head">
      <div className="ins-head-row">
        <h3 className={`ins-name${nm && expert ? ' mono' : ''}`} data-testid="ins-name">{nm ? (expert ? lit : nm.friendly) : c.name}</h3>
        <ModeSwitch />
      </div>
      {nm && <div className={`ins-lit${expert ? '' : ' mono'}`} data-testid="ins-lit">{expert ? nm.friendly : lit}</div>}
      <div className="ins-badges">
        <KindBadge c={c} />
        {c.id.startsWith('rtl.') && c.level === 'die' && <span className="kind-pos" title="Where this block is drawn on the die map is a reading aid, not the floorplan: the genuine placement is on the Physical layout level.">CONCEPTUAL POSITION</span>}
        <EvidenceBadge e={c.evidence} title={`${c.evidence}: ${EVIDENCE_HELP[c.evidence]}${coreReal ? ' (this label is for the drawn geometry; the logic inside is RTL + SYNTH)' : ''}`} />
        {coreReal && <EvidenceBadge e="RTL" title="The DSP core and the on-chip decoder inside are simulated Verilog (Icarus, checked against a cycle-accurate reference)." />}
        {(coreReal || synthed) && <EvidenceBadge e="SYNTH" title="Synthesised with Yosys: generic gate counts and a SKY130 HD cell mapping (cell area only; the layout is a separate result)." />}
        {c.id === 'rtl.core' && <EvidenceBadge e="LAYOUT" title="This block has a genuine place-and-route result: the v0.2 event-core layout, which is not the v0.4 chip." />}
        {c.id === 'rtl.readout' && hasV03Layout && <EvidenceBadge e="LAYOUT" title="The v0.3 readout core alone (DSP, no decoder) has a genuine place-and-route result (artifacts/layout_v03)." />}
        {(coreReal || c.id === 'rtl.top04' || V04_IDS.includes(c.id)) && hasV04Layout && <EvidenceBadge e="LAYOUT" title="The v0.4 chip top hbci02_chip_top has a genuine place-and-route result (artifacts/layout_v04, Physical layout level). Not fabricated; its block placement is not what the die map draws." />}
        {showId && <code className="ins-id">{c.id}</code>}
      </div>
      <p className="ins-status" data-testid="impl-words">{implementationWords(c)}</p>
    </header>
  );
}

function Stepper({ status }: { status: ImplStatus }) {
  const cur = STEPS.findIndex((s) => s.id === status);
  return (
    <ol className="stepper" aria-label={`Implementation status: ${status}`}>
      {STEPS.map((s, i) => (
        <li key={s.id} className={i < cur ? 'done' : i === cur ? 'cur' : ''} title={`${s.label}: ${s.help}`}>
          <span className="stepper-dot">{i < cur ? '✓' : i + 1}</span>
          <span className="stepper-lbl">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Flow({ c, compact }: { c: ComponentInfo; compact?: boolean }) {
  const upstream = COMPONENT_LIST.filter((x) => x.feeds?.includes(c.id));
  const downstream = (c.feeds ?? []).map((f) => COMPONENTS[f]).filter(Boolean);
  const Arrow = () => (
    <div className="iflow-arrow" aria-hidden>
      <svg viewBox="0 0 12 18" width="12" height="18"><path d="M6 0v14M1.5 10L6 15l4.5-5" /></svg>
    </div>
  );
  return (
    <div className={`iflow${compact ? ' compact' : ''}`}>
      {upstream.length > 0 && (
        <div className="iflow-nb">
          <span className="faint">from</span> {upstream.map((u) => <Chip key={u.id} c={u} />)}
        </div>
      )}
      <div className="iflow-card in"><span className="iflow-k">Input</span><p>{c.input}</p></div>
      <Arrow />
      <div className="iflow-card tr"><span className="iflow-k">Transformation</span><p>{c.transformation}</p></div>
      <Arrow />
      <div className="iflow-card out"><span className="iflow-k">Output</span><p>{c.output}</p></div>
      {downstream.length > 0 && (
        <div className="iflow-nb">
          <span className="faint">to</span> {downstream.map((d) => <Chip key={d.id} c={d} />)}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── actions ── */

function openLab(tab: 'repr' | 'payload' | 'loop' | 'ai') {
  const s = useScene.getState();
  if (s.labSize === 'collapsed') s.setLabSize('normal');
  useV03.getState().setTab(tab);
}

function runNextAction(c: ComponentInfo, id: NextActionId) {
  const S = useScene.getState;
  switch (id) {
    case 'enter':
    case 'circuit':
      S().enter(c.id);
      break;
    case 'lift-lid': {
      if (S().level !== 'package') S().setLevel('package');
      const v = useView.getState();
      if (!v.exposeDie) v.toggleExposeDie();
      S().select('pkg.die');
      S().requestFit();
      break;
    }
    case 'system':
    case 'focus': {
      ensurePresetFor(c);
      const target: Level = id === 'system' ? 'system' : c.level;
      if (S().level !== target) S().setLevel(target);
      S().select(c.id);
      if (IS_3D[target]) S().requestFit();
      break;
    }
    case 'lab-loop': openLab('loop'); break;
    case 'lab-ai': openLab('ai'); break;
    case 'lab-payload': openLab('payload'); break;
    case 'lab-repr': openLab('repr'); break;
  }
}

function Actions({ c }: { c: ComponentInfo }) {
  const isolated = useScene((s) => s.isolateId === c.id);
  const hidden = useScene((s) => !!s.hidden[c.id]);
  const path = useScene((s) => s.highlightPath);
  const level = useScene((s) => s.level);
  const in3d = IS_3D[c.level];
  const S = useScene.getState;
  const goto = () => {
    ensurePresetFor(c);
    if (S().level !== c.level) S().setLevel(c.level);
  };
  const hasFlow = !!c.feeds?.length || COMPONENT_LIST.some((x) => x.feeds?.includes(c.id));
  return (
    <div className="ins-actions">
      {c.enter && (
        <button className="btn primary" onClick={() => S().enter(c.id)} title={`Open the ${c.enter} level for ${c.name}`}>
          Inspect deeper → {c.enter}
        </button>
      )}
      <button
        className={`btn${isolated ? ' on' : ''}`}
        disabled={!in3d}
        onClick={() => {
          if (isolated) return S().isolate(null);
          goto();
          if (S().selectedId !== c.id) S().select(c.id);
          S().isolate(c.id);
        }}
        title={in3d ? 'Show only this component and its sub-parts in the 3D view' : 'Shown in a 2D view; isolate applies to the 3D levels'}
      >
        {isolated ? 'Un-isolate' : 'Isolate'}
      </button>
      <button
        className="btn"
        disabled={!in3d}
        onClick={() => {
          goto();
          if (S().selectedId !== c.id) S().select(c.id);
          S().requestFit();
        }}
        title={in3d ? 'Frame this component in the 3D view' : 'Shown in a 2D view'}
      >
        Fit
      </button>
      <button
        className={`btn${path ? ' on' : ''}`}
        disabled={!hasFlow && !path}
        onClick={() => {
          if (!path && level !== c.level && in3d) goto();
          S().toggle('highlightPath');
        }}
        title={hasFlow ? 'Highlight the signal path through this component (upstream and downstream)' : 'This component is not on a modelled signal path'}
      >
        Highlight path
      </button>
      <button className={`btn${hidden ? ' on' : ''}`} onClick={() => S().setHidden(c.id, !hidden)} title={hidden ? 'Show it again' : 'Hide it in the 3D view'}>
        {hidden ? 'Show' : 'Hide'}
      </button>
    </div>
  );
}

/** Processing modes whose data path uses this block; the current cfg_mode is highlighted. */
function ModeChips({ modes }: { modes: ProcMode[] }) {
  const cur = useScene((s) => s.procMode);
  return (
    <div className="ins-modes" data-testid="inspector-modes">
      {PROC_MODES.map((m) => {
        const uses = modes.includes(m);
        return (
          <button
            key={m}
            className={`ins-mode${uses ? ' uses' : ''}${cur === m ? ' cur' : ''}`}
            style={{ ['--mc' as string]: MODE_COLOR[m] }}
            title={`${m} (cfg_mode = ${MODES[m].code}): ${MODES[m].summary}${uses ? '' : ' — this block is not on that data path'}\nClick to switch the studio to ${m}`}
            onClick={() => useScene.getState().setProcMode(m)}
          >
            {m}
          </button>
        );
      })}
      <span className="faint ins-modes-k">{modes.includes(cur) ? `on the ${cur} path` : `idle in ${cur}`}</span>
    </div>
  );
}

/* ───────────────────────────── Size & scale summary (Inspect) ── */

function SizeSummary({ c }: { c: ComponentInfo }) {
  const layout = useArtifacts((a) => a.layout);
  const sky130V03 = useArtifacts((a) => a.sky130V03);
  const sky130V04 = useArtifacts((a) => a.sky130V04);
  const layoutV03 = useArtifacts((a) => a.layoutV03);
  const layoutV04 = useArtifacts((a) => a.layoutV04);
  const r = sizeRecordFor(c, { layout, layoutV03, layoutV04, sky130V03, sky130V04 });
  const measurable = r.provenance === 'KNOWN' || r.provenance === 'TARGET';
  return (
    <div className="ins-size" data-testid="size-summary">
      <div className="ins-size-row">
        <span className={`prov prov-${r.provenance}`} title={PROVENANCE_HELP[r.provenance]}>{r.provenance}</span>
        {measurable ? (
          <span className="mono">{fmtMm(r.width_mm)} × {fmtMm(r.length_mm)}{r.thickness_mm !== null ? ` × ${fmtMm(r.thickness_mm)}` : ''}</span>
        ) : (
          <span className="muted">{r.notPhysical ? 'not a physical object' : 'no millimetre size'}</span>
        )}
      </div>
      {!measurable && r.why && <p className="ins-size-why">{r.why}</p>}
      <p className="ins-size-src faint">{r.source}</p>
      <button className="btn sm" onClick={openScalePanel} data-testid="open-scale">Open Size &amp; scale</button>
    </div>
  );
}

/* ───────────────────────────── LEARN ── */

function LearnBody({ c }: { c: ComponentInfo }) {
  const l = learnCopyFor(c);
  const next = nextActionFor(c);
  const loop = LOOP_BY_ID[c.id];
  const QA = ({ k, children }: { k: string; children: ReactNode }) => (
    <div className="learn-qa">
      <span className="learn-k">{k}</span>
      <p className="learn-a">{children}</p>
    </div>
  );
  return (
    <div className="learn" data-testid="learn-body" data-curated={hasCuratedLearn(c.id) ? '1' : '0'}>
      <QA k="What is it?">{l.what}</QA>
      <QA k="Why is it here?">{c.purpose}</QA>
      <QA k="What comes in?">{l.enters}</QA>
      <QA k="What changes?">{l.does}</QA>
      <QA k="What goes out?">{l.leaves}</QA>
      <QA k="What if removed?">{l.absent}</QA>
      <details className="learn-evidence" data-testid="learn-evidence">
        <summary>Actual source / evidence <EvidenceBadge e={c.evidence} /></summary>
        <p className="learn-a">
          {l.implemented}
          {loop && <span className={`ins-tag ${loop.implemented ? 'impl-yes' : 'impl-no'}`} title={loop.note} data-testid="inspector-implemented" style={{ marginLeft: 6 }}>implemented: {loop.implemented ? 'yes' : 'no'}</span>}
        </p>
        {c.rtlModule && <p className="learn-a mono">module {c.rtlModule}{c.rtlInstance ? ` · instance ${c.rtlInstance}` : ''}</p>}
        {c.source.length > 0 ? <ul className="ins-src">{c.source.map((p) => <li key={p}><code>{p}</code></li>)}</ul> : <p className="learn-a">No implementation: concept only.</p>}
        {BLOCK_NAMES[c.id]?.note && <p className="learn-a">{BLOCK_NAMES[c.id]!.note}</p>}
      </details>

      {l.example ? (
        <div className="learn-example" data-testid="learn-example">
          <span className="learn-k">{l.example.title}</span>
          <ul>
            {l.example.rows.map((r) => <li key={r} className="mono">{r}</li>)}
          </ul>
          {l.example.note && <p className="faint">{l.example.note}</p>}
        </div>
      ) : (
        <div className="learn-visual">
          <span className="learn-k">In one picture: what goes in, what happens, what comes out</span>
          <Flow c={c} compact />
        </div>
      )}

      <div className="learn-next">
        <button className="btn primary" onClick={() => runNextAction(c, next.id)} data-testid="learn-next">{next.label} →</button>
        <button className="learn-sizelink" onClick={openScalePanel} title="How big is it, and how sure are we?" data-testid="learn-size">Size &amp; scale</button>
      </div>
    </div>
  );
}

/* ───────────────────────────── INSPECT ── */

function InspectBody({ c }: { c: ComponentInfo }) {
  const loop = LOOP_BY_ID[c.id];
  const isRtl = c.id.startsWith('rtl.') || c.id === 'sys.hbci01' || c.id === 'pkg.die';
  return (
    <div className="inspect" data-testid="inspect-body">
      <Section title="Identity">
        <Stepper status={c.status} />
        <div className="ins-meta">
          <span className="ins-tag" title="Physical kind">{c.physical}</span>
          {c.rtlModule && (
            <span className="ins-tag mono" title="Verilog module / instance">
              {c.rtlModule}
              {c.rtlInstance ? ` · ${c.rtlInstance}` : ''}
            </span>
          )}
          <span className="ins-tag faint" title={EVIDENCE_HELP[c.evidence]}>evidence: {c.evidence}</span>
          {loop && (
            <span className={`ins-tag ${loop.implemented ? 'impl-yes' : 'impl-no'}`} title={loop.note} data-testid="inspector-implemented">
              implemented: {loop.implemented ? 'yes' : 'no'}
            </span>
          )}
          {presetOf(c) === 'cortical' && <span className="ins-tag impl-no">concept preset · no dimensions</span>}
        </div>
        {loop && <p className="ins-loopnote">{loop.note}</p>}
        {c.modes && c.modes.length > 0 && <ModeChips modes={c.modes} />}
      </Section>

      <Section title="Purpose">
        <p className="ins-purpose">{c.purpose}</p>
      </Section>

      {c.remove && (
        <section className="ins-sec ins-lesson" data-testid="inspector-remove">
          <h4>What changes if I remove it?</h4>
          <p>{c.remove}</p>
        </section>
      )}

      <Section title="Signal flow">
        <Flow c={c} />
      </Section>

      {c.constraints.length > 0 && (
        <Section title="Engineering constraints">
          <div className="ins-chips">
            {c.constraints.map((k) => <span key={k} className="ins-chip">{k}</span>)}
          </div>
        </Section>
      )}

      <Expander title="Technical explanation" testid="exp-technical">
        <p className="ins-tech">{c.technical}</p>
      </Expander>

      {V04_IDS.includes(c.id) && <DecoderPanel c={c} />}
      {V04_IDS.includes(c.id) && <V04Netlist c={c} />}

      <Expander title="Source" right={<span className="faint">{c.source.length ? `${c.source.length} file${c.source.length > 1 ? 's' : ''}` : 'none'}</span>} testid="exp-source">
        {c.source.length ? (
          <ul className="ins-src">
            {c.source.map((p) => <li key={p}><code>{p}</code></li>)}
          </ul>
        ) : (
          <p className="ins-none">No implementation: concept only.</p>
        )}
      </Expander>

      <Expander title="Size & scale" testid="exp-size">
        <SizeSummary c={c} />
      </Expander>

      <Section title="Actions">
        <Actions c={c} />
      </Section>

      <Expander title={isRtl ? 'Verification & synthesis' : 'Evidence'} defaultOpen={!isRtl} right={<EvidenceBadge e={isRtl ? 'RTL' : 'CONCEPT'} />} testid="exp-extras">
        <InspectorExtras id={c.id} />
      </Expander>
    </div>
  );
}

function ComponentInspector({ c }: { c: ComponentInfo }) {
  const mode = useScene((s) => s.uiMode);
  return (
    <div className="ins" key={c.id} data-testid="inspector" data-mode={mode}>
      <Head c={c} showId={mode === 'inspect'} />
      {mode === 'learn' ? <LearnBody c={c} /> : <InspectBody c={c} />}
    </div>
  );
}

/* ───────────────────────────── nothing selected ── */

function Overview() {
  const level = useScene((s) => s.level);
  const preset = useScene((s) => s.preset);
  const mode = useScene((s) => s.uiMode);
  const run = useArtifacts((a) => a.layout);
  const o = level === 'layout' && run
    ? {
        title: 'My chip · physical layout',
        text: `Two separate views. Genuine layout: hbci_event_core (v0.2) placed and routed on ${run.pdk.name} ${run.pdk.scl} by ${run.flow.name} `
          + `(${run.die.width_um.toFixed(1)} × ${run.die.height_um.toFixed(1)} µm die, ${run.constraints.clock_mhz.toFixed(0)} MHz clock), rendered from the GDSII. `
          + 'Conceptual floorplan: block areas scaled by generic cell counts, not taken from the layout. Nothing has been fabricated.',
      }
    : level === 'system'
      ? PRESET_OVERVIEW[preset]
      : LEVEL_OVERVIEW[level];
  const here = COMPONENT_LIST.filter((c) => c.level === level && (level !== 'system' || c.id === 'sys.hbci01' || presetOf(c) === preset));
  return (
    <div className="ins" data-testid="inspector-overview">
      <header className="ins-head">
        <div className="ins-head-row">
          <h3 className="ins-name">{o.title}</h3>
          <ModeSwitch />
        </div>
        <p className="ins-status">Nothing selected. Click a part in the 3D view or the tree.</p>
      </header>
      <Section title="Where you are">
        <p className="ins-purpose">{o.text}</p>
      </Section>
      <Section title="Mission">
        <p className="ins-mission" data-testid="mission-objective">{MISSION.objective}</p>
      </Section>
      <Section title="Lessons">
        <div className="ins-lessons">
          <button className="btn primary" onClick={() => startCourse(0)} data-testid="start-course">Explore my chip: 8 hands-on lessons</button>
          <button className="btn" onClick={() => startLesson('chip')} data-testid="start-lesson-chip">Start: Which part is the chip?</button>
          <button className="btn" onClick={() => startLesson('sample')} data-testid="start-lesson-sample">Start: Follow one sample</button>
          <button className="btn" onClick={() => startCourse(7)} data-testid="start-lesson-decoder">Lesson 8: the on-chip decoder (v0.4)</button>
          <button className="btn" onClick={() => { const s = useScene.getState(); if (s.labSize === 'collapsed') s.setLabSize('normal'); useV03.getState().setTab('ai'); }} data-testid="open-ai-lab">Follow one frame through the decoder</button>
        </div>
        <p className="faint ins-hint">Each step drives the real views. Back / Next / Exit; Esc exits. <button className="ins-textlink" onClick={() => startLesson('tour')}>Full 9-step tour</button></p>
      </Section>
      <Section title="Evidence labels">
        <ul className="ins-legend">
          {EVIDENCE_ORDER.map((e) => (
            <li key={e}>
              <EvidenceBadge e={e} />
              <span>{EVIDENCE_HELP[e]}</span>
            </li>
          ))}
        </ul>
        <p className="faint ins-hint">Studio-only labels for browser models and scripted examples:</p>
        <ul className="ins-legend">
          {STUDIO_EVIDENCE.map((e) => (
            <li key={e}>
              <EvidenceBadge e={e} />
              <span>{EVIDENCE_HELP[e]}</span>
            </li>
          ))}
        </ul>
      </Section>
      {mode === 'inspect' && here.length > 0 && (
        <Section title="Components on this level">
          <div className="ins-list">
            {here.map((c) => <Chip key={c.id} c={c} />)}
          </div>
        </Section>
      )}
      <Section title="Safety">
        <p className="warn-box">Never connect an unqualified development board to biological tissue or a human participant.</p>
      </Section>
    </div>
  );
}

export function Inspector() {
  const id = useScene((s) => s.selectedId);
  const c = id ? COMPONENTS[id] : null;
  return (
    <>
      {c ? <ComponentInspector key={c.id} c={c} /> : <Overview />}
      <ScalePanel />
    </>
  );
}
