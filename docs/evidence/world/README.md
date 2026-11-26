# Evidence — the world, embodied build (branch `feature/neuroverse-embodied`, 2026-11-25/26)

Everything here was produced by running the code on this machine (Apple M5 Ultra, macOS 27.0.1, Chrome 158). It shows
that the software does what `docs/EMBODIED.md` (and, for the journey as a whole, `docs/WORLD.md`) says. It does **not**
show that anyone enjoys the world, learns from it, or that its models are biologically right: no person has played it
and no expert has reviewed it.

| File | What it is | How to reproduce |
|---|---|---|
| `checks.txt` | Typecheck, all unit tests and the model-versus-RTL checks on this branch | `npm run check` |
| `e2e-report.txt` | The 28-step browser test of `#/world` (headless Chrome, production build): the 19 steps of the integrated world, updated, and 9 for the embodied build | `npm run test:e2e:world` |
| `screens/*.png` | Screenshots taken by that test at the moments it asserts on (`20-…` to `26-…` are the embodied steps) | same |
| `performance.txt` | Frame intervals, main-thread work, response, **pointing time**, loading, memory and the real pointer-capture grant, in a visible window at two pixel densities; includes the first minute and a close approach to the reconstructed neuron | `npm run perf:world` |
| `video/world-walkthrough.mp4` | One continuous take of a script going through the route: brain → in → flying the craft → pointing at a branch → Inspect / isolate → one changed cause → P1 and P2 placed → P1 moved by its arrow and by steps → undo/redo → flying away → the array and Decoder Pilot → out, back in, and a reload | `npm run record:world` |

What the performance sample found (one run, 1920 × 1080, mains power; full numbers in `performance.txt`):

| Segment | Frame interval, median / p99 / worst | Main-thread work p95 | Pointing test, median / p99 |
|---|---|---|---|
| First minute: flying beside the reconstructed neuron, pointing along its branches, both views | 8.3 / 10.3 / 10.4 ms | 0.8 ms | 0.1 / 0.3 ms among 234 things |
| Close approach to that neuron's body | 8.3 / 10.4 / 10.5 ms | 0.8 ms | 0.1 / 0.3 ms |
| Circuit: flying, replays, new runs, a contact moved every few seconds, traces open | 8.3 / 10.4 / 10.4 ms | 0.7 ms | 0.1 / 0.2 ms among 236 things |
| Electrode array: decoder task, fault, recalibration | 8.3 / 10.4 / 10.5 ms | 0.4 ms | — |
| Going in (dive and arrival) | 8.3 / 10.3 / 25.1 ms (40.1 ms at pixel ratio 2) | 0.7 ms | — |

The same at device pixel ratio 2 (3840 × 2020 physical pixels) within 0.1 ms. No segment lowered the detail setting.
JS heap after one trip out and in: 70.0 MB; after six more: 73.4 MB (+3.4 MB, no garbage collection forced).
8.3 ms is this display's refresh interval, so these say "kept up with a 120 Hz display", not how much is to spare.

**Pointer capture was NOT granted in this run.** Chrome answered the request with `WrongDocumentError` ("the root
document of this element is not valid for pointer lock") although the page had focus: the automated window was not
the machine's active window at the time. The request is made on the click or key press exactly as in the previous
build, whose run did get the grant; in this build the real grant has **not** been re-confirmed. What is confirmed:
the refusal is announced and dragging still looks (step 28), and the page behaves correctly once capture is given
(step 5, simulated). The line in `performance.txt` after "NOT granted" about Escape is that script's fixed wording and
means nothing when no capture was given.

Things to know when reading these:

- **Independent recomputation.** Where the browser test checks a number the screen states (a spike time, a
  fingerprint, a contact's detected events, the two contributions in "Why"), it recomputes it in the test's own Node
  process from the model's source and compares — it does not compare the page with itself. For a moved contact it
  compares **every sample** of the recording with an independent `probeRecording` at the new position.
- **"Resolves to the neuron".** The pointing steps aim at the middles of branch segments taken from the scene's own
  picking list and ask the application what is aimed at there. A point that resolves to something else is accepted
  only if the application's ray test says that thing is nearer — and that equality is asserted for every point.
- **Pointer capture.** Headless Chrome does not grant it. The browser test checks the refusal (step 28) and the
  page's handling against a simulated grant (step 5), and says so in its notes; `performance.txt` records a real
  grant.
- **The frame intervals are capped by this display** (120 Hz). A median of 8.3 ms means the page kept up with it, not
  that it has that much to spare; the main-thread work per frame is reported separately, and GPU time is not
  measurable from a page.
- **Pointing time** is the time of one "what is aimed at" test, measured in the page; such a test runs every fourth
  frame while the pointer is over the scene, and once per click.
- **The scripted player** of the decoder task holds the keys that point at the target. Its target counts show the
  direction of an effect, not what a person would score.
- **The recording** is a screencast of the page (headless), with a ring drawn where the pointer is. It runs at
  whatever rate the screencast delivered frames, so it is not evidence of frame rate — `performance.txt` is.
- **One run each.** Nothing here is an average over runs or machines.
- **Older screenshots.** `screens/01-…` to `19-…` are re-taken by the same test on this build; `06-contact.png`
  replaces `06-probe.png` (the fixed probe no longer exists).
