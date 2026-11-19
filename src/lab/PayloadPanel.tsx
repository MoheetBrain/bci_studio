// Payload consequences of channel count, sample rate, sample width and mode. Payload arithmetic only:
// not a promise about chip scale, radio performance or biological information.
import { useState } from 'react';
import { BISC, RECORD_BITS, TEACHING, payload } from '../model/system';
import { useScene } from '../state/sceneStore';
import type { ProcMode } from '../model/types';
import { useV03 } from './v03Store';

const fmt = (bps: number) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(3)} Mbit/s` : bps >= 1e3 ? `${(bps / 1e3).toFixed(1)} kbit/s` : `${bps.toFixed(0)} bit/s`);

export function PayloadPanel() {
  const procMode = useScene((s) => s.procMode);
  const setProcMode = useScene((s) => s.setProcMode);
  const demo = useV03((s) => s.demo);
  const [channels, setChannels] = useState(TEACHING.num_channels);
  const [rateHz, setRate] = useState(TEACHING.sample_rate_hz);
  const [sampleBits, setBits] = useState(TEACHING.sample_bits);
  const [winLog2, setWin] = useState(5);
  // event rate measured from the DEMO run (events per channel per second), not assumed
  const durS = demo.T / TEACHING.sample_rate_hz;
  const evPerChS = demo.records.EVENT.length / Math.max(1, TEACHING.num_channels) / durS;
  const [evRate, setEvRate] = useState(Math.round(evPerChS * 10) / 10);
  const p = payload({ channels, rateHz, sampleBits, winSamples: 1 << winLog2, eventRateHz: evRate * channels });
  const rows: { m: ProcMode | 'samples'; bps: number; note: string }[] = [
    { m: 'samples', bps: p.sampleOnly, note: 'channels × rate × bits: the sample values alone, no framing' },
    { m: 'RAW', bps: p.RAW, note: `one ${RECORD_BITS}-bit record per sample (type, channel, flags, seq, timestamp, data)` },
    { m: 'EVENT', bps: p.EVENT, note: `${evRate} events/ch/s (from the DEMO run) × ${RECORD_BITS} b` },
    { m: 'FEATURE', bps: p.FEATURE, note: `one record per channel per ${1 << winLog2}-sample window` },
    { m: 'HYBRID', bps: p.HYBRID, note: 'RAW + FEATURE: more than RAW alone' },
  ];
  const max = Math.max(...rows.map((r) => r.bps));
  return (
    <div className="payload" data-testid="payload-panel">
      <div className="payload-controls">
        <label>channels <input type="range" min={1} max={1024} value={channels} onChange={(e) => setChannels(+e.target.value)} /><span className="val">{channels}</span></label>
        <label>rate <input type="range" min={250} max={30000} step={250} value={rateHz} onChange={(e) => setRate(+e.target.value)} /><span className="val">{rateHz} S/s</span></label>
        <label>bits <input type="range" min={8} max={24} value={sampleBits} onChange={(e) => setBits(+e.target.value)} /><span className="val">{sampleBits}</span></label>
        <label>window <input type="range" min={0} max={10} value={winLog2} onChange={(e) => setWin(+e.target.value)} /><span className="val">{1 << winLog2}</span></label>
        <label>events/ch/s <input type="number" min={0} step={0.5} value={evRate} onChange={(e) => setEvRate(Math.max(0, +e.target.value))} style={{ width: 56 }} /></label>
        <button className="btn sm" onClick={() => { setChannels(8); setRate(2000); setBits(16); }}>8 ch · 2 kS/s · 16 b</button>
        <button className="btn sm" onClick={() => { setChannels(1024); setRate(2000); setBits(16); }}>1,024 ch · 2 kS/s</button>
      </div>
      <div className="payload-bars">
        {rows.map((r) => (
          <div key={r.m} className={`pbar${r.m === procMode ? ' on' : ''}`} onClick={() => r.m !== 'samples' && setProcMode(r.m)} role={r.m !== 'samples' ? 'button' : undefined}>
            <div className="pbar-k">{r.m === 'samples' ? 'sample values' : r.m}</div>
            <div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.max(0.5, (r.bps / max) * 100)}%` }} /></div>
            <div className="pbar-v mono">{fmt(r.bps)}</div>
            <div className="pbar-n faint">{r.note}</div>
          </div>
        ))}
      </div>
      <div className="faint payload-foot">
        Payload arithmetic only. It is not a promise about chip scale, radio throughput, power or biological information.
        8 × 2,000 × 16 = 256,000 bit/s; 1,024 × 2,000 × 16 = 32.768 Mbit/s (sample values only).
        Scale reference: BISC 2025 has {BISC.electrode_sites.toLocaleString()} electrode sites and {BISC.simultaneous_recording_channels.toLocaleString()} simultaneous recording channels. HBCI-02 implements {TEACHING.num_channels} processing channels.
      </div>
    </div>
  );
}
