// The stages of the recording journey. This is ONE example architecture — the one this project plans around
// (external analogue front end and ADC feeding the Hamiltonian digital chip, chip/docs/AFE_ADC_DECISION.md) — not a
// universal topology. Text here is pure data (no React), so tests can check every chip instance it names against the
// hierarchy extracted from the RTL.
import type { EvidenceLabel } from '../science/Cite';

/** Where a stage lives in THIS project. */
export type Realisation =
  | 'biology'       // tissue
  | 'external'      // hardware outside this repository (planned as bought-in parts); nothing here implements it
  | 'chip-rtl'      // implemented as RTL in the chip snapshot and exercised by executed tests
  | 'host';         // software outside the chip

export type TraceKey = 'vm' | 've' | 'afe' | 'adc' | 'digital' | 'output';

export interface Stage {
  id: string;
  title: string;
  short: string;
  realisation: Realisation;
  evidence: EvidenceLabel;
  /** Optional stage: present in some systems only. */
  optional?: boolean;
  purpose: string;
  input: string;
  output: string;
  /** What this lesson assumes or simplifies at this stage. */
  assumptions: string[];
  sources: string[];
  /** Instance paths under hbci02_chip_top that implement this stage (verified against chip_hierarchy.json). */
  chipInstances?: string[];
  /** Which waveform panel belongs to this stage. */
  trace: TraceKey | null;
  /** Shown when a stage is easily confused with another. */
  notToBeConfusedWith?: string;
}

const TOP = 'hbci02_chip_top';
const RO = `${TOP}/u_core/u_readout`;

export const STAGES: Stage[] = [
  {
    id: 'source',
    title: 'Neural source',
    short: 'Neurons',
    realisation: 'biology',
    evidence: 'synthetic',
    purpose: 'Active neurons drive currents across their membranes. Those currents flow through the surrounding fluid and set up a small, fast-changing potential outside the cells.',
    input: 'Membrane potential of each neuron (about −65 mV at rest, briefly positive during an action potential): an intracellular quantity that an extracellular electrode never measures directly.',
    output: 'Extracellular potential at a point in the tissue: tens to a few hundred microvolts, the sum of many neurons plus slower field potentials.',
    assumptions: [
      'Three model neurons at set distances from the contact, each firing at random times (seeded), plus a band-limited background standing in for the many neurons too far away to resolve.',
      'Spike size falls as 1 / distance. Real fall-off depends on cell shape and tissue and is generally steeper; this is a teaching rule, not a measurement.',
      'The membrane-potential trace is a drawn template, not a biophysical simulation.',
      'The slow field potential is a single sine wave.',
    ],
    sources: ['buzsaki2012', 'henze2000', 'hodgkin1952'],
    trace: 'vm',
  },
  {
    id: 'electrode',
    title: 'Electrode contact and reference',
    short: 'Electrode',
    realisation: 'external',
    evidence: 'synthetic',
    purpose: 'A metal contact measures the potential at its location relative to a reference electrode. It adds a steady offset (the metal–tissue interface) and thermal noise from its impedance.',
    input: 'Extracellular potential at the contact and at the reference.',
    output: 'A voltage difference: microvolt-scale neural signal riding on a millivolt-scale steady offset, with added thermal noise.',
    assumptions: [
      'One contact does not listen to one neuron: it sums every nearby cell. Published estimates for a tetrode in rat hippocampus are roughly a thousand neurons within range, of which some 60–100 could in theory be told apart.',
      'Thermal noise is √(4·k·T·R·B) for a resistive contact at body temperature over the amplifier’s noise bandwidth; real electrode impedance is frequency-dependent.',
      'The reference is ideal (zero signal). No motion artefacts or mains pickup are modelled.',
      'No electrode exists in this project’s repository: this stage is conceptual hardware.',
    ],
    sources: ['henze2000', 'maynard1997', 'buzsaki2012'],
    trace: 've',
  },
  {
    id: 'routing',
    title: 'Electrode routing',
    short: 'Routing',
    realisation: 'external',
    evidence: 'schematic',
    optional: true,
    purpose: 'When a probe has more contacts than amplifiers, a switch matrix chooses which contacts are connected. It selects sites; it does not change the signal.',
    input: 'Many electrode contacts.',
    output: 'The subset of contacts wired to the available amplifier channels.',
    assumptions: [
      'Shown for orientation only: the lesson follows one already-selected contact, so nothing is computed here.',
      'Example from the literature: a probe whose 384 recording channels can be programmably connected to 960 sites.',
      'Not part of this project’s chip or plans.',
    ],
    sources: ['jun2017'],
    trace: null,
    notToBeConfusedWith: 'Electrode routing picks WHICH contacts are recorded. It is not the analogue channel multiplexer (which time-shares an ADC) and not the chip’s digital record arbitration (which orders finished digital records).',
  },
  {
    id: 'afe',
    title: 'Analogue front end',
    short: 'AFE',
    realisation: 'external',
    evidence: 'synthetic',
    purpose: 'Amplify the microvolt signal to volts and keep only the band of interest: a high-pass removes the electrode offset and slow drift, a low-pass limits bandwidth before sampling.',
    input: 'Electrode voltage: µV signal on a mV offset.',
    output: 'A filtered, amplified voltage that fits the ADC’s input range — or a clipped one, if gain or offset is too large.',
    assumptions: [
      'First-order high-pass, second-order Butterworth low-pass, then gain, then a hard limit at the output swing. Real amplifiers recover from saturation slowly; that is not modelled.',
      'Amplifier noise is a single input-referred RMS figure, white over the pass band (no 1/f noise).',
      'This project plans to use a bought-in AFE/ADC part (project decision record); no analogue circuit exists in the repository.',
    ],
    sources: ['harrison2003', 'harrison2008', 'hbci-afe-adc'],
    trace: 'afe',
  },
  {
    id: 'amux',
    title: 'Analogue channel multiplexing',
    short: 'Analogue MUX',
    realisation: 'external',
    evidence: 'schematic',
    optional: true,
    purpose: 'Many amplifier channels can share one ADC: a multiplexer presents each amplified channel to the ADC in turn. The ADC must then convert (channels × sample rate) times per second.',
    input: 'Several amplified, filtered analogue channels.',
    output: 'One analogue line that carries the channels one after another, in a fixed order.',
    assumptions: [
      'Used in some systems; others give every channel its own ADC. The lesson follows a single channel, so no multiplexing is computed.',
      'Example from the literature: signals are “filtered, amplified, multiplexed and digitized” on the probe base.',
      'Settling time and crosstalk between neighbouring time slots are real design limits and are not modelled.',
    ],
    sources: ['jun2017', 'harrison2008'],
    trace: null,
    notToBeConfusedWith: 'This multiplexer handles ANALOGUE voltages before the ADC. Electrode routing (earlier) chooses contacts; the chip’s record arbitration (later) orders digital records.',
  },
  {
    id: 'adc',
    title: 'Analogue-to-digital converter',
    short: 'ADC',
    realisation: 'external',
    evidence: 'synthetic',
    purpose: 'Sample the voltage at regular instants and round each sample to one of 2^N codes. From here on the signal is a list of integers.',
    input: 'Amplified voltage within ± full scale.',
    output: 'Signed integer codes at the sample rate. Code convention in this lesson: two’s complement, 0 V → code 0, rounding to nearest, clamped at the rails; then left-aligned into the chip’s 16-bit sample.',
    assumptions: [
      'An ideal converter: no aperture jitter, no non-linearity, no missing codes. Quantisation error then has RMS value LSB / √12.',
      'Frequencies above half the sample rate fold back (alias) unless the low-pass has already removed them — try the aliasing preset.',
      'Mapping a narrower code into the chip’s 16-bit sample by left-alignment is this lesson’s choice; the project’s bridge mapping for real parts is described in the decision record.',
      'In this project the ADC is inside the bought-in AFE part; no ADC exists in the repository.',
    ],
    sources: ['shannon1949', 'hbci-afe-adc'],
    trace: 'adc',
  },
  {
    id: 'digital',
    title: 'Digital processing — our chip',
    short: 'Our chip',
    realisation: 'chip-rtl',
    evidence: 'synthetic',
    purpose: 'The Hamiltonian digital design takes 16-bit samples and produces records: the raw samples, threshold events (a baseline is tracked and a crossing of ± threshold fires once, then waits out a refractory period), and band energies (a band-pass filter followed by a windowed sum of squares).',
    input: '16-bit signed samples tagged with a channel number.',
    output: 'RAW, EVENT and FEATURE records, each with a sample-index timestamp and a sequence number.',
    assumptions: [
      'Computed here by the studio’s TypeScript model of the EVENT and FEATURE paths. That model is compared bit-for-bit with RTL simulation on recorded stimulus (npm run check:model, check:v03); for the synthetic input of this lesson it is the model that runs, not the Verilog.',
      'One channel only. Record timing, back-pressure and drops (the record arbiter and its FIFO) are not modelled here; the RTL traces in “Our chip” show them.',
      'The band-pass coefficients were designed for 2,000 samples per second (70–150 Hz). At another sample rate the same coefficients select a proportionally shifted band — shown under “Consequences”.',
      'Sample timestamps count accepted samples. Hardware clock cycles are a different, faster time base and are not shown in this lesson.',
    ],
    sources: ['hbci-rtl'],
    chipInstances: [
      `${TOP}/u_smp`,
      `${RO}/u_ts`,
      `${RO}/u_event`, `${RO}/u_event/u_state`, `${RO}/u_event/u_baseline`, `${RO}/u_event/u_threshold`, `${RO}/u_event/u_refractory`, `${RO}/u_event/u_timestamp`, `${RO}/u_event/u_packer`,
      `${RO}/u_fstate`, `${RO}/u_biquad`, `${RO}/u_energy`,
      `${RO}/u_records`,
    ],
    trace: 'digital',
    notToBeConfusedWith: 'u_records (hbci_record_mux) is DIGITAL RECORD ARBITRATION: it decides which finished record leaves next. It never touches electrodes or analogue channels.',
  },
  {
    id: 'decoder',
    title: 'Decoder and host output',
    short: 'Decoder / host',
    realisation: 'chip-rtl',
    evidence: 'synthetic',
    purpose: 'Records leave the chip on a serial line. An on-chip decoder can also turn frames of band energies into a class and a confidence margin; anything larger (richer decoders, language models) runs outside the chip.',
    input: 'Records from the readout core; for the on-chip decoder, FEATURE windows from all eight channels.',
    output: 'A serial record stream to the host and, when enabled and loaded with a model, prediction records (class, margin).',
    assumptions: [
      'This lesson stops at the record stream and a host-side summary (event times and rate). The on-chip decoder needs eight channels and a trained model, so it is not run on this single synthetic channel; its real RTL traces are in “Our chip”.',
      'A prediction is an estimate of a trained task variable. It is not a thought, a word or an intention read out in general.',
      'Larger external decoders and any AI model beyond the on-chip classifier are concepts in this project, not implemented hardware.',
    ],
    sources: ['hbci-rtl', 'hochberg2006', 'willett2021'],
    chipInstances: [
      `${TOP}/u_rec`,
      `${TOP}/u_core/u_ai`, `${TOP}/u_core/u_ai/u_quant`, `${TOP}/u_core/u_ai/u_collect`, `${TOP}/u_core/u_ai/u_model`, `${TOP}/u_core/u_ai/u_engine`,
    ],
    trace: 'output',
  },
];

export const REALISATION_LABEL: Record<Realisation, { short: string; long: string }> = {
  biology: { short: 'Biology', long: 'Living tissue. Modelled here with a stated, simplified source model.' },
  external: { short: 'External hardware — not in our repository', long: 'Hardware this project does not implement. Shown conceptually; where numbers appear they come from an ideal model.' },
  'chip-rtl': { short: 'Implemented in our RTL', long: 'Exists as Verilog in the chip snapshot and is exercised by executed test suites. RTL is not silicon: nothing here has been fabricated or measured.' },
  host: { short: 'Host software', long: 'Software outside the chip.' },
};
