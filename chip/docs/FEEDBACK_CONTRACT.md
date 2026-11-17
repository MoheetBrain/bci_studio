# Feedback interface contract `hbci.feedback/0.1` (research branch, software only)

The FEEDBACK stage closes the READ → CHIP → DECODER → LLM → FEEDBACK loop. In v0.3 it is a **software
contract only**:
- No neural return channel and no stimulation hardware or firmware exist.
- Nothing connects to tissue.
- The indicators are **not** validated neural sensations.

## Message
| Field | Type | Meaning |
|---|---|---|
| `contract` | `"hbci.feedback/0.1"` | Version tag |
| `indicator` | `ready` · `uncertain` · `request_clarification` | The only three indicators |
| `origin` | `scripted` · `operator` | v0.3 has no decoder, so messages are scripted (studio demo) or come from a human operator |
| `text` | string, optional | Text shown to the person |
| `created_at` | ISO 8601 time | |
| `channel` | `screen` · `audio` · `haptic_device` | The delivery channel actually used. There is no neural channel |

The TypeScript implementation (types, constructor and validator) is in `studio/src/model/feedback.ts`. The
studio's Loop tab emits these messages from a scripted example and validates them.

## Meaning of the indicators
| Indicator | Meaning |
|---|---|
| `ready` | The external system has an answer to show |
| `uncertain` | Low confidence; nothing should be acted on |
| `request_clarification` | The person should clarify through an ordinary input |

## Explicitly out of scope
- Encoding semantic content into neural stimulation, including the tactile-semantic channel proposed in the
  research report. That remains a hypothesis.
- Inferring emotional or cognitive state automatically.
- Using a neural threshold crossing as authorisation ("wake word"). Capture is gated by an explicit
  `cfg_session_en`.
