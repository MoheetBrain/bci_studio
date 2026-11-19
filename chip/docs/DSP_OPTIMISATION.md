# v0.3 DSP under HBCI-02: measurements and decisions (mandate section 7)

Numbers from `scripts/dsp_analysis.py` (run 2026-10-27, `build/dsp_analysis.json`, numpy, bit-exact fixed-point
model of `hbci_biquad`), from the v0.3 verification suites and from the SKY130 mapping (SYNTH). Timing and
critical-path numbers come from the LibreLane runs recorded in `docs/PHYSICAL.md` once published.

## 1. Digital filter (`u_biquad`)

**Arithmetic.** Direct-form I, five 16×16 signed products summed exactly in 35 bits, round-half-up by 2^13 then
arithmetic shift by 14, saturation to 16 bits with a flag. Verified bit-exact against the golden model on every
sample in the v0.3 suites (`v03_feature_golden`, 22 checks) and cycle-exact at gate level.

**Coefficient stability under quantisation** (Q2.14, independent double-precision RBJ design as reference):

| Design | Q2.14 coefficients b0,b1,b2,a1,a2 | Max response deviation (10–500 Hz) | Pole radius (float → Q2.14) | Stable |
|---|---|---:|---|---|
| 70–150 Hz at 2,000 S/s (synthetic profile) | 1801, 0, −1801, −27668, 12782 | 0.0012 dB | 0.88326 → 0.88326 | yes, margin 0.117 |
| 70–150 Hz at 3,051.76 S/s (DANDI 000019) | 1238, 0, −1238, −29620, 13908 | 0.0056 dB | 0.92135 → 0.92135 | yes, margin 0.079 |

**Sample-domain error on real ECoG** (8 channels × 30,000 samples of EC9_B15, int16 as in E01): the RTL output
differs from the double-precision design by **2.5–2.7 codes rms** (max 10 codes), of which >99.9 % is the
rounding of every output sample to an integer before feedback (the coefficient quantisation contributes
< 0.01 codes rms); filter output rms 63–129 codes; no saturation. For band-energy features the rounding
error is far below the energy's own variance and is deterministic (the software reference reproduces it).

**Pipelining.** The five products and the adder tree sit in one cycle between the channel-state register file
and its write-back, like the v0.2 EMA path that limited the v0.2 core to 40 MHz. Whether this is the critical
path of HBCI-02 and what clock it allows is a measured question answered in `docs/PHYSICAL.md`. If a higher
clock is needed, the change is a one-stage pipeline: register the five products, add in the next cycle, and
delay the state write by one cycle with a bypass for back-to-back samples of the same channel. Not done: the
mandate asks to optimise only when equivalence is preserved, and the measured need comes first.

**Cost.** 6,907 generic cells of the 18,932 of the v0.3 core (36 %), all combinational. A time-shared single
multiplier (5 cycles per sample) would cut that by roughly 4× at the price of a 5-cycle sample period; at the
rates of interest (8 channels × 30 kS/s = 240 kS/s against a 40 MHz clock) that is affordable, but it changes
the sample-per-clock contract of v0.3 and was not needed for timing. Recorded as an option.

## 2. Feature state and energy (`u_fstate`, `u_energy`)

| Item | Value | Comment |
|---|---|---|
| Square of y | 31 bits (exact) | −32768² fits |
| Energy accumulator needed | 2·16 − 1 + WIN_W = 41 bits | 2^10 windows of a full-scale square, no overflow |
| Energy accumulator in RTL | 48 bits | 7 spare bits × 8 channels = 56 flops; harmless, could be trimmed |
| Per-channel state | 4×16 (filter history) + 48 + 10 + 1 + 16 (window index, v0.4) = 139 bits | 1,112 flops for 8 channels |
| Output | sat32(acc ≫ energy_shift) | saturation flagged in the record and in the AI frame |

**Is one band-energy feature enough?** That is the question E02 (`docs/ML_EVALUATION.md`) answers on real data.
The tap and the frame protocol carry one energy per channel per window; a second band would be a second
biquad bank (another ~7,000 cells) or a time-shared second pass. The RAW and HYBRID modes keep the richer
representation available externally regardless.

## 3. Output bandwidth (precise definitions)

Definitions: a **RAW record** is 89 bits per 16-bit sample (type 2, channel 3, flags 4, seq 16, ts 32, data 32);
the chip serialises records as 96-bit frames. **Block packaging** (proposal, not implemented) is one 57-bit header
per block of N consecutive samples of one channel (type, channel, flags, block seq, ts of the first sample) plus
16 bits per sample; reconstruction is exact because under round-robin sampling sample i of the block has
ts = ts0 + i·NUM_CH, and any gap closes the block. FEATURE and EVENT are lossy reductions and are **not** counted
as compression.

For 8 channels at 3,051.76 S/s:

| Representation | Payload | Bits per sample |
|---|---:|---:|
| sample values only | 390.6 kbit/s | 16 |
| RAW records (v0.3/v0.4) | 2.17 Mbit/s | 89 |
| RAW serial frames (chip) | 2.34 Mbit/s | 96 |
| block packaging N = 32 | 434 kbit/s | 17.8 (−80 % vs records) |
| block packaging N = 128 | 401 kbit/s | 16.5 (−81.5 %) |

The chip's serial link at 40 MHz carries 416 k records/s, i.e. 8 channels at up to 52 kS/s in RAW with no
compression, so block packaging is not needed for the bench test; it is the first optimisation to make if the
link or a radio becomes the bottleneck.

## 4. Buffering and data integrity

Unchanged v0.3 mechanisms, all verified: 3 pending registers + 16-deep FIFO, per-type seq, gap flags, drop
counters (`generated = emitted + dropped` holds in every overload run), FIFO high-water mark. New in v0.4 and
verified in `top_adverse`: the decoder's features are tapped **before** the FIFO, so at full input rate with the
record output throttled to 5 % the decoder still received every completed window (feature tap cycle-exact
against the model) while RAW records were dropped and counted. Sequence wrap (SEQ_W = 8 in the reduced build) and
timestamp wrap (TS_W = 12) are covered by the reduced-width runs.

## 5. Clocking

Measured (`docs/PHYSICAL.md`): the v0.2 40 MHz result does not transfer. The v0.3 core alone fails 20 MHz by
21.7 ns at the slow corner and closes at 10 MHz with margins; the HBCI-02 chip closes at 10 MHz with +6.35 ns.
The limit is the single-cycle biquad + energy path; pipelining it (§1) is the identified change for 20–40 MHz.
The throughput contract at 10 MHz is one sample per clock into the DSP (10 MS/s, 40× the intended 8 × 30 kS/s)
and one frame per NH·8 + NO·N2 + 2 clocks into the decoder.
