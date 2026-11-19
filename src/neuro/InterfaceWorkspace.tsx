// Neural interface: from the selected cortical region down to neurons and one electrode contact.
// Separate panels per scale, with the scale jump stated between them — the cellular drawing is a schematic and was
// never "resolved" from the MRI atlas. The traces come from the same deterministic model as the signal journey.
import { useMemo } from 'react';
import { useAtlas } from '../atlas/atlasStore';
import { useJourney } from '../journey/journeyStore';
import { Wave } from '../journey/Wave';
import { ANALOG_RATE_HZ, LIMITS, RESTING_MV } from '../journey/model/chain';
import { ClaimList, Cites, EvidenceTag } from '../science/Cite';
import type { Claim } from '../atlas/content/regions';
import { useShell } from '../shell/shellStore';
import '../journey/journey.css';
import './neuro.css';

const UNIT_COLORS = ['#B0532A', '#3B6FB6', '#7A4FB0', '#56616A'];
const ANGLES = [200, 150, 232, 120, 260, 175, 215, 140].map((d) => (d * Math.PI) / 180);

const CLAIMS: Claim[] = [
  { text: 'Neuronal activity gives rise to transmembrane currents that can be measured in the fluid outside the cells. Synaptic currents are the major contributor to that extracellular signal; action potentials and other membrane events add to it.', kind: 'background', sources: ['buzsaki2012'] },
  { text: 'The size of the first, negative phase of the extracellular spike follows the size of the neuron’s intracellular action potential — the electrode sees a small, inverted, sharpened shadow of it, not the membrane potential itself.', kind: 'background', sources: ['henze2000'] },
  { text: 'A recording site does not listen to one neuron. For a tetrode in rat hippocampus, roughly a thousand neurons lie within range and 60–100 should be large enough to tell apart in principle, yet about six are usually isolated.', kind: 'background', sources: ['henze2000'] },
  { text: 'Intracortical arrays intended for brain–computer interfaces record from small populations of neurons rather than single units, with an average signal-to-noise ratio around 6 : 1 reported for one array design.', kind: 'background', sources: ['maynard1997'] },
  { text: 'In this lesson spike size falls as 1 / distance from a reference of 120 µV at 30 µm. That rule and those numbers are a teaching model, not measurements of this (or any) brain.', kind: 'assumption', sources: [] },
  { text: 'The electrode position in the selected region is illustrative. Nothing here is a placement recommendation, and the atlas contains no cellular data.', kind: 'assumption', sources: [] },
];

function ScaleCard(p: { n: number; title: string; scale: string; evidence: React.ReactNode; children: React.ReactNode; jump?: string }) {
  return (
    <>
      {p.jump && <div className="scale-jump" aria-label={`Scale change: ${p.jump}`}><span>{p.jump}</span></div>}
      <section className="card scale-card">
        <header><span className="scale-n">{p.n}</span><h2>{p.title}</h2><span className="scale-size mono">{p.scale}</span></header>
        <div className="scale-ev">{p.evidence}</div>
        {p.children}
      </section>
    </>
  );
}

/** Schematic of the cortical sheet (six layers). Proportions are indicative only. */
function LayersSchematic() {
  const layers = [['I', 0.08], ['II', 0.1], ['III', 0.24], ['IV', 0.1], ['V', 0.2], ['VI', 0.28]] as const;
  let y = 8;
  const H = 150;
  return (
    <svg viewBox="0 0 260 176" className="layers" role="img" aria-label="Schematic cross-section of the cortical sheet with six layers, a few millimetres thick, above white matter. Not to scale and not from this subject.">
      {layers.map(([name, f]) => {
        const h = f * H; const y0 = y; y += h;
        return <g key={name}><rect x="44" y={y0} width="150" height={h} className="layer" /><text x="34" y={y0 + h / 2 + 4} textAnchor="end" className="lbl">{name}</text></g>;
      })}
      <rect x="44" y={8 + H} width="150" height="12" className="wm" /><text x="34" y={8 + H + 10} textAnchor="end" className="lbl">WM</text>
      {/* two pyramidal cells: soma in III and V, apical dendrite to layer I, axon to white matter */}
      {[[92, 60], [146, 108]].map(([x, yy], i) => (
        <g key={i} className="cell">
          <line x1={x} y1={yy} x2={x} y2={14} /><line x1={x} y1={yy + 6} x2={x} y2={8 + H + 6} className="axon" />
          <line x1={x} y1={yy + 3} x2={x - 16} y2={yy + 16} /><line x1={x} y1={yy + 3} x2={x + 16} y2={yy + 16} />
          <polygon points={`${x},${yy - 8} ${x - 7},${yy + 5} ${x + 7},${yy + 5}`} />
        </g>
      ))}
      <line x1="210" y1="8" x2="210" y2={8 + H} className="bar" /><line x1="205" y1="8" x2="215" y2="8" className="bar" /><line x1="205" y1={8 + H} x2="215" y2={8 + H} className="bar" />
      <text x="218" y={8 + H / 2} className="lbl" transform={`rotate(90 218 ${8 + H / 2})`} textAnchor="middle">a few mm</text>
    </svg>
  );
}

export default function InterfaceWorkspace() {
  const go = useShell((s) => s.go);
  const selectedId = useAtlas((s) => s.selectedId);
  const node = useAtlas((s) => (s.selectedId ? s.tree.get(s.selectedId) : undefined));
  const structure = useAtlas((s) => (s.selectedId ? s.structures.get(s.selectedId) : undefined));
  const manifest = useAtlas((s) => s.manifest);
  const members = useAtlas((s) => (s.selectedId ? s.idsOf(s.selectedId) : []));
  const structures = useAtlas((s) => s.structures);
  const r = useJourney((s) => s.result);
  const setUnitDistance = useJourney((s) => s.setUnitDistance);
  const p = r.params, d = r.derived;

  // extent of the selection in this subject (from the atlas bounds)
  const extent = useMemo(() => {
    const ids = structure ? [structure.id] : members;
    if (!ids.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const id of ids) { const s = structures.get(id); if (!s) continue; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.boundsMm[0][k]); hi[k] = Math.max(hi[k], s.boundsMm[1][k]); } }
    return hi.map((v, k) => v - lo[k]);
  }, [structure, members, structures]);
  const brainExtent = useMemo(() => {
    if (!manifest) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const s of manifest.structures) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.boundsMm[0][k]); hi[k] = Math.max(hi[k], s.boundsMm[1][k]); }
    return hi.map((v, k) => v - lo[k]);
  }, [manifest]);
  const isCortex = structure?.tissue === 'cortex';

  // one spike of the nearest neuron, for the membrane-vs-electrode comparison
  const spike = r.truth.find((s) => s.unit === 0);
  const t0 = spike ? Math.max(0, spike.tMs - 2.5) : 0, t1 = spike ? Math.min(p.durationMs, spike.tMs + 5.5) : Math.min(p.durationMs, 8);
  const peak = useMemo(() => {
    if (!spike) return null;
    const i0 = Math.floor((t0 / 1000) * ANALOG_RATE_HZ), i1 = Math.ceil((t1 / 1000) * ANALOG_RATE_HZ);
    let vm = -Infinity;
    for (let i = i0; i <= i1; i++) vm = Math.max(vm, r.analog.vmMv[i]);
    return { vmSwingMv: vm - RESTING_MV, veUv: d.unitAmplitudeUv[0] };
  }, [spike, t0, t1, r, d]);

  // amplitude-vs-distance curve of the model
  const curve = useMemo(() => {
    const W = 300, H = 150, x0 = 38, y0 = 10, w = W - x0 - 10, h = H - y0 - 26, rMax = 220, aMax = Math.max(140, d.unitAmplitudeUv[0] * 1.1);
    const X = (rr: number) => x0 + (rr / rMax) * w, Y = (a: number) => y0 + (1 - Math.min(a, aMax) / aMax) * h;
    let path = '';
    for (let rr = 15; rr <= rMax; rr += 3) path += `${path ? 'L' : 'M'}${X(rr).toFixed(1)},${Y((p.spikeUvAtRef * p.refDistanceUm) / rr).toFixed(1)}`;
    return { W, H, x0, y0, w, h, X, Y, path, rMax, aMax };
  }, [p, d]);
  const detectFloorUv = d.spikePeakRetained > 0 ? d.thresholdInputUv / d.spikePeakRetained : Infinity;
  const noiseUv = Math.hypot(d.inputNoiseUvRms, p.backgroundUvRms);

  return (
    <div className="page neuro" data-testid="interface-workspace">
      <div className="page-inner">
        <header className="jr-header">
          <div>
            <h1>Neural interface</h1>
            <p className="lede">
              {node
                ? <>From the <button type="button" className="btn-link inline" onClick={() => go('brain')} data-testid="iface-region">{node.name}</button> down to neurons and one electrode contact. Each panel is a different scale; the cellular panels are schematics and a computed example, <strong>not</strong> something seen in the MRI atlas.</>
                : <>No brain region is selected. The lesson below is generic; <button type="button" className="btn-link inline" onClick={() => go('brain')}>choose a region in the atlas</button> to anchor it.</>}
            </p>
            {node && !isCortex && structure && <p className="note" role="note" data-testid="iface-not-cortex">“{node.name}” is not a cortical gyrus in this atlas ({structure.tissue.replace('-', ' ')}). The layered-cortex schematic below describes cerebral cortex in general and does not apply to this structure.</p>}
          </div>
        </header>

        <div className="scales">
          <ScaleCard n={1} title="Whole brain" scale={brainExtent ? `≈ ${brainExtent.map((v) => v.toFixed(0)).join(' × ')} mm` : '≈ 15 cm'} evidence={<EvidenceTag kind="measured" />}>
            <p>The atlas you just explored: surfaces segmented from one volunteer’s MRI (1 mm voxels). At this scale you can tell gyri apart, not cells.</p>
            <button type="button" className="btn" onClick={() => go('brain')}>Back to the atlas</button>
          </ScaleCard>
          <ScaleCard n={2} title={node ? node.name : 'A cortical region'} scale={extent ? `≈ ${extent.map((v) => v.toFixed(0)).join(' × ')} mm box` : 'centimetres'} evidence={<EvidenceTag kind="measured" />} jump="× ~3 closer">
            {node
              ? <p>The selected {node.kind === 'group' ? 'group' : 'structure'} as labelled in the atlas. Its bounding box in this subject is given above (R–L × A–P × S–I). {selectedId && /precentral_gyrus$/.test(selectedId) && <>It contains primary motor cortex but is not identical to it.</>}</p>
              : <p className="muted">No region selected.</p>}
          </ScaleCard>
          <ScaleCard n={3} title="Cortical sheet and local circuit" scale="≈ 2–4 mm thick" evidence={<EvidenceTag kind="schematic" />} jump="× ~20 closer">
            <LayersSchematic />
            <p>Cerebral cortex is a folded sheet a few millimetres thick, conventionally described in six layers above the white matter. Pyramidal neurons send dendrites up toward the surface and axons down and out. <Cites ids={['kandel2021']} /></p>
            <p className="muted">General textbook description; drawn, not measured, and not specific to this subject or region.</p>
          </ScaleCard>
          <ScaleCard n={4} title="Neurons and one electrode contact" scale="≈ 0.2 mm across" evidence={<EvidenceTag kind="synthetic" />} jump="× ~15 closer">
            <svg viewBox="-235 -150 290 290" className="tissue" role="img" data-testid="tissue-svg"
              aria-label={`Electrode contact with ${p.units.length} model neurons at ${p.units.map((u) => `${u.distanceUm} micrometres`).join(', ')}. Distances are to scale; cell shapes are schematic.`}>
              <rect x="6" y="-150" width="26" height="290" className="shank" />
              <circle cx="0" cy="0" r="10" className="contact" />
              <text x="38" y="4" className="lbl">contact</text>
              {p.units.map((u, i) => {
                const x = u.distanceUm * Math.cos(ANGLES[i % ANGLES.length]), y = u.distanceUm * Math.sin(ANGLES[i % ANGLES.length]);
                return (
                  <g key={i} style={{ color: UNIT_COLORS[i % UNIT_COLORS.length] }}>
                    <line x1={x} y1={y} x2="0" y2="0" className="dist" />
                    <line x1={x} y1={y} x2={x} y2={y - 46} className="dend" />
                    <polygon points={`${x},${y - 11} ${x - 9},${y + 7} ${x + 9},${y + 7}`} className="soma" />
                    <text x={x - 12} y={y + 22} textAnchor="end" className="lbl">{u.distanceUm} µm · {d.unitAmplitudeUv[i].toFixed(0)} µV</text>
                  </g>
                );
              })}
              <line x1="-225" y1="128" x2="-175" y2="128" className="bar" /><text x="-200" y="122" textAnchor="middle" className="lbl">50 µm</text>
            </svg>
            <label className="prm">
              <span className="prm-label">Nearest neuron</span>
              <input type="range" min={LIMITS.distanceUm[0]} max={200} step={5} value={p.units[0].distanceUm} onChange={(e) => setUnitDistance(0, +e.target.value)} data-testid="iface-distance" aria-label="Distance from the contact to the nearest model neuron, micrometres" />
              <span className="prm-value mono">{p.units[0].distanceUm} µm</span>
            </label>
            <p className="muted">Distances are to scale; cell shapes are schematic. Three model neurons are shown; real tissue has thousands within this view.</p>
          </ScaleCard>
        </div>

        <section className="card" aria-label="Membrane potential versus the electrode signal">
          <h2>Inside the cell vs. at the electrode <EvidenceTag kind="synthetic" /></h2>
          {spike && peak ? (
            <>
              <p className="lede">The same action potential, on the same time axis. Note the units: <strong>millivolts</strong> inside the neuron, <strong>microvolts</strong> at the contact.</p>
              <div className="waves">
                <Wave title="Membrane potential of the nearest neuron" unit="mV" data={r.analog.vmMv} rateHz={ANALOG_RATE_HZ} t0={t0} t1={t1} playheadMs={spike.tMs} color={UNIT_COLORS[0]} yRange={[-80, 40]} note="illustrative template; intracellular" testId="iface-vm" valueDigits={1} height={110} />
                <Wave title="Electrode − reference" unit="µV" data={r.analog.veUv} rateHz={ANALOG_RATE_HZ} t0={t0} t1={t1} playheadMs={spike.tMs} color="#3B6FB6" note="extracellular: this neuron plus its neighbours, the background and the slow field potential" testId="iface-ve" valueDigits={1} height={110} showTimeAxis />
              </div>
              <p className="compare" data-testid="iface-compare">
                Membrane swing ≈ <strong>{peak.vmSwingMv.toFixed(0)} mV</strong>. The same spike at a contact {p.units[0].distanceUm} µm away ≈ <strong>−{peak.veUv.toFixed(0)} µV</strong> in this model — about <strong>{Math.round((peak.vmSwingMv * 1000) / peak.veUv).toLocaleString()}×</strong> smaller, and negative-going.
              </p>
            </>
          ) : <p className="muted">The nearest model neuron does not fire in this window, so there is no spike to compare.</p>}
        </section>

        <div className="neuro-grid">
          <section className="card" aria-label="Spike size versus distance in the model">
            <h2>How far can the contact “hear”? <EvidenceTag kind="synthetic" /></h2>
            <svg viewBox={`0 0 ${curve.W} ${curve.H}`} className="curve" role="img" data-testid="iface-curve"
              aria-label={`Model curve of extracellular spike amplitude against distance: ${p.units.map((u, i) => `${u.distanceUm} micrometres gives ${d.unitAmplitudeUv[i].toFixed(0)} microvolts`).join('; ')}.`}>
              <rect x={curve.x0} y={curve.y0} width={curve.w} height={curve.h} className="frame" />
              {Number.isFinite(detectFloorUv) && detectFloorUv < curve.aMax && <><line x1={curve.x0} x2={curve.x0 + curve.w} y1={curve.Y(detectFloorUv)} y2={curve.Y(detectFloorUv)} className="thr" /><text x={curve.x0 + curve.w - 3} y={curve.Y(detectFloorUv) - 4} textAnchor="end" className="lbl thr-l">detected above {detectFloorUv.toFixed(0)} µV</text></>}
              <line x1={curve.x0} x2={curve.x0 + curve.w} y1={curve.Y(noiseUv)} y2={curve.Y(noiseUv)} className="noise" /><text x={curve.x0 + curve.w - 3} y={curve.Y(noiseUv) - 4} textAnchor="end" className="lbl">noise + background {noiseUv.toFixed(1)} µV RMS</text>
              <path d={curve.path} className="amp" />
              {p.units.map((u, i) => <circle key={i} cx={curve.X(Math.min(u.distanceUm, curve.rMax))} cy={curve.Y(d.unitAmplitudeUv[i])} r="4.5" fill={UNIT_COLORS[i % UNIT_COLORS.length]} />)}
              <text x={curve.x0 - 5} y={curve.y0 + 8} textAnchor="end" className="lbl">{curve.aMax.toFixed(0)}</text><text x={curve.x0 - 5} y={curve.y0 + curve.h} textAnchor="end" className="lbl">0 µV</text>
              {[50, 100, 150, 200].map((rr) => <text key={rr} x={curve.X(rr)} y={curve.H - 8} textAnchor="middle" className="lbl">{rr}{rr === 200 ? ' µm' : ''}</text>)}
            </svg>
            <p className="muted">Curve: amplitude = {p.spikeUvAtRef} µV × {p.refDistanceUm} µm / distance (model assumption). Dots: the three model neurons. A spike is detected only if its filtered peak clears the chip’s threshold.</p>
          </section>
          <section className="card" aria-label="What is established and what is assumed">
            <h2>What is established, what is assumed</h2>
            <ClaimList claims={CLAIMS} />
          </section>
        </div>

        <div className="next">
          <button type="button" className="btn btn-primary" onClick={() => go('signal')} data-testid="to-signal">Follow this electrode signal through the acquisition chain →</button>
          <span className="muted">The same model and the same settings continue in the Signal journey.</span>
        </div>
      </div>
    </div>
  );
}
