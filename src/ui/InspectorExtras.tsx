// RTL-backed extras shown at the bottom of the inspector: verification, synthesis, quick links.
import { useArtifacts } from '../artifacts/load';
import { COMPONENTS } from '../model/components';
import { useScene } from '../state/sceneStore';
import { useHw } from '../state/hwStore';
import { EvidenceBadge } from './EvidenceBadge';

const CATEGORY_FOR: Record<string, RegExp> = {
  'rtl.ai': /ai_decoder|ai_|formal|integrated_top/i,
  'rtl.ai_quant': /ai_decoder|ai_model/i,
  'rtl.ai_collect': /ai_decoder|ai_protocol|ai_stress|formal/i,
  'rtl.ai_model': /ai_decoder|ai_model|formal/i,
  'rtl.ai_engine': /ai_decoder|ai_model|gate_level/i,
  'rtl.ai_fifo': /ai_decoder|ai_stress|ai_protocol/i,
  'rtl.top04': /integrated_top|top_|scenario_trace|chip/i,
  'rtl.regs': /integrated_top|top_/i,
  'rtl.u_bist': /top_bist|integrated_top/i,
  'rtl.u_state': /channel|reset|invalid/i,
  'rtl.u_baseline': /signed|baseline|arith/i,
  'rtl.u_threshold': /threshold|boundary|hyster/i,
  'rtl.u_refractory': /refractory|hyster/i,
  'rtl.u_timestamp': /timestamp/i,
  'rtl.u_packer': /backpressure|back-pressure|event/i,
};

export function InspectorExtras({ id }: { id: string }) {
  const c = COMPONENTS[id];
  const verification = useArtifacts((a) => a.verification);
  const synth = useArtifacts((a) => a.synth);
  const skyV04 = useArtifacts((a) => a.sky130V04);
  const layoutV04 = useArtifacts((a) => a.layoutV04);
  const manifest = useArtifacts((a) => a.manifest);
  const setLevel = useScene((s) => s.setLevel);
  const select = useScene((s) => s.select);
  const setGatesModule = useHw((s) => s.setGatesModule);
  if (!c) return null;

  const isRtl = id.startsWith('rtl.') || id === 'sys.hbci01' || id === 'pkg.die';
  if (!isRtl) {
    return (
      <div className="ix ix-concept" style={boxStyle('var(--ev-concept)')}>
        <EvidenceBadge e="CONCEPT" /> <span className="muted">No hardware, simulation or measurement backs this part yet.</span>
      </div>
    );
  }

  const mod = c.rtlModule ?? 'hbci_event_core';
  const st = synth?.modules.find((m) => m.module === mod);
  const suites = verification?.suites ?? [];
  const cat = CATEGORY_FOR[id];
  const tests = suites.flatMap((s) => s.tests.map((t) => ({ ...t, suite: s.name }))).filter((t) => !cat || cat.test(t.category) || cat.test(t.name) || cat.test(t.suite));
  const passed = tests.filter((t) => t.status === 'pass').length;
  const v04 = id === 'sys.hbci01' || id === 'pkg.die' || id === 'rtl.top04' || id === 'rtl.regs' || id === 'rtl.u_bist' || id.startsWith('rtl.ai');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }} data-testid="inspector-extras">
      <div style={boxStyle('var(--ev-rtl)')}>
        <div style={rowStyle}><EvidenceBadge e="RTL" /> <b>Verification</b></div>
        {verification ? (
          <>
            {suites.map((s) => (
              <div key={s.name} className="mono" style={{ fontSize: 11 }}>
                <span style={{ color: s.status === 'pass' ? 'var(--green)' : 'var(--red)' }}>{s.status.toUpperCase()}</span> {s.name} · {s.checks} checks · {s.errors} errors
              </div>
            ))}
            {cat && <div className="muted" style={{ fontSize: 11 }}>{passed}/{tests.length} tests related to this block pass</div>}
            <div className="faint" style={{ fontSize: 10 }}>{verification.simulator} · {verification.ran_at}</div>
          </>
        ) : <div className="faint" style={{ fontSize: 11 }}>verification.json not generated yet (run <code>make artifacts</code>)</div>}
      </div>
      <div style={boxStyle('var(--ev-synth)')}>
        <div style={rowStyle}><EvidenceBadge e="SYNTH" /> <b>Synthesis</b></div>
        {st ? (
          <div className="mono" style={{ fontSize: 11 }}>{mod}: {st.cells} generic cells · {st.flops} flip-flops</div>
        ) : <div className="faint" style={{ fontSize: 11 }}>synth_stats.json not generated yet</div>}
        {v04 && skyV04 && <div className="mono" style={{ fontSize: 11 }}>hbci02_digital_top on {skyV04.library}: {skyV04.cells.toLocaleString()} cells · {skyV04.flops.toLocaleString()} flip-flops · {Math.round(skyV04.cell_area_um2).toLocaleString()} µm² cell area{id.startsWith('rtl.ai') ? ' (decoder alone: 10,707 cells, 2,387 FF, 114,351 µm²; docs/ARCHITECTURE.md)' : ''}</div>}
        <div className="faint" style={{ fontSize: 10 }}>{v04 ? (layoutV04 ? `Generic gates plus the SKY130 HD cell mapping (cell area only). Die size, timing and power of the v0.4 chip top are on the Physical layout level (hbci02_chip_top: ${layoutV04.die.width_um.toFixed(0)} × ${layoutV04.die.height_um.toFixed(0)} µm, ${layoutV04.constraints.clock_mhz.toFixed(0)} MHz).` : 'Generic gates plus the SKY130 HD cell mapping (cell area only). No layout for v0.4 yet: no timing, power or die size.') : 'Generic gates only. No timing, power or area claims.'}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => { select(id === 'sys.hbci01' || id === 'pkg.die' ? 'rtl.core' : id); setLevel('circuit'); }}>Circuit view</button>
        <button className="btn sm" onClick={() => { setGatesModule(mod); setLevel('gates'); }}>Gate netlist</button>
        <button className="btn sm" onClick={() => setLevel('die')}>On die</button>
      </div>
      {manifest && <div className="faint" style={{ fontSize: 10 }}>Artifacts from RTL commit {manifest.git_rev}, generated {manifest.generated_at}</div>}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 };
function boxStyle(color: string): React.CSSProperties {
  return { border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 7%, var(--surface-panel))`, borderRadius: 8, padding: '8px 10px', fontSize: 'var(--fs-small)' };
}
