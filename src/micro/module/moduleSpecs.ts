// Simplified internal dataflow of each RTL block, for the module microscope (Level 1). Every operator cites the
// Verilog lines it summarises (rtl/hbci_readout_core.v or rtl/hbci_event_core.v), and says whether it is stored
// (flip-flops: changes only on a clock edge) or computed (combinational: follows its inputs within the cycle).
// The drawing groups many gates into one operator; the gate-level view shows the real gates.
export type OpKind = 'store' | 'comb';

export interface Op {
  id: string;
  label: string;
  sub?: string;
  kind: OpKind;
  /** Centre in the spec grid: x 0..100, y 0..H. */
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Verilog lines (inclusive) this operator summarises. */
  lines: [number, number];
  /** One-sentence explanation. */
  explain: string;
}

/** A link: 'port:<name>' for a module port, otherwise an op id. */
export interface Link { from: string; to: string; label?: string; bus?: boolean }

export interface ModuleSpec {
  module: string;
  file: 'rtl/hbci_readout_core.v' | 'rtl/hbci_event_core.v';
  H: number;
  ops: Op[];
  links: Link[];
  /** What the simplification leaves out. */
  note: string;
  /** Which worked computation the "one sample" tab plays. */
  compute: 'feature' | 'records' | 'counter' | 'raw' | 'legacy';
}

const RC = 'rtl/hbci_readout_core.v' as const;
const EC = 'rtl/hbci_event_core.v' as const;

export const SPECS: Record<string, ModuleSpec> = {
  hbci_biquad: {
    module: 'hbci_biquad', file: RC, H: 66, compute: 'feature',
    ops: [
      { id: 'mb0', label: '× b0', sub: 'multiply', kind: 'comb', x: 24, y: 7, lines: [341, 341], explain: 'Multiplies the new sample x by coefficient b0 (exact, 35-bit result).' },
      { id: 'mb1', label: '× b1', sub: 'multiply', kind: 'comb', x: 24, y: 20, lines: [342, 342], explain: 'Multiplies the previous input x1 by b1 (0 with the default coefficients).' },
      { id: 'mb2', label: '× b2', sub: 'multiply', kind: 'comb', x: 24, y: 33, lines: [343, 343], explain: 'Multiplies the input from two samples ago, x2, by b2.' },
      { id: 'ma1', label: '× a1', sub: 'multiply', kind: 'comb', x: 24, y: 46, lines: [344, 344], explain: 'Multiplies the previous output y1 by a1 (feedback).' },
      { id: 'ma2', label: '× a2', sub: 'multiply', kind: 'comb', x: 24, y: 59, lines: [345, 345], explain: 'Multiplies the output from two samples ago, y2, by a2 (feedback).' },
      { id: 'sum', label: 'Σ add/subtract', sub: 'weighted sum p', kind: 'comb', x: 48, y: 33, w: 20, h: 12, lines: [346, 346], explain: 'Adds the three feed-forward products and subtracts the two feedback products: the weighted sum.' },
      { id: 'rnd', label: 'round', sub: '(p+8192) >>> 14', kind: 'comb', x: 72, y: 33, lines: [350, 354], explain: 'Adds half of 2^14 and shifts right 14 bits: rounds the Q2.14 result back to a whole sample value.' },
      { id: 'sat', label: 'saturate', sub: 'clip to 16 bits', kind: 'comb', x: 90, y: 33, lines: [356, 362], explain: 'If the result does not fit 16 bits, clips it to +32767 or −32768 and raises ysat.' },
    ],
    links: [
      { from: 'port:x', to: 'mb0', bus: true }, { from: 'port:x1', to: 'mb1', bus: true }, { from: 'port:x2', to: 'mb2', bus: true },
      { from: 'port:y1', to: 'ma1', bus: true }, { from: 'port:y2', to: 'ma2', bus: true },
      { from: 'mb0', to: 'sum', bus: true }, { from: 'mb1', to: 'sum', bus: true }, { from: 'mb2', to: 'sum', bus: true },
      { from: 'ma1', to: 'sum', bus: true, label: '−' }, { from: 'ma2', to: 'sum', bus: true, label: '−' },
      { from: 'sum', to: 'rnd', bus: true, label: 'p (35 b)' }, { from: 'rnd', to: 'sat', bus: true, label: 'y_full (21 b)' },
      { from: 'sat', to: 'port:y', bus: true }, { from: 'sat', to: 'port:ysat' },
    ],
    note: 'Coefficient inputs b0…a2 feed the five multipliers. Sign extension to 35 bits (lines 330–339) is left out of the drawing.',
  },
  hbci_band_energy: {
    module: 'hbci_band_energy', file: RC, H: 60, compute: 'feature',
    ops: [
      { id: 'sq', label: 'y × y', sub: 'square', kind: 'comb', x: 22, y: 8, lines: [402, 406], explain: 'Squares the filtered sample: always positive, large when the band is active.' },
      { id: 'add', label: 'acc + y²', sub: '48-bit add', kind: 'comb', x: 44, y: 18, lines: [407, 407], explain: 'Adds this sample\'s square to the energy accumulated so far in the window.' },
      { id: 'cmp', label: 'cnt ≥ 2^k − 1 ?', sub: 'window end', kind: 'comb', x: 44, y: 40, lines: [410, 413], explain: 'Checks whether this sample is the last one of the window: done.' },
      { id: 'shr', label: '>> shift', sub: 'scale down', kind: 'comb', x: 65, y: 18, lines: [416, 416], explain: 'Shifts the total right to scale it down.' },
      { id: 'sat', label: 'saturate', sub: 'clip to 32 bits', kind: 'comb', x: 86, y: 12, lines: [417, 424], explain: 'Clips the scaled energy to 32 bits for the record.' },
      { id: 'flag', label: 'any clip?', sub: 'sat | ysat | esat', kind: 'comb', x: 86, y: 32, lines: [428, 428], explain: 'Marks the record if anything saturated in this window.' },
      { id: 'wb', label: 'done ? 0 : next', sub: 'write-back values', kind: 'comb', x: 76, y: 48, w: 20, lines: [429, 431], explain: 'At the window end the accumulator and counter restart at 0; otherwise they carry on.' },
    ],
    links: [
      { from: 'port:y', to: 'sq', bus: true }, { from: 'sq', to: 'add', bus: true, label: 'y² (31 b)' }, { from: 'port:acc', to: 'add', bus: true },
      { from: 'port:cnt', to: 'cmp', bus: true }, { from: 'port:win_log2', to: 'cmp', bus: true },
      { from: 'add', to: 'shr', bus: true }, { from: 'port:energy_shift', to: 'shr', bus: true }, { from: 'shr', to: 'sat', bus: true },
      { from: 'sat', to: 'port:energy', bus: true }, { from: 'cmp', to: 'port:done' },
      { from: 'port:ysat', to: 'flag' }, { from: 'port:sat', to: 'flag' }, { from: 'flag', to: 'port:feat_sat' },
      { from: 'add', to: 'wb', bus: true }, { from: 'cmp', to: 'wb' },
      { from: 'wb', to: 'port:acc_wr', bus: true }, { from: 'wb', to: 'port:cnt_wr', bus: true }, { from: 'wb', to: 'port:sat_wr' },
    ],
    note: 'Purely combinational: the accumulator itself lives in the feature memory (u_fstate).',
  },
  hbci_feature_state: {
    module: 'hbci_feature_state', file: RC, H: 56, compute: 'feature',
    ops: [
      { id: 'mem', label: '8 channel rows', sub: 'x1 · x2 · y1 · y2 · acc · cnt · sat', kind: 'store', x: 46, y: 28, w: 30, h: 34, lines: [257, 263], explain: 'Flip-flops holding, for each of the 8 channels, the last two inputs and outputs, the energy so far, the window count and a saturation flag.' },
      { id: 'wr', label: 'write row ch', sub: 'on clock edge if we', kind: 'comb', x: 15, y: 40, lines: [276, 295], explain: 'On each clock edge with we = 1, the addressed row shifts x2 ← x1, x1 ← new x, y2 ← y1, y1 ← new y and stores acc, cnt, sat.' },
      { id: 'rd', label: 'read mux', sub: 'row = ch', kind: 'comb', x: 80, y: 28, lines: [267, 273], explain: 'Picks the addressed channel\'s row and puts it on the rd_* outputs in the same cycle.' },
    ],
    links: [
      { from: 'port:ch', to: 'rd', bus: true }, { from: 'port:ch', to: 'wr', bus: true }, { from: 'port:we', to: 'wr' },
      { from: 'port:wr_x', to: 'wr', bus: true }, { from: 'port:wr_y', to: 'wr', bus: true }, { from: 'port:wr_acc', to: 'wr', bus: true },
      { from: 'wr', to: 'mem', bus: true }, { from: 'mem', to: 'rd', bus: true },
      { from: 'rd', to: 'port:rd_x1', bus: true }, { from: 'rd', to: 'port:rd_y1', bus: true }, { from: 'rd', to: 'port:rd_acc', bus: true }, { from: 'rd', to: 'port:rd_cnt', bus: true },
    ],
    note: 'All eight rows reset to 0. Other rd_* / wr_* ports follow the same paths.',
  },
  hbci_record_mux: {
    module: 'hbci_record_mux', file: RC, H: 66, compute: 'records',
    ops: [
      { id: 'praw', label: 'RAW pending', sub: '1 record', kind: 'store', x: 24, y: 10, lines: [566, 584], explain: 'Holds one RAW record. If a new one arrives while it is still full, the new one is dropped and counted.' },
      { id: 'pev', label: 'EVENT pending', sub: '1 record', kind: 'store', x: 24, y: 28, lines: [587, 605], explain: 'Holds one EVENT record, same drop rule.' },
      { id: 'pft', label: 'FEATURE pending', sub: '1 record', kind: 'store', x: 24, y: 46, lines: [608, 626], explain: 'Holds one FEATURE record, same drop rule.' },
      { id: 'arb', label: 'arbiter', sub: 'EVENT > FEATURE > RAW', kind: 'comb', x: 50, y: 28, lines: [524, 531], explain: 'Each cycle moves at most one pending record into the FIFO, highest priority first, if the FIFO is not full.' },
      { id: 'fifo', label: 'FIFO', sub: '16 records deep', kind: 'store', x: 74, y: 28, w: 16, h: 30, lines: [515, 563], explain: 'A queue of up to 16 records; the oldest drives the rec_* outputs.' },
      { id: 'cnt', label: 'counters', sub: 'seq + drops per type', kind: 'store', x: 50, y: 60, w: 22, lines: [571, 575], explain: 'Every generated record gets the next sequence number of its type, dropped or not; drops are counted.' },
    ],
    links: [
      { from: 'port:raw_gen', to: 'praw' }, { from: 'port:ev_gen', to: 'pev' }, { from: 'port:ft_gen', to: 'pft' },
      { from: 'praw', to: 'arb', bus: true }, { from: 'pev', to: 'arb', bus: true }, { from: 'pft', to: 'arb', bus: true },
      { from: 'arb', to: 'fifo', bus: true, label: 'push' }, { from: 'port:rec_ready', to: 'fifo', label: 'pop' },
      { from: 'fifo', to: 'port:rec_valid' }, { from: 'fifo', to: 'port:rec_data', bus: true }, { from: 'fifo', to: 'port:rec_seq', bus: true },
      { from: 'cnt', to: 'port:drop_raw', bus: true },
    ],
    note: 'The *_ch, *_ts, *_data inputs travel with each _gen pulse into its pending register.',
  },
  hbci_timestamp: {
    module: 'hbci_timestamp', file: EC, H: 36, compute: 'counter',
    ops: [
      { id: 'inc1', label: '+1', sub: 'if tick', kind: 'comb', x: 32, y: 10, lines: [336, 336], explain: 'Adds one when a sample is accepted.' },
      { id: 'ts', label: 'ts_now', sub: '32-bit register', kind: 'store', x: 64, y: 10, lines: [331, 336], explain: 'The count of accepted samples so far: the next sample index.' },
      { id: 'inc2', label: '+1', sub: 'if reject', kind: 'comb', x: 32, y: 27, lines: [337, 337], explain: 'Adds one when a sample with an out-of-range channel is ignored.' },
      { id: 'rj', label: 'rejected', sub: '32-bit register', kind: 'store', x: 64, y: 27, lines: [331, 337], explain: 'The count of rejected samples.' },
    ],
    links: [
      { from: 'port:tick', to: 'inc1' }, { from: 'inc1', to: 'ts', bus: true }, { from: 'ts', to: 'inc1', bus: true, label: 'feedback' },
      { from: 'ts', to: 'port:ts_now', bus: true },
      { from: 'port:reject', to: 'inc2' }, { from: 'inc2', to: 'rj', bus: true }, { from: 'rj', to: 'port:rejected', bus: true },
    ],
    note: 'The same module is used twice: u_ts at the v0.3 top and u_timestamp inside the legacy core.',
  },
  $raw: {
    module: 'hbci_readout_core', file: RC, H: 40, compute: 'raw',
    ops: [
      { id: 'acc', label: 'accept', sub: 'in_valid & ch < 8', kind: 'comb', x: 26, y: 9, lines: [93, 95], explain: 'A sample counts when it is valid and its channel is in range.' },
      { id: 'and', label: 'AND', sub: 'raw_gen', kind: 'comb', x: 56, y: 17, lines: [155, 155], explain: 'raw_gen = accept & mode_raw, where mode_raw = cfg_session_en & cfg_mode[0] (line 110): RAW records only during a session in RAW or HYBRID mode.' },
      { id: 'sx', label: 'sign-extend', sub: '16 → 32 bits', kind: 'comb', x: 56, y: 33, lines: [156, 156], explain: 'Copies the sign bit 16 times so the RAW record carries the sample as a 32-bit signed number.' },
    ],
    links: [
      { from: 'port:in_valid', to: 'acc' }, { from: 'port:in_channel', to: 'acc', bus: true }, { from: 'acc', to: 'and' },
      { from: 'port:cfg_session_en', to: 'and' }, { from: 'port:cfg_mode', to: 'and', bus: true },
      { from: 'and', to: 'port:raw_gen' }, { from: 'port:in_sample', to: 'sx', bus: true }, { from: 'sx', to: 'port:raw_data', bus: true },
    ],
    note: 'There is no RAW module: these are a few gates in hbci_readout_core plus the RAW pending register in u_records.',
  },
  hbci_channel_state: {
    module: 'hbci_channel_state', file: EC, H: 52, compute: 'legacy',
    ops: [
      { id: 'mem', label: '8 channel rows', sub: 'baseline · refr · armed · primed', kind: 'store', x: 46, y: 26, w: 30, h: 32, lines: [181, 184], explain: 'Flip-flops holding each channel\'s baseline (Q16.8), refractory count and armed / primed flags.' },
      { id: 'wr', label: 'write row ch', sub: 'on clock edge if we', kind: 'comb', x: 15, y: 38, lines: [196, 209], explain: 'On each accepted sample the addressed row stores the new baseline, refractory count and armed flag, and becomes primed.' },
      { id: 'rd', label: 'read mux', sub: 'row = ch', kind: 'comb', x: 80, y: 26, lines: [190, 193], explain: 'Picks the addressed channel\'s row for this cycle.' },
    ],
    links: [
      { from: 'port:ch', to: 'rd', bus: true }, { from: 'port:ch', to: 'wr', bus: true }, { from: 'port:we', to: 'wr' },
      { from: 'port:wr_baseline', to: 'wr', bus: true }, { from: 'port:wr_refr', to: 'wr', bus: true }, { from: 'port:wr_armed', to: 'wr' },
      { from: 'wr', to: 'mem', bus: true }, { from: 'mem', to: 'rd', bus: true },
      { from: 'rd', to: 'port:rd_baseline', bus: true }, { from: 'rd', to: 'port:rd_refr', bus: true }, { from: 'rd', to: 'port:rd_armed' }, { from: 'rd', to: 'port:rd_primed' },
    ],
    note: 'Yosys turns the arrays into individual flip-flops (8 × 34 bits).',
  },
  hbci_baseline_ema: {
    module: 'hbci_baseline_ema', file: EC, H: 50, compute: 'legacy',
    ops: [
      { id: 'int', label: '⌊baseline⌋', sub: 'top 16 bits', kind: 'comb', x: 24, y: 12, lines: [233, 235], explain: 'Takes the whole-number part of the stored Q16.8 baseline.' },
      { id: 'diff', label: 'x − ⌊b⌋', sub: '17-bit subtract', kind: 'comb', x: 52, y: 12, lines: [237, 241], explain: 'The residual: how far the sample is from the background (0 until the channel is primed).' },
      { id: 'err', label: 'x·256 − b', sub: 'error in Q16.8', kind: 'comb', x: 30, y: 34, lines: [244, 246], explain: 'The difference between the sample and the baseline, in fixed point.' },
      { id: 'step', label: '>>> k', sub: 'divide by 2^k', kind: 'comb', x: 52, y: 34, lines: [247, 247], explain: 'Shrinks the error: the baseline moves 1/2^k of the way towards the sample.' },
      { id: 'sum', label: 'b + step', sub: 'or x on first sample', kind: 'comb', x: 76, y: 34, lines: [251, 254], explain: 'The new baseline; the very first sample of a channel sets it directly.' },
    ],
    links: [
      { from: 'port:baseline_q', to: 'int', bus: true }, { from: 'int', to: 'diff', bus: true }, { from: 'port:sample', to: 'diff', bus: true },
      { from: 'diff', to: 'port:residual', bus: true }, { from: 'port:sample', to: 'err', bus: true }, { from: 'port:baseline_q', to: 'err', bus: true },
      { from: 'err', to: 'step', bus: true }, { from: 'port:alpha_shift', to: 'step', bus: true }, { from: 'step', to: 'sum', bus: true },
      { from: 'port:primed', to: 'sum' }, { from: 'sum', to: 'port:baseline_next', bus: true },
    ],
    note: 'A guard bit keeps every intermediate value exact (lines 243–252).',
  },
  hbci_threshold_detector: {
    module: 'hbci_threshold_detector', file: EC, H: 50, compute: 'legacy',
    ops: [
      { id: 'abs', label: '|residual|', sub: 'sign → polarity', kind: 'comb', x: 26, y: 14, lines: [275, 279], explain: 'Takes the size of the residual and remembers its sign as the polarity.' },
      { id: 'ge', label: '≥ threshold ?', sub: 'compare', kind: 'comb', x: 56, y: 14, lines: [281, 282], explain: 'above = 1 when the size is at least the threshold (and the threshold is not 0).' },
      { id: 'lvl', label: 'threshold − hysteresis', sub: 're-arm level (min 1)', kind: 'comb', x: 32, y: 36, w: 22, lines: [283, 285], explain: 'The lower level the signal must fall below before the channel can fire again.' },
      { id: 'lt', label: '< level ?', sub: 'compare', kind: 'comb', x: 64, y: 36, lines: [286, 286], explain: 'below_rearm = 1 when the size is below the re-arm level.' },
    ],
    links: [
      { from: 'port:residual', to: 'abs', bus: true }, { from: 'abs', to: 'ge', bus: true }, { from: 'port:threshold', to: 'ge', bus: true },
      { from: 'ge', to: 'port:above' }, { from: 'abs', to: 'port:magnitude', bus: true }, { from: 'abs', to: 'port:polarity' },
      { from: 'port:threshold', to: 'lvl', bus: true }, { from: 'port:hysteresis', to: 'lvl', bus: true }, { from: 'lvl', to: 'lt', bus: true },
      { from: 'abs', to: 'lt', bus: true }, { from: 'lt', to: 'port:below_rearm' }, { from: 'ge', to: 'port:enable' },
    ],
    note: 'Equality fires: |residual| = threshold counts as above.',
  },
  hbci_refractory_ctrl: {
    module: 'hbci_refractory_ctrl', file: EC, H: 50, compute: 'legacy',
    ops: [
      { id: 'act', label: 'refr ≠ 0 ?', sub: 'still resting', kind: 'comb', x: 24, y: 30, lines: [309, 309], explain: 'Is this channel still in its refractory pause?' },
      { id: 'fire', label: 'AND of 5', sub: 'fire', kind: 'comb', x: 54, y: 12, lines: [310, 310], explain: 'fire = primed & enable & armed & not resting & above: only then is an event reported.' },
      { id: 'arm', label: 'fire ? 0 : armed | below', sub: 'armed_next', kind: 'comb', x: 76, y: 28, w: 22, lines: [311, 311], explain: 'Firing disarms the channel; it re-arms once the signal falls below the re-arm level.' },
      { id: 'cnt', label: 'load / count down', sub: 'refr_next', kind: 'comb', x: 54, y: 42, w: 20, lines: [312, 314], explain: 'Firing loads the refractory count; otherwise it counts down to 0, one per sample of this channel.' },
    ],
    links: [
      { from: 'port:refr_cnt', to: 'act', bus: true }, { from: 'act', to: 'fire' }, { from: 'port:above', to: 'fire' }, { from: 'port:armed', to: 'fire' },
      { from: 'port:primed', to: 'fire' }, { from: 'port:enable', to: 'fire' }, { from: 'fire', to: 'port:fire' },
      { from: 'fire', to: 'arm' }, { from: 'port:below_rearm', to: 'arm' }, { from: 'arm', to: 'port:armed_next' },
      { from: 'fire', to: 'cnt' }, { from: 'port:cfg_refractory', to: 'cnt', bus: true }, { from: 'cnt', to: 'port:refr_next', bus: true },
    ],
    note: 'Purely combinational: the armed flag and the count are stored in the event memory (u_state).',
  },
  hbci_event_packer: {
    module: 'hbci_event_packer', file: EC, H: 44, compute: 'legacy',
    ops: [
      { id: 'free', label: 'slot free ?', sub: '~ev_valid | ev_ready', kind: 'comb', x: 30, y: 34, lines: [367, 367], explain: 'The slot can take a new event if it is empty or being emptied this cycle.' },
      { id: 'slot', label: 'output slot', sub: 'one event', kind: 'store', x: 62, y: 16, w: 22, h: 18, lines: [369, 387], explain: 'Registers holding one event {channel, timestamp, polarity, magnitude} until the receiver takes it.' },
    ],
    links: [
      { from: 'port:push', to: 'slot' }, { from: 'port:in_magnitude', to: 'slot', bus: true }, { from: 'port:in_timestamp', to: 'slot', bus: true },
      { from: 'port:ev_ready', to: 'free' }, { from: 'slot', to: 'free', label: 'ev_valid' }, { from: 'free', to: 'port:slot_free' },
      { from: 'slot', to: 'port:ev_valid' }, { from: 'slot', to: 'port:ev_magnitude', bus: true }, { from: 'slot', to: 'port:ev_timestamp', bus: true },
    ],
    note: 'Inside the v0.3 chip ev_ready is tied to 1, so the slot always empties in the next cycle.',
  },
};

/** Spec key for a registry id. */
export function specKeyFor(id: string): string | null {
  const map: Record<string, string> = {
    'rtl.u_biquad': 'hbci_biquad', 'rtl.u_energy': 'hbci_band_energy', 'rtl.u_fstate': 'hbci_feature_state',
    'rtl.u_records': 'hbci_record_mux', 'rtl.u_ts': 'hbci_timestamp', 'rtl.u_timestamp': 'hbci_timestamp', 'rtl.raw_path': '$raw',
    'rtl.u_state': 'hbci_channel_state', 'rtl.u_baseline': 'hbci_baseline_ema', 'rtl.u_threshold': 'hbci_threshold_detector',
    'rtl.u_refractory': 'hbci_refractory_ctrl', 'rtl.u_packer': 'hbci_event_packer',
  };
  return map[id] ?? null;
}

/** Instance name and scope of a registry id in the netlist. */
export function instOf(id: string): { inst: string; scope: 'v03' | 'event' } | null {
  const v03: Record<string, string> = { 'rtl.u_biquad': 'u_biquad', 'rtl.u_energy': 'u_energy', 'rtl.u_fstate': 'u_fstate', 'rtl.u_records': 'u_records', 'rtl.u_ts': 'u_ts', 'rtl.raw_path': '$raw' };
  const ev: Record<string, string> = { 'rtl.u_state': 'u_state', 'rtl.u_baseline': 'u_baseline', 'rtl.u_threshold': 'u_threshold', 'rtl.u_refractory': 'u_refractory', 'rtl.u_timestamp': 'u_timestamp', 'rtl.u_packer': 'u_packer' };
  if (v03[id]) return { inst: v03[id], scope: 'v03' };
  if (ev[id]) return { inst: ev[id], scope: 'event' };
  return null;
}
