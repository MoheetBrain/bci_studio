// Search synonyms, keyed like the region cards (name without the side). Kept deliberately small and anatomical.
// Where a common term names a FUNCTIONAL or cytoarchitectonic area rather than the gyrus itself, `note` says so and is
// shown next to the search hit — a search for "M1" must not silently equate M1 with the precentral gyrus.
export const SYNONYMS: Record<string, { terms: string[]; note?: string }> = {
  'precentral gyrus': {
    terms: ['primary motor cortex', 'M1', 'motor cortex', 'motor strip', 'Brodmann area 4', 'BA4', 'area 4'],
    note: 'the gyrus that contains M1; not identical to it',
  },
  'postcentral gyrus': {
    terms: ['primary somatosensory cortex', 'S1', 'somatosensory cortex', 'Brodmann areas 3 1 2'],
    note: 'the gyrus that contains S1; not identical to it',
  },
  'central sulcus': { terms: ['Rolandic sulcus', 'fissure of Rolando', 'Rolandic fissure'] },
  'paracentral lobule': { terms: ['leg area', 'medial motor cortex'], note: 'medial continuation of the pre- and postcentral gyri' },
  'opercular part of inferior frontal gyrus': { terms: ['pars opercularis', 'Broca area'], note: 'classically part of Broca’s region on the left; an anatomical label here' },
  'triangular part of inferior frontal gyrus': { terms: ['pars triangularis', 'Broca area'], note: 'classically part of Broca’s region on the left; an anatomical label here' },
  'orbital part of inferior frontal gyrus': { terms: ['pars orbitalis'] },
  'hippocampus': { terms: ['hippocampal formation'] },
  'amygdala': { terms: ['amygdaloid body'] },
  'putamen': { terms: ['striatum', 'basal ganglia'], note: 'one part of the striatum / basal nuclei' },
  'caudate nucleus': { terms: ['striatum', 'basal ganglia'], note: 'one part of the striatum / basal nuclei' },
  'globus pallidus pars externa': { terms: ['pallidum', 'GPe', 'basal ganglia'] },
  'globus pallidus pars interna': { terms: ['pallidum', 'GPi', 'basal ganglia'] },
  'corpus callosum': { terms: ['callosal commissure'] },
  'medulla oblongata': { terms: ['medulla', 'brainstem'] },
  'pons': { terms: ['brainstem'] },
  'white matter of cerebral hemisphere': { terms: ['cerebral white matter'] },
};
