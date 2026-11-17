# HBCI-01 v0.3 readout core: implementation spec

This spec is binding for the RTL, the Python golden model and the studio DEMO model. Shared constants live in
`system/hbci_system.json`. If the spec and the JSON disagree, fix the JSON and say so.

## Top: `hbci_readout_core` (`rtl/hbci_readout_core.v`)
It wraps the **unchanged** legacy core `hbci_event_core` (`rtl/hbci_event_core.v`, instance `u_event`) and adds:
- a RAW path,
- a causal FEATURE path (band-pass biquad and windowed band energy),
- a record multiplexer with a FIFO and explicit gap and drop accounting.

Verilog-2005, single clock, async active-low reset, lint-clean under `verilator -Wall`.

### Parameters
| Parameter | Default |
|---|---|
| `NUM_CH` | 8 |
| `CH_W` | 3 |
| `SAMPLE_W` | 16 |
| `TS_W` | 32 |
| `SEQ_W` | 16 |
| `FIFO_LOG2` | 4 (depth 16) |
| `WIN_W` | 10 (maximum window 2^10) |
| `ACC_W` | 48 |

### Ports
**Clock and reset:** `clk`, `rst_n`.

**Configuration**, quasi-static and sampled on use:

| Port | Meaning |
|---|---|
| `cfg_session_en` | Explicit capture-session control, replacing any neural "wake word". When 0, **no records of any type are generated**: none are counted as drops and no sequence numbers advance. Channel state (legacy and feature) and the sample counter keep updating, so enabling a session causes no state discontinuity |
| `cfg_mode[1:0]` | 0 EVENT, 1 RAW, 2 FEATURE, 3 HYBRID (RAW + FEATURE) |
| `cfg_threshold[15:0]`, `cfg_hysteresis[15:0]`, `cfg_refractory[7:0]`, `cfg_alpha_shift[3:0]` | Passed to `u_event` |
| `cfg_b0, cfg_b1, cfg_b2, cfg_a1, cfg_a2` | `signed [15:0]`, Q2.14 |
| `cfg_win_log2[3:0]` | Window = 2^k samples **of that channel**. k=0 means a window of 1. k > `WIN_W` is clamped to `WIN_W` |
| `cfg_energy_shift[5:0]` | Right shift applied before saturating the energy to 32 bits |

**Sample input**, ADC-style with **no back-pressure** (an ADC cannot wait):
- `in_valid`, `in_channel[CH_W-1:0]`, `in_sample` (`signed [15:0]`).
- A channel ≥ `NUM_CH` is ignored and counted in `stat_rejected`. Such samples advance nothing else.
- Accepted samples (in range) are counted by `stat_samples`, which equals the next sample index.

**Record output** (valid/ready):

| Port | Meaning |
|---|---|
| `rec_valid`, `rec_ready` | Handshake |
| `rec_type[1:0]` | 0 RAW, 1 EVENT, 2 FEATURE |
| `rec_channel[2:0]` | Channel |
| `rec_flags[3:0]` | bit0 `sat`; bit1 `gap`; bits 3:2 zero |
| `rec_seq[15:0]` | Per-type sequence number |
| `rec_ts[31:0]` | Sample index |
| `rec_data[31:0]` | Payload, by type (see below) |

`rec_data` by type:
- **RAW:** `in_sample` sign-extended to 32 bits.
- **EVENT:** `{15'b0, polarity, magnitude[15:0]}` from `u_event`.
- **FEATURE:** the band energy, unsigned and saturated.

**Status counters** (32-bit):
- `stat_samples`, `stat_rejected`.
- `stat_drop_raw`, `stat_drop_event`, `stat_drop_feature`.
- `stat_event_missed`: samples `u_event` could not accept. It must stay 0 by design.
- `stat_fifo_hwm`: FIFO high-water mark, `FIFO_LOG2+1` bits zero-extended.

### Behaviour
1. **accept** = `in_valid & (in_channel < NUM_CH)`. Each accepted sample has index `i = stat_samples` before
   the increment.
2. **Legacy path:**
   - `u_event.in_valid = in_valid`, with the channel and sample passed through.
   - `u_event.ev_ready = 1'b1` (always drained). `stat_event_missed` increments when
     `accept & ~u_event.in_ready`.
   - An EVENT record is **generated** in the cycle `u_event.ev_valid` is high, if `cfg_session_en` and
     mode == EVENT.
   - Its `ts` is `u_event.ev_timestamp`. This equals the top-level sample index as long as
     `stat_event_missed == 0`.
3. **RAW:** on accept, if `cfg_session_en` and mode ∈ {RAW, HYBRID}, generate a RAW record with
   `ts = i` and `data = sext(in_sample)`.
4. **FEATURE** (per channel, updated on **every** accepted sample of that channel, regardless of session or
   mode):
   - Per-channel state: `x1, x2, y1, y2` (signed 16), `acc` (unsigned `ACC_W`), `cnt` (`WIN_W` bits),
     `sat` (1). All are zero at reset.
   - Biquad (combinational, exact):
     `p = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2`, computed in ≥ 35-bit signed arithmetic with no
     intermediate overflow.
   - `y_full = (p + 8192) >>> 14` (arithmetic shift).
   - `y = sat16(y_full)`; `ysat = (y_full != y)`.
   - Energy: `sq = y*y` (unsigned 31 bits; −32768² = 2^30 fits). `acc_next = acc + sq`.
     `win = 1 << min(cfg_win_log2, WIN_W)`. `done = (cnt == win-1)`.
   - On done:
     - if `cfg_session_en` and mode ∈ {FEATURE, HYBRID}, generate a FEATURE record with `ts = i` and
       `data = sat32(acc_next >> cfg_energy_shift)`;
     - `flags.sat = sat | ysat | (energy saturated)`;
     - then reset `acc`, `cnt` and `sat` to 0.
   - Not done: `acc = acc_next`, `cnt = cnt + 1`, `sat = sat | ysat`.
   - The state shifts on every accepted sample: `x2 = x1`, `x1 = x`, `y2 = y1`, `y1 = y` (saturated y).
5. **Record path:**
   - Three 1-deep pending registers (RAW, EVENT, FEATURE). If a record is generated while its pending register
     is still full, the record is **dropped**: `stat_drop_<type>++` and that type's `gap_pending` is set.
   - The per-type `seq` increments for every **generated** record, dropped or not. The first record of each type
     after reset has seq 0.
   - Each cycle the arbiter moves at most one pending record into the FIFO, if it is not full. Priority is
     EVENT > FEATURE > RAW.
   - On that move, `flags.gap = gap_pending[type]`, and `gap_pending[type]` is cleared.
   - The FIFO head drives `rec_*`. A record leaves on `rec_valid & rec_ready`.
   - A record generated in the same cycle its pending register empties into the FIFO is **not** dropped (the
     register accepts the new record).
6. Nothing is ever silently lost. For every type, **generated = emitted + dropped**, and the receiver sees every
   gap through seq jumps and `flags.gap`.

### Sub-modules (separate Verilog modules, for the studio and the schematics)
| Module | Instance | Role |
|---|---|---|
| `hbci_event_core` | `u_event` | Legacy comparator (unchanged file) |
| `hbci_feature_state` | `u_fstate` | Per-channel feature register file |
| `hbci_biquad` | `u_biquad` | Combinational DF-I biquad with rounding and saturation |
| `hbci_band_energy` | `u_energy` | Combinational square, accumulate, window-done and output saturation |
| `hbci_record_mux` | `u_records` | Pending registers, arbiter, FIFO, sequence/gap/drop accounting |
| `hbci_timestamp` (reuse) | `u_ts` | Top-level sample index and rejected counter |

The RAW path is wiring and gating in the top level plus the RAW pending register in `u_records`. Name the top
nets `raw_gen`, `feat_gen`, `event_gen` so the studio can show them.

## Verification requirements
1. **Legacy preserved:** all v0.2 suites still pass, and `rtl/hbci_event_core.v` is byte-identical.
2. **RAW exact reconstruction:** for seeded random multichannel stimulus at a non-overloading input rate,
   reconstruct every channel's sample sequence from the RAW records (via seq and ts). It must be bit-exact
   against the stimulus, with zero drops.
3. **FEATURE bit-accuracy:** a Python golden model, extending `scripts/golden_model.py` or a new
   `scripts/golden_v03.py`, must match the RTL on every accepted sample's `y`, `ysat`, `acc`, `cnt` and done,
   and on every FEATURE record. Cover extremes (±32767/−32768 steps, maximum-gain coefficients, saturation)
   and every `win_log2` from 0 to 10.
4. **HYBRID:** RAW and FEATURE records are both present and individually correct. Payload bits are
   reported, and they exceed RAW alone.
5. **Session gating:** with `cfg_session_en=0`, there are zero records, zero drops and no seq advance, while
   state still updates. Enabling it mid-stream works, and the first records have seq 0.
6. **Overflow and gaps:** at full input rate (a sample every cycle) in HYBRID mode with `rec_ready` throttled,
   check that drops occur, `generated == emitted + dropped` per type, the seq jumps equal the drop counts, and
   `flags.gap` marks exactly the first emitted record after each loss. A cycle-accurate Python model of the
   record path is preferred. Invariant checks are the minimum.
7. **Mode switching, reset, out-of-range channels and timestamp consistency:** EVENT `ts` matches the
   top-level index, and `stat_event_missed == 0`.
8. **Gate level:** gate-level simulation of the synthesised `hbci_readout_core` on the regression stimulus.
9. **Mutation sanity:** extend it so that at least 3 mutants in the new paths are caught.
10. Lint 0 warnings; generic synthesis stats per new module; schematics (`rtl` and `gates`, plus reduced
    variants where large) with `src` attributes; SKY130 HD mapping of the new top (`make sky130` extended,
    cell area only).

## Studio artifact: `rtl_trace_v03.json` (exact field names)
```text
{
  scenario: string, seed: number,
  profile: { num_channels: 8, sample_rate_hz: 2000, sample_bits: 16 },
  config: { threshold, hysteresis, refractory, alpha_shift, b0, b1, b2, a1, a2, win_log2, energy_shift },
  num_samples: number,
  samples: [ { i, cycle, ch, x, y, ysat, acc, cnt, done } ],   // per accepted sample, actual RTL values
                                                               // (pre-update acc/cnt), from the HYBRID run
  runs: {                                                      // the same stimulus run once per mode
    EVENT|RAW|FEATURE|HYBRID: {
      records: [ { type, ch, seq, ts, data, flags, cycle } ],
      stats: { samples, rejected, drop_raw, drop_event, drop_feature, event_missed, fifo_hwm, record_bits }
    }
  },
  ground_truth: { channels: [ { ch, description } ],
                  bursts: [ { ch, i0, i1, f_hz, amp } ],       // i in global sample index
                  spikes: [ { ch, i, amp } ] },
  waves: [ { name, width, signed, changes: [[cycle, value]] } ],  // a subset of signals from the HYBRID run's VCD
  rtl_sha256: string,                                          // sha256 over rtl/*.v used for the run
  vcd_file: string
}
```

**Scenario.** 8 channels round-robin at the synthetic teaching profile (2,000 S/s/ch; one sample every
4 clock cycles, so the scenario does not overload), with 500 samples per channel:

| Channel | Content |
|---|---|
| ch0 | 10 Hz oscillation + noise (out of band, low) |
| ch1 | Noise + a 100 Hz burst (in band) |
| ch2 | 300 Hz tone (out of band, high) |
| ch3 | Linear chirp 20 → 400 Hz |
| ch4 | Broadband noise |
| ch5 | Spikes like v0.2 (for EVENT) |
| ch6 | 100 Hz amplitude-modulated |
| ch7 | Step and large-amplitude segment (exercises saturation) |

The amplitudes must be documented and deterministic.

## Resolved during implementation (binding; the RTL, golden model and tests follow these)
1. **Gap flag:** `flags.gap` is captured when a record is **accepted into its pending register**: it is set if
   any record of that type was dropped since the previous accepted one. So `gap = 1` exactly when the seq number
   jumps. Reading item 5 above literally would flag the record generated *before* the loss; a mutant
   implementing that reading is killed by the regression.
2. **Window end:** `done = (cnt >= win-1)`. This is identical to `==` while the configuration is constant. If
   `cfg_win_log2` shrinks mid-window, the window ends at the next sample instead of wrapping.
3. **FIFO "not full":** uses the registered occupancy. A pop in the same cycle does not make room for a push.
4. **EVENT timing:** an EVENT record is generated in the cycle after its crossing sample, when `u_event.ev_valid`
   is high. It is gated by the session and mode in force in that later cycle.
5. **Trace data types:** RAW `data` is signed; EVENT and FEATURE `data` are unsigned. Ground-truth burst
   `i1` is inclusive. `rtl_sha256` = `cat rtl/*.v | shasum -a 256`.
6. **`rtl_modules.json`:** `top` and `connections` stay those of `hbci_event_core`. The readout core's
   connections are under `"v03": {top, connections}`.
7. **Generic synthesis** uses `synth -booth`: the default ABC run hung for more than 4 minutes on the biquad
   multipliers.
