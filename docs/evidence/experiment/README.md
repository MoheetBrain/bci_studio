# Evidence — interactive BCI experiment

Produced by `npm run test:e2e:experiment` (headless Chrome, production build). Everything shown in the Experiment
scene is **simulated**; the screenshots are of the running application, not mock-ups.

- `e2e-report.txt` — the 17 acceptance steps with the numbers each one read from the application.
- `screens/` — captured during that run:

| File | What it shows |
|---|---|
| `01-brain-home` | the opening shot after the framing fix |
| `02-placing` | Add BCI: the device following the pointer, the region named, "click to attach" |
| `03-attached-motor`, `04-rotated` | attached to the left precentral gyrus; the same after turning the brain |
| `05-moved-no-experiment` | dragged to the postcentral gyrus: attached, no experiment offered |
| `06-brief-motor`, `07-brief-occipital` | the five-part region briefs |
| `08-experiment-tissue` | stage 1: tissue, threads, model neurons, spike raster |
| `09-electrode-near`, `10-electrode-far` | stage 3 at 45 µm and at 120 µm |
| `11-frontend-dc-saturated`, `12-frontend` | stage 4: DC-coupled (saturated) and AC-coupled |
| `13-adc`, `14-adc-aliasing` | stage 5: samples, codes and bits; a filter too wide for the sample rate |
| `15-dsp` | stage 6: band-pass, common average, threshold, crossings, counts, rates |
| `16-decoder-linear`, `17-decoder-kalman` | stage 7: the terms that add up to the decoded velocity |
| `18-trace-panel` … `20-trace-neuron` | tracing one prediction back to a spike of the nearest neuron |
| `21-mode-engineering`, `22-mode-math` | the same state in two representations |
| `23-output-cursor` | stage 8: cursor, target, intended and decoded velocity, the loop |
| `24-attached-occipital` … `28-visual-output` | the visual experiment |
| `29-lab`, `30-lab-constrained` | decoder comparison, without and with constraints |
| `31-experiment-empty` | no device attached |
| `32-phone-brain`, `33-phone-experiment` | 390-px phone viewport |
