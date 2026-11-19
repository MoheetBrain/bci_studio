// Decoder comparison: which decoder to prefer depends on the task, the data and the budget. Everything measured on
// this page comes from the synthetic motor model; the page says so wherever a number appears, and separates that from
// what published work on real recordings supports.
import { useEffect, useMemo, useState } from 'react';
import { Cites } from '../science/Cite';
import { useShell } from '../shell/shellStore';
import { useExperiment } from './experimentStore';
import { BENCH_LOST, BENCH_NEAR_UM, BENCH_NOISE_UV, accuracyUnder, paretoFront, preferred, type BenchRow, type Constraints } from './model/bench';
import { Prov } from './Prov';
import { Choice, Slider } from './stageViews';

const COLORS: Record<string, string> = { linear: '#7FE7FF', mlp8: '#FFD08A', kalman: '#8CFFB5', wiener5: '#D7B8FF', mlp32: '#F29BC0' };
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

function Pareto({ rows, c, pick }: { rows: BenchRow[]; c: Constraints; pick: BenchRow | null }) {
  const W = 560, H = 300, L = 54, R = 16, T = 14, B = 40;
  const xs = rows.map((r) => r.serialCycles), xmin = Math.min(...xs) * 0.7, xmax = Math.max(...xs) * 1.4;
  const acc = (r: BenchRow) => accuracyUnder(r, c);
  const ymin = Math.min(0, ...rows.map(acc)) - 0.05, ymax = Math.max(0.85, ...rows.map(acc)) + 0.05;
  const X = (v: number) => L + (Math.log(v / xmin) / Math.log(xmax / xmin)) * (W - L - R), Y = (v: number) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);
  const front = [...paretoFront(rows, acc, (r) => r.serialCycles)].sort((a, b) => a.serialCycles - b.serialCycles);
  const ok = (r: BenchRow) => r.serialCycles <= c.maxCycles && r.memoryBytes <= c.maxBytes && r.lagMs <= c.maxLagMs;
  return (
    <svg className="lab-pareto" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accuracy against computing cost for each decoder, with the best trade-offs joined by a line" data-testid="pareto">
      <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="rgba(4,7,14,.55)" rx="8" />
      {c.maxCycles < xmax && <rect x={X(Math.max(xmin, c.maxCycles))} y={T} width={Math.max(0, W - R - X(Math.max(xmin, c.maxCycles)))} height={H - T - B} fill="rgba(255,138,138,.08)" />}
      {c.maxCycles < xmax && c.maxCycles > xmin && <><line x1={X(c.maxCycles)} y1={T} x2={X(c.maxCycles)} y2={H - B} stroke="#FF8A8A" strokeDasharray="4 3" /><text x={X(c.maxCycles) + 4} y={T + 12} fill="#FF9C9C" fontSize="10.5">over budget</text></>}
      {[0, 0.25, 0.5, 0.75].filter((v) => v > ymin && v < ymax).map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="rgba(150,185,245,.12)" /><text x={L - 6} y={Y(v) + 3} textAnchor="end" fill="#8FA0BF" fontSize="10.5" fontFamily="ui-monospace, Menlo, monospace">{v.toFixed(2)}</text></g>)}
      {[10, 20, 50, 100, 200, 400].filter((v) => v > xmin && v < xmax).map((v) => <g key={v}><line x1={X(v)} x2={X(v)} y1={T} y2={H - B} stroke="rgba(150,185,245,.08)" /><text x={X(v)} y={H - B + 14} textAnchor="middle" fill="#8FA0BF" fontSize="10.5" fontFamily="ui-monospace, Menlo, monospace">{v}</text></g>)}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill="#A9B6CF" fontSize="11.5">clock cycles per decoded bin on a serial engine (log scale) →</text>
      <text x={14} y={(T + H - B) / 2} textAnchor="middle" fill="#A9B6CF" fontSize="11.5" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>held-out R² →</text>
      <polyline points={front.map((r) => `${X(r.serialCycles)},${Y(acc(r))}`).join(' ')} fill="none" stroke="rgba(232,238,249,.55)" strokeWidth="1.4" strokeDasharray="5 3" />
      {rows.map((r) => (
        <g key={r.id} opacity={ok(r) ? 1 : 0.35} data-testid={`pareto-${r.id}`} data-feasible={ok(r)}>
          {pick?.id === r.id && <circle cx={X(r.serialCycles)} cy={Y(acc(r))} r="13" fill="none" stroke="#F5F8FF" strokeWidth="1.6" />}
          <circle cx={X(r.serialCycles)} cy={Y(acc(r))} r={5 + Math.sqrt(r.memoryBytes) / 5} fill={COLORS[r.id] ?? '#fff'} fillOpacity="0.85" />
          {X(r.serialCycles) > W * 0.72
            ? <text x={X(r.serialCycles) - 12 - Math.sqrt(r.memoryBytes) / 5} y={Y(acc(r)) + 4} textAnchor="end" fill="#E8EEF9" fontSize="11.5">{r.name}</text>
            : <text x={X(r.serialCycles) + 12 + Math.sqrt(r.memoryBytes) / 5} y={Y(acc(r)) + 4} fill="#E8EEF9" fontSize="11.5">{r.name}</text>}
        </g>
      ))}
    </svg>
  );
}

function Lines({ rows, series, xLabel, xs, testId }: { rows: BenchRow[]; series: (r: BenchRow) => number[]; xLabel: string; xs: number[]; testId: string }) {
  const W = 250, H = 150, L = 34, R = 8, T = 8, B = 30;
  const all = rows.flatMap(series), ymin = Math.min(0, ...all) - 0.05, ymax = Math.max(0.8, ...all) + 0.05;
  const X = (i: number) => L + (i / Math.max(1, xs.length - 1)) * (W - L - R), Y = (v: number) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);
  return (
    <svg className="lab-lines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Held-out R² of each decoder against ${xLabel}`} data-testid={testId}>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="rgba(4,7,14,.55)" rx="6" />
      <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="rgba(150,185,245,.3)" />
      {[0, 0.5].map((v) => <text key={v} x={L - 5} y={Y(v) + 3} textAnchor="end" fill="#8FA0BF" fontSize="10" fontFamily="ui-monospace, Menlo, monospace">{v}</text>)}
      {xs.map((x, i) => <text key={x} x={X(i)} y={H - B + 13} textAnchor="middle" fill="#8FA0BF" fontSize="10" fontFamily="ui-monospace, Menlo, monospace">{x}</text>)}
      <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle" fill="#A9B6CF" fontSize="10.5">{xLabel}</text>
      {rows.map((r) => <polyline key={r.id} points={series(r).map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke={COLORS[r.id] ?? '#fff'} strokeWidth="1.6" />)}
    </svg>
  );
}

export function DecoderLab() {
  const bench = useExperiment((s) => s.bench), status = useExperiment((s) => s.benchStatus), progress = useExperiment((s) => s.benchProgress), runBench = useExperiment((s) => s.runBench);
  const go = useShell((s) => s.go);
  const [c, setC] = useState<Constraints>({ noiseUv: 7, lost: 0, maxCycles: 400, maxBytes: 1000, maxLagMs: 400 });
  useEffect(() => { if (status === 'idle') runBench(); }, [status, runBench]);
  const choice = useMemo(() => (bench ? preferred(bench.rows, c) : null), [bench, c]);

  if (!bench) {
    return (
      <div className="exp-empty" role="status" data-testid="lab-loading">
        {status === 'error' ? <><h2>The comparison failed</h2><button type="button" className="btn" onClick={runBench}>Try again</button></> : (
          <><span className="loading-ring" aria-hidden="true" /><p>Fitting five decoders and scoring them on held-out runs…</p>
            {progress && <p className="mono exp-fine" data-testid="lab-progress">{progress.done} / {progress.total} · {progress.what}</p>}</>
        )}
      </div>
    );
  }
  const rows = bench.rows, pick = choice!.row;
  const best = (fn: (r: BenchRow) => number) => rows.reduce((a, r) => (fn(r) > fn(a) ? r : a), rows[0]);
  return (
    <div className="lab" data-testid="decoder-lab">
      <section className="lab-intro">
        <p><strong>There is no best decoder in general.</strong> There is a best one for a task, a body of data and a budget. Five decoders were fitted on the same {(bench.trainBins * bench.binMs / 1000).toFixed(0)} s of calibration from the motor experiment and scored on runs they never saw. Change a constraint and watch the preferred one change.</p>
        <p className="lab-caveat" data-testid="lab-caveat"><Prov kind="simulated" /> Every number on this page comes from <strong>synthetic teaching data</strong> — eight channels of a simple model, seconds of calibration. It shows how these decoders trade accuracy for cost <em>on that model</em>. It does not establish which architecture is best for a real human BCI.</p>
      </section>

      <div className="lab-grid">
        <section className="lab-card">
          <h2>Accuracy against cost <Prov kind="simulated" /></h2>
          <Pareto rows={rows} c={c} pick={pick} />
          <p className="exp-fine">Dot size: memory. Dashed line: the decoders no other decoder beats on both axes (the Pareto frontier) under the recording condition chosen on the right. The ring marks the one to prefer within your budgets.</p>
        </section>

        <section className="lab-card" data-testid="lab-constraints">
          <h2>Your constraints</h2>
          <Choice label="Recording noise at test time (calibrated at 7 µV)" value={c.noiseUv} options={BENCH_NOISE_UV.map((n) => ({ value: n as number, label: `${n} µV` }))} onChange={(v) => setC({ ...c, noiseUv: v })} testId="lab-noise" />
          <Choice label="Channels that have stopped working" value={c.lost} options={BENCH_LOST.map((n) => ({ value: n as number, label: String(n) }))} onChange={(v) => setC({ ...c, lost: v })} testId="lab-lost" />
          <Slider label="Compute budget per decoded bin" value={c.maxCycles} min={15} max={400} step={1} unit="cycles" log onChange={(v) => setC({ ...c, maxCycles: Math.round(v) })} testId="lab-cycles" />
          <Slider label="Memory budget" value={c.maxBytes} min={50} max={1000} step={10} unit="bytes" log onChange={(v) => setC({ ...c, maxBytes: Math.round(v) })} testId="lab-bytes" />
          <Slider label="Longest acceptable output lag" value={c.maxLagMs} min={50} max={400} step={50} unit="ms" onChange={(v) => setC({ ...c, maxLagMs: v })} testId="lab-lag" />
          <div className="lab-verdict" data-testid="lab-verdict" data-pick={pick?.id ?? 'none'}>
            {pick ? (
              <><div className="exp-sub">Prefer, under these constraints</div><strong style={{ color: COLORS[pick.id] }}>{pick.name}</strong>
                <p>Held-out R² {f2(accuracyUnder(pick, c))} for {pick.serialCycles} cycles, {pick.memoryBytes} bytes and {pick.lagMs} ms of lag.{' '}
                  {choice!.why.size > 0 ? <>Ruled out: {[...choice!.why].map(([id, w]) => `${rows.find((r) => r.id === id)!.name} (${w})`).join('; ')}.</> : <>Nothing is ruled out by a budget, so the most accurate wins.</>}</p></>
            ) : <><div className="exp-sub">Nothing fits</div><p>No decoder meets every budget. Relax one.</p></>}
          </div>
        </section>
      </div>

      <section className="lab-card">
        <h2>The measurements <Prov kind="simulated" /> <Prov kind="inferred" note="cycles and bytes are estimates" /></h2>
        <div className="lab-scroll">
          <table className="exp-table" data-testid="lab-table">
            <thead><tr><th>Decoder</th><th>Family</th><th>Held-out R²</th><th>R² in your condition</th><th>Lag</th><th>Multiply–adds</th><th>Cycles / bin</th><th>Memory</th><th>Closed loop: targets</th><th>Time to target</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={pick?.id === r.id ? 'is-now' : undefined} data-testid={`lab-row-${r.id}`}>
                <td><i className="lab-dot" style={{ background: COLORS[r.id] }} />{r.name}</td><td>{r.family === 'mlp' ? 'network' : r.family}</td>
                <td className="mono">{f2(r.heldOut.r2)}</td><td className="mono" data-testid={`lab-acc-${r.id}`}>{f2(accuracyUnder(r, c))}</td><td className="mono">{r.lagMs} ms</td>
                <td className="mono">{r.cost.macs}{r.cost.nonlin ? ` + ${r.cost.nonlin} tanh` : ''}</td><td className="mono">{r.serialCycles}</td><td className="mono">{r.memoryBytes} B</td>
                <td className="mono">{r.closed.hits} / {r.closed.trials}</td><td className="mono">{r.closed.meanTimeS ? `${r.closed.meanTimeS.toFixed(2)} s` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="exp-fine">Held-out R²: decoded against intended velocity over {bench.heldOutBins} bins of a run with a different random seed, recorded as calibrated. “Cycles” assumes one multiply–accumulate per clock cycle, one per tanh, two of overhead; “memory” is parameters plus state at 16 bits each. Fitting seed {bench.fitSeed}; the whole table recomputes to the same numbers.</p>
      </section>

      <div className="lab-grid three">
        <section className="lab-card"><h3>When the noise changes</h3><Lines rows={rows} series={(r) => r.noise.map((x) => x.r2)} xs={[...BENCH_NOISE_UV]} xLabel="noise at test time, µV rms" testId="lab-noise-lines" /><p className="exp-fine">Decoders were fitted at 7 µV. Even <em>less</em> noise hurts: the detector’s threshold drops, more distant neurons are counted, and the inputs no longer look like the calibration’s.</p></section>
        <section className="lab-card"><h3>When the electrode moves away</h3><Lines rows={rows} series={(r) => r.shift.map((x) => x.r2)} xs={[...BENCH_NEAR_UM]} xLabel="distance to the nearest neuron, µm" testId="lab-shift-lines" /><p className="exp-fine">Spikes shrink, crossings are missed, rates fall below what the decoder learned.</p></section>
        <section className="lab-card"><h3>When channels are lost</h3><Lines rows={rows} series={(r) => r.lost.map((x) => x.r2)} xs={[...BENCH_LOST]} xLabel="channels lost (of 8)" testId="lab-lost-lines" /><p className="exp-fine">Dead channels read zero. Decoders that spread their weight over time or model the movement degrade more slowly here.</p></section>
      </div>

      <div className="lab-grid">
        <section className="lab-card" data-testid="lab-findings">
          <h2>What this synthetic comparison shows</h2>
          <ul>
            <li>As calibrated, <strong>{best((r) => r.heldOut.r2).name}</strong> is the most accurate ({f2(best((r) => r.heldOut.r2).heldOut.r2)}); <strong>{rows.reduce((a, r) => (r.serialCycles < a.serialCycles ? r : a), rows[0]).name}</strong> is the cheapest.</li>
            <li>The largest network is not the most accurate: with {(bench.trainBins * bench.binMs / 1000).toFixed(0)} s of calibration it has more parameters than the data can pin down.</li>
            <li>Which one to prefer flips with the budget and with what goes wrong in the recording — try 30 cycles, or four lost channels.</li>
          </ul>
        </section>
        <section className="lab-card" data-testid="lab-real">
          <h2>What real recordings support <Prov kind="measured" title="Findings reported in the cited papers from recorded neural data. Not reproduced here." note="published, not reproduced here" /></h2>
          <ul>
            <li>A Kalman filter reconstructed hand movement from monkey motor-cortex recordings in real time and reports its own uncertainty. <Cites ids={['wu2006']} /></li>
            <li>A Kalman variant designed around closed-loop use halved target-acquisition time in monkeys. <Cites ids={['gilja2012']} /></li>
            <li>On recorded spiking activity from motor cortex, somatosensory cortex and hippocampus, modern networks and ensembles significantly outperformed Wiener and Kalman filters. <Cites ids={['glaser2020']} /></li>
          </ul>
          <p className="exp-fine">That last result is the opposite of what the small synthetic task above shows for its largest network — which is the point: the ranking belongs to the data. A benchmark on a public electrophysiology dataset with proper held-out evaluation is not part of this build.</p>
        </section>
      </div>

      <section className="lab-card">
        <h2>Where the Hamiltonian chip sits</h2>
        <p>The linear decoder here is 8 inputs → 2 outputs: 16 multiply–accumulates. That is the size of the decoder in the Hamiltonian digital design, which computes its 16 in 18 clock cycles in RTL simulation on recorded ECoG features. The chip has not been run on this task and is not fabricated; cycle counts for the other decoders are extrapolated from that one engine.</p>
        <button type="button" className="btn" onClick={() => go('decoder')} data-testid="lab-to-decoder">See the chip’s decoder, cycle by cycle →</button>
        <p className="exp-fine">Adding a decoder — convolutional, recurrent, spiking — means writing one <span className="mono">DecoderSpec</span> in <span className="mono">src/experiment/model/decoders.ts</span>; the table, the chart and these sensitivity runs pick it up.</p>
      </section>
    </div>
  );
}
