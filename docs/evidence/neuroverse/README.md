# Evidence — Neuroverse toys (branch `feature/neuroverse-toys`, 2026-11-25)

Everything here was produced by running the code on this machine (Apple M5 Ultra, macOS 27.0.1, Chrome). It shows that
the software does what `docs/NEUROVERSE.md` says. It does **not** show that anyone enjoys a toy, learns from it, or
that the models are biologically right: no one has played them and no expert has reviewed them.

| File | What it is | How to reproduce |
|---|---|---|
| `baseline.txt` | The existing checks, run before the first edit | `npm run typecheck && npm test && npm run check:rtl` on `c605e3f` |
| `checks.txt` | Typecheck, all unit tests and the model-versus-RTL checks on this branch | `npm run check` |
| `e2e-report.txt` | The 29-step browser test of the three toys (headless Chrome, production build) | `npm run test:e2e:neuroverse` |
| `screens/*.png` | Screenshots taken by that test at the moments it asserts on | same |
| `performance.txt` | Frame times, input response, stalls, loading, memory and the real pointer-capture grant, in a visible window | `npm run perf:neuroverse` |
| `video/toy-*.mp4` | Three recordings of a script playing each toy: movement, an intervention, its consequence | `npm run record:neuroverse` |

The earlier suites were re-run on this branch and their reports rewritten: `docs/evidence/e2e-report.txt` (27 steps)
and `docs/evidence/experiment/e2e-report.txt` (17 steps). Their screenshots were not re-committed.

Things to know when reading these:

- **Pointer capture.** Headless Chrome does not grant it. `e2e-report.txt` therefore tests the page's handling against
  a simulated grant and says so in its notes; `performance.txt` records the real grant in a visible window.
- **The scripted player** in the Toy C steps and in the recordings is a few lines of code that holds the keys pointing
  at the target. It is a crude pilot; its target counts show the direction of an effect, not what a person would score.
- **`performance.txt` is from the build just before the last layout adjustments** (narrower instrument columns in
  medium-width windows, shorter Compare labels, Toy C's start pose, a key-character fallback). No rendering or model
  code changed after it. The unit tests, the browser test and the recordings were run after those adjustments; the
  only thing changed after them is two CSS lines that apply to windows narrower than 1240 px (the tests run at 1440).
- **One run each.** Nothing here is an average over runs or machines.
