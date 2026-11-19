# Hamiltonian Interface — BCI Studio

An interactive neuroscience and brain–computer-interface research studio. The first screen is a real, MRI-derived
3D human brain; from a selected region you follow the signal down to an electrode contact, through an acquisition
chain, into the Hamiltonian digital chip — with every claim labelled by the evidence behind it.

> Educational and research software. Not a medical device, not a surgical planner, and it controls no stimulation.
> The atlas is one volunteer's anatomy and, per its licence, is for research purposes only.

## Run it

Requires Node 22.13 or newer (24 used here; the local search needs `node:sqlite`).

```sh
npm install
npm run dev          # http://127.0.0.1:5180  (includes the local source-search service)
```

```sh
npm run build        # production build → dist/
npm run preview      # http://127.0.0.1:5181  (also serves the search service)
```

## Test it

```sh
npm run check        # typecheck + 63 unit tests + the three model-versus-RTL checks
npm run test:e2e     # production build, then the 29-step acceptance walkthrough in headless Chrome
node tests/e2e/perf.mjs      # opens a visible Chrome window for ~15 s; writes docs/evidence/performance.txt
npm run check:sources        # verifies every cited DOI against Crossref (needs network)
```

The browser tests drive the Chrome already installed on the machine (`playwright-core`, no browser download).

## The five screens

| | Screen | What it is | Evidence label |
|---|---|---|---|
| 1 | **Brain** (home) | 251 structures of the SPL/NAC atlas. Hover names a structure, click pins it and opens a cited explanation. Search, anatomical tree, isolate / hide / context / restore, hemispheres, cortex opacity, cutaway. | Measured dataset |
| 2 | **Neural interface** | Scale ladder from the atlas down to neurons and one electrode contact; membrane potential (mV) versus electrode voltage (µV). | Schematic + synthetic example |
| 3 | **Signal journey** | Neural source → electrode → (routing) → AFE → (analogue MUX) → ADC → our chip → decoder/host. Play, pause, scrub, change gain / sample rate / bit depth and see the calculated consequences. | Synthetic quantitative example |
| 4 | **Our chip** | What the digital design actually contains, read from the RTL (file:line), which executed suites cover it, and what is *not* implemented. The existing full chip studio is one click away. | RTL + recorded simulation |
| 5 | **Research** | Local full-text search over the project documents, RTL and curated cards, with exact locations. Passages, not generated answers. | — |

The selected brain region is carried through all five and one click returns to it.

## Regenerating data

```sh
npm run atlas:build      # atlas assets from reference/spl-brain-atlas (see docs/ATLAS_PROVENANCE.md for the clone command)
npm run chip:extract     # chip hierarchy from chip/rtl → public/artifacts/chip_hierarchy.json
npm run check:rtl        # run the model-versus-RTL checks → public/artifacts/studio_checks.json
npm run corpus:build     # local search index → corpus/index.sqlite (git-ignored) + public/corpus/manifest.json
npm run corpus:abstracts # fetch PubMed abstracts of the cited papers into corpus/private/ (git-ignored; needs network)
```

A fresh clone has no `corpus/index.sqlite`: run `npm run corpus:build` once, or the Research screen will say the
search service is unavailable (the rest of the studio works without it).

## Layout

```
src/atlas/      atlas viewer, picking rules, search, region cards        src/journey/   signal-chain model, lesson UI
src/neuro/      neural-interface lesson                                   src/chipmap/   source-traced chip map
src/research/   corpus search UI                                          src/shell/     app shell and navigation
src/science/    bibliography, citations, evidence labels                  src/…          the existing chip studio (unchanged)
server/         localhost-only search API (Vite plugin)                   tools/         atlas, chip and corpus builders
chip/           read-only snapshot of the chip repository (RTL, tb, docs) tests/         unit tests + tests/e2e browser tests
public/atlas/   atlas assets + licence                                    docs/          decision note, provenance, licences, audit, handover, evidence
```

## Read next

- `docs/HANDOVER.md` — what was built, what was reused, test results, limitations, next task.
- `docs/DECISION_ATLAS_FOUNDATION.md` — why this atlas and this architecture.
- `docs/ATLAS_PROVENANCE.md` — dataset, transforms, coverage, verification, known source problems.
- `docs/LICENCES.md`, `THIRD_PARTY_NOTICES.md` — code and data licences.
- `docs/SOURCE_AUDIT.md` — what was read, what was only indexed, what was unavailable.
