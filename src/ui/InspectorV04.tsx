// Inspector sections for the v0.4 blocks: the plain-English explanation of each decoder sub-block, the register
// map and model-loading story (docs/AI_DECODER.md), the block's Verilog lines (rtl_modules.json source), and its
// real ports and netlist connections (rtl_modules.json v04 / v04.ai).
import { useTraceV04 } from '../lab/v04Store';
import { useMemo, useState, type ReactNode } from 'react';
import { useArtifacts } from '../artifacts/load';
import type { ComponentInfo } from '../model/types';
import { AI_SUBBLOCK_BY_ID, LOADING_STORY, REGISTER_MAP } from '../model/aiDecoder';
import { SourceView } from '../circuit/SourceView';
import { buildGraphAi, buildGraphV04, type BlockEdge } from '../circuit/rtlGraph';
import { EvidenceBadge } from './EvidenceBadge';
import { useScene } from '../state/sceneStore';
import { useV03 } from '../lab/v03Store';

function Exp({ title, children, defaultOpen = false, right, testid }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; testid?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`ins-sec ins-exp${open ? ' open' : ''}`} data-testid={testid}>
      <button className="ins-expander" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <svg viewBox="0 0 10 10" width="10" height="10" className={open ? 'open' : ''} aria-hidden><path d="M3 1.5L7 5 3 8.5" /></svg>
        <span>{title}</span>
        {right && <span className="ins-exp-right">{right}</span>}
      </button>
      {open && <div className="ins-exp-body">{children}</div>}
    </section>
  );
}

/** Which netlist instance (and scope) a v0.4 registry id is. */
const INST_OF: Record<string, { scope: 'v04' | 'ai'; inst: string }> = {
  'rtl.top04': { scope: 'v04', inst: '' }, 'rtl.readout': { scope: 'v04', inst: 'u_readout' }, 'rtl.ai': { scope: 'v04', inst: 'u_ai' }, 'rtl.u_bist': { scope: 'v04', inst: 'u_bist' }, 'rtl.regs': { scope: 'v04', inst: '$regs' },
  'rtl.ai_quant': { scope: 'ai', inst: 'u_quant' }, 'rtl.ai_collect': { scope: 'ai', inst: 'u_collect' }, 'rtl.ai_model': { scope: 'ai', inst: 'u_model' }, 'rtl.ai_engine': { scope: 'ai', inst: 'u_engine' }, 'rtl.ai_fifo': { scope: 'ai', inst: '$fifo' },
};

const REG_GROUP_FOR: Record<string, string[]> = {
  'rtl.ai': ['config', 'counters', 'diagnostics', 'predictions', 'model'],
  'rtl.ai_model': ['model'], 'rtl.ai_fifo': ['predictions', 'counters', 'diagnostics'], 'rtl.ai_collect': ['config', 'counters'], 'rtl.ai_engine': ['diagnostics'], 'rtl.ai_quant': ['model'],
  'rtl.regs': ['id', 'config', 'counters', 'diagnostics', 'predictions', 'model', 'bist'], 'rtl.top04': ['id', 'config', 'predictions', 'model', 'bist'], 'rtl.u_bist': ['bist'],
};

/** Plain-English explanation of the decoder sub-block, the register map it touches and the model-loading story. */
export function DecoderPanel({ c }: { c: ComponentInfo }) {
  const sub = AI_SUBBLOCK_BY_ID[c.id];
  const groups = REG_GROUP_FOR[c.id] ?? [];
  const regs = REGISTER_MAP.filter((r) => groups.includes(r.group));
  const { trace: t4, file } = useTraceV04();
  const openAi = () => { const s = useScene.getState(); if (s.labSize === 'collapsed') s.setLabSize('normal'); useV03.getState().setTab('ai'); };
  const isDecoder = c.id === 'rtl.ai' || c.id.startsWith('rtl.ai_');
  return (
    <>
      {sub && (
        <section className="ins-sec" data-testid="decoder-plain">
          <h4>In plain words <EvidenceBadge e="RTL" /></h4>
          <p className="ins-purpose"><b>{sub.title}.</b> {sub.plain}</p>
          <p className="ins-tech mono" style={{ fontSize: 'var(--fs-micro)' }}>{sub.rule}</p>
          <p className="faint" style={{ fontSize: 'var(--fs-micro)' }}>rtl/hbci_ai_decoder.v lines {sub.lines[0]}–{sub.lines[1]} · docs/AI_DECODER.md</p>
        </section>
      )}
      {isDecoder && (
        <section className="ins-sec" data-testid="decoder-model-status">
          <h4>Model and evidence</h4>
          {t4 ? (
            <p className="ins-purpose">
              Trace loaded: <code>{file}</code> — {t4.source.stream.label}; model: <b style={{ color: t4.source.model.trained ? 'var(--ok)' : 'var(--warn)' }}>{t4.source.model.trained ? 'TRAINED' : 'SYNTHETIC PLACEHOLDER'}</b> ({t4.model.linear ? 'linear' : `MLP 8→${t4.model.NH}→${t4.model.NO}`}, model_id 0x{t4.model.model_id.toString(16)}). {t4.frames.length} frames, {t4.predictions.length} predictions, {t4.checks.passed}/{t4.checks.total} checks against the cycle-accurate reference.
              {!t4.source.model.trained && ' The placeholder exercises the hardware only; its classes mean nothing about the signal.'}
            </p>
          ) : <p className="ins-none">rtl_trace_v04.json not loaded (run make artifacts).</p>}
          <button className="btn sm" onClick={openAi} data-testid="decoder-open-lab">Follow one frame through the decoder →</button>
        </section>
      )}
      {regs.length > 0 && (
        <Exp title="Register map (host view)" right={<span className="faint">{regs.length} rows</span>} testid="exp-regmap">
          <table className="ins-regmap">
            <thead><tr><th>addr</th><th>name</th><th>R/W</th><th>fields</th></tr></thead>
            <tbody>
              {regs.map((r) => <tr key={r.addr + r.name}><td className="mono">{r.addr}</td><td className="mono">{r.name}</td><td className="mono">{r.rw}</td><td>{r.fields}</td></tr>)}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 'var(--fs-micro)' }}>8-bit word address, 32-bit data, over the SPI register bus on the chip top. docs/AI_DECODER.md section 4.</p>
        </Exp>
      )}
      {(c.id === 'rtl.ai' || c.id === 'rtl.ai_model' || c.id === 'rtl.regs' || c.id === 'rtl.top04') && (
        <Exp title="Loading a model: no prediction without a verified CRC" testid="exp-loading">
          <ol className="ins-story">{LOADING_STORY.map((l) => <li key={l}>{l}</li>)}</ol>
          <p className="faint" style={{ fontSize: 'var(--fs-micro)' }}>Any accepted model write clears model_valid; writes are refused (counted, sticky flag) while ai_en = 1. Frames arriving without a valid model are counted in AI_NOMODEL and dropped.</p>
        </Exp>
      )}
    </>
  );
}

/** Real ports of the block's module and its netlist connections, plus the Verilog lines that implement it. */
export function V04Netlist({ c }: { c: ComponentInfo }) {
  const modules = useArtifacts((a) => a.modules);
  const where = INST_OF[c.id];
  const graph = useMemo(() => (where ? (where.scope === 'ai' ? buildGraphAi(modules) : buildGraphV04(modules)) : null), [modules, where]);
  const mod = c.rtlModule ? modules?.modules.find((m) => m.name === c.rtlModule) : null;
  const isTopLogic = !c.rtlInstance && c.id !== 'rtl.top04' && c.id !== 'rtl.readout';
  const edges: BlockEdge[] = graph && where ? graph.edges.filter((e) => (where.inst === '' ? e.from === '' || e.to === '$out' : e.from === where.inst || e.to === where.inst)) : [];
  const hl = c.rtlLines && mod && c.rtlLines[1] - c.rtlLines[0] < mod.line_end - mod.line_start ? new Set(Array.from({ length: c.rtlLines[1] - c.rtlLines[0] + 1 }, (_, k) => c.rtlLines![0] + k)) : undefined;
  return (
    <>
      <Exp title="Ports and netlist connections" right={<span className="faint">{mod ? `${mod.ports.length} ports` : 'rtl_modules.json missing'}</span>} testid="exp-v04-netlist">
        {mod ? (
          <>
            {isTopLogic && <p className="faint" style={{ fontSize: 'var(--fs-micro)' }}>Top-level logic of {c.rtlModule}: the ports below are that module's; the connections are the nets this logic drives or reads in the netlist.</p>}
            <div className="ins-ports">
              <div>
                <div className="cd-k">Enters</div>
                {mod.ports.filter((p) => p.dir === 'input').map((p) => <div key={p.name} className="mono">→ {p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}{p.signed ? ' s' : ''}</div>)}
              </div>
              <div>
                <div className="cd-k">Leaves</div>
                {mod.ports.filter((p) => p.dir === 'output').map((p) => <div key={p.name} className="mono">{p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}{p.signed ? ' s' : ''} →</div>)}
              </div>
            </div>
            <div className="cd-k" style={{ marginTop: 6 }}>Connected to (rtl_modules.json {where?.scope === 'ai' ? 'v04.ai' : 'v04'})</div>
            {edges.length === 0 ? <p className="faint" style={{ fontSize: 'var(--fs-micro)' }}>No netlist connections listed (rtl_modules.json has no v04 section, or this is the top itself).</p> : (
              <div className="cd-links">
                {edges.map((e) => {
                  const me = where!.inst;
                  const other = e.from === me ? (e.to === '$out' ? 'outputs' : e.to) : (e.from === '' ? 'inputs' : e.from);
                  const dir = e.from === me || (me === '' && e.from === '') ? '→' : '←';
                  const ports = e.nets.map((n) => (e.from === me || (me === '' && e.from === '') ? n.fromPort : n.toPort));
                  return <div key={e.id} className="mono" style={{ fontSize: 'var(--fs-micro)' }}>{dir} {other} <span className="faint">{[...new Set(ports)].slice(0, 10).join(', ')}{ports.length > 10 ? ' …' : ''}</span></div>;
                })}
              </div>
            )}
          </>
        ) : <p className="ins-none">rtl_modules.json not loaded.</p>}
      </Exp>
      {c.rtlModule && (
        <Exp title={`Verilog source${c.rtlLines ? ` (lines ${c.rtlLines[0]}–${c.rtlLines[1]})` : ''}`} right={<EvidenceBadge e="RTL" />} testid="exp-v04-source">
          <SourceView module={c.rtlModule} highlightLines={hl} maxHeight={280} />
        </Exp>
      )}
    </>
  );
}
