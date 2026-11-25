# Hamiltonian Neuroverse — three competing toys (stages 0–2)

> **Superseded as the current state on 2026-11-25** by the integrated world — see `docs/WORLD.md`. The owner authorised
> the next phase without the comparative playtest this document ends on. What follows is the record of the three
> prototypes as they stood at commit `6b33806`; they are kept as development aids at `#/world/dev`. Two things changed
> under them since: the scene renderer they share, and the positions of the five workshop cells (which do not enter
> the dynamics). Their browser suite still passes (`npm run test:e2e:neuroverse`).

Date: 2026-11-25 · Branch `feature/neuroverse-toys`, cut from `feature/bci-experiment` @ `c605e3f` · nothing pushed,
merged, published or deployed · one engineering agent; no sub-agents, no second model, no paid or generative service.

Built from `HAMILTONIAN_NEUROVERSE_CLAUDE_FABLE_PROMPT.txt`, `…_MASTER_SPECIFICATION.md` and
`…_SOURCE_READING_AUDIT.md` (version 0.1, 25 November 2026). This document is the decision record for the build.

## 0 · Where this stands

**Built and checked by code:** a shared, flyable neural circuit; one controller; three small playable toys; run
export/import for each; 30 new unit tests and a 29-step browser test; a performance sample; three recordings.

**Not done, and not claimable from anything here:**

| Gate | Status |
|---|---|
| Does the owner enjoy any of the toys, and which one? | **Pending** — stage 3, `docs/NEUROVERSE_PLAYTEST.md`. Nobody has played them. |
| Does playing improve understanding, retention or transfer? | **Pending.** No learner data exists. |
| Are the models' biological claims sound? | **Pending.** No neuroscientist has reviewed anything. Code tests show the implementation matches its own description, nothing more. |
| Performance on any machine but this one | **Not measured.** |
| Touch or phone flight | **Not built.** The on-screen pad works with a pointer; nothing was tried on a touch device. |
| Captured mouse look inside the Claude app's browser pane | **Refused there in my check** (§8); granted in Chrome. Drag-to-look works in both. |
| Sound | **None.** The optional sonification in the specification was not built. |

The final acceptance question — *can Moheet enter this world, act freely, find a consequence worth investigating, and
want to try again?* — is not answered. The conditions for answering it are built.

## 1 · Run it

```sh
npm install
npm run dev                      # then open http://127.0.0.1:5180/#/world
```

The chooser offers the three toys and suggests an order that rotates daily. “Classic studio” (top right in a toy, bottom
of the chooser) goes back to the atlas, the BCI experiment, the chip and the decoder trace, all unchanged. From the
brain, “Enter the neural world →” (top left) comes back.

```sh
npm run check                    # typecheck + 141 unit tests + the three model-versus-RTL checks
npm run test:e2e:neuroverse      # production build, then the 29-step browser test (headless Chrome)
npm run perf:neuroverse          # production build, then a 5½-minute sample in a VISIBLE Chrome window
npm run record:neuroverse        # production build, then three short recordings (docs/evidence/neuroverse/video/*.mp4)
```

Controls (all remappable under “Controls”; every one also has a button):

| Do | Key | Without the key |
|---|---|---|
| Fly | W A S D, E up, Q down (arrow keys too) | the pad, bottom left |
| Look | drag the scene; or **L** for mouse look (Esc gives the mouse back) | “Mouse look” button |
| Brake / creep | hold Shift | “Brake” |
| Travel speed | mouse wheel (six levels, 15–480 µm/s) | − / + |
| Select | click a cell or a connection (with mouse look: whatever is under the centre mark) | “Go to” list |
| Focus · Return · Overview | F · R · M | buttons |
| Pause/run the model · Step | Space · `.` | transport, bottom left |
| The toy's tool | C (A: place contact · B: keep baseline · C: recalibrate) | buttons |
| Explore ↔ Pilot (Toy C) | P (Esc leaves Pilot) | Explore / Pilot |

## 2 · Stage 0 — what was found before any edit

`HEAD` was `c605e3f` on `feature/bci-experiment`, working tree clean, identical to `origin`. Four branches, none newer.
Stack as in the specification: React 18.3.1, three 0.169.0, @react-three/fiber 8.17.10, drei 9.114.0, zustand 4.5.5,
Vite 5.4.9, TypeScript 5.6.3, Node's own test runner. Nothing was upgraded or added: **no new dependency**.

Baseline checks, run on 2026-11-25 before the first edit (outputs in `docs/evidence/neuroverse/baseline.txt`):
`npm run typecheck` clean · `npm test` 111 of 111 · `npm run check:rtl` all model-versus-RTL comparisons agree.

Machine: Apple M5 Ultra, macOS 27.0.1, 5120 × 2880 display, AC power, Chrome via Playwright (`channel: 'chrome'`).

**Keep / change / risk**

| Keep (untouched) | Change (added) | Risk carried |
|---|---|---|
| Atlas, picking, provenance, slice viewer | `src/world/`: controller, scene, HUD, three toys | The circuit is illustrative; a player may still read it as “the neurons of this region” — the breadcrumb, the model panel and the chooser say otherwise, but only a playtest shows whether that is understood |
| Experiment scene: motor chain, decoders, Decoder lab | A route `#/world` and a dock entry; “Enter the neural world” on the brain | Toy C bypasses the waveform chain for responsiveness (§5); labelled, and compared with the full chain by test |
| Chip studio, RTL trace Decoder scene, Research | `simulateHH` gained an optional step size (for the convergence test) and a fix (§7) | Pointer capture is granted only in a visible browser; the headless suite simulates the grant, the visible run checks the real one |
| `src/ui`, `src/lab`, `src/model`, `src/artifacts`, `src/state`, `src/App.tsx`, `chip/` — not written to | | Enjoyment, learning, biology: unknown (§0) |

The limitations the prompt asked to verify against `HEAD` all hold there: `TissueStage` uses orbit controls with
panning off and prescribed camera glides; the Experiment workspace is an eight-stage selector with a timed tour;
parameter edits recompute a whole session and stale replies are ignored rather than cancelled; `hh.ts` is a point
model; the extracellular rule is schematic; event-to-unit attribution is nearest-in-time; `residualSd` is an RMS
residual. Of these, this build fixed one thing in existing code (the Hodgkin–Huxley integration, §7) and worked
around the others by not building on them (§9).

## 3 · What was built

### One environment, one controller

A compact **representative circuit** (scene units µm, a 100 µm bar is drawn): the model's cells with generated shapes,
a shell of dimmer backdrop cells, a small vessel as a landmark, depth haze. It is declared a different model from the
human atlas in three places (breadcrumb chip, “What is this?”, chooser). No cortical folds appear in it.

The **observation rig** (`controller.ts`, `flight.ts`):

- velocity follows the keys with an 80 ms response (35 ms while braking) and is the exact solution of that response
  over each frame, so the path flown does not depend on the frame rate (unit-tested at 30/60/120 Hz);
- with no key held the rig stops — no drift; Shift brakes and allows a creep at 18 % speed;
- yaw and pitch only: no roll, no head bob, no motion blur, no gravity;
- one mode owns a drag (flight: look; focus: orbit; captured: none); a drag never selects; the click that captures the
  mouse selects nothing;
- Focus orbits a stable pivot at the object's centre from outside it and remembers the pose it left; Return restores
  **exactly** that pose; neither touches a model clock;
- anything within a few µm of the lens is faded (“display cutaway”), announced as a viewing aid, and cleared by Overview;
- held keys are forgotten on window blur, on a change of input context and when the mouse is released; nothing acts
  while a text or number field has the focus; a button clicked with the mouse does not keep the keyboard;
- guided glides last 260 ms, end at once on any input, and are skipped under “reduce motion”.

The rig moves an **observer**. It has no reference to any model; the only ways from the scene into a model are a
selection (`onPick`) and the explicit, logged actions a toy registers.

### Toy A — Instrument flight

*Question: is flying up to something and finding out what it is doing satisfying in itself?*

Ten LIF cells run continuously. One fires regularly and drives a seeded tree of six followers; three fire irregularly
and take no part. All ten look alike and the wiring is not drawn. You fly, **place a virtual contact** at the probe tip
(two contacts available), and its synthetic recording is computed from the contact's position in the model's own
coordinates. You can **silence** a cell (a logged command), **keep** a 60 ms window and compare it on the same axes,
read a cell's membrane variable (“Inspect V”, labelled a virtual state inspection), replay the last 200 ms exactly, and
finally say which cell leads — a right answer draws the wiring; “New field” gives a new leader.

*Failure signal to watch for:* you fly around once and have no reason to act again.

### Toy B — Time workshop

*Question: is it enjoyable to change one cause and discover why the result changes?*

Five LIF cells: two input cells converge on a target; one of them also drives an inhibitory cell whose connection onto
the target can be switched; the target drives a follower. You move the two stimulus times (drag on the timeline, or
type), switch any connection, change the target's leak, add a pulse at the playhead while paused. Every change is a new
immutable run with the previous one as its parent; **Compare** keeps a run as a dashed baseline on the same axes. The
3D scene and the timeline read the same run at the same playhead. One sentence under the transport says what happened
in the model's numbers (“B 4.0 ms after A: T reached threshold and fired at 17.6 ms; D followed at 21.0 ms.”). An
optional three-step challenge is checked by the model, and “New condition” gives the same circuit with new numbers and
asks for a prediction before showing the outcome.

What the model does, that you can find out: one input moves the target about 10 mV of the 16 mV it needs; two fire it
only within about ±10 ms; with the inhibitory path on, order matters (B must come first); a leakier target has a
narrower window.

*Failure signal:* it feels like a worksheet, or the cause of a change is unclear.

### Toy C — Decoder pilot

*Question: does getting a real control loop to work, breaking it and repairing it, make you want another go?*

In **Pilot** your movement keys are a labelled **synthetic intended velocity**. It drives the Experiment scene's 24-unit
population; spike counts at 8 contacts go through a fitted decoder; the decoder's output — and nothing else — moves the
cursor. A hollow ring shows where your intent alone would have taken it. In **Explore** the same keys fly the rig and
the intent is zero; a key is never delivered to both.

Calibration is an explicit job in a worker (progress, stoppable between steps): thresholds are re-estimated, three
decoders are fitted on 20 scripted reaches and scored on 10 others from a different seed. Three faults are offered
(more noise, three contacts lost, tuning drift) and two ways back that the model supports: **switch decoder** (nothing
refitted) or **recalibrate**. The table shows each decoder's held-out R² when fitted and now.

*Failure signal:* configuring dominates playing, or the decoder turns out not to matter.

## 4 · Changed files and what was reused

New (`src/world/`, about 3 950 lines, tests not counted): `flight.ts` (movement and aiming arithmetic) · `controller.ts` ·
`bindings.ts` · `runtime.ts` (per-frame arrays shared by a toy and the scene) · `morph.ts` and `fieldMaterial.ts` (cell
shapes and the tissue shader) · `WorldCanvas.tsx` · `WorldFrame.tsx` (HUD, transport, panels) · `WorldWorkspace.tsx`
(chooser) · `worldStore.ts` · `perf.ts` · `manifest.ts` · `pilotHost.ts` + `pilot.worker.ts` · `model/lif.ts`,
`circuits.ts`, `workshopRun.ts`, `fieldRun.ts`, `observe.ts`, `pilot.ts` · `toys/Flight.tsx`, `Workshop.tsx`,
`Pilot.tsx` · `world.css`.

Changed outside `src/world/` (about 80 lines in all, half of them one new test): `shell/shellStore.ts` and `shell/Root.tsx` (one more workspace; the
“/” finder key is left to the world) · `atlas/AtlasWorkspace.tsx` (one button) · `neuro/model/hh.ts` (§7) ·
`tests/hh.test.ts` · `tests/e2e/experiment.mjs` (one comparison, §7) · `package.json` (three scripts).

Reused as they are:

| Reused | For | Why not rewritten |
|---|---|---|
| `experiment/model/motor.ts` — `layoutUnits`, `unitRate`, `unitAmpUv`, constants | Toy C's population | It is the documented, tested population; a second one would drift from it |
| `experiment/model/decoders.ts` — ridge, Kalman, MLP, `score`, `runModel` | Toy C's decoders | Real fitted models with honest costs already exist |
| `experiment/model/dsp.ts`, `template.ts`, `neuro/model/hh.ts` | The contact's waveform; the filter gain used by Toy C's detector stand-in | So the surrogate's numbers come from the chain it stands in for |
| `experiment/model/rng.ts` | Seeded layout | — |
| React Three Fiber `Canvas`, drei `Html` | Scene and labels | Already in the lockfile |
| The Experiment scene itself | The auditable full chain behind Toy C (“Full chain →”) | Required by the specification |

Not reused, deliberately: `TissueStage` (its camera rig is the thing being replaced); three's `FlyControls` and
`PointerLockControls` from the installed 0.169 addons (their key handling and update code were inspected: `FlyControls`
rolls on Q/E, has a slow-speed modifier but no stopping response and no focus or return, and writes the camera itself;
`PointerLockControls` is look-only — meeting the control contract in 160 lines of tested arithmetic was quicker than
bending either); the kit's timeline (it assumes one stage selector).

Architecture, as four responsibilities:

1. **Scientific state** — `src/world/model/*`, pure, no DOM, no three.js. Toy C's runs in a worker.
2. **Commands and experiment state** — timestamped command logs in `fieldRun.ts`, `workshopRun.ts`, `pilot.ts`; toy
   stores hold the current run and its parent.
3. **Rendering, camera, instruments** — `controller.ts`, `WorldCanvas.tsx`, `WorldFrame.tsx`, the toys' canvases. They
   read `runtime.ts`; they never write model state.
4. **Reproducibility and provenance** — run exports with model revision, seed, time step, units and a fingerprint;
   `manifest.ts`; the “What is this?” panel.

No plug-in system, no new store library, no SharedArrayBuffer.

## 5 · Models and assets (from `src/world/manifest.ts`)

| Thing | Class | Units | Assumes | Leaves out | Checked by code |
|---|---|---|---|---|---|
| **LIF circuit** (`lif-cuba-exp-1`) — C·dV/dt = −g_L(V − E_L) + I; threshold → event → reset; exponential synaptic currents with a delay | published model | ms · mV · nF · µS · nA | 0.05 ms grid with the exact sub-threshold solution between grid points; spike time interpolated in the step; reset at the next grid point; 2 ms refractory period (added rule); order-independent event handling | spike shape, channels, dendrites, conduction, plasticity, fields; every number is a chosen parameter | closed forms for rest, decay, constant current, threshold time, PSP; refractoriness; order independence; refinement; replay; frame-rate independence |
| **Workshop circuit** (5 cells) | published model | as above | reference: τ 15 ms, 16 mV to threshold, 10 mV per input; variants within stated bounds and kept only if solvable | it is a diagram of temporal summation and feed-forward inhibition, not a circuit from any region | the window and its dependence on inhibition and leak |
| **Field circuit** (10 cells) | published model | as above | leader and wiring from a seed; followers follow one for one | inhibition, recurrence, any real microcircuit | driver/follower order, silencing, rewind, export |
| **Virtual contact** | synthetic observation | µV, µm | amplitude 120 µV × 30 µm ÷ distance (floor 15 µm); white noise 6 µV; detection at −4.5 σ | volume conduction, reference, tissue filtering, cell shape; detection is an inference | 1/distance from position; noise statistics; nothing before placement; camera-independence in the browser |
| **Pilot surrogate** (`pilot-surrogate-1`) | published model, feature-level | workspace units, spikes/s, µV | the Experiment's population and decoders; detection probability Φ((κ·a − θ)/σ); thresholds fixed at calibration | **waveforms, front end, ADC, band-pass, common reference and the sample-by-sample detector are bypassed**; no human-learning model | noise and threshold within 10 % of the chain; counts within ±30 %; linear R² within ±0.12 (criteria fixed first); decoder causality; separate seeds; replay |
| **Cell shapes, backdrop, vessel** | illustrative | scene µm | body positions are the models' coordinates (compressed in Toy C) | not reconstructions; not the cells of any atlas region; nothing is computed along them | — |
| **Your keys in Pilot** | hypothesis (a stand-in for intent) | — | eight directions, full speed or 45 % | a keyboard is not a model of intention; nothing reads a brain | — |
| **The three faults** | hypothesis | — | noise × 2.5, three contacts lost, a fixed seeded change of tuning | “tuning drift” models no particular cause | each fault's effect and what recalibration recovers |

Nothing in the toys is measured data or derived anatomy, and nothing is labelled as either. No external mesh, texture
or dataset was added: every shape is generated in the browser.

**How far the surrogate is from the chain it stands in for** (`tests/world-pilot.test.ts`, criteria written before the
numbers were looked at): detector noise 4.0 µV against the chain's 4.2–4.3; threshold 18.0 µV against 18.8–19.6; mean
counts per contact 4–21 % higher than the chain's (allowed: ±30 %); held-out R² of the linear decoder 0.63 against
0.69 (allowed: ±0.12). The Kalman filter differs by 0.08 and the 8-unit network by 0.12 — the network is at the edge of
the linear criterion and has no criterion of its own.

## 6 · Time, replay and saved runs

Three clocks: wall time, the playhead, and model time. Playback speed changes how fast the playhead moves through
model time and never the model's step (`ModelClock`). The camera keeps moving when a model is paused.

| Toy | Model time | Rewind is | A counterfactual is | Saved run |
|---|---|---|---|---|
| A | continuous, 25 model-ms per second by default | restore a checkpoint (kept every 10 ms) and replay the command log: the same spikes at the same times | a command issued while replaying: a new run id with the old one as parent, later history dropped | `hbci.world.field-run`: seed, revision, step, commands, contact placements, fingerprint |
| B | a 60 ms recording, 5 model-ms per second by default | moving the playhead inside an immutable recording | any changed cause: a new run with the previous as parent | `hbci.world.workshop-run`: recipe (model, revision, seed, integrator, dt, units, parameters, parent), commands, fingerprint |
| C | 50 ms bins in real time | not offered live; “Replay & verify” re-runs the whole session from its log in the worker and compares the cursor path | — | `hbci.world.pilot-run`: seed, revision, commands (calibrations, faults, decoder changes) and the intent in every bin |

“Save / replay” in each toy shows the file, and replays a pasted one by running the model again; it reports whether the
result's fingerprint matches. A file with a changed command is reported as not matching (tested).

Toy C's display shows each 50 ms bin as it arrives, one bin after it was computed; a spike flashes at its own time
within the bin, and the cursor is drawn on the straight line between two bins (it moves at constant velocity within a
bin, so that is the model's own path).

## 7 · What the checks found

**Unit tests: 141 of 141** (111 before; 30 new: 29 in `tests/world-*.test.ts`, one in `tests/hh.test.ts`).

**A defect in existing code, found by the convergence test the specification asked for.** `simulateHH` used
fourth-order Runge–Kutta but sampled the injected current at each stage's own time. On the step before the current
switches on, the last stage saw the new value, which made the whole integration first-order: against a refined
solution the membrane potential differed by 1.0, 0.51 and 0.26 mV at steps of 0.02, 0.01 and 0.005 ms (halving, not
sixteenth-ing), and spike times were 1.7 µs early at the app's step. Every stage of a step now sees the current of
that step. The same comparison gives 2.3 × 10⁻³, 1.2 × 10⁻⁴ and 7.6 × 10⁻⁶ mV, and spike times within 0.02 µs. An
independent integrator written in the test (forward Euler with exponential gate updates, 0.0005 ms) agrees on the
number of action potentials, their times within 0.02 ms and their peak within 0.3 mV. The old test named
“deterministic and converged” tested determinism only and is renamed.

What the fix changes elsewhere: the existing Neurons and Experiment scenes use this model for their spike shape. Every
spike moves 1.7 µs later, and the unit-peak spike template changes by at most 1.5 % of its peak, at one sample on its
steepest slope. All 111 earlier unit tests pass unchanged. In the Experiment scene a few threshold crossings move by
one 33 µs sample, which exposed a fragile comparison in `tests/e2e/experiment.mjs`: two three-decimal displays of the
same sample time (6.404 s and 6.405 s) were required to be equal, and a sample that falls on a half millisecond rounds
either way. The comparison now allows one unit of the last displayed digit. No number shown by the app was changed to
make a test pass.

**Browser test: 29 of 29** (`docs/evidence/neuroverse/e2e-report.txt`), in headless Chrome against the production
build. It found and led to fixes for: a button clicked with the mouse kept the keyboard, so Space pressed it again
instead of pausing the model; Esc in Pilot left Pilot before closing an open panel; a residual sub-µm drift after
releasing the keys; challenge steps being ticked before the challenge was opened; and a tracking readout
(a correlation) that could not see the constant push a decoder adds when contacts are lost — it is now an R².

One thing the headless suite cannot do: Chrome does not grant pointer capture without a visible window. There the
grant is simulated (the page is given the same signals the browser would give) and everything the page does with a
captured mouse is tested; the real grant is checked in the visible performance run (§8).

One thing it did not manage: stopping a calibration from the browser. The whole calibration takes about 80 ms on this
machine and finished before the Stop click could land. That a stopped calibration changes nothing is shown by the unit
test, which stops it between two of its steps.

**The earlier suites, re-run on this branch:** `tests/e2e/walkthrough.mjs` 27 of 27 and `tests/e2e/experiment.mjs`
17 of 17 (after the one comparison above was corrected; before it, 16 of 17).

**Toy C's two ways back, as measured in the browser with a scripted player** (a crude pilot; the final run): reference 8
targets in 12 s; with three contacts lost the linear decoder reached 2 (tracking R² −1.4); the Kalman filter, with
nothing refitted, 6 (R² 0.36); the linear decoder recalibrated on the remaining contacts, 8 (R² 0.69). The target
counts were the same in all four full runs of the suite; the tracking R² moved a little from run to run with the
script's timing (−1.4 to −1.7, 0.36 to 0.38, 0.60 to 0.70). More noise is
different: held-out R² 0.65 → −78 with the old thresholds → 0.22 after recalibration. Recalibration recovers part; the
rest was buried by the noise.

**Screen share.** At 1440 × 900 the 3D view takes 77 % (B) and 79 % (A, C) of the height; the instrument takes the
rest. The specification's “roughly four-fifths” is met to within three points there. In a 1024 × 768 browser pane it
is 72 % (B), 71 % (A) and about 70 % (C): the instrument's three columns narrow rather than stack, but its rows do not
shrink. Below 860 px wide the columns stack and the world gets less; no phone layout was designed.

## 8 · Performance

Measured on 2026-11-25 in a visible Chrome 158 window on the machine named in §2, on AC power, detail “high”, against
the production build (`docs/evidence/neuroverse/performance.txt`; reproduce with `npm run perf:neuroverse`). A scripted
player holds movement keys in turn, drags to look, and uses the toy every few seconds; keys and pointer are real input
events. One run; one machine.

| | Target (chosen, not a law) | 1920 × 1080 at 1 device pixel per CSS pixel, 60 s per toy | The same window at 2 (Retina: 3840 × 1756 canvas), 30 s per toy |
|---|---|---|---|
| Frame time, median | near 16.7 ms | 8.3 ms in all three toys (the display refreshes at about 120 Hz) | 8.3 ms |
| Frame time, p95 | ≤ 20 ms | 8.4–8.5 ms | 8.6–8.9 ms |
| Frame time, p99 | ≤ 33.3 ms | 9.1–9.2 ms | 9.1–9.3 ms |
| Worst frame | — | 9.5–13.5 ms | 9.4–11.5 ms |
| Frames over 100 ms (stalls), including while Toy C refits its decoders | none | 0 | 0 |
| Input event → next frame, p95 | ≤ 50 ms | 8.0 ms (median 7.2–7.4 ms) | 7.9–8.1 ms |

- **Response** is input event to the start of the next rendered frame. It is not an input-to-photon latency: the
  display's scan-out and the input device are not in it.
- **Agency within 10 s:** scene ready 0.46 s after a cold load and 0.21 s after a reload, from a local server; the rig
  answers the first key press at once.
- **A computed intervention within 150 ms:** a Time-workshop run takes about 0.6 ms to compute; Toy A's commands apply
  on the next model step; Toy C's calibration (about 80 ms in all) runs in a worker and caused no long frame.
- **Memory:** JS heap 48.3 MB after one round of the three toys and 48.7 MB after five more (no forced collection, so
  an upper bound on growth). GPU memory is not exposed by the browser and was not measured.
- **Payload:** the world's own chunks are about 140 kB of JavaScript (raw; it also shares three.js and the
  experiment models with the classic studio), 13 kB of CSS and a 25 kB worker; it downloads no mesh, texture or dataset.
- **Pointer capture, real grant:** with the Chrome window in front, the “Mouse look” button was granted the lock, the
  click that asked for it selected nothing, mouse movement turned the view, and L released it with held keys
  forgotten. A window that is not in front is refused by the browser; the app then says so and drag-to-look still works.
- **In the Claude desktop app's own browser pane** the capture request was **refused** when the button was clicked by
  automation (the app showed its “the browser did not hand over the mouse” notice; drag-to-look and the keys worked).
  Whether the pane grants it to a person's own click was not established. If it does not, open the same address in
  Chrome for captured mouse look.

Every target is met on this machine with a wide margin. That says little about a slower Mac, another browser, battery
power or a 60 Hz display, none of which was measured — and nothing about how it feels. The detail setting changes pixel
density and the number of backdrop cells; it never changes a model's time step or a recording's sample rate.

## 9 · Decision log

**Implemented facts** (true of the code on this branch)

- The world is a new route beside the classic studio; no classic scene was removed, reordered or restyled.
- The prototypes stay in the browser stack. Flight was never a browser limitation; nothing measured here asks for an
  engine migration, and WebGPU was not tried.
- Toy B is a seekable immutable recording; Toy A is a live run with checkpoints; Toy C steps in a worker. These are
  three scheduling contracts for three kinds of interaction, not one generic system.
- Toy C is a feature-level surrogate. The alternative — stepping the 30 kHz chain bin by bin — would have meant
  rewriting `simulateMotor` as an incremental model; the surrogate was the smaller, declared step, and the batch chain
  stays reachable from the toy.
- The wiring in Toy A is hidden until named; generator truth is available on demand and labelled as such.
- Research is not a destination inside the world: sources are in “What is this?”, on the thing they belong to. The
  classic dock still has its Research scene.
- Colours are never the only cue: a silenced cell is hatched and tagged; an inhibitory connection ends in a bar, an
  excitatory one in a bead; a lost contact is crossed and tagged; selection is a tag and a mark.

**Repository-reported, historical** (from earlier branches' evidence; not re-measured here unless stated)

- 111 unit tests, the 27-step walkthrough and the 17-step experiment test: **re-run on this branch, all pass**.
- 49 DOIs verified against Crossref on 2026-11-19: **not re-run**. No source entry was changed.
- The Experiment scene's ≈ 930 ms session time and the cinematic performance sample: **not re-run**.

**New measurements** (this build, this machine): §7 and §8, and the files under `docs/evidence/neuroverse/`.

**Unresolved hypotheses**

- That any of the three loops is enjoyable; that the combination is better than its parts.
- That a first-person rig is the right presence at the circuit scale; that the 80 ms response and six speed levels feel
  right; that a 34 µm probe tip reads as “my instrument”.
- That hiding the wiring makes Toy A an investigation rather than a guessing game.
- That the one-line sentence is enough explanation, and that the model panel is found when needed.
- That the illustrative circuit is not mistaken for the anatomy of the selected region.

**Debts recorded, not paid**

- The old Experiment scene still recomputes a whole session per edit and cannot cancel a stale job.
- `residualSd` in `decoders.ts` is still an RMS residual shown as “one standard deviation”; the toys show no
  uncertainty at all rather than build on it.
- Event-to-unit attribution in the Experiment scene is still nearest-in-time.
- The whole-brain view is as the cinematic rebuild left it; the atlas-to-circuit transition is a button and a sentence,
  not a cutaway.
- No LIF ↔ decoder coupling exists, and none is implied: Toys A/B and Toy C are different models in the same scenery.
- The Lindén et al. (LFPy) paper is cited as the reason the contact model is only a generator; its DOI was verified with
  Crossref on 2026-11-25, its text was not read in this build.

## 10 · Reading ledger for this build

| Source | Read | For |
|---|---|---|
| The three Neuroverse documents | In full | Scope and contracts |
| Neuronal Dynamics online, §1.3 | Opening; §1.3.1 with eq. 1.3–1.7; §1.3.3 and the start of §1.3.4 with eq. 1.12–1.18 | The LIF definition, the free solution, threshold and reset |
| Neuronal Dynamics online, §1.4 | Opening with eq. 1.31–1.32; the start of §1.4.1 | What the basic model leaves out (adaptation; no memory beyond the last spike) |
| three.js `FlyControls`, `PointerLockControls` (installed 0.169 addons) | Their key handling, update and lock/unlock code; not every line | Decided not to adapt them (§4) |
| This repository | `motor.ts`, `decoders.ts` (interfaces, scoring, linear fit), `session.ts`, `simClient.ts`, `sim.worker.ts`, `template.ts`, `rng.ts`, `hh.ts`, `TissueStage.tsx`, `Root.tsx`, `shellStore.ts`; the heads of the three e2e scripts | Reuse and limits |
| Lindén et al. 2014 | Not read here; DOI checked | Cited only as “why a forward model needs more” |
| The books of the source audit (B01–B28) | Not opened in this build | Their use is the specification's, with the specification's own reading levels |

No book was read cover to cover. No game named in the specification was played.

## 11 · What to do next

1. **Play** (stage 3): `docs/NEUROVERSE_PLAYTEST.md`, two sessions, different order. That decides which loop is kept.
2. Only then: one polished 5–10 minute journey around the winner (stage 4).
3. Before any stronger scientific claim: expert review of the model panel's text, and the debts in §9.

If a session ends here, the software runs as it is: `npm run dev`, `#/world`.
