# Hamiltonian Neuroverse — the integrated world

Date: 2026-11-25 · Branch `feature/neuroverse-world` (on top of the prototype checkpoint `6b33806` of
`feature/neuroverse-toys`) · nothing pushed, merged, published or deployed · one engineering agent; no sub-agents, no
second model, no paid or generative service, no new dependency.

This is the compact implementation and evidence record of the build that followed the three prototypes. The earlier
record, `docs/NEUROVERSE.md`, describes those prototypes and is kept as written.

## 0 · Where this stands

**Built and checked by code:** `#/world` opens on the whole brain and leads, by a reversible dive, into one block of
illustrative cortex that can be flown through. In it: a five-cell circuit with a recording probe (change one cause,
replay, compare with a baseline, undo), and an electrode array with a model population (a decoder moves a cursor;
break it; recover it two ways). One controller, one overlay, one dock. `150` unit tests, a 19-step browser test,
a performance sample in a visible window, and one continuous recording.

**Not established by anything here:**

| Question | Status |
|---|---|
| Is it enjoyable? Does it invite another go? | **Untested.** No person has played it. The build exists so that this can now be judged by playing. |
| Does it improve understanding, retention or transfer? | **Untested.** No learner data. |
| Are the models' biological claims sound? | **Unreviewed.** Code tests show that each model does what its description says, nothing more. A point-neuron circuit with chosen parameters is not a validated human cortical circuit. |
| Performance on any machine but this one | **Not measured.** |
| Photorealism | **Not claimed.** §4 lists what still differs from the reference still. |
| Touch, phone, sound | **Not built.** |

## 1 · Run it

```bash
export PATH="$HOME/.local/opt/node-v24.22.0-darwin-arm64/bin:$PATH"
cd ~/bci_studio
npm run dev          # → http://127.0.0.1:5180/#/world
```

| Check | Command |
|---|---|
| Types, all unit tests, model-versus-RTL checks | `npm run check` |
| The world, in a real Chrome (19 steps, about 2 minutes) | `npm run test:e2e:world` |
| Performance in a visible window (about 5 minutes; keep the window in front) | `npm run perf:world` |
| The recorded walkthrough | `npm run record:world` |
| The three prototypes (development aids at `#/world/dev`) | `npm run test:e2e:neuroverse` |

## 2 · What you can do in it

1. **Arrive.** The whole brain — one volunteer's MRI-derived surface with the atlas's own labels. Drag turns it, the
   wheel moves closer, hovering names the region under the pointer, a click selects it. A warm contour marks the
   left precentral gyrus.
2. **Enter.** A dive to that gyrus, a caption (*15 cm → 1 mm → 100 µm; the atlas ends at the surface; what follows is
   illustrative*), and you arrive from above in a block of tissue. The brain stays on screen as a small map; clicking it
   reverses the move.
3. **Explore.** W A S D and E Q fly, drag looks, the wheel glides along the line of sight, Shift brakes, F looks at the
   selection, R returns to the exact pose, M shows the whole block. Mouse capture (L) is offered; drag-to-look does
   everything it does.
4. **Notice.** Two input cells fire 12 ms apart; the cell they both reach, T, peaks 0.7 mV short of threshold and stays
   silent. The recording repeats in slow motion (×1/200).
5. **Change.** Select input B (in the scene or on the trace) and make it fire earlier. T fires; D follows.
6. **Compare.** The linked trace shows the run against the baseline on the same axes, the two one-input runs that
   explain the sum, and — on a separate lane in microvolts — what the probe beside T recorded. Undo, back to
   baseline, set as baseline, reset.
7. **Engineer.** Fly (or jump) to the electrode array. A statement says this is a different model. Take the controls:
   the movement keys become a synthetic intended velocity; 24 model units fire; 8 contacts count; a fitted decoder
   moves the cursor. Lose three contacts; recover by switching to the Kalman filter (nothing refitted), by
   recalibrating (refit), or by restoring the contacts.
8. **Return.** Back out to the brain; the experiment and the observer's pose are kept — also across a page reload.

A one-line guide follows what the player has actually done and never goes backwards; it can be hidden. Nothing is
locked and nothing ends in a score.

## 3 · The design decision, and what happened to each prototype

| Prototype | Kept | Dropped or changed |
|---|---|---|
| A · Instrument flight | The flight controller; the virtual contact's observation model (now the probe beside T) | The ten-cell "find the leader" game and free contact placement: its puzzle was the weakest mechanic and its field had no link to the other two. Its code and tests remain at `#/world/dev`. |
| B · Time workshop | The five-cell LIF circuit, run / replay / fingerprint, the timeline — now the central loop | The predict-first quiz and the three-step challenge card (the guide replaces them); "pulse at the playhead". T's time constant moved to the Inspect level. |
| C · Decoder pilot | The surrogate session in its worker, the faults, the three decoders, replay-and-verify | The abstract disc floating in the tissue: the cursor is now an instrument beside the view. Units are drawn at the population model's own offsets instead of a compressed layout. |

**Two models, one place, never joined.** The circuit is five cells; a direction needs a population. The array's 24
units are the Experiment scene's population model — a different model. They sit ~700 µm apart in the same block, a
statement is shown the first time the array is reached, the status line says which model is running, and only one
advances at a time (the other is drawn idle). What carries over is one rule: a contact counts a spike when its size at
the contact crosses a threshold set from the noise. Nothing computed in the circuit feeds the decoder.

**Membrane potential and electrode voltage are different things.** Inside a cell: millivolts, a model state. At the
probe: microvolts, a generated observation (each model spike adds one fixed waveform, sized 120 µV × 30 µm ÷ distance,
plus 6 µV of seeded noise). They share a time axis and nothing else, and are drawn on separate lanes with their units.
Cell positions were moved (they do not enter the dynamics) so that only T is close to the probe: 106 µV there, the
other four 14–16 µV, under the 27 µV threshold.

## 4 · The whole brain: diagnosis and what was changed

Compared with the supplied reference still (a soft, mauve, two-tone brain against a dark blue ground) the earlier
render was a single saturated pink with shallow-looking folds and plastic sparkle.

| Looked at | Found | Done |
|---|---|---|
| Geometry | 460 k triangles from the atlas subject's own MRI, smoothed 0.10 mm on average. Real folds are shallower and more irregular than a sculpted model's. | Kept unchanged — it is the anatomy, and region picking depends on it. |
| Normals | Stored as 8-bit, smooth. Enough for broad highlights; too coarse for a tight one. | Tight highlight removed; two broad satin lobes. |
| Fold shading | Occlusion is baked per vertex at low frequency; nothing marks the floor of a fold. | A concavity field computed from the mesh (`curvatureField`) draws the thin dark line along each fold and lifts the crowns. It shades; it does not move the surface. |
| Material | One saturated albedo did all the work. | Dusty-mauve albedo; colour now comes from light. |
| Lighting | Even, frontal. | A cool lavender key from the upper left and a warm magenta light from the right, as in the still; rig travels with the camera. |
| Camera | Smaller in the frame, with a dock, a mode bar and a measurement ring around it. | The brain spans 76 % of the view's height (measured by the browser test), with nothing around it but one action; the frame's edges are slightly blurred in CSS, the middle never. |

Still different from the still: no subsurface scattering, no cast shadows between folds, no depth of field on the
geometry, no cut skull or device model, and the warm light reaches further across the surface than in the still.
Region labels, picking and the atlas's provenance are untouched (`tests/specimen-assets.test.ts`, browser step 2).

The precentral gyrus is presented as what the atlas labels — a fold. The card says that primary motor cortex (area 4)
lies within it, mostly on the wall of the central sulcus, and that the atlas does not contain its border.

## 5 · Input: who owns the keyboard

One rule, shown on screen as a chip (*Keys: fly* / *Keys: your intent* / *Keys: this control*):

- The world's shortcuts act while the keyboard focus is on the page or on the tissue view.
- A slider, a field or a list that has the focus keeps every key, as controls do. Escape, or a press on the scene,
  hands the keyboard back.
- A button **pressed with the pointer does not take the focus** (the platform convention for command buttons), so the
  next Space still pauses the model. A button **reached with Tab** keeps the focus and Space presses it. Nothing is
  blurred after the fact.
- Taking the controls of the decoder task gives the movement keys to the intent and to nothing else: the observer's
  pose is bit-identical before and after (browser step 13). Escape or P gives them back.
- With the mouse captured, selection is through the centre mark; otherwise it is whatever is under the pointer. The
  click that asks for capture selects nothing. A body that the ray hits wins over a thin connection passing in front
  of it (`tests/world-flight.test.ts`).
- While the tissue is not on screen no key reaches the observer or a model.

## 6 · Time and causality

- **Three clocks.** Wall time (frames), presentation (model-ms per second; slow motion is stated as ×1/200), and
  scientific time (0.05 ms steps). A run is computed once from its causes; playback moves a playhead through it.
- **Replay is the same recording.** The button says *Replay the two inputs*; it recomputes nothing and nothing is
  random (browser step 9: same fingerprint, same run number, same probe events).
- **A comparison differs by declared causes only.** `changesBetween` lists every difference from the baseline; both
  runs start from the same state and the probe's noise is the same sample for sample (unit tests).
- **Why.** The explanation's numbers come from the run and from two counterfactual runs with one input each; they add
  up to the membrane potential exactly while T has not fired (unit test: residual < 0.001 mV).
- **Reset** restores causes, baseline, history, playback speed and playhead. **Undo** recomputes the earlier run and
  must reproduce its fingerprint.
- **The decoder task** runs in real time in 50 ms bins. The cursor moves by the decoder's own `base + Σ terms`
  (drawn tip to tail in the dock); a session replays from its log of commands and key states to the identical path.

## 7 · Files

New (all under `src/world/`): `journey/Journey.tsx` (composition, transitions, ownership) · `journey/BrainStage.tsx`,
`journey/brainLook.ts` (the whole brain) · `journey/CortexStage.tsx` (the block: cells, probe, array) ·
`journey/circuitLab.ts`, `journey/decoderTask.ts` (the two engines) · `journey/Dock.tsx`, `journey/Hud.tsx`,
`journey/journeyStore.ts`, `journey/journey.css` · `model/layout.ts`, `model/journey.ts` (pure, unit-tested).

Changed: `controller.ts` (ownership, bounds, wheel glide, scaled camera glides) · `flight.ts` (recording sites; the
body-over-connection rule) · `fieldMaterial.ts`, `morph.ts`, `WorldCanvas.tsx` (haze that reads as depth and "up",
relief, soft branch tips, fibres and specks, spike overlay, block scenery) · `model/circuits.ts` (cell positions only) ·
`model/pilot.ts` (the decoder's own terms in each snapshot) · `manifest.ts` · `WorldWorkspace.tsx`, `worldStore.ts`,
`shell/shellStore.ts` (routes) · `perf.ts`.

Reused unchanged: the LIF model and its tests, the observation model, the pilot surrogate and worker, the atlas loader
and assets, every classic scene. Nothing under `src/ui`, `src/lab`, `src/model`, `src/artifacts`, `src/state`,
`src/App.tsx` or `chip/` was written to.

Tests: `tests/world-journey.test.ts` (8) · one more in `tests/world-flight.test.ts` · `tests/world-manifest.test.ts`
updated · `tests/e2e/world.mjs` (19 steps) · `tests/e2e/world-perf.mjs` · `tests/e2e/world-walkthrough.mjs`.

## 8 · Verification

All of the following were run on the final code of this branch (outputs in `docs/evidence/world/checks.txt`).

| Check | Result |
|---|---|
| Typecheck | clean |
| Unit tests | 150 of 150 (9 new: 8 in `world-journey`, 1 in `world-flight`; 141 before) |
| Model-versus-RTL checks | pass (unchanged code) |
| Production build | builds |
| `tests/e2e/world.mjs` — the world | 19 of 19 |
| `tests/e2e/neuroverse.mjs` — the three prototypes | 29 of 29 (two steps updated for the new route) |
| `tests/e2e/walkthrough.mjs` — classic studio | 27 of 27 |
| `tests/e2e/experiment.mjs` — Experiment scene | 17 of 17 |

What the world's browser test establishes, step by step (`docs/evidence/world/e2e-report.txt`):

- **Entrance.** `#/world` shows the brain and one action; no chooser; 37 words of text on the page; nothing scrolls.
- **Whole brain.** Drag and arrow keys turn it; hover and click resolve atlas structures; the precentral-gyrus card
  says the atlas has no area-4 border; another region offers no circuit.
- **Going in and coming back.** The caption appears; the tissue view takes 92 % of the window's height at the Observe
  level; the brain becomes the map; the trip out and back, and a page reload, keep the history (same fingerprint)
  and the observer's pose.
- **Flight.** W for half a second moves ~70 µm and the observer stops dead; a drag turns the view and selects
  nothing; the wheel glides ~60 µm and stops; the run's fingerprint is unchanged by any of it.
- **Capture.** The capturing click selects nothing; the centre mark then selects T with the pointer elsewhere;
  release forgets held keys. (Headless Chrome refuses capture; the grant is simulated there and real in §9.)
- **Pause.** Model time stands still while the observer moves 54 µm; Step is exactly 0.25 ms.
- **One cause.** B 22 → 14 ms is the only declared change; T fires at 17.61 ms and D at 21.04 ms; the page's
  fingerprint equals a run computed separately in the test process; the "Why" numbers are the model's one-input runs;
  in the scene T has just flashed and an event is travelling T → D at that model time.
- **Replay, compare, undo, reset.** Replay keeps fingerprint, run number and probe events; with inhibition on the same
  timing fails (independent run agrees); Undo, Back to baseline and Reset each give the expected fingerprint.
- **Probe.** Selected as a recording site; labelled a synthetic observation in µV; its detected events equal an
  independent computation; T's spike is 109 µV against a 27 µV threshold.
- **Ownership.** As §5 states, each case exercised.
- **The array.** The statement is shown first and the task waits for it; the circuit is frozen and untouched; then
  piloting moves the cursor by `base + Σ terms` (to 1e-9) and the observer not at all.
- **Break and recover** (scripted player, 12 s each, one session): 8 targets → 2 with three contacts lost → 6 with
  the Kalman filter, nothing refitted → 8 with the linear decoder after recalibration; the session replays from its
  log to the identical cursor path.
- **Small windows.** At 1280 × 720 and 1024 × 768 every essential control is on screen and uncovered, nothing
  scrolls, and the 3D view has 90–91 % of the height (71–73 % with the trace open).
- **Studio and prototypes** still open; **reduced motion** makes going in a cut (0.9 s).

Defects found by these checks and fixed on the way: Escape did not release a captured mouse when the key reached the
page (found by the visible-window run) · a thin connection passing in front of a cell body stole the selection (found
by the capture step) · navigating to `#/world` from a prototype rewrote the address to the chooser · the camera was
composed for the small map when coming back out · the first-visit guide could tick "explore" from the arrival glide.

## 9 · Performance

Visible Chrome 158 on this machine (Apple M5 Ultra, macOS 27.0.1, mains power), production build, 1920 × 1080 window,
detail "high", scripted player with real input events. Full table: `docs/evidence/world/performance.txt`.

| Segment | DPR 1 (1920 × 1080 canvas), 30 s | DPR 2 (3840 × 2160 canvas), 15 s |
|---|---|---|
| Whole brain, turning and hovering | median 8.3 ms · p99 9.1 · worst 9.4 | median 8.3 · p99 10.2 · worst 10.4 |
| Going in (dive, cross-fade, arrival) | median 8.3 · p99 9.2 · worst 25.1 | median 8.3 · p99 10.2 · worst 33.4 |
| Circuit: flight, replay, new runs, trace open | median 8.3 · p99 9.2 · worst 9.4 | median 8.3 · p99 10.1 · worst 10.3 |
| Array: decoder task, fault, recalibration | median 8.3 · p99 9.2 · worst 9.5 | median 8.3 · p99 10.3 · worst 10.4 |

- **Read the median correctly:** this display refreshes at 120 Hz, so 8.3 ms is the display's ceiling, not a
  measure of spare capacity. What can be said is that the 60 Hz target (16.7 ms) was missed by 1 frame at DPR 1 and
  by 2 at DPR 2, all during the going-in transition (first frames of the tissue view), and no frame took longer
  than 33.4 ms.
- **Main-thread work** per frame (scripts and draw-call submission, all canvases): p95 0.2–0.6 ms, p99 ≤ 0.7 ms — a
  few percent of a 60 Hz frame. GPU time cannot be read from inside a page and is not reported.
- **Response** (input event → next rendered frame; not input-to-photon): median 7.3 ms, p95 8.1–8.8 ms while flying.
- **Loading:** brain on screen 0.56 s cold, 0.26 s warm, from a local server. Enter → flyable tissue 3.0 s, of which
  about 2.5 s is the authored dive.
- **Memory:** JS heap 67.3 MB after one trip in and out, 66.8 MB after six more.
- **Pointer capture** (real grant, window in front): granted by the "Mouse look" button; that click selected
  nothing; the mouse turned the view; Escape released it and held keys were forgotten.
- **Adaptive detail:** the world drops its detail setting (high → balanced → low; pixel density and scenery only) when
  more than half of 150 consecutive frames exceed 22.5 ms. It never triggered here, so the fallback itself is
  **untested on a machine that needs it**.
- One of the three times this script was run it stopped before measuring: the Enter button was not found within 30 s
  after the brain segment. I could not reproduce it in two further runs and did not find the cause.

Not measured: any other computer, phone or tablet, another browser, battery power, a 60 Hz display, GPU time or memory.

## 10 · Limits, and the next bottleneck

- **The route has been played by scripts only.** Movement feel, the pacing of the guide, and whether the timing
  experiment is satisfying are exactly the things a script cannot judge.
- **Mouse capture in the Claude app's browser pane** was refused when requested there earlier; the app says so and
  drag-to-look does the same job. Chrome grants it (§9).
- **One region can be entered.** Every other region is named and selectable and says that it has no circuit.
- **The tissue is generated, not reconstructed.** Shapes are procedural; no morphology dataset was added (that would
  need a licence and provenance review and, if large, your permission to download).
- **Small windows.** At 1024 × 768 with the trace open the 3D view has 71 % of the height (91 % with it closed).
- **The chip is reachable, not integrated.** The dock's chain strip and the Inspect panel lead to the Experiment,
  Signal, Chip and Decoder scenes; the world itself does not open the chip.
- **No sound.**

**Next bottleneck: the tissue's visual depth at close range.** The whole brain now holds up to the reference; the
micro scene is clearer and deeper than the prototypes' but its cells are still smooth generated tubes under a single
shader, with no shadows between them. The next step that would change how it feels is either licensed reconstructed
morphologies (provenance review first) or a shadowed, layered lighting pass — after you have flown it and said what
feels wrong.

## 11 · Reading ledger for this build

No new source was read for this build. Scientific statements on screen reuse wording already recorded with its
reading level: the region card's sentence on area 4 from `src/experiment/content/dossiers.ts` (abstract-level
sources listed there); the LIF model from Gerstner et al., *Neuronal Dynamics* §1.3–1.4 (sections read earlier, listed
in `src/world/manifest.ts`); the tuning rule from Georgopoulos 1982 and Moran & Schwartz 1999 (abstracts). The
reference still was used for lighting, material and composition only.
