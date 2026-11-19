# HBCI-02 architecture

Status date: 2026-10-26, branch `claude/clever-keller-507b3e`. Evidence labels: **CONCEPT** (proposed, not
implemented), **RTL** (simulated Verilog), **SYNTH** (synthesised logic), **LAYOUT** (place-and-route result),
**MEASURED** (physical hardware). Nothing in this project is MEASURED.

## 1. The two objectives, kept apart

| | Immediate test vehicle (HBCI-02) | Long-term system (Superhuman BCI, Level 4) |
|---|---|---|
| What | A digital ASIC: 8-channel neural DSP + on-chip neural-network inference + serial test interfaces | High-bandwidth, bidirectional, biohybrid interface between cortex and external AI |
| Status | RTL complete and verified; synthesised; physical design in progress | CONCEPT. Preserved as architectural boundaries (section 4) |
| Where the AI runs | On the silicon (`hbci_ai_decoder`) | Local inference on the implant, larger reasoning external |
| Biology | None. Bench device driven by recorded or synthetic digital samples | Electrodes, AFE, ADC, stimulation, encapsulation: separate programmes |

## 2. The chip we are building: HBCI-02 digital AI ASIC (RTL / SYNTH)

```
                     ┌──────────────────────────────── hbci02_chip_top (RTL) ───────────────────────────────┐
 external AFE/ADC ──►│ hbci_spi_samples ──► hbci02_digital_top ──────────────────────────────► hbci_rec_serial │──► records
 (24-bit SPI frames) │  (parity, 3 pins)   │                                                   (2 pins, 96-bit) │    (RAW/EVENT/FEATURE)
                     │                     │  hbci_readout_core (v0.3 DSP)        hbci_ai_decoder (v0.4 AI)     │
 host MCU/FPGA ◄────►│ hbci_spi_regbus ────┤   u_event   legacy comparator        u_quant   64·log2 + centre   │──► pred_strobe,
 (SPI, 4 pins)       │  (register map)     │   u_fstate  per-channel state+win    u_collect frame protocol      │    pred_class[1:0],
                     │                     │   u_biquad  band-pass Q2.14          u_model   46 words + CRC-32   │    pred_irq
                     │                     │   u_energy  window energy            u_engine  8→NH→NO MLP / linear│
                     │                     │   u_records arbiter + FIFO           pred FIFO (4 deep)            │
                     │                     │   hbci_bist LFSR + MISR (known-answer self-test)                  │
                     └─────────────────────┴───────────────────────────────────────────────────────────────────┘
 clk, rst_n, VDD/VSS
```

Chronological signal path (all RTL, all simulated end to end against a cycle-accurate reference):

1. **Digital input**: 16-bit signed samples with a 3-bit channel index, ADC style (no back-pressure). On the chip
   they arrive as 24-bit SPI frames (`{ch[2:0], 0000, parity, sample[15:0]}`); in simulation also as a parallel port.
2. **DSP** (`hbci_readout_core`, v0.3, unchanged behaviour): per-channel direct-form-I biquad (signed Q2.14
   coefficients, rounding, saturation), per-channel band energy over windows of 2^k samples, legacy threshold
   events, RAW passthrough; records with per-type sequence numbers, gap flags and drop counters through a 16-deep
   FIFO. v0.4 adds a per-channel 16-bit **window index** and a `feat_sync` resynchronisation.
3. **Neural features**: every completed window of every channel is tapped **before** the record FIFO
   (`ai_feat_*`: channel, energy, timestamp, saturation flag, window index). Output back-pressure cannot starve
   inference.
4. **On-chip AI** (`hbci_ai_decoder`, `docs/AI_DECODER.md`): log-domain quantiser (64·log2(E), per-channel centre
   and shift, int8); frame collector that only combines features with the **same window index** (missing,
   duplicate, late and over-span features are counted and never mixed); CRC-32-verified parameter block (no
   prediction until the loaded model is verified); 8→NH→NO MLP with ReLU and a programmable shift, or an
   8→NO linear model on the same silicon; argmax and margin; a 4-deep prediction FIFO with sequence numbers and
   gap/saturation flags; full diagnostics (x, h, logits of the last frame).
5. **Output**: predictions through the register bus (SPI) or the direct pins; records through the serial record
   output; counters and diagnostics through the register bus.

Numbers (SYNTH, Yosys + SKY130 HD liberty, cell area only, no layout; `make sky130-v04`, commit `3a0d2ec`):

| Block | Cells | Flip-flops | Cell area |
|---|---:|---:|---:|
| `hbci02_digital_top` (DSP + AI + registers + BIST) | 32,187 | 6,042 | 316,574 µm² |
| of which `hbci_ai_decoder` (NH = 4, NO = 2) | 10,707 | 2,387 | 114,351 µm² |
| `hbci_readout_core` alone (v0.3, for reference) | 18,577 | 3,155 | 174,484 µm² |

Genuine layout (LAYOUT, `docs/PHYSICAL.md`): `hbci02_chip_top` on SKY130 HD at 10 MHz, 1.04 × 1.05 mm die,
61,973 cells, DRC/LVS/antenna clean, timing met at 9 corners; core only (no padframe). The v0.2 event core's
layout (`studio/public/artifacts/layout/`) is a different, smaller chip.

## 3. What is real and what is conceptual

| Block | Label | Where |
|---|---|---|
| DSP, AI decoder, register file, BIST, SPI/serial wrappers | **RTL** (verified: `docs/VERIFICATION.md`), **SYNTH** | `rtl/`, `tb/`, `scripts/` |
| Model parameters (trained on DANDI 000019 ECoG) | software artefact, loaded over SPI | `experiments/E02_onchip_decoder/models/` |
| v0.2 event core place-and-route | **LAYOUT** (a different, smaller chip) | `studio/public/artifacts/layout/` |
| HBCI-02 place-and-route | **LAYOUT** (10 MHz, core only) | `docs/PHYSICAL.md`, `studio/public/artifacts/layout_v04/` |
| Padframe, ESD, package | **CONCEPT** (proposal in `docs/TEST_PLAN.md`) | — |
| Analogue front end, ADC | **CONCEPT**; external for the first chip (`docs/AFE_ADC_DECISION.md`) | — |
| Electrodes, implant power, telemetry, stimulation | **CONCEPT** (`docs/BIOHYBRID_INTERFACES.md`) | — |
| External decoder / LLM / feedback loop in the studio | **CONCEPT / SCRIPTED** (unchanged from v0.3) | `studio/` |

## 4. Boundaries preserved for the long-term system

| Boundary | Interface in HBCI-02 | What can change behind it without touching the rest |
|---|---|---|
| Neural sensing ↔ analogue acquisition | electrode connector of the external AFE | electrode material (graphene, polyimide, PEDOT:PSS, OECT needs its own AFE) |
| Analogue acquisition ↔ digital representation | 24-bit SPI sample frame, 16-bit signed, ≤ 8 channels | ADC resolution/rate, channel count (parameterised `NUM_CH`, `SAMPLE_W`) |
| Digital representation ↔ local inference | `ai_feat_*` tap (energy, window index, timestamp, sat) | feature definition (band, window) via registers; richer features would add tap fields |
| Local inference ↔ external reasoning | prediction records (class, margin, timestamp, frame id, seq, flags) and RAW/FEATURE records | the model (46-word block, CRC), NH/NO at synthesis; external models consume the same records |
| Future stimulation / feedback (WRITE) | **reserved only**: no stimulation logic exists; a future control boundary would be a separate register page and a separate safety-interlocked block | not implemented, no safety claim |

## 5. Versions

| Version | Content |
|---|---|
| v0.1 | reconstructed baseline event core |
| v0.2 | lint-clean event core, SKY130 layout at 40 MHz (LAYOUT) |
| v0.3 | readout core: RAW/EVENT/FEATURE/HYBRID records, FIFO, golden-model verification, SKY130 mapping |
| **v0.4 (HBCI-02)** | on-chip AI decoder, frame protocol, CRC model load, register file, BIST, SPI/serial chip top, cycle-accurate verification, SKY130 mapping; layout in progress |
