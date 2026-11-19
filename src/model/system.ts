// The shared system/artifact model (chip/system/hbci_system.json, snapshot of the chip repository), typed for the studio.
import raw from '../../chip/system/hbci_system.json';
import type { ProcMode } from './types';

export interface LoopStage { id: string; name: string; status: string; implemented: boolean; note: string }

export const SYSTEM = raw as typeof raw;
export const MODES = raw.modes as Record<ProcMode, { code: number; records: string[]; summary: string }>;
export const RECORD_BITS: number = raw.record.bits_per_record;
export const TEACHING = raw.profiles.synthetic_teaching;
export const FEATURE = raw.feature;
/** Which registry component stands for each loop stage in the studio. */
export const LOOP_COMPONENT: Record<string, string> = {
  'loop.read': 'sys.electrode_array', 'loop.chip': 'sys.hbci01', 'loop.decoder': 'rtl.ai', 'loop.llm': 'loop.llm', 'loop.feedback': 'loop.feedback',
};
/**
 * The loop stages of system/hbci_system.json. The DECODER stage is overridden here by the studio: since v0.4 the
 * decoder runs on the chip (rtl/hbci_ai_decoder.v, RTL); the shared JSON still describes the v0.3 external one.
 */
export const LOOP: LoopStage[] = (raw.loop as LoopStage[]).map((l) => l.id === 'loop.decoder'
  ? { ...l, name: 'On-chip neural decoder', status: 'RTL', implemented: true, note: 'hbci_ai_decoder (v0.4): quantiser, frame collector, CRC-verified 46-word model, 8→NH→NO MLP or linear model, prediction FIFO. Implemented and simulated (RTL); its output is a class and a margin, not a thought. Larger decoders stay external (CONCEPT). Studio override of system/hbci_system.json, which still lists the v0.3 external decoder.' }
  : l);
export const MISSION = raw.mission;
export const BISC = raw.scale_reference.BISC_2025;

/** sha256 over rtl/*.v computed by vite.config.ts when the dev server started. */
declare const __RTL_SHA256__: string;
export const RTL_SHA256_AT_BUILD: string = typeof __RTL_SHA256__ === 'string' ? __RTL_SHA256__ : 'unknown';

/**
 * Payload of one mode for a given profile, in bits per second.
 * RAW: one 89-bit record per sample. FEATURE: one record per channel per window.
 * EVENT: one record per event (rate supplied by the caller from data). HYBRID: RAW + FEATURE.
 * A sample-only reference (channels × rate × bits) is returned for comparison.
 */
export function payload(p: { channels: number; rateHz: number; sampleBits: number; winSamples: number; eventRateHz: number; recordBits?: number }) {
  const rb = p.recordBits ?? RECORD_BITS;
  const samplesPerS = p.channels * p.rateHz;
  const sampleOnly = samplesPerS * p.sampleBits;
  const raw = samplesPerS * rb;
  const feature = (samplesPerS / Math.max(1, p.winSamples)) * rb;
  const event = p.eventRateHz * rb;
  return { sampleOnly, RAW: raw, FEATURE: feature, EVENT: event, HYBRID: raw + feature };
}
