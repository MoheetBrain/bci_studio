# Hamiltonian Neuroverse — embodied exploration and spatial engineering

Date: 2026-11-25 · Branch `feature/neuroverse-embodied`, cut from `feature/neuroverse-world` @ `3786e0d` · committed
locally; **not pushed, no pull request, nothing merged, published or deployed** · one engineering agent; no sub-agents,
no second model, no paid or generative service, **no new dependency**.

This is the record of the build that followed `docs/WORLD.md`. That document describes the integrated world as it
was (an unseen observer, one fixed probe) and is kept as written; where the two differ, this one is current.

## 0 · Where this stands

**Built and checked by code.** Inside the tissue the player is now a thing in the scene — a small research craft with
its own position and aim, which the keys fly and the camera follows (or sits in). Everything that is drawn as a thing
answers to the pointer as that thing: aim at any branch and the whole neuron lights and can be selected, with the
part named. One neuron in the block is a real one: a reconstructed human cell from the H01 release, shown as
structure with its source and licence, and with no model attached. The single fixed probe is gone; in its place are
two recording contacts, **P1** and **P2**, that the player takes in hand, puts down, drags or steps to an exact
place, and leaves behind — and they are still there after flying away, after going out to the brain, and after a
reload. 157 unit tests, a 28-step browser test, three regression suites, a performance sample and one continuous
recording (§7, §8).

**Not established by anything here.**

| Question | Status |
|---|---|
| Is flying the craft pleasant? Is placing contacts satisfying? | **Untested.** No person has played it. |
| Does anyone understand recording better afterwards? | **Untested.** No learner data. |
| Are the models' biological claims sound? | **Unreviewed.** As before: a point-neuron circuit with chosen parameters, and a declared 1/distance observation rule that is not a volume-conductor calculation. |
| Is the reconstructed neuron representative of the tissue entered? | **No, and it does not say so.** It is temporal cortex; the journey enters the precentral gyrus. It is an exemplar of real morphology. |
| Performance on any machine but this one | **Not measured.** |
| Photorealism | **Not claimed.** Materials are stylised; no membrane texture is in the data and none was invented. |
| Touch, phone, gamepad, sound, collisions with tissue | **Not built.** |

## 1 · Run it

```bash
cd ~/bci_studio
export PATH="$HOME/.local/opt/node-v24.22.0-darwin-arm64/bin:$PATH"
npm run dev                 # http://127.0.0.1:5180/#/world
npm test                    # 157 unit tests
npm run test:e2e:world      # production build, then the 28-step browser test
npm run perf:world          # production build, then the performance sample (opens a visible Chrome window)
npm run record:world        # production build, then the continuous walkthrough recording
node tools/morph/build-h01-exemplar.mjs   # re-derive the reconstructed neuron from the H01 archive (network; ~0.8 MB)
```

## 2 · The first minute, as built

1. **Arrive.** After the dive the craft comes down beside a large neuron; the guide says the craft is you and which
   keys fly it. The five model cells, the vessel that forks under them and — far off — the array are in view.
2. **Fly.** `W A S D`, `E`/`Q`, drag to look (or `L` for mouse look), `Shift` to brake, wheel for a push along the
   line of sight. `V` looks out of the craft instead of following it.
3. **Point.** Whatever is under the pointer (or the centre mark) lights up whole and is named beside the pointer with
   the part aimed at. Click selects. Selecting does not stop the flying.
4. **Change a cause where it is.** Select input cell B at the circuit, make it fire 8 ms earlier, watch T fire.
   Connections of the selected cell are listed on its card and can be followed.
5. **Place.** Take P1 (`C`, or the Contacts row), aim: a ghost shows where it would go and what it would hear there;
   it snaps to just outside whatever is aimed at, or sits at arm's reach in open space. Click puts it down. Then P2.
6. **Move.** Keep the layout as the baseline. Drag one of P1's three arrows, or step it "nearer to T" by 1, 5 or
   20 µm. P1's trace changes against its baseline; P2's does not; the sentence says the circuit's spikes are the same
   ones.
7. **Leave and return.** Fly away, go out to the brain, come back, reload: the contacts are where they were put and
   the craft returns to where it was.
8. **The rest is still there.** The anatomical map (bottom left), the overview (`M`), the electrode array and
   Decoder Pilot, and the classic studio behind "Studio".

## 3 · The player, the camera and who owns the keys

- **The craft is an entity.** `controller.s` is its position and aim; `controller.body` is its drawn attitude, which
  turns towards the aim with a short delay and leans into its own movement; `controller.cam` is the camera, a
  different pose that eases towards "behind and above the craft" (third person), "in the craft" (first person) or an
  orbit around something (Inspect). The craft is about 17 µm long: the size of a cell body. It is a navigation
  instrument of the application — it records nothing and touches nothing — and the manifest says so (`craft`).
- **Nothing snaps.** A move of the camera to somewhere else, and a journey the craft makes by itself ("Go to"), are
  critically damped: they start from the speed they have and arrive without overshoot. A movement key interrupts
  either from where things are: the journey stops where the craft is (keeping its speed), and Inspect hands back to
  flying with the camera coming back continuously. With "Reduce motion" on, these are cuts.
- **The camera is kept out of cell bodies** by shortening its boom, and geometry right in front of the lens fades (a
  display cutaway, announced as such). There are no collisions: the craft passes through what is drawn. That is a
  stated limit, not physics.
- **Three input modes, shown on one line** under the status bar, and nothing else changes who owns the keys:

  | Mode | The movement keys | Entered by | Left by |
  |---|---|---|---|
  | **Explore** | fly the craft | default | — |
  | **Inspect** | (the first one returns to Explore) — drag orbits | `F` / "Look at it", Overview | a movement key, `R`, Escape |
  | **Decoder Pilot** | are the intended velocity; the craft holds still | "Take the controls" / `P` at the array | Escape, `P` |

  A slider, list or field that has the keyboard focus keeps the keys until Escape or a click on the scene, and the
  line says so. **Selecting something is not a mode**, and neither is holding a contact in hand: the craft still
  flies. Escape undoes the most momentary thing first: a drag in progress, a contact in hand, the captured mouse, a
  focused control, an open panel, Decoder Pilot, Inspect, Isolate, the selection.

## 4 · Pointing at things

Each part of the scene registers picking stand-ins for what it draws (`pickRegistry.ts`): a sphere for a cell body
and a capsule for every stretch of every branch, built from the same centre lines and calibres as the meshes
(`morph.ts`). `pickBody` (`flight.ts`) returns the nearest exact intersection along the aim; if nothing at all is hit,
the thing passed within about five pixels; a manipulation handle wins over everything; a declared connection in front
of a body that looks clearly wider gives way to the body. The craft is not in the list, so it can never be in the
way of the aim.

Cost was measured before choosing a structure: one bounding sphere per object, plus bounding spheres over runs of 48
capsules for objects with more than 96, was enough (§7: a fraction of a millisecond per test among 234 objects, the
largest with 12,686 capsules). No tree was built.

What answers, and what it says:

| Thing | Kind | Its card |
|---|---|---|
| Five circuit cells | model cell | membrane potential at the playhead, its cause controls, its declared connections; "the shape is drawn; the model is a point neuron" |
| 24 population units | model cell (another model) | tuning, size at its contact; "not one of the five, not connected to them" |
| Context neurons | scenery | "No dynamic model is attached": no potential, no trace, nothing plotted |
| The reconstructed neuron | published structure | what it is, where it is from, licence, what was changed; "No dynamic model is attached" |
| Connections | declared, of the model | sign, current, delay, on/off, and the cell at each end |
| P1, P2 | recording contacts | §5 |
| Array contacts | the decoder's | rate, threshold; "fixed in place, and not P1 or P2" |
| The vessel | landmark | "drawn, not measured; no flow" |

**Tissue, readable or dense.** The exploration view leaves out most cells and nearly all fibres so that one can fly
and see, and says so on screen: "Thinned so you can fly: the gaps are not in tissue." **Denser** draws several
hundred more context cells (still far sparser than tissue; none has a model). **Isolate** thins out everything but the
selected neuron. All three are display choices and the test checks that no model changes through them.

## 5 · The reconstructed neuron (H01)

Investigated from `https://h01-release.storage.googleapis.com/data.html` and the Neuroglancer repository before
anything was imported.

- **Licence.** The data page states: "All released datasets are licensed under a Creative Commons Attribution 4.0
  License" (read 2026-11-25). Attribution: Shapson-Coe A, Januszewski M, Berger DR, et al. *A petavoxel fragment of
  human cerebral cortex reconstructed at nanoscale resolution.* Science 384, eadk4858 (2024),
  doi:10.1126/science.adk4858. The attribution, the licence and a note of the changes are in the file itself, on the
  neuron's card in the world, in `docs/LICENCES.md` and in `THIRD_PARTY_NOTICES.md`.
- **What the release offers.** The EM volume, the segmentation and meshes are Neuroglancer "precomputed" volumes of
  hundreds of terabytes; the "104 proofread cells" are also given as SWC skeletons in one 59.8 MB zip (3,327 entries,
  `<segment id>.<n>.swc`). The skeletons were chosen: they are small, they carry calibre and compartment labels, and
  a tube mesh built from them is light enough to draw with everything else.
- **What was downloaded.** The zip's directory and **one entry**, by HTTP range requests: `2252715458.0.swc`
  (0.81 MB of the archive; SHA-256 `f706f201…f8839` recorded in the file). Neuroglancer was read for the formats and
  not cloned, vendored or embedded.
- **Coordinates, as read from the data.** SWC columns `id type x y z radius parent`; x and y in 32 nm voxels, z in
  33 nm sections, radius in nm (the volume's `info` gives 128,973 × 89,100 × 5,293 voxels at 32 × 32 × 33 nm). Type
  codes as they occur in this file: 3 cell body, 5 axon initial segment, 0 axon, 1 dendrite, −1 unlabelled — the
  release's automatic subcompartment classes, not verified here; unlabelled nodes take the label of the nearest
  labelled ancestor.
- **The cell.** The release's segment properties tag `2252715458` as `L2, pyramidal, neuron`. Human temporal cortex,
  removed at surgery; a slab about 175 µm thick, so branches end where they left it.
- **What the tool does** (`tools/morph/build-h01-exemplar.mjs`): converts to micrometres; puts the origin at the cell
  body and rotates so that +y points from the body towards the mean position of the dendrites within the section
  plane (a display choice; the release's layer annotation was not used); merges the nodes inside the cell body;
  simplifies each unbranched stretch to within 0.18 µm. 35,345 nodes → 12,687; 4,617 branch ends; 8.78 mm of dendrite
  and 0.96 mm of axon; 467 kB of JSON.
- **How it is drawn.** Tubes with the data's own radii (twigs thinner than 0.24 µm are drawn at 0.24 µm so that they
  can be seen), a sphere of the file's own body radius, the same material as the other cells in a paler tint.
- **What it is not.** Not the precentral gyrus, not the atlas volunteer, not wired to any model cell, and no
  electrical model runs in it. No cell type beyond the release's own tags, no connectivity and no activity is shown
  for it. Nothing about membrane texture was invented: the surface is a smooth tube.

## 6 · Recording contacts P1 and P2

**One authoritative state.** Where each contact is, in the circuit's own coordinates (µm), is part of the experiment:
`Lab.contacts` in `model/journey.ts`, beside the circuit's causes and the seed of the observation noise. The scene
reads it through `modelToScene`; a pointer or an arrow writes it through `sceneToModel`. Here the two are the same
numbers, and the two functions mark every place where a position crosses from model to picture or back.

**What a contact records** is the existing synthetic observation model (`model/observe.ts`), unchanged:
`y(t) = Σ_cells a(d) · Σ_spikes h(t − t_spike) + noise(seed, contact, sample)`, `a(d) = 120 µV × 30 µm ÷ max(d, 15 µm)`.
P1 and P2 share the seed and have separate noise streams. So:

- moving a contact changes that contact's recording and nothing else — the circuit's run is the same object before
  and after (the tests compare the fingerprint and every spike time);
- under the same seed the noise at a contact is the same before and after a move: what differs is the spikes' part;
- the craft's and the camera's poses are not arguments of anything (the saved experiment has no field for them);
- at zero distance from a cell the 15 µm floor applies (240 µV; a floor that only avoids dividing by zero); asked to
  go outside the block, a contact stops at its edge. Every sample stays finite.

**Placing and moving.** In hand, a contact is previewed where it would go, with a line from the craft that shows how
deep that is and a label with the nearest model cell, the distance and the size its spike would have there (and
whether that cell fires in this run at all). It lands 6 µm outside whatever is aimed at, or 58 µm ahead of the craft
in open space; "Put it ahead of the craft" does the same without a pointer. A placed contact that is selected shows
three arrows along the block's axes (the vertical one is "towards the surface / deeper"). Dragging an arrow slides
the contact along that arrow's visible line — the point of the line nearest to the aim — so there is no hidden plane
to guess. The card moves it by exact steps along the axes or towards and away from a chosen cell.

**History.** Placing, moving (a whole drag) or removing a contact is one step. Undo and Redo walk the same history as
changes of cause. The baseline is a circuit configuration **and** a contact layout under the same seed; "Back to
baseline" restores both as one undoable step; Reset is the experiment as found (no contact placed). None of them moves
the craft — the buttons say so.

**Traces.** The dock shows P1 and P2 on the same time axis as the membrane potential and the spikes, each against
its recording in the baseline; the card lists, per cell, the distance, the size of its spike at the contact, how often
it fired in this run and how many crossings were counted from it.

**Not the decoder's.** The array's eight contacts belong to the population model and are fixed. P1 and P2 cannot be
taken in hand at the array, and moving them changes nothing of the decoder's calibration, thresholds or conditions
(tested).

**What is saved** (`model/saved.ts`, key `hbci.world.journey.v2`): the experiment (every step's causes and contact
layout, the baseline, the seed), and separately the craft's pose, the view, the tissue setting and the route's
progress. A save of the previous version (`…v1`: one fixed probe, no contacts in the history) is read: its
experiment is kept, with no contact placed. Anything unreadable gives the defaults.

## 7 · Verification

All on this machine, on the committed code. Reports: `docs/evidence/world/`.

| Check | Result |
|---|---|
| `npm test` | **157 of 157** (7 new in `tests/world-embodied.test.ts`) |
| `tsc -b` | clean |
| `tests/e2e/world.mjs` (production build, headless Chrome 1440 × 900) | **28 of 28** steps: the 19 of the integrated world, updated, and 9 new ones |
| Prototypes `tests/e2e/neuroverse.mjs` | 29 of 29 |
| Classic studio `tests/e2e/walkthrough.mjs` | 27 of 27 |
| Experiment `tests/e2e/experiment.mjs` | 17 of 17 |

What the new steps establish, against the brief's acceptance list:

| Asked for | Where it is checked |
|---|---|
| The craft translates and turns with the camera following | step 20: 24 samples of craft and camera while flying and turning; largest step between samples 8 µm; camera 67–70 µm from the craft throughout. Recording: §8 |
| View switching, focus, return and interruptions preserve the pose | step 21 (first person: identical pose; Inspect: craft does not move; a movement key and a second command interrupt from the present position); step 6 |
| Input still works after selecting | step 22 (with a branch of T selected, `W` flies); step 24 (with a contact in hand, too) |
| Text/slider input and decoder control do not leak into flight | steps 11, 13 and 27 (in Decoder Pilot the craft does not move by 1e-9 µm) |
| Capture refused leaves an alternative | step 28: with capture refused, a notice says so and dragging still turns the view; step 5: behaviour once capture is given (simulated). **A real grant was not obtained in this build's performance run** — see §8 |
| Body and several branches select the same neuron from several viewpoints | step 22 (T: 21 of 21 branch points from the front, 21 of 21 from behind and above); step 23 (the reconstructed neuron); unit test "pointing" |
| Context cells are honest | step 22: "No dynamic model is attached", no potential, no trace |
| Occlusion and the player's body do not mis-target | step 22: the highlight always equals the nearest thing the ray test finds; the craft is not pickable; unit test |
| P1's samples match the observation function at its new position; P2 and all spike times unchanged | step 25: all 1,201 samples of P1 equal an independent `probeRecording` in the test process to 1e-4 µV; P2 identical; spikes identical; unit test "a contact observes" |
| Camera-only movement changes neither recording | step 25 |
| Rendered contacts and model coordinates agree | step 24: the contact's label is within 6 px of the projection of its model position; the card prints the same coordinates |
| Pause / step / replay synchronised | step 25 (the card shows the recording's sample at the playhead; Step is 0.25 ms); steps 7 and 9 |
| Boundary and near-zero cases finite | step 25 and unit test |
| Undo restores placement and move | step 25 (a drag is one step); unit test "history" |
| Reload restores contacts and configuration | step 26 (also out to the brain and back; also a version-1 save) |
| Five-cell and decoder models separate | step 27; steps 12–15 |
| Quality levels keep interaction reliable | step 22 (pointing at low detail) |

## 8 · Performance and the recording

One run on this machine (Apple M5 Ultra, macOS 27.0.1, Chrome 158, mains power), production build, a visible
1920 × 1080 window, at device pixel ratio 1 and 2. Full sample: `docs/evidence/world/performance.txt`.

| Segment | Frame interval median / p99 / worst | Main-thread work p95 | One pointing test, median / p99 |
|---|---|---|---|
| First minute (fly beside the reconstructed neuron, point along its branches, both views) | 8.3 / 10.3 / 10.4 ms | 0.8 ms | 0.1 / 0.3 ms among 234 things |
| Close approach to its body | 8.3 / 10.4 / 10.5 ms | 0.8 ms | 0.1 / 0.3 ms |
| Circuit (replays, new runs, a contact moved every few seconds, traces open) | 8.3 / 10.4 / 10.4 ms | 0.7 ms | 0.1 / 0.2 ms |
| Array (decoder task, fault, recalibration) | 8.3 / 10.4 / 10.5 ms | 0.4 ms | — |
| Going in | 8.3 / 10.3 / 25.1 ms (one 40 ms frame at pixel ratio 2) | 0.7 ms | — |

- 8.3 ms is this display's refresh interval (120 Hz): the page kept up with the display in every segment; that is a
  ceiling, not a measure of what is to spare. Main-thread work is under a millisecond a frame; GPU time cannot be
  read from a page.
- Memory: JS heap 70.0 MB after one trip out and in, 73.4 MB after six more (+3.4 MB, nothing forced). GPU memory
  is not exposed.
- Payload: the world's own chunk 161 kB (+ 87 kB shared with the prototypes); the reconstructed neuron 467 kB of
  JSON; nothing else is downloaded for the tissue.
- **Mouse capture: the real grant was not obtained in this run.** Chrome refused with `WrongDocumentError` because the
  automated window was not the machine's active window. The request code is unchanged from the previous build (whose
  run was granted), the refusal path and the simulated grant are tested, but a real grant on this build is
  unconfirmed until someone presses `L` in their own Chrome.

**The recording** is `docs/evidence/world/video/world-walkthrough.mp4`: one take, 2 min 50 s, 1280 × 800, of the
production build — frames from the browser's own screencast joined untouched by ffmpeg, a ring drawn where the
pointer is. In order: the brain and the way in → the craft's arrival → flying, looking, first person and back →
pointing along branches of the reconstructed neuron and selecting it → Inspect, isolate, tissue back, return → the
craft flies itself to the circuit; one replay → input cell B selected in the scene and made 8 ms earlier; T fires →
P1 taken, previewed and put down beside T; P2 in open space → the layout kept as baseline → P1 dragged by its arrow,
then stepped nearer to T → undo, undo, redo, redo → flying away; overview; back → the array, the declaration, Decoder
Pilot, Escape, flying again → out to the brain and back in → a reload, back in, and P1 inspected where it was left.
It shows that these work together. It is not evidence of frame rate, and not evidence that any of it is enjoyable.

## 9 · Limits, honestly

- **Nobody has played it.** Whether the craft feels good to fly, whether the follow distance is right, whether the
  arrows are easy to grab — all of that is judged by code here, and code cannot judge it.
- **The craft passes through tissue.** No collision, no avoidance of branches; only the camera avoids cell bodies.
- **The observation rule is the declared 1/distance generator**, with a fixed waveform and white noise. It is not a
  volume-conductor model, has no reference electrode, and does not depend on cell shape. Moving a contact shows how
  *that rule* behaves.
- **A contact near T hears nothing until T fires.** In the circuit as found, T stays below threshold; the preview and
  the sentence say "does not fire in this run", but a player who places contacts first sees two flat noise traces.
- **Drag arrows grab generously** (about 20 px) and win over everything while a contact is selected, so a look-drag
  that starts on an arrow moves the contact. It is one undoable step and the contact visibly moves, but it can
  surprise.
- **The reconstructed neuron is one cell from another cortical area.** It makes the scene more truthful about what a
  neuron looks like and less truthful, if misread, about what is under the precentral gyrus. Every label says which.
- **Its compartment labels are the dataset's automatic ones**, carried along branches by this build's tool.
- **The movement panel is tall.** In short windows the on-screen pad, the horizon gauge and the tissue note are
  hidden (the keys, `V` and the cards cover the same functions).
- **Performance was measured on one machine** (see the report for which), in Chrome, on mains power.
- **Mouse look in a real window** depends on the browser granting pointer capture; when it does not, dragging is the
  way to look. On this build the real grant is unconfirmed (§8).
- Not built: touch, gamepad, sound, more than two contacts, moving a contact with the craft's arm, saving named
  layouts, a second reconstructed cell, any model in the reconstructed cell.

## 10 · Files

| File | What |
|---|---|
| `src/world/controller.ts` | the craft, the camera, the modes, the autopilot, handle drags |
| `src/world/flight.ts` | pure maths: flight, boom, `smoothDamp`, `pickBody` and its bounds |
| `src/world/Craft.tsx` | the craft's model |
| `src/world/pickRegistry.ts` | what can be pointed at, by scene part |
| `src/world/morph.ts` | generated cells with picking stand-ins; `buildSkeletonCell` |
| `src/world/WorldCanvas.tsx`, `fieldMaterial.ts` | the scene; marks, isolate, dense |
| `src/world/model/journey.ts` | the experiment: causes, contacts, seed, history, baseline, save/restore |
| `src/world/model/saved.ts` | the versioned save and the reading of older saves |
| `src/world/model/layout.ts` | where things are; `modelToScene` / `sceneToModel`; the exemplar's placement |
| `src/world/journey/CortexStage.tsx` | the block: array, contacts, arrows, placement preview |
| `src/world/journey/circuitLab.ts` | the running experiment and its recordings |
| `src/world/journey/Journey.tsx`, `Hud.tsx`, `Dock.tsx`, `journey.css` | the journey, the overlay, the dock |
| `src/world/journey/exemplar.ts`, `public/world/h01-exemplar.json`, `tools/morph/build-h01-exemplar.mjs` | the reconstructed neuron |
| `tests/world-embodied.test.ts`, `tests/e2e/world.mjs`, `world-perf.mjs`, `world-walkthrough.mjs` | the checks |
