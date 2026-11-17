# Research audit for HBCI-01 v0.3

Date: 2026-10-19. This audits the architecture-changing claims in the external research report.

**Inputs:**
- The report is supporting research, not a specification.
- The corrections come from the founder's advisor and are treated as the v0.3 build contract.
- The original report file and the contract file were **not available** in this session; their substance
  arrived as pasted text. Claims are marked as **verified here** (checked against a primary source in this
  session) or **taken from the contract** (not independently re-checked).

| # | Report claim | Finding | Status | Architectural consequence for v0.3 |
|---|---|---|---|---|
| 1 | BISC has 16,384 recording channels/electrodes | The paper's title reads "A wireless subdural-contained brain–computer interface with **65,536 electrodes and 1,024 channels**" (Nature Electronics, 2025-12-08, doi 10.1038/s41928-025-01509-9) | **Verified here** (Crossref metadata) | The studio distinguishes **electrode sites**, **recording channels** and **processing channels** instead of showing one channel count |
| 2 | 2 kHz sampling cannot capture 70–150 Hz high-gamma | Wrong as a sampling argument: Nyquist at 2,000 S/s is 1,000 Hz, so 150 Hz is well below it. Acquisition bandwidth, anti-aliasing and SNR still matter | **Verified here** (arithmetic) | The synthetic teaching profile uses 2,000 S/s/channel. The FEATURE path targets a configurable 70–150 Hz band. No 20 kHz requirement is imposed for this band |
| 3 | Use MC_Maze to compare continuous LFP with thresholded signals for covert speech | DANDI 000128 is "MC_Maze: macaque primary motor and dorsal premotor cortex spiking activity during delayed reaching". Variables measured: Units, ProcessingModule. Species: rhesus monkey. Licence: CC-BY-4.0. Files: a 690.6 MB train file and a 3.4 MB test file. No speech, and no continuous LFP is listed | **Verified here** (DANDI API) | MC_Maze is **not** usable for the proposed comparison. Milestone E must pick a dataset by checking its actual contents |
| 4 | Discard the event core because it causes a large semantic-decoding deficit | The deficit figures in the report are hypotheses, not measurements | Taken from the contract (consistent with the report text quoted to us) | **Keep the legacy event core** as the EVENT-mode comparator, with no claimed deficit. Any comparison must come from an experiment |
| 5 | Repurpose the threshold detector as an intentional neural "wake word" | No experiment shows that a threshold crossing reflects intent | Taken from the contract | **Not implemented.** v0.3 gates all capture with an explicit `cfg_session_en` session control. A future neural activation decoder is shown as unimplemented |
| 6 | A universal 40–80 mW ceiling decides implant safety | Heating depends on geometry, materials, operating conditions and tissue coupling (PMC10467159 per the contract) | Taken from the contract | The studio may compare **labelled power scenarios** but never computes an "implant safe" verdict |
| 7 | A learned tactile-semantic stimulation channel is the route to Level 4 | A proposed mechanism, not a demonstrated interface | Taken from the contract | Shown as a **research branch** with a software-only feedback contract. **No stimulation hardware, firmware or tissue connection** |
| 8 | Put manifold alignment, dimensionality reduction and neural tokenisation on the implanted ASIC | No hardware implementation or resource budget is given | Taken from the contract | Learned decoding, alignment and LLM inference stay **external** in v0.3. On-chip features are numbers, not semantic tokens or decoded thoughts |
| 9 | Metacognitive detection of severe cognitive bias | No evidence of a working detector | Taken from the contract | Not implemented, and no dashboard claims to judge thoughts |
| 10 | (implied) Event-only transmission is enough | Event output is lossy | Consistent with v0.2 | v0.3 adds **RAW** preservation (the digital values entering the block, under a capture contract) and **HYBRID** output. HYBRID **increases** payload |

## What RAW preservation means
RAW preserves the **digital sample values that enter `hbci_readout_core`**: channel, value and sample index,
during an enabled capture session. It cannot recover information lost before that point, in biological
sensing, analog filtering or digitisation. Dropped records are never silent: per-type sequence numbers, a gap
flag and drop counters make every loss visible.

## Neutral research questions (not pre-answered)
1. **Representation:** which task information survives RAW, EVENT, FEATURE and HYBRID?
2. **Decoder reliance:** how much does performance depend on neural evidence versus contextual priors?
3. **Stability:** does a specific adaptation method improve cross-session performance, on data that actually
   permit that test?

None of these is programmed to produce a predetermined winner.
