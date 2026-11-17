# Biohybrid interface boundaries (mandate section 12)

Date of research: 2026-10-26. This document records (1) the boundaries the HBCI-02 architecture preserves and
(2) what is published about candidate neural interface materials, so that a future decision can be made with
evidence. **None of the interfaces below is validated in this project. Materials are not interchangeable: a
coating, a substrate and a transducer type each change impedance, noise, bandwidth, charge-injection limits and
the acquisition front end they need.** No electrode has been connected to anything in this repository; the chip
has never received a biological signal. No stimulation is implemented and no safety claim is made.

## 1. Boundaries the architecture preserves

```
[neural sensing] ─► [analogue acquisition] ─► [digital representation] ─► [local neural inference] ─► [external reasoning]
   electrodes          AFE + ADC (external)      hbci_readout_core           hbci_ai_decoder              host decoder / LLM
   CONCEPT             CONCEPT (vendor parts)    RTL/SYNTH                   RTL/SYNTH                    CONCEPT / SCRIPTED
                                                                                                              │
[future stimulation and feedback] ◄──────────────────────── WRITE pathway: reserved control boundary only ◄───┘
   not implemented; no hardware, firmware or tissue connection; no safety claim
```

| Boundary | What crosses it | What HBCI-02 fixes | What it leaves open |
|---|---|---|---|
| Neural sensing → analogue acquisition | a voltage (electrodes) or a current (OECTs) at the transducer | nothing: the chip has no analogue input | electrode material, geometry, impedance, coupling |
| Analogue acquisition → digital representation | 16-bit signed samples, 8 channels, ~1–30 kS/s per channel, over SPI in 24-bit frames `{ch[2:0], 4'b0, parity, sample[15:0]}` (RTL, `rtl/hbci02_chip_top.v`) | the sample format and rate envelope | which AFE, gain, band, reference scheme |
| Digital representation → local inference | FEATURE windows (band energy per channel per window) tapped before the record FIFO (`docs/AI_DECODER.md` §1) | the frame protocol and numerics | the trained model (none exists) |
| Local inference → external reasoning | predictions `{class, margin, ts, frame_id, seq, flags}` and RAW/EVENT/FEATURE records | records are numbers, not semantic tokens; drops are counted, never silent | decoding, alignment, language-model reasoning stay external (`system/hbci_system.json` "not_in_scope") |
| External reasoning → stimulation/feedback (WRITE) | **nothing today** | a reserved control boundary: software-only feedback contract (ready / uncertain / request clarification), `docs/FEEDBACK_CONTRACT.md` | all stimulation hardware, charge balance, safety: not designed, not claimed |

The chip accommodates **any interface that ends in digital samples of the above shape**, and nothing else.

## 2. Interface candidates: published characteristics and fit

Electrode impedance is conventionally quoted at 1 kHz; several sources warn that the 1 kHz value alone does not
predict recording quality (Harris et al., Analyst 2015, https://pubs.rsc.org/en/Content/ArticleLanding/2015/AN/C4AN02362E ;
Han et al. 2024, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11014004/). All values below are literature values
(measured in the cited work unless marked); none were measured here.

### 2.1 Graphene electrodes
- Nanoporous graphene thin-film microelectrodes, 25 µm diameter: impedance ≈ 25 kΩ, charge injection 3–5 mC cm⁻², SNR > 10 dB
  for LFP in rodents (Viana et al., Nature Nanotechnology 2024, https://www.nature.com/articles/s41565-023-01570-5 ; checked 2026-10-26).
- Pristine graphene has high impedance from its quantum capacitance; platinum nanoparticles lower it while keeping
  transparency (Kuzum group, https://www.rdworldonline.com/platinum-nanoparticles-sprinkled-on-graphene-improve-brain-probes/).
- Review: Doğan & Bayram, J. Mater. Chem. B 13:10420–10439 (2025), https://pubs.rsc.org/en/Content/ArticleLanding/2025/TB/D5TB01040C ;
  older review Wei & Wang, Materials 2021, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8539724/ .
- Front end needed: voltage-mode, AC-coupled neural amplifier + ADC (Intan-class; `docs/AFE_ADC_DECISION.md` §4).
- **Fit to HBCI-02 unchanged: yes** (digital samples), via an external AFE. Transparency and stimulation capability are
  irrelevant to the digital chip.

### 2.2 Flexible polyimide and mesh electrodes
- Commercial polyimide probes electroplated with platinum: 50–1,000 kΩ at 1 kHz; recording quality did not improve
  monotonically with lower impedance (Han et al. 2024, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11014004/).
- Low-temperature-cured polyimide probes: Pt electrodeposition reduced 1 kHz impedance from ≈1.2 MΩ to ≈350 kΩ
  (Freitas et al. 2022, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9783888/).
- Chronic polyimide multisite probes stayed below 500 kΩ at 1 kHz after implantation
  (Löffler et al., https://research.uni-luebeck.de/de/publications/long-term-in-vivo-stability-and-frequency-response-of-polyimide-b/).
- Mesh electronics and ultra-flexible probes: review Hong & Lieber, Nat. Rev. Neurosci. 20:330–345 (2019),
  https://doi.org/10.1038/s41583-019-0140-6 .
- Front end needed: voltage-mode AFE with high input impedance (electrode impedance up to ≈1 MΩ: input impedance must
  be ≫ 1 MΩ at 1 kHz to avoid attenuation; Intan-class parts are designed for this).
- **Fit unchanged: yes**, 8 channels at a time.

### 2.3 Conducting-polymer PEDOT:PSS interfaces
- Porous PEDOT:PSS on gold: 1 kHz impedance from ≈395 kΩ (bare gold) to ≈22 kΩ
  (conference abstract, https://frontiersin.org/10.3389%2Fconf.FBIOE.2016.01.02156/event_abstract).
- PEDOT vs IrOx on 177 µm² sites: 23.3 ± 0.7 kΩ vs 113.6 ± 3.5 kΩ at 1 kHz; charge storage capacity 75.6 ± 5.4 vs
  28.8 ± 0.3 mC cm⁻² (https://www.frontiersin.org/articles/10.3389/neuro.16.007.2009/pdf).
- PEDOT/PPy nanotubes: impedance lowered by about two orders of magnitude (Abidian & Martin, Biomaterials; via
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2697029).
- Review of PEDOT electrodeposition on metal neural electrodes (UCL): thickness and charge storage scale with deposition
  charge density; 1 kHz impedance dominated by geometry and solution resistance (https://discovery-pp.ucl.ac.uk/id/eprint/10162807).
- Front end needed: voltage-mode AFE; the coating lowers impedance and thermal noise but changes nothing digital.
- **Fit unchanged: yes.** Caution: PEDOT:PSS delamination and long-term stability are coating-specific and not assessed here.

### 2.4 Organic electrochemical transistors (OECTs)
- In vivo ECoG with PEDOT:PSS OECTs (Khodagholy et al., Nat. Commun. 4:1575, 2013, https://pmc.ncbi.nlm.nih.gov/articles/PMC3615373/):
  peak transconductance **0.9 mS** (60 mS mm⁻¹ normalised), channel 6 µm × 15 µm, operating point V_D = −0.4 V, V_G = 0.3 V;
  epileptiform spikes 44 dB SNR (OECT) vs 24.2 dB (surface electrode); drain-current signals of 0.3–1.5 µA on a
  background of 3–23 nA.
- Inkjet-printed OECTs for ECoG: transconductance 11 mS, response 0.5 ms (2024, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11492168/).
- Reviews: Rivnay et al., Nat. Rev. Mater. 3:17086 (2018), https://doi.org/10.1038/natrevmats.2017.86 ; Zhong, Saleh & Inal,
  Macromol. Biosci. 2021, https://bioel.kaust.edu.sa/publications/detail/decoding-electrophysiological-signals-with-organic-electrochemical-transistors .
- Front end needed: **current-mode readout** (drain bias, transimpedance amplifier or current-input ADC) with a
  gate/reference bias, not a voltage-mode neural amplifier.
- **Fit unchanged: no.** A different AFE (transimpedance stage) is required before the samples look like the chip's
  16-bit voltage-derived codes. Once such an AFE exists and digitises to 16 bits at ≤ 30 kS/s, the digital chip is
  unchanged; the gain (µA per mV) must then be folded into the bridge's scaling.

### 2.5 High-density cortical surface arrays
- Precision Neuroscience Layer 7: 1,024 electrodes in ≈1.5 cm², 400 µm pitch, platinum on polyimide, 50–380 µm
  diameters (https://precisionneuro.io/product ; 4,096 electrodes placed temporarily in one patient, April 2024,
  https://www.fiercebiotech.com/medtech/precision-neuroscience-deploys-4096-electrodes-brain-computer-interface-procedure).
- "Neural Matrix": multiplexed thin-film array, 28 × 36 electrodes (1,008 channels) in non-human primates, > 1 year
  (Chiang et al., Sci. Transl. Med. 12:eaay4682, 2020, https://doi.org/10.1126/scitranslmed.aay4682).
- BISC: 65,536 electrodes, 1,024 simultaneous channels (Nature Electronics 2025, doi:10.1038/s41928-025-01509-9;
  already cited in `system/hbci_system.json` for scale literacy).
- Front end needed: on-array or headstage multiplexing and digitisation; these systems ship with their own ASICs.
- **Fit unchanged: partially.** HBCI-02 takes 8 processing channels; a high-density array can feed it only through an
  external selector (8 of N) or a pre-reduced stream. Electrode sites, recording channels and processing channels
  are distinct counts (`docs/RESEARCH_AUDIT.md` claim 1).

### 2.6 3D and penetrating interfaces
- Neuropixels 2.0: 5,120 TiN sites on four shanks, 384 simultaneous channels, integrated base electronics
  (https://www.neuropixels.org/probe2-0). Impedance value not stated on the page.
- Utah arrays (Blackrock): platinum tips 20–800 kΩ, SIROF tips 1–80 kΩ, lengths 0.75–1.5 mm (Slant Array page,
  https://blackrockneurotech.com/?p=1453 ; test frequency not stated).
- Neuralink N1: 1,024 electrodes on 64 threads (company page, https://www.neuralink.com/ ; no peer-reviewed specification found).
- Review of penetrating electrodes: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11078330/ (2024).
- Front end needed: voltage-mode; Neuropixels-class probes include it on the probe and output digital data over their
  own link.
- **Fit unchanged: yes for ≤ 8 channels of 16-bit samples via an external AFE; no for probe-native links**
  (Neuropixels data must be re-serialised by a bridge into the chip's SPI frames).

### 2.7 Living-electrode research
- Tissue-engineered axonal tracts ("living electrodes"): Serruya et al., Adv. Funct. Mater. 2017
  (https://www.med.upenn.edu/cullenlab/engineered-axonal-tracts-as-living-electrodes-for-synaptic-based-modulation-of-neural-circuitry.pdf);
  optically controlled versions with in vivo optical recording (Adewole et al., Sci. Adv. 2021, via
  https://pure.psu.edu/en/publications/development-of-optically-controlled-living-electrodes-with-long-p/);
  overview in Front. Neurosci. 13:269 (2019), https://doi.org/10.3389/fnins.2019.00269 .
- Electrical characteristics: none in the sense of impedance or gain; the readout is optical (calcium imaging) or
  via a conventional electrode at the construct's proximal end.
- **Fit unchanged: no** (no electrical sample stream), unless paired with a conventional electrode + AFE, in which
  case the chip sees ordinary samples. Research-stage only.

## 3. Summary table

| Candidate | Typical published figure | AFE type required | HBCI-02 digital interface unchanged? |
|---|---|---|---|
| Graphene (nanoporous) | ≈25 kΩ at 25 µm (Viana 2024) | voltage, AC-coupled | yes |
| Polyimide flexible | 50 kΩ–1.2 MΩ at 1 kHz | voltage, high input impedance | yes |
| PEDOT:PSS coating | ≈22–23 kΩ vs 100s of kΩ bare | voltage | yes |
| OECT | gm 0.9–11 mS; µA drain-current signals | **current-mode (transimpedance)** | **no** without a different AFE |
| High-density surface arrays | 1,024 ch per array (Layer 7, Neural Matrix) | multiplexed, vendor ASIC | partially (8 of N) |
| 3D / penetrating | Pt 20–800 kΩ, IrOx 1–80 kΩ (Utah); 384 ch (Neuropixels) | voltage; probe-native electronics | yes for 8 ch via AFE; no for native links |
| Living electrodes | no electrical spec; optical readout | n/a | no |

## 4. Statements the project makes, and does not make
- The chip's READ path accepts digital samples; it is agnostic to electrode material only because the material's
  effects are absorbed by an external AFE that this project has not built or tested.
- Materials are not interchangeable. Impedance, noise, charge-injection limit, stability and biocompatibility are
  properties of a specific electrode, coating, geometry and deposition process, not of a material class.
- The WRITE pathway (stimulation and feedback) is **reserved as a control boundary only**: it exists as a software
  contract and a place in the architecture diagram. No stimulator, charge-balanced driver, current limit, or tissue
  connection is designed, implemented or claimed. Nothing in this repository is implant-ready or safety-assessed.
- No interface above has been validated with HBCI-02 hardware; the chip has not been fabricated.
