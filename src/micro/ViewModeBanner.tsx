// Persistent display-mode header for every MY CHIP level, plus the "What am I looking at?" card.
// It names the kind of picture on screen (logical map, RTL circuit, synthesised gates, real layout,
// educational tutorial) and says what in it is real and what is a drawing. Owned by the main agent.
import { useEffect, useRef } from 'react';
import { useScene } from '../state/sceneStore';
import { useArtifacts } from '../artifacts/load';
import type { Evidence, Level } from '../model/types';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { GLOSSARY } from './names';
import { useMicro } from './microStore';
import { startCourse } from './course/Course';
import './micro.css';

export type DisplayMode =
  | 'system' | 'package' | 'logical-map' | 'rtl-circuit' | 'module' | 'compute' | 'synth-gates'
  | 'layout-v02' | 'layout-v03' | 'layout-v04' | 'layout-concept' | 'cell-pdk' | 'transistor-tutorial';

interface ModeInfo {
  label: string;
  evidence: Evidence;
  sentence: string;
  real: string;
  concept: string;
  legend: { sw: string; k: string; v: string }[];
  howTo: string[];
}

export const DISPLAY: Record<DisplayMode, ModeInfo> = {
  system: {
    label: 'SYSTEM CONTEXT — CONCEPT', evidence: 'CONCEPT',
    sentence: 'Where the chip would sit in a complete brain–computer interface. Only the chip\'s digital logic is real.',
    real: 'The HBCI-02 chip logic: DSP readout core and on-chip AI decoder (RTL, simulated, synthesised).',
    concept: 'Electrodes, front end, ADC, power, housing, the larger external decoder and the language-model stage are illustrations.',
    legend: [{ sw: 'sw-concept', k: 'Grey dot', v: 'concept: not engineered' }, { sw: 'sw-rtl', k: 'Green dot', v: 'real RTL behind it' }],
    howTo: ['Click a part to select it.', 'Use “My chip” at the top to go to the chip itself.'],
  },
  package: {
    label: 'CHIP PACKAGE — CONCEPT GEOMETRY', evidence: 'CONCEPT',
    sentence: 'An illustrative package around the die. No package, pin-out or bond diagram has been designed.',
    real: 'The die\'s logic inside it.',
    concept: 'Lid, substrate, bond wires, contacts and every size on this screen.',
    legend: [{ sw: 'sw-concept', k: 'All geometry', v: 'scene units, no millimetres' }],
    howTo: ['“Open package” lifts the lid.', '“Explore inside” on the die opens the logical block map.'],
  },
  'logical-map': {
    label: 'LOGICAL BLOCK MAP (v0.4) — REAL RTL, CONCEPTUAL PLACEMENT', evidence: 'RTL',
    sentence: 'Each coloured tile is a real block of Verilog of hbci02_digital_top: the v0.3 DSP core on the left, the v0.4 on-chip AI decoder on the right. Where a tile sits, its shape and the copper-coloured routes are drawn for clarity, not taken from a layout.',
    real: 'Block identities, their ports and which blocks connect (Yosys netlist, rtl_modules.json v03 / v04 / v04.ai). Tile area follows synthesised cell counts.',
    concept: 'Positions, shapes, the copper-coloured routes, the white contact pads and the FIFO animation.',
    legend: [
      { sw: 'sw-tile', k: 'Coloured tile', v: 'one RTL module instance (logical circuit, conceptual position)' },
      { sw: 'sw-route', k: 'Copper line', v: 'a real connection, drawn as a conceptual route (not a fabricated wire)' },
      { sw: 'sw-bus', k: 'Triple line', v: 'a bus: many wires in parallel; thickness is not physical width' },
      { sw: 'sw-pad', k: 'White square', v: 'illustrative contact pad (no engineered pad ring)' },
      { sw: 'sw-lit', k: 'Lit frame', v: 'path that makes records in the chosen cfg_mode' },
      { sw: 'sw-ai', k: 'Raspberry frame', v: 'the on-chip AI decoder, fed by every completed window in every mode (v0.4, RTL)' },
    ],
    howTo: ['Click a tile to select it; “Explore inside” flies into it.', 'Click a copper line or a white pad to have it explained.', '“Netlist lines” swaps the drawn routes for straight netlist connections.'],
  },
  'rtl-circuit': {
    label: 'RTL CIRCUIT', evidence: 'RTL',
    sentence: 'The real connections between the chip\'s blocks, taken from the Yosys netlist. Box positions are arranged for reading.',
    real: 'Every arrow is a net (or bundle of nets) in the synthesised netlist.',
    concept: 'Where the boxes sit on the page.',
    legend: [{ sw: 'sw-route', k: 'Arrow', v: 'nets from one block to another' }, { sw: 'sw-dash', k: 'Dashed arrow', v: 'state written back to a per-channel memory' }],
    howTo: ['Click a block to see its Verilog.', 'Double-click a block for its gates.'],
  },
  module: {
    label: 'MODULE DATAFLOW — REAL PORTS, SIMPLIFIED INSIDE', evidence: 'RTL',
    sentence: 'One block, its real inputs and outputs and the blocks it talks to. The inside is a simplified reading of its Verilog.',
    real: 'Port names, widths and signedness (rtl_modules.json); neighbours (netlist); Verilog line references.',
    concept: 'The simplified internal drawing (it groups many gates into a few operators).',
    legend: [
      { sw: 'sw-store', k: 'Square corners', v: 'stored value (flip-flops, changes only on a clock edge)' },
      { sw: 'sw-comb', k: 'Round corners', v: 'computed value (combinational logic, changes immediately)' },
      { sw: 'sw-bus', k: 'Thick line', v: 'bus (several bits)' },
    ],
    howTo: ['Click a port or wire to inspect the signal.', '“One sample, step by step” plays a real RTL example.'],
  },
  compute: {
    label: 'ONE SAMPLE — ACTUAL RTL TRACE VALUES', evidence: 'RTL',
    sentence: 'A single real sample followed clock by clock through state read, arithmetic, decision, state update and output.',
    real: 'x, y, acc, cnt and done come from the Icarus Verilog trace (rtl_trace_v03.json).',
    concept: 'Nothing. Values marked DERIVED are reconstructed from earlier trace samples and checked against the trace.',
    legend: [{ sw: 'sw-store', k: 'Stored', v: 'read from or written to memory' }, { sw: 'sw-comb', k: 'Computed', v: 'combinational, same clock cycle' }],
    howTo: ['Step forward and back.', '“Show bits” adds binary.', 'Pick another sample with the slider.'],
  },
  'synth-gates': {
    label: 'SYNTHESISED GATES', evidence: 'SYNTH',
    sentence: 'Logic gates and flip-flops that Yosys generated from the Verilog. Large modules are shown with reduced bit widths so they fit on a page.',
    real: 'Each gate and its source line (Yosys netlist with src attributes).',
    concept: 'Nothing, but reduced-width views are a smaller copy of the same RTL, not the shipped widths.',
    legend: [{ sw: 'sw-gate', k: 'Gate symbol', v: 'AND, OR, XOR, NOT, MUX…' }, { sw: 'sw-store', k: 'Box with clock', v: 'flip-flop (stored bit)' }],
    howTo: ['Click a gate to explain it.', 'Click a source line to light up its gates.'],
  },
  'layout-v02': {
    label: 'PHYSICAL LAYOUT — v0.2 EVENT CORE ONLY', evidence: 'LAYOUT',
    sentence: 'A genuine placed-and-routed SKY130 layout of the v0.2 event core only: a smaller, older chip. The v0.3 core and the v0.4 chip top have their own tabs when their artifacts are published.',
    real: 'Polygons from the final GDSII of the v0.2 event core (LibreLane, DRC/LVS clean).',
    concept: 'Nothing on this tab; it is simply not the v0.4 chip.',
    legend: [{ sw: 'sw-m1', k: 'Blue / red / green', v: 'metal layers 1 / 2 / 3' }, { sw: 'sw-m4', k: 'Yellow / violet', v: 'power straps (met4 / met5)' }],
    howTo: ['Scroll to zoom, drag to pan.', 'Switch Routing / Devices / Centre for different layer groups.'],
  },
  'layout-v03': {
    label: 'PHYSICAL LAYOUT — v0.3 READOUT CORE ONLY', evidence: 'LAYOUT',
    sentence: 'A genuine placed-and-routed SKY130 layout of the v0.3 readout core (hbci_readout_core: DSP only, no decoder). It is not the v0.4 chip, which has its own tab when its artifact is published.',
    real: 'Polygons rendered from the final GDSII and the timing, DRC/LVS and power figures of that LibreLane run (layout_v03/layout_summary.json).',
    concept: 'Nothing on this tab; it is simply not the v0.4 chip and holds no AI decoder.',
    legend: [{ sw: 'sw-m1', k: 'Blue / red / green', v: 'metal layers 1 / 2 / 3' }, { sw: 'sw-m4', k: 'Yellow / violet', v: 'power straps (met4 / met5)' }],
    howTo: ['Scroll to zoom, drag to pan.', 'Switch the rendered views for different layer groups.'],
  },
  'layout-v04': {
    label: 'PHYSICAL LAYOUT — v0.4 hbci02_chip_top', evidence: 'LAYOUT',
    sentence: 'A genuine placed-and-routed SKY130 layout of the v0.4 chip top (hbci02_chip_top) from the LibreLane flow under physical/.',
    real: 'Polygons rendered from the final GDSII, the timing, DRC/LVS and power figures of that run (layout_v04/layout_summary.json).',
    concept: 'Nothing on this tab. Not fabricated.',
    legend: [{ sw: 'sw-m1', k: 'Blue / red / green', v: 'metal layers 1 / 2 / 3' }, { sw: 'sw-m4', k: 'Yellow / violet', v: 'power straps (met4 / met5)' }],
    howTo: ['Scroll to zoom, drag to pan.', 'Switch the rendered views for different layer groups.'],
  },
  'layout-concept': {
    label: 'CONCEPTUAL FLOORPLAN', evidence: 'CONCEPT',
    sentence: 'Rough relative block areas from cell counts. Not a layout.',
    real: 'The cell counts.', concept: 'Every position and shape.',
    legend: [{ sw: 'sw-concept', k: 'Hatched tile', v: 'relative area estimate' }],
    howTo: ['Switch to “Genuine layout (GDSII)” for the real v0.2 layout.'],
  },
  'cell-pdk': {
    label: 'STANDARD CELL — SKY130 PDK DATA', evidence: 'LAYOUT',
    sentence: 'One genuine SKY130 standard cell, taken from the v0.2 layout\'s GDSII. It is one cell, not the layout of the v0.3 die.',
    real: 'The cell\'s polygons (GDSII) and its transistor netlist (PDK SPICE).',
    concept: 'Nothing on this tab.',
    legend: [{ sw: 'sw-diff', k: 'Green', v: 'diffusion (where transistors form)' }, { sw: 'sw-poly', k: 'Red', v: 'polysilicon (transistor gates)' }],
    howTo: ['Toggle layers on and off.', 'Hover a polygon for its layer.'],
  },
  'transistor-tutorial': {
    label: 'TRANSISTOR TUTORIAL — EDUCATIONAL', evidence: 'CONCEPT',
    sentence: 'An educational animation of how MOSFET switches make a NAND gate. Idealised devices, not technology-specific PDK data.',
    real: 'The logic it teaches (NAND truth table) and the series/parallel structure, which matches the PDK cell.',
    concept: 'Device shapes, the animation and any currents shown.',
    legend: [{ sw: 'sw-on', k: 'Lit transistor', v: 'conducting (switch closed)' }, { sw: 'sw-off', k: 'Dim transistor', v: 'off (switch open)' }],
    howTo: ['Toggle inputs A and B.', 'Watch which switches close.'],
  },
};

/** Display mode of the current screen. */
export function useDisplayMode(): DisplayMode {
  const level = useScene((s) => s.level);
  const cellTab = useMicro((m) => m.cellTab);
  const moduleTab = useMicro((m) => m.moduleTab);
  const layoutTab = useMicro((m) => m.layoutTab);
  const layout = useArtifacts((a) => a.layout);
  const layoutV04 = useArtifacts((a) => a.layoutV04);
  const layoutV03 = useArtifacts((a) => a.layoutV03);
  const tab = layoutTab === 'layout_v04' ? (layoutV04 ? 'layout_v04' : 'concept') : layoutTab === 'layout_v03' ? (layoutV03 ? 'layout_v03' : 'concept') : layoutTab === 'layout' ? (layout ? 'layout' : 'concept') : 'concept';
  return modeFor(level, { cellTab, moduleTab, layoutTab: tab });
}

export function modeFor(level: Level, s: { cellTab: string; moduleTab: string; layoutTab: string }): DisplayMode {
  switch (level) {
    case 'system': return 'system';
    case 'package': return 'package';
    case 'die': return 'logical-map';
    case 'circuit': return 'rtl-circuit';
    case 'module': return s.moduleTab === 'compute' ? 'compute' : 'module';
    case 'gates': return 'synth-gates';
    case 'layout': return s.layoutTab === 'layout' ? 'layout-v02' : s.layoutTab === 'layout_v03' ? 'layout-v03' : s.layoutTab === 'layout_v04' ? 'layout-v04' : 'layout-concept';
    case 'cell': return s.cellTab === 'tutorial' ? 'transistor-tutorial' : 'cell-pdk';
    default: return 'logical-map';
  }
}

/** Focus mode: collapse both side panels and the lab drawer; restore them on the second press. */
export function toggleFocus() {
  const m = useMicro.getState();
  const s = useScene.getState();
  if (!m.focus.on) {
    m.setFocus(true, { leftOpen: s.panels.leftOpen, rightOpen: s.panels.rightOpen, labSize: s.labSize });
    s.setPanels({ leftOpen: false, rightOpen: false });
    s.setLabSize('collapsed');
  } else {
    const p = m.focus.prev;
    m.setFocus(false, null);
    if (p) {
      s.setPanels({ leftOpen: p.leftOpen, rightOpen: p.rightOpen });
      s.setLabSize(p.labSize as typeof s.labSize);
    }
  }
}

export function ViewModeBanner() {
  const mode = useDisplayMode();
  const info = DISPLAY[mode];
  const help = useMicro((m) => m.helpOpen);
  const setHelp = useMicro((m) => m.setHelpOpen);
  const focus = useMicro((m) => m.focus.on);
  const course = useMicro((m) => m.course.lesson);
  return (
    <div className={`vmb vmb-${mode}`} data-testid="view-mode-banner" data-mode={mode}>
      <span className={`vmb-label ev-${info.evidence}`} title={info.sentence}>{info.label}</span>
      <span className="vmb-sentence">{info.sentence}</span>
      <span className="vmb-sp" />
      <button className={`btn sm${course !== null ? ' on' : ''}`} onClick={() => (course === null ? startCourse(0) : useMicro.getState().setCourse({ lesson: null }))} title="Eight short hands-on lessons: bits and gates, registers, buses, per-channel memory, threshold, filter and energy, output records, the on-chip decoder" data-testid="btn-course">
        {course === null ? <><span className="vmb-long">Explore my chip · 8 lessons</span><span className="vmb-short">8 lessons</span></> : <><span className="vmb-long">Close lessons</span><span className="vmb-short">Close</span></>}
      </button>
      <button className={`btn sm${focus ? ' on' : ''}`} onClick={toggleFocus} title="Hide the side panels and the signal drawer so the circuit gets the screen (press again to restore)" data-testid="btn-focus">
        {focus ? 'Exit focus' : 'Focus'}
      </button>
      <button className={`btn sm primary${help ? ' on' : ''}`} onClick={() => setHelp(!help)} aria-expanded={help} data-testid="btn-what">
        What am I looking at?
      </button>
      {help && <HelpCard mode={mode} onClose={() => setHelp(false)} />}
    </div>
  );
}

function HelpCard({ mode, onClose }: { mode: DisplayMode; onClose: () => void }) {
  const info = DISPLAY[mode];
  const ref = useRef<HTMLDivElement>(null);
  const manifest = useArtifacts((a) => a.manifest);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="vmb-help" ref={ref} role="dialog" aria-label="What am I looking at?" data-testid="help-card">
      <div className="vmb-help-h">
        <b>What am I looking at?</b>
        <EvidenceBadge e={info.evidence} />
        <span className="vmb-sp" />
        <button className="btn sm" onClick={onClose} aria-label="Close">Close</button>
      </div>
      <p className="vmb-help-lead">{info.sentence}</p>
      <div className="vmb-help-grid">
        <div><div className="vmb-k">Real (from sources)</div><p>{info.real}</p></div>
        <div><div className="vmb-k">Drawn for clarity (concept)</div><p>{info.concept}</p></div>
      </div>
      <div className="vmb-k">Legend</div>
      <ul className="vmb-legend">
        {info.legend.map((l) => <li key={l.k}><i className={`vmb-sw ${l.sw}`} /> <b>{l.k}</b> <span>{l.v}</span></li>)}
      </ul>
      <div className="vmb-k">Try</div>
      <ul className="vmb-try">{info.howTo.map((h) => <li key={h}>{h}</li>)}</ul>
      {mode === 'logical-map' && (
        <p className="vmb-start">
          <b>Good first stop:</b> click <code>u_biquad</code>, the digital band-pass filter. It multiplies five numbers by five
          constants and adds them up — the same multiply-and-accumulate idea that AI chips repeat billions of times. Then click
          <code>u_engine</code> on the right: the on-chip decoder repeats that idea 40 times per frame on one shared multiplier.
          A filter and a tiny classifier, not an LLM accelerator.
        </p>
      )}
      <details className="vmb-gloss">
        <summary>Name glossary (u_, cfg_, in_, rec_, stat_ …)</summary>
        <dl>{GLOSSARY.map((g) => <div key={g.term}><dt><code>{g.term}</code></dt><dd>{g.meaning}</dd></div>)}</dl>
      </details>
      {manifest && <div className="vmb-prov">Artifacts generated from RTL commit {manifest.git_rev} at {manifest.generated_at}.</div>}
    </div>
  );
}
