# Handover — BCI Studio first integrated release

Date: 2026-11-17. Branch `feature/brain-atlas-studio` in `~/bci_studio`, pushed to `MoheetBrain/bci_studio` on 2026-11-18 at the
owner's request (no pull request opened, nothing merged, published or deployed). The owner confirmed on 2026-11-18
that the studio stays in this repository. One engineering agent; no sub-agents or second model were used.

## 0 · Interactive BCI experiment — 2026-11-19 (read this first)

Branch `feature/bci-experiment`, cut from `feature/cinematic-rebuild` @ `be65709`. **Pushed to GitHub on 2026-11-19 at
the owner’s request (plain push, no force); no pull request, nothing merged, published or deployed.** One engineering agent; no sub-agents, no second model, no paid or
generative service. Decision record, models, sources and limits: `docs/BCI_EXPERIMENT.md`.

What changed, in one paragraph: the Brain scene has an **Add BCI** control — a virtual device follows the pointer over
the real surface, attaches to the atlas region under it, can be dragged, moved and removed, and survives a reload. Every
surface region now has a five-part brief (anatomy, function, BCI, signals, unknowns); two are fully written and sourced
(precentral gyrus, lateral occipital gyrus), the rest show atlas-derived anatomy and say what is not written. A new
**Experiment** scene simulates what the device records and follows it through eight inspectable stages to a decoded
output on one timeline, in three synchronised representations, with a trace from any prediction back to the neuron (or
the noise) that caused it. A **Decoder lab** compares five decoders on held-out synthetic data under constraints.

Verified on this branch: typecheck clean · 111 unit tests · model-versus-RTL checks pass · production build ·
`tests/e2e/experiment.mjs` 17 of 17 · `tests/e2e/walkthrough.mjs` (the earlier 27 steps) · 49 DOIs against Crossref.

Things to know before touching it:
- New code lives in `src/experiment/` (models in `src/experiment/model/`, pure and unit-tested; they run in a Web Worker
  via `sim.worker.ts`). The brain scene gained the device and three hooks in `src/atlas/AtlasScene.tsx`; the insight
  card gained the brief and the BCI controls. The original chip studio (`src/ui`, `src/lab`, `src/model`,
  `src/artifacts`, `src/state`, `src/App.tsx`, `chip/`) is untouched.
- The opening shot's framing was corrected (it had divided by the free width twice). The older walkthrough's bound on
  the brain's size still holds.
- **Everything in the Experiment scene is simulated.** The only measured data in the studio remain the atlas and the RTL
  trace on recorded ECoG in the Decoder scene.
- Open decisions for the owner: whether this branch stacks on or replaces the two earlier branches;
  whether to download a public electrophysiology dataset for a real-data decoder benchmark (not done — needs your
  go-ahead and a licence review).

## 0b · Cinematic rebuild — 2026-11-19

Branch `feature/cinematic-rebuild`, cut from `feature/brain-atlas-studio` @ `df9ba12`. **Pushed to GitHub on 2026-11-19
at the owner’s request (plain push, no force); no pull request, nothing merged, published or deployed.** PR #1
(`feature/brain-atlas-studio` → `main`) is untouched.
One engineering agent; no sub-agents, no second model, no paid or generative image/video service.

What changed, in one paragraph: the home screen is now one continuous brain surface derived from the atlas subject’s
own T1 MRI, lit by a custom tissue shader on a dark stage, with the atlas’s 251 models kept as the bodies inside;
selection is a smooth contour with the rest dimmed and one card with one invitation; the cut shows the real MRI; a
finder (⌘K) replaces the search form; the Neurons scene is a 3D schematic driven by the Hodgkin–Huxley model with a
seekable timeline; a new Decoder scene steps the on-chip decoder through the real RTL trace one clock cycle at a
time; all scenes share the dark stage, link to each other, and three of them carry a predict-then-check task. The
decisions and their reasons are in `docs/CINEMATIC_REBUILD.md`.

| Phase of the brief | Status | Evidence |
|---|---|---|
| 0 · Inspect, baseline before edits, one decision record | Done | `docs/evidence/cinematic/baseline/`, `docs/CINEMATIC_REBUILD.md` |
| 1 · Cinematic brain: geometry, material, lighting, framing, stage; two looks compared | Done | `docs/evidence/cinematic/compare/01…04`, `tests/specimen-assets.test.ts` |
| 2 · Regional discovery: hover, select, reframe, card, finder, real slice | Done | walkthrough steps 2–10 |
| 3 · One multiscale walkthrough: brain → neurons → signal → chip → decoder | Done; the Neurons and Signal traces are two stated models, not yet one signal | walkthrough steps 11–19 |
| 4 · Platform coherence: one stage, one dock, rails, detail levels | Done; three detail levels in Neurons and Decoder only | `src/kit/` |
| 5 · Test, polish, reviewable branch | Done locally; **push awaits the owner’s go-ahead** | below |

Checks on this branch (2026-11-19, this machine): `npm run check` — typecheck clean, **92/92** unit tests, three
model-versus-RTL checks pass; `npm run build` clean; `npm run test:e2e` — **27/27** steps; `npm run check:sources` —
27 DOIs, 0 problems; performance in `docs/evidence/performance.txt` (two profiles). Full list:
`docs/evidence/cinematic/README.md`.

Defects found by these checks and fixed: surface micro-relief computed in millimetres against view-space metres
(speckle); slice volumes double-inflated when the server announces `Content-Encoding: gzip`; a new cut opened facing
away from the viewer; deep structures (hippocampus) selected but invisible because a few hidden surface vertices
counted as “on the surface”; region borders drawn as jagged triangle strips; timeline could step slightly negative on
its first frame (crashed the Decoder scene on a phone); a feedback sentence claimed spikes get smaller under stronger
drive when only later spikes do; “fires N times a second” was shown for two spikes followed by silence; “µm” rendered
as “MM” inside an upper-cased heading.

One mistake made and undone during the work: a new stylesheet was first written to `src/ui/ui.css`, which belongs to
the original chip studio. It was restored from git at once (`git diff df9ba12 -- src/ui` is empty) and the new shared
code lives in `src/kit/` instead. The original studio’s folders were not otherwise touched.

Known limits of this branch: `docs/CINEMATIC_REBUILD.md` §8. Decisions waiting for the owner: push this branch;
whether it should replace or stack on PR #1; confirm the DANDI attribution wording (`docs/LICENCES.md` §5).

Sections 1–8 below describe the first integrated release (`df9ba12`) and are kept as its record; where they mention
“five screens”, a light stage, the search form or 29 walkthrough steps, this section supersedes them.

## 1 · What exists now

The acceptance walkthrough runs end to end in the production build and is automated (`npm run test:e2e`, 29 steps):

open the studio → **the 3D brain** → hover the left precentral gyrus → select it and read a concise, cited
explanation (with the "gyrus ≠ M1" caution) → place an **illustrative electrode** → follow **signal conditioning and
ADC conversion** → inspect the **real implemented digital blocks** (file:line) → **pause and scrub** computed traces
→ open **supporting research** → **return to the same brain region**.

| Gate | Status | Where |
|---|---|---|
| 0 · Inventory, baseline, licence audit, decision | Done | `docs/evidence/baseline.txt`, `docs/LICENCES.md`, `docs/DECISION_ATLAS_FOUNDATION.md` |
| 1 · Real 3D brain with hover / search / select / isolate and a motor-region explanation | Done | `src/atlas/`, `tools/atlas/`, `docs/ATLAS_PROVENANCE.md` |
| 2 · Anatomy-to-electrode transition and acquisition-to-digital lesson with computed traces | Done | `src/neuro/`, `src/journey/` |
| 3 · Actual Hamiltonian chip blocks connected to source | Done | `src/chipmap/`, `tools/chip/`, `chip/` |
| 4 · Local source search, cited cards, provenance labels, corpus evaluation | Done (keyword retrieval; no generated answers) | `src/research/`, `server/`, `tools/corpus/`, `docs/SOURCE_AUDIT.md` |
| 5 · Desktop/mobile checks, performance, accessibility, launch instructions | Done, with the limits in §6 | `tests/e2e/`, `docs/evidence/`, `README.md` |

## 2 · Decisions on location and revision

1. **Where the work lives — confirmed by the owner on 2026-11-18: keep it in `bci_studio`.** The studio is developed
   in `MoheetBrain/bci_studio` (local clone `~/bci_studio`), with the existing studio imported at the repository root
   and a read-only snapshot of the chip's `rtl/`, `tb/`, `system/` and `docs/` under `chip/`. The chip repository
   `~/Hamiltonian-BCI-Chip` stays the home of the RTL and is only read from here. To pick up newer chip work,
   replace `chip/` from a later commit, regenerate `chip/SNAPSHOT.json`, then run `npm run chip:extract` and
   `npm run check:rtl` (the snapshot-integrity test fails until both are refreshed).
2. **Which revision.** The chip repository's `main` is at `1448535`; the newest work is `feature/hbci-02-onchip-ai`
   at `207285f` (HBCI-02, on-chip decoder), a strict descendant of `main` and already on GitHub. The snapshot is
   based on `207285f`.

## 3 · Changed files and reused components

**Existing studio (imported at `6975d11`): 7 files touched, 61 lines added, 17 removed.**

| File | Change |
|---|---|
| `src/main.tsx` | renders the new shell instead of `App` (the old app is lazy-loaded inside it) |
| `src/lab/featureModel.ts` | exports `FState` and a `freshFeature()` constructor (no behaviour change) |
| `src/model/system.ts` (in the import commit) and `vite.config.ts` | paths to the chip snapshot; search plugin; `127.0.0.1` binding; `dedupe: ['three']` |
| `tsconfig.json`, `package.json`, `package-lock.json`, `index.html` | new scripts, three added packages, page title |

The existing chip studio (System › Package › Die › Circuit › Gates › Layout, signal lab, lessons) runs unchanged
under **Our chip → Open the full chip studio**. New stylesheets are wrapped in `@scope` so they cannot restyle it.

**New code** (≈ 7,400 lines including tests):

| Area | Files / lines | Reuses |
|---|---|---|
| `src/atlas` — viewer, rules, search, cards | 12 / 2,014 | three, React Three Fiber, Drei `OrbitControls`, three-mesh-bvh (all already installed); design tokens from `styles.css` |
| `src/journey` — chain model, lesson UI | 6 / 1,441 | the existing RTL-checked `stepCore` (`src/lab/model.ts`) and `stepFeature` (`src/lab/featureModel.ts`) for the digital stage |
| `src/chipmap` — chip map | 4 / 486 | existing artifacts `verification.json`, `manifest.json`; existing `App` |
| `src/neuro`, `src/research`, `src/science`, `src/shell` | 10 / 1,014 | `applyDocumentPrefs` / `loadPrefs` from the existing prefs store |
| `server`, `tools`, `scripts` | 11 / 1,259 | conversion pipeline adapted from `glin23/brain-atlas` (MIT); the existing `check-*-vs-rtl.mjs` scripts are run as they are |
| `tests` | 10 / 1,263 + 2 e2e scripts | — |

Reference projects: see `docs/LICENCES.md` (adopted, evaluated-only, not imported).

## 4 · Tests executed

All output is in `docs/evidence/` (`final-checks.txt`, `e2e-report.txt`, `performance.txt`, `retrieval-eval.txt`,
`sources-check.txt`, `baseline.txt`, `screenshots/`).

| Check | Result |
|---|---|
| Baseline before any change (typecheck, `check:model`, `check:v03`, `check:v04`, build) | all pass |
| Typecheck (`tsc -b`, now including `server/`) | pass |
| Unit tests (`node --test`, 63 tests in 9 files) | 63 pass, 0 fail |
| Model-versus-RTL checks, executed and recorded | 3 pass: 3,200/3,200 samples (EVENT), 4,000/4,000 (FEATURE) + exact RAW, 256/256 features and 32/32 inferences (decoder) |
| Bibliography against Crossref | 27 DOIs, 0 problems (one registry typo documented) |
| Retrieval, held-out set (54 documents, 385 passages) | 14/15 answerable in the top 3 (13/15 at rank 1); 5/5 unanswerable refused |
| End-to-end walkthrough, production build, headless Chrome | 29/29 steps; 28 screenshots |
| Performance, visible Chrome, Apple M5 Ultra, 1440 × 893 at 2× | hover → highlighted frame p50 16.6 ms / p95 17.4 ms; orbit p50 8.3 ms (display-limited, 120 Hz) / p95 8.4 ms; pick p95 0.2 ms; 0 frames rendered when idle |

**The 31 Verilog suites were not re-run.** They are reported from the chip repository's recorded
`verification.json` (2026-10-27); no simulator was invoked in this build.

### Defects found by these checks and fixed along the way

- The subject's mid-sagittal plane is tilted (yaw −3.7°, roll 4.6°): a constant-x midline failed the left/right
  mirror test. Now fitted and reported; nothing is re-aligned.
- Decimation shaved 2.9 mm off the cerebellar white matter's outline. Decimation now backs off when the bounding
  box moves more than 0.5 mm.
- The chain model's high-pass started from a noisy sample, inflating noise fivefold at low corners. Filters now
  start settled on the electrode offset.
- Draft region statements went beyond what the abstracts support (location of area 4, array placement). Reworded.
- New global CSS classes collided with the existing studio's (`.btn`, `.kind`, `.disclaimer`, `.sw`). Scoped.
- Phone layout overflowed horizontally on two screens. Fixed.

## 5 · Evidence labels in the app

Measured dataset (the atlas; recorded RTL traces) · Synthetic quantitative example (every lesson trace) ·
Evidence-based schematic (cortical layers, routing, analogue MUX) · Conceptual / unvalidated (external hardware).
"Validated model" is not used anywhere.

## 6 · Known limitations

**Scientific**
- No neuroanatomist or neuroscientist has reviewed the labels or the text. Statements citing the seven papers
  without an available abstract, and the textbook, were written from prior knowledge and not checked in this build.
- The motor region is the precentral **gyrus**, a landmark-based label, not cytoarchitectonic M1.
- One volunteer, scanner space, not MNI; nothing can be overlaid on another atlas. Four structures disagree with
  the label volume in the source itself; sulcus surfaces cannot be cross-checked at all.
- The lesson model is deliberately simple: 1/distance spike decay, template waveforms, white amplifier noise, an
  ideal ADC, one channel, no record timing or back-pressure. It is a teaching example, not a simulator.
- The on-chip decoder is not run on lesson data (it needs eight channels and a trained model); its RTL traces are
  shown in the existing studio.

**Licensing**
- The atlas licence has conditions for redistribution and says research use only (`docs/LICENCES.md` §5). Counsel
  should confirm before a commercial release.
- Abstracts are local only and must not be shipped.

**Implementation**
- Cut surfaces show hollow shells (surface data; no volume or slice pane).
- The Research screen needs the dev or preview server; a plain static host has no search (the app says so).
- PDFs cannot be ingested (no extractor installed); text and Markdown can.
- Performance was measured on one fast desktop only. No low-end GPU and no physical phone were tested; phone
  checks used an emulated 390 × 844 touch viewport.
- Accessibility was checked for control names, landmarks, a live region, keyboard paths and focus visibility. No
  screen-reader session and no automated contrast audit were run; the 3D canvas itself is not navigable by
  screen reader beyond the tree and search.
- The home-screen JavaScript is one 1.1 MB chunk (330 KB transferred); it could be split further.
- `npm install` reports advisories in the existing dependency set; versions were deliberately left as they were.

## 7 · Proposed next steps (not implemented — your call)

1. **Expert review** of the region cards and lesson text by a neuroscientist; replace prior-knowledge statements
   with full-text-checked ones.
2. **A cytoarchitectonic motor area** from an appropriately licensed atlas, shown as a separate view unless a
   verified registration to this subject exists.
3. **A slice pane** over the atlas's own T1 and label volume (NiiVue is the candidate), synchronised with the cut.
4. **Multi-channel lesson** so the on-chip decoder can run on lesson data; record timing and back-pressure.
5. **More atlas depth**: synonyms and cards for the remaining regions; cortical layers, synapses, oscillations.
6. **Hardware comparison** (published AFE/ADC parts versus the chip's input format) from the project's decision
   record, clearly labelled as vendor figures.
7. **Deterministic video export** by rendering the verified scene, not by generating imagery.
8. **Bounded retrieval-augmented answers**, only if you configure a model provider; and semantic retrieval only if
   a larger held-out set shows it beats the keyword baseline.

## 8 · Resumable progress note

- State: all six gates implemented; committed on `feature/brain-atlas-studio` and pushed to GitHub; not merged.
- To resume: `cd ~/bci_studio && npm install && npm run corpus:build && npm run dev`.
- Reference clones live in the git-ignored `reference/` (needed only to rebuild the atlas).
- **Next concrete task:** have the precentral-gyrus card and the signal-journey stage text reviewed by a domain
  expert. Still open for the owner: whether to open a pull request into `main`.
