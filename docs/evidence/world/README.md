# Evidence — the integrated world (branch `feature/neuroverse-world`, 2026-11-25)

Everything here was produced by running the code on this machine (Apple M5 Ultra, macOS 27.0.1, Chrome 158). It shows
that the software does what `docs/WORLD.md` says. It does **not** show that anyone enjoys the world, learns from it, or
that its models are biologically right: no person has played it and no expert has reviewed it.

| File | What it is | How to reproduce |
|---|---|---|
| `checks.txt` | Typecheck, all unit tests and the model-versus-RTL checks on this branch | `npm run check` |
| `e2e-report.txt` | The 19-step browser test of `#/world` (headless Chrome, production build) | `npm run test:e2e:world` |
| `screens/*.png` | Screenshots taken by that test at the moments it asserts on | same |
| `performance.txt` | Frame intervals, main-thread work, response, loading, memory and the real pointer-capture grant, in a visible window at two pixel densities | `npm run perf:world` |
| `video/world-walkthrough.mp4` | One continuous take of a script going through the whole route: brain → in → flight → one changed cause → replay and comparison → probe → array → decoder task broken and recovered → back out | `npm run record:world` |

Things to know when reading these:

- **Independent recomputation.** Where the browser test checks a number the screen states (a spike time, a
  fingerprint, the probe's detected events, the two contributions in "Why"), it recomputes it in the test's own Node
  process from the model's source and compares — it does not compare the page with itself.
- **Pointer capture.** Headless Chrome does not grant it. The browser test checks the refusal message and then the
  page's handling against a simulated grant, and says so in its notes; `performance.txt` records the real grant.
- **The frame intervals are capped by this display** (120 Hz). A median of 8.3 ms means the page kept up with it, not
  that it has that much to spare; the main-thread work per frame is reported separately, and GPU time is not
  measurable from a page.
- **The scripted player** of the decoder task holds the keys that point at the target. Its target counts show the
  direction of an effect (broken → recovered), not what a person would score, and one session is not a comparison of
  decoders.
- **The recording** is a screencast of the page (headless), with a ring drawn where the pointer is. It runs at
  whatever rate the screencast delivered frames, so it is not evidence of frame rate — `performance.txt` is.
- **One run each.** Nothing here is an average over runs or machines.
