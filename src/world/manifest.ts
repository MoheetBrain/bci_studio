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
  kind: 'model' | 'asset' | 'data';
  cls: SourceClass;
  revision: string;
  /** Which prototype toys use it (A, B, C) and whether the integrated world does (W). */
  usedBy: Array<'A' | 'B' | 'C' | 'W'>;
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
    id: 'lif', name: 'Current-based leaky integrate-and-fire circuit', kind: 'model', cls: 'published-model', revision: LIF_REVISION, usedBy: ['A', 'B', 'W'],
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
    id: 'workshop', name: 'Time-workshop circuit (five cells)', kind: 'model', cls: 'published-model', revision: `${LIF_REVISION}/workshop-1`, usedBy: ['B', 'W'],
    what: 'Two input cells converge on a target; one of them also drives an inhibitory cell whose connection onto the target can be switched; the target drives a follower.',
    units: 'as the LIF model',
    assumptions: ['Reference numbers: C 0.25 nF, τ 15 ms, rest −70 mV, threshold −54 mV; one input moves the target about 10 mV.', 'Cell positions do not enter the dynamics. They are chosen so that only the target is close to the journey’s probe (the other four are about 240 µm from it).', 'Variants change the target’s leak, the two input weights and the inhibitory weight and delay within stated bounds, and are kept only if the target can still fire with inhibition on.'],
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
    id: 'contact', name: 'Virtual recording contact', kind: 'model', cls: 'synthetic-observation', revision: 'contact-1', usedBy: ['A', 'W'],
    what: 'y(t) = Σ_cells a·Σ_spikes h(t − t_spike) + noise, sampled at 20 kHz, with a = 120 µV × 30 µm ÷ distance from the contact to the cell body.',
    units: 'µV; µm; ms',
    assumptions: [`Distance floor ${OBS.minDistUm} µm (avoids a singularity only).`, `White Gaussian noise, ${OBS.noiseUv} µV rms, a pure function of (seed, contact, sample).`, 'The waveform’s trough is placed on the model’s spike time.', `Events are detected at −${OBS.threshK} × the noise level with a ${OBS.deadMs} ms dead time.`],
    omits: ['Volume conduction, a reference electrode, tissue filtering, dependence on cell shape or orientation, electrode impedance.', 'Detection is an inference: it can miss, merge or invent events and does not identify the cell.'],
    sources: [
      { label: 'Waveform: the studio’s existing teaching template (−dV/dt of one Hodgkin–Huxley action potential)', read: 'src/experiment/model/template.ts' },
      { label: 'Why a forward model needs more: Lindén et al. 2014, LFPy', href: 'https://doi.org/10.3389/fninf.2013.00041', read: 'Cited from the specification’s own reading (§2 opening, §§2.1–2.2). Not re-read for this build.' },
    ],
    verified: ['amplitude follows the 1/distance rule from the contact position', 'noise has zero mean and unit variance and is reproducible sample by sample', 'nothing is recorded before placement; moving the contact affects later samples only', 'in the world: moving one contact changes that contact’s samples to exactly the declared function of its new position, and leaves the other contact’s samples and every spike time unchanged', 'finite at zero distance from a cell body and at the block’s edge', 'in the browser: flying the craft or moving the camera leaves both traces and the model fingerprint unchanged'],
    review: 'code-tested; not expert-reviewed', files: ['src/world/model/observe.ts'],
  },
  {
    id: 'pilot', name: 'Decoder-pilot surrogate', kind: 'model', cls: 'published-model', revision: PILOT_REVISION, usedBy: ['C', 'W'],
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
    id: 'cells', name: 'Cell shapes and backdrop', kind: 'asset', cls: 'illustrative', revision: 'morph-2', usedBy: ['A', 'B', 'C', 'W'],
    what: 'Generated bodies, branching dendrites and thin axons at a consistent scale; dimmer backdrop cells, fine fibres and specks as scenery; a small vessel as a landmark; a haze that is rosy towards the cortical surface and indigo towards the white matter; electrode shanks with exposed tips.',
    units: 'scene µm (a 100 µm bar is drawn)',
    assumptions: ['Body positions of the model’s cells are the model’s own coordinates (the contact model uses them).', 'In Toy C the layout is compressed for drawing; that model uses its own distances.', 'In the integrated world each population unit is drawn at the population model’s own offset from its contact; the array’s 170 µm pitch is a choice of this build, and the two recording contacts are wherever the player put them.', 'The glow in a body, the flash and the soft disc at a spike are an overlay of model state, not the appearance of tissue.'],
    omits: ['Not reconstructions. Not the cells at any atlas location. No model computes anything along a dendrite or axon.'],
    sources: [{ label: 'Generated in src/world/morph.ts; no external mesh or texture', read: 'n/a' }],
    verified: [], review: 'illustration; nothing to verify numerically', files: ['src/world/morph.ts', 'src/world/fieldMaterial.ts', 'src/world/model/layout.ts'],
  },
  {
    id: 'h01-exemplar', name: 'One reconstructed human neuron (H01)', kind: 'data', cls: 'derived-anatomy', revision: 'hbci-morphology/1 · segment 2252715458', usedBy: ['W'],
    what: 'The branch geometry and calibre of one proofread cell of the H01 release (human temporal cortex, serial-section electron microscopy), simplified and drawn as one neuron that can be flown around and pointed at. Structure only.',
    units: 'micrometres, in the cell’s own frame (origin at the cell body); placed rigidly in the block',
    assumptions: ['The file carries its own provenance: dataset, citation, licence (CC BY 4.0), the archive entry and its SHA-256, and what was changed.', 'Compartment names (axon, dendrite, initial segment, cell body) are the release’s automatic labels, carried outwards from the cell body; they were not verified here.', '“Towards the surface” for this cell is the direction from its body to the mean position of its dendrites: a display choice.', 'Twigs thinner than 0.24 µm are drawn at 0.24 µm so that they can be seen; everything else keeps the data’s radius.'],
    omits: ['It is temporal cortex, not the precentral gyrus that the journey enters, and not the atlas volunteer.', 'No electrical model, no synapses and no connection to the five model cells or the 24 units.', 'The sample is a slab about 175 µm thick: branches end where they left it.', 'No membrane texture, spines or organelles: they are not in the skeleton.'],
    sources: [
      { label: 'H01 release data page (formats, licence statement)', href: 'https://h01-release.storage.googleapis.com/data.html', read: 'Read 2026-11-25 for this build: the licence statement, the “104 proofread cells” entry and the archive it links.' },
      { label: 'Shapson-Coe et al. 2024, Science 384, eadk4858', href: 'https://doi.org/10.1126/science.adk4858', read: 'Citation and abstract only. The paper’s methods were not re-read for this build.' },
    ],
    verified: ['the file states its dataset, licence, archive entry and checksum, and that no model is attached', 'every node’s parent comes before it and the tree has one root at the origin', 'in the browser: its body and several of its branches select the same one neuron, and its card shows no trace'],
    review: 'code-tested; not expert-reviewed', files: ['tools/morph/build-h01-exemplar.mjs', 'public/world/h01-exemplar.json', 'src/world/journey/exemplar.ts', 'src/world/morph.ts'],
  },
  {
    id: 'craft', name: 'The player’s craft and the camera', kind: 'asset', cls: 'illustrative', revision: 'craft-1', usedBy: ['W'],
    what: 'A small virtual craft, about 15 µm long, that marks where the player is and which way they are aimed; a camera that follows it, sits in it, or leaves it to look at one thing.',
    units: 'scene µm; µm/s',
    assumptions: ['The craft’s position and aim are navigation state. They are stored apart from the experiment and are not an argument of any model or recording.', 'The camera eases towards where it should be and is pulled in rather than passing through a cell body; geometry right in front of the lens fades (a display cutaway).'],
    omits: ['Not a device that exists, and nothing about tissue mechanics: it passes through what is drawn. It records nothing and stimulates nothing.'],
    sources: [{ label: 'Modelled in src/world/Craft.tsx; no external mesh or texture', read: 'n/a' }],
    verified: [], review: 'illustration; nothing to verify numerically', files: ['src/world/Craft.tsx', 'src/world/controller.ts', 'src/world/flight.ts'],
  },
  {
    id: 'atlas-surface', name: 'Whole-brain surface and region labels', kind: 'data', cls: 'derived-anatomy', revision: 'hbci-specimen/1 · hbci-atlas/1', usedBy: ['W'],
    what: 'One continuous outer surface of one volunteer’s brain, derived from that volunteer’s own T1 MRI in the SPL/NAC atlas, with the atlas’s own label for the region under every surface point.',
    units: 'atlas subject space, RAS millimetres',
    assumptions: ['The surface is the T1 intensity boundary between tissue and fluid inside a mask grown around the labelled brain, smoothed and simplified (see docs/CINEMATIC_REBUILD.md §2).', 'A region is whatever the atlas’s label volume says lies under a surface point.'],
    omits: ['Not a validated pial surface. One person: not an average and not a clinical reference.', 'Labels are drawn from folds. The atlas contains no cytoarchitectonic borders (for example of primary motor cortex) and no cells.'],
    sources: [{ label: 'SPL/NAC Brain Atlas, as recorded in docs/ATLAS_PROVENANCE.md', read: 'The repository’s data files and licence (see that document). No new reading for this build.' }],
    verified: ['every region’s surface patch lies on that region’s own atlas model; left is left; the precentral gyrus is in front of the postcentral (tests/specimen-assets.test.ts)', 'in the browser: the region picked under the pointer is the atlas structure drawn there'],
    review: 'code-tested; not expert-reviewed', files: ['src/atlas/loadAtlas.ts', 'src/world/journey/BrainStage.tsx'],
  },
  {
    id: 'brain-look', name: 'How the whole brain is lit and coloured', kind: 'asset', cls: 'illustrative', revision: 'brain-look-1', usedBy: ['W'],
    what: 'A dusty-mauve tissue colour, a cool key light from the upper left and a warm one from the right, darkened folds with a thin line along each fold’s floor (from the mesh’s own concavity), broad satin highlights, and a warm contour around the region that can be entered.',
    units: 'none (appearance)',
    assumptions: ['The light rig travels with the camera, so every view is lit like the opening shot.', 'The fold line comes from a concavity field computed from the surface mesh; it does not move or reshape the surface.'],
    omits: ['No colour, highlight or shadow is histology, blood supply or activity. No subsurface scattering, no cast shadows between folds.'],
    sources: [{ label: 'Computed in src/world/journey/brainLook.ts; no external texture', read: 'n/a' }],
    verified: [], review: 'illustration; nothing to verify numerically', files: ['src/world/journey/brainLook.ts'],
  },
];

export const manifestFor = (toy: 'A' | 'B' | 'C' | 'W') => MANIFEST.filter((m) => m.usedBy.includes(toy));
