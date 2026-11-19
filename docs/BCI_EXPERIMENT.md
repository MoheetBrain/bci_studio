# The interactive BCI experiment — what was built, on what basis, and what it is not

Branch `feature/bci-experiment`, cut from `feature/cinematic-rebuild` @ `be65709`. Pushed to GitHub on 2026-11-19 at the
owner’s request (plain push, no force); no pull request, nothing merged, published or deployed. One engineering agent; no sub-agents, no second model, no paid or generative service.

The brief: stop being a brain viewer. Pick up a virtual BCI, attach it to cortex, learn what that cortex does, record
from it, and follow one signal through acquisition and decoding to an output — as a working simulation, not a mock-up.

## 1 · What exists now

| Milestone | State | Where |
|---|---|---|
| 1 · Chip placement | done | Brain scene: **Add BCI** → the device follows the pointer over the real surface → click attaches → drag to move → Remove. Kept across reloads. |
| 2 · One complete simulation | done | Experiment scene, motor: intention → 24 model neurons → 8 contacts → front end → ADC → DSP → decoder → cursor, closed loop |
| 3 · An actual decoder | done | Linear, MLP and Kalman decoders fitted on a simulated calibration run, scored on a held-out run, used live |
| 4 · Region contrast | done | Lateral occipital gyrus: surface field potentials, band power, a classifier — and a stated list of what it cannot tell |
| 5 · Cinematic and mathematical polish | partly | 3D tissue scene with camera moves for stages 1–3; three synchronised representations for all eight stages. Stages 4–8 are plots and diagrams, not 3D. No Manim. |
| 6 · Architecture comparison | on synthetic data only | Decoder lab: five decoders, held-out scores, cost estimates, sensitivity runs, Pareto frontier, constraints. **No public electrophysiology dataset is used.** |

## 2 · Placement

- The device attaches to a **vertex of the atlas subject's own surface**; the region is the atlas label read from the label
  volume under that vertex (the same path the brain scene's picking uses). Stored: region id, vertex, RAS point, outward
  normal (`src/experiment/implantStore.ts`, browser `localStorage` only).
- "Compatible" means: cortex (atlas tissue class) on the visible outer surface. Cerebellum, brainstem and cut faces are
  refused, with the reason in the pointer tag.
- The enclosure and threads are a **generic concept drawing** (ILLUSTRATIVE). No dimension or design is taken from any
  manufacturer; threads are drawn about thirty times thicker than a real polymer thread. No skull, vessels, craniectomy or
  insertion is modelled. It is not a surgical planner.
- Fixed on the way: the opening shot's framing maths divided by the free width twice, which made the brain small whenever
  a card was open and in narrow panes. The brain now fills about two thirds of the stage height on a desktop window and
  about half of a small pane, and keeps its share when the window is resized.

## 3 · Region knowledge

Every selected surface region now has five parts: **Anatomy · Function · BCI · Signals · Unknowns**.

- **Two full dossiers** (`src/experiment/content/dossiers.ts`): precentral gyrus / primary motor cortex, and lateral
  occipital gyrus / visual association cortex. Each statement carries its kind (observed in data · published finding ·
  studio assumption · hypothesis) and its sources; species, method and sample are stated where the result depends on them.
- **Every other region**: atlas-derived anatomy only — lobe, surface area, and the regions it borders, computed from
  vertex labels and mesh edges (`src/atlas/neighbours.ts`) — and an explicit "not written yet" for function, BCI and
  signals. Attaching the device there works; **no experiment is offered**, because the studio will not invent one.
- 22 sources were added. All are checked against Crossref (title, year, volume, first page, first author:
  `npm run check:sources`, 49 DOIs, 0 problems) and were **read at abstract level in this build** (PubMed abstracts; kept
  out of the repository). Two claims were narrowed after reading (what Henze et al. 2000 and Crone et al. 1998 actually
  report). Full texts were not retrieved.
- EBRAINS: the Julich-Brain cytoarchitectonic areas to compare with (4a/4p; hOc4la/hOc4lp) are named and the EBRAINS
  atlas viewer is linked. They are **not overlaid**: this studio's atlas is one subject in scanner space and is not
  registered to them.

## 4 · The models (all SIMULATED)

`src/experiment/model/` — pure TypeScript, deterministic for a seed, unit-tested, run in a Web Worker.

### Motor (`motor.ts`)

| Stage | Model | Basis |
|---|---|---|
| Intention | 2-D velocity; calibration: prescribed reaches; closed loop: aim at the target from where the cursor was seen 100 ms ago | assumption |
| Neurons | 24 units, 3 per contact. Rate = base + speed·(k + m·cos(θ − θ_pref)); Poisson spikes, 3 ms dead time | cosine tuning (Georgopoulos 1982), speed term (Moran & Schwartz 1999) — monkey reaching; magnitudes illustrative |
| Spike shape | one Hodgkin–Huxley action potential (`src/neuro/model/hh.ts`); extracellular shape = −(dV/dt − I/C) | HH 1952 (squid axon, 6.3 °C); the −dV/dt rule is a teaching assumption |
| Electrode | 120 µV at 30 µm, ∝ 1/distance; white noise (rms set over 0.3–7.5 kHz); slow field potential; DC offset; optional common-mode hum and transients | stated teaching rules |
| Front end | 1st-order high-pass → 2nd-order Butterworth low-pass → gain → ±1 V saturation | ideal blocks |
| ADC | sampler (every k-th point of a 30 kHz grid) + mid-tread quantiser | ideal; real aliasing when the filter is too wide |
| DSP | 300 Hz–3 kHz band-pass → optional common average reference → threshold at −K·median\|x\|/0.6745 → counts per 50 ms → smoothing | estimator of Quiroga 2004; CAR as in Ludwig 2009; thresholds in the range Christie 2015 found best |
| Decoder | linear (ridge) · MLP (8 or 32 tanh units, Adam) · Kalman filter (steady-state gain) · lagged linear | Wu 2006 for the Kalman formulation |
| Output | cursor integrates decoded velocity; targets on a ring; 300 ms dwell | assumption |

### Visual (`visual.ts`)

Eight **surface** contacts, no spikes. Pink background noise per contact, multiplied by (1 + 1.6·drive) when a picture is
on (a broadband shift: Manning 2009, Ray & Maunsell 2011), plus an evoked potential, a 10 Hz rhythm, mains hum and
measurement noise. Drive = contact gain × picture strength × a delayed, adapting response. **Intact objects are given 2.5
times the drive of scrambled pictures by hand** (after Malach 1995); every object is given the same drive. Features:
70–150 Hz band power per 100 ms, in dB over rest. Decoder: two logistic units — P(picture on), P(intact | on).
What comes out: intact objects 5 of 5 detected, scrambled 3 of 6, 0 false alarms in 63 quiet bins, which-object 2 of 5
(chance, by construction). There is no electrode-distance control, because no simple law is assumed.

### What the tests pin down

`tests/experiment-motor.test.ts`, `tests/experiment-visual.test.ts` (19 tests): determinism; counts equal threshold
crossings; near neurons detected at the reference placement and lost at 150 µm; noise estimate tracks the noise; DC
coupling saturates; 4 bits lose the spikes; 2 kS/s loses them; artefacts become false crossings on every contact unless
the common average is removed; decoder costs equal their arithmetic; every decoded value equals its bias plus its terms;
the closed loop reaches its targets; a decoder used outside its calibration does worse and recalibration recovers it;
the visual model behaves as described, including the common average leaking other contacts' activity into a quiet one.

## 5 · The Experiment scene

- **Eight stages** — Tissue · Neuron · Electrode · Front end · ADC · DSP · Decoder · Output — each a view of the *same
  session at the same timeline position*. Play, pause, rewind, scrub, five speeds (real time to 1/500); each stage is
  entered at the speed at which its events can be seen. **Follow signal** walks through the stages unaided.
- **Three representations of one state**: Cinematic (what happens), Physics & maths (the equations with the live numbers
  in them), Engineering (specifications and budgets). Changing a parameter in one changes the others — they read one store.
- **Trace back**: at the decoder, pick a channel; the page lists the threshold crossings that fed this bin, each tagged
  with the model neuron that caused it (or "noise or artefact"), with jumps to the detector, the samples, the amplifier,
  the electrode and the neuron at that instant.
- **Provenance**: every stage carries one or two of MEASURED DATA · ATLAS-DERIVED · SIMULATED · MODEL-INFERRED ·
  ILLUSTRATIVE, a "Model and assumptions" list, and its sources.

## 6 · Decoder lab

Five decoders fitted on the same 32 s of calibration, scored on held-out runs: as calibrated, at five noise levels, three
electrode distances, with 0/2/4 channels lost, and in closed loop. Cost: multiply–accumulates, parameters, memory at 16
bits, clock cycles on a one-multiplier serial engine (MODEL-INFERRED: extrapolated from the Hamiltonian RTL decoder's 16
MACs in 18 cycles; that chip is simulated, not fabricated). Constraints (noise, lost channels, cycle, memory and lag
budgets) select a preferred decoder and say which were ruled out and why.

On this synthetic task: the lagged linear filter is most accurate as calibrated (R² 0.76), the linear decoder is cheapest
(18 cycles, R² 0.69), the 32-unit network is worst (0.59 — more parameters than 32 s of data can pin down). With a
30-cycle budget the preference flips to linear; with four channels lost as well, to the Kalman filter.
**This does not say which architecture is best for a real BCI.** The page says so, and sets the result of Glaser et al.
2020 (networks ahead of Kalman and Wiener filters on real recordings) next to it.

## 7 · Acceptance

`npm run test:e2e:experiment` — 17 steps in headless Chrome against the production build; report in
`docs/evidence/experiment/e2e-report.txt`, 33 screenshots in `docs/evidence/experiment/screens/`.

| # | Acceptance test | Result |
|---|---|---|
| 1 | attach the device to a selected cortical region | ✓ pointer-following preview, click attaches, cerebellum refused |
| 2 | stays positioned when the brain is rotated | ✓ device < 0.01 mm from its placement over 8 views; surface pick under it unchanged |
| 3 | motor vs occipital: distinct, appropriate explanations | ✓ five parts each, different in every part, 12+ distinct linked sources each |
| 4 | start and pause a simulated recording | ✓ play, pause, scrub, reset |
| 5 | change a parameter, see the waveform change | ✓ distance and noise; spike amplitude follows the stated rule |
| 6 | inspect amplification, sampling, quantisation, DSP | ✓ each inspectable and breakable (saturation, aliasing, bit depth, artefacts) |
| 7 | decoder produces numerical predictions | ✓ nine terms sum to the decoded velocity; three decoders |
| 8 | trace a prediction back | ✓ bin → crossing → detector → code → amplifier → electrode → neuron |
| 9 | provenance and assumptions visible | ✓ every stage, three representations |
| 10 | builds; main interactions tested | ✓ typecheck, build, 111 unit tests, this run, the earlier 27-step walkthrough |

## 8 · Known limitations

- **Everything recorded is simulated.** No measured neural data enters the Experiment scene. (The existing Decoder scene's
  RTL trace on recorded ECoG is unchanged and separate.)
- Eight channels, three neurons each, one fixed tissue layout. Real arrays, real tuning diversity and real noise are richer.
- The simulated user is a rule (aim at the target, 100 ms late). No learning, fatigue or co-adaptation.
- The visual model's category effect is built in; its "which object" result is chance by construction.
- No stimulation is modelled or controlled anywhere.
- Regions other than the two dossiers have atlas-derived anatomy only.
- Decoder comparison is synthetic; cycle and memory figures are estimates; no power figure is given because none would be
  defensible for an unfabricated chip.
- Stages 4–8 are not 3D. The "cinematic" representation there is large plots with a plain-language account.
- Not measured: performance on a low-end laptop or a physical phone (a 390-px emulated phone is in the test).
- The dossiers were written from abstracts, not full texts.

## 9 · Remaining milestones

1. A decoder benchmark on a **public electrophysiology dataset** with proper held-out evaluation (needs the owner's
   go-ahead to download data, and a licence review).
2. More region dossiers (somatosensory, speech motor, ventral temporal), each reviewed against its sources.
3. Convolutional, recurrent and spiking decoders (`DecoderSpec` in `decoders.ts` is the one place to add them).
4. One continuous signal shared between this scene and the older Signal scene, and the chip's own RTL event/feature
   paths in place of the floating-point detector.
5. 3D for the electronics stages; optional Manim clips for the mathematics, if they earn their place.
6. A stimulation ("write") scene — only with the evidence and the safety framing it would need.
