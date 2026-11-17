// Types of public/atlas/spl-nac/manifest.json (written by tools/atlas/build-atlas.mjs).
export type Hemisphere = 'left' | 'right' | 'midline';
export type Tissue =
  | 'cortex' | 'sulcus' | 'white-matter' | 'cerebellum' | 'brainstem'
  | 'diencephalon' | 'basal-nuclei' | 'medial-temporal' | 'commissure' | 'ventricle';

export interface LabelCheck {
  present: boolean;
  note?: string;
  voxels?: number;
  voxelCentroidMm?: [number, number, number];
  bboxCentreDistanceMm?: number;
  bboxMaxDifferenceMm?: number;
  flag?: 'source-discrepancy';
}

export interface AtlasStructure {
  /** Stable app id = the source "@id" without the leading '#'. */
  id: string;
  sourceId: string;
  name: string;
  /** Label value in the source label volume (hncma-atlas.nrrd). */
  label: number | null;
  labelName: string | null;
  radlex: string | null;
  hemisphere: Hemisphere;
  tissue: Tissue;
  parentId: string;
  alsoIn: string[];
  duplicateSourceIds: string[];
  path: string[];
  sourceColor: string | null;
  model: {
    file: string; sha256: string; bytes: number;
    sourceTriangles: number; triangles: number; vertices: number;
    decimated: boolean; decimationRatio: number; decimationErrorMm: number; boundsDriftMm: number;
  };
  chunk: number;
  vertexOffset: number; vertexBytes: number;
  indexOffset: number; indexBytes: number;
  vertexCount: number; indexCount: number;
  boundsMm: [[number, number, number], [number, number, number]];
  centroidMm: [number, number, number];
  surfaceAreaMm2: number;
  labelCheck: LabelCheck;
  /** Signed distance (mm, along x) from the fitted mid-sagittal plane: negative = subject's left. */
  midlineOffsetMm: number;
}

export interface AtlasGroup {
  id: string;
  sourceId: string;
  name: string;
  parentId: string | null;
  sourceColor: string | null;
}

export interface AtlasManifest {
  format: string;
  dataset: {
    id: string; name: string; repository: string; commit: string; commitDate: string; landingPage: string;
    citation: string; licence: string; licenceUrl: string; subject: string; acknowledgement: string;
  };
  space: {
    name: string; units: string; orientation: string; notStandardised: string;
    labelVolume: { file: string; sizes: number[]; space: string; spaceDirections: number[][]; origin: number[] };
    modelToLabelTransform: string;
    midSagittalPlane: { model: string; a: number; b: number; c: number; pairs: number; rmsMm: number; yawDeg: number; rollDeg: number; note: string };
  };
  transforms: Array<Record<string, unknown>>;
  display: { note: string };
  quantisation: { offsetMm: [number, number, number]; scaleMm: number; vertexStride: number };
  totals: {
    structures: number; groups: number; sourceTriangles: number; triangles: number; labelChecked: number;
    labelBboxToleranceMm: number; labelDiscrepancies: string[]; labelCheckMaxBboxDifferenceMm: number; maxDecimationErrorMm: number;
  };
  chunks: Array<{ name: string; file: string; bytes: number; sha256: string }>;
  groups: AtlasGroup[];
  structures: AtlasStructure[];
}

/** A node of the anatomical tree: either a source group or a structure (leaf). */
export interface TreeNode {
  id: string;
  name: string;
  kind: 'group' | 'structure';
  parentId: string | null;
  children: string[];
}
