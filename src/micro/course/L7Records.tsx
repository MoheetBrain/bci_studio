// Lesson 7 — Output records. Step 1: record counts and payload bits of the four RTL runs. Step 2: one real record of
// each type, field by field (RTL). Step 3: EDUCATIONAL, learner-stepped model of the record multiplexer rules
// (pending register → arbiter → FIFO → valid/ready). Step 4: the overload test's real drop / gap numbers
// (verification.json, v03_overload_gaps).
import { useMemo, useState } from 'react';
import { useArtifacts } from '../../artifacts/load';
import { SourceView } from '../../circuit/SourceView';
import { MODES, SYSTEM } from '../../model/system';
import type { ProcMode } from '../../model/types';
import type { V03Record } from '../../artifacts/types';
import { TYPE_NAME, decodeEvent, muxInit, muxStep, overloadFacts, type MuxIn, type MuxState, type RecT } from './data';
import { Callout, ChipLinks, Lead, Missing, Seg, Slider, Slower, Source, Widget, chColor, fmt, goChip } from './ui';

const MODE_ORDER: ProcMode[] = ['RAW', 'EVENT', 'FEATURE', 'HYBRID'];
const modeColor = (m: string) => `var(--mode-${m.toLowerCase()})`;
const typeColor = (t: string) => (t === 'RAW' ? 'var(--mode-raw)' : t === 'EVENT' ? 'var(--mode-event)' : 'var(--mode-feature)');

// ── the teaching script: HYBRID mode, samples every tick, a slow receiver (like the overload test, scaled down) ──
const DEPTH = 4;
const SCRIPT: { inp: Partial<MuxIn>; say: string }[] = [
  { inp: { raw: true }, say: 'A sample arrives. In HYBRID mode every sample makes a RAW record (raw_gen = 1).' },
  { inp: {}, say: 'No new sample this tick. The receiver is not ready yet (rec_ready = 0).' },
  { inp: { raw: true, ft: true }, say: 'A sample arrives that also ends an energy window: a RAW and a FEATURE record in the same tick.' },
  { inp: { ready: true }, say: 'The receiver becomes ready (rec_ready = 1) for one tick.' },
  { inp: { raw: true }, say: 'Samples now arrive every tick, faster than the receiver takes records.' },
  { inp: { raw: true }, say: 'Another sample. The FIFO keeps filling.' },
  { inp: { raw: true }, say: 'Another sample. Watch the FIFO: it is about to be full.' },
  { inp: { raw: true }, say: 'Another sample, but the FIFO is full and the RAW pending register is occupied…' },
  { inp: { raw: true }, say: 'And another one.' },
  { inp: { ready: true }, say: 'The receiver is ready again.' },
  { inp: { raw: true, ready: true }, say: 'A new sample arrives while the receiver keeps taking records.' },
  { inp: { ready: true }, say: 'The receiver keeps taking records.' },
  { inp: { ready: true }, say: 'Draining the FIFO.' },
  { inp: { ready: true }, say: 'Draining the FIFO.' },
  { inp: { ready: true }, say: 'The last record leaves. Look at its seq number and flags.' },
];
const full = (p: Partial<MuxIn>): MuxIn => ({ raw: !!p.raw, ev: !!p.ev, ft: !!p.ft, ready: !!p.ready });

function MuxPicture({ s, next }: { s: MuxState; next: MuxIn | null }) {
  const lamp = (on: boolean) => <span className={`c-lamp sm${on ? ' on' : ''}`}>{on ? 1 : 0}</span>;
  return (
    <div className="c-mux7">
      <div className="c-mux7-col">
        <div className="c-k">pending registers</div>
        {(['EVENT', 'FEATURE', 'RAW'] as RecT[]).map((k) => {
          const r = s.pend[k];
          return (
            <div key={k} className={`c-pend${r ? ' full' : ''}`} style={{ ['--tc' as string]: typeColor(k) }}>
              <span className="c-pend-n">{k}</span>
              {r ? <span className="c-rec">#{r.seq}{r.gap ? ' gap' : ''}</span> : <span className="faint">empty</span>}
            </div>
          );
        })}
        <div className="c-k c-small">priority EVENT &gt; FEATURE &gt; RAW</div>
      </div>
      <div className="c-mux7-arrow" aria-hidden>→</div>
      <div className="c-mux7-col">
        <div className="c-k">FIFO ({s.fifo.length}/{DEPTH})</div>
        {Array.from({ length: DEPTH }, (_, k) => {
          const r = s.fifo[k];
          return (
            <div key={k} className={`c-slot${r ? ' full' : ''}`} style={r ? { ['--tc' as string]: typeColor(r.t) } : undefined}>
              {k === 0 && <span className="c-head">head</span>}
              {r ? <span className="c-rec">{r.t} #{r.seq}{r.gap ? ' gap' : ''}</span> : <span className="faint">—</span>}
            </div>
          );
        })}
      </div>
      <div className="c-mux7-arrow" aria-hidden>→</div>
      <div className="c-mux7-col">
        <div className="c-k">output port</div>
        <div className="c-hs">rec_valid {lamp(s.fifo.length > 0)}</div>
        <div className="c-hs">rec_ready {lamp(!!next?.ready)}<small className="faint"> next tick</small></div>
        <div className="c-k">left the chip</div>
        <div className="c-outlist">
          {s.out.length === 0 ? <span className="faint">nothing yet</span> : s.out.slice(-6).map((r, k) => (
            <span key={k} className={`c-rec${r.gap ? ' gap' : ''}`} style={{ ['--tc' as string]: typeColor(r.t) }}>{r.t[0]}#{r.seq}{r.gap ? ' gap' : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecordFields({ r }: { r: V03Record }) {
  const fields = SYSTEM.record.fields;
  const tname = TYPE_NAME[r.type] ?? String(r.type);
  const value = (name: string): string => {
    switch (name) {
      case 'type': return `${r.type} (${tname})`;
      case 'channel': return String(r.ch);
      case 'flags': return `${r.flags.toString(2).padStart(4, '0')} (sat ${r.flags & 1}, gap ${(r.flags >> 1) & 1})`;
      case 'seq': return fmt(r.seq);
      case 'ts': return `sample #${fmt(r.ts)}`;
      case 'data': {
        if (r.type === 1) { const d = decodeEvent(r.data); return `${fmt(r.data)} → polarity ${d.pol} (${d.pol ? 'negative' : 'positive'}), magnitude ${fmt(d.mag)}`; }
        if (r.type === 2) return `${fmt(r.data)} (band energy)`;
        return `${fmt(r.data)} (the sample value)`;
      }
      default: return '';
    }
  };
  return (
    <>
      <div className="c-bits89" role="img" aria-label="Record layout: 89 bits">
        {fields.map((f) => (
          <span key={f.name} style={{ flex: `${f.bits} 1 0` }} className={`c-bf c-bf-${f.name}`}><b>{f.name}</b><i>{f.bits}</i></span>
        ))}
      </div>
      <table className="c-table c-rec-table">
        <tbody>
          {fields.map((f) => (
            <tr key={f.name}>
              <td className="mono">{f.name}<br /><small className="faint">{f.bits} bits</small></td>
              <td className="mono">{value(f.name)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="c-note">It left the chip at clock cycle {fmt(r.cycle)} (logged by the testbench; not one of the 89 bits). Total: {fields.reduce((a, f) => a + f.bits, 0)} bits.</p>
    </>
  );
}

export function Lesson7({ step }: { step: number }) {
  const t = useArtifacts((s) => s.traceV03);
  const v = useArtifacts((s) => s.verification);
  const loaded = useArtifacts((s) => s.loaded);
  const [rt, setRt] = useState<'RAW' | 'EVENT' | 'FEATURE'>('EVENT');
  const [idx, setIdx] = useState<Record<string, number | null>>({ RAW: null, EVENT: null, FEATURE: null });
  const [sim, setSim] = useState<{ s: MuxState; k: number; notes: string[] }>({ s: muxInit(), k: 0, notes: [] });
  const [free, setFree] = useState<MuxIn>({ raw: true, ev: false, ft: false, ready: false });
  const facts = useMemo(() => overloadFacts(v), [v]);
  const need = !t ? (loaded ? <Missing what="rtl_trace_v03.json" /> : <p className="c-hint">Loading the RTL trace…</p>) : null;

  if (step === 0) {
    const maxBits = t ? Math.max(...MODE_ORDER.map((m) => t.runs[m].stats.record_bits)) : 1;
    return (
      <div key={0}>
        <Lead>The chip packs its results into <b>records</b> of {SYSTEM.record.bits_per_record} bits. Which records it makes depends on the mode. The same 4,000 input samples were run through the RTL once per mode:</Lead>
        <Widget ev="RTL" label="Records out of the four RTL runs" testId="course-modes">
          {need ?? (
            <div className="c-modes">
              {MODE_ORDER.map((m) => {
                const run = t!.runs[m];
                const byType = [0, 1, 2].map((ty) => run.records.filter((r) => r.type === ty).length);
                return (
                  <div key={m} className="c-moderow">
                    <div className="c-mode-h"><b style={{ color: modeColor(m) }}>{m}</b><span className="mono">{fmt(run.records.length)} records</span></div>
                    <span className="c-bar wide"><i style={{ width: `${Math.max(0.6, (100 * run.stats.record_bits) / maxBits)}%`, background: modeColor(m) }} /></span>
                    <div className="c-small">
                      {fmt(run.stats.record_bits)} bits
                      {m === 'HYBRID' && <> · {fmt(byType[0])} RAW + {fmt(byType[2])} FEATURE</>}
                      {' · '}{MODES[m].summary}
                    </div>
                  </div>
                );
              })}
              <p className="c-note">Input: {fmt(t!.num_samples)} samples ({t!.profile.num_channels} channels × {fmt(t!.num_samples / t!.profile.num_channels)}). {MODE_ORDER.every((m) => { const st = t!.runs[m].stats; return st.drop_raw + st.drop_event + st.drop_feature === 0; }) ? ' No records were dropped in these runs (every drop counter is 0).' : ' Some records were dropped in these runs: see the drop counters in the trace.'}</p>
            </div>
          )}
        </Widget>
        {t && (
          <Callout tone="warn">
            HYBRID makes <b>more</b> records than RAW ({fmt(t.runs.HYBRID.records.length)} vs {fmt(t.runs.RAW.records.length)}): it is RAW plus FEATURE, for diagnostics. EVENT and FEATURE make far fewer, but they are <b>lossy</b>: from their records the waveform cannot be rebuilt.
          </Callout>
        )}
        <Slower>
          <p><b>RAW</b> sends every sample: nothing is lost, but it is the most data. <b>EVENT</b> sends one record per detected spike: tiny, but everything between spikes is thrown away. <b>FEATURE</b> sends one energy number per channel per window: small, but only "how much 70–150 Hz activity", not the shape.</p>
          <p>The bar shows total payload bits ({SYSTEM.record.bits_per_record} per record). A real link would add framing on top.</p>
        </Slower>
        <Source>
          <p className="c-src-note">Counts are <span className="mono">runs.&lt;MODE&gt;.records.length</span> and bits are <span className="mono">runs.&lt;MODE&gt;.stats.record_bits</span> in rtl_trace_v03.json. The mode decode in the top level:</p>
          <SourceView module="hbci_readout_core" highlightLines={new Set([110, 111, 112, 144, 155, 204])} maxHeight={200} />
        </Source>
      </div>
    );
  }

  if (step === 1) {
    const recs = t ? (rt === 'RAW' ? t.runs.RAW.records : rt === 'EVENT' ? t.runs.EVENT.records : t.runs.FEATURE.records) : [];
    const dflt = rt === 'EVENT' ? Math.max(0, recs.findIndex((r) => r.ch === 5)) : rt === 'RAW' ? Math.min(805, recs.length - 1) : 0;
    const k = Math.min(idx[rt] ?? dflt, Math.max(0, recs.length - 1));
    const r = recs[k];
    return (
      <div key={1}>
        <Lead>Every record has the same six fields: what type it is, which channel, two flag bits, a sequence number, a time stamp (sample number) and 32 bits of data. Here are real ones.</Lead>
        <Widget ev="RTL" label="A real record, field by field" testId="course-record">
          <Seg label="Type" value={rt} onChange={setRt} options={[{ v: 'RAW' as const, label: 'RAW', color: typeColor('RAW') }, { v: 'EVENT' as const, label: 'EVENT', color: typeColor('EVENT') }, { v: 'FEATURE' as const, label: 'FEATURE', color: typeColor('FEATURE') }]} />
          {need ?? (r ? (
            <>
              <Slider id="c7-k" label={`${rt} record (of ${fmt(recs.length)})`} value={k} min={0} max={recs.length - 1} onChange={(n) => setIdx({ ...idx, [rt]: n })} />
              <p className="c-note"><i className="c-sw" style={{ ['--sc' as string]: chColor(r.ch) }} aria-hidden />From the {rt} run.</p>
              <RecordFields r={r} />
            </>
          ) : <Missing what={`${rt} records`} />)}
        </Widget>
        <Slower>
          <p><b>seq</b> counts the records of one type: 0, 1, 2 … If a number is ever skipped, a record of that type was lost. <b>ts</b> says which input sample the record is about (for FEATURE: the last sample of the window).</p>
          <p>The default EVENT record is channel 5's first spike from lesson 5: same sample number, same magnitude.</p>
        </Slower>
        <Source>
          <p className="c-src-note">The FIFO entry is <span className="mono">{'{type, channel, flags, seq, ts, data}'}</span> (record mux, line 449 and lines 529–531):</p>
          <SourceView module="hbci_record_mux" highlightLines={new Set([529, 530, 531])} maxHeight={180} />
        </Source>
      </div>
    );
  }

  if (step === 2) {
    const scripted = sim.k < SCRIPT.length;
    const nextIn = scripted ? full(SCRIPT[sim.k].inp) : free;
    const doTick = () => {
      const r = muxStep(sim.s, nextIn, DEPTH);
      setSim({ s: r.s, k: sim.k + 1, notes: r.notes });
    };
    const box = (key: keyof MuxIn, label: string) => (
      <label className="c-check"><input type="checkbox" checked={free[key]} onChange={(e) => setFree({ ...free, [key]: e.target.checked })} /> <span className="mono">{label}</span></label>
    );
    return (
      <div key={2}>
        <Lead>Records do not leave the instant they are made. Each waits in its type's <b>pending register</b>; an <b>arbiter</b> moves one per clock tick into a queue (<b>FIFO</b>); the head of the queue leaves when the receiver says <span className="mono">rec_ready</span> while the chip says <span className="mono">rec_valid</span>.</Lead>
        <Widget ev="EDUCATIONAL" label="The record path, one clock tick at a time" testId="course-recmux">
          <p className="c-note">
            {scripted ? <><b>Tick {sim.k + 1} of {SCRIPT.length}:</b> {SCRIPT[sim.k].say}</> : <><b>Free play.</b> Choose this tick's inputs, then press Clock tick.</>}
          </p>
          {scripted ? (
            <p className="c-note mono c-small">inputs: raw_gen={+nextIn.raw} feat_gen={+nextIn.ft} event_gen={+nextIn.ev} rec_ready={+nextIn.ready}</p>
          ) : (
            <div className="c-row c-wrap">{box('raw', 'raw_gen')}{box('ft', 'feat_gen')}{box('ev', 'event_gen')}{box('ready', 'rec_ready')}</div>
          )}
          <div className="c-row">
            <button className="btn sm primary" onClick={doTick}>Clock tick ▲</button>
            <button className="btn sm" onClick={() => setSim({ s: muxInit(), k: 0, notes: [] })}>Start again</button>
          </div>
          <MuxPicture s={sim.s} next={nextIn} />
          <div className="c-notes" aria-live="polite">
            {sim.notes.length > 0 && <div className="c-k">What happened at tick {sim.s.tick}</div>}
            <ul>{sim.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
          </div>
          <p className="c-note c-small">drop_raw {sim.s.drop.RAW} · drop_feature {sim.s.drop.FEATURE} · drop_event {sim.s.drop.EVENT} · next seq: RAW {sim.s.seq.RAW}, FEATURE {sim.s.seq.FEATURE}, EVENT {sim.s.seq.EVENT}</p>
        </Widget>
        <Callout>A teaching model of the documented rules, drawn with a {DEPTH}-slot FIFO (the chip's holds 16). It follows the record-mux rules in the RTL but it is not the RTL and has no real timing; the next step shows the real test results.</Callout>
        <Slower>
          <p><b>Pending register:</b> a one-record parking spot per type. <b>Arbiter:</b> each tick it moves at most one waiting record into the FIFO, EVENT first, then FEATURE, then RAW. <b>FIFO:</b> a first-in-first-out queue, like people in a line.</p>
          <p><b>valid/ready handshake:</b> the chip raises rec_valid when it has a record; the receiver raises rec_ready when it can take one. A record leaves only in a tick where both are 1, so neither side can lose a record by being early.</p>
          <p>If a new record arrives while its pending register is still occupied (because the FIFO is full), there is nowhere to put it: it is dropped and counted. The next record of that type that gets in carries the <b>gap</b> flag.</p>
        </Slower>
        <Source>
          <SourceView module="hbci_record_mux" highlightLines={new Set([524, 525, 526, 527, 520, 521])} maxHeight={200} />
        </Source>
        <ChipLinks links={[{ label: 'Show the output traffic controller', go: () => goChip('rtl.u_records', 'die') }]} />
      </div>
    );
  }

  // step 3: real drops and gaps
  const raw = v?.suites.find((s) => s.name === 'v03_raw_reconstruction');
  const totalDrop = facts ? facts.acct.reduce((a, x) => a + x.dropped, 0) : 0;
  return (
    <div key={3}>
      <Lead>Drops are not hidden. In the overload test the receiver was deliberately too slow, and the RTL counted every lost record, skipped its seq number and flagged the next one with <b>gap</b>.</Lead>
      <Widget ev="RTL" label="Overload test: every record accounted for" testId="course-drops">
        {!v ? (loaded ? <Missing what="verification.json" /> : <p className="c-hint">Loading…</p>) : !facts ? <Missing what="suite v03_overload_gaps in verification.json" /> : (
          <>
            <p className="c-note">Suite <span className="mono">v03_overload_gaps</span>: <b>{facts.status.toUpperCase()}</b>. One sample per clock, receiver ready only part of the time.</p>
            {facts.acct.length > 0 ? (
              <table className="c-table">
                <thead><tr><th>type</th><th className="r">generated</th><th className="r">emitted</th><th className="r">dropped</th><th /></tr></thead>
                <tbody>
                  {facts.acct.map((x) => (
                    <tr key={x.type}>
                      <td style={{ color: typeColor(x.type) }}><b>{x.type}</b></td>
                      <td className="mono r">{fmt(x.generated)}</td>
                      <td className="mono r">{fmt(x.emitted)}</td>
                      <td className="mono r">{fmt(x.dropped)}</td>
                      <td>{x.generated === x.emitted + x.dropped ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="c-note">The accounting line could not be parsed; see "Show source".</p>}
            {facts.lost !== null && (
              <p className="c-note">
                Sum of seq jumps before emitted records: <b>{fmt(facts.lost)}</b> lost records; <b>{facts.flagged !== null ? fmt(facts.flagged) : '—'}</b> emitted records carried the gap flag.
                {totalDrop > facts.lost && <> The drop counters total {fmt(totalDrop)}: the other {fmt(totalDrop - facts.lost)} were not followed by an emitted record of their type, so only the counters show them.</>}
              </p>
            )}
            {facts.fifoHwm !== null && <p className="c-note">FIFO high-water mark: {facts.fifoHwm} (completely full).</p>}
          </>
        )}
      </Widget>
      <Callout tone="warn">
        Only RAW can be turned back into the waveform{raw ? <> (suite <span className="mono">v03_raw_reconstruction</span>: {raw.status.toUpperCase()}, {raw.checks} checks)</> : ''}, and only for records that got out. EVENT and FEATURE are lossy by design.
      </Callout>
      <Slower>
        <p>A <b>seq jump</b> is the receiver's clue: if RAW #4 is followed by RAW #7, records #5 and #6 were lost. The <b>gap</b> flag on #7 says the same thing in one bit, and the chip's drop counters say how many in total.</p>
        <p>This is the honest way to handle overload: the chip cannot store everything, but it never pretends that it did.</p>
      </Slower>
      <Source>
        {facts?.raw.map((x) => (
          <p key={x.id} className="c-src-note"><span className="mono">{x.id}</span> ({x.status}): {x.name}. <i>{x.detail}</i></p>
        ))}
        <SourceView module="hbci_record_mux" highlightLines={new Set([571, 572, 573, 574, 575, 576, 577, 578, 579])} maxHeight={200} />
      </Source>
      <ChipLinks links={[{ label: 'Show the output traffic controller', go: () => goChip('rtl.u_records', 'die') }]} />
    </div>
  );
}

export const LESSON7 = {
  id: 'records',
  title: 'Output records',
  steps: ['Four modes', 'One real record', 'Queue and handshake', 'Drops and gaps'],
  Body: Lesson7,
  check: {
    q: 'In HYBRID mode, compared with RAW mode, the chip sends…',
    options: [
      { text: 'fewer records, because it compresses', why: 'HYBRID compresses nothing: it is RAW plus FEATURE.' },
      { text: 'more records: every RAW record plus the FEATURE records', correct: true, why: 'Right: HYBRID made more records than RAW in the RTL runs (step 1). It is for diagnostics, not for saving bandwidth.' },
      { text: 'the same records, in a different order', why: 'The FEATURE records are extra, so the count goes up.' },
    ],
  },
};
