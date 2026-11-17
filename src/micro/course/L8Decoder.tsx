// Lesson 8 — The on-chip decoder (v0.4). Step 1: the frame protocol (why every channel's value must come from the
// same window). Step 2: the quantiser (64·log2, centre, shift, int8). Step 3: the MLP (multiply, add, clip, argmax).
// Step 4: the CRC-protected model and the prediction record. Every number is the RTL's for the frame selected in
// the signal lab's on-chip AI view (rtl_trace_v04.json); browser re-runs of the specification formulas are shown as
// checks next to the RTL values, never instead of them.
import { useMemo } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { COUNTER_MEANING, LOADING_STORY, engineCycles, frameJourney, modelCrc } from '../../model/aiDecoder';
import { useTraceV04, useV04 } from '../../lab/v04Store';
import { useScene } from '../../state/sceneStore';
import { useV03 } from '../../lab/v03Store';
import { Callout, ChipLinks, Lead, Missing, Slider, Slower, Source, Widget, chColor, fmt, goChip } from './ui';

const hex = (n: number) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
const ok = (b: boolean) => <span style={{ color: b ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{b ? '✓' : '✗'}</span>;

function openLabAi() {
  const s = useScene.getState();
  if (s.labSize === 'collapsed') s.setLabSize('normal');
  useV03.getState().setTab('ai');
}

export function Lesson8({ step }: { step: number }) {
  const { trace: t, file } = useTraceV04();
  const loaded = useArtifacts((s) => s.loaded);
  const frame = useV04((s) => s.frame);
  const setFrame = useV04((s) => s.setFrame);
  const fi = t ? Math.min(frame, t.frames.length - 1) : 0;
  const j = useMemo(() => (t ? frameJourney(t, fi) : null), [t, fi]);
  const need = !t ? (loaded ? <Missing what="rtl_trace_v04.json" /> : <p className="c-hint">Loading the v0.4 RTL trace…</p>) : null;
  const placeholder = t && !t.source.model.trained;
  const pick = t ? <Slider id="c8-frame" label={`Frame (of ${t.frames.length})`} value={fi} min={0} max={Math.max(0, t.frames.length - 1)} onChange={setFrame} /> : null;
  const modelWarn = placeholder
    ? <Callout tone="warn">The loaded model is a <b>SYNTHETIC PLACEHOLDER</b> ({t!.source.model.label}). It exercises the hardware; its classes mean nothing about the signal.</Callout>
    : t ? <Callout>Trace <span className="mono">{file}</span>: {t.source.stream.label}; model {t.source.model.label} ({t.model.linear ? 'linear 8→' + t.model.NO : `MLP 8→${t.model.NH}→${t.model.NO}`}). Whether a class is right is a software question (experiments/E02), not an RTL one; nothing is MEASURED. Switch the stream in the signal lab's On-chip AI tab.</Callout> : null;

  if (step === 0) {
    const fr = j?.frame;
    return (
      <div key={0}>
        <Lead>The decoder never looks at one channel alone. It waits for a <b>frame</b>: one number from every channel, all taken from the <b>same window</b>. Each channel counts its own windows (its <span className="mono">win_idx</span>), and only matching counts are allowed together.</Lead>
        <Widget ev="RTL" label="One frame on the tap, channel by channel" testId="course-frame">
          {need ?? (
            <>
              {pick}
              <table className="c-table">
                <thead><tr><th>channel</th><th className="r">win_idx</th><th className="r">ts (last sample)</th><th className="r">energy</th><th className="r">tap cycle</th></tr></thead>
                <tbody>
                  {j!.channels.map((c) => (
                    <tr key={c.ch}>
                      <td><i className="c-sw" style={{ ['--sc' as string]: chColor(c.ch) }} aria-hidden /> ch{c.ch}</td>
                      {c.feature ? <><td className="mono r">{c.feature.win}</td><td className="mono r">{c.feature.ts}</td><td className="mono r">{fmt(c.feature.energy)}</td><td className="mono r">{c.feature.cycle}</td></> : <td colSpan={4} className="faint">missing from this frame</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="c-note">Frame <b className="mono">{fr!.frame_id}</b>: every channel reports window <b className="mono">{fr!.frame_id}</b>; the frame spans samples {fr!.ts_first}–{fr!.ts_last} ({fr!.ts_last - fr!.ts_first} apart) and was complete at cycle {fr!.complete_cycle}.</p>
            </>
          )}
        </Widget>
        <Slower>
          <p>Why insist on the same window? A window is a slice of time ({t ? 1 << t.config.win_log2 : 32} samples of one channel). If channel 3's number came from an earlier slice than channel 5's, the network would be judging two different moments at once, and its answer would describe neither.</p>
          <p>So the collector keeps a waiting room with one seat per channel. A value from the expected window takes its seat. A value from a <b>newer</b> window means the old frame can never complete: it is abandoned (counted as <span className="mono">incomplete</span>) and a new frame starts. A value from an <b>older</b> window is simply turned away (<span className="mono">late</span>). A channel reporting the same window twice (<span className="mono">dup</span>) or a frame stretched over too many samples (<span className="mono">span</span>) also abandons the frame. Nothing is lost silently.</p>
          {t && <p>In this run: {Object.entries(t.counters).filter(([k]) => ['ai_frames', 'ai_incomplete', 'ai_dup', 'ai_late', 'ai_span', 'ai_busy'].includes(k)).map(([k, v]) => `${k.replace('ai_', '')} ${v}`).join(' · ')}.</p>}
        </Slower>
        <Source>
          <p className="c-src-note">The comparison <span className="mono">d = win_idx − frame_id</span> and the four outcomes, in the frame collector:</p>
          <SourceView module="hbci_frame_collector" maxHeight={220} />
        </Source>
        <ChipLinks links={[{ label: 'Show the frame collector on the die', go: () => goChip('rtl.ai_collect', 'die') }, { label: 'Follow this frame in the signal lab', go: openLabAi }]} />
      </div>
    );
  }

  if (step === 1) {
    return (
      <div key={1}>
        <Lead>A window energy can be tiny or enormous. Before it meets the network it is squashed with a logarithm, shifted by a per-channel centre and divided by a power of two, then clipped into one signed byte (−128…127).</Lead>
        <Widget ev="RTL" label="Quantiser on the selected frame (RTL values, browser check beside them)" testId="course-quant">
          {need ?? (
            <>
              {pick}
              <table className="c-table">
                <thead><tr><th>ch</th><th className="r">E</th><th className="r">L = 64·log2 E</th><th className="r">centre</th><th className="r">≫</th><th className="r">x (int8)</th><th>check</th></tr></thead>
                <tbody>
                  {j!.channels.map((c, k) => (
                    <tr key={c.ch}>
                      <td><i className="c-sw" style={{ ['--sc' as string]: chColor(c.ch) }} aria-hidden /> ch{c.ch}</td>
                      {c.feature ? (
                        <>
                          <td className="mono r">{fmt(c.feature.energy)}</td><td className="mono r">{c.feature.L}</td>
                          <td className="mono r">{t!.model.centre[c.ch]}</td><td className="mono r">{t!.model.qshift[c.ch]}</td>
                          <td className="mono r"><b>{c.feature.x}</b></td>
                          <td>{ok(j!.quantCheck[k].L === c.feature.L && j!.quantCheck[k].x === c.feature.x)} <span className="faint mono">L {j!.quantCheck[k].L}, x {j!.quantCheck[k].x}</span></td>
                        </>
                      ) : <td colSpan={6} className="faint">x = 0 (absent)</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Widget>
        <Slower>
          <p><b>L</b> is a cheap logarithm: 64 times the position of the highest 1-bit of E, plus the six bits just below it. Doubling E adds 64 to L. The error of this shortcut is at most 0.086 in log2 units and the software reference reproduces it exactly, so hardware and software agree bit for bit.</p>
          <p><b>x</b> = (L − centre) shifted right by qshift, then clipped. Centre and shift are part of the model (words 36–43), so a trained model centres each channel on its typical energy. {placeholder ? 'Many channels of the placeholder run hit −128 or 127: the placeholder\'s centre was not fitted to this signal.' : 'Channels that still hit 127 or −128 are far from the centre the training data gave them.'}</p>
        </Slower>
        <Source>
          <SourceView module="hbci_feat_quant" maxHeight={160} />
          <SourceView module="hbci_log_energy" maxHeight={160} />
        </Source>
        <ChipLinks links={[{ label: 'Show the quantiser on the die', go: () => goChip('rtl.ai_quant', 'die') }]} />
      </div>
    );
  }

  if (step === 2) {
    const inf = j?.inference;
    const m = t?.model;
    return (
      <div key={2}>
        <Lead>The network itself is small: multiply the eight inputs by weights, add a bias, shift and clip (a hidden unit); do it again for each output; the biggest output wins. One multiplier does every product in turn.{m?.linear ? ' This model is the linear variant (Model A): the hidden layer is skipped and the two outputs are weighted sums of the eight inputs directly.' : ''}</Lead>
        <Widget ev="RTL" label="The MLP on the selected frame" testId="course-mlp">
          {need ?? !inf ? (need ?? <p className="c-note">No inference recorded for this frame.</p>) : (
            <>
              {pick}
              <p className="c-note mono">x = [{j!.frame.x.join(', ')}]</p>
              {!m!.linear && (
                <table className="c-table">
                  <thead><tr><th>hidden unit</th>{Array.from({ length: m!.NH }, (_, k) => <th key={k} className="r">h{k}</th>)}</tr></thead>
                  <tbody>
                    <tr><td>b1 + Σ W1·x (check)</td>{Array.from({ length: m!.NH }, (_, k) => <td key={k} className="mono r faint">{fmt(j!.mlpCheck.a1[k])}</td>)}</tr>
                    <tr><td>h = clamp(… ≫ {m!.s1}, 0, 127) RTL</td>{Array.from({ length: m!.NH }, (_, k) => <td key={k} className="mono r"><b>{inf.h[k]}</b> {ok(inf.h[k] === j!.mlpCheck.h[k])}</td>)}</tr>
                  </tbody>
                </table>
              )}
              <table className="c-table">
                <thead><tr><th>output</th>{inf.logits.map((_, o) => <th key={o} className="r">logit{o}</th>)}</tr></thead>
                <tbody>
                  <tr><td>b2 + Σ W2·{m!.linear ? 'x' : 'h'} (check)</td>{inf.logits.map((_, o) => <td key={o} className="mono r faint">{fmt(j!.mlpCheck.a2[o])}</td>)}</tr>
                  <tr><td>logit RTL</td>{inf.logits.map((l, o) => <td key={o} className="mono r" style={o === inf.cls ? { color: 'var(--accent)' } : undefined}><b>{fmt(l)}</b> {ok(l === j!.mlpCheck.a2[o])}</td>)}</tr>
                </tbody>
              </table>
              <p className="c-note">class = argmax = <b className="mono">{inf.cls}</b> {ok(inf.cls === j!.mlpCheck.cls)} · margin = {fmt(inf.margin)} {ok(inf.margin === j!.mlpCheck.margin)} · {inf.done_cycle - inf.start_cycle} cycles from start to done (formula {t!.latency.formula} = {engineCycles(m!)}).</p>
              {modelWarn}
            </>
          )}
        </Widget>
        <Slower>
          <p>Each hidden unit is a weighted sum of the eight inputs: eight multiplications and eight additions, plus a bias. Shifting right by s1 = {m?.s1 ?? '?'} divides by {m ? 2 ** m.s1 : '?'}; clipping to 0…127 is a ReLU with a ceiling. The outputs are weighted sums of the hidden values (or, in linear mode, of the inputs) with no clipping; they are kept exactly (34 bits), so argmax and margin are exact too.</p>
          <p>The same multiply-and-accumulate is what the band-pass filter does with five products (lesson 6). The decoder repeats it {m ? (m.linear ? m.NO * 8 : m.NH * 8 + m.NO * m.NH) : '?'} times per frame on one shared multiplier: small, slow and honest, not an accelerator.</p>
        </Slower>
        <Source>
          <SourceView module="hbci_mlp_engine" maxHeight={220} />
        </Source>
        <ChipLinks links={[{ label: 'Show the MLP engine on the die', go: () => goChip('rtl.ai_engine', 'die') }, { label: 'Follow this frame in the signal lab', go: openLabAi }]} />
      </div>
    );
  }

  // step 3: CRC, model loading, the prediction record
  const pred = j?.prediction;
  const crc = t ? modelCrc(t.model.words) : 0;
  return (
    <div key={3}>
      <Lead>The weights are not built into the silicon: the host writes 46 words into the model store. The chip then adds them up into a <b>checksum</b> (CRC-32) and compares with the one the host expects. Until they match, no prediction leaves the chip.</Lead>
      <Widget ev="RTL" label="The loaded model and the prediction record of the selected frame" testId="course-crc">
        {need ?? (
          <>
            <p className="c-note mono">46 words · CRC-32 in the trace {hex(t!.model.crc32)} · browser CRC of the same words {hex(crc)} {ok(crc === t!.model.crc32)} · model_id 0x{t!.model.model_id.toString(16)} · {t!.model.linear ? 'linear' : `MLP 8→${t!.model.NH}→${t!.model.NO}`}</p>
            <ol className="c-small" style={{ paddingLeft: 18 }}>{LOADING_STORY.map((l) => <li key={l}>{l}</li>)}</ol>
            {pred ? (
              <table className="c-table c-rec-table">
                <tbody>
                  <tr><td className="mono">class</td><td className="mono">{pred.cls}</td></tr>
                  <tr><td className="mono">margin</td><td className="mono">{fmt(pred.margin)}</td></tr>
                  <tr><td className="mono">ts</td><td className="mono">sample #{fmt(pred.ts)} (last sample of the window)</td></tr>
                  <tr><td className="mono">frame_id</td><td className="mono">{pred.frame} (window index)</td></tr>
                  <tr><td className="mono">seq</td><td className="mono">{pred.seq}</td></tr>
                  <tr><td className="mono">flags</td><td className="mono">{pred.flags.toString(2).padStart(4, '0')} (sat {pred.flags & 1}, gap {(pred.flags >> 1) & 1})</td></tr>
                </tbody>
              </table>
            ) : <p className="c-note">No prediction left the FIFO for this frame.</p>}
            {pred && <p className="c-note">Popped by the testbench at cycle {fmt(pred.cycle)}; the frame completed at cycle {fmt(j!.frame.complete_cycle)}.</p>}
            {modelWarn}
          </>
        )}
      </Widget>
      <Callout>
        Counters at the end of the run: {t ? Object.entries(t.counters).filter(([k]) => k.startsWith('ai_')).map(([k, v]) => <span key={k} className="mono" title={COUNTER_MEANING[k]}>{k.replace('ai_', '')} {v} · </span>) : '—'} every dropped frame or prediction is counted, and the next prediction after a loss carries the gap flag.
      </Callout>
      <Slower>
        <p>A CRC is a checksum: a fixed recipe that folds 184 bytes into one 32-bit number. Change any bit and the number changes. The host computes it in software (zlib.crc32); the chip reads its own 46 words back through the same bus multiplexer and recomputes it (4 cycles per word). A match sets <span className="mono">MODEL_STATUS.valid</span>; a mismatch sets <span className="mono">error</span>. Any accepted write to a model word clears <span className="mono">valid</span> again, and writes are refused while inference is enabled.</p>
        <p>The prediction record is what the host reads: a class, a margin, the time of the window, the window number, a running sequence number and two flags. It is a number about band energies, not a thought.</p>
      </Slower>
      <Source>
        <SourceView module="hbci_model_store" maxHeight={220} />
      </Source>
      <ChipLinks links={[{ label: 'Show the model store on the die', go: () => goChip('rtl.ai_model', 'die') }, { label: 'Show the prediction FIFO', go: () => goChip('rtl.ai_fifo', 'die') }]} />
    </div>
  );
}

export const LESSON8 = {
  id: 'decoder',
  title: 'The on-chip decoder (v0.4)',
  steps: ['Frames: same window', 'Quantiser', 'The MLP', 'Checksum and prediction'],
  Body: Lesson8,
  check: {
    q: 'A feature arrives from channel 2 with window index 7 while the open frame is window 6. What does the collector do?',
    options: [
      { text: 'Adds it to the frame: one number per channel is all that matters', why: 'No: the frame would mix two different moments in time. The collector only combines features with the same window index.' },
      { text: 'Abandons frame 6 (counted as incomplete) and opens frame 7 with this feature', correct: true, why: 'Right: a newer window means the older frame can never complete. The loss is counted (AI_INCOMPLETE), never hidden.' },
      { text: 'Discards the new feature and keeps waiting for window 6', why: 'That is what happens to an older (late) feature. A newer one makes the old frame hopeless, so the frame is abandoned instead.' },
    ],
  },
};
