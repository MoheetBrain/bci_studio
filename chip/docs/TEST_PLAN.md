# HBCI-02 test plan: pins, padframe proposal, design for test, bench setup

Status 2026-10-26. The chip is a **bench research device**. Nothing here is MEASURED; every number is from RTL
simulation or synthesis unless labelled otherwise. The register map is in `docs/AI_DECODER.md` section 4.

## 1. Engineered pin list (`rtl/hbci02_chip_top.v`)

| # | Pin | Dir | Function | Notes |
|---|---|---|---|---|
| 1 | `clk` | in | core clock | target set by the layout result (`docs/PHYSICAL.md`); the v0.2 core closed at 40 MHz |
| 2 | `rst_n` | in | asynchronous active-low reset | hold low ≥ 2 clock cycles; release synchronously to `clk` on the bench (RC + Schmitt or FPGA-driven) |
| 3–6 | `spi_sclk`, `spi_cs_n`, `spi_mosi`, `spi_miso` | in/in/in/out | register bus, SPI mode 0, MSB first, 40-bit transactions `{wr, addr[6:0], data[31:0]}` | SCLK ≤ clk/6 (inputs are double-synchronised and edge-detected in the core clock) |
| 7–9 | `smp_sclk`, `smp_cs_n`, `smp_mosi` | in | sample stream, SPI mode 0, 24-bit frames `{ch[2:0], 0000, parity, sample[15:0]}`, even parity | one `in_valid` per frame; bad parity dropped and counted (register 0x71) |
| 10–11 | `rec_sdo`, `rec_sfrm` | out | record output, 96-bit frames MSB first at one bit per `clk`, `rec_sfrm` high for the frame | receiver samples on `clk`; throughput = clk/96 records/s (40 MHz → 416 k records/s) |
| 12 | `pred_strobe` | out | one-cycle pulse per emitted prediction (when `CTRL.pred_direct_en`) | latency measurement with a logic analyser |
| 13–14 | `pred_class[1:0]` | out | class of the last emitted prediction (held) | |
| 15 | `pred_irq` | out | prediction FIFO not empty | host interrupt |
| — | `VDD`, `VSS` (core, 1.8 V), `VDDIO`, `VSSIO` (I/O, 3.3 V or 1.8 V) | power | | SKY130: 1.8 V core; I/O library `sky130_fd_io` is 3.3 V capable |

15 signal pins. With 4 core-power pads and 4 I/O-power pads: **23 pads**, which fits a QFN-32 or a 28-pin
DIP/ceramic package with room for spares, or a Caravel-style harness (the harness supplies its own pads; see
`docs/FABRICATION_READINESS.md`).

### Padframe proposal (CONCEPT: not yet placed)
- Square die, pads on all four sides; SKY130 `sky130_fd_io` GPIO cells (`sky130_fd_io__gpiov2`) with ESD
  protection inside the pad cell, 1.8 V core supply pads (`sky130_fd_io__top_power_hvc`), corner cells.
- Pin order by side (clockwise from the top-left corner), chosen to keep each interface's wires together and the
  fast `rec_sdo/rec_sfrm` pair next to `clk`:
  - North: `VDDIO`, `clk`, `rst_n`, `rec_sdo`, `rec_sfrm`, `VSSIO`
  - East: `VDD`, `spi_sclk`, `spi_cs_n`, `spi_mosi`, `spi_miso`, `VSS`
  - South: `VSSIO`, `smp_sclk`, `smp_cs_n`, `smp_mosi`, `pred_irq`, `VDDIO`
  - West: `VSS`, `pred_strobe`, `pred_class[0]`, `pred_class[1]`, spare, `VDD`
- Every input through a pad with a Schmitt-trigger option (SPI lines from a long cable); outputs 4 mA drive.
- The padframe has **not** been laid out; `docs/PHYSICAL.md` records the core-only result. Adding the frame
  (and the Caravel harness alternative) is a listed gap in `docs/GAP_REGISTER.md`.

## 2. Design for test

| Provision | Implemented | How it is used |
|---|---|---|
| Built-in self-test (`hbci_bist`) | yes (RTL, verified) | `CTRL.bist_en = 1`, `BIST_LEN = N`, `BIST_CTRL.clear`, `BIST_CTRL.start`: an on-chip xorshift32 source drives N samples (one every 4 clocks, channels round robin) through the DSP and the decoder; every record and prediction is folded into a 32-bit signature (`BIST_SIG`) with a count (`BIST_COUNT`). The expected signature for a configuration and model comes from the Python golden models (`scripts/check_top.py` bist profile) and is deterministic from reset |
| Known-answer inference test | yes | load a model, write `MODEL_CRC`, verify, enable; feed the exported test vectors (`experiments/E02_onchip_decoder/models/*_vectors.json`) as FEATURE energies by streaming the matching samples; compare class/margin and the diagnostic registers (`LAST_X`, `LAST_H`, `LAST_LOGIT*`) term by term |
| Register readback | yes | every configuration register and every model word reads back; ID register `0x48420204` |
| Model integrity | yes | CRC-32 over the 46 words, `MODEL_STATUS.valid/error`; writes while enabled are rejected and counted |
| Status and error reporting | yes | 7 DSP counters, 11 decoder counters, sticky `rejected`, prediction `gap`/`sat` flags, SPI frame count and sample parity-error count |
| Clock and reset verification | partly | `ID` read proves the SPI path and clock; `stat_samples` versus the number of frames sent proves the sample path; reset clears every counter (verified in RTL) |
| Scan chains / ATPG | **no** | Not inserted: the open flow has no scan insertion or ATPG; stuck-at coverage relies on BIST + functional tests. Listed as a gap |
| Parametric / IDDQ | no | bench only |

## 3. Bench-test setup

```
 PC (Python, scripts/golden_*.py) ──USB──► FPGA or MCU bridge ──SPI (reg)──► HBCI-02 ──rec_sdo/sfrm──► bridge ──► PC
                                             │   └─SPI (samples)──►   ▲   ──pred_strobe/class/irq──► logic analyser
                                             └─ clk, rst_n ──────────┘
 Bench supplies: 1.8 V core (current-limited, measured), 3.3 V I/O; oscilloscope; logic analyser
```

1. **Power**: core 1.8 V ± 5 % with current limit (expected tens of mW at most: the v0.2 core estimate was 3.4 mW
   at 40 MHz; the HBCI-02 estimate will come from `docs/PHYSICAL.md`), I/O 3.3 V. Power-up: supplies, then
   `rst_n` low, clock running, release reset.
2. **Bridge**: any FPGA board or a microcontroller with two SPI masters (register bus up to clk/6; sample stream)
   and a GPIO-capable capture for `rec_sdo/rec_sfrm` (a third SPI slave on the bridge clocked by the chip's `clk`
   output of the bench, or a logic analyser). Candidates: an iCE40/ECP5 board or an RP2040 (PIO) — chosen at
   PCB time (`docs/FABRICATION_READINESS.md`).
3. **Configure**: read `ID`; write the DSP configuration (threshold, coefficients, window, shift), `CH_MASK`,
   `FRAME_SPAN`.
4. **Load the model**: 46 words, `MODEL_CRC`, `MODEL_CTRL.verify`, poll `MODEL_STATUS.valid`; read back the
   words.
5. **Stream recorded neural data**: the `*_stream.txt` files (int16, 8 channels, from DANDI 000019 via the E02
   pipeline) as 24-bit frames; `CTRL.session_en = 1`, `ai_en = 1`, `feat_sync` first.
6. **Capture**: records from the serial output; predictions by polling `PRED_STATUS`/`PRED_*` + `PRED_ACK` or
   on `pred_strobe`.
7. **Compare**: `scripts/check_top.py --expected` against the ML pipeline's expectation per frame id; counters
   must equal the golden model's.
8. **Measure**: core current at idle, streaming without AI, streaming with AI (energy per inference = ΔP ×
   inference period); `pred_strobe` latency from the last sample of a window; maximum sample rate before
   `stat_drop_*` rise; maximum SPI clock; BIST signature at several clock frequencies and supply voltages
   (shmoo).
9. **Fault conditions**: reset mid-stream, wrong CRC, writes while enabled, lost samples (then `feat_sync`),
   FIFO overload (stop polling), parity errors on the sample link.

## 4. Test PCB (proposal)
A two-layer KiCad board (not drawn in this session; KiCad is not installed on this machine): QFN-32 or DIP socket
for the chip, 1.8 V and 3.3 V LDOs with current-sense jumpers, a header for the bridge SPI/GPIO lines, SMA for
`clk` in, test points on every pin, series resistors on the SPI lines. The schematic can be produced from the
pin list above in an afternoon once the package is chosen.

## 5. Expected measurements (RTL-derived; to be confirmed MEASURED)
| Quantity | Expected | Source |
|---|---|---|
| ID | `0x48420204` | register file |
| Inference latency (frame complete → prediction in FIFO) | NH·8 + NO·N2 + 4 clocks (NH = 4, NO = 2: 44; linear: 20) | cycle model, validated against RTL |
| Max sustained frame rate | one per NH·8 + NO·N2 + 2 clocks (busier frames are counted in `AI_BUSY`) | same |
| Record output | 96 clocks per record | serialiser |
| CRC verification | 184 clocks | model store |
| BIST signature | per configuration from `scripts/check_top.py` | golden models |
