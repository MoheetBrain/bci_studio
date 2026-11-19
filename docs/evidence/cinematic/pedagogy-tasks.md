# Predict-then-check tasks

Three tasks ask the visitor to commit to an answer **before** the scene shows the result. This file records the tasks,
the keyed answers, how each key was established, and the rubric. It makes **no claim that the tasks improve
understanding**: no learner data was collected, and none is collected by the app (an answer is kept only in that
browser’s local storage so the task stays answered; nothing is transmitted).

How a task behaves: options are locked after one choice; the chosen and the keyed option are marked; a short
explanation follows, with a line specific to the wrong option chosen; a button applies the change in the scene and a
result line prints the numbers the model then produces. “Ask me again” clears it.

## 1 · All-or-nothing spikes — Neurons scene (`predict-all-or-nothing`)

**Question.** The neuron is firing with 10 µA/cm² of current pushed into it. You double the current to 20. What happens
to its spikes?

| Option | Key |
|---|---|
| Each spike gets about twice as tall | |
| They come more often, at about the same height | ✓ |
| Both: taller and more often | |

**How the key was established.** By running the scene’s own Hodgkin–Huxley model (`src/neuro/model/hh.ts`): 10 → 20
µA/cm² changes the rate from 68 to 86 spikes a second; the first spike peaks at +40 → +41 mV and the later ones at
+30 → +24 mV. So spikes come more often and are not taller (later ones are slightly smaller). The same numbers are
printed in the app after “Double the current” and asserted in `tests/e2e/walkthrough.mjs`.

**Scope of the key.** True of this model (squid axon). The qualitative point — spike size is set by the channels, not
by the drive — is the textbook all-or-nothing principle; the exact figures are not claims about human cortical neurons.

## 2 · Aliasing — Signal scene (`predict-aliasing`)

**Question.** A 7 kHz tone reaches a converter that takes 10,000 samples a second, and the low-pass filter in front of
it is set far too wide. Where does the tone show up in the digital samples?

| Option | Key |
|---|---|
| At 7 kHz, as it went in | |
| At 3 kHz — a frequency that was never there | ✓ |
| Nowhere: it is too fast to be captured at all | |

**How the key was established.** |7 kHz − 10 kHz| = 3 kHz, and by the chain model’s `aliasFrequency` (unit-tested in
`tests/chain.test.ts`); the “Aliasing” example then reports “a 7 kHz tone sampled at 10 kS/s appears at 3.0 kHz”.

## 3 · One dominant channel — Decoder scene (`predict-one-channel`)

**Question.** In frame 0 the decoder answers class 1 with a comfortable margin. Channel 7 has by far the largest
weights (−127 and 118). If channel 7’s input were 0 instead of 127, would the answer change?

| Option | Key |
|---|---|
| Yes — the other class would win | ✓ |
| No — seven other channels still agree | |

**How the key was established.** Computed in the page from the RTL trace’s own weights and inputs, and asserted in
`tests/decoder-steps.test.ts`: totals −10,380 / 9,638 become 5,749 / −5,348, so class 1 → class 0. The key is derived
at run time, so a different trace would re-key the task instead of showing a stale answer. The changed frame is labelled
“what-if — software re-run, not RTL”.

## Rubric (for a facilitator; the app does not score)

| Level | Evidence |
|---|---|
| 0 — guess | picks an option, cannot say why |
| 1 — recall | right option, restates the explanation |
| 2 — mechanism | explains the mechanism in own words (gates run the same course; folding around half the sample rate; a weighted vote with unequal weights) |
| 3 — transfer | predicts a new case correctly before trying it: task 1, what 5 µA/cm² does (one spike, then it settles; in this model repeated firing needs a little over 6 µA/cm²); task 2, where a 12 kHz tone lands at 10 kS/s (2 kHz); task 3, which other single channel could flip frame 0 (none: compare each channel’s two products with the margin of 20,018) |

Each level-3 probe can be checked in the scene with the existing controls.

## What would be needed before claiming anything about learning

A pre/post design with learners who have not seen the scenes, the same items with and without the predict step, and
enough participants to estimate an effect. None of that has been done.
