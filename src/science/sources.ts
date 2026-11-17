// Bibliography used by learning cards. Every entry with a DOI is checked against Crossref by
// `npm run check:sources` (title + year); the result is recorded in docs/evidence/sources-check.txt.
// No page numbers are given anywhere unless the source text was actually retrieved and read (see docs/SOURCE_AUDIT.md).

export type SourceKind = 'journal-article' | 'dataset' | 'book' | 'repository' | 'project-document';

export interface Source {
  id: string;
  kind: SourceKind;
  authors: string;
  year: number;
  title: string;
  venue: string;
  doi?: string;
  url?: string;
  /** How far this source was actually read for this studio. Never overstated. */
  reading: 'metadata-verified' | 'abstract-excerpt-reviewed' | 'abstract-reviewed' | 'section-reviewed' | 'fully-reviewed' | 'not-retrieved';
  note?: string;
  /** Title exactly as registered at Crossref when the registry record itself contains an error (kept so the automated check stays strict). */
  registryTitle?: string;
}

const S = (s: Source): Source => s;

export const SOURCES: Record<string, Source> = Object.fromEntries([
  // ── the atlas itself ──
  S({ id: 'spl-atlas', kind: 'dataset', authors: 'Halle M, Talos I-F, Jakab M, Makris N, Meier D, Wald L, Fischl B, Kikinis R', year: 2017,
    title: 'Multi-modality MRI-based Atlas of the Brain (SPL/NAC brain atlas)', venue: 'Surgical Planning Laboratory, Brigham and Women’s Hospital',
    url: 'https://github.com/mhalle/spl-brain-atlas', reading: 'fully-reviewed',
    note: 'Dataset used directly: hierarchy, label table, label volume header and all models under #Brain were processed and cross-checked (docs/ATLAS_PROVENANCE.md).' }),
  S({ id: 'desikan2006', kind: 'journal-article', authors: 'Desikan RS, Ségonne F, Fischl B, et al.', year: 2006,
    title: 'An automated labeling system for subdividing the human cerebral cortex on MRI scans into gyral based regions of interest',
    venue: 'NeuroImage 31(3):968–980', doi: '10.1016/j.neuroimage.2006.01.021', reading: 'abstract-excerpt-reviewed' }),

  // ── motor cortex anatomy and function ──
  S({ id: 'penfield1937', kind: 'journal-article', authors: 'Penfield W, Boldrey E', year: 1937,
    title: 'Somatic motor and sensory representation in the cerebral cortex of man as studied by electrical stimulation',
    venue: 'Brain 60(4):389–443', doi: '10.1093/brain/60.4.389', reading: 'metadata-verified' }),
  S({ id: 'geyer1996', kind: 'journal-article', authors: 'Geyer S, Ledberg A, Schleicher A, et al.', year: 1996,
    title: 'Two different areas within the primary motor cortex of man', venue: 'Nature 382:805–807', doi: '10.1038/382805a0', reading: 'abstract-reviewed' }),
  S({ id: 'rademacher2001', kind: 'journal-article', authors: 'Rademacher J, Bürgel U, Geyer S, et al.', year: 2001,
    title: 'Variability and asymmetry in the human precentral motor system: a cytoarchitectonic and myeloarchitectonic brain mapping study',
    venue: 'Brain 124(11):2232–2258', doi: '10.1093/brain/124.11.2232', reading: 'abstract-reviewed' }),
  S({ id: 'yousry1997', kind: 'journal-article', authors: 'Yousry TA, Schmid UD, Alkadhi H, et al.', year: 1997,
    title: 'Localization of the motor hand area to a knob on the precentral gyrus. A new landmark', venue: 'Brain 120(1):141–157', doi: '10.1093/brain/120.1.141', reading: 'abstract-reviewed' }),
  S({ id: 'gordon2023', kind: 'journal-article', authors: 'Gordon EM, Chauvin RJ, Van AN, et al.', year: 2023,
    title: 'A somato-cognitive action network alternates with effector regions in motor cortex', venue: 'Nature 617:351–359', doi: '10.1038/s41586-023-05964-2', reading: 'abstract-reviewed' }),
  S({ id: 'geyer1999', kind: 'journal-article', authors: 'Geyer S, Schleicher A, Zilles K', year: 1999,
    title: 'Areas 3a, 3b, and 1 of human primary somatosensory cortex: 1. Microstructural organization and interindividual variability',
    venue: 'NeuroImage 10(1):63–83', doi: '10.1006/nimg.1999.0440', reading: 'abstract-excerpt-reviewed' }),

  // ── intracortical BCI in people ──
  S({ id: 'hochberg2006', kind: 'journal-article', authors: 'Hochberg LR, Serruya MD, Friehs GM, et al.', year: 2006,
    title: 'Neuronal ensemble control of prosthetic devices by a human with tetraplegia', venue: 'Nature 442:164–171', doi: '10.1038/nature04970', reading: 'abstract-reviewed' }),
  S({ id: 'hochberg2012', kind: 'journal-article', authors: 'Hochberg LR, Bacher D, Jarosiewicz B, et al.', year: 2012,
    title: 'Reach and grasp by people with tetraplegia using a neurally controlled robotic arm', venue: 'Nature 485:372–375', doi: '10.1038/nature11076', reading: 'abstract-excerpt-reviewed' }),
  S({ id: 'collinger2013', kind: 'journal-article', authors: 'Collinger JL, Wodlinger B, Downey JE, et al.', year: 2013,
    title: 'High-performance neuroprosthetic control by an individual with tetraplegia', venue: 'The Lancet 381(9866):557–564', doi: '10.1016/S0140-6736(12)61816-9', reading: 'abstract-excerpt-reviewed' }),
  S({ id: 'willett2021', kind: 'journal-article', authors: 'Willett FR, Avansino DT, Hochberg LR, Henderson JM, Shenoy KV', year: 2021,
    title: 'High-performance brain-to-text communication via handwriting', venue: 'Nature 593:249–254', doi: '10.1038/s41586-021-03506-2', reading: 'abstract-reviewed' }),
  S({ id: 'willett2023', kind: 'journal-article', authors: 'Willett FR, Kunz EM, Fan C, et al.', year: 2023,
    title: 'A high-performance speech neuroprosthesis', venue: 'Nature 620:1031–1036', doi: '10.1038/s41586-023-06377-x', reading: 'abstract-reviewed' }),
  S({ id: 'flesher2016', kind: 'journal-article', authors: 'Flesher SN, Collinger JL, Foldes ST, et al.', year: 2016,
    title: 'Intracortical microstimulation of human somatosensory cortex', venue: 'Science Translational Medicine 8(361):361ra141', doi: '10.1126/scitranslmed.aaf8083', reading: 'abstract-reviewed' }),

  // ── extracellular recording and acquisition electronics ──
  S({ id: 'hodgkin1952', kind: 'journal-article', authors: 'Hodgkin AL, Huxley AF', year: 1952,
    title: 'A quantitative description of membrane current and its application to conduction and excitation in nerve',
    venue: 'The Journal of Physiology 117(4):500–544', doi: '10.1113/jphysiol.1952.sp004764', reading: 'metadata-verified' }),
  S({ id: 'buzsaki2012', kind: 'journal-article', authors: 'Buzsáki G, Anastassiou CA, Koch C', year: 2012,
    title: 'The origin of extracellular fields and currents — EEG, ECoG, LFP and spikes', venue: 'Nature Reviews Neuroscience 13:407–420', doi: '10.1038/nrn3241', reading: 'abstract-reviewed' }),
  S({ id: 'henze2000', kind: 'journal-article', authors: 'Henze DA, Borhegyi Z, Csicsvari J, Mamiya A, Harris KD, Buzsáki G', year: 2000,
    title: 'Intracellular features predicted by extracellular recordings in the hippocampus in vivo', venue: 'Journal of Neurophysiology 84(1):390–400', doi: '10.1152/jn.2000.84.1.390', reading: 'abstract-reviewed' }),
  S({ id: 'maynard1997', kind: 'journal-article', authors: 'Maynard EM, Nordhausen CT, Normann RA', year: 1997,
    title: 'The Utah Intracortical Electrode Array: a recording structure for potential brain-computer interfaces',
    venue: 'Electroencephalography and Clinical Neurophysiology 102(3):228–239', doi: '10.1016/S0013-4694(96)95176-0', reading: 'abstract-reviewed' }),
  S({ id: 'jun2017', kind: 'journal-article', authors: 'Jun JJ, Steinmetz NA, Siegle JH, et al.', year: 2017,
    title: 'Fully integrated silicon probes for high-density recording of neural activity', venue: 'Nature 551:232–236', doi: '10.1038/nature24636', reading: 'abstract-reviewed' }),
  S({ id: 'harrison2003', kind: 'journal-article', authors: 'Harrison RR, Charles C', year: 2003,
    title: 'A low-power low-noise CMOS amplifier for neural recording applications', venue: 'IEEE Journal of Solid-State Circuits 38(6):958–965', doi: '10.1109/JSSC.2003.811979', reading: 'metadata-verified',
    registryTitle: 'A low-power low-noise cmos for amplifier neural recording applications',
    note: 'Crossref registers this title with two words transposed ("cmos for amplifier"); the published title is the one shown here.' }),
  S({ id: 'harrison2008', kind: 'journal-article', authors: 'Harrison RR', year: 2008,
    title: 'The design of integrated circuits to observe brain activity', venue: 'Proceedings of the IEEE 96(7):1203–1216', doi: '10.1109/JPROC.2008.922581', reading: 'metadata-verified' }),
  S({ id: 'shannon1949', kind: 'journal-article', authors: 'Shannon CE', year: 1949,
    title: 'Communication in the presence of noise', venue: 'Proceedings of the IRE 37(1):10–21', doi: '10.1109/JRPROC.1949.232969', reading: 'metadata-verified' }),
  S({ id: 'quiroga2004', kind: 'journal-article', authors: 'Quiroga RQ, Nadasdy Z, Ben-Shaul Y', year: 2004,
    title: 'Unsupervised spike detection and sorting with wavelets and superparamagnetic clustering', venue: 'Neural Computation 16(8):1661–1687', doi: '10.1162/089976604774201631', reading: 'abstract-reviewed' }),
  S({ id: 'crone1998', kind: 'journal-article', authors: 'Crone NE, Miglioretti DL, Gordon B, Lesser RP', year: 1998,
    title: 'Functional mapping of human sensorimotor cortex with electrocorticographic spectral analysis. II. Event-related synchronization in the gamma band',
    venue: 'Brain 121(12):2301–2315', doi: '10.1093/brain/121.12.2301', reading: 'abstract-excerpt-reviewed' }),

  // ── other regions ──
  S({ id: 'scoville1957', kind: 'journal-article', authors: 'Scoville WB, Milner B', year: 1957,
    title: 'Loss of recent memory after bilateral hippocampal lesions', venue: 'Journal of Neurology, Neurosurgery & Psychiatry 20(1):11–21', doi: '10.1136/jnnp.20.1.11', reading: 'metadata-verified' }),
  S({ id: 'alexander1986', kind: 'journal-article', authors: 'Alexander GE, DeLong MR, Strick PL', year: 1986,
    title: 'Parallel organization of functionally segregated circuits linking basal ganglia and cortex', venue: 'Annual Review of Neuroscience 9:357–381', doi: '10.1146/annurev.ne.09.030186.002041', reading: 'metadata-verified' }),
  S({ id: 'gazzaniga2000', kind: 'journal-article', authors: 'Gazzaniga MS', year: 2000,
    title: 'Cerebral specialization and interhemispheric communication: does the corpus callosum enable the human condition?',
    venue: 'Brain 123(7):1293–1326', doi: '10.1093/brain/123.7.1293', reading: 'abstract-excerpt-reviewed' }),
  S({ id: 'ledoux2000', kind: 'journal-article', authors: 'LeDoux JE', year: 2000,
    title: 'Emotion circuits in the brain', venue: 'Annual Review of Neuroscience 23:155–184', doi: '10.1146/annurev.neuro.23.1.155', reading: 'abstract-excerpt-reviewed' }),
  S({ id: 'kandel2021', kind: 'book', authors: 'Kandel ER, Koester JD, Mack SH, Siegelbaum SA (eds)', year: 2021,
    title: 'Principles of Neural Science, 6th edition', venue: 'McGraw Hill', reading: 'not-retrieved',
    note: 'Standard textbook cited as general background only. Not in the local corpus, so no chapter or page is given.' }),

  // ── this project ──
  S({ id: 'hbci-rtl', kind: 'repository', authors: 'Hamiltonian Interface', year: 2026,
    title: 'Hamiltonian-BCI-Chip: RTL, testbenches and documents (snapshot in chip/)', venue: 'Project repository, commit 207285f',
    url: 'https://github.com/MoheetBrain/Hamiltonian-BCI-Chip', reading: 'section-reviewed',
    note: 'Instance names, module ports and test results quoted in the studio are extracted mechanically from the snapshot.' }),
  S({ id: 'hbci-afe-adc', kind: 'project-document', authors: 'Hamiltonian Interface', year: 2026,
    title: 'AFE / ADC decision (docs/AFE_ADC_DECISION.md)', venue: 'Project document, chip repository commit 207285f', reading: 'fully-reviewed' }),
].map((s) => [s.id, s]));

export function cite(id: string): Source {
  const s = SOURCES[id];
  if (!s) throw new Error(`unknown source id "${id}"`);
  return s;
}

export function sourceHref(s: Source): string | null {
  return s.doi ? `https://doi.org/${s.doi}` : s.url ?? null;
}
