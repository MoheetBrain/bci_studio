// Plain-English copy for the Learn inspector. One entry per component answers, in order:
// what am I looking at · what does it do · what enters · what leaves · what if it is absent · is it implemented.
// Components without an entry get a fallback built from the registry text (purpose/input/output/remove).
// Rules kept here on purpose: feature energy is never called "meaning"; the scripted LLM example is never a
// "decoded thought"; the decoder and LLM are software functions that run outside the body.
import type { ComponentInfo, ImplStatus } from './types';
import { kindOf } from './kind';

export interface LearnCopy {
  what: string;
  does: string;
  enters: string;
  leaves: string;
  absent: string;
  implemented: string;
  /** Optional tiny concrete example shown instead of the input → transformation → output cards. */
  example?: { title: string; rows: string[]; note?: string };
}

export type NextActionId = 'enter' | 'focus' | 'system' | 'circuit' | 'lab-loop' | 'lab-payload' | 'lab-repr' | 'lab-ai' | 'lift-lid';

const LEARN: Record<string, LearnCopy> = {
  'sys.hbci01': {
    what: 'HBCI-02 is the project\'s chip: a small digital readout processor with, since v0.4, its own tiny neural-network decoder, shown inside a conceptual package.',
    does: 'It takes the stream of numbers coming from the ADC and sends them on in one of four forms you choose (RAW, EVENT, FEATURE, HYBRID). At the same time it feeds every finished band-energy window into the on-chip decoder, which announces a class and a margin for each frame of eight windows.',
    enters: 'Signed 16-bit ADC codes from 8 channels, one sample at a time, plus a register bus for settings, the 46-word model and read-back.',
    leaves: 'A stream of 89-bit records, prediction records (class, margin, time, window number, sequence number, flags), and counters for anything dropped.',
    absent: 'Without it the outside computer would have to take every raw sample itself, with no on-device summaries, no on-device decisions and no loss accounting.',
    implemented: 'The DSP core and the on-chip decoder are real RTL, simulated against a cycle-accurate reference and synthesised (SKY130 cell mapping). The package around them is an illustration; the genuine v0.4 place-and-route result, when published, is on the Physical layout level. No silicon exists.',
    example: {
      title: 'One second of one channel at 2,000 samples/s becomes',
      rows: ['RAW: 2,000 records (every sample)', 'FEATURE: about 62 records (one per 32-sample window)', 'HYBRID: both, about 2,062 records', 'EVENT: one record per threshold crossing'],
      note: 'Arithmetic from the synthetic teaching profile and the spec, not a measured data rate.',
    },
  },
  'pkg.die': {
    what: 'The silicon die: the small square under the lid that would carry hbci02_digital_top, the v0.4 chip logic.',
    does: 'It hosts all of the chip\'s logic: legacy spike detection, the RAW pass-through, the band-pass filter and band-energy window, the record multiplexer, the on-chip AI decoder, the register file and a self-test. Everything around it is packaging.',
    enters: 'Clock, reset, configuration and the multiplexed sample stream, through the bond wires.',
    leaves: 'The record stream and status counters, back out through the bond wires.',
    absent: 'There would be no circuit at all: a package with nothing inside.',
    implemented: 'The logic is real RTL, simulated and synthesised. The die\'s size and block placement here are illustrative (the die map is not the floorplan); the genuine v0.4 layout, when published, is on the Physical layout level. Nothing has been fabricated.',
  },
  'pkg.lid': {
    what: 'The package lid: the dark cap that covers the die. In the studio you can lift it to look inside.',
    does: 'It protects the die from damage, light and moisture, gives heat a path out and carries the markings that identify the chip. It does nothing to the signal.',
    enters: 'Nothing electrical: only mechanical load and heat from the die.',
    leaves: 'Nothing electrical: a sealed, labelled top surface.',
    absent: 'The die and its hair-thin bond wires would be exposed and easily damaged, and moisture would reach the silicon.',
    implemented: 'An illustrative QFN-style lid drawn in scene units. No package has been designed, so it has no millimetre size and its drawn thickness is not a design value.',
  },
  'pkg.substrate': {
    what: 'The package substrate: a tiny circuit board inside the package that the die sits on.',
    does: 'It fans the die\'s few closely spaced pads out to the larger contacts that can be soldered to a board, and gives the die a flat, rigid surface to sit on.',
    enters: 'Signals from the die pads, delivered by the bond wires.',
    leaves: 'The same signals on the package contacts underneath.',
    absent: 'The die\'s pads are too small and too close together to solder; there would be no way to connect it to a board.',
    implemented: 'Illustrative only. No substrate design or pin-out exists; pin count and parasitics would matter in a real one. The size is in scene units, not millimetres.',
  },
  'pkg.bonds': {
    what: 'The bond wires: hair-thin gold or copper wires between the die and the substrate.',
    does: 'They are the die\'s only electrical way in and out. Each wire carries one signal, power or ground, and each adds a little inductance and resistance.',
    enters: 'Clock, reset, configuration and samples travelling into the die.',
    leaves: 'Records and status counters travelling out of the die.',
    absent: 'The die would be sitting in its package electrically disconnected from everything: no clock, no samples, no records.',
    implemented: 'Illustrative. No pad ring or bonding diagram has been designed; the wire count only loosely mirrors the RTL port groups, and the wires have no millimetre length.',
  },
  'pkg.pins': {
    what: 'The package contacts: the metal pads on the underside of the package, arranged around its edge.',
    does: 'They are soldered to the circuit board, joining the package to it mechanically and electrically, and they carry power in and signals both ways.',
    enters: 'Signals routed through the substrate; power and ground from the board.',
    leaves: 'Signals and power on the circuit board, towards the ADC and the communication link.',
    absent: 'The package could not be attached to a board or connected to the ADC and the communication link.',
    implemented: 'Illustrative. No pin-out, pitch or package outline is defined; nothing here has a millimetre size, and the contact count is not a design value.',
  },
  'sys.housing': {
    what: 'The hermetic housing: a sealed shell around the electronics, shown as a concept.',
    does: 'It keeps body fluids away from the electronics and the electronics away from tissue, spreads the heat they produce, and lets signals and power through sealed feedthroughs.',
    enters: 'Mechanical load, moisture and heat from the parts inside.',
    leaves: 'A sealed boundary; signals and power pass through feedthroughs.',
    absent: 'Fluids would reach the electronics and the electronics would touch tissue; the device would fail and could cause harm.',
    implemented: 'Not designed, sized or qualified. The shell is drawn in scene units. Real implants use titanium or ceramic enclosures that must stay sealed for years.',
  },
  'sys.electrode_array': {
    what: 'The neural electrode array: tiny metal contacts that would sit next to brain cells.',
    does: 'It picks up the microvolt-level voltage changes that nearby neurons produce when they fire, at the boundary where ionic current in tissue becomes electronic current in metal.',
    enters: 'Ionic currents in the tissue around active neurons.',
    leaves: 'Eight very small analog voltages, one per electrode site, into the flexible interconnect.',
    absent: 'Nothing would sense neural activity; every stage downstream, including the chip, would be processing nothing but noise.',
    implemented: 'Not implemented and never tested on tissue. Eight sites are drawn to match the chip\'s eight processing channels; electrode materials are studied separately.',
  },
  'sys.flex_interconnect': {
    what: 'The flexible interconnect: a thin, bendable ribbon of insulated metal traces between the electrodes and the electronics.',
    does: 'It carries the electrode signals from the soft, moving brain side to the rigid electronics without adding much noise or crosstalk between channels.',
    enters: 'Eight very small analog electrode signals.',
    leaves: 'The same eight signals at the connector, slightly attenuated.',
    absent: 'The electrode signals could not reach the amplifiers at all, and a rigid wire would damage the tissue it moves against.',
    implemented: 'A concept drawn in scene units. Real ribbons use polyimide or parylene with thin-film metal traces; none has been designed here.',
  },
  'sys.connector': {
    what: 'The electrode connector: the plug where the flexible ribbon meets the rigid electronics board.',
    does: 'It joins the ribbon to the board so the two can be attached and detached, and it keeps each channel insulated from its neighbours.',
    enters: 'Eight ribbon traces.',
    leaves: 'The same eight signals on the circuit board, into the analog front end.',
    absent: 'The ribbon could not be attached to, or detached from, the board, so the sensor could never be replaced or tested separately.',
    implemented: 'Illustrative only. No connector part has been chosen; contact resistance, leakage in humidity and size would all matter in a real one.',
  },
  'sys.afe': {
    what: 'The analog front end: eight very quiet amplifiers between the electrodes and the ADC.',
    does: 'It makes microvolt neural signals large enough to measure, and filters out slow offsets and out-of-band noise before anything is digitised.',
    enters: 'Microvolt electrode signals riding on much larger electrode offsets.',
    leaves: 'Amplified, band-limited voltages in the ADC\'s input range.',
    absent: 'The tiny signals would be buried in the ADC\'s own noise; the digitised numbers would be mostly quantisation noise, and nothing downstream could recover them.',
    implemented: 'Not implemented. HBCI-02 v0.4 contains no analog circuitry; this block is a concept drawn in scene units, and a real front end is a custom design.',
  },
  'sys.adc': {
    what: 'The ADC stage: the converter that turns the amplified voltages into numbers.',
    does: 'It measures each of the eight channels in turn, 2,000 times a second per channel in the teaching profile, and writes each measurement as a signed 16-bit code.',
    enters: 'Eight amplified analog voltages from the front end.',
    leaves: 'A single stream of (channel, sample) pairs into the chip: ADC codes, which are dimensionless numbers, not microvolts.',
    absent: 'Analog voltages would never become numbers, so the digital chip would have no input.',
    implemented: 'Not implemented. The chip\'s input interface assumes this stream and cannot pause it, like a real ADC; effective resolution and power would matter in a real design.',
    example: {
      title: 'What the chip actually sees (ADC codes, dimensionless)',
      rows: ['ch 1, sample 250: −512', 'ch 1, sample 251: 37', 'ch 1, sample 252: 1204'],
      note: 'Illustrative values. The signal lab shows real ones from the RTL trace or the educational model.',
    },
  },
  'sys.comms': {
    what: 'The data communication interface: the link that would carry the chip\'s records out of the body.',
    does: 'It would serialise and transmit the record stream to a computer outside the body, with a wireless radio sitting here in a real device.',
    enters: 'HBCI-02 records, 89 bits of fields each, with the valid/ready handshake.',
    leaves: 'A data link to an external computer.',
    absent: 'Records would be produced on the device but could never leave it, so nothing outside could use them.',
    implemented: 'Not implemented. HBCI-02 has no radio, serialiser, framing or encryption in RTL; the payload figures in the studio are arithmetic on the 89-bit record, not a measured link rate.',
  },
  'sys.pcb': {
    what: 'The supporting circuit board: the board that holds the bench prototype\'s parts and wires them together.',
    does: 'It carries copper traces between the connector, the front end, the ADC, the chip, the communication link and the power stage, and gives them something to mount on.',
    enters: 'Power and signals from every part mounted on it.',
    leaves: 'Connections between those parts, and the mechanical support that holds them in place.',
    absent: 'The parts would have no wiring between them and nothing to hold them; the signal chain would be a pile of loose components.',
    implemented: 'Illustrative, drawn in scene units. No board has been designed; size, layer count and signal integrity are all open.',
  },
  'sys.power': {
    what: 'The power stage and inductive coil: how the bench prototype would be powered without a wire through the skin, shown as a concept.',
    does: 'It would receive power wirelessly from a coil outside the body, rectify it and regulate it into the stable supply rails the electronics need.',
    enters: 'An alternating magnetic field from an external coil.',
    leaves: 'Stable supply rails for the board.',
    absent: 'Nothing would run: no amplifier, no ADC, no chip and no link.',
    implemented: 'Not implemented and not sized. Coupling efficiency, coil alignment and tissue heating would all have to be engineered; none of it is.',
  },
  'sys.ai_module': {
    what: 'The external computation module: software that would run on a computer outside the body.',
    does: 'It would interpret the chip\'s records. It contains the decoder and language-model stages of the loop, both of which are software functions.',
    enters: 'RAW, EVENT or FEATURE record streams from the communication link.',
    leaves: 'Estimates or commands, with uncertainty, and whatever feedback indicator the loop returns to the person.',
    absent: 'Records would be produced but never decoded or used; the loop would end at the link.',
    implemented: 'Not implemented. Nothing here is hardware, and no decoding has been trained or tested.',
  },
  'loop.ext_decoder': {
    what: 'The external decoder for larger models: a software function that would run on a computer outside the body, not a part of the implant.',
    does: 'It would run models too large for the chip, using the records and the on-chip predictions, to estimate a task variable such as an intended cursor movement.',
    enters: 'RAW, EVENT or FEATURE records and prediction records from the chip.',
    leaves: 'An estimate with an uncertainty. It is not automatically correct, and it is not a thought.',
    absent: 'Only the chip\'s small on-chip classes would be available; nothing larger would interpret the records.',
    implemented: 'Not implemented. The small 8→NH→NO decoder runs on the chip (v0.4, RTL); larger decoding and its accuracy on appropriate data remain open.',
  },
  'rtl.ai': {
    what: 'The on-chip AI decoder: a small quantised neural network written in Verilog, inside the chip, fed by the band-energy windows.',
    does: 'It compresses each window energy into a signed byte, collects one byte from every channel for the same window, runs them through a few multiply-and-add steps (hidden units, then outputs) and reports which output was largest and by how much. It only does so after the host\'s 46-word model has passed a checksum.',
    enters: 'Every completed feature window: channel, energy, timestamp, saturation flag and window index; the model words over the register bus.',
    leaves: 'Prediction records (class, margin, timestamp, window number, sequence number, flags) in a four-deep queue, direct pins, counters and the last frame\'s intermediate values.',
    absent: 'The chip would be the v0.3 readout again: every decision would have to be taken outside the body from the record stream.',
    implemented: 'Real RTL (rtl/hbci_ai_decoder.v), simulated cycle-accurately against scripts/golden_ai.py and synthesised (SKY130 HD mapping: 10,707 cells). Trained off-chip; the model is data loaded over the bus (trained or placeholder, as the On-chip AI tab says). Its layout is part of the v0.4 chip-top layout when published; no silicon.',
    example: {
      title: 'One frame, step by step (RTL values in the signal lab)',
      rows: ['8 window energies E → L = 64·log2 E → x = sat_int8((L − centre) ≫ qshift)', 'frame = the 8 x values of one window index', 'logits = b + Σ W·(h or x) → class = argmax, margin = winner − runner-up', 'NO·8 + 2 cycles (linear) or NH·8 + NO·NH + 2 (MLP) from start to done'],
      note: 'The On-chip AI tab of the signal lab shows every one of these numbers for any frame of rtl_trace_v04(.real).json, with the model\'s trained / placeholder status.',
    },
  },
  'loop.llm': {
    what: 'An external language model: a software function that would run on a computer outside the body, not a part of the implant.',
    does: 'It would reason over an authorised request plus context and produce a text answer. In the studio it only replays a pre-written script.',
    enters: 'An authorised request, from the decoder stage or typed by the user.',
    leaves: 'A text response on a screen. Nothing is delivered into the brain, and the example is not a decoded thought.',
    absent: 'Decoded requests would have no reasoning stage; the loop could only relay estimates.',
    implemented: 'No model is called and no neural data is read. The dialogue shown is labelled SCRIPTED.',
  },
  'loop.feedback': {
    what: 'The feedback interface: how information would come back to the person. Today it is only a software contract.',
    does: 'It would show a simple indicator such as "ready", "uncertain" or "please clarify" on a screen or device, so the person knows what the system made of their request.',
    enters: 'An indicator from the external software stages.',
    leaves: 'Something visible or audible outside the body. Not a neural sensation; no stimulation.',
    absent: 'The loop would be open: the person would get no confirmation of what the system understood.',
    implemented: 'A research branch defined in docs/FEEDBACK_CONTRACT.md. No direct neural return channel exists or is planned here.',
  },
  'sys.root': {
    what: 'The bench prototype: everything a complete brain–computer interface would need, laid out as one assembly.',
    does: 'It shows the chain from electrodes through amplification and digitisation to the chip, the link out of the body, and the software stages beyond it.',
    enters: 'Microvolt voltages from neural tissue, in concept; nothing here is connected to tissue.',
    leaves: 'Records leave the device; any decoding happens in software outside the body.',
    absent: 'There would be no testable development setup, only separate concepts with nothing to connect them.',
    implemented: 'Only the digital logic inside HBCI-02 (DSP readout core and on-chip AI decoder) exists as real, tested code. Every other part is illustrative geometry in scene units.',
  },
  'cx.root': {
    what: 'A thin cortical-interface candidate: an idea for a much thinner device lying on the surface of the brain.',
    does: 'It would sense on a thin film, process close to the electrodes and relay records out through the skin, avoiding the separate packaged boards of the bench prototype.',
    enters: 'Cortical surface potentials, in concept.',
    leaves: 'Records to an external relay, in concept.',
    absent: 'You would only see the bench prototype and could not compare packaging approaches.',
    implemented: 'Nothing here is engineered, manufactured or tested. The layers are drawn with exaggerated thickness and have no millimetre size; the chip inside stays the same RTL core.',
  },
  'rtl.readout': {
    what: 'hbci_readout_core, the top of the v0.3 chip logic: the block diagram you see on the die.',
    does: 'It wraps the unchanged v0.2 event detector and adds the RAW path, the FEATURE path and a record multiplexer, so one chip can send samples, events, energies or samples plus energies.',
    enters: 'Accepted samples with their channel, the mode setting and a session switch.',
    leaves: 'One ordered record stream with sequence numbers and counted drops.',
    absent: 'Only the legacy event detector would remain, and the original waveform could never be preserved.',
    implemented: 'Real RTL, simulated with Icarus Verilog and synthesised with Yosys; the v0.3 core alone also has a genuine place-and-route layout (artifacts/layout_v03, not the v0.4 chip). Placement on the v0.4 die map is a concept.',
  },
  'rtl.raw_path': {
    what: 'The RAW preservation path: a straight pipe for the original numbers, inside the readout core.',
    does: 'During a capture session in RAW or HYBRID mode it wraps every accepted sample into a record, unchanged, so a decoder outside can use the whole waveform.',
    enters: 'The accepted sample, its channel and its sample index.',
    leaves: 'A RAW record to the record multiplexer, one per sample.',
    absent: 'Downstream software would only ever see summaries, and anything those summaries discard would be gone for good.',
    implemented: 'Real RTL, simulated and synthesised; exact reconstruction of the input from the records is verified in simulation.',
  },
  'rtl.u_biquad': {
    what: 'The band-pass filter: a small fixed-point filter that keeps one frequency band.',
    does: 'It passes wiggles near 100 Hz (70–150 Hz by default) and reduces slow drifts and fast hiss, using only past and present samples.',
    enters: 'The current sample and the last two inputs and outputs of its channel, plus five coefficients.',
    leaves: 'A filtered sample and a flag saying whether it had to be clipped.',
    absent: 'The energy block would measure every frequency at once, so drift and noise would swamp the band you care about.',
    implemented: 'Real RTL, simulated and synthesised. It is a single second-order section: a coarse band selector, not a sharp filter.',
  },
  'rtl.u_energy': {
    what: 'The band-energy window: it turns many filtered samples into one number per channel per window.',
    does: 'It adds up the squares of the filtered samples over a short window (32 samples by default) and emits the total as a FEATURE record.',
    enters: 'Filtered samples and the running total for the channel.',
    leaves: 'One band-energy number per channel per window. It is a measure of activity in the band, not a meaning.',
    absent: 'FEATURE mode would have no output; you would have to send every filtered sample, which is as large as RAW.',
    implemented: 'Real RTL, simulated and synthesised. The window length is configurable and trades time resolution against payload.',
  },
  'rtl.u_records': {
    what: 'The record multiplexer and FIFO: the chip\'s exit queue.',
    does: 'It merges RAW, EVENT and FEATURE records into one ordered stream and counts every record it has to drop, so nothing is lost silently.',
    enters: 'Records from the three paths, and a ready signal from whatever reads the chip.',
    leaves: 'The record stream, with per-type sequence numbers, gap flags and drop counters.',
    absent: 'Three sources would compete for one output with no ordering or loss accounting; overload would silently corrupt the stream.',
    implemented: 'Real RTL, simulated and synthesised. This is where implemented processing stops: what reads the records is not built.',
  },
  'rtl.core': {
    what: 'hbci_event_core, the legacy v0.2 detector kept inside the v0.3 chip as the EVENT path.',
    does: 'For each channel it tracks a baseline, compares each sample\'s deviation with a threshold and reports crossings, with hysteresis and a short refractory period. It is unchanged from v0.2.',
    enters: 'Accepted samples with their channel and the threshold settings.',
    leaves: 'EVENT records: channel, time, polarity and size of each crossing, and nothing between crossings.',
    absent: 'EVENT mode would disappear, and there would be nothing lossy to compare RAW and FEATURE against.',
    implemented: 'Real RTL, simulated, synthesised, and the only block with a genuine (v0.2) place-and-route layout.',
  },
};

const STATUS_WORDS: Record<ImplStatus, string> = {
  conceptual: 'Not implemented: illustrative geometry or a design idea.',
  simulated: 'Implemented as RTL and simulated; no silicon.',
  synthesised: 'Simulated and synthesised RTL; no silicon.',
  'physically designed': 'Placed and routed with a PDK; not fabricated.',
  manufactured: 'Fabricated; not yet measured.',
  tested: 'Measured on real hardware.',
};

/** Implementation status in words, honest about software and scripted stages. */
export function implementationWords(c: ComponentInfo): string {
  if (kindOf(c) === 'software') return c.evidence === 'SCRIPTED' ? 'Software function outside the body; scripted example only, no model is called.' : 'Software function outside the body; not implemented.';
  if (c.id === 'sys.hbci01' || c.id === 'pkg.die') return 'Chip logic (DSP core + on-chip decoder): simulated and synthesised RTL; its genuine layout, when published, is on the Physical layout level. Package and die geometry: concept. No silicon.';
  if (c.id === 'rtl.core') return 'Simulated and synthesised RTL with a genuine v0.2 place-and-route layout; not fabricated.';
  return STATUS_WORDS[c.status];
}

/** Learn copy for a component: the curated entry, or a fallback assembled from the registry. */
export function learnCopyFor(c: ComponentInfo): LearnCopy {
  const l = LEARN[c.id];
  if (l) return l;
  const dash = (s: string) => (s === '—' ? 'Nothing: it is a mechanical part.' : s);
  return {
    what: `${c.name}. ${c.purpose}`,
    does: c.transformation === '—' ? 'It has no signal-processing role of its own.' : c.transformation,
    enters: dash(c.input),
    leaves: dash(c.output),
    absent: c.remove ?? 'This part has no "remove" lesson yet.',
    implemented: implementationWords(c),
  };
}

export function hasCuratedLearn(id: string): boolean {
  return id in LEARN;
}

/** The one obvious next action for a component in Learn mode. */
export function nextActionFor(c: ComponentInfo): { id: NextActionId; label: string } {
  if (c.id === 'sys.hbci01') return { id: 'enter', label: 'Open the package' };
  if (c.id === 'pkg.lid') return { id: 'lift-lid', label: 'Lift the lid' };
  if (c.enter === 'die') return { id: 'enter', label: 'Explore inside the die' };
  if (c.enter === 'module') return { id: 'circuit', label: 'Look inside this block' };
  if (c.enter === 'circuit') return { id: 'circuit', label: 'Open the circuit' };
  if (c.id === 'sys.comms') return { id: 'lab-payload', label: 'Open the payload calculator' };
  if (c.id.startsWith('rtl.ai')) return { id: 'lab-ai', label: 'Follow one frame through the decoder' };
  if (c.id.startsWith('loop.') || c.id === 'sys.ai_module') return { id: 'lab-loop', label: 'Open the loop in the signal lab' };
  if (c.id === 'sys.adc') return { id: 'lab-repr', label: 'See real samples in the signal lab' };
  if (c.level === 'system') return { id: 'system', label: 'Show it in the system' };
  return { id: 'focus', label: 'Focus on it in 3D' };
}
