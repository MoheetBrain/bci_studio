# Cinematic rebuild — what was decided and why

Branch `feature/cinematic-rebuild`, cut from `feature/brain-atlas-studio` @ `df9ba12`. Nothing was merged, force-pushed,
published or deployed. This is the one decision record for the rebuild; evidence is indexed in
`docs/evidence/cinematic/README.md`.

## 1 · Why the old brain looked flat

Checked in the code and on screen before changing anything (`docs/evidence/cinematic/baseline/`):

| Cause | Effect |
|---|---|
| The home screen drew 251 **separate closed shells**, one per atlas label, each triangulated from a 1 mm label map | seams and a mosaic wherever two parcels meet; no continuous gyri |
| `MeshStandardMaterial`, roughness 0.82, one beige colour | no highlights, no depth cue from the material |
| One key light fixed to the camera plus a hemisphere light | every fold lit head-on; sulci never fall into shadow |
| No occlusion term | the folds — the defining feature of a brain — had no darkening at all |
| Light paper stage, brain at about half the stage height | no contrast, no presence |

Material and lighting alone could not fix the first row, so geometry was treated as a separate problem.

## 2 · Geometry: one continuous surface, from the same subject

**Decision.** The default specimen is a new surface derived from the atlas subject’s **own T1 MRI**
(`slicer/volumes/imaging/A1_grayT1.nrrd`, 0.75 mm), not from a second dataset.

- Same repository, same commit, same licence as the atlas already in use — no new rights question.
- Image, label volume and models share one scanner space, so **no registration is involved**. Each surface vertex takes
  its region id from the label volume directly beneath it. Tests check that every region’s surface patch lies on that
  region’s own atlas model, that left is left, and that the precentral gyrus is in front of the postcentral
  (`tests/specimen-assets.test.ts`).
- The atlas’s 251 models are kept, unchanged, as the bodies shown **inside** (X-ray, isolate, deep selections).

Alternatives considered and rejected: a different, prettier brain mesh (would need registration to the labels and a new
licence review; a generic mesh would not be this subject); smoothing the parcels together (cannot remove seams between
closed shells); an AI-generated or sculpted brain (not anatomy, and excluded by the brief).

What the surface is **not**: a validated pial surface. It is the T1 intensity boundary between tissue and fluid inside a
mask grown around the labelled brain, smoothed by 0.10 mm on average (0.34 mm at most) and simplified. That sentence is
in the app’s “About this brain” sheet and in `specimen.json`.

Pipeline (`npm run atlas:specimen`, about 30 s, deterministic): soft mask → threshold between fluid and grey matter →
surface nets → largest component → Taubin smoothing → decimation to 460 k triangles → region id per vertex → border
tidy (2.7 % of vertices) → baked ambient occlusion → RAS-aligned 1 mm MRI and region volumes for slicing.

## 3 · Material and lighting: two candidates, compared at the same camera

`?look=legacy`, `?look=pbr` and the default render the same scene from the same camera
(`tests/e2e/capture-looks.mjs` → `docs/evidence/cinematic/compare/01…03`).

| | Candidate A — stock physically-based | Chosen — tissue shader |
|---|---|---|
| What | `MeshPhysicalMaterial` (sheen, clearcoat) + three lights, occlusion as vertex colour | one custom shader: wrapped key light with a warm terminator, cool rim, baked folds tinted crimson rather than black, satin highlights |
| Result | reads as a brain, but matte and even — folds grey out, no rim separation | deeper folds, lavender highlights, magenta shadow side: closer to the reference still |
| Selection | would need a second pass or a material swap | built in: the region keeps its light, the rest recedes, a smooth contour marks the border |
| Cost | several lights, standard shader | one draw call, no shadow maps; 120 fps here |

The rig travels with the camera, so every orbit position is lit like the opening shot. All of this is **rendering**: no
colour, highlight or grain is histology, blood supply or activity, and the stage never animates the tissue.

## 4 · The cut: measured data instead of hollow shells

The old cut exposed empty parcel shells. The Slice view now paints the subject’s T1 image on the cut face, with the
region under the pointer read from the label volume. A new cut always opens facing the viewer. Deep structures get
“Slice the brain through it” as their one invitation.

## 5 · Interface

- **Brain first.** Nothing but the brain, a dock of scenes ordered by physical scale, four view modes and a hint.
- **Hover** names the region (no label cloud). **Click** reframes without losing the surrounding brain, dims the rest,
  and opens one card with **one** invitation. Everything else (record, sources, limits) is one click further.
- **Finder** (⌘K, Ctrl-K or `/`): search by name or synonym, or browse the atlas hierarchy.
- Named views say “From the left / front / above” next to L R A P S I; the gizmo shows the anatomical axes.
- Provenance lives in “About this brain” instead of a permanent legal band.

## 6 · Scenes and time

| Scene | Scale | What moves | Time unit |
|---|---|---|---|
| Brain | 15 cm | camera only | — |
| Neurons | ≈ 1 mm | Hodgkin–Huxley membrane potential, spikes down the axon, contact voltage | model milliseconds, played 50–1000× slower |
| Signal | µV → bits | existing chain model | signal milliseconds |
| Chip | RTL | — | — |
| Decoder | 8 → 2 | one multiply-accumulate per step | engine clock cycles from the RTL trace |
| Research | sources | — | — |

Every animated scene’s state is a pure function of its timeline position (`src/kit/kit.tsx`), so scrubbing back gives
the same numbers. Biological time, sample time, hardware clock cycles and playback speed are named separately wherever
they appear. Each scene has Intuitive / Mathematical / Engineering detail in Neurons and Decoder; Signal and Chip keep
their existing single level (not yet split — see §8).

## 7 · What is measured, computed, drawn

| Shown | Status |
|---|---|
| Brain shape, region ids, MRI slice | measured dataset (one volunteer; scanner space, not MNI) |
| Tissue colour, light, grain | rendering only |
| Cell shapes and positions in Neurons | drawing — the atlas has no cells |
| Membrane potential | computed from the published Hodgkin–Huxley equations (squid axon, 6.3 °C; not human cortex) |
| Contact voltage | stated teaching rule (1 / distance) + fixed-seed noise |
| Decoder inputs, products, totals, answers | RTL simulation trace on recorded human ECoG samples; re-added in the page and checked per frame |
| Decoder accuracy | offline software evaluation, one subject, one session — quoted as such; none claimed for the 32 frames shown |
| The chip | simulated and laid out; **not fabricated** |

## 8 · Not done, or done partly

- Signal and Chip have one detail level; only Neurons and Decoder have three.
- The Neurons contact trace and the Signal scene’s electrode trace come from two separate (stated) models; they are not
  yet one continuous signal.
- No bidirectional/stimulation scene, no population-of-neurons scene, no multi-electrode array.
- The surface has about 0.2 % pinched edges and a few sulcal bridges/tunnels from thresholding; no topology repair.
- No physical low-end device or phone was measured (see `docs/evidence/performance.txt`, Profile B, for what was).
- The three prediction tasks record nothing about learning; no comprehension claim is made.
- Design books named in the brief were **not available** in this workspace, so no passage from them was applied or
  cited. Layout decisions follow the reference still, the brief, and WCAG contrast checks only.
