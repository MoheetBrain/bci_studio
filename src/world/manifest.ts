// What the Neuroverse toys are made of: every model and every drawn asset, with its class, units, assumptions, what it
// leaves out, where it comes from, and what has and has not been checked. docs/NEUROVERSE.md §5 is written from this
// file, and tests/world-manifest.test.ts keeps its revisions in step with the code.
//
// "verified" lists code checks only. A code check shows that the implementation does what this file says; it does not
// show that the model is biologically right. No entry has been reviewed by a neuroscientist.
import { LIF_DT_MS, LIF_INTEGRATOR, LIF_REVISION, LIF_RNG } from './model/lif.ts';
import { OBS } from './model/observe.ts';
import { PILOT_REVISION } from './model/pilot.ts';

export type SourceClass = 'measured-data' | 'derived-anatomy' | 'published-model' | 'synthetic-observation' | 'illustrative' | 'hypothesis';
export interface ManifestEntry {
  id: string;
  name: string;
  kind: 'model' | 'asset';
  cls: SourceClass;
  revision: string;
  usedBy: Array<'A' | 'B' | 'C'>;
  /** What it computes or is, in one or two sentences. */
  what: string;
  units: string;
  assumptions: string[];
  omits: string[];
  sources: Array<{ label: string; href?: string; read: string }>;
  verified: string[];
  review: 'code-tested; not expert-reviewed' | 'illustration; nothing to verify numerically';
  files: string[];
}

export const MANIFEST: ManifestEntry[] = [
  {
    id: 'lif', name: 'Current-based leaky integrate-and-fire circuit', kind: 'model', cls: 'published-model', revision: LIF_REVISION, usedBy: ['A', 'B'],
    what: 'C·dV/dt = −g_L(V − E_L) + I_bias + I_e + I_i; a threshold crossing is a spike event followed by a reset; each connection delivers an exponentially decaying current after a fixed delay.',
    units: 'ms · mV · nF · µS · nA; positions in µm',
    assumptions: [
      `Fixed grid of ${LIF_DT_MS} ms; ${LIF_INTEGRATOR}.`,
      'Reset at the grid point after the crossing; a 2 ms (1.5 ms for the inhibitory cell) absolute refractory period — an added rule, not part of the basic model.',
      'Currents arriving during the refractory period accumulate and act afterwards.',
      'Deliveries due at one grid point are summed before any cell is advanced; delays are at least one step, so results do not depend on list order.',
      `Background input: one kick per step with probability rate·dt, from a counter-based hash (${LIF_RNG}).`,
    ],
    omits: ['Action-potential shape, ion channels, adaptation, dendrites, axonal conduction, plasticity, extracellular fields.', 'Every weight, delay, capacitance and time constant is a chosen parameter, not a measurement.'],
    sources: [{ label: 'Gerstner, Kistler, Naud & Paninski, Neuronal Dynamics (online), §1.3 and §1.4', href: 'https://neuronaldynamics.epfl.ch/online/Ch1.S3.html', read: '§1.3 opening, §1.3.1 (eq. 1.3–1.7), §1.3.3 and the start of §1.3.4 (eq. 1.12–1.18), §1.4 opening (eq. 1.31–1.32) and the start of §1.4.1. Not the whole book.' }],
    verified: ['rest and exponential decay against the closed form (error < 1e-10 mV)', 'constant positive and negative current against the closed form', 'threshold time against τ·ln((V∞ − E_L)/(V∞ − V_th)) within h²/8τ', 'no spike for a sub-threshold asymptote', 'reset, refractory period and firing period', 'a delayed connection against the closed-form post-synaptic potential, both signs', 'independence of cell, connection and command order', 'timestep refinement', 'checkpoint + command-log replay, bit for bit', 'the same state at 30, 60 and 120 frames per second'],
    review: 'code-tested; not expert-reviewed', files: ['src/world/model/lif.ts', 'tests/world-lif.test.ts'],
  },
  {
    id: 'workshop', name: 'Time-workshop circuit (five cells)', kind: 'model', cls: 'published-model', revision: `${LIF_REVISION}/workshop-1`, usedBy: ['B'],
    what: 'Two input cells converge on a target; one of them also drives an inhibitory cell whose connection onto the target can be switched; the target drives a follower.',
    units: 'as the LIF model',
    assumptions: ['Reference numbers: C 0.25 nF, τ 15 ms, rest −70 mV, threshold −54 mV; one input moves the target about 10 mV.', 'Variants change the target’s leak, the two input weights and the inhibitory weight and delay within stated bounds, and are kept only if the target can still fire with inhibition on.'],
    omits: ['It is a diagram of a mechanism (temporal summation, feed-forward inhibition), not a circuit found in any brain region.'],
    sources: [{ label: 'Parameters chosen for this toy', read: 'n/a' }],
    verified: ['one input is not enough; two within the window are', 'the window is symmetric without inhibition and one-sided with it', 'a leakier target has a narrower window', 'six variants keep the task possible'],
    review: 'code-tested; not expert-reviewed', files: ['src/world/model/circuits.ts', 'src/world/model/workshopRun.ts'],
  },
  {
    id: 'field', name: 'Instrument-flight field (ten cells)', kind: 'model', cls: 'published-model', revision: `${LIF_REVISION}/field-1`, usedBy: ['A'],
    what: 'One cell fires regularly on a constant current and drives a seeded tree of six followers; three cells fire irregularly on background input.',
    units: 'as the LIF model',
    assumptions: ['Which cell leads and the wiring are drawn from the seed; the ten positions are fixed.', 'Followers follow one for one (strong connections, delays 1.2–4.2 ms).'],
    omits: ['No inhibition, no recurrence, no claim about any real microcircuit.'],
    sources: [{ label: 'Parameters chosen for this toy', read: 'n/a' }],
    verified: ['the driver is regular; followers fire after it, one for one', 'silencing the driver stops the wave and leaves the independent cells unchanged', 'rewind replays the same spikes; a command during replay starts a child run', 'export → import reproduces the state fingerprint'],
    review: 'code-tested; not expert-reviewed', files: ['src/world/model/circuits.ts', 'src/world/model/fieldRun.ts'],
  },
  {
    id: 'contact', name: 'Virtual recording contact', kind: 'model', cls: 'synthetic-observation', revision: 'contact-1', usedBy: ['A'],
    what: 'y(t) = Σ_cells a·Σ_spikes h(t − t_spike) + noise, sampled at 20 kHz, with a = 120 µV × 30 µm ÷ distance from the contact to the cell body.',
    units: 'µV; µm; ms',
    assumptions: [`Distance floor ${OBS.minDistUm} µm (avoids a singularity only).`, `White Gaussian noise, ${OBS.noiseUv} µV rms, a pure function of (seed, contact, sample).`, 'The waveform’s trough is placed on the model’s spike time.', `Events are detected at −${OBS.threshK} × the noise level with a ${OBS.deadMs} ms dead time.`],
    omits: ['Volume conduction, a reference electrode, tissue filtering, dependence on cell shape or orientation, electrode impedance.', 'Detection is an inference: it can miss, merge or invent events and does not identify the cell.'],
    sources: [
      { label: 'Waveform: the studio’s existing teaching template (−dV/dt of one Hodgkin–Huxley action potential)', read: 'src/experiment/model/template.ts' },
      { label: 'Why a forward model needs more: Lindén et al. 2014, LFPy', href: 'https://doi.org/10.3389/fninf.2013.00041', read: 'Cited from the specification’s own reading (§2 opening, §§2.1–2.2). Not re-read for this build.' },
    ],
    verified: ['amplitude follows the 1/distance rule from the contact position', 'noise has zero mean and unit variance and is reproducible sample by sample', 'nothing is recorded before placement; moving the contact affects later samples only', 'in the browser: camera movement leaves the trace and the model fingerprint unchanged'],
    review: 'code-tested; not expert-reviewed', files: ['src/world/model/observe.ts'],
  },
  {
    id: 'pilot', name: 'Decoder-pilot surrogate', kind: 'model', cls: 'published-model', revision: PILOT_REVISION, usedBy: ['C'],
    what: 'Per 50 ms bin: intended velocity → firing rates of the Experiment scene’s 24 units → Poisson spikes → each spike counted with a probability set by its size, the detector noise and a threshold fixed at calibration → smoothed rates → a fitted decoder → cursor velocity.',
    units: 'velocity in workspace units (1 = full speed); rates in spikes/s; amplitudes and thresholds in µV',
    assumptions: ['Keeps the population model and the decoders of experiment/model unchanged.', 'Detection probability Φ((κ·a − θ)/σ) with κ computed from the chain’s own filters; noise crossings at Rice’s rate.', 'Thresholds are K·σ at calibration and stay there until the next calibration.', 'Spike times, counts and false crossings are pure functions of (seed, unit or contact, bin).'],
    omits: ['Waveform synthesis, the analogue front end, the ADC, the digital band-pass, the common average reference and the sample-by-sample detector are BYPASSED.', 'Overlapping spikes, detector dead time, reference leakage and clipping.', 'The player is the feedback loop: no model of human learning, co-adaptation or fatigue.'],
    sources: [
      { label: 'Cosine direction tuning: Georgopoulos et al. 1982', href: 'https://doi.org/10.1523/JNEUROSCI.02-11-01527.1982', read: 'abstract-reviewed (as recorded in src/science/sources.ts)' },
      { label: 'Speed term: Moran & Schwartz 1999', href: 'https://doi.org/10.1152/jn.1999.82.5.2676', read: 'abstract-reviewed (as recorded in src/science/sources.ts)' },
    ],
    verified: ['detector noise and threshold within 10 % of the full chain’s', 'counts per contact within ±30 % of the full chain’s on the same kind of task (criterion fixed beforehand)', 'linear held-out R² within ±0.12 of the full chain’s (criterion fixed beforehand)', 'the cursor does not move without a fitted decoder and ignores the intent when every contact is lost', 'fitting, held-out and evaluation data come from three seeds', 'a stopped calibration changes nothing', 'export → import reproduces the cursor path'],
    review: 'code-tested; not expert-reviewed', files: ['src/world/model/pilot.ts', 'src/world/pilotHost.ts', 'tests/world-pilot.test.ts'],
  },
  {
    id: 'cells', name: 'Cell shapes and backdrop', kind: 'asset', cls: 'illustrative', revision: 'morph-1', usedBy: ['A', 'B', 'C'],
    what: 'Generated bodies, branching dendrites and thin axons at a consistent scale; a shell of dimmer backdrop cells; a small vessel as a landmark.',
    units: 'scene µm (a 100 µm bar is drawn)',
    assumptions: ['Body positions of the model’s cells are the model’s own coordinates (the contact model uses them).', 'In Toy C the layout is compressed for drawing; that model uses its own distances.'],
    omits: ['Not reconstructions. Not the cells at any atlas location. No model computes anything along a dendrite or axon.'],
    sources: [{ label: 'Generated in src/world/morph.ts; no external mesh or texture', read: 'n/a' }],
    verified: [], review: 'illustration; nothing to verify numerically', files: ['src/world/morph.ts', 'src/world/fieldMaterial.ts'],
  },
];

export const manifestFor = (toy: 'A' | 'B' | 'C') => MANIFEST.filter((m) => m.usedBy.includes(toy));
