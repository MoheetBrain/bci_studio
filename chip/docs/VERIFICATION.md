# HBCI-01 v0.2/v0.3 — Verification, lint and synthesis record

> **v0.3:** the readout core `hbci_readout_core` (RAW, EVENT, FEATURE and HYBRID records) is recorded
> in [v0.3 readout core](#v03-readout-core-hbci_readout_core) at the end of this file. The v0.2
> sections below are unchanged and still pass in the same `make artifacts` run.

This file records what the hardware flow checks, how to run it, and the results it produced. The
Verilog in `rtl/hbci_event_core.v` is authoritative. Every number below comes from
`make artifacts`, run on 2026-10-19 with the tools listed at the end. The same numbers are in
`studio/public/artifacts/verification.json`, `synth_stats.json` and `schematics.json`.

> **Scope.** This is a digital event core only. The work here is functional simulation, an
> equivalence check, lint, and generic logic synthesis. There is no timing analysis, no PDK, no
> physical design and no measured hardware. Nothing below is a claim about timing closure, power,
> silicon area or fabrication readiness. The SKY130 place-and-route run (timing, area, DRC/LVS) is
> recorded separately in `docs/PHYSICAL.md`.

## How to run

The tools live in `~/.local/opt` (OSS CAD Suite, Node 24). The Makefile calls them by absolute path
through the `OSS` / `NODE_BIN` variables, so you don't need to set up `PATH`. Python is the system
`/usr/bin/python3` (3.9, standard library only), run with `-I`.

| Target | What it does |
|---|---|
| `make sim` | v0.1 directed testbench `tb/tb_hbci_event_core.v` (Icarus). Fails unless it prints `PASS`. |
| `make test` | Runs every suite below, writes `verification.json`, and exits non-zero if any suite fails or lint reports any warning. |
| `make lint` | `verilator --lint-only -Wall` on three configurations (shipped; `NUM_CH=6`; reduced widths). Fails on any warning. |
| `make synth` | Hierarchical generic Yosys synthesis (`synth/synth_hier.ys`) → `synth_stats.json` and `yosys_stat.json`. |
| `make schematics` | Per-module RTL and gate schematics (Yosys JSON + netlistsvg SVG) → `schematics.json`. |
| `make trace` | 8-channel scenario run through the RTL → `rtl_trace.json` and `build/hbci_scenario.vcd`. |
| `make modules` | Module, port and connection structure → `rtl_modules.json`. |
| `make v03`, `v03-gate`, `v03-mutation`, `trace-v03`, `sky130-v03` | The v0.3 readout-core suites, gate level, negative control, studio trace and SKY130 mapping (see the v0.3 section). |
| `make artifacts` | Everything above (v0.2 and v0.3), then `manifest.json` and a contract check of every JSON against `studio/src/artifacts/types.ts`. About 2.5 min (v0.2 alone took about 65 s). |
| `make clean` | Removes `build/`. Generated artifacts are kept. |

The individual suite targets are `directed`, `random`, `gate`, `mutation` and `equiv`.

## Results summary (`make artifacts`, all pass)

| Suite | Tests | Result | What it shows |
|---|---:|---|---|
| `tb_hbci_event_core` | 15 | 15 pass | The v0.1 testbench. The checks are unchanged; v0.2 only adds a machine-readable `RESULT` line per check. |
| `tb_hbci_directed` | 55 | 55 pass | v0.2 directed tests in 8 categories, using two DUT instances (`NUM_CH=8` and `NUM_CH=6`). |
| `random_vs_golden` | 28 | 28 pass | 4 seeded random runs: RTL compared with the Python golden model at every accepted sample and every event. |
| `gate_level_vs_golden` | 32 | 32 pass | The same 4 runs on the synthesised gate netlists, compared with the golden model and cycle by cycle with the RTL runs. |
| `scenario_trace` | 8 | 8 pass | The studio scenario compared with the golden model, plus a cross-check of the VCD waves against the log. |
| `mutation_sanity` | 8 | 8 pass | Negative control: 8 deliberately broken RTL copies, all caught by the regression. |
| `yosys_equiv_v01_v02` | 1 | pass | The v0.2 RTL is logically equivalent to the `v0.1-baseline` RTL: 1242 of 1242 `$equiv` cells proven. |
| **Total** | **147** | **147 pass** | |
| Lint (Verilator 5.053 `-Wall`) | 3 configs | **0 warnings, 0 errors** | v0.1 had 10 warnings. |

## 1. Lint and RTL changes in v0.2

v0.1 produced 10 Verilator `-Wall` warnings:

| Warning | Count |
|---|---:|
| `DECLFILENAME` | 1 |
| `WIDTHTRUNC` | 1 |
| `WIDTHEXPAND` | 6 |
| `UNUSEDSIGNAL` | 2 |

v0.2 is lint-clean (0 warnings) for the shipped parameters, for `NUM_CH=6`, and for the reduced set
`NUM_CH=2 CH_W=1 SAMPLE_W=4 FRAC_W=2 TS_W=4 REFR_W=3`. The edits are behaviour-neutral:

- **`DECLFILENAME`:** one file-level `lint_off`/`lint_on` pair. All modules intentionally stay in one
  file.
- **`ch < NUM_CH` (2×):** the channel index is zero-extended to 32 bits before the range compare.
- **`base_int`:** now `baseline_q[BASE_W-1:FRAC_W]`. These are the same bits as
  `baseline_q >>> FRAC_W` truncated to `SAMPLE_W`, which is floor division in two's complement.
- **`sample_x`, `base_x`, `sample_q`, `base_q_x`:** sign extension is now written out explicitly as
  concatenations.
- **`negated`:** computed as `~residual[SAMPLE_W-1:0] + 1`, at `SAMPLE_W` bits. This is exact because
  |residual| ≤ 2^SAMPLE_W − 1.
- **`sum_q`:** the guard bit is never read. A targeted `UNUSEDSIGNAL` waiver covers this one line. The
  claim that the guard bit always equals the sign bit is checked at every accepted sample by
  `tb_hbci_stream.v` (`K guard_bit 0` in all runs).
- **`ev_push`:** `accept & fire` is now a named wire, so connections and schematics show a readable
  net name.

**Equivalence.** `synth/equiv_v01_v02.ys` proves that v0.2 and the `v0.1-baseline` RTL are logically
equivalent: 1242 `$equiv` cells, 1242 proven, 0 unproven. Settings: shipped parameters, flattened,
`equiv_simple -seq 2` + `equiv_induct`. The asynchronous reset is modelled synchronously
(`async2sync`), so the proof covers clocked behaviour, not reset-release timing.

**RTL bugs found:** none. No functional defect turned up in any suite, and the RTL behaviour is
unchanged from v0.1.

**Testbench bug found and fixed:** directed check `CH-04` first failed because the previous check's
event was still in the output slot when the test recorded its event-count baseline. A `settle` step
was added. This was a bug in the new testbench, not in the RTL.

## 2. Directed tests (`tb/tb_hbci_directed.v`, 55 checks)

Each check prints `RESULT <id> <category> PASS|FAIL <name> <detail>`. The checks read internal
state through hierarchical references (`dut.u_state.baseline[k]`, `armed`, `refr`, `residual`, …).

| Category | Checks | Highlights |
|---|---:|---|
| `reset` | 5 | Outputs and counters stay 0 while `rst_n` is low, even with `in_valid` high. All channels reset to unprimed, armed, refractory 0, baseline 0. The first sample primes the channel (residual 0, no event). An **asynchronous mid-cycle reset** immediately clears state, counters and a pending event. Timestamps restart at 0. |
| `invalid_input` | 7 | 60 idle cycles with pseudo-random garbage on the bus change no state. **X on the bus** while `in_valid` is low reaches no state register or handshake. With the `NUM_CH=6` instance, out-of-range handshakes (channels 6 and 7) are consumed, counted in `stat_rejected`, and leave state, timestamp and events untouched. An out-of-range handshake stalls while the slot is full. The read port returns a neutral state for out-of-range channels. |
| `threshold_boundary` | 10 | Residual thr−1 / thr / thr+1 for both polarities. `threshold=0` disables detection even at a residual of 65535. `threshold=65535` fires only at ±65535. hyst = thr and hyst > thr both clamp the re-arm level to 1. hyst = thr−1 gives re-arm level 1 and thr−2 gives level 2. The re-arm boundary 80/79 holds for (100, 20). |
| `channel_state` | 6 | Eight interleaved channels keep independent baselines, both exact at alpha 0 and matching the reference EMA formula at alpha 3. An event disarms only its own channel. Refractory is per channel, and other channels' samples do not count it down. `primed` is per channel. An 8-channel round-robin gives exactly the expected `(ch, ts, pol, mag)` list. |
| `refractory` | 8 | Refractory values 0, 1, 3, 7 and 255 give event gaps of max(R+1, 2) samples (gap 256 for R=255). The counter saturates at 0 and never wraps. A sub-threshold sample re-arms the channel during refractory. Changing `cfg_refractory` mid-countdown does not reload the running counter. |
| `signed_arithmetic` | 10 | Residual +65535 and −65535 without overflow. The baseline register holds −2^23 and 32767·256. A fractional baseline of −0.5 floors to −1 and +0.5 floors to 0. alpha 0 follows the sample exactly. alpha 15 takes the smallest floor steps. The EMA converges from below to within 2^alpha LSB and exactly from above. 600 random samples with random alpha match the reference formula. |
| `timestamp` | 4 | Event timestamp equals the index of the accepted sample that fired (28 events). Timestamps strictly increase. `stat_samples` and `stat_events` are consistent. Idle cycles do not advance the timestamp. |
| `backpressure` | 5 | Pseudo-random `ev_ready` with 160 dense events and 184 stall cycles: the output equals the expected list exactly (no drop, no duplicate, order kept). `in_ready == !ev_valid \|\| ev_ready` on every cycle. `ev_valid` and the payload stay stable while stalled. A drain and a push in the same cycle deliver both events. After draining, `stat_events` equals the number of handshakes. |

## 3. Golden model and random regression

`scripts/golden_model.py` is a bit-accurate transaction-level model written from the specification
in the RTL header, not from the netlist. It uses unbounded Python integers and checks that every
result fits its RTL width. `scripts/gen_stim.py` writes seeded stimulus files (80-bit `$readmemh`
words: channel, sample, the full configuration, idle cycles, reset pulses). The stimulus mixes these
configuration blocks:

- thresholds of 0, 1, small, mid, large and 65535
- hysteresis below, equal to and above the threshold
- refractory values 0, 1, small, large and 255
- alpha 0 to 15

It also mixes these signal regimes:

- noisy baseline with spikes of both polarities
- full-range uniform
- extremes
- steps
- a dense-event pattern

Channel order can be random, a single-channel burst, or round robin. There are idle cycles with
garbage on the bus and random reset pulses (the output is drained before each reset).

`tb/tb_hbci_stream.v` drives the stimulus and logs every accepted sample's internal RTL values, every
event handshake, every rejected handshake and the final counters. `scripts/compare_golden.py` then
checks:

- every sample's baseline, residual, magnitude, above, re-arm, armed, refractory, primed and fire
  values
- the event stream, one for one and in order
- the counters per reset segment
- the rejected count
- the testbench consistency counters: EMA guard bit, timestamp vs sample count, accept vs
  handshake, the `in_ready` rule, and stalled-payload stability
- causality: each event leaves after its sample was accepted

| Run | Configuration | Ops | Samples compared | Events | Other |
|---|---|---:|---:|---:|---|
| `s1_ch8` | shipped, seed 1, `ev_ready` 50% | 30000 | 29933 | 907 | 68 reset segments, 882 stall cycles |
| `s2_ch6` | `NUM_CH=6`, seed 2 | 20000 | 15205 | 699 | 4752 rejected handshakes |
| `s3_reduced` | reduced widths, seed 3 (TS_W=4, so timestamps and counters wrap) | 15000 | 14977 | 909 | 24 segments |
| `s4_dense` | dense events, seed 4, `ev_ready` 30% | 20000 | 19960 | 2987 | 6790 stall cycles |

Result: **28/28 pass**. RTL and golden model agree on every compared sample and event.

**Negative control (`scripts/mutation_check.py`).** Eight mutants, each with one injected bug, were
run through the same regression in `build/mutants/` (the real RTL is untouched). All 8 were
detected:

- `>=` changed to `>` in the threshold compare
- the re-arm clamp compare changed from `>=` to `>`
- the refractory counter never decrements
- the EMA uses a logical instead of an arithmetic shift
- the timestamp is off by one
- no back-pressure
- no priming
- rejected handshakes are accepted

This shows that the comparison is not vacuous.

## 4. Post-synthesis gate-level simulation

The gate-level netlists are written by Yosys `write_verilog -noattr` from the same generic synthesis
(hierarchy kept), and simulated with Yosys `simcells.v`. The testbench is the same one compiled with
`-DGATE` (internal-net logging is off; only the ports are observed).

| Run | Netlist | Cells | Result |
|---|---|---:|---|
| `gate_s1_ch8` | `gate_ch8.v` (shipped) | 2003 | 8/8 pass, cycle-exact vs RTL |
| `gate_s2_ch6` | `gate_ch6.v` (`NUM_CH=6`) | 1824 | 8/8 pass, cycle-exact vs RTL |
| `gate_s3_reduced` | `gate_reduced.v` (reduced widths) | 280 | 8/8 pass, cycle-exact vs RTL |
| `gate_s4_dense` | `gate_ch8.v`, dense events, `ev_ready` 30% | 2003 | 8/8 pass, cycle-exact vs RTL |

In each run, every accepted sample, event, rejected handshake and counter matches the golden model.
The accept, event and reject lines, including their clock cycle, are identical to the RTL run.

The gate-level simulation is zero-delay and functional. There is no SDF back-annotation and no
timing.

## 5. Scenario trace for the studio (`rtl_trace.json`)

`scripts/make_scenario.py` produces seeded synthetic data (seed 2026). It is **not a neural
recording**. Configuration: 8 channels × 400 samples, round-robin order (3200 samples), threshold
600, hysteresis 150, refractory 8, alpha_shift 5. Each channel gets:

- a DC offset
- slow drift: a sinusoid on every channel, plus a linear ramp on channels 6 and 7
- AR(1) noise; channel 4 is noisy (σ 150)
- 6 to 9 injected biphasic spikes, mostly negative-going; 6 of these are deliberately below
  threshold

The scenario also contains artefacts that are not spikes:

- a +1400 step on ch2 (n=150)
- a noise burst on ch5 (n=262–275)
- a one-sample pop on ch0 (n=331)
- a common-mode transient on all channels (n=372–374)

The testbench logs internal RTL values at every accepted sample, read by hierarchical reference
(`dut.in_sample`, `st_baseline`, `residual`, `magnitude`, `above`, `below_rearm`, `st_armed`,
`st_refr`, `st_primed`, `fire`). It also dumps `build/hbci_scenario.vcd`. A stdlib VCD parser
(`scripts/vcd.py`) samples 12 signals at every rising edge into change lists for `waves`.

The bus holds its value during idle cycles in this run (`+idle_hold=1`), so the waves stay readable.
`ev_ready` is high 75% of the time, which gives 18 stall cycles. `u_threshold.above` and
`u_refractory.fire` are combinational: they mean something only on cycles where
`in_valid & in_ready`.

Results:

- 3200 samples and 66 events over 3746 clock cycles
- `scenario_trace` suite **8/8 pass**: golden-model match, plus VCD waves equal the log (0 mismatches,
  0 X values)
- JSON size 0.5 MB

**Scoring against ground truth.** An event counts as a hit if it is on the same channel and within
±2 per-channel samples of an injected spike's peak. Each spike can be matched only once.

| Injected spikes | Hits | Misses | False positives |
|---:|---:|---:|---:|
| 64 | 58 | 6 | 8 |

- **Misses:** 5 of the 6 are the deliberately sub-threshold spikes. The sixth small spike (ch7,
  amplitude −467) was detected, because noise and drift took its residual to −652. The other miss is a full-size spike on ch5 at n=377, masked because the
  channel was still refractory after the common-mode artefact fired it at n=373.
- **False positives:** the ch2 step (1), the ch5 noise burst (1), and the common-mode transient on
  6 of 8 channels. The ch0 pop and the common-mode transient on ch0 and ch2 produced no events,
  because those channels were still refractory or disarmed after real spikes just before.
- **Latency:** of the 58 hits, 24 fired one per-channel sample before the peak (on the spike onset),
  33 on the peak and 1 a sample after it.

These figures describe this synthetic scenario only. They are not a detection-performance claim for
real neural data.

## 6. Synthesis (generic gates only)

Flow: `yosys -s synth/synth_hier.ys`, which runs `read_verilog`, `hierarchy -check -top
hbci_event_core`, `synth -top hbci_event_core`, keeping hierarchy and using generic gates including
ABC. Yosys 0.70+157.

| Module | Cells (incl. submodules) | Flip-flops |
|---|---:|---:|
| `hbci_event_core` (top) | 2003 | 421 |
| `hbci_channel_state` | 803 | 272 |
| `hbci_baseline_ema` | 492 | 0 |
| `hbci_threshold_detector` | 325 | 0 |
| `hbci_timestamp` | 188 | 64 |
| `hbci_event_packer` | 149 | 85 |
| `hbci_refractory_ctrl` | 44 | 0 |

The top's cell mix is: `$_AND_` 534, `$_DFFE_PN0P_` 413, `$_NAND_` 318, `$_MUX_` 136, `$_NOR_` 131,
`$_XOR_` 130, `$_OR_` 93, `$_ANDNOT_` 84, `$_ORNOT_` 72, `$_XNOR_` 69, `$_DFFE_PN1P_` 8, `$_NOT_` 15.
There are no latches.

v0.1 synthesised to 1997 cells. The v0.2 lint-only edits are proven equivalent, but they change how
ABC maps two modules (baseline 479 → 492, threshold 332 → 325), for a net +6 cells.

These are counts in Yosys' internal cell library. **They are not area, timing or power figures.**
There was no liberty file, no static timing analysis, no placement and no routing.

## 7. Schematics (`schematics.json`, 21 entries, all rendered by netlistsvg 1.0.2)

There are two kinds of view:

- **`rtl`:** coarse cells after `proc; opt; clean`.
- **`gates`:** `synth -top <m> -noabc`, i.e. techmapped generic gates without ABC. ABC is skipped so
  that gates keep their `src` attribute (`rtl/hbci_event_core.v:LINE.COL`): 87–100% per entry,
  98.8–99.8% for the large full-width modules. The cells without `src` are helper logic that Yosys
  passes generate themselves: `opt_dff` enable/reset pattern logic and `opt_expr` constant
  inverters. Gate-view cell counts are therefore larger than the ABC numbers in
  §6. For example, `hbci_refractory_ctrl` is 63 gates in the schematic and 44 after ABC.

Entries:

- **Shipped widths:** `<module>.rtl` and `<module>.gates` for all 7 modules. The top's views are
  hierarchical: its submodules appear as boxes.
- **Reduced widths:** `<module>.gates.reduced` for the top (flattened), `channel_state`,
  `baseline_ema`, `threshold_detector`, `timestamp` and `event_packer`, plus
  `hbci_channel_state.rtl.reduced`. These use the same RTL with parameters reduced for readability
  (`NUM_CH=2 CH_W=1 SAMPLE_W=4 FRAC_W=2 TS_W=4 REFR_W=3`). The same reduced configuration also passes
  the random regression (`s3_reduced`) and gate-level simulation (`gate_s3_reduced`).

**SVG id scheme (netlistsvg 1.0.2):**

- Every cell is a `<g id="cell_<yosys cell name>">`. The name is the key in that entry's netlist JSON
  `modules[<module>].cells`, whose `attributes.src` gives the source line.
- Module ports are `id="cell_<port name>"` and constants are `id="cell_<bit string>"`.
- Bus helpers are `id="cell_$split$,<bits>"` and `id="cell_$join$,<bits>"`.
- Child shapes carry `class="cell_<name>"`, and wires carry `class="net_<comma-separated bit ids>"`.
- Pins of generic boxes are `id="port_<cell>~<pin>"`.

A check confirmed that every netlist cell is present in its SVG, and that all SVGs are well-formed
XML. Derived module names (`$paramod$…\name`) are renamed to the base module name in the written
JSON. Nothing else in the netlist is changed.

## Limitations

- **No formal property verification.** The only formal step is the v0.1/v0.2 equivalence check, with
  the asynchronous reset modelled synchronously.
- **No code-coverage measurement.** Coverage is argued from the directed categories, the random
  regimes and the mutation control, not measured.
- **Same author.** The golden model and the tests were written by the same author as the analysis of
  the specification, so a shared misreading of the spec would not be caught. The spec-level
  formulation and the mutation control reduce this risk but do not remove it.
- **Generic gates only.** No PDK, liberty file, STA, SDC, SDF, placement, routing, DRC or LVS. There
  is no timing, power or area result, and no fabrication readiness.
- **The event stream is lossy.** Only threshold crossings leave the core, and the raw waveform cannot
  be reconstructed from events. A reset also discards an event still waiting in the output slot.
- **Design properties to be aware of.** These are not bugs:
  - `in_ready` depends combinationally on `ev_ready`.
  - The input stalls whenever the one-slot output is full and `ev_ready` is low, even for samples
    that would not fire. Out-of-range handshakes stall too.
  - The floor-based EMA approaches a constant input from below to within 2^alpha_shift LSB, and
    exactly from above.
- **Synthetic data.** The scenario is synthetic test data. Its hit, miss and false-positive numbers
  are not neural-data performance claims.
- **Not a BCI.** This is a digital event core, not a complete brain–computer interface.

## Tools

- Yosys 0.70+157
- Icarus Verilog 14.0 (devel) (s20260301-617-geed9291c8-dirty)
- Verilator 5.053 devel rev v5.052-501-g770b7d009
- netlistsvg 1.0.2 (pinned in `tools/package.json`)
- Node v24.22.0
- Python 3.9.6

All are recorded per run in `manifest.json`.

---

# v0.3 readout core (`hbci_readout_core`)

Specification: `docs/V03_READOUT_SPEC.md`. RTL: `rtl/hbci_readout_core.v` (top `hbci_readout_core`
plus `hbci_feature_state`, `hbci_biquad`, `hbci_band_energy`, `hbci_record_mux`; it reuses
`hbci_timestamp` as `u_ts` and instantiates the unchanged `hbci_event_core` as `u_event`). Shared
constants come from `system/hbci_system.json`. All numbers below come from one `make artifacts` run
on 2026-10-20 (exit code 0, about 2.5 min), with the tools listed under [Tools](#tools).

> **Scope.** Every stimulus is **synthetic, seeded test data**, not a biological recording. The work is
> functional simulation (RTL and gate level), lint and synthesis. There is **no timing claim**: the
> testbench clock is a simulation clock and the published layout is still the v0.2 core. The RAW
> guarantee covers only the **digital values entering `hbci_readout_core`** during an enabled session;
> nothing lost before that point (sensing, analog filtering, digitisation) can be recovered.

## How it is checked

- `tb/tb_hbci_readout.v` drives the core from a 64-bit-word stimulus file (format in
  `scripts/golden_v03.py`) and logs every input the DUT saw (accepted and rejected samples, cfg changes,
  `rec_ready`, resets) and every record handshake, with its clock cycle. In RTL runs it also logs the
  feature path at every accepted sample (y, ysat, pre-update acc/cnt/sat, done, x1/x2/y1/y2, energy)
  and every generated record (`raw_gen`, `event_gen`, `feat_gen`) by hierarchical reference.
- `scripts/golden_v03.py` is a bit-accurate and **cycle-accurate** Python model written from the spec:
  exact biquad, `(p + 8192) >>> 14`, sat16, sat32 after the energy shift, windows, session gating,
  three pending registers, the EVENT > FEATURE > RAW arbiter, the 16-deep FIFO and the seq/gap/drop
  rules. Legacy events come from `scripts/golden_model.py`. It replays the logged inputs edge by edge.
- `scripts/check_v03.py` compares each run with the model. Generic checks on every run: `completed`,
  `stim_applied`, `feature_internal` (RTL), `generated` (RTL), `records_exact` (every record, including
  its clock cycle), `counters`, `accounting` (generated == emitted + dropped per type and reset
  segment), `seq_gap` (emitted records are an in-order subsequence of the generated ones; seq ==
  generation index mod 2^SEQ_W; seq jumps sum to the drop counters; `flags.gap` exactly on the first
  emitted record after each loss), `event_ts` (EVENT ts is the index of a legacy fire;
  `stat_event_missed == 0`) and `internal` (testbench counters). Each suite adds its own checks.

Commands: `make v03` (RTL suites), `make v03-gate`, `make v03-mutation`, `make v03-legacy`,
`make trace-v03`, `make lint`, `make synth`, `make schematics`, `make modules`, `make sky130-v03`;
`make test` / `make artifacts` run all of them and exit non-zero on any failing check or lint warning.

## Results (`make artifacts`, all pass)

| Suite | Tests | Result | Runs and key numbers |
|---|---:|---|---|
| `v03_legacy_preserved` | 3 | 3 pass | `rtl/hbci_event_core.v` sha256 `5bfa8ca9fa44ff8e…` identical to tag `v0.2` and to HEAD; `u_event` instantiated, module not redefined. All 7 v0.2 suites (147 tests) also pass. |
| `v03_raw_reconstruction` | 22 | 22 pass | `raw_s11` (NUM_CH=8, 20,337 samples, 2 reset segments) and `raw_s12_ch6` (NUM_CH=6, 10,004 accepted, 1,577 rejected): every channel rebuilt from RAW records (seq order, ts index) is **bit-exact**; 0 drops, seq contiguous, no gap flags. |
| `v03_feature_golden` | 22 | 22 pass | `feat_s21`: 29,998 samples, 1,288 windows, every accepted sample's y/ysat/acc/cnt/done and every FEATURE record equal the model; windows completed for every `cfg_win_log2` 0..15 (11..15 clamp to 10); shifts 0..63; 12,962 ysat samples, 150 energy-saturated windows; ±32767/−32768 steps; coefficient sets: shipped band-pass, identity, ×2, all-max, all-min, a1 = −2.0, low-pass, random. `feat_s22_reduced`: SAMPLE_W=12, WIN_W=6, ACC_W=30 (energy saturation impossible, so not required), 1,266 windows. |
| `v03_hybrid` | 13 | 13 pass | Same 8,131 samples in RAW and HYBRID: RAW records identical; 248 FEATURE records equal the model; 0 drops; payload HYBRID 8,379 × 89 = 745,731 bits vs RAW 8,131 × 89 = 723,659 bits (+3.05%). |
| `v03_session_gating` | 11 | 11 pass | Records generated per phase (off/on/off/on/off/on): 0 / 2,064 / 0 / 57 / 0 / 1,032; 0 drops; 56 windows completed while off (state kept updating); first RAW, FEATURE and EVENT records seq 0; after the off phases RAW seq continues at 2,000 (no advance while off). |
| `v03_overload_gaps` | 22 | 22 pass | `ovl_s51`: one sample per clock, `rec_ready` 30/5/100/20/10/50%: RAW 12,000 = 5,251 emitted + 6,749 dropped; EVENT 880 = 290 + 590; FEATURE 3,027 = 1,263 + 1,764; seq jumps sum to 9,097 (the remaining 6 drops are after the last emitted record of their type), 2,455 records flagged gap, FIFO hwm 16; every record cycle-exact with the model. `ovl_s52_reduced`: FIFO depth 4, SEQ_W=8 and TS_W=12 both wrap; RAW 6,782, EVENT 622, FEATURE 1,756 drops. |
| `v03_modes_reset_ts` | 22 | 22 pass | `mode_s61` (4 resets) and `mode_s62_ch6` (2 resets, 1,617 rejected samples): records only of the types the mode/session in force allows; all four modes exercised; seq restarts at 0; EVENT ts equal the legacy model's crossing index; `stat_event_missed` 0. |
| `v03_gate_level` | 29 | 29 pass | Synthesised netlist (`build/synth/gate_v03.v` + Yosys `simcells.v`) on 3 compact runs (FEATURE sweep, full-rate overload, modes with 2 resets): records, counters and accounting equal the model, and accepts/records/rejects/counters are **cycle-identical** to the RTL runs. |
| `v03_mutation` | 10 | 10 pass | 10 of 10 mutants killed: no rounding, wrap instead of saturate, `done` with `==`, sat flag without energy saturation, RAW zero-extended, RAW without session, RAW priority over FEATURE, gap taken at the FIFO move, seq not advancing on drops, overwrite instead of drop. |
| `v03_scenario_trace` | 47 | 47 pass | The studio scenario in all four modes (generic checks per run), identical samples across runs, no drops, HYBRID = RAW + FEATURE records, payload ordering, VCD waves vs log, file size. |
| **v0.3 total** | **201** | **201 pass** | With v0.2: 17 suites, 348 tests, all pass. |
| Lint (Verilator 5.053 `-Wall`) | 7 configs | **0 warnings** | `hbci_event_core`: shipped, NUM_CH=6, reduced. `hbci_readout_core`: shipped; NUM_CH=6; NUM_CH=5 SAMPLE_W=12 TS_W=12 SEQ_W=8 FIFO_LOG2=2 WIN_W=6 ACC_W=30; NUM_CH=2 CH_W=1 FIFO_LOG2=1 WIN_W=4 ACC_W=40. |

## Resolved spec details

These are choices where the spec text was ambiguous or, read literally, wrong. RTL, golden model and
this document agree on all of them; the studio's browser model should match.

1. **Gap flag on the right record.** Read literally ("on that move, `flags.gap = gap_pending`"), the flag
   would land on the record generated *before* the loss: a drop can only happen while the pending
   register still holds an older record, and that record is the next one moved. The RTL instead
   captures `gap = gap_pending[type]` (and clears it) when a record is **accepted into its pending
   register**. Result: `flags.gap == 1` exactly on the first emitted record whose seq jumps, matching
   `system/hbci_system.json` ("records of this type were dropped since the last emitted one"). The
   literal reading is mutant `gap_at_move`, which the regression kills.
2. **Window end uses `cnt >= win − 1`.** Identical to the spec's `==` while `cfg_win_log2` is constant.
   If the window shrinks while a window is open, the window ends at the next sample instead of
   wrapping `cnt` through 2^WIN_W. It also bounds every window to at most 2^WIN_W samples, so `acc`
   can never exceed 2^(WIN_W+30) < 2^48.
3. **FIFO "not full"** means the registered occupancy is below 16; a pop in the same cycle does not make
   room for a push.
4. **EVENT timing.** `u_event.ev_valid` is registered, so an EVENT record is generated one clock after
   its crossing sample and is gated by the session/mode in force in that later cycle.
5. **Widths.** `stat_samples`, `stat_rejected` and `rec_ts` are `TS_W` bits (32 by default) and
   `rec_channel` is `CH_W` bits (3), so non-default parameters stay consistent. All registers,
   including the FIFO storage, are reset.
6. **Trace JSON conventions.** In `rtl_trace_v03.json`, `data` is RAW as a signed value (the
   sign-extended sample), EVENT and FEATURE unsigned. Burst `i1` is the global index of the last sample
   of the burst (inclusive). `rtl_sha256` is `cat rtl/*.v | shasum -a 256`.

## Studio trace (`rtl_trace_v03.json`, 1,678 kB)

Scenario: `scripts/make_scenario_v03.py`, seed 2026, 8 channels round-robin, one sample every 4 clocks,
500 samples per channel (4,000 samples, about 16,000 cycles per run), shipped configuration
(threshold 600, hysteresis 150, refractory 8, alpha_shift 5, b0 1801, b1 0, b2 −1801, a1 −27668,
a2 12782, win_log2 5, energy_shift 8), session on, `rec_ready` always high. The amplitudes per channel
are listed in the script header and in `ground_truth.channels`.

| Run | Records | Payload bits (× 89) | Drops |
|---|---:|---:|---|
| EVENT | 208 | 18,512 | 0 |
| RAW | 4,000 | 356,000 | 0 |
| FEATURE | 120 | 10,680 | 0 |
| HYBRID | 4,120 | 366,680 | 0 |

Mean FEATURE energy per channel (15 windows of 32 samples each): ch0 10 Hz 3,404; ch1 100 Hz burst
350,653; ch2 300 Hz 40,601; ch3 chirp 161,492; ch4 broadband noise 29,568; ch5 spikes 721; ch6 100 Hz AM
208,965; ch7 step + full-scale square 12,585,531 (3 windows with `flags.sat`; 14 saturated filter
samples). The in-band channels carry the most energy, but a single biquad has gentle skirts, so the
300 Hz tone and broadband noise still leak through. EVENT records per channel: 8, 13, 50, 37, 51, 10, 36,
3. The comparator fires on oscillations as well as on the 10 injected ch5 spikes; it is a comparator,
not a spike classifier. `samples` hold the HYBRID run's internal values; `waves` hold 17 signals from
that run's VCD (`build/v03/scenario/hbci_v03_scenario.vcd`).

## Synthesis, schematics and SKY130

**Generic synthesis** (`synth/synth_v03.ys`, hierarchical, generic gates incl. ABC, no liberty). The new
modules are appended to `synth_stats.json`; the v0.2 entries keep their v0.2-run numbers.

| Module | Cells | Flip-flops |
|---|---:|---:|
| `hbci_readout_core` (total, including `u_event` and `u_ts`) | 18,932 | 3,314 |
| `hbci_biquad` | 6,907 | 0 |
| `hbci_record_mux` | 5,027 | 1,813 |
| `hbci_feature_state` | 2,803 | 984 |
| `hbci_band_energy` | 1,914 | 0 |

The v0.3 run uses `synth -booth`. With the default array-multiplier mapping, ABC did not finish on
`hbci_biquad` (five 16 × 16 multipliers) within 4 minutes on Yosys 0.70. Inside the v0.3 run, three
reused v0.2 modules map to slightly different counts (event core 1,991 instead of 2,003 cells); the
`synth_stats.json` note lists them.

**Schematics.** `schematics.json` now has 32 entries (the 21 v0.2 entries plus 11 new), all rendered by
netlistsvg 1.0.2 with `src` attributes:

- `hbci_readout_core.rtl` and `.gates`: hierarchical, so the submodules appear as boxes.
- `hbci_feature_state.rtl` and `.rtl.reduced`.
- `.rtl` for `hbci_biquad`, `hbci_band_energy` and `hbci_record_mux`.
- Reduced gate views (`reduced: true`) for `hbci_feature_state`, `hbci_biquad`, `hbci_band_energy` and
  `hbci_record_mux`. Their full-width gate netlists have thousands of gates.

netlistsvg runs with `node --stack-size=4000`: the 89-bit FIFO entries overflowed Node's default stack.

**SKY130 HD** (`make sky130-v03`, `synth/sky130_map_v03.ys`): flattened, Booth multipliers, same
don't-use list as v0.2. Result: 18,577 cells, 3,155 flip-flops, **174,484 µm² cell area**, of which
78,961 µm² is sequential. This is cell area only: no floorplan, placement, routing or timing. Flattening
removes counters that are constant or unobserved (for example the rejected counters at NUM_CH=8). For
comparison, the v0.2 core maps to 2,009 cells and 19,615 µm². This is SYNTH evidence, not LAYOUT.

`rtl_modules.json` lists all 12 modules. `top` and `connections` stay those of `hbci_event_core`
(the studio's legacy graph). The readout core's 86 top-level connections are under
`"v03": {"top": "hbci_readout_core", "connections": [...]}`.

## v0.3 limitations

- **Synthetic stimuli only.** No biological data. Energies and event counts describe the synthetic
  scenario, not neural-decoding performance.
- **No timing claim, no v0.3 layout.** Gate level is zero-delay functional simulation. SKY130 numbers
  are cell area only.
- **RAW preserves only what enters the core**, and only while `cfg_session_en = 1`. Under overload,
  records are dropped, but never silently.
- **Same author and same spec reading** for the RTL, the golden model and the checks. The mutation
  control and the cycle-exact model reduce this risk but do not remove it. The resolved spec details
  above are this author's choices.
- **No formal proof** of the readout core and no measured code coverage. Coverage is argued from the
  suites, the explicit coverage checks (`feature_cover`, `modes`, `overload`) and the mutants.
- **Gate-level runs are compact** (about 130 clock cycles/s in Icarus with `simcells.v`). The long
  regressions run on RTL only.
- **Parameter limits.** 4 ≤ SAMPLE_W ≤ 30, NUM_CH ≤ 2^CH_W, WIN_W ≤ 15,
  ACC_W ≥ 2·SAMPLE_W − 1 + WIN_W. The coefficient format is fixed at Q2.14.

---

# v0.4 HBCI-02: on-chip AI decoder, integrated digital top, chip top

Commit `3a0d2ec` (this section is updated when the full `make artifacts` run of the final commit is recorded).
Specification: `docs/AI_DECODER.md`. Every suite below ran on this machine with the tools listed at the end of
this file plus SymbiYosys from the same OSS CAD Suite; nothing here is claimed without a run.

## Reference models (independent of the RTL)
| Model | File | Role |
|---|---|---|
| Bit-exact arithmetic reference | `scripts/golden_ai.py` | Written from the specification: quantiser, MLP/linear forward pass with every intermediate, packed model layout, CRC-32, frame protocol. The ML pipeline exports models and expected results through it |
| Cycle-accurate decoder model | `scripts/golden_ai_cycle.py` | Register-transfer timing of the decoder: write acceptance, CRC FSM (184 cycles), collector, pending register, engine latency, prediction FIFO, abort and reset |
| Cycle-accurate top model | `scripts/golden_top.py` | The v0.3 readout model + the decoder model + register file timing + BIST (LFSR, MISR) |
| v0.3 readout model | `scripts/golden_v03.py` | Unchanged v0.3 model with the per-channel window index and `feat_sync` added |

## Suites (`make v04`; `make verification` runs them with everything else)
| Suite | Runs | Checks | What is compared | Result |
|---|---|---:|---|---|
| `ai_model` | 4 (NH/NO = 4/2, 8/2, 1/3, 6/4) | 32 | every popped prediction cycle-exact (class, margin, ts, frame id, seq, flags, count); 11 counters at every drain; model status; 46-word readback; last-frame diagnostics; CRC load/verify/error/reject coverage | PASS |
| `ai_protocol` | 2 (incl. TS_W = 12, WIN_IDX_W = 4 wrap-around) | 16 | as above, with missing, duplicate, late and over-span features, masks, sync, enable toggles | PASS |
| `ai_stress` | 3 | 24 | back-to-back frames (busy drops), throttled output (FIFO drops, gap flags), hard resets during inference and CRC, saturation | PASS |
| `ai_gate_level` | 2 | 16 | the Yosys netlist of `hbci_ai_decoder` against the cycle model | PASS |
| `ai_mutation` | 13 mutants | 13 | quantiser, protocol, CRC polynomial, write gating, valid clearing, ReLU clamp, MAC sign, argmax ties, FIFO overwrite, nomodel: all killed | PASS (13/13) |
| `ai_formal` | SymbiYosys | 10 | bounded model check (depth 24) and k-induction (k = 12) of 8 property groups (`formal/ai_decoder_props.sv`): FIFO bounds, open frame never complete, unmasked channels zero, model writes clear valid, frames queued only with a valid model, nothing runs while disabled, strobe implies room, late features ignored | PASS |
| `top_e2e` | 3 (incl. NUM_CH = 5 reduced widths) | 21 | samples → DSP → feature tap → decoder → predictions through the register bus in every mode; every record handshake, feature-tap event and register read cycle-exact vs the combined model | PASS |
| `top_bist` | 2 | 14 | BIST known-answer signatures and counts equal the golden models; repeatable from reset; different per configuration; external samples and configuration writes blocked during BIST | PASS |
| `top_adverse` | 3 (incl. NUM_CH = 6 out-of-range codes) | 21 | full-rate overload with throttled output while inference runs (features still delivered), unpolled prediction FIFO (drops + gap), rejected writes, wrong-CRC reload, a lost sample followed by `feat_sync` recovery, hard resets during inference | PASS |
| `top_gate_level` | 2 | 12 | the Yosys netlist of `hbci02_digital_top` (e2e and BIST profiles) | PASS |
| `chip_serial` | 3 | 21 | `hbci02_chip_top` through SPI (register bus, sample stream) and the serial record output: MISO bits equal the internal bus on 678+ reads per run; 1,331+ deserialised records equal the FIFO handshakes | PASS |

Totals at commit `3a0d2ec`: **26 runs, 200 checks, 0 errors**; Verilator `-Wall` 0 warnings in 12 configurations
(decoder 5, digital top 4, chip top 3); all v0.2 and v0.3 suites unchanged and passing.

## Measured latencies (RTL, from the cycle model validated by the suites)
| Quantity | Cycles |
|---|---|
| frame complete → engine start | 2 |
| engine start → prediction in FIFO (MLP) | NH·8 + NO·NH + 2 (NH = 4, NO = 2: 42) |
| engine start → prediction in FIFO (linear) | NO·8 + 2 (NO = 2: 18) |
| CRC verification | 184 |
| record serialisation (chip) | 96 per record |

## Equivalence chain
1. Mathematical model (`docs/AI_DECODER.md`) → 2. bit-exact software (`golden_ai.py`, self-test and ML pipeline)
→ 3. RTL (suites above, cycle-exact) → 4. generic gate-level netlist (`ai_gate_level`, `top_gate_level`)
→ 5. SKY130 mapped netlist: **not simulated** (cell counts only) → 6. routed netlist: see `docs/PHYSICAL.md`.
No DRC/LVS result is used as evidence of functional equivalence.

## Not covered (honest list)
- The SKY130-mapped and routed netlists have not been simulated or formally compared with the RTL.
- Formal proofs cover the decoder only, in a reduced configuration (NH = 2, NO = 2) with a constant mask.
- Gate-level runs use compact stimuli (the netlist simulates at about 130 cycles/s).
- No scan/ATPG; stuck-at coverage relies on BIST and functional tests.
