# AFE/ADC architecture decision (mandate section 11)

Date of research: 2026-10-26. Literature values are labelled **measured** (reported as silicon measurements in the
cited source), **reported** (stated in the source without a clear measured/simulated statement), **simulated**, or
**estimate** (mine). Repository values carry the repository evidence labels. Nothing here is MEASURED on HBCI-02
hardware; no analogue block exists in this repository.

## 1. The three architectures

| | A. External AFE/ADC + this digital ASIC | B. Integrated CMOS AFE/ADC on the same SKY130 die | C. Heterogeneous: flexible electrodes + separately optimised analogue and digital dies/chiplets |
|---|---|---|---|
| What exists today | Digital chip (RTL, SYNTH); SPI sample input defined (24-bit frames, 8 ch, 16-bit) | Nothing. No analogue designer, no device models beyond the open SKY130 PDK | Nothing beyond A; electrodes are CONCEPT |
| Neural signal fidelity | Set by the commercial AFE: e.g. Intan RHD2000 family 2.4 µVrms typical input-referred noise, 16-bit, up to 30 kS/s per channel (https://intantech.com/products_RHD2000.html, checked 2026-10-26; vendor figure) | Unknown. No published measured neural-grade (few-µVrms) amplifier in the SKY130 open-source flow was found (section 3) | Can reach the state of the art (section 2) if a proven analogue die is used; otherwise same gap as B |
| Input-referred noise | Vendor-specified; see §4 | Would have to be designed and measured; the reference points are Harrison & Charles 2003 (2.2 µVrms, 80 µW; abstract values, https://doi.org/10.1109/JSSC.2003.811979, page not readable in this session) and recent 0.18 µm designs at ≈3.1 µVrms (measured, §2) | Same as the chosen analogue die |
| Electrode compatibility | Any electrode delivering a voltage into the AFE's input range and impedance (Intan: AC-coupled, 0.1 Hz–20 kHz programmable band) | Must be designed in (input impedance, AC coupling, electrode DC offset ±tens of mV) | Flexible electrodes bonded to the analogue die; best match for high-density arrays |
| Silicon area | Digital only: 316,574 µm² cells (SYNTH), ≈0.55–0.8 mm² core (estimate) | Adds per-channel amplifiers + ADC: the only SKY130 open-source ADC with a stated area is the JKU 12-bit SAR at ≈0.175 mm² (reported, §3); 8 channels of amplifier + ADC would at least double the die (estimate) | Two dies; digital die unchanged |
| Power | Digital only; v0.2 core estimate 3.43 mW at 40 MHz (LAYOUT, default activity; not this chip). AFE power on its board | Adds analogue power; literature AFEs are 0.65 µW–80 µW per channel (§2) | As A plus die-to-die link |
| Interconnect parasitics | SPI at ≤ clk/6 over a PCB: tolerant | None between AFE and DSP | Chiplet/flex interconnect: bonding and parasitics become design items |
| Biological-interface flexibility | Highest: swap the AFE board per electrode type | Lowest: fixed by the die | High, but each electrode family needs its own analogue die/bonding |
| Fabrication access | SKY130 digital shuttles exist (docs/FABRICATION_READINESS.md) | Same shuttles accept analogue, but open-PDK analogue sign-off (no foundry-validated noise models for neural-grade work) is the gap | Needs two tape-outs or a proven commercial analogue die plus an interposer/flex process |
| Cost | One digital tape-out + commercial AFE ($286–$430 for an Intan chip; ≈$51–82 for an ADS1299; §4) | One mixed-signal tape-out plus analogue design labour and at least one analogue respin (estimate) | Two tape-outs or a commercial die plus assembly |
| Packaging | Standard QFN; AFE on the test PCB | Analogue pads need the harness analogue pins (Tiny Tapeout: ≤ 6 analogue pins, path R < 500 Ω, C < 5 pF, 4 mA; https://tinytapeout.com/specs/analog/) | Chip-on-flex / interposer: not available on the candidate shuttles without custom assembly |
| Verification complexity | Digital only: existing cycle-accurate suites; AFE verified by its vendor | Adds transistor-level simulation, Monte-Carlo, post-layout noise and ADC linearity sign-off, and silicon characterisation | Adds die-to-die link verification |
| Future bidirectional capability | Stimulation stays external and unimplemented; the WRITE boundary is a control boundary only (docs/BIOHYBRID_INTERFACES.md) | Would add high-voltage stimulation circuits that SKY130's 1.8 V/5 V devices and the open flow do not cover for neural stimulation in any published measured work found | Natural place for a stimulation die later; still not implemented |

## 2. State of the art for neural AFEs (literature; checked 2026-10-26)

| Source | Process | Input-referred noise | Power | NEF | Label |
|---|---|---|---|---|---|
| Harrison & Charles, JSSC 38(6):958–965, 2003, https://doi.org/10.1109/JSSC.2003.811979 | 1.5 µm CMOS | 2.2 µVrms | 80 µW | 4.0 | abstract values as commonly cited; Xplore page not retrievable here: treat as reported |
| MIT thesis (Wattanapanitch), https://dspace.mit.edu/handle/1721.1/40541 | AMI 0.5 µm | 3.06 µVrms | 7.56 µW at 2.8 V | 2.67 | measured |
| Sabancı AC-coupled front end, SSCL 2020, https://research.sabanciuniv.edu/id/eprint/46819/ | 65 nm | 3.1 µVrms (1 Hz–10 kHz) | 0.65 µW | 0.97 | measured |
| Biosensors 14(2):111, 2024, https://www.mdpi.com/2079-6374/14/2/111 | 0.18 µm | 3.1 µVrms | 3.8 µA at 1.8 V | 2.97 | measured |
| Intan RHD2000 family datasheet page, https://intantech.com/products_RHD2000.html | commercial | 2.4 µVrms typical | not on the page | — | vendor specification |
| Lee & Je, arXiv:2311.15538 (2023), https://arxiv.org/abs/2311.15538 | survey | NEF/PEF methodology across technologies | — | — | review |

Reading: a competent neural front end is 2–3 µVrms over the spike band at single-digit µW per channel in mature
processes; that is what the digital chip's 16-bit sample path should expect from its external AFE.

## 3. What has been demonstrated in SKY130 open-source analogue (checked 2026-10-26)

| Design | Claimed performance | Measured on silicon? | Source |
|---|---|---|---|
| TT06 8-bit SAR ADC (C. Wulff) | ENOB 7.63 bit, SNDR 47.7 dBFS, 4 MHz clock, 48 µA at 1.8 V | **No**: simulation; "Let's see when the IC comes back" | https://tinytapeout.com/chips/tt06/231 |
| JKU 12-bit non-binary SAR ADC (Austrochip 2023; e&i 141(1):76–87, 2024) | 1.44 MS/s, 703 µW at 1.8 V, ≈0.175 mm², 16-bit with decimation | **Not stated** on the abstract page | https://research.jku.at/en/publications/an-open-source-144-mss-703-%C2%B5w-12-bit-non-binary-sar-adc-using-448/ |
| Efabless EF_ADC (12-bit 1 MSPS), EF_INSTRAMP | target specifications only; "check back… once the silicon is characterized" | **No published characterisation**; the Efabless platform is no longer operated (Efabless closed 2025-03-01) | https://platform.efabless.com/design_catalog/ip_block/72 , /68 (last indexed before closure) |
| OpenFASOC temperature sensor generator | 64 instances verified in SkyWater 130 nm (IEEE SSC-L 2022) | yes, per the repository description; not a neural AFE | https://github.com/idea-fasoc/OpenFASOC |
| CINVESTAV "Silicluster v2" (filters, oscillators, op-amp) | characterisation structures | slides only | https://www.mos-ak.org/LA_2025/presentations/3_Munoz_MOS-AK_LA2025.pdf |
| Tiny Tapeout op-amp projects (e.g. ttsky25b/265) | op-amps | not reported as measured | https://tinytapeout.com/chips/ttsky25b/265 |

Finding: **no SKY130 open-source neural amplifier or ADC with published measured input-referred noise below
10 µVrms was found.** Every reported figure is simulated or unstated. Architecture B would therefore start from zero
evidence in this process, with no analogue designer and no foundry noise/mismatch models beyond the open PDK.

## 4. Recommendation: Architecture A for the first test chip

Architecture A has the strongest evidence (vendor-specified AFEs with datasheets and decades of use in
electrophysiology) and the lowest avoidable risk (the only new silicon is the digital chip that is already simulated
and partially synthesised). B is excluded for the first chip by the absence of any measured SKY130 neural AFE,
the absence of an analogue designer, and the certainty of at least one analogue respin. C is a later option once
A works and an electrode family is chosen.

### 4.1 Candidate external AFE/ADC parts (public figures, checked 2026-10-26)

| Part | Channels | Resolution | Sample rate | Noise | Interface | Price (public) | Fit to the 24-bit frame |
|---|---|---|---|---|---|---|---|
| Intan RHD2132 | 32, unipolar, common reference | 16-bit | up to 30 kS/s per channel | 2.4 µVrms typ. (family) | SPI slave, 16-bit transfers, SCLK ≤ 24 MHz, CS pulsed per transfer | QFN $430 (1–24), bare die $319; https://intantech.com/pricing.html | 16-bit sample copied directly into `sample[15:0]`; choose any 8 of 32 channels |
| Intan RHD2216 | 16, bipolar (differential) | 16-bit | up to 30 kS/s | 2.4 µVrms typ. | SPI | QFN $286 (1–24), bare die $216 | as above; cheapest Intan |
| Intan RHD2164 | 64 | 16-bit | up to 30 kS/s | 2.4 µVrms typ. | SPI | BGA "out of stock indefinitely", bare die $479 | not recommended (availability) |
| TI ADS1299 | 8, simultaneous | 24-bit ΔΣ | 250 SPS–16 kSPS | 1 µVpp over 70 Hz BW; CMRR −110 dB | SPI, TQFP-64 | ≈ $51–82 at qty 1 (distributor listings 2026-10-26: Newark ≈ $71.96, Arrow ≈ $49.42 for IPAGR); EEG-FE evaluation kit price **not retrieved** | bridge selects 16 of 24 bits (programmable shift); EEG/ECoG band only: 16 kSPS max; noise is specified for a 70 Hz band, not the spike band |
| TI ADS131M08 | 8, simultaneous | 24-bit ΔΣ | up to 32 kSPS | SNR 101 dB (dynamic range 80 dB at gain 64, 4 kSPS); µV-level input-referred noise **not retrieved** | SPI, TQFP-32/WQFN-32 | ≈ $7.02 at qty 1 for the IPBS tray variant (https://lisleapex.com.tw/product-ads131m08ipbs); Digi-Key/Mouser USD price not retrievable (403/timeout) | as ADS1299; cheapest route to an 8-channel 16+ bit stream at full 30 kS/s, but a metering ADC: neural-band noise must be measured on the bench |
| ADI ADAS1000 | ECG AFE (5 electrodes) | 24-bit | ECG rates | ECG grade | SPI | chip $27.61–44.61; EVAL-ADAS1000SDZ $216.49 (Digi-Key listing) | fallback for interface bring-up only; not a neural AFE |
| ADI AD7771 / AD7768-8 | 8 | 24-bit | — | — | — | **not retrieved**: analog.com unreachable from this session | blocker |

TI product pages: https://www.ti.com/product/ADS1299 , https://www.ti.com/product/ADS131M08 (specifications; prices not shown).

### 4.2 Concrete external interface for the first test chip

```
electrodes ─► Intan RHD2132 (or ADS1299 / ADS131M08) ─SPI master: bridge─► bridge MCU/FPGA ─SPI master─► HBCI-02 smp_* pins
                                                                            │
                                                             SPI master ────┴─► HBCI-02 spi_* register bus
                                                             rec_sdo/rec_sfrm ◄── HBCI-02 record output (1 bit per clk)
```

- **Bridge:** a Raspberry Pi Pico 2 (RP2350, $5 launch price, Aug 2024, https://www.guru3d.com/story/raspberry-pi-pico-2-release-specifications-and-pricing-just)
  using PIO state machines for the two SPI masters, or a small FPGA board (price not retrieved) if deterministic
  timing or the 1-bit-per-clock record stream at 20 Mbit/s must be captured without loss. Tiny Tapeout's demo
  board already carries an RP2040 (https://www.tinytapeout.com/specs/pcb).
- **Frame format into the chip (RTL, `rtl/hbci02_chip_top.v`):** 24 bits MSB first `{ch[2:0], 4'b0, parity, sample[15:0]}`,
  even parity over the other 23 bits, SPI mode 0, SCLK ≤ clk/6, one `in_valid` per complete frame while CS is low.
- **Bandwidth check (my arithmetic):** 8 channels × 30 kS/s × 24 bits = **5.76 Mbit/s**. With a 40 MHz core clock the
  limit is 40/6 = **6.67 MHz SCLK**, so full rate fits with 14 % margin and no CS gaps; at 20 kS/s it is 3.84 Mbit/s.
  If the full-design clock closes below 35 MHz, cap the per-channel rate (e.g. 20 kS/s) or use a higher core clock.
- **16-bit mapping:** Intan samples are 16-bit unsigned ADC codes: convert to the signed 16-bit code the DSP expects
  (subtract 32768) in the bridge. For 24-bit ADCs, take bits [23:8] by default and make the shift a bridge setting.
- **Timestamps:** the chip indexes samples per channel; the bridge must deliver channels in a fixed order per
  sample period so that `win_idx` alignment (docs/AI_DECODER.md §2) holds; a lost sample is recovered with `feat_sync`.

### 4.3 Executable integration plan (no purchases implied; each step needs the owner's go-ahead)
1. **Bench-less first:** extend the existing SPI testbench to replay a recorded 8-channel file through the frame format
   and check parity/drop counters (RTL only; no hardware).
2. **Bridge firmware on an FPGA or Pico 2 driving the Tiny Tapeout/FPGA emulation of the chip** (the Tiny Tapeout
   lending library and FPGA board exist for this purpose: https://tinytapeout.com/news/ 9 Oct 2026 post), using a
   synthetic sample generator in the bridge. Verify SCLK ≤ clk/6 timing and record capture.
3. **Choose the AFE:** default Intan RHD2216 ($286) for 16-bit direct mapping and bipolar inputs; ADS1299 if only EEG/ECoG
   bands (≤ 16 kSPS) are needed; ADS131M08 only after bench noise measurement in the 70–150 Hz and spike bands.
4. **Test PCB:** AFE + bridge + chip carrier; measure input-referred noise with inputs shorted through a 10 kΩ model
   electrode impedance, then with a signal generator through an attenuator (my test plan; no numbers claimed).
5. **Known-answer tests:** feed the recorded DANDI 000019 segment used by E01 through the AFE path at ADC-code level
   and compare records against the golden model (`scripts/`), then run the decoder BIST (`docs/AI_DECODER.md` §4).
6. **Document** measured drop counters, parity errors and latency on the real chip once it exists (MEASURED label).

## 5. What a future Architecture B feasibility study would need
- **Device models:** foundry-validated noise (1/f, thermal), mismatch and Monte-Carlo models. The open SKY130 PDK
  ships models, but no published measured SKY130 neural AFE validates them for µV-level design (§3).
- **A specialist:** an analogue IC designer with a neural-amplifier track record; the team has none.
- **Process or IP alternatives:** (a) a process with a mature analogue MPW ecosystem and models (e.g. IHP SG13G2, where
  Europractice provides a commercial PDK alongside the open one: docs/FABRICATION_READINESS.md §3 Route D),
  (b) validated commercial analogue IP, or (c) a measured open-source SKY130 AFE that does not yet exist.
- **Evidence gate:** at least one measured SKY130 amplifier at ≤ 5 µVrms over 1 Hz–10 kHz with published method,
  before any HBCI-02 die carries analogue circuits.
- **Harness constraints:** Tiny Tapeout allows ≤ 6 analogue pins with R < 500 Ω / C < 5 pF path limits; chipIgnite's
  38 I/Os support analogue signalling (https://chipfoundry.io/chipignite), but ESD and pad models for µV inputs are
  not documented on the pages read.

## 6. Decision record
- **Decision proposed:** Architecture A for the first test chip. Default AFE: Intan RHD2216 (bipolar, 16-bit, 30 kS/s)
  with an RP2350 or FPGA bridge; ADS1299 as the low-cost EEG/ECoG alternative.
- **Not decided:** which bridge (MCU vs FPGA) and which exact AFE; both depend on the chosen shuttle's board and on
  bench noise measurements.
- **No order placed.** All prices are list prices read on 2026-10-26 and change without notice.

## 7. Open blockers for this decision
| Blocker | Why it matters | Who clears it |
|---|---|---|
| ADS1299EEG-FE kit and AD7771/AD7768-8 prices not retrieved (analog.com unreachable; Digi-Key/Mouser pages returned 403/timeout on 2026-10-26) | cost column incomplete for two candidates | owner reads the distributor page at order time |
| ADS131M08 input-referred noise in the neural band not published as µVrms on the TI page | cannot rank it against Intan on fidelity | bench measurement, or TI datasheet noise tables (not read here) |
| Full-design core clock unknown until the physical run finishes | sets the SCLK ceiling (clk/6) and therefore the maximum per-channel sample rate | the physical-design engineer |
| Harness choice (Tiny Tapeout vs chipIgnite) | fixes the board, I/O voltage (3.3 V on the TT demo board) and bridge | owner, after docs/FABRICATION_READINESS.md |
