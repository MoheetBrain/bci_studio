// Curated, source-backed explanations for atlas regions. Deliberately small: a region without an entry shows an
// explicit "no curated explanation yet" state instead of generated or guessed text.
//
// Every statement carries (a) what kind of statement it is and (b) the sources it rests on (ids in science/sources.ts).
//   observed    — read directly from data we hold (here: the atlas files)
//   background  — established finding reported in the cited literature
//   assumption  — a modelling or labelling decision made by this studio
//   hypothesis  — proposed, not established
export type ClaimKind = 'observed' | 'background' | 'assumption' | 'hypothesis';

export interface Claim { text: string; kind: ClaimKind; sources: string[] }

export interface RegionCard {
  /** Name with the side removed ("precentral gyrus"), or a group name ("cerebellum"). */
  key: string;
  summary: string;
  summarySources: string[];
  /** Shown as a banner when the anatomical label must not be confused with a functional area. */
  caution?: { title: string; body: string; sources: string[] };
  location: Claim[];
  functions: Claim[];
  bci: Claim[];
  limits: Claim[];
  /** Offered as the next step of the journey (brain → electrode → signal → chip). */
  journey?: boolean;
}

const ATLAS_LIMIT: Claim = {
  text: 'One volunteer’s anatomy. Folding patterns and the exact position of areas differ between people, so nothing here transfers to another brain without registration and individual imaging.',
  kind: 'observed', sources: ['spl-atlas'],
};
const NO_FUNCTION_MAP: Claim = {
  text: 'This atlas holds shapes and names only. It contains no functional map, so the studio never infers what a patch of cortex does from its geometry.',
  kind: 'observed', sources: ['spl-atlas'],
};

export const REGION_CARDS: RegionCard[] = [
  {
    key: 'precentral gyrus',
    summary: 'The fold of frontal cortex directly in front of the central sulcus. It contains most of the primary motor cortex (M1) — but the gyrus and M1 are not the same thing.',
    summarySources: ['penfield1937', 'geyer1996'],
    caution: {
      title: 'Gyrus ≠ primary motor cortex',
      body: 'M1 (Brodmann area 4) is defined by its cell architecture, not by the fold. In humans it lies mostly on the anterior wall of the central sulcus and reaches the exposed crown mainly near the midline; much of the visible, more anterior surface of this gyrus is premotor cortex (area 6). This studio therefore labels the mesh “precentral gyrus” and treats it as a bounded approximation: the gyrus that contains M1, limited behind by the central sulcus and continued medially by the paracentral lobule.',
      sources: ['geyer1996', 'rademacher2001'],
    },
    location: [
      { text: 'In this atlas it is a gyral label (value 1024 on the left, 2024 on the right) drawn on one volunteer’s MRI. The central sulcus behind it, the precentral sulcus in front of it and the paracentral lobule are separate selectable structures.', kind: 'observed', sources: ['spl-atlas'] },
      { text: 'The cortical label numbers match the Desikan–Killiany gyral scheme, which delimits the precentral gyrus by sulcal landmarks rather than by cell architecture.', kind: 'observed', sources: ['spl-atlas', 'desikan2006'] },
    ],
    functions: [
      { text: 'Electrical stimulation here in awake patients evokes movements on the opposite side of the body, in an ordered but overlapping sequence from leg (near the midline) through arm and hand to face (laterally).', kind: 'background', sources: ['penfield1937'] },
      { text: 'The hand region can often be recognised on MRI as a knob-shaped bend of the gyrus (the “hand knob”).', kind: 'background', sources: ['yousry1997'] },
      { text: 'The tidy “homunculus” is a simplification: precision imaging reports effector regions for foot, hand and mouth alternating with regions linked to whole-body action planning.', kind: 'background', sources: ['gordon2023'] },
    ],
    bci: [
      { text: 'Microelectrode arrays implanted in the hand and arm area of the precentral gyrus have let people with paralysis move cursors and robotic arms and produce text from attempted handwriting; arrays in its ventral part have decoded attempted speech.', kind: 'background', sources: ['hochberg2006', 'hochberg2012', 'collinger2013', 'willett2021', 'willett2023'] },
      { text: 'Those systems record extracellular spiking from many electrodes and map it to intended movement with a decoder trained for that person and task. They decode attempted movement; they do not read arbitrary thoughts.', kind: 'background', sources: ['hochberg2006', 'willett2021'] },
    ],
    limits: [
      ATLAS_LIMIT,
      { text: 'The border of area 4 varies between individuals and between hemispheres and cannot be read off the folds.', kind: 'background', sources: ['rademacher2001'] },
      NO_FUNCTION_MAP,
      { text: 'Educational material only: not a surgical plan and not a guide to electrode placement.', kind: 'assumption', sources: [] },
    ],
    journey: true,
  },
  {
    key: 'central sulcus',
    summary: 'The deep groove separating the frontal lobe (in front) from the parietal lobe (behind). Primary motor cortex lies on its front wall, primary somatosensory cortex on its back wall.',
    summarySources: ['geyer1996', 'geyer1999'],
    location: [
      { text: 'In this atlas the sulcus is a surface drawn inside the fold. It exists only as a model: its label value has no voxels in the atlas label volume, so it could not be cross-checked against the volume.', kind: 'observed', sources: ['spl-atlas'] },
    ],
    functions: [
      { text: 'Area 4 (primary motor) occupies the anterior wall; areas 3a and 3b (primary somatosensory) lie in the fundus and on the posterior wall.', kind: 'background', sources: ['geyer1996', 'geyer1999'] },
    ],
    bci: [
      { text: 'Much of M1 is buried in this sulcus, which is one reason arrays placed on the exposed gyral crown sample only part of the motor map.', kind: 'background', sources: ['geyer1996', 'rademacher2001'] },
    ],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'postcentral gyrus',
    summary: 'The fold directly behind the central sulcus. It contains the primary somatosensory cortex, which receives touch and body-position signals.',
    summarySources: ['penfield1937', 'geyer1999'],
    location: [
      { text: 'A gyral label (1022 left, 2022 right) in this atlas; the central sulcus in front of it is a separate structure.', kind: 'observed', sources: ['spl-atlas'] },
    ],
    functions: [
      { text: 'Stimulation here evokes sensations referred to the opposite side of the body, in a medial-to-lateral order resembling the motor map.', kind: 'background', sources: ['penfield1937'] },
      { text: 'Its anterior part comprises cytoarchitectonic areas 3a, 3b and 1.', kind: 'background', sources: ['geyer1999'] },
    ],
    bci: [
      { text: 'In a research participant, microstimulation through electrodes in the hand area of somatosensory cortex evoked tactile sensations felt in the hand — the “write” direction of a bidirectional interface, demonstrated for touch only.', kind: 'background', sources: ['flesher2016'] },
      { text: 'This studio models recording only. It does not control stimulation and makes no claim about writing percepts beyond the cited result.', kind: 'assumption', sources: [] },
    ],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'paracentral lobule',
    summary: 'The continuation of the precentral and postcentral gyri onto the inner (medial) surface of the hemisphere; the leg and foot parts of the motor and sensory maps lie here.',
    summarySources: ['penfield1937'],
    location: [
      { text: 'A gyral label (1017 left, 2017 right) on the medial surface in this atlas.', kind: 'observed', sources: ['spl-atlas'] },
    ],
    functions: [
      { text: 'Stimulation near the midline evokes leg and foot movements and sensations.', kind: 'background', sources: ['penfield1937'] },
    ],
    bci: [],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'hippocampus',
    summary: 'A curved structure in the medial temporal lobe that is necessary for forming new long-term memories of events and facts.',
    summarySources: ['scoville1957'],
    location: [{ text: 'A subcortical label (17 left, 53 right) in this atlas, grouped under the limbic lobe.', kind: 'observed', sources: ['spl-atlas'] }],
    functions: [{ text: 'Bilateral removal of the medial temporal lobes including the hippocampus produced a severe, lasting inability to form new memories while older memories and intellect were largely spared.', kind: 'background', sources: ['scoville1957'] }],
    bci: [{ text: 'Not a target of the motor interfaces described in this studio. “Writing memories” is not an established capability and is not represented here.', kind: 'assumption', sources: [] }],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'amygdala',
    summary: 'An almond-shaped group of nuclei in the medial temporal lobe involved in learning and expressing emotional responses, studied most thoroughly for fear.',
    summarySources: ['ledoux2000'],
    location: [{ text: 'A subcortical label (18 left, 54 right) in this atlas.', kind: 'observed', sources: ['spl-atlas'] }],
    functions: [{ text: 'It links sensory inputs to defensive responses in fear conditioning; this is a circuit-level role, not a one-region “emotion centre”.', kind: 'background', sources: ['ledoux2000'] }],
    bci: [],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'corpus callosum',
    summary: 'The largest bundle of nerve fibres connecting the two cerebral hemispheres.',
    summarySources: ['gazzaniga2000'],
    location: [{ text: 'A single midline structure (label 3004) in this atlas.', kind: 'observed', sources: ['spl-atlas'] }],
    functions: [{ text: 'It carries information between the hemispheres; after surgical section each hemisphere can process information the other cannot access.', kind: 'background', sources: ['gazzaniga2000'] }],
    bci: [],
    limits: [ATLAS_LIMIT],
  },
  {
    key: 'putamen',
    summary: 'Part of the basal nuclei, which form loops with the cortex through the thalamus and take part in selecting and scaling movement.',
    summarySources: ['alexander1986'],
    location: [{ text: 'A subcortical label (12 left, 51 right) in this atlas, grouped with the globus pallidus as the lentiform nucleus.', kind: 'observed', sources: ['spl-atlas'] }],
    functions: [{ text: 'The motor circuit runs from motor cortical areas through the putamen and pallidum to the thalamus and back to cortex, one of several parallel cortex–basal-ganglia loops.', kind: 'background', sources: ['alexander1986'] }],
    bci: [],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'cerebellum',
    summary: 'The “little brain” behind the brainstem, important for coordinating movement and for motor learning.',
    summarySources: ['kandel2021'],
    location: [{ text: 'In this atlas the cerebellum is divided into many lobule-level structures per hemisphere, plus its white matter.', kind: 'observed', sources: ['spl-atlas'] }],
    functions: [{ text: 'General textbook background: it compares intended and actual movement and adjusts motor commands. No lobule-specific claims are made here.', kind: 'background', sources: ['kandel2021'] }],
    bci: [],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
  {
    key: 'thalamus',
    summary: 'A paired group of nuclei at the centre of the brain through which most sensory and motor-loop signals pass on their way to the cortex.',
    summarySources: ['kandel2021', 'alexander1986'],
    location: [{ text: 'This atlas divides each thalamus into named nuclei (for example the ventral lateral and ventral posterolateral nuclei).', kind: 'observed', sources: ['spl-atlas'] }],
    functions: [{ text: 'Basal-ganglia output reaches motor cortical areas through thalamic nuclei, closing the cortex–basal-ganglia–thalamus loops.', kind: 'background', sources: ['alexander1986'] }],
    bci: [],
    limits: [ATLAS_LIMIT, NO_FUNCTION_MAP],
  },
];

/** "left precentral gyrus" → "precentral gyrus"; "white matter of right cerebral hemisphere" → "white matter of cerebral hemisphere". */
export function cardKey(name: string): string {
  return name.replace(/\b(left|right)\b/g, '').replace(/\s+/g, ' ').trim();
}

const BY_KEY = new Map(REGION_CARDS.map((c) => [c.key, c]));

/**
 * The card for a node, or for its nearest ancestor that has one (then `inherited` names that ancestor).
 * `chain` is the node's own name followed by its ancestors' names, nearest first.
 */
export function cardFor(chain: string[]): { card: RegionCard; inherited: string | null } | null {
  for (let i = 0; i < chain.length; i++) {
    const card = BY_KEY.get(cardKey(chain[i]));
    if (card) return { card, inherited: i === 0 ? null : chain[i] };
  }
  return null;
}

export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  observed: 'Observed in data',
  background: 'Published finding',
  assumption: 'Studio assumption',
  hypothesis: 'Hypothesis',
};
