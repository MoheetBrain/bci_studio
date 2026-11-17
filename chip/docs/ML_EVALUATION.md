# HBCI-02 on-chip decoder: machine-learning evaluation (mandate section 6)

**Status:** offline analysis of a public human ECoG recording at git rev `a275624` (`experiments/E02_onchip_decoder/`,
run 2026-10-26, 450 s). Evidence label in the sense of AI_DECODER.md: software reference only; **nothing here is RTL,
SYNTH, LAYOUT or MEASURED**. Full detail, every table and the spec observations: `experiments/E02_onchip_decoder/REPORT.md`.

## 1. What was evaluated, and what is claimed

The decoder of `docs/AI_DECODER.md` (8 log-quantised band-energy inputs → optional ReLU hidden layer of NH units →
NO logits, int8 weights, int32 biases) was trained and tested on DANDI 000019 (CC-BY-4.0, Chang Lab), participant
EC9, session B15: 60 sensorimotor ECoG channels at 3051.7578 Hz, 195 s, 70 consonant-vowel syllables read aloud.
Primary task: **overt speech vs inter-trial silence**, an engineering benchmark for the chip arithmetic. Secondary:
vowel identity /a/ /i/ /u/ (NO = 3).

Claims are limited to: one subject, one session, overt speech, offline, no hardware recorded anything, no cross-session
or cross-subject statement. Overt, attempted and inner speech are different problems. The RTL was not run on these
data here; the exported vectors and stream exist so that it can be.

## 2. Method (details in REPORT.md §2)

- **Feature stream = the v0.3 hardware math.** E01's int16 quantisation and bit-exact `chip_feature` (DF-I biquad
  Q2.14, 70–150 Hz, 128-sample windows = 41.9 ms, energy = sat32(Σy² >> 8)), windows counted from sample 0 on every
  channel. A frame = the 8 selected channels' energies at one window index (AI_DECODER.md §2).
- **Everything quantised is computed by `scripts/golden_ai.py`** (`quantise`, `forward`, `predict_frame`,
  `pack_model`, `crc32_words`); its arithmetic was not reimplemented.
- **Epochs as in E01:** speech −0.2…+0.4 s around the CV transition (51 valid trials); silence 1.2 s after trial stop
  (34). E01 itself used only the first 34 speech epochs; E02 uses all 85 with class-balanced loss and balanced accuracy,
  because a chronological split needs both classes in every block. 13 frames per epoch, 1105 frames.
- **Splits:** 5 contiguous chronological blocks of 17 epochs (train on 4, test on 1, rotate; pooled held-out
  predictions) and first 59 / last 26 epochs in time for the exported models. No frame shuffling.
- **Inside every training fold only:** the 8 channels (one-way F statistic of the golden log-energy L between
  classes, top 8), `centre_c` (training median of L), `qshift_c` (smallest shift fitting the training 0.5–99.5 % range
  into int8), float training (numpy Adam, class-balanced cross-entropy, 1000 steps, fixed a priori), post-training
  symmetric int8 quantisation, and `s1` (99.5th percentile of the positive hidden pre-activations → 127).
- **Controls:** chance, majority class, 200 epoch-level label permutations through the entire pipeline, float
  logistic regression on float log-energies of the same channels, and E01's host (RAW) features on the same 8
  channels with E01's PCA/LDA as a ceiling. 95 % CIs by bootstrap over epochs (2000).

## 3. Results: speech vs silence, win_log2 = 7, n = 85 epochs / 1105 frames, chronological 5-block rotation

Balanced accuracy, %. Per-epoch = argmax of the summed integer logits over the epoch's 13 frames.

| Model | Float frame BA | Quantised frame BA [95% CI] | Quantised epoch BA [95% CI] | Frame null 95% / p | Epoch null 95% / p | Sens / Spec (frame) | Sens / Spec (epoch) | Params | MACs | Cycles |
|---|---|---|---|---|---|---|---|---|---|---|
| A linear 8->2 | 74.2 | 74.3 [71.4, 77.0] | 98.0 [95.1, 100.0] | 54.4 / 0.005 | 61.3 / 0.005 | 73.0 / 75.6 | 96.1 / 100.0 | 18 | 16 | 51 (19 if linear mode skips the hidden layer) |
| B MLP 8->4->2 | 72.9 | 73.0 [70.0, 76.1] | 99.0 [96.8, 100.0] | 54.0 / 0.005 | 59.8 / 0.005 | 73.2 / 72.9 | 98.0 / 100.0 | 46 | 40 | 43 |
| C MLP 8->6->2 | 74.1 | 74.3 [71.4, 77.1] | 99.0 [96.8, 100.0] | 53.5 / 0.005 | 60.8 / 0.005 | 72.1 / 76.5 | 98.0 / 100.0 | 68 | 60 | 63 |
| C MLP 8->8->2 | 73.4 | 73.5 [70.5, 76.3] | 98.0 [94.9, 100.0] | 53.4 / 0.005 | 60.3 / 0.005 | 72.2 / 74.7 | 96.1 / 100.0 | 90 | 80 | 83 |
| float LR (log2 E) | 74.4 | (float) 74.4 [71.7, 77.2] | (float) 98.0 [95.1, 100.0] | 54.4 / 0.005 | 61.3 / 0.005 | 72.9 / 76.0 | 96.1 / 100.0 | 18 | n/a (host) | n/a |

Chance 50.0; majority class 50.0 balanced (60.0 raw). p = 0.005 is the smallest value 200 permutations allow.

What the numbers say:

1. **Every model decodes.** Frame and epoch accuracies are far above the permutation null (null 95th percentile
   53–54 per frame, 60–61 per epoch).
2. **The hidden layer buys nothing on this task.** The four on-chip models differ by ≤ 1.3 points per frame and
   ≤ 1 point per epoch, well inside overlapping CIs; the MLPs fit their training folds better (78–80 % vs 74–77 %)
   without generalising better.
3. **Quantisation is free.** The Mitchell log quantiser + int8 inputs + int8 weights reproduce the float models'
   class on 99.3–99.9 % of frames and match a float logistic regression on float log-energies (74.4).
4. **Per-frame ≈ 74 %, per-epoch ≈ 98 % is a property of the label definition**, not of the decoder: speech frames
   around the CV transition are classified at 84–94 %, the first frame (before consonant onset) and the last two
   (after most syllables end) at chance (REPORT.md §3.4).
5. **Feature extraction discards nothing this task needs:** E01's host features from the raw samples of the same 8
   channels reach 97.1 % per epoch with E01's LDA, vs 98.0 % on chip.
6. **Window length:** 32- and 64-sample windows lower per-frame BA (64.5–65.9 and 68.7–70.2) with the same per-epoch
   result; 128 samples is kept.
7. **Vowel identity (secondary, 51 epochs, 100 permutations):** the linear model reaches 43.2 % per frame and
   61.7 % [48.2, 74.5] per epoch (chance 33.3; null 95 % 38.8 / 46.6; p = 0.01); the MLP is weaker (39.4 / 48.2).
   Above the null, but with a CI reaching 48 % it is not a vowel decoder: consistent with E01's "inconclusive".

### Channel selection and robustness (REPORT.md §3.6–3.7)

- The in-fold selection is stable in its core: 136, 152, 153, 168, 169 (precentral, grid rows 8–10) are chosen in
  all five folds (mean pairwise Jaccard 0.69). **Label-free selection fails:** an anatomy-only set (precentral
  electrodes at the pre/postcentral boundary) gives 53.7 / 61.8 and an unsupervised variance rule 54.7 / 62.3. Which 8
  electrodes feed the chip is the single most important choice; it needs a supervised calibration recording.
- 12-bit and 10-bit input precision change nothing (±0.5 point, with or without retraining).
- A channel that **reads zero energy is catastrophic** for every model (x saturates at −128: one such channel drops
  epoch BA to 67–71 % on average and to 50 % in the worst case), whereas **masking** the same channel with
  `cfg_ch_mask` costs 1–3 points (two masked channels: 90–92 % per epoch). Operating rule: mask failed electrodes.
- With one channel replaced by noise the linear model keeps 67.9 / 74.4 vs 63.0–64.5 / 65.5–70.2 for the MLPs; with
  two, 64.0 / 69.1 vs 57.7–59.7 / 58.5–63.6.

## 4. Hardware cost and recommendation

| Model | Used parameters | MACs/frame | Cycles/frame (spec §3.4) | Per-epoch BA | Per-frame BA |
|---|---|---|---|---|---|
| A linear | 18 (+16 calibration) | 16 | 51 at NH = 4 (19 if linear mode skips the hidden layer) | 98.0 | 74.3 |
| B MLP NH = 4 | 46 | 40 | 43 | 99.0 | 73.0 |
| C MLP NH = 6 | 68 | 60 | 63 | 99.0 | 74.3 |
| C MLP NH = 8 | 90 | 80 | 83 | 98.0 | 73.5 |

The model block is 46 words = 184 bytes for every model. A frame arrives every 128 sample periods (42 ms), so all
cycle counts are far below the budget; cycles translate to energy, not throughput.

**Recommendation (rule fixed before reading the test numbers: the smallest model whose CIs overlap the best
model's): ship Model A, linear = 1, and synthesise the block with NH = 4** so that Model B remains loadable on the
same silicon. Measured reasons: equal accuracy (within 1.3 points, overlapping CIs) at 16 instead of 40–80 MACs and
18 instead of 46–90 parameters; the least overfitting on 85 epochs; the most graceful degradation with corrupted
channels; the only model also above the null on the vowel task. If a later dataset shows a non-linear benefit, the
same silicon runs Model B at 43 cycles. `models/recommended.*` is a copy of `models/e02_A_linear.*`.

Exported models (first-70 %/last-30 % chronological split; test = 26 epochs at 131–181 s, 338 labelled frames):

| Model | CRC-32 | Quantised frame BA [95% CI] | Quantised epoch BA [95% CI] | Vectors (labelled) |
|---|---|---|---|---|
| A linear (= recommended) | ba6bf18d | 75.9 [71.1, 80.4] | 93.3 [83.3, 100.0] | 1376 (338) |
| B MLP NH = 4 | 066ab38a | 76.9 [72.5, 81.0] | 96.7 [88.5, 100.0] | 1376 (338) |
| C MLP NH = 6 | c60bb515 | 76.6 [72.6, 80.9] | 100.0 [100.0, 100.0] | 1376 (338) |
| C MLP NH = 8 | b41590b0 | 75.9 [71.0, 80.4] | 93.3 [83.3, 100.0] | 1376 (338) |

Channels of the exported models (original 256-grid indices, frame order c = 0..7): 28, 46, 61, 62, 136, 153, 168, 169;
centre [712, 790, 740, 724, 675, 737, 701, 802]; qshift [1, 1, 1, 1, 0, 1, 1, 1].

Files under `experiments/E02_onchip_decoder/models/` for each `<name>` ∈ {recommended, e02_A_linear, e02_B_mlp4,
e02_C_mlp6, e02_C_mlp8}: `<name>.json` (model dict, 46 words, CRC, channels, calibration, metrics, split, git rev),
`<name>.hex` (46 words for `$readmemh`), `<name>_vectors.json` (1376 held-out frames with E, L, x, h, logits, cls,
margin, label), `<name>_stream.txt` (8 channels × 61,056 int16 samples from sample 0, round-robin `ch value`,
488,448 lines, 20.01 s) and `<name>_stream_expected.json` (every window's 8 energies and every frame's x/cls/margin).
All were verified to round-trip through `golden_ai.unpack_model` / `predict_frame` and `chip_feature` with zero
mismatches. Window 0 of the stream contains the biquad start-up transient from the zero state, as in hardware after
reset.

## 5. Limitations

Single subject, single session, 85 epochs; overt speech; offline; label-dependent channel selection that must be
redone per subject/session; session-specific calibration constants; int16 scaling from a whole-recording label-free
statistic (a real front end has a fixed gain); per-frame labels inherited from the epoch; silence = task rest, not
arbitrary non-speech behaviour (false positives under jaw movement or swallowing are untested); 200 permutations bound
p at 0.005 (100 for vowels); hyperparameters fixed a priori, not tuned; NWB units ambiguous (E01); the RTL has not
been run on these data.

## 6. Specification / reference observations (reported, not changed; REPORT.md §8)

1. §3.4 cycle formula in linear mode implies the unused hidden layer still runs (51 vs 19 cycles at NH = 4): the RTL
   should state which.
2. Linear mode tolerates non-zero W1/b1 (ignored by the arithmetic, included in the CRC); the exported linear model
   has them all zero, so its words are valid for any synthesised NH.
3. `E = 0` → `x = −128` on a calibrated channel is catastrophic; failed channels must be masked with `cfg_ch_mask`
   (or the spec could define E = 0 → x = 0).
4. The FEATURE accumulator needs 30 + win_log2 bits before `energy_shift` (a v0.3 width question).
5. E01 REPORT.md quotes "values peak around 4.9e-4" while its script reports a 99.99th percentile of 1.207e−3.
6. `golden_ai.py` self-test passes; no arithmetic discrepancy with §3 was found.

## 7. Reproduction

```
/usr/bin/python3 -I scripts/golden_ai.py                              # self-test
/usr/bin/python3 -E experiments/E01_ecog_vowel/run_e01.py             # E01, ~70 s, numbers reproduce exactly
/usr/bin/python3 -E experiments/E02_onchip_decoder/run_e02.py         # E02, ~450 s, deterministic (seed 20261026)
/usr/bin/python3 -E experiments/E02_onchip_decoder/report_tables.py   # tables from results.json
```
Python 3.9 + numpy 1.26 (+ h5py for the E01 cache loader); data cache `~/.local/data/dandi-000019/EC9_B15_sm60.npz`.
Git rev of the run: `a275624`.
