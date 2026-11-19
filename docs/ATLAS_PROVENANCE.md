# Atlas provenance, coverage and verification

Everything in this file can be regenerated or re-checked with the commands at the end.

## Dataset

| | |
|---|---|
| Name | SPL/NAC (SPL-PNL) Brain Atlas |
| Source | https://github.com/mhalle/spl-brain-atlas, branch `master`, commit `bec24db25aad5f7600e2df3becfb1f883e61ff56` (2017-12-12) |
| Citation | Halle M, Talos I-F, Jakab M, Makris N, Meier D, Wald L, Fischl B, Kikinis R. *Multi-modality MRI-based Atlas of the Brain.* Surgical Planning Laboratory, Brigham and Women's Hospital; 2017. |
| Licence | 3D Slicer License (the repository's `LICENSE.md`); full text shipped at `public/atlas/LICENSE-3D-Slicer.txt` |
| Subject | One healthy adult volunteer. **Not** a population average, and not a clinical reference. |
| Files used | `slicer/atlasStructure.json` (hierarchy), `labelinfo/brain-atlas-labels-with-metadata.tsv` (label names, RadLex ids), `slicer/models/*.vtk` (251 of 328 models), `slicer/volumes/labels/hncma-atlas.nrrd` (label volume, used only for checking), `slicer/transforms/LinearTransform_3.tfm` (identity) |
| Files not used | The 77 models outside the `#Brain` node (skin, head and neck muscles); the T1/T2 image volumes |

## Coordinate space

- **Scanner (subject) space, RAS, millimetres**: +x = subject's right, +y = anterior, +z = superior.
- This is **not MNI or Talairach space**. Coordinates mean something only inside this atlas.
- The model-to-label-volume transform in the source is the identity; this is confirmed structure by structure below.
- The subject's head is not aligned to the scanner axes. A least-squares fit to the midpoints of 118 left/right pairs
  gives the mid-sagittal plane `x = 0.58 − 0.0648·y + 0.0803·z` (yaw −3.7°, roll 4.6°, residual 1.1 mm RMS).
  Consequence: a "sagittal" cut at constant R is a scanner-axis plane, not exactly the anatomical midline.

## What the build changes — and what it does not

`tools/atlas/build-atlas.mjs` is deterministic: the same source commit and parameters give byte-identical output, and
the manifest records the sha256 of every input model and output chunk.

| Step | What happens | Recorded as |
|---|---|---|
| Selection | Walk `#Brain`; keep each structure that has a model; keep its source id, label value, RadLex id, colour and group chain. Two structures listed twice in the source are merged (`duplicateSourceIds`, `alsoIn`). | `structures[]`, `groups[]` |
| Decimation | meshoptimizer `simplify`: 25 % of the triangles (8 % for the two cerebral white-matter shells); structures ≤ 400 triangles and all sulcus surfaces are untouched. A level is **rejected** if it moves the bounding box by more than 0.5 mm, then retried at 50 %, 75 %, and finally not decimated. | `model.decimated`, `decimationRatio`, `decimationErrorMm`, `boundsDriftMm` |
| Quantisation | positions → int16 with a 3.05 µm step; normals → int8 | `quantisation` |
| Encoding | meshoptimizer vertex/index codecs, four chunks | `chunks[]` with sha256 |
| **Not done** | No re-centring, rotation, mirroring, smoothing, hole filling or re-labelling. Decoded positions are the source's RAS millimetres. | — |

Result: 1,958,896 → 760,155 triangles; largest decimation error 0.34 mm; largest bounding-box drift 0.41 mm.
The viewer applies one display-only transform, `three.js (x, y, z) = (R, S, −A) / 1000`, on a parent group; it is a
proper rotation (no mirroring) and is never written back.

## Coverage

251 structures in 69 groups (the source's own hierarchy, unchanged):

| Class | Count | Notes |
|---|---|---|
| Cerebral cortex (gyri) | 72 | gyral labels whose numbers match the Desikan–Killiany scheme (e.g. 1024 = left precentral) |
| Major sulci | 21 | surfaces drawn in the sulci; **no voxels in the label volume**, so not cross-checkable |
| Cerebral white matter | 2 | |
| Cerebellum | 64 | lobule-level structures and white matter |
| Brainstem | 15 | |
| Thalamus and hypothalamus | 51 | individual nuclei |
| Basal nuclei | 12 | |
| Hippocampus and amygdala | 4 | |
| Commissures and septum | 3 | corpus callosum, anterior commissure, pellucid septum |
| Ventricles | 7 | |

**Not in this atlas:** any cytoarchitectonic or functional parcellation (no M1 / area 4, no S1, no Broca's area as
such), cranial nerves, vessels, cortical layers, cells. The studio does not draw any of these on the brain.

### The motor region

The release gate is met with the **left and right precentral gyrus** (labels 1024 / 2024), each a separate mesh,
together with the central sulcus, precentral sulcus, postcentral gyrus and paracentral lobule. The gyrus is shown
under its own name and described as *the gyrus that contains M1*: limited behind by the central sulcus, continued
medially by the paracentral lobule, and with premotor cortex on much of its exposed surface. Searching "M1" finds it
with the note "the gyrus that contains M1; not identical to it". A precise M1 would need a cytoarchitectonic source.

## Verification

Automated (`npm test`, files `tests/atlas-*.test.ts`):

1. **Integrity** — chunk sizes and sha256; every structure decodes; indices in range; coordinates finite; normals
   near unit length; recorded bounds, centroids and counts reproduced; source model hashes match the reference clone.
2. **Independent label-volume check** — for the 230 structures that have voxels in `hncma-atlas.nrrd`, the mesh
   bounding box is compared with the voxel bounding box (median difference 0.62 mm, 95th percentile 1.27 mm).
3. **Left/right** — every structure named left lies on the −x side of the fitted mid-sagittal plane and every one
   named right on the +x side; unpaired structures lie within 6 mm of it; every left structure has a right twin of
   the same class, mirrored to within 12 mm.
4. **Landmarks** — on both sides the precentral gyrus is anterior to the central sulcus and the postcentral gyrus
   posterior to it; the paracentral lobule is medial and superior; label values are 1024/1022/1017 and 2024/2022/2017.
5. **Hierarchy** — one root, every parent resolves, no cycles, each structure's path equals its group chain.
6. **Picking** in a real browser — six structures hover as themselves; hidden, faded and see-through surfaces are
   never picked; with a cut plane every pick lies on the kept side (`docs/evidence/e2e-report.txt`).

Manual, by the engineering agent, against the source's own Slicer snapshots (`slicer/snapshots/Major Sulci.png`,
`Motor System.png`, `General View.png`) and the running application (`docs/evidence/screenshots/`):

- Left lateral view: frontal pole anterior, occipital pole posterior, temporal lobe inferior, cerebellum
  postero-inferior, brainstem descending from the midline — consistent with the Slicer snapshots.
- The selected left precentral gyrus is one continuous strip from the dorsal margin down towards the lateral sulcus,
  directly in front of the central-sulcus model, with the postcentral gyrus directly behind.
- The orientation gizmo agrees with the geometry in the standard views (L, R, S, I, A, P buttons).

**This is not an expert anatomical review and not a clinical validation.** No neuroanatomist has checked the labels;
individual cerebellar lobule and thalamic nucleus boundaries were not inspected one by one.

## The specimen surface (added in the cinematic rebuild)

The home screen no longer draws the 251 models directly. It draws **one continuous surface derived from the same
subject’s T1 image**, and uses the models for whatever lies beneath it. This is a further modification of the atlas
data and is marked as such in the app (“About this brain”), in `specimen.json` and here.

| | |
|---|---|
| Source image | `slicer/volumes/imaging/A1_grayT1.nrrd` — float, 288 × 320 × 208 voxels at 0.75 mm, same repository and commit (sha256 in `specimen.json`) |
| Source labels | `slicer/volumes/labels/hncma-atlas.nrrd` (the label volume already used for the cross-check) |
| Registration | none: image, labels and models are in one scanner space; the builder converts between the two voxel grids with their own NRRD headers |
| Surface definition | where blurred T1 × soft mask crosses fluid + 0.55 × (grey − fluid); mask = labelled brain grown by 2 voxels, softened; class means measured from the labels (fluid 219, grey 404, white 516 → level 321) |
| Meshing | naive surface nets → largest of 126 components kept (20,472 stray triangles dropped) → Taubin smoothing × 8 (mean move 0.10 mm, 95th percentile 0.20 mm, maximum 0.34 mm) → meshoptimizer decimation 1,043,224 → 459,996 triangles (error ≤ 0.05 mm) |
| Region per vertex | label volume probed 0.5 – 3.2 mm inward along the normal; first non-white-matter label wins (1,675 vertices fall back to white matter); gaps filled by neighbour majority → 0 unlabelled vertices; 201 structures own part of the surface |
| Border tidy | a vertex takes the region held by more than half of its neighbours, 2 passes: 6,087 vertices (2.67 %) changed. Borders are then drawn as smoothed contours. **A drawn border is accurate to about a millimetre, not to a voxel**; the label volume stays authoritative (the Slice view reads it directly) |
| Shading aids (not data) | normals smoothed over neighbours × 2; ambient occlusion baked with 40 rays to 22 mm; a border band packed into the flag byte |
| Slice volumes | T1 (8-bit, windowed to 1.25 × mean white matter, shown only within 4.5 mm of labelled brain) and region ids resampled to a RAS-aligned 1 mm grid; gzip |
| Size | `specimen.bin` 2.5 MB; slice volumes 1.8 + 0.25 MB (fetched when Slice is first opened) |

**What it is not.** Not a validated pial surface (no cortical-surface reconstruction, no topology correction: about
0.2 % of edges are pinched where folds touch, and thresholding leaves a few bridges and tunnels in deep sulci). Not a
population average. Not in MNI space.

**Verification** (`tests/specimen-assets.test.ts`, runs without the source atlas): recorded hashes and counts; closed
surface with no open edges and 1.0 – 1.6 l enclosed; every region’s surface patch (≥ 200 vertices; 120+ regions) lies
within 4 mm of that region’s own atlas model bounds; hemisphere flags agree with structure names and with the fitted
mid-sagittal plane; precentral gyrus anterior to postcentral on both sides; the region volume agrees with the surface
labels 1.5 mm beneath the surface for > 80 % of probes; structure centroids fall in their own region’s voxels.
`tests/surface-fields.test.ts` checks the meshing and smoothing helpers on spheres with known answers.

The 251 models themselves gained one byte per vertex of baked occlusion (layered, so a structure is only darkened by
tissue at its own depth or deeper); positions, indices, ids and counts are unchanged in meaning, and
`tests/atlas-assets.test.ts` still passes against the regenerated chunks.

## Known problems in the source (reported, not corrected)

- Four structures whose model and label volume disagree by more than 3 mm in bounding box: *white matter of right
  cerebral hemisphere* (21.0 mm), *left fornix of forebrain* (7.4 mm), *right pulvinar* (4.4 mm), *right fornix of
  forebrain* (3.6 mm). They are flagged in the manifest (`labelCheck.flag`) and in each structure's atlas record.
- The source hierarchy lists *left superior temporal sulcus* under the **left frontal lobe** (the right one is under
  the right temporal lobe). Kept exactly as in the source.
- The source's own structure file points its label data source at `skin.nrrd`; the label values match
  `hncma-atlas.nrrd`, which is what the check uses.
- Two structures are listed twice in the hierarchy (*third ventricle*, *left inferior colliculus*).

## Commands

`npm run atlas:specimen` rebuilds the specimen surface and slice volumes (run after `npm run atlas:build`; needs the
T1 volume in the sparse checkout: add `slicer/volumes/imaging/A1_grayT1.nrrd` to the sparse-checkout list).

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/mhalle/spl-brain-atlas.git reference/spl-brain-atlas
git -C reference/spl-brain-atlas sparse-checkout set --no-cone '/*.md' '/labelinfo/' '/slicer/atlasStructure.json' \
  '/slicer/models/' '/slicer/transforms/' '/slicer/snapshots/' '/slicer/volumes/labels/hncma-atlas.nrrd'
npm run atlas:build     # → public/atlas/spl-nac/ (prints the cross-check summary and any source discrepancies)
npm test                # integrity, label-volume, left/right, landmark and hierarchy tests
```
