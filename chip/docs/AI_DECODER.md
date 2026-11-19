# HBCI-02 on-chip AI decoder: specification (v0.4)

This file is the binding specification for the on-chip neural decoder. The RTL (`rtl/hbci_ai_decoder.v`),
the bit-exact Python reference (`scripts/golden_ai.py`), the training/export pipeline
(`experiments/E02_onchip_decoder/`) and the studio must all follow it. If two disagree, this file wins and
the disagreement is a bug.

Evidence labels used in this document: **CONCEPT** (proposed), **RTL** (simulated Verilog), **SYNTH**
(synthesised logic), **LAYOUT** (place-and-route result), **MEASURED** (physical hardware). Nothing in this
file is MEASURED.

## 1. Position in the chip

```
ADC-style samples ─► hbci_readout_core (v0.3 DSP) ─► FEATURE windows ─► hbci_ai_decoder ─► predictions
                                        │                                   ▲
                                        └─► records (RAW/EVENT/FEATURE) ─► FIFO ─► output
                                                                            │
                     model parameters, control and status ◄── register bus ─┘
```

The decoder taps the FEATURE path **before** the record multiplexer and FIFO (`ai_feat_*` ports of the
readout core), so output backpressure never starves inference. The tap is not gated by the output mode:
features are produced for every accepted sample whenever a window completes, in every mode. Inference is
gated only by `cfg_session_en & cfg_ai_en` (explicit user control; no neural "wake word").

## 2. Frame protocol (section 5 Phase B of the mandate)

A **frame** is one observation: one FEATURE value from each required channel, all from the **same
per-channel window index**.

Definitions (all in `hbci_readout_core` and `hbci_ai_decoder`):

| Term | Definition |
|---|---|
| Window | 2^k consecutive accepted samples of one channel (`cfg_win_log2`, as in v0.3) |
| `win_idx[c]` | Per-channel 16-bit window counter in `hbci_feature_state`: the index of the window that is open on channel c. Incremented when that window completes (`done`). Reset to 0 by `rst_n` and by `feat_sync` |
| Feature | `{ch, energy[31:0], ts[31:0], sat, win_idx[15:0]}` emitted on `ai_feat_valid` in the cycle the window's last sample is accepted. `ts` is that sample's global index |
| `feat_sync` | One-cycle pulse (register `CTRL.feat_sync`). Zeroes `cnt`, `acc`, `sat` and `win_idx` of **every** channel and clears any partial frame in the decoder. This is the documented resynchronisation after a lost sample or a window-length change |
| `cfg_ch_mask[7:0]` | Required channel membership (default `0xFF`). A feature from an unmasked channel is ignored. Unmasked channels enter the model as `x = 0` |
| `cfg_frame_span[31:0]` | Maximum allowed `ts_last − ts_first` (modulo 2^32) inside a frame. Default `0xFFFFFFFF` (disabled). A sensible value is `NUM_CH × 2^win_log2 + margin` |

Collector rules (one feature per cycle at most):

1. If no frame is open: open a frame with `frame_id = win_idx`, `ts_first = ts`, store the feature.
2. Else compare `d = win_idx − frame_id` as a signed 16-bit number:
   - `d == 0` and channel not yet in the frame: store; `ts_last = ts`; if `ts_last − ts_first > cfg_frame_span`
     the frame is **abandoned** (`stat_frame_span++`, `last_missing` = channels not seen) and a new frame is
     opened with this feature.
   - `d == 0` and channel already in the frame (**duplicate**): `stat_frame_dup++`, abandon the frame, open a
     new frame with this feature.
   - `d > 0` (**newer window**): the open frame is incomplete: `stat_frame_incomplete++`, `last_missing` =
     channels not seen; open a new frame with this feature.
   - `d < 0` (**late / lagging channel**): `stat_feat_late++`, discard the feature; the frame stays open.
3. When all channels in `cfg_ch_mask` are present the frame is **complete**: `stat_frames++`. It moves to the
   1-deep pending register if that is empty, otherwise `stat_frame_busy++` and the frame is dropped (the next
   emitted prediction carries `flags.gap = 1`).
4. `cfg_ai_en = 0` clears the open frame, the pending register and aborts a running inference (no prediction
   is emitted for it). The prediction FIFO is **not** cleared.
5. A feature with `sat = 1` is stored like any other; the frame records it in `sat_mask`. The prediction
   carries `flags.sat = |sat_mask|`. Saturated channels never block prediction.

Properties: samples of different windows are never combined (rule 2), every loss is counted and visible, the
protocol survives timestamp and window-counter wrap-around (modular comparisons), and after reset or
`feat_sync` every channel starts at window 0.

## 3. Numerical format (binding for RTL and software)

Notation: `>>` is an arithmetic (floor) shift on signed values; `sat_intN` saturates to the signed N-bit range;
`clamp(v, lo, hi)`.

### 3.1 Feature quantiser (per channel c)

Input `E` = FEATURE energy, unsigned 32-bit (`sat32(acc >> cfg_energy_shift)` from v0.3).

```
if E == 0:  L = 0
else:       n = floor(log2(E))                       # 0..31, position of the most significant 1
            m = the 6 bits immediately below bit n   # (E << (31-n)) bits 30:25; zeros if n < 6
            L = 64*n + m                             # 0..2047, ≈ 64·log2(E) (Mitchell linear mantissa)
x_c = sat_int8( (L − centre_c) >> qshift_c )         # centre_c: unsigned 12-bit; qshift_c: 0..7
```

`x_c = 0` for channels not in `cfg_ch_mask`. The log approximation error is at most 0.086 log2 units
(5.5 LSB of 1/64); it is a fixed, deterministic distortion that the software reference reproduces exactly.

### 3.2 Network

Sizes: `NI = 8` inputs, `NH` hidden units (synthesis parameter, 1..8; shipped value chosen by
`experiments/E02_onchip_decoder/`), `NO` outputs (synthesis parameter, 2..4; shipped 2).

```
Hidden (MLP mode):   a1_h = b1_h + Σ_{c<8} W1[h][c] · x_c            W1 int8, b1 int32
                     h_h  = clamp(a1_h >> s1, 0, 127)                 s1 = 0..31 (model parameter)
Output:              a2_o = b2_o + Σ_{k<N2} W2[o][k] · in_k           W2 int8, b2 int32
                       MLP mode:    N2 = NH, in_k = h_k
                       linear mode: N2 = 8,  in_k = x_k   (Model A on the same silicon)
logit_o = a2_o   (exact; fits 34-bit signed: |Σ products| ≤ 8·128·128 = 2^17, |b| < 2^31)
class   = argmax_o logit_o   (lowest index wins ties)
margin  = sat_int32( logit_class − max_{o≠class} logit_o )   (≥ 0)
```

Every intermediate (`x`, `h`, `a2`) is exposed in diagnostic registers for the last frame, and the reference
returns the same values, so hardware and software can be compared term by term. In linear mode the hidden
layer is not evaluated and `h` reads 0.

### 3.3 Model parameter block (46 × 32-bit words, address order; little-endian bytes)

| Word | Contents |
|---|---|
| 0..15 | `W1[h][4k+j]` in byte j of word `2h+k` (h = 0..7, k = 0..1). Rows ≥ NH must be 0 |
| 16..23 | `W2[o][4k+j]` in byte j of word `16+2o+k` (o = 0..3). Columns ≥ N2 and rows ≥ NO must be 0 |
| 24..31 | `b1[h]` int32 |
| 32..35 | `b2[o]` int32 |
| 36..43 | channel c: bits 11:0 `centre_c`, bits 14:12 `qshift_c`, others 0 |
| 44 | bits 4:0 `s1`; bit 8 `linear` (1 = Model A path); bits 31:16 `model_id` (free tag); others 0 |
| 45 | reserved, 0 |

`MODEL_CRC` = CRC-32 (IEEE 802.3, as `zlib.crc32`) over the 184 bytes of words 0..45 in order.

Loading protocol (register bus, section 4): writes to the model region are accepted only while
`cfg_ai_en = 0` (otherwise `stat_model_wr_rej++`, sticky `MODEL_STATUS.rejected`). **Any accepted model write
clears `model_valid`.** The host then writes `MODEL_CRC` and `MODEL_CTRL.verify = 1`; the hardware reads the
46 words back through the same mux the bus uses, computes the CRC (4 cycles per word) and sets
`MODEL_STATUS.valid` on a match or `MODEL_STATUS.error` on a mismatch. **No prediction is produced while
`model_valid = 0`** (frames are counted in `stat_frames` but dropped with `stat_frame_nomodel++`). Every model
word can be read back over the bus at any time.

### 3.4 Timing

Inference is sequential on one 8×8 multiplier. In MLP mode the engine runs NH·8 + NO·NH + 2 cycles from its
start (NH = 4, NO = 2: 42; NH = 8: 82); in **linear mode the hidden layer is skipped**: NO·8 + 2 cycles (18).
A frame starts 2 cycles after it completes. Sustained throughput: one frame per engine run; frames completing
while the pending register is full are dropped and counted (`stat_frame_busy`). The collector accepts one
feature per cycle.

Operational rule from the E02 evaluation: a dead channel (energy 0 every window) quantises to x = −128 and
destroys the prediction; the host must detect it (FEATURE records / `LAST_X`) and exclude it with
`cfg_ch_mask` (x = 0, 1–3 points of accuracy). `centre` is 12-bit although L ≤ 2047 (room for future scaling);
linear mode ignores W1/b1 (they are still part of the CRC-protected block).

## 4. Register map (`hbci02_digital_top`, 8-bit word address, 32-bit data)

| Addr | Name | R/W | Fields |
|---|---|---|---|
| 0x00 | ID | R | `0x48420204` ("HB", 0x02, v0.4) |
| 0x01 | CTRL | R/W | 0 session_en, 2:1 mode, 3 ai_en, 4 feat_sync (write 1: one-cycle pulse, reads 0), 5 bist_en, 6 pred_direct_en |
| 0x02 | THRESHOLD | R/W | 15:0 | 0x03 HYSTERESIS 15:0 | 0x04 REFRACTORY 7:0 | 0x05 ALPHA_SHIFT 3:0 |
| 0x06..0x0A | B0, B1, B2, A1, A2 | R/W | signed 15:0 (Q2.14) |
| 0x0B | WIN_LOG2 | R/W | 3:0 | 0x0C ENERGY_SHIFT 5:0 | 0x0D CH_MASK 7:0 | 0x0E FRAME_SPAN 31:0 |
| 0x10..0x17 | STAT_SAMPLES, STAT_REJECTED, DROP_RAW, DROP_EVENT, DROP_FEATURE, EVENT_MISSED, FIFO_HWM, (0x17 reserved) | R | v0.3 counters |
| 0x18..0x1F | AI_FRAMES, AI_PRED, AI_INCOMPLETE, AI_DUP, AI_LATE, AI_SPAN, AI_BUSY, AI_PRED_DROP | R | decoder counters |
| 0x20 | AI_NOMODEL | R | frames dropped with no valid model | 0x21 AI_SAT_FRAMES | 0x22 MODEL_WR_REJ |
| 0x24 | LAST_FRAME | R | 15:0 frame_id, 23:16 missing mask (last abandoned), 31:24 sat_mask (last inferred) |
| 0x25..0x26 | LAST_X | R | x_0..x_7 (int8, little-endian) of the last inferred frame |
| 0x27..0x28 | LAST_H | R | h_0..h_7 |
| 0x29..0x2C | LAST_LOGIT0..3 | R | sat_int32(logit_o) |
| 0x2D | LAST_TS | R | ts_last of the last inferred frame |
| 0x30 | PRED_STATUS | R | 0 valid, 3:1 count, 7:4 flags of head (0 sat, 1 gap), 9:8 class |
| 0x31 | PRED_MARGIN | R | | 0x32 PRED_TS | 0x33 PRED_SEQ_ID (31:16 frame_id, 15:0 seq) |
| 0x34 | PRED_ACK | W | write 1: pop the head prediction |
| 0x38 | MODEL_CRC | R/W | expected CRC-32 | 0x39 MODEL_CTRL W: bit 0 verify | 0x3A MODEL_STATUS R: 0 valid, 1 error, 2 busy, 3 rejected (sticky, cleared by write), 31:16 model_id |
| 0x3C | BIST_SIG | R | MISR signature | 0x3D BIST_COUNT R: records folded | 0x3E BIST_CTRL R/W: 0 clear, 15:8 samples_per_frame... (see TEST_PLAN.md) |
| 0x40..0x6D | MODEL[0..45] | R/W | section 3.3 |

Predictions: a 4-deep FIFO. Each entry `{class[1:0], margin[31:0], ts[31:0], frame_id[15:0], seq[15:0],
flags[3:0]}` (`seq` increments per emitted prediction; a prediction that could not be queued increments
`AI_PRED_DROP` and sets `gap` on the next one). `pred_direct_en` also drives the chip pins `pred_strobe`
(1 cycle) and `pred_class` (held) for latency measurement.

## 5. Reset and recovery procedure

1. Assert `rst_n` low for ≥ 2 clock cycles. Every register, counter, FIFO entry and model word is zero;
   `model_valid = 0`; `ID` reads `0x48420204`.
2. Write configuration (0x01..0x0E) with `ai_en = 0`.
3. Write MODEL[0..45], MODEL_CRC, then MODEL_CTRL.verify; poll MODEL_STATUS until `valid` or `error`.
4. Set `CTRL.feat_sync` then `session_en = 1`, `ai_en = 1`.
5. Recovery from a lost sample or a changed window: pulse `feat_sync` (frames restart at window 0).
6. Recovery from a wrong model: `ai_en = 0`, rewrite, verify, `ai_en = 1`.

## 6. Status
Implemented in `rtl/hbci_ai_decoder.v` (quantiser, collector, model store, engine, FIFO), integrated in
`rtl/hbci02_digital_top.v` (register map above, BIST) and `rtl/hbci02_chip_top.v` (SPI, serial record output).
Verified: `docs/VERIFICATION.md` (v0.4 section: 26 runs, 200 checks, formal proofs, mutation 13/13, gate level).
Measured latency: frame complete → engine start 2 cycles; engine start → prediction in FIFO NH·8 + NO·N2 + 2
(the +3 estimated above became +2 in the RTL). Model choice and accuracy: `docs/ML_EVALUATION.md`; area and
timing: `docs/PHYSICAL.md`. Each records the commit SHA that produced it.
