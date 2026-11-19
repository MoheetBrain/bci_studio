import type { Evidence } from '../model/types';

export const EVIDENCE_HELP: Record<Evidence, string> = {
  CONCEPT: 'Proposed or illustrative: a design idea or drawn geometry. Not implemented.',
  DEMO: 'Studio-only label: an independent browser simulation. Educational, not the Verilog.',
  SCRIPTED: 'Studio-only label: a pre-written illustration of a future interaction. No neural data or model inference behind it.',
  RTL: 'Simulated Verilog (Icarus Verilog), checked against a cycle-accurate reference. The DSP core and the on-chip decoder are RTL.',
  SYNTH: 'Yosys-synthesised logic: generic gates and a SKY130 HD cell mapping (cell counts and cell area; the layout is a separate result).',
  LAYOUT: 'Genuine place-and-route result (GDSII) from a PDK flow: the v0.2 event core, the v0.3 readout core and, when its artifact is published, the v0.4 chip top. Not fabricated.',
  MEASURED: 'Measured on physical hardware. Nothing in this project qualifies yet.',
};

/** The five labels of the project mandate, in order of reality; DEMO and SCRIPTED are studio-only additions. */
export const MANDATE_EVIDENCE: Evidence[] = ['CONCEPT', 'RTL', 'SYNTH', 'LAYOUT', 'MEASURED'];
export const STUDIO_EVIDENCE: Evidence[] = ['DEMO', 'SCRIPTED'];

export function EvidenceBadge({ e, title }: { e: Evidence; title?: string }) {
  return (
    <span className={`evidence ev-${e}`} title={title ?? EVIDENCE_HELP[e]}>
      <span className="dot" />
      {e}
    </span>
  );
}
