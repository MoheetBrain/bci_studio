# HBCI-02 fabrication readiness (mandate section 14)

Date of research: 2026-10-26. Every external fact below carries its source URL and the date it was checked
(all 2026-10-26 unless stated). Numbers from the repository carry the repository's evidence label
(SYNTH, LAYOUT, RTL; see `system/hbci_system.json`). Where a value could not be determined, the row says so
and names the blocker. **No order, reservation, deposit or form submission may be made on the basis of this
document without the owner's explicit approval.** Nothing was ordered, reserved or submitted while preparing it.

## 1. What is being fabricated (repository facts)

| Item | Value | Label |
|---|---|---|
| Netlist | `hbci02_chip_top` wrapping `hbci02_digital_top` (`rtl/hbci02_chip_top.v`) | RTL |
| Signal pins | 14: `clk`, `rst_n`, SPI register bus ×4 (`spi_sclk`, `spi_cs_n`, `spi_mosi`, `spi_miso`), SPI sample stream ×3 (`smp_sclk`, `smp_cs_n`, `smp_mosi`), record out ×2 (`rec_sdo`, `rec_sfrm`), `pred_strobe`, `pred_class[1:0]`, `pred_irq`; plus power | RTL |
| Digital top, SKY130 HD mapping (Yosys, cell area only, no layout) | 32,187 standard cells, 6,042 flip-flops, 316,574 µm² cell area | SYNTH |
| Decoder alone | 10,707 cells, 2,387 flops, 114,351 µm² | SYNTH |
| Core area at 40–60 % utilisation (estimate from SYNTH, before padframe) | roughly 0.55–0.8 mm² | estimate |
| Reference point: v0.2 event core genuine layout | 0.063 mm² die for 19,615 µm² of cells (LibreLane 3.0.16, sky130A, 40 MHz met at 9 corners) | LAYOUT (v0.2 only; **not** this chip) |
| Core clock | tens of MHz expected; only the v0.2 core has a timing result (40 MHz) | LAYOUT (v0.2) |
| Analogue blocks | none; samples arrive from an external AFE/ADC over SPI (24-bit frames: 3-bit channel, 4 zero bits, parity, 16-bit sample), 8 channels, ~1–30 kS/s per channel | RTL |
| Physical design of the full design | in progress by another engineer; **no result is claimed here** | — |

The chip is a bench research device. It is not an implant and nothing in this document is an implant-readiness claim.

## 2. What happened to Efabless, and who runs SKY130 shuttles now

- **Efabless shut down on 1 March 2025** ("Efabless Corporation has shut down until further notice"). Tiny Tapeout
  TT08 was awaiting packaging, TT09 was still at SkyWater, TT10 and later SKY130 shuttles were paused.
  Source: https://tinytapeout.com/news/efabless-shutsdown/ (post dated 1 March 2025; checked 2026-10-26). Press:
  https://tomshardware.com/tech-industry/semiconductors/efabless-shuts-down-fate-of-tiny-tapeout-chip-production-projects-unclear
  and https://www.eenewseurope.com/en/tiny-tapeout-hit-as-efabless-closes/ (checked 2026-10-26).
- **ChipFoundry** (founded by the Efabless founders) restored SKY130 shuttle access in 2025 and now runs the
  chipIgnite programme and the shuttles Tiny Tapeout rides on. Sources: https://chipfoundry.io/ ,
  https://chipfoundry.io/chipignite , https://chipfoundry.io/commercial-terms (terms "last updated November 13, 2025"),
  https://tinytapeout.com/news/sky130-confirmed/ (26 June 2025),
  https://www.eenewseurope.com/en/tiny-tapeout-sees-industrial-boost-as-it-recovers-from-efabless-closure/ (16 May 2025). All checked 2026-10-26.
- **Tiny Tapeout** continues as an independent company with SKY130 (via ChipFoundry), IHP SG13G2 and GF180 (via
  wafer.space) shuttles. Source: https://tinytapeout.com/ and https://tinytapeout.com/news/ (checked 2026-10-26).
- **Cadence + SkyWater** run a separate SKY130 MPW aggregation service (bare die only, Cadence Pegasus DRC).
  Source: https://www.skywatertechnology.com/lowering-barriers-to-silicon-cadence-launches-mpw-aggregation-service-for-sky130/ (5 May 2025; checked 2026-10-26).
- **Foundry ownership:** IonQ's acquisition of SkyWater Technology became effective 31 July 2026; SkyWater continues
  as a foundry subsidiary. Sources: SkyWater 10-Q https://www.sec.gov/Archives/edgar/data/0001819974/000181997426000031/skyt-20260628.htm ;
  https://evertiq.com/design/2026-01-27-ionq-to-acquire-skywater-in-a-18b-deal (checked 2026-10-26). Treat the
  continuity of open SKY130 shuttles as a revision risk, not a certainty.

## 3. Candidate routes

### Route A: Tiny Tapeout on SKY130 (ChipFoundry shuttle)
| Requirement | Finding (source, checked 2026-10-26) |
|---|---|
| PDK | sky130A open PDK; projects are hardened per shuttle PDK (https://tinytapeout.com/faq/) |
| Harness | Tiny Tapeout tile mux; your design is one of hundreds on one die. Fixed pin set: `clk`, `rst_n`, `ui_in[7:0]`, `uo_out[7:0]`, `uio[7:0]` = 26 pins (https://tinytapeout.com/specs/gpio/) |
| I/O fit for 14 signals | **Fits**: 14 ≤ 26. Mapping proposal: `clk`, `rst_n` native; 7 inputs (`spi_sclk`, `spi_cs_n`, `spi_mosi`, `smp_sclk`, `smp_cs_n`, `smp_mosi` + spare) on `ui_in`; 6 outputs (`spi_miso`, `rec_sdo`, `rec_sfrm`, `pred_strobe`, `pred_class[1:0]`) + `pred_irq` on `uo_out`; `uio` unused (tie as spec requires) |
| Pad speed | max output frequency 33 MHz, max input 66 MHz, 4 mA drive, I/O 1.71–5.5 V, demo board 3.3 V I/O, not 5 V tolerant (same page). `rec_sdo` toggles at ≤ clk/2, so a 40 MHz core clock gives 20 MHz record bit-rate: within 33 MHz |
| Tile size | 1×1 tile "about 160×100 µm", "about 1000 digital logic gates" (https://tinytapeout.com/faq/); 2×2 = 334×225 µm, 1×2 = 160×225 µm, approximate (https://tinytapeout.com/specs/analog/) |
| Largest design | A project with an "8x4 TT footprint" is listed on shuttle SKY 26b (https://tinytapeout.com/chips/ttsky26b/), so 8×4 is accepted on current SKY shuttles. My estimate from the 2×2 figure: 8×4 ≈ 1,336 × 450 µm ≈ **0.60 mm²** |
| Area fit | **Marginal.** 316,574 µm² of cells (SYNTH) in ≈0.60 mm² means ≈53 % utilisation with no margin for the full-design layout result. **Not decidable until the physical-design run reports its die size.** Blocker: the pricing/size calculator (https://app.tinytapeout.com/calculator) is JavaScript-only and returned no text, so the maximum purchasable tile count and the exact 8×4 dimensions could not be read |
| Price | 70 € per tile (https://tinytapeout.com/specs/analog/, "minimum tile cost of 140€ (70€ per tile)"); analogue pins 40 €/100 € (not needed). Devkit "likely €300" per the 16 May 2025 eeNews article; current devkit price not readable (calculator blocker). 8×4 = 32 tiles ≈ **2,240 €** + devkit ≈ 300 € = ≈ **2,540 €** (my arithmetic; early-bird discounts exist but are once per person) |
| Die count | **1 chip per order** ("You only get 1 chip"; more chips require more devkit PCBs) (https://tinytapeout.com/faq/) |
| Packaging | QFN on a breakout/carrier board; demo board with RP2040 clocks designs up to 50 MHz (https://www.tinytapeout.com/specs/pcb). Package pin count not stated |
| Lead time | "between 6 and 9 months to manufacture… expect up to 1 year's wait time" (FAQ). Current example: TTIHP26b closed 21 Sep 2026, chips expected June 2027, shipping August 2027 (https://tinytapeout.com/news/) |
| Sign-off deliverables | tt-template flow (OpenLane/LibreLane harden, precheck in the TT tooling); designs are Apache-2.0 by default and public |
| Conditions | ChipFoundry may delay a shuttle below 50 % fill (eeNews, 16 May 2025). Designs are published open source |

### Route B: ChipFoundry chipIgnite (own die slot, Caravel/OpenFrame harness)
| Requirement | Finding (source, checked 2026-10-26) |
|---|---|
| Price | **$14,950 per tapeout** (https://chipfoundry.io/chipignite). Payment: $500 non-refundable deposit; 50 % of remainder 60 days before submission; balance 14 days before submission (https://chipfoundry.io/commercial-terms) |
| Included | fabrication of one design; **100 QFN-packaged parts or bare die**; 10 parts on M.2 daughter cards; evaluation board; test framework/firmware (commercial-terms page). Extra 50 bare die: $3,000 |
| Area / I/O | "Up to 15 mm² of die space with a standard I/O ring", "38 fully configurable I/Os supporting both digital and analog signaling" (chipIgnite page). Caravel user area 2.92 × 3.52 mm with 38 GPIO (https://caravel-harness.readthedocs.io/en/latest/getting-started.html); OpenFrame ≈15 mm², 44 GPIO, padframe + POR + ID ROM only, no SoC (https://info.efabless.com/knowledge-base/whats-the-difference-between-caravel-caravan-and-openframe). Our ≈0.55–0.8 mm² core and 14 signals fit with large margin |
| Schedule | CI2612: commitment 4 Nov 2026, tapeout 7 Dec 2026, delivery 25 May 2027. CI2705: 20 Mar / 19 May / 3 Nov 2027. CI2709: 24 Jul / 22 Sep 2027 / 8 Mar 2028 (https://chipfoundry.io/chipignite). Delivery "expected approximately 5 months after the submission deadline"; not guaranteed |
| Conditions | shuttle runs only above a "minimum customer commitment threshold"; cancellation gives refund or rollover; customer keeps IP, private designs allowed; academic pricing restricts to education/research (commercial terms) |
| Sign-off deliverables | harness-specific `user_project_wrapper`/OpenFrame wrapper, precheck (DRC, LVS, pin order, fixed configs). Exact 2026 checklist not published on the pages read: **blocker: request the current precheck list from ChipFoundry (reading only; no reservation)** |

### Route C: Cadence + SkyWater SKY130 MPW aggregation
$10,000 per design, 40 bare die, OASIS layout inside a 3.588 × 5.188 mm bounding box, DRC-clean under Cadence
Pegasus on SKY130 rules; no packaging; designers do their own bring-up. Announced 5 May 2025 with die delivery
September 2025 for the first run (https://www.skywatertechnology.com/lowering-barriers-to-silicon-cadence-launches-mpw-aggregation-service-for-sky130/).
A later run with submissions "open through January 16, 2026" was reported by
https://www.electronics-lab.com/cadence-and-skywater-detail-next-open-multi-project-wafer-shuttle-program/ (page returned HTTP 403
on fetch; only the search summary was readable: **unverified**). **Blocker:** needs Cadence tools/Pegasus access that the team does not have, and no padframe or packaging is supplied.

### Route D: IHP SG13G2 (open PDK) via Europractice or the IHP open-source programme
Requires porting the RTL to the IHP SG13G2 open PDK (new standard-cell library, new LibreLane/OpenROAD platform
files, re-run every physical step). The RTL is portable; none of the SKY130 physical work carries over.
| Item | Finding (source https://europractice-ic.com/schedules-prices-2026/ unless stated; checked 2026-10-26) |
|---|---|
| Standard MPW price | SG13G2: **7,300 €/mm² standard, 6,205 €/mm² discounted**; mini@sic 6,205 / 5,110 €/mm² |
| Open-source row | "SG13G2 (open source)": **2,800 €/mm²** (standard = discounted); requires "special conditions and a signed Open Silicon MPW Program Participation Agreement". Run-date cell reads "7*" but the month could not be parsed from the page: **blocker: read the schedule PDF** |
| Minimum | minimum charge equivalent to **0.8 mm²** (areas below 0.8 mm² on request). Minimum open-source charge ≈ 2,240 €; a 1.0 mm² die ≈ 2,800 € (my arithmetic) |
| Samples | 40 diced samples by default; 300 µm wafers |
| Discount eligibility | academic/research institution in the listed countries (EU-27 + UK and others), paid Europractice Full-IC membership, educational or publicly funded research. A private project pays standard price |
| Free academic shuttles | IHP-Open-DesignLib free MPW, funded by FMD-QNC (16ME083), **non-commercial only**, prefers designs < 2 mm², 4–6 months processing; 2025 tape-ins listed, **no 2026 dates published** (https://ihp-open-designlib.readthedocs.io/en/latest/) |
| Packaging | Europractice: 485 € setup per bonding diagram; plastic QFN 24 (5×5) 104 €, QFN 32 (5×5) 122 €, QFN 64 (9×9) 186 € per unit; minimum 10 packages (Fraunhofer/imec) or 5 (CMP); silicon ≤ 280 µm thick for Open-Pak (https://europractice-ic.com/services/packaging/asic-packaging/) |
| Tiny Tapeout on IHP | TTIHP26b closed 21 Sep 2026 (123 designs), chips June 2027 (https://tinytapeout.com/news/); IHP tiles are 1×2 / 2×2 templates only on the analogue page; digital maximum not read |

### Route E: GF180MCU via wafer.space (also Tiny Tapeout GF shuttles)
Not SKY130: a full PDK port. Run 2: full slot 20.12 mm² $7,500, half slot 9.93 mm² $4,500, **1,000 bare dies** per slot,
campaign closed 30 June 2026, delivery Q4 2026 (https://www.crowdsupply.com/wafer-space/gf180mcu-run-2 ; checked 2026-10-26).
Run 3 pricing not published at the time of checking. Relevant only if 1,000 dies and a 180 nm node are wanted.

### Routes not usable or not determinable
- **MOSIS:** announced SkyWater S130/S90 MPW access on 2022-11 (https://www.isi.edu/news/52624/...); **no public 2026 price list or schedule found. Blocker: quote required.**
- **Muse Semiconductor:** https://musesemi.com/order returned 404; the only public price handout (2018) lists TSMC nodes only. **Blocker: no SKY130 offering found.**
- **CMP / CIME-P:** https://mycmp.fr/ failed with a certificate mismatch; processes known publicly are ST/X-FAB/others, no SKY130. **Blocker: unreachable; no open-PDK process.**

## 4. Cost table per route (fabrication + packaging; test PCB and equipment in section 6)

| Route | Fabrication | Packaging | Dies/parts | Lead time | Source + date |
|---|---|---|---|---|---|
| A. Tiny Tapeout SKY130, 8×4 tiles | ≈ 2,240 € (32 × 70 €) | included (QFN on carrier + devkit ≈ 300 €, unconfirmed) | **1** packaged chip | 6–12 months after close | tinytapeout.com specs/analog, faq, eeNews 2025-05-16; checked 2026-10-26 |
| B. ChipFoundry chipIgnite | **$14,950** (+ $3,000 per extra 50 bare die) | included: 100 QFN or bare die, 10 on M.2 cards, eval board | 100 | tapeout 7 Dec 2026 → delivery 25 May 2027 (CI2612) | chipfoundry.io/chipignite, /commercial-terms; checked 2026-10-26 |
| C. Cadence/SkyWater aggregation | $10,000 | none | 40 bare die | ≈ 4 months (2025 run) | skywatertechnology.com 2025-05-05; checked 2026-10-26 |
| D1. IHP SG13G2 open-source row (Europractice) | 2,800 €/mm², min 0.8 mm² → ≈ 2,240–2,800 € | 485 € setup + 10 × 122 € (QFN32) ≈ 1,705 € | 40 | not parsed (blocker) | europractice-ic.com schedules-prices-2026, packaging; checked 2026-10-26 |
| D2. IHP SG13G2 standard (Europractice, private customer) | 7,300 €/mm² → ≈ 5,840 € for 0.8 mm² | as D1 | 40 | per 2026 schedule | same |
| D3. IHP free academic shuttle | 0 € (non-commercial only) | not stated | not stated | 4–6 months; no 2026 dates | ihp-open-designlib.readthedocs.io; checked 2026-10-26 |
| E. wafer.space GF180 half slot | $4,500 | none (bare die) | 1,000 | Run 2 closed; Run 3 TBD | crowdsupply.com; checked 2026-10-26 |

All currency conversions are deliberately omitted; the owner should convert at order time.

## 5. Readiness checklist (mandate section 14)

| # | Item | Status | Evidence / exact blocker |
|---|---|---|---|
| 1 | PDK compatibility and licensing | **IN PROGRESS** | RTL maps to sky130A / `sky130_fd_sc_hd` (SYNTH); the v0.2 core went through LibreLane 3.0.16 on open_pdks `8afc834` (LAYOUT). Blocker for DONE: the shuttle's required open_pdks/LibreLane versions must match; ChipFoundry's 2026 version pins were not published on the pages read |
| 2 | Top-level dimensions | **MISSING** | No layout of `hbci02_chip_top` exists. Blocker: the in-progress full-design physical run; do not use the v0.2 0.063 mm² figure |
| 3 | Padframe and ESD strategy | **MISSING** | Route A/B supply the padframe (TT mux pads; Caravel/OpenFrame I/O ring with ESD). Blocker: route not chosen; no pin-to-pad assignment file exists in `physical/` |
| 4 | Power and clock inputs | **IN PROGRESS** | Single `clk`/`rst_n`; external clock. Blocker: no decision on core supply (1.8 V) vs I/O (3.3 V on TT demo board) level shifting, and no reset synchroniser requirement is written for the board |
| 5 | Sign-off evidence (DRC/LVS/antenna/STA at corners) | **MISSING** | Exists for v0.2 only (LAYOUT). Blocker: full-design run result |
| 6 | Packaging | **MISSING** | Options known (QFN on TT carrier; 100 QFN or bare die on chipIgnite; Europractice QFN 24/32/64). Blocker: route not chosen |
| 7 | Bonding / bump | **MISSING** | Wire-bond QFN on all candidate routes; no bonding diagram. Blocker: die outline and pad list |
| 8 | Test access | **IN PROGRESS** | Register bus over SPI, BIST registers (`docs/AI_DECODER.md` §4, 0x3C–0x3E), `pred_*` pins (RTL). Blocker: no scan/JTAG; no board-level test plan tied to a package |
| 9 | Expected die count | **BLOCKED** on route | A: 1; B: 100; C: 40; D: 40; E: 1,000 |
| 10 | Fabrication and packaging cost | **DONE** (table §4) | Prices are public list prices checked 2026-10-26; chipIgnite terms dated 13 Nov 2025 |
| 11 | Test PCB and equipment cost | **IN PROGRESS** (§6) | Estimates only; AFE prices public; FPGA/MCU bridge and PCB are estimates |
| 12 | Engineering labour | **MISSING** | No labour estimate exists; §6 gives my rough task list. Blocker: owner's hourly basis and team availability |
| 13 | Schedule and lead times | **DONE** (per route, §3–4) | Earliest silicon: CI2612 delivery 25 May 2027 or a TT SKY shuttle ≈ 6–12 months after close |
| 14 | Yield and revision risk | **IN PROGRESS** (§7) | Qualitative; no yield data exists for this design |

## 6. Test PCB, equipment and labour (estimates, not quotes)

| Item | Figure | Source / label |
|---|---|---|
| AFE candidates (see `docs/AFE_ADC_DECISION.md`) | Intan RHD2132 QFN $430 (1–24 units), bare die $319; RHD2216 QFN $286 | https://intantech.com/pricing.html, checked 2026-10-26 |
| | TI ADS1299IPAG ≈ $51–82 at qty 1 across distributors | search of distributor listings 2026-10-26 (Newark ≈ $71.96; Arrow ≈ $49.42 for IPAGR); no single authoritative price |
| | TI ADS131M08IPBS ≈ $7.02 at qty 1 (one distributor, tray variant) | https://lisleapex.com.tw/product-ads131m08ipbs, checked 2026-10-26; USD price at Digi-Key/Mouser not retrievable (403/timeout) |
| Bridge MCU | Raspberry Pi Pico 2 (RP2350) $5 launch price | https://www.guru3d.com/story/raspberry-pi-pico-2-release-specifications-and-pricing-just (Aug 2024) |
| Bridge FPGA board | not priced | blocker: no price retrieved this session |
| Test PCB (2–4 layer, 5 units) | my estimate 100–400 € | estimate; no quote requested |
| Bench equipment | assume existing: oscilloscope ≥ 100 MHz, logic analyser, bench supply, SPI-capable host | estimate; buy-list only if the lab lacks them |
| Labour (my rough list) | pad/pin assignment and harness integration; full-design sign-off; board design and bring-up firmware; AFE bridge firmware; test plan execution | no hours given: blocker item 12 |

## 7. Yield and revision risk (qualitative)
- A first digital-only SKY130 design of ≈0.6–0.8 mm² on a mature 130 nm MPW is low yield risk, but **one chip (Route A)
  gives no statistics** and one bond or ESD failure ends the test campaign; Route B's 100 parts are the only route with
  spare parts.
- The dominant revision risk is logical, not physical: `hbci02_chip_top` has not been simulated at gate level on a
  SKY130 netlist and no RTL↔netlist equivalence has been run for any SKY130 netlist (`docs/HBCI02_AUDIT.md` §4).
- Shuttle risk: SKY130 shuttles depend on ChipFoundry meeting its commitment threshold and on SkyWater (now an IonQ
  subsidiary) keeping the open PDK line. IHP's open-source row depends on a signed participation agreement.
- Schedule risk: every route's earliest silicon is mid-2027; a respin doubles that.

## 8. Recommendation for the owner's decision (no action taken)
1. Wait for the full-design physical result (die size, timing) before choosing between Route A (cheapest, 1 chip,
   area-marginal) and Route B ($14,950, 100 QFN parts, ample area and I/O).
2. If the die exceeds what an 8×4 Tiny Tapeout slot can take, Route B is the only SKY130 route that supplies padframe,
   ESD, packaging and an evaluation board without new tooling. Its next commitment date is **4 Nov 2026** (CI2612); the
   following one is 20 Mar 2027 (CI2705).
3. Route D (IHP) is the fallback if SKY130 shuttles stop; budget a full PDK port.
4. **Any reservation or payment requires the owner's approval; this document authorises nothing.**
