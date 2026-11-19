// Region dossiers: what a region is, what it is known to do, what has actually been recorded or stimulated there in
// people, what signals to expect, and what is not known. Two regions are written up in this build; every other region
// shows only what the atlas itself says, and says so.
//
// Rules (same as atlas/content/regions.ts): every statement names its kind and its sources (ids in
// science/sources.ts, each checked against Crossref and — for these entries — read at abstract level in this build).
// Species, method and sample are stated wherever the cited result depends on them. Nothing here is inferred from the
// region's shape, and no claim is made about what an electrode at the attached point would record in a real brain.
import type { Claim } from '../../atlas/content/regions';
import type { ExperimentKind } from '../implantStore';

export interface Dossier {
  /** Region name with the side removed, as in the atlas ("precentral gyrus"). */
  key: string;
  experiment: ExperimentKind;
  /** The functional name people usually mean, and how it relates to the atlas label. */
  title: string;
  relation: string;
  anatomy: Claim[];
  function: Claim[];
  bci: Claim[];
  signals: Claim[];
  unknowns: Claim[];
  /** Cytoarchitectonic maps to look up on EBRAINS (links only: this studio's atlas is not registered to them). */
  ebrains: { areas: string; note: string };
  /** One sentence on what the simulated experiment does, for the Start button. */
  experimentBlurb: string;
}

export const EBRAINS_VIEWER = 'https://atlases.ebrains.eu/viewer/';

export const DOSSIERS: Dossier[] = [
  {
    key: 'precentral gyrus',
    experiment: 'motor',
    title: 'Primary motor cortex (M1)',
    relation: 'The atlas labels the fold, the precentral gyrus. M1 — cytoarchitectonic area 4 — lies within it, mostly on the wall of the central sulcus behind it, and its borders differ from brain to brain.',
    anatomy: [
      { text: 'The device is attached to a point of the atlas label “precentral gyrus” on one volunteer’s MRI-derived surface. The label is drawn from sulcal landmarks, not from cell architecture.', kind: 'observed', sources: ['spl-atlas', 'desikan2006'] },
      { text: 'Primary motor cortex is area 4, defined by its cell architecture and divisible into an anterior and a posterior part. Standard descriptions place it mostly on the front wall of the central sulcus, with premotor cortex (area 6) on much of the exposed crown of the gyrus.', kind: 'background', sources: ['geyer1996', 'kandel2021'] },
      { text: 'In eleven post-mortem brains the borders of area 4 varied considerably between hemispheres and between brains.', kind: 'background', sources: ['rademacher2001'] },
      { text: 'The hand region can often be recognised on MRI as a knob-shaped bend of the gyrus. This studio does not mark it: no functional mapping exists for this volunteer.', kind: 'background', sources: ['yousry1997'] },
    ],
    function: [
      { text: 'Electrical stimulation here in awake patients evokes movements on the opposite side of the body, in an ordered but overlapping sequence from leg (near the midline) through arm and hand to face.', kind: 'background', sources: ['penfield1937'] },
      { text: 'In monkeys reaching in eight directions, about three quarters of the task-related motor-cortex cells studied fired most for one “preferred” direction and progressively less for directions further from it — for most of those cells a cosine function of direction. Preferred directions differ from cell to cell, so a movement is represented by many broadly tuned cells together, not by cells dedicated to it.', kind: 'background', sources: ['georgopoulos1982'] },
      { text: 'In the same kind of task the speed of the movement is represented in the discharge as well as its direction.', kind: 'background', sources: ['moran1999'] },
      { text: 'The tidy body map is a simplification: precision imaging reports effector regions for foot, hand and mouth alternating with regions linked to whole-body action planning.', kind: 'background', sources: ['gordon2023'] },
    ],
    bci: [
      { text: 'Microelectrode arrays implanted in motor cortex have let people with paralysis move a computer cursor, control robotic and prosthetic arms, and produce text from attempted handwriting; intracortical arrays have also decoded attempted speech.', kind: 'background', sources: ['hochberg2006', 'hochberg2012', 'collinger2013', 'willett2021', 'willett2023'] },
      { text: 'A Kalman filter — a linear model of how firing depends on movement plus a model of how movement evolves — reconstructed hand trajectories from monkey motor-cortex recordings in real time and gives an estimate of its own uncertainty. A variant designed around closed-loop use halved target-acquisition time in monkeys compared with the algorithms it was tested against.', kind: 'background', sources: ['wu2006', 'gilja2012'] },
      { text: 'Counting threshold crossings instead of sorting spikes into single neurons cost only a small amount of decoding performance in recordings from two macaques; thresholds between −3 and −4.5 times the RMS voltage worked best.', kind: 'background', sources: ['christie2015'] },
      { text: 'These systems decode attempted or intended movement in tasks the decoder was trained on. They do not read arbitrary thoughts.', kind: 'background', sources: ['hochberg2006', 'willett2021'] },
    ],
    signals: [
      { text: 'A microelectrode among the cells records the action potentials of nearby neurons as brief extracellular deflections. In simultaneous intracellular and extracellular recordings in rat hippocampus, features of the extracellular spike followed the intracellular action potential (its width, and changes in its amplitude); a tetrode was estimated to pick up signals from about a thousand neurons, of which only 60–100 are large enough to detect — only cells close to the electrode stand out.', kind: 'background', sources: ['henze2000', 'buzsaki2012'] },
      { text: 'A contact on the cortical surface records no single-neuron spikes; during movement it shows a rise of power in the high-gamma band over sensorimotor cortex.', kind: 'background', sources: ['crone1998'] },
      { text: 'In people with tetraplegia, the apparent firing rate of most recorded units and the spike amplitude of many changed significantly within a single session, and such changes biased the decoded cursor.', kind: 'background', sources: ['perge2013'] },
      { text: 'The experiment here is simulated: 24 model neurons with cosine tuning to intended velocity, Poisson spike timing, a Hodgkin–Huxley action potential whose negative time-derivative gives the extracellular spike shape, an amplitude of 120 µV at 30 µm falling as 1 / distance, and added noise. Those rules are this studio’s teaching assumptions, not measurements, and its numbers are not predictions for a human implant.', kind: 'assumption', sources: ['georgopoulos1982', 'hodgkin1952'] },
    ],
    unknowns: [
      { text: 'Whether an electrode at the attached point would sit in area 4, or record movement-tuned neurons at all, cannot be told from this atlas. Recording quality is never inferred from an anatomical label.', kind: 'assumption', sources: [] },
      { text: 'The tuning results above come from monkeys making real arm movements. How closely they describe a given person’s cortex during attempted movement is an empirical question for each participant.', kind: 'assumption', sources: ['georgopoulos1982', 'moran1999'] },
      { text: 'Signals drift within a day and over months; how to keep a decoder working without frequent recalibration is an open engineering problem.', kind: 'background', sources: ['perge2013'] },
      { text: 'Educational material only: not a surgical plan, not a guide to electrode placement, and nothing here controls stimulation.', kind: 'assumption', sources: [] },
    ],
    ebrains: { areas: 'Area 4a and Area 4p (Julich-Brain cytoarchitectonic maps)', note: 'Probability maps in a standard space, built from post-mortem brains. This studio’s single-subject atlas is in scanner space and is not registered to them, so they are linked, not overlaid.' },
    experimentBlurb: 'Record simulated spikes from eight contacts and decode an intended cursor movement from them.',
  },
  {
    key: 'lateral occipital gyrus',
    experiment: 'visual',
    title: 'Lateral occipital cortex (visual association cortex)',
    relation: 'The atlas labels a gyrus on the outer surface of the occipital lobe. The object-selective “lateral occipital complex” and the visual maps LO-1 and LO-2 are defined by function, lie in this neighbourhood, and cannot be located in one person without functional imaging of that person.',
    anatomy: [
      { text: 'The device is attached to a point of the atlas label “lateral occipital gyrus” on one volunteer’s MRI-derived surface: the outer (lateral) face of the occipital lobe, behind the temporal and parietal lobes.', kind: 'observed', sources: ['spl-atlas', 'desikan2006'] },
      { text: 'In ten post-mortem brains two cytoarchitectonic areas were delimited in lateral occipital cortex, hOc4la and hOc4lp, with probability maps describing how much their position and size vary between people. They are proposed as the anatomical correlates of the functional areas LO-1 and LO-2.', kind: 'background', sources: ['malikovic2016', 'amunts2020'] },
      { text: 'Functional MRI finds two maps of the opposite half of the visual field, LO1 and LO2, between dorsal V3 and the motion area V5/MT+, overlapping the posterior part of the object-selective lateral occipital complex. They are two of many visual field maps in human cortex.', kind: 'background', sources: ['larsson2006', 'wandell2007'] },
    ],
    function: [
      { text: 'A region on the lateral-posterior occipital lobe, next to the motion area MT/V5, responds more strongly to pictures of objects than to textures — including textures with the same spatial-frequency content but scrambled phase — and the difference was not explained by eye movements, image size or spatial filtering.', kind: 'background', sources: ['malach1995'] },
      { text: 'A review of later imaging work concludes that the lateral occipital complex plays an important role in human object recognition, and characterises which changes of an object its responses do and do not depend on.', kind: 'background', sources: ['grillspector2001'] },
      { text: 'LO1 and LO2 are thought to integrate shape information from several visual cues in retinotopic coordinates. This is an interpretation of their response properties, not a settled account.', kind: 'hypothesis', sources: ['larsson2006'] },
      { text: 'Seeing is not done here alone: this cortex is one stage among many maps, fed by V1–V3 and feeding ventral temporal and parietal areas.', kind: 'background', sources: ['wandell2007'] },
    ],
    bci: [
      { text: 'From electrode grids on the surface of ventral temporal cortex — a neighbouring part of the visual pathway, not this gyrus — the timing and the type (face or house) of 96 % of rapidly presented pictures were predicted in seven patients, with under 5 % false positives. Broadband power and the evoked potential together did better than either alone.', kind: 'background', sources: ['miller2016'] },
      { text: 'With fMRI — whole-area patterns over thousands of voxels in early visual areas, not an implant — receptive-field models identified which of a large set of new natural images a person was looking at. That is identification from a known set, not a readout of what someone sees.', kind: 'background', sources: ['kay2008'] },
      { text: 'In the “write” direction, electrical stimulation of visual cortex produces spots of light (phosphenes): first shown with electrodes on the occipital pole of a blind patient; later, tracing shapes by stimulating electrodes in sequence let sighted and blind participants recognise letters; and a 96-electrode intracortical array in a blind volunteer evoked percepts that allowed some letters and object boundaries to be identified.', kind: 'background', sources: ['brindley1968', 'beauchamp2020', 'fernandez2021'] },
      { text: 'No cursor-control or movement decoding has been demonstrated from this region, and this studio does not simulate one here. It models recording only and controls no stimulation.', kind: 'assumption', sources: [] },
    ],
    signals: [
      { text: 'Field potentials from the surface or from within cortex sum the activity of very many neurons. Broadband power (including the “high-gamma” range) rises with the local firing rate: shown against single-neuron recordings in patients, and in monkey V1 where it tracked spiking while the narrow gamma rhythm did not.', kind: 'background', sources: ['manning2009', 'ray2011', 'buzsaki2012'] },
      { text: 'For decoding visual stimuli from surface recordings, two features have been used together: the broadband spectral change and the event-related potential.', kind: 'background', sources: ['miller2016'] },
      { text: 'The experiment here is simulated: pictures switch on and off; the model lets broadband power under eight surface contacts rise about a tenth of a second after onset, more for intact objects than for scrambled ones, with trial-to-trial variation and noise. The object-versus-scrambled difference is put in by hand to follow the imaging result above — the simulation illustrates it and is not evidence for it.', kind: 'assumption', sources: ['malach1995', 'manning2009'] },
    ],
    unknowns: [
      { text: 'Whether the attached point lies in LO-1, LO-2, the object-selective complex or none of them cannot be told from this atlas; the areas’ positions vary between people and are defined by function or cell architecture.', kind: 'assumption', sources: ['malikovic2016'] },
      { text: 'What a few local contacts can report is limited to what drives the cortex under them: that something appeared, when, and — in favourable cases — a coarse category. The content of an image is carried by patterns across many areas; a local recording here cannot reconstruct what a person sees.', kind: 'assumption', sources: ['kay2008', 'miller2016'] },
      { text: 'Decoders trained on a fixed set of categories or images do not, by that fact, generalise to arbitrary content.', kind: 'background', sources: ['kay2008'] },
      { text: 'Attention, eye position and task change responses in visual cortex. None of that is modelled here.', kind: 'assumption', sources: [] },
      { text: 'Educational material only: not a surgical plan, not a guide to electrode placement, and nothing here controls stimulation.', kind: 'assumption', sources: [] },
    ],
    ebrains: { areas: 'Areas hOc4la and hOc4lp (Julich-Brain cytoarchitectonic maps)', note: 'Probability maps in a standard space, built from post-mortem brains. This studio’s single-subject atlas is in scanner space and is not registered to them, so they are linked, not overlaid.' },
    experimentBlurb: 'Record simulated field potentials from eight surface contacts and decode when a picture is on the screen.',
  },
];

const BY_KEY = new Map(DOSSIERS.map((d) => [d.key, d]));
export function dossierFor(regionName: string | null | undefined): Dossier | null {
  const key = (regionName ?? '').replace(/\b(left|right)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return BY_KEY.get(key) ?? null;
}

export type BriefSection = 'anatomy' | 'function' | 'bci' | 'signals' | 'unknowns';
export const BRIEF_SECTIONS: Array<{ id: BriefSection; label: string; hint: string }> = [
  { id: 'anatomy', label: 'Anatomy', hint: 'Where it is and what it borders' },
  { id: 'function', label: 'Function', hint: 'What it is known to do' },
  { id: 'bci', label: 'BCI', hint: 'What has actually been recorded or stimulated here in people' },
  { id: 'signals', label: 'Signals', hint: 'What an electrode could plausibly record' },
  { id: 'unknowns', label: 'Unknowns', hint: 'What is not known or not modelled' },
];
