# Hamiltonian Interface — BCI Studio

An interactive neuroscience and brain–computer-interface research studio. The first screen is one continuous,
MRI-derived 3D human brain on a dark stage; from a selected region you dive to neurons and an electrode contact,
follow the signal through an acquisition chain into the Hamiltonian digital chip, and watch its decoder add up a
frame one clock cycle at a time — with every claim labelled by the evidence behind it.

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
npm run check        # typecheck + 150 unit tests + the three model-versus-RTL checks
npm run test:e2e     # production build, then the 27-step walkthrough in headless Chrome (also captures the screens)
npm run test:e2e:experiment   # production build, then the 17-step acceptance test of the BCI experiment
npm run test:e2e:world        # production build, then the 28-step test of the world (#/world)
npm run test:e2e:neuroverse   # production build, then the 29-step test of the three prototype toys (#/world/dev)
node tests/e2e/perf.mjs      # opens a visible Chrome window for ~40 s; writes docs/evidence/performance.txt
node tests/e2e/capture-looks.mjs && node tests/e2e/compare.mjs   # same-camera look captures + before/after sheets (dev server running)
node tests/e2e/record.mjs    # 30 s screen recording of real interaction (needs ffmpeg on the PATH)
npm run check:sources        # verifies every cited DOI against Crossref (needs network)
```

The browser tests drive the Chrome already installed on the machine (`playwright-core`, no browser download).

## The world

`http://127.0.0.1:5180/#/world` — or “Enter the neural world →” on the brain, or “World” in the dock.

It opens on the whole brain (one volunteer’s MRI-derived surface, the atlas’s own labels). Enter the left precentral
gyrus and you are flying a small research craft through a block of **illustrative** cortex:

- **fly** it with W A S D and E Q, drag to look (L for mouse look), Shift to brake; the camera follows the craft, or
  V looks out of it; F inspects the selection while the craft waits, R returns to it, M shows the whole block; Space
  pauses the model, never the craft;
- **point** at anything — any branch lights its whole neuron and says what it is. One neuron is a real one: a
  reconstructed human cell from the H01 release (CC BY 4.0), shown as structure with no model attached; the rest are
  generated shapes, and the context cells say they have no model;
- **change one cause** in a five-cell circuit — when an input fires, or whether an inhibitory connection is on — and
  see why the cell they both reach does or does not fire; replay, compare with the baseline, undo, redo;
- **record from outside**: take contacts P1 and P2 in hand, put them down, drag or step one to an exact place and
  leave the other — the same spikes, the same noise, a different recording (microvolts: a synthetic observation, not
  the millivolts inside). They stay where you put them, also after a reload;
- **decode**: at the electrode array your keys become a synthetic intended velocity, a fitted decoder moves a cursor,
  you lose three contacts and get control back by switching decoder or recalibrating;
- **go back out** to the brain without losing the experiment.

Every signal there is computed by a stated model; nothing is a recording and nothing reads a brain. Record of the
build, its limits and its measurements: [`docs/EMBODIED.md`](docs/EMBODIED.md) (and, for the journey as a whole,
[`docs/WORLD.md`](docs/WORLD.md)). Whether it is enjoyable, and whether anyone learns from it, has not been tested:
nobody has played it yet.

The three prototypes it was built from are kept as development aids at `#/world/dev`
([`docs/NEUROVERSE.md`](docs/NEUROVERSE.md)).

## The seven scenes

Ordered by physical scale in the dock; the selected brain region is carried through all of them, each scene links to
the previous and next one, and one click returns to the region.

| | Scene | What it is | Evidence label |
|---|---|---|---|
| 1 | **Brain** (home, 15 cm) | One continuous surface from the atlas subject’s own T1 MRI; every point carries its region from the label volume. Hover names a region, click reframes and opens one card. Solid / X-ray (the atlas’s 251 bodies inside a glass shell) / Regions / Slice (the MRI on the cut face). Finder: ⌘K or `/`. | Measured dataset; the tissue look is rendering |
| 2 | **Experiment** (BCI · live) | Attach a virtual BCI to the cortex in the Brain scene (**Add BCI**), then follow what it records through eight stages — tissue, neuron, electrode, front end, ADC, DSP, decoder, output — on one timeline, in three synchronised representations. Two experiments: movement → cursor on the precentral gyrus, picture → report on the lateral occipital gyrus. A decoder lab compares five decoders under constraints. | **Simulated** throughout; device and cell geometry illustrative; placement atlas-derived |
| 3 | **Neurons** (≈ 1 mm) | A 3D schematic patch of cortex. One neuron runs the Hodgkin–Huxley equations; an electrode contact at an adjustable distance records a faint, inverted echo. Play / pause / scrub in stated slow motion; three detail levels. | Schematic + synthetic example |
| 4 | **Signal** (µV → bits) | Neural source → electrode → (routing) → AFE → (analogue MUX) → ADC → our chip → decoder/host, with computed traces and consequences. | Synthetic example; digital stage checked against RTL |
| 5 | **Chip** (RTL) | What the digital design actually contains, read from the RTL (file:line), which executed suites cover it, what is *not* implemented. The original full chip studio is one click away, unchanged. | Read from source; “not fabricated” stated |
| 6 | **Decoder** (8 → 2) | Eight inputs, sixteen multiply-accumulates, two totals, one answer — stepped by engine clock cycle over 32 frames of the RTL trace on recorded ECoG samples. Totals are re-added in the page and checked against the RTL. | RTL simulation trace; what-if is a labelled software re-run |
| 7 | **Research** (sources) | Local full-text search over the project documents, RTL and curated cards, with exact locations. Passages, not generated answers. | — |

Three predict-then-check tasks (spikes are all-or-nothing; aliasing; one dominant decoder channel) ask for an answer
before the scene shows the model’s result. Answers stay in the browser.

## Regenerating data

```sh
npm run atlas:build      # the 251 atlas bodies from reference/spl-brain-atlas (see docs/ATLAS_PROVENANCE.md for the clone command)
npm run atlas:specimen   # the continuous surface, its region ids, baked occlusion and the slice volumes (run after atlas:build)
npm run chip:extract     # chip hierarchy from chip/rtl → public/artifacts/chip_hierarchy.json
npm run check:rtl        # run the model-versus-RTL checks → public/artifacts/studio_checks.json
npm run corpus:build     # local search index → corpus/index.sqlite (git-ignored) + public/corpus/manifest.json
npm run corpus:abstracts # fetch PubMed abstracts of the cited papers into corpus/private/ (git-ignored; needs network)
```

A fresh clone has no `corpus/index.sqlite`: run `npm run corpus:build` once, or the Research screen will say the
search service is unavailable (the rest of the studio works without it).

## Layout

```
src/atlas/      brain stage: surface, tissue shader, picking rules, finder   src/neuro/     Neurons scene + Hodgkin–Huxley model
src/journey/    signal-chain model and scene                                 src/chipmap/   source-traced chip map
src/decoder/    Decoder scene (stepping over the RTL trace)                  src/research/  corpus search UI
src/kit/        timeline, transport, detail levels, predict tasks, rail      src/shell/     app shell, dock, region finder
src/science/    bibliography, citations, evidence labels                     src/…          the original chip studio (unchanged)
server/         localhost-only search API (Vite plugin)                      tools/         atlas, specimen, chip and corpus builders
chip/           read-only snapshot of the chip repository (RTL, tb, docs)    tests/         unit tests + tests/e2e browser tests
public/atlas/   atlas + specimen assets + licence                            docs/          decisions, provenance, licences, audit, handover, evidence
```

## Read next

- `docs/HANDOVER.md` — what was built, what was reused, test results, limitations, next task.
- `docs/EMBODIED.md` — the current world: the craft you fly, pointing at whole neurons, the reconstructed H01 neuron (CC BY 4.0), the two recording contacts you place and move; what was checked and what is untested.
- `docs/WORLD.md` — the integrated world at `#/world`: what was built, the design decision, what was checked and measured, what is untested; `docs/evidence/world/` holds the test report, performance sample, screenshots and the recorded walkthrough.
- `docs/NEUROVERSE.md` — the three prototype toys the world was built from: what was built, the models and their limits, what the checks found, what is still untested; `docs/NEUROVERSE_PLAYTEST.md` is the sheet for playing them; `docs/evidence/neuroverse/` holds the test report, performance sample, screenshots and recordings.
- `docs/BCI_EXPERIMENT.md` — the interactive BCI experiment: models, sources, assumptions, acceptance results, limits; `docs/evidence/experiment/` holds its test report and screenshots.
- `docs/CINEMATIC_REBUILD.md` — the cinematic rebuild: what was decided and why; `docs/evidence/cinematic/README.md` indexes its evidence.
- `docs/DECISION_ATLAS_FOUNDATION.md` — why this atlas and this architecture.
- `docs/ATLAS_PROVENANCE.md` — dataset, transforms, coverage, verification, known source problems.
- `docs/LICENCES.md`, `THIRD_PARTY_NOTICES.md` — code and data licences.
- `docs/SOURCE_AUDIT.md` — what was read, what was only indexed, what was unavailable.
