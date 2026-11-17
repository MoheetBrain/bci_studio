// The on-chip AI decoder (hbci_ai_decoder, v0.4 HBCI-02) as the studio describes it: sub-block explanations in
// plain words, the register map and the model-loading story, all transcribed from docs/AI_DECODER.md (binding
// specification). The small arithmetic helpers at the end re-run the specification's formulas in the browser so a
// value read from the RTL trace can be shown next to a "browser check": they never replace an RTL value, and
// every place that uses them shows the RTL value first.
import type { RtlTraceV04, V04Model } from '../artifacts/types';

export interface AiSubBlock {
  id: string;
  inst: string;
  module: string;
  /** Plain-English headline. */
  title: string;
  /** What it computes, in words a bright newcomer understands. */
  plain: string;
  /** The exact rule, from docs/AI_DECODER.md. */
  rule: string;
  /** Lines of rtl/hbci_ai_decoder.v (from rtl_modules.json; the inspector shows the source). */
  lines: [number, number];
}

export const AI_SUBBLOCKS: AiSubBlock[] = [
  {
    id: 'rtl.ai_quant', inst: 'u_quant', module: 'hbci_feat_quant', title: 'Quantiser: a big energy becomes a small signed number',
    plain: 'A window energy can be anything from 0 to about four billion. The network wants eight small numbers of similar size. The quantiser first takes a logarithm (so a ten-times bigger energy only adds a fixed amount), then subtracts a per-channel centre and divides by a per-channel power of two, and finally clips the result into the range −128…127 (one signed byte).',
    rule: 'L = 64·n + m where n = position of the leading 1 of E and m = the six bits below it (≈ 64·log2 E; L = 0 for E = 0). x_c = sat_int8((L − centre_c) >> qshift_c); x_c = 0 for a channel not in cfg_ch_mask.',
    lines: [34, 75],
  },
  {
    id: 'rtl.ai_collect', inst: 'u_collect', module: 'hbci_frame_collector', title: 'Frame collector: one observation = the same window from every channel',
    plain: 'Each channel finishes its windows on its own clock. The collector waits until it has one quantised value from every required channel and all of them belong to the same window number. If a channel is missing, repeats itself, arrives late or the frame spreads over too many samples, the frame is thrown away and the reason is counted. Only then does the complete frame move to a one-slot waiting register in front of the network.',
    rule: 'frame_id = win_idx of the first feature; d = win_idx − frame_id (signed 16-bit): d = 0 and channel new → store; d = 0 and duplicate → abandon (stat_frame_dup); d > 0 → abandon as incomplete (stat_frame_incomplete); d < 0 → discard the feature (stat_feat_late); ts_last − ts_first > cfg_frame_span → abandon (stat_frame_span). All channels of cfg_ch_mask present → complete (stat_frames); pending register busy → dropped (stat_frame_busy, flags.gap on the next prediction).',
    lines: [82, 190],
  },
  {
    id: 'rtl.ai_model', inst: 'u_model', module: 'hbci_model_store', title: 'Model store: 46 words of weights, protected by a checksum',
    plain: 'The network\'s numbers (weights, biases, per-channel centres and shifts, one shift amount and a model tag) live in 46 registers of 32 bits that the host writes over the register bus. After writing them the host also writes the checksum it expects and asks the chip to verify. The chip reads its own 46 words back, computes a CRC-32 and compares. Until the two match, the decoder refuses to predict: frames are counted and dropped. Any write to the model clears the "verified" flag again.',
    rule: 'Words 0..15 W1 (int8 ×4 per word), 16..23 W2, 24..31 b1 (int32), 32..35 b2, 36..43 {qshift[14:12], centre[11:0]} per channel, 44 {model_id[31:16], linear[8], s1[4:0]}, 45 reserved. MODEL_CRC = CRC-32 (IEEE 802.3, zlib) over the 184 bytes. Writes accepted only while cfg_ai_en = 0 (else stat_model_wr_rej, sticky rejected). verify: 4 cycles per word → MODEL_STATUS.valid or .error. No prediction while model_valid = 0 (stat_frame_nomodel).',
    lines: [199, 345],
  },
  {
    id: 'rtl.ai_engine', inst: 'u_engine', module: 'hbci_mlp_engine', title: 'MLP engine: multiply, add, clip, then pick the biggest',
    plain: 'A tiny neural network. For each hidden unit it multiplies the eight inputs by eight weights, adds them with a bias, shifts the sum right (a division by a power of two) and clips it to 0…127 (a ReLU with a ceiling). For each output it does the same with the hidden values and no clipping. The output with the largest value is the class; how far it beats the runner-up is the margin. One multiplier is reused for every product, so an inference takes NH·8 + NO·N2 + 2 clock cycles. In linear mode the hidden layer is skipped and the outputs are computed straight from the eight inputs.',
    rule: 'a1_h = b1_h + Σ_c W1[h][c]·x_c; h_h = clamp(a1_h >> s1, 0, 127). a2_o = b2_o + Σ_k W2[o][k]·in_k (in = h in MLP mode, x in linear mode). logit_o = a2_o (exact, 34-bit). class = argmax (lowest index wins ties); margin = sat_int32(logit_class − max other logit).',
    lines: [351, 522],
  },
  {
    id: 'rtl.ai_fifo', inst: 'hbci_ai_decoder (top-level logic)', module: 'hbci_ai_decoder', title: 'Prediction FIFO: four finished answers waiting for the host',
    plain: 'Each finished prediction (class, margin, the timestamp of the frame\'s last sample, the window number, a running sequence number and two flags) is queued in a four-deep FIFO. The host reads the head over the register bus and pops it with PRED_ACK, or watches the direct pins pred_strobe / pred_class. If the FIFO is full the prediction is dropped, counted, and the next one that gets in carries the gap flag. The same top-level logic holds the pending register, the counters and the last-frame diagnostics (x, h, logits).',
    rule: 'Entry = {class[1:0], margin[31:0], ts[31:0], frame_id[15:0], seq[15:0], flags[3:0]} with flags bit 0 = sat (any saturated channel in the frame), bit 1 = gap (a prediction or frame was dropped before this one). Full FIFO → AI_PRED_DROP++. pred_direct_en drives pred_strobe (1 cycle) and pred_class (held).',
    lines: [528, 768],
  },
];

export const AI_SUBBLOCK_BY_ID: Record<string, AiSubBlock> = Object.fromEntries(AI_SUBBLOCKS.map((b) => [b.id, b]));

/** Register map of hbci02_digital_top (docs/AI_DECODER.md section 4): 8-bit word address, 32-bit data. */
export interface RegEntry { addr: string; name: string; rw: string; fields: string; group: 'id' | 'config' | 'counters' | 'diagnostics' | 'predictions' | 'model' | 'bist' }
export const REGISTER_MAP: RegEntry[] = [
  { addr: '0x00', name: 'ID', rw: 'R', fields: '0x48420204 ("HB", 0x02, v0.4)', group: 'id' },
  { addr: '0x01', name: 'CTRL', rw: 'R/W', fields: '0 session_en · 2:1 mode · 3 ai_en · 4 feat_sync (write 1: one-cycle pulse) · 5 bist_en · 6 pred_direct_en', group: 'config' },
  { addr: '0x02–0x05', name: 'THRESHOLD, HYSTERESIS, REFRACTORY, ALPHA_SHIFT', rw: 'R/W', fields: 'legacy event core (v0.2)', group: 'config' },
  { addr: '0x06–0x0A', name: 'B0, B1, B2, A1, A2', rw: 'R/W', fields: 'signed 15:0, Q2.14 biquad coefficients', group: 'config' },
  { addr: '0x0B–0x0E', name: 'WIN_LOG2, ENERGY_SHIFT, CH_MASK, FRAME_SPAN', rw: 'R/W', fields: 'window 2^k · energy shift · required channels (default 0xFF) · max ts_last − ts_first', group: 'config' },
  { addr: '0x10–0x16', name: 'STAT_SAMPLES … FIFO_HWM', rw: 'R', fields: 'v0.3 counters (samples, rejected, drop_raw/event/feature, event_missed, fifo_hwm)', group: 'counters' },
  { addr: '0x18–0x1F', name: 'AI_FRAMES, AI_PRED, AI_INCOMPLETE, AI_DUP, AI_LATE, AI_SPAN, AI_BUSY, AI_PRED_DROP', rw: 'R', fields: 'decoder counters', group: 'counters' },
  { addr: '0x20–0x22', name: 'AI_NOMODEL, AI_SAT_FRAMES, MODEL_WR_REJ', rw: 'R', fields: 'frames dropped without a verified model · frames with a saturated channel · rejected model writes', group: 'counters' },
  { addr: '0x24', name: 'LAST_FRAME', rw: 'R', fields: '15:0 frame_id · 23:16 missing mask (last abandoned) · 31:24 sat_mask (last inferred)', group: 'diagnostics' },
  { addr: '0x25–0x26', name: 'LAST_X', rw: 'R', fields: 'x_0..x_7 (int8, little-endian) of the last inferred frame', group: 'diagnostics' },
  { addr: '0x27–0x28', name: 'LAST_H', rw: 'R', fields: 'h_0..h_7 of the last inferred frame', group: 'diagnostics' },
  { addr: '0x29–0x2C', name: 'LAST_LOGIT0..3', rw: 'R', fields: 'sat_int32(logit_o)', group: 'diagnostics' },
  { addr: '0x2D', name: 'LAST_TS', rw: 'R', fields: 'ts_last of the last inferred frame', group: 'diagnostics' },
  { addr: '0x30', name: 'PRED_STATUS', rw: 'R', fields: '0 valid · 3:1 count · 7:4 flags of head (0 sat, 1 gap) · 9:8 class', group: 'predictions' },
  { addr: '0x31–0x33', name: 'PRED_MARGIN, PRED_TS, PRED_SEQ_ID', rw: 'R', fields: 'margin · ts · {frame_id[31:16], seq[15:0]} of the head prediction', group: 'predictions' },
  { addr: '0x34', name: 'PRED_ACK', rw: 'W', fields: 'write 1: pop the head prediction', group: 'predictions' },
  { addr: '0x38', name: 'MODEL_CRC', rw: 'R/W', fields: 'expected CRC-32 of words 0..45', group: 'model' },
  { addr: '0x39', name: 'MODEL_CTRL', rw: 'W', fields: 'bit 0 verify: read the 46 words back and compare the CRC', group: 'model' },
  { addr: '0x3A', name: 'MODEL_STATUS', rw: 'R', fields: '0 valid · 1 error · 2 busy · 3 rejected (sticky) · 31:16 model_id', group: 'model' },
  { addr: '0x3C–0x3E', name: 'BIST_SIG, BIST_COUNT, BIST_CTRL', rw: 'R / R / R/W', fields: 'MISR signature · records folded · self-test control', group: 'bist' },
  { addr: '0x40–0x6D', name: 'MODEL[0..45]', rw: 'R/W', fields: 'the 46 parameter words (writes accepted only while ai_en = 0; any accepted write clears model_valid)', group: 'model' },
];

/** The reset / model-loading procedure (docs/AI_DECODER.md section 5), as the story the inspector tells. */
export const LOADING_STORY: string[] = [
  'Reset: every register, counter, FIFO entry and model word is zero; model_valid = 0; ID reads 0x48420204.',
  'Write the configuration (0x01..0x0E) with ai_en = 0.',
  'Write MODEL[0..45], then MODEL_CRC, then MODEL_CTRL.verify = 1; poll MODEL_STATUS until valid or error.',
  'Pulse CTRL.feat_sync (every channel restarts at window 0), then set session_en = 1 and ai_en = 1.',
  'Lost sample or changed window length: pulse feat_sync again. Wrong model: ai_en = 0, rewrite, verify, ai_en = 1.',
];

// ───────────────────────────────────────────── browser checks (spec formulas, bit-exact) ──

export const sat8 = (v: number) => Math.max(-128, Math.min(127, v));
export const sat32 = (v: number) => Math.max(-2147483648, Math.min(2147483647, v));

/** L = 64·n + m (Mitchell log, docs/AI_DECODER.md 3.1). E is an unsigned 32-bit energy. */
export function logEnergy(E: number): number {
  if (E <= 0) return 0;
  const n = Math.floor(Math.log2(E));
  // the six bits immediately below bit n (zeros when n < 6)
  const m = n >= 6 ? Math.floor(E / 2 ** (n - 6)) % 64 : Math.floor(E * 2 ** (6 - n)) % 64;
  return 64 * n + m;
}

/** x_c = sat_int8((L − centre) >> qshift) with an arithmetic (floor) shift. */
export function quantise(L: number, centre: number, qshift: number): number {
  return sat8(Math.floor((L - centre) / 2 ** qshift));
}

export interface MlpCheck { a1: number[]; h: number[]; a2: number[]; cls: number; margin: number }

/** The network of docs/AI_DECODER.md 3.2 on one frame's x (exact integer arithmetic; products fit in float64). */
export function runMlp(m: V04Model, x: number[]): MlpCheck {
  const a1: number[] = [];
  const h: number[] = [];
  for (let k = 0; k < 8; k++) {
    let s = m.b1[k] ?? 0;
    for (let c = 0; c < 8; c++) s += (m.W1[k]?.[c] ?? 0) * (x[c] ?? 0);
    a1.push(s);
    h.push(k < m.NH ? Math.max(0, Math.min(127, Math.floor(s / 2 ** m.s1))) : 0);
  }
  const N2 = m.linear ? 8 : m.NH;
  const inp = m.linear ? x : h;
  const a2: number[] = [];
  for (let o = 0; o < m.NO; o++) {
    let s = m.b2[o] ?? 0;
    for (let k = 0; k < N2; k++) s += (m.W2[o]?.[k] ?? 0) * (inp[k] ?? 0);
    a2.push(s);
  }
  let cls = 0;
  for (let o = 1; o < a2.length; o++) if (a2[o] > a2[cls]) cls = o;
  const others = a2.filter((_, o) => o !== cls);
  const margin = sat32(a2[cls] - (others.length ? Math.max(...others) : 0));
  return { a1, h, a2, cls, margin };
}

/** Inference latency of the engine from its parameters: NH·8 + NO·N2 + 2 cycles (hbci_mlp_engine header). */
export function engineCycles(m: Pick<V04Model, 'NH' | 'NO' | 'linear'>): number {
  return m.linear ? m.NO * 8 + 2 : m.NH * 8 + m.NO * m.NH + 2;
}

let CRC_TABLE: Uint32Array | null = null;
/** CRC-32 (IEEE 802.3, as zlib.crc32) over bytes. */
export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of the 46 model words in address order, little-endian bytes (docs/AI_DECODER.md 3.3). */
export function modelCrc(words: number[]): number {
  const b = new Uint8Array(words.length * 4);
  words.forEach((w, i) => {
    b[4 * i] = w & 0xff;
    b[4 * i + 1] = (w >>> 8) & 0xff;
    b[4 * i + 2] = (w >>> 16) & 0xff;
    b[4 * i + 3] = (w >>> 24) & 0xff;
  });
  return crc32(b);
}

// ───────────────────────────────────────────── reading one frame out of the trace ──

export interface ChannelWindow {
  ch: number;
  /** The feature this channel contributed to the frame (null when the channel is masked or missing). */
  feature: RtlTraceV04['features'][number] | null;
  /** The accepted samples of this channel inside that window (the last 2^win_log2 up to feature.ts), RTL. */
  samples: RtlTraceV04['samples'];
}

export interface FrameJourney {
  frame: RtlTraceV04['frames'][number];
  inference: RtlTraceV04['inferences'][number] | null;
  prediction: RtlTraceV04['predictions'][number] | null;
  channels: ChannelWindow[];
  /** Browser re-run of the quantiser on the RTL energies (shown next to the RTL L / x). */
  quantCheck: { L: number; x: number }[];
  /** Browser re-run of the network on the RTL x (shown next to the RTL h / logits). */
  mlpCheck: MlpCheck;
  winSamples: number;
}

/** Everything the pipeline view shows for one frame, each value taken from the artifact (RTL) and checked. */
export function frameJourney(t: RtlTraceV04, frameIdx: number): FrameJourney | null {
  const frame = t.frames[frameIdx];
  if (!frame) return null;
  const inference = t.inferences.find((x) => x.frame_id === frame.frame_id && x.ts === frame.ts_last) ?? null;
  const prediction = t.predictions.find((p) => p.frame === frame.frame_id && p.ts === frame.ts_last) ?? null;
  const winSamples = 1 << t.config.win_log2;
  const channels: ChannelWindow[] = [];
  for (let ch = 0; ch < t.profile.num_channels; ch++) {
    const f = t.features.find((x) => x.ch === ch && x.win === frame.frame_id && x.ts >= frame.ts_first && x.ts <= frame.ts_last) ?? null;
    const samples: RtlTraceV04['samples'] = [];
    if (f) {
      for (let k = t.samples.length - 1; k >= 0 && samples.length < winSamples; k--) {
        const s = t.samples[k];
        if (s.ch === ch && s.i <= f.ts) samples.unshift(s);
      }
    }
    channels.push({ ch, feature: f, samples });
  }
  const quantCheck = channels.map((c) => {
    if (!c.feature) return { L: 0, x: 0 };
    const L = logEnergy(c.feature.energy);
    const masked = ((t.config.ch_mask >> c.ch) & 1) === 0;
    return { L, x: masked ? 0 : quantise(L, t.model.centre[c.ch], t.model.qshift[c.ch]) };
  });
  return { frame, inference, prediction, channels, quantCheck, mlpCheck: runMlp(t.model, frame.x), winSamples };
}

/** The decoder-related counters of the run with a plain meaning each. */
export const COUNTER_MEANING: Record<string, string> = {
  ai_frames: 'complete frames (every required channel, same window index)',
  ai_pred: 'predictions produced',
  ai_incomplete: 'frames abandoned because a newer window arrived first',
  ai_dup: 'frames abandoned because a channel repeated a window',
  ai_late: 'features discarded because they belonged to an older window',
  ai_span: 'frames abandoned because they spread over more than FRAME_SPAN samples',
  ai_busy: 'complete frames dropped because the engine was still busy',
  ai_pred_drop: 'predictions dropped because the 4-deep FIFO was full',
  ai_nomodel: 'frames dropped because no verified model was loaded',
  ai_sat_frames: 'frames containing at least one saturated channel',
};
