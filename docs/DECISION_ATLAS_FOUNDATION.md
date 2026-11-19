# Decision note: foundation for the brain atlas

Date: 2026-11-17. Status: decided and implemented. Reversible (see "How to change course").

## Decision

Keep our existing React + Three.js studio. Build the atlas assets **ourselves from the primary SPL/NAC atlas**
(`mhalle/spl-brain-atlas` @ `bec24db`), with a small conversion pipeline **adapted from `glin23/brain-atlas`** (MIT),
and render it in our own React Three Fiber scene. No second renderer, no new framework, no hosted service.

## Options compared

Scores are engineering judgements from the spike below, not measurements.

| | 1 · Our studio + audited `brain-atlas` pipeline | 2 · Our studio + primary atlas, own pipeline (+ NiiVue) | 3 · siibra through a supported boundary |
|---|---|---|---|
| Scientific provenance | Derivative of SPL/NAC; ids kept, but re-centred, Y-up, tinted; built from a 359-model archive we could not pin to a commit | Primary source at a pinned commit; we control every transform | Strongest (Julich-Brain, BigBrain, reference spaces) |
| Hover/select fidelity | One mesh per structure: real ids | Same | Real parcel ids, but inside its own application |
| Anatomical coverage | 252 structures; gyri, major sulci, nuclei, cerebellar lobules | 251 structures at the GitHub commit (same atlas) | Far wider; cytoarchitectonic M1 (areas 4a/4p) |
| Integration effort | Low — but its app is React 19 / three r185 / Vite 8, ours is React 18 / r169 / Vite 5 | Low–medium: ~300 lines of plain Node, no app code to port | High: a large Angular application and remote services, not a component |
| Performance | Reported good; unverified here | Measured here (see `docs/evidence/performance.txt`) | Unknown here; network-dependent |
| Offline capability | Yes | Yes (4.2 MB of local assets) | No (data services) |
| Licence suitability | Code MIT; geometry under the 3D Slicer licence | Geometry under the 3D Slicer licence; pipeline code MIT (attribution kept) | Code Apache-2.0; atlas data carry separate terms (Julich-Brain is CC BY-NC-SA) |
| Maintainability | Depends on a one-person, one-night prototype | We own ~600 lines of tooling with tests | Depends on an external platform |

## The spike that decided it

Option 2 was taken as the leading option, borrowing option 1's proven pipeline shape. It was proved end to end before
anything else was built:

- **Brain loads** from local assets: 251 structures, 760,155 triangles, 4.2 MB.
- **Picking is correct**: hovering resolves the mesh's own source id; an automated browser run hovers six structures
  and checks the name tag for each (`docs/evidence/e2e-report.txt`).
- **Isolation works**: isolate / hide / show-in-context / restore, with hidden and see-through surfaces never picked.
- **Region inspector works**: the left precentral gyrus opens a cited card with the "gyrus ≠ M1" caution.

No material failure appeared, so — as the brief instructs — options 1 (as shipped) and 3 were not built out.

## Why not the others

- **`brain-atlas` as shipped**: its packaged chunks are re-centred and rotated, were built from an archive we cannot
  pin to a commit, and its content (lifestyle scenes, "star" structures, performance claims) is not ours to inherit.
  We reused the *idea and code shape* of its converter and its VTK parser, with attribution.
- **NiiVue**: a mature viewer for volumes and slices, but the home-screen requirement (hover a structure, get its id)
  is already met by our Three.js scene. A second renderer would mean a second WebGL context, camera and coordinate
  frame to keep in step. Not needed for this release. Evaluated by documentation only; not cloned.
- **siibra-explorer**: the right source for a cytoarchitectonic M1, but it is a large application with data services,
  not a drop-in component, and the Julich-Brain maps are non-commercial. Evaluated by documentation only; not cloned.

## Consequences accepted

- The motor region is the **precentral gyrus** (an anatomical, landmark-based label), presented as a bounded
  approximation of M1 and never named M1. A cytoarchitectonic M1 needs a different, appropriately licensed atlas and
  a verified registration — proposed as future work, not done.
- One volunteer's anatomy in **scanner space, not MNI**. Nothing here can be overlaid on another atlas.
- Cut surfaces show hollow shells: the data are surfaces, and no volume rendering was added.

## How to change course

The atlas is consumed through one manifest format (`hbci-atlas/1`) and one loader (`src/atlas/loadAtlas.ts`). A
different atlas only needs a new builder that writes the same manifest; the viewer, picking rules, search and
inspector do not change. A volume/slice pane (NiiVue) or a siibra link-out can be added as a separate view later.
