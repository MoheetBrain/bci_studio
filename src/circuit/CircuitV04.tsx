// v0.4 netlist diagrams (rtl_modules.json `v04` and `v04.ai`): hbci02_digital_top with its three instances and
// the register file, and the on-chip decoder hbci_ai_decoder with its four instances and the prediction FIFO.
// Connectivity is the Yosys netlist's; box positions are arranged for reading. Clock and reset are not drawn.
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, type Node, type Edge, type NodeProps } from '@xyflow/react';
import { useScene } from '../state/sceneStore';
import { cssVar } from '../model/theme';
import { useArtifacts } from '../artifacts/load';
import { COMPONENTS } from '../model/components';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { useHw } from '../state/hwStore';
import { BLOCK_NAMES } from '../micro/names';
import { AI_NODE_ID, INSTANCES_AI, INSTANCES_V04, INSTANCE_MODULE_AI, INSTANCE_MODULE_V04, V04_NODE_ID, buildGraphAi, buildGraphV04, type BlockEdge } from './rtlGraph';
import { SourceView } from './SourceView';
import { AI_SUBBLOCK_BY_ID } from '../model/aiDecoder';

type D = { inst: string; title: string; sub: string; cells: number | null; flops: number | null; sel: boolean; active: boolean; kind: 'block' | 'io'; ports: string[]; ai: boolean };

const POS_V04: Record<string, { x: number; y: number }> = {
  $in: { x: 0, y: 150 }, u_readout: { x: 330, y: 40 }, $regs: { x: 330, y: 330 }, u_ai: { x: 700, y: 120 }, u_bist: { x: 700, y: 380 }, $out: { x: 1060, y: 150 },
};
const POS_AI: Record<string, { x: number; y: number }> = {
  $in: { x: 0, y: 160 }, u_quant: { x: 300, y: 60 }, u_collect: { x: 580, y: 60 }, u_model: { x: 300, y: 330 }, u_engine: { x: 860, y: 160 }, $fifo: { x: 1140, y: 160 }, $out: { x: 1420, y: 160 },
};

function Block({ data }: NodeProps<Node<D>>) {
  const cls = ['blk', data.kind, data.sel && 'sel', data.active && 'active', data.ai && 'ai'].filter(Boolean).join(' ');
  return (
    <div className={cls} data-testid={`v04-block-${data.inst.replace('$', '')}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Bottom} id="wb" />
      <div className="blk-title">{data.title}</div>
      <div className="blk-mod mono">{data.sub}</div>
      {data.kind === 'block' && <div className="blk-meta">{data.cells !== null ? <span>{data.cells} cells{data.flops !== null ? ` · ${data.flops} FF` : ''}</span> : <span className="faint">top-level logic</span>}</div>}
      {data.kind === 'io' && <div className="blk-ports mono">{data.ports.slice(0, 10).map((p) => <div key={p}>{p}</div>)}{data.ports.length > 10 && <div className="faint">+{data.ports.length - 10} more</div>}</div>}
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="wbs" />
    </div>
  );
}
const nodeTypes = { block: Block };

export type V04Diagram = 'top' | 'ai';

export function CircuitV04({ diagram }: { diagram: V04Diagram }) {
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const setLevel = useScene((s) => s.setLevel);
  const activeBlocks = useScene((s) => s.activeBlocks);
  const setGatesModule = useHw((s) => s.setGatesModule);
  const expert = useScene((s) => s.uiMode === 'inspect');
  const modules = useArtifacts((a) => a.modules);
  const synth = useArtifacts((a) => a.synth);
  const sky = useArtifacts((a) => a.sky130V04);
  const isAi = diagram === 'ai';
  const { edges: bedges, source } = useMemo(() => (isAi ? buildGraphAi(modules) : buildGraphV04(modules)), [modules, isAi]);
  const active = new Set(activeBlocks);
  const INST = isAi ? INSTANCES_AI : INSTANCES_V04;
  const MOD = isAi ? INSTANCE_MODULE_AI : INSTANCE_MODULE_V04;
  const NODE_ID = isAi ? AI_NODE_ID : V04_NODE_ID;
  const POS = isAi ? POS_AI : POS_V04;
  const topId = isAi ? 'rtl.ai' : 'rtl.top04';
  const topModule = isAi ? 'hbci_ai_decoder' : 'hbci02_digital_top';
  const statsFor = (mod: string) => synth?.modules.find((m) => m.module === mod) ?? null;
  const selNode = Object.keys(NODE_ID).find((k) => NODE_ID[k] === selectedId) ?? null;
  const isTopLevel = (inst: string) => inst === '$regs' || inst === '$fifo';

  const inputs = [...new Set(bedges.filter((e) => e.from === '').flatMap((e) => e.nets.map((n) => n.fromPort)))];
  const outputs = [...new Set(bedges.filter((e) => e.to === '$out').flatMap((e) => e.nets.map((n) => n.toPort)))];
  const nodes: Node<D>[] = [
    { id: '$in', type: 'block', position: POS.$in, data: { inst: '$in', title: isAi ? 'Decoder inputs' : 'Chip inputs', sub: isAi ? 'feat_* tap, cfg_*, model bus' : 'samples, register bus, rec_ready', cells: null, flops: null, sel: false, active: false, kind: 'io', ports: inputs, ai: isAi } },
    ...INST.map((inst) => {
      const id = NODE_ID[inst];
      const st = isTopLevel(inst) ? null : statsFor(MOD[inst]);
      const n = BLOCK_NAMES[id];
      return {
        id: inst, type: 'block', position: POS[inst],
        data: {
          inst, title: expert ? (isTopLevel(inst) ? `${n?.inst ?? inst} (top-level logic)` : inst) : n?.friendly ?? COMPONENTS[id]?.name ?? inst,
          sub: expert ? `${n?.friendly ?? ''} · ${MOD[inst]}` : `${isTopLevel(inst) ? n?.inst ?? inst : inst} · ${MOD[inst]}`,
          cells: st?.cells ?? null, flops: st?.flops ?? null,
          sel: selNode === inst, active: active.has(id), kind: 'block' as const, ports: [], ai: isAi || inst === 'u_ai',
        },
      };
    }),
    { id: '$out', type: 'block', position: POS.$out, data: { inst: '$out', title: isAi ? 'Decoder outputs' : 'Chip outputs', sub: isAi ? 'pred_*, stat_*, diagnostics' : 'rec_*, pred pins, reg_rdata', cells: null, flops: null, sel: false, active: false, kind: 'io', ports: outputs, ai: isAi } },
  ];
  const edges: Edge[] = bedges.map((e: BlockEdge) => {
    const from = e.from === '' ? '$in' : e.from;
    const lit = active.has(NODE_ID[e.to] ?? '') && (from === '$in' || active.has(NODE_ID[from] ?? ''));
    const onSel = !!selNode && (from === selNode || e.to === selNode);
    const bits = e.nets.reduce((a, n) => a + n.width, 0);
    const label = e.nets.length === 1 ? `${e.nets[0].fromPort}${e.nets[0].width > 1 ? `[${e.nets[0].width - 1}:0]` : ''}` : `${e.nets.length} nets · ${bits} b`;
    return {
      id: e.id, source: from, target: e.to, type: 'smoothstep', animated: lit,
      sourceHandle: e.writeback ? 'wbs' : undefined, targetHandle: e.writeback ? 'wb' : undefined,
      label: onSel ? e.nets.map((n) => n.fromPort === n.toPort ? n.fromPort : `${n.fromPort}→${n.toPort}`).slice(0, 8).join(', ') + (e.nets.length > 8 ? ` … (+${e.nets.length - 8})` : '') : label,
      labelStyle: { fill: cssVar('--fg'), fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }, labelBgStyle: { fill: cssVar('--surface-panel'), fillOpacity: 0.85 },
      style: { stroke: lit ? cssVar('--accent') : onSel ? cssVar('--copper-hi') : isAi ? cssVar('--path-ai') : cssVar('--copper'), strokeWidth: lit ? 3 : Math.min(4, 1 + Math.log2(1 + bits) / 2), strokeDasharray: e.writeback ? '6 4' : undefined, opacity: selNode && !onSel && !lit ? 0.35 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: lit ? cssVar('--accent') : isAi ? cssVar('--path-ai') : cssVar('--copper') },
    };
  });

  const comp = selectedId && NODE_ID[selNode ?? ''] ? COMPONENTS[selectedId] : COMPONENTS[topId];
  const selMod = selNode ? MOD[selNode] : topModule;
  const modInfo = modules?.modules.find((m) => m.name === selMod) ?? null;
  const st = statsFor(selMod);
  const sub = comp ? AI_SUBBLOCK_BY_ID[comp.id] : undefined;
  const lines = comp?.rtlLines;
  const hl = lines && modInfo && (lines[1] - lines[0] < modInfo.line_end - modInfo.line_start) ? new Set(Array.from({ length: lines[1] - lines[0] + 1 }, (_, k) => lines[0] + k)) : undefined;

  return (
    <div className="circuit" data-testid={`circuit-v04-${diagram}`}>
      <div className="circuit-graph">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.2} maxZoom={2.5}
          onNodeClick={(_, n) => select(NODE_ID[n.id] ?? topId)}
          onNodeDoubleClick={(_, n) => {
            if (n.id === 'u_ai') { select('rtl.ai'); return; }
            if (n.id === 'u_readout') { select('rtl.readout'); return; }
            const mod = MOD[n.id];
            if (mod && !isTopLevel(n.id)) { setGatesModule(mod); select(NODE_ID[n.id]); setLevel('gates'); }
          }}
          onPaneClick={() => select(topId)}
          proOptions={{ hideAttribution: true }} colorMode={useScene.getState().theme === 'graphite' ? 'dark' : 'light'}>
          <Background color={cssVar('--border')} gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="circuit-legend">
          <div><b>{topModule}</b> ({isAi ? 'on-chip AI decoder, v0.4' : 'integrated digital top, v0.4'}) <EvidenceBadge e="RTL" /> <EvidenceBadge e="SYNTH" title={sky ? `SKY130 HD mapping of hbci02_digital_top: ${sky.cells} cells, ${sky.flops} flip-flops, ${Math.round(sky.cell_area_um2).toLocaleString()} µm² cell area` : 'generic Yosys synthesis'} /></div>
          <div className="faint">
            Connectivity: {source === 'artifact' ? `derived from the Yosys netlist (rtl_modules.json v04${isAi ? '.ai' : ''})` : 'rtl_modules.json has no v04 section: no connections to show'} ·
            {isAi ? ' $fifo = prediction FIFO + pending register (top-level logic of the decoder): pred_* nets go through it; dashed = model → quantiser parameters' : ' $regs = the register file (top-level logic): cfg_*, model and CRC writes come from it, counters and the FIFO head return to it'} ·
            click a block to inspect · double-click an instance for its gates (v0.4 modules have no schematic SVG yet)
          </div>
        </div>
      </div>
      <div className="circuit-detail">
        <div className="cd-pad" data-testid="circuit-v04-detail">
          <div className="cd-head"><h3>{comp?.name}</h3><EvidenceBadge e="RTL" /></div>
          {comp?.rtlModule && <div className="mono faint">{comp.rtlModule}{comp.rtlInstance ? ` · instance ${comp.rtlInstance}` : ''}{comp.rtlLines ? ` · lines ${comp.rtlLines[0]}–${comp.rtlLines[1]}` : ''}</div>}
          {sub && <p className="cd-math" style={{ fontStyle: 'normal' }}><b>{sub.title}.</b> {sub.plain}</p>}
          <div className="cd-io">
            <div>
              <div className="cd-k">Enters</div>
              {(modInfo?.ports.filter((p) => p.dir === 'input') ?? []).slice(0, 24).map((p) => <div key={p.name} className="mono">→ {p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}{p.signed ? ' s' : ''}</div>)}
              {!modInfo && <div className="muted">{comp?.input}</div>}
            </div>
            <div>
              <div className="cd-k">Leaves</div>
              {(modInfo?.ports.filter((p) => p.dir === 'output') ?? []).slice(0, 24).map((p) => <div key={p.name} className="mono">{p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}{p.signed ? ' s' : ''} →</div>)}
              {!modInfo && <div className="muted">{comp?.output}</div>}
            </div>
          </div>
          <div className="cd-k">Computation</div>
          <p className="cd-math">{sub ? sub.rule : comp?.transformation}</p>
          <div className="cd-k">Implemented by <EvidenceBadge e="SYNTH" /></div>
          {st ? (
            <div className="cd-cells">
              <span className="mono">{st.cells} generic cells · {st.flops} flip-flops</span>
              <div className="cd-hist">
                {Object.entries(st.cell_types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => <span key={k} className="chip" title={k}>{k.replace(/^\$_?|_$/g, '')} ×{v}</span>)}
              </div>
            </div>
          ) : <div className="faint">no separate synthesis entry (top-level logic of {selMod})</div>}
          <div className="cd-k">Connected to</div>
          <div className="cd-links">
            {bedges.filter((e) => selNode && (e.from === selNode || e.to === selNode)).map((e) => (
              <div key={e.id} className="mono">
                {e.from === selNode ? '→ ' + (e.to === '$out' ? 'outputs' : e.to) : '← ' + (e.from === '' ? 'inputs' : e.from)}{' '}
                <span className="faint">{e.nets.map((n) => (e.from === selNode ? n.fromPort : n.toPort)).slice(0, 12).join(', ')}{e.nets.length > 12 ? ' …' : ''}</span>
              </div>
            ))}
            {!selNode && <div className="faint">Select a block to list its netlist connections.</div>}
          </div>
          <div className="cd-actions">
            {st && <button className="btn sm" onClick={() => { setGatesModule(selMod); setLevel('gates'); }}>Open gate-level schematic →</button>}
            <button className="btn sm" onClick={() => setLevel('die')}>Show on die</button>
          </div>
          <div className="cd-k">Verilog source{hl ? ' (block lines highlighted)' : ''}</div>
          <SourceView module={selMod} highlightLines={hl} />
        </div>
      </div>
    </div>
  );
}
