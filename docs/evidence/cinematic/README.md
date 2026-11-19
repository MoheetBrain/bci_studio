# Evidence for the cinematic rebuild

Everything here was produced by the scripts named, from the running application, on 2026-11-19 on one machine.
Nothing was edited by hand, and no generated image stands in for the 3D scene.

| What | Where | Produced by |
|---|---|---|
| Baseline **before any edit** (screens, performance, check results at `df9ba12`) | `baseline/` | copied / run before the first change |
| Same viewport **and same camera**: old look, stock-PBR candidate, chosen tissue shader (hero, close, top) | `looks/` | `node tests/e2e/capture-looks.mjs` (`?look=legacy\|pbr\|tissue`) |
| Before / after sheets: brain (3), home, selected region, cut / slice, microscopic scene, acquisition, chip + decoder, phone | `compare/` | `node tests/e2e/compare.mjs` |
| Screens of this build: home, hover, selected, X-ray, regions, slice, finder, deep structure, slice-through, about, neurons (3), signal, chip, original studio, decoder (2), research, no-WebGL, phone (4) | `screens/` | `npm run test:e2e` |
| 31 s recording of real interaction (orbit, hover, select, modes, dive, electrode distance, decoder) | `interaction.mp4` | `node tests/e2e/record.mjs` (browser screencast frames joined by local ffmpeg) |
| The three prediction tasks: wording, keys, how each key was established, rubric | `pedagogy-tasks.md` | — |
| End-to-end walkthrough, 27 steps | `../e2e-report.txt` | `npm run test:e2e` |
| Performance: hover, pick, select, orbit in three modes, both animated scenes, idle, load, payload, memory; plus a CPU-throttled 1280 × 720 profile | `../performance.txt` | `node tests/e2e/perf.mjs` (visible window) |
| Bibliography against Crossref | `../sources-check.txt` | `npm run check:sources -- --write` |
| Check results after the rebuild | `checks-after.txt` | `npm run check`, `npm run build` |

Accessibility evidence is inside the walkthrough: every control has a name; one `main`, labelled navigation, a live
region; text contrast on the dark stage measured at 7.1 : 1 or better for the sampled elements; a visible focus ring;
with reduced motion nothing plays by itself and camera moves are instant; without WebGL an explicit message is shown
(no substitute image) while the finder and the Decoder scene still work; a 390 × 844 touch viewport has no horizontal
overflow in any scene.

Not covered: a physical low-end device, a screen reader session, colour-vision simulation, and any measurement of
learning.
