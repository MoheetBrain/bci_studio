// E01: offline representation test on public human ECoG (experiments/E01_ecog_vowel). Shows exactly what was
// measured, how, and its limits. Not hardware evidence: no HBCI-02 device recorded anything.
import { useEffect, useState } from 'react';
import { fetchText } from '../artifacts/load';

interface Score { balanced_accuracy_mean: number; balanced_accuracy_sd: number; null_mean: number; null_95pct: number; p_permutation: number; chance: number; n_trials: number; n_features: number }
interface E01 {
  experiment: string; generated_at: string;
  dataset: { dandiset: string; session: string; license: string; description: string; fs_hz: number; duration_s: number; channels_used: number; channel_selection: string; units_note: string; trials_total: number; excluded: Record<string, number> };
  quantisation: { bits: number; scale_rule: string; clipped_fraction: number };
  chip_config: Record<string, unknown>;
  analysis: Record<string, unknown>;
  results: Record<string, Record<string, Score | Record<string, number>>>;
  payload_bps: Record<string, number>;
  limitations: string[];
}

const MODES = ['RAW', 'FEATURE', 'EVENT', 'HYBRID'];
const TASKS: Record<string, string> = { A_vowel: 'A · vowel identity (/a/ /i/ /u/)', B_speech_vs_silence: 'B · speech vs inter-trial silence' };
const fmt = (bps: number) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbit/s` : `${(bps / 1e3).toFixed(1)} kbit/s`);

export function ExperimentPanel() {
  const [e, setE] = useState<E01 | null | 'missing'>(null);
  useEffect(() => {
    void fetchText('experiments/E01_results.json').then((t) => {
      try { setE(t ? (JSON.parse(t) as E01) : 'missing'); } catch { setE('missing'); }
    });
  }, []);
  if (e === null) return <div className="payload faint">Loading…</div>;
  if (e === 'missing') return <div className="payload"><div className="missing">E01 results not generated yet (experiments/E01_ecog_vowel/run_e01.py).</div></div>;
  return (
    <div className="payload" data-testid="experiment-panel">
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b>E01 · representation test on public human ECoG</b>
        <span className="evidence" style={{ color: 'var(--text-dim)' }} title="Offline analysis of a published recording using chip-equivalent models. No HBCI-02 hardware recorded this data.">OFFLINE ANALYSIS · not hardware</span>
        <span className="faint mono">DANDI:{e.dataset.dandiset} · {e.dataset.session} · {e.dataset.license} · {e.dataset.channels_used} ch @ {e.dataset.fs_hz.toFixed(1)} Hz · {e.dataset.duration_s} s</span>
      </div>
      <div className="faint" style={{ fontSize: 11 }}>{e.dataset.description}. Channels: {e.dataset.channel_selection}.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {Object.keys(TASKS).map((task) => {
          const r = e.results[task];
          if (!r) return null;
          return (
            <div key={task} className="repr-card">
              <div className="cd-k">{TASKS[task]}</div>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr className="faint"><th align="left">representation</th><th align="right">balanced acc.</th><th align="right">null 95%</th><th align="right">p (perm.)</th><th align="right">features</th></tr></thead>
                <tbody>
                  {MODES.map((m) => {
                    const s = r[m] as Score | undefined;
                    if (!s) return null;
                    const sig = s.balanced_accuracy_mean > s.null_95pct;
                    return (
                      <tr key={m}>
                        <td><b>{m}</b></td>
                        <td align="right" className="mono" style={{ color: sig ? 'var(--green)' : 'var(--text-dim)' }}>{(s.balanced_accuracy_mean * 100).toFixed(1)}% ± {(s.balanced_accuracy_sd * 100).toFixed(1)}</td>
                        <td align="right" className="mono faint">{(s.null_95pct * 100).toFixed(1)}%</td>
                        <td align="right" className="mono">{s.p_permutation.toFixed(3)}</td>
                        <td align="right" className="mono faint">{s.n_features}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="faint" style={{ fontSize: 10 }}>chance {((r.RAW as Score).chance * 100).toFixed(0)}% · n = {(r.RAW as Score).n_trials} epochs · green = above the 95th percentile of the label-permutation null</div>
            </div>
          );
        })}
      </div>
      <div className="repr-card">
        <div className="cd-k">Payload for these {e.dataset.channels_used} channels (89-bit records)</div>
        <div className="mono" style={{ fontSize: 11, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {Object.entries(e.payload_bps).map(([k, v]) => <span key={k}>{k.replace('_bps', '')}: {fmt(v)}</span>)}
        </div>
      </div>
      <div className="repr-card" style={{ fontSize: 11 }}>
        <div className="cd-k">Checks and limitations</div>
        <div className="warn-box" style={{ fontSize: 11, marginBottom: 4 }}>{e.dataset.units_note}</div>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {e.limitations.map((l) => <li key={l}>{l}</li>)}
          <li>excluded epochs: {Object.entries(e.dataset.excluded).map(([k, v]) => `${k} ${v}`).join(', ')}; quantised to {e.quantisation.bits}-bit codes ({e.quantisation.scale_rule}); clipped fraction {e.quantisation.clipped_fraction.toExponential(1)}</li>
        </ul>
      </div>
    </div>
  );
}
