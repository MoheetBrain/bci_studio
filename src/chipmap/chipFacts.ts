// Hand-written framing for the "Our chip" map. Everything about the RTL itself (names, lines, ports, suites) comes
// from chip_hierarchy.json; this file only (a) orders instances into the record paths and (b) lists the hardware that
// is NOT in the repository, each with the project document that says so. tests/chip-facts.test.ts checks both against
// the snapshot: every instance path must exist, and every quoted sentence must be present in the cited document.

export interface DigitalPath {
  id: 'raw' | 'event' | 'feature' | 'decoder' | 'control';
  title: string;
  summary: string;
  /** Instance paths in signal order (all under hbci02_chip_top). */
  instances: string[];
  /** Which executed studio check compares a model of this path with RTL traces (id in studio_checks.json). */
  check: string | null;
}

const T = 'hbci02_chip_top';
const RO = `${T}/u_core/u_readout`;
const AI = `${T}/u_core/u_ai`;

export const DIGITAL_PATHS: DigitalPath[] = [
  {
    id: 'raw', title: 'RAW records', check: 'check:v03',
    summary: 'Every accepted sample is passed through as a record while a capture session is enabled.',
    instances: [`${T}/u_smp`, `${T}/u_core`, RO, `${RO}/u_ts`, `${RO}/u_records`, `${T}/u_rec`],
  },
  {
    id: 'event', title: 'EVENT records', check: 'check:model',
    summary: 'Per channel: track a baseline, compare |sample − baseline| with a threshold, fire once, then wait out a refractory period. Lossy: the waveform is discarded.',
    instances: [`${T}/u_smp`, `${RO}/u_event`, `${RO}/u_event/u_state`, `${RO}/u_event/u_baseline`, `${RO}/u_event/u_threshold`, `${RO}/u_event/u_refractory`, `${RO}/u_event/u_timestamp`, `${RO}/u_event/u_packer`, `${RO}/u_records`, `${T}/u_rec`],
  },
  {
    id: 'feature', title: 'FEATURE records', check: 'check:v03',
    summary: 'Per channel: band-pass filter, then the sum of squares over a window. Lossy: energies do not reconstruct the waveform.',
    instances: [`${T}/u_smp`, `${RO}/u_fstate`, `${RO}/u_biquad`, `${RO}/u_energy`, `${RO}/u_records`, `${T}/u_rec`],
  },
  {
    id: 'decoder', title: 'On-chip decoder', check: 'check:v04',
    summary: 'FEATURE windows from all required channels are quantised, collected into a frame and classified by a small stored model. The output is a class and a margin.',
    instances: [`${RO}/u_energy`, AI, `${AI}/u_quant`, `${AI}/u_quant/u_log`, `${AI}/u_collect`, `${AI}/u_model`, `${AI}/u_engine`],
  },
  {
    id: 'control', title: 'Control, reset and self-test', check: null,
    summary: 'Register bus over SPI, reset synchroniser and a built-in self-test that drives the whole path from an on-chip generator.',
    instances: [`${T}/u_rst`, `${T}/u_spi`, `${T}/u_spi/u_sync`, `${T}/u_smp/u_sync`, `${T}/u_core/u_bist`],
  },
];

export interface ConceptualItem {
  id: string;
  name: string;
  side: 'upstream' | 'downstream';
  status: string;
  /** A sentence copied verbatim from the cited project document. */
  quote: string;
  doc: string;
}

/** Hardware and software that the studio draws for context but that does NOT exist in this repository. */
export const CONCEPTUAL: ConceptualItem[] = [
  { id: 'electrodes', name: 'Electrodes', side: 'upstream', status: 'Not implemented',
    quote: 'Electrodes, low-noise analog front end, ADC, power, telemetry and', doc: 'README.md' },
  { id: 'afe', name: 'Analogue front end', side: 'upstream', status: 'Not implemented — planned as a bought-in part',
    quote: 'no analogue block exists in this repository', doc: 'docs/AFE_ADC_DECISION.md' },
  { id: 'adc', name: 'ADC', side: 'upstream', status: 'Not implemented — inside the planned external part',
    quote: 'Architecture A for the first test chip', doc: 'docs/AFE_ADC_DECISION.md' },
  { id: 'bridge', name: 'Bridge (MCU or FPGA)', side: 'upstream', status: 'Not built — proposed',
    quote: 'which bridge (MCU vs FPGA) and which exact AFE', doc: 'docs/AFE_ADC_DECISION.md' },
  { id: 'stim', name: 'Stimulation (“write” path)', side: 'downstream', status: 'Not implemented',
    quote: 'Stimulation stays external and unimplemented', doc: 'docs/AFE_ADC_DECISION.md' },
  { id: 'silicon', name: 'Fabricated chip and measurements', side: 'downstream', status: 'Does not exist',
    quote: 'has not been fabricated or measured.', doc: 'docs/PHYSICAL.md' },
  { id: 'package', name: 'Padframe, package, implant', side: 'downstream', status: 'Not done, not planned',
    quote: 'Padframe / I/O ring, packaging, foundry sign-off, fabrication | not done, not planned', doc: 'docs/PHYSICAL.md' },
];

/** Milestones are different things; reaching one says nothing about the next. */
export const MILESTONES: Array<{ id: string; label: string; reached: boolean; basis: string }> = [
  { id: 'rtl', label: 'Written as RTL', reached: true, basis: 'chip/rtl at the snapshot commit' },
  { id: 'sim', label: 'Simulated and checked', reached: true, basis: 'executed suites in verification.json' },
  { id: 'synth', label: 'Synthesised to gates', reached: true, basis: 'synthesis artifacts (synth_stats.json, sky130_stats_*.json)' },
  { id: 'layout', label: 'Placed and routed', reached: true, basis: 'layout artifacts from the open-source flow (chip/docs/PHYSICAL.md); not a foundry sign-off' },
  { id: 'fab', label: 'Fabricated', reached: false, basis: 'chip/docs/PHYSICAL.md: “has not been fabricated or measured.”' },
  { id: 'measured', label: 'Measured on silicon', reached: false, basis: 'no hardware exists' },
  { id: 'bio', label: 'Tested with tissue', reached: false, basis: 'out of scope; never connect development hardware to tissue or a person' },
];
