// Level 1 / 2 — module microscope: one RTL block, its real ports and neighbours, a simplified internal dataflow
// (each operator linked to its Verilog lines) and one real sample followed step by step. Next steps: the block's
// synthesised gates (Level 3) and a genuine standard cell (Level 4).
import { useEffect, useState } from 'react';
import { useScene } from '../../state/sceneStore';
import { useHw } from '../../state/hwStore';
import { COMPONENTS } from '../../model/components';
import { EvidenceBadge } from '../../ui/EvidenceBadge';
import { KindBadge } from '../../ui/KindBadge';
import { SourceView } from '../../circuit/SourceView';
import { BLOCK_NAMES } from '../names';
import { useMicro } from '../microStore';
import { SignalInspector } from '../SignalInspector';
import { SPECS, instOf, specKeyFor } from './moduleSpecs';
import { Dataflow } from './Dataflow';
import { Compute } from './Compute';
import './module.css';

const PICK = ['rtl.u_biquad', 'rtl.u_fstate', 'rtl.u_energy', 'rtl.u_records', 'rtl.u_ts', 'rtl.raw_path', 'rtl.u_state', 'rtl.u_baseline', 'rtl.u_threshold', 'rtl.u_refractory', 'rtl.u_timestamp', 'rtl.u_packer'];

function Picker() {
  const select = useScene((s) => s.select);
  return (
    <div className="mv-pick" data-testid="module-picker">
      <p>Pick a block to look inside. A good first stop is the <b>digital band-pass filter</b>: five multiplications and a sum.</p>
      <div className="mv-pick-grid">
        {PICK.map((id) => {
          const n = BLOCK_NAMES[id];
          return (
            <button key={id} className="mv-pick-btn" onClick={() => select(id)}>
              <b>{n?.friendly ?? COMPONENTS[id]?.name}</b>
              <code>{n?.inst}{n?.module && n.module !== n.inst ? ` · ${n.module}` : ''}</code>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ModuleView() {
  const selectedId = useScene((s) => s.selectedId);
  const setViewEvidence = useScene((s) => s.setViewEvidence);
  const expert = useScene((s) => s.uiMode === 'inspect');
  const tab = useMicro((m) => m.moduleTab);
  const setTab = useMicro((m) => m.setModuleTab);
  const sig = useMicro((m) => m.signal);
  const setComputeStep = useMicro((m) => m.setComputeStep);
  const setGatesModule = useHw((s) => s.setGatesModule);
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const id = selectedId && specKeyFor(selectedId) ? selectedId : null;
  const key = id ? specKeyFor(id)! : null;
  const spec = key ? SPECS[key] : null;
  const where = id ? instOf(id) : null;

  useEffect(() => setViewEvidence('RTL'), [setViewEvidence]);
  useEffect(() => { setActiveOp(null); setComputeStep(0); }, [id, setComputeStep]);

  if (!id || !spec || !where) {
    return <div className="mv" data-testid="module-view"><Picker /></div>;
  }
  const c = COMPONENTS[id];
  const n = BLOCK_NAMES[id];
  const op = spec.ops.find((o) => o.id === activeOp) ?? null;
  const hl = op ? new Set(Array.from({ length: op.lines[1] - op.lines[0] + 1 }, (_, k) => op.lines[0] + k)) : undefined;
  const srcModule = spec.module;
  const gatesModule = key === '$raw' ? 'hbci_readout_core' : spec.module;
  const lit = n ? (n.module && n.module !== n.inst ? `${n.inst} · ${n.module}` : n.inst) : c.rtlInstance ?? '';

  return (
    <div className="mv" data-testid="module-view" data-module={spec.module}>
      <header className="mv-head">
        <div className="mv-title">
          <h2>{expert ? lit : n?.friendly ?? c.name}</h2>
          <code className={expert ? 'mv-sub' : 'mv-lit'}>{expert ? n?.friendly : lit}</code>
        </div>
        <div className="mv-badges">
          <KindBadge c={c} />
          <EvidenceBadge e="RTL" />
          {where.scope === 'event' && <span className="mv-tag">inside the legacy event core (u_event)</span>}
        </div>
        <p className="mv-one">{n?.oneLine ?? c.purpose}</p>
        <div className="mv-tabs seg" role="tablist" aria-label="Module view">
          <button role="tab" aria-selected={tab === 'dataflow'} className={`seg-btn${tab === 'dataflow' ? ' on' : ''}`} onClick={() => setTab('dataflow')} data-testid="tab-dataflow">What goes in and out</button>
          <button role="tab" aria-selected={tab === 'compute'} className={`seg-btn${tab === 'compute' ? ' on' : ''}`} onClick={() => setTab('compute')} data-testid="tab-compute">One sample, step by step</button>
        </div>
        <div className="mv-actions">
          <button className="btn sm" onClick={() => useScene.getState().setLevel('die')} title="Back to the logical block map">◀ Die map</button>
          <button className="btn sm primary" onClick={() => { setGatesModule(gatesModule); useScene.getState().setLevel('gates'); }} data-testid="btn-to-gates">Its gates ▶</button>
        </div>
      </header>
      <div className="mv-main">
        <div className="mv-left">
          {tab === 'dataflow' ? (
            <>
              <Dataflow spec={spec} inst={where.inst} scope={where.scope} activeOp={activeOp} onOp={setActiveOp} />
              <p className="mv-hint">Click a port to inspect its signal · click an operator to see its Verilog. Values above the ports are at the sample cursor (v0.3 trace).</p>
            </>
          ) : (
            <Compute spec={spec} inst={where.inst} />
          )}
        </div>
        <aside className="mv-right">
          {sig ? (
            <SignalInspector docked="module" />
          ) : (
            <div className="mv-detail">
              {op ? (
                <>
                  <div className="mv-k">{op.kind === 'store' ? 'Stored (flip-flops)' : 'Computed (combinational)'}</div>
                  <h3>{op.label}</h3>
                  <p>{op.explain}</p>
                  <p className="mv-lines">{spec.file}, lines {op.lines[0]}–{op.lines[1]}</p>
                </>
              ) : (
                <>
                  <div className="mv-k">Simplified drawing</div>
                  <p>Each box groups many gates into one operation. Square boxes store a value until the next clock edge; rounded boxes compute it within the same clock cycle. Click one to see the exact Verilog it stands for.</p>
                </>
              )}
              <SourceView module={srcModule} highlightLines={hl} maxHeight={360} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
