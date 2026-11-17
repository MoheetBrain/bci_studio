// Software-only feedback contract (docs/FEEDBACK_CONTRACT.md). A research branch: these indicators are shown
// on a screen or device. They are NOT neural sensations and nothing here drives stimulation.

export type FeedbackIndicator = 'ready' | 'uncertain' | 'request_clarification';

export interface FeedbackMessage {
  contract: 'hbci.feedback/0.1';
  indicator: FeedbackIndicator;
  /** What produced it. In v0.3 only 'scripted' or 'operator' are possible: no decoder exists. */
  origin: 'scripted' | 'operator';
  /** Free text shown to the person, if any. */
  text?: string;
  /** ISO time the message was created. */
  created_at: string;
  /** Delivery channel actually used. Never a neural channel in v0.3. */
  channel: 'screen' | 'audio' | 'haptic_device';
}

export const INDICATOR_MEANING: Record<FeedbackIndicator, string> = {
  ready: 'The external system has an answer ready to show.',
  uncertain: 'The external system is not confident; nothing should be acted on.',
  request_clarification: 'The external system needs the person to clarify through an ordinary input.',
};

export function makeFeedback(indicator: FeedbackIndicator, origin: FeedbackMessage['origin'], text?: string): FeedbackMessage {
  return { contract: 'hbci.feedback/0.1', indicator, origin, text, created_at: new Date().toISOString(), channel: 'screen' };
}

/** Validates a message against the contract; returns a list of problems (empty = valid). */
export function validateFeedback(m: Partial<FeedbackMessage>): string[] {
  const p: string[] = [];
  if (m.contract !== 'hbci.feedback/0.1') p.push('contract must be hbci.feedback/0.1');
  if (!m.indicator || !(m.indicator in INDICATOR_MEANING)) p.push('indicator must be ready | uncertain | request_clarification');
  if (m.origin !== 'scripted' && m.origin !== 'operator') p.push('origin must be scripted or operator (no decoder exists in v0.3)');
  if (m.channel !== 'screen' && m.channel !== 'audio' && m.channel !== 'haptic_device') p.push('channel must be screen | audio | haptic_device (no neural channel)');
  if (!m.created_at) p.push('created_at required');
  return p;
}
