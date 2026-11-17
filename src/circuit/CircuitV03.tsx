// Level 3 block diagram of the v0.3 readout core (hbci_readout_core): RAW, EVENT and FEATURE paths into the
// record multiplexer, with mode highlighting shared with the die view.
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, type Node, type Edge, type NodeProps } from '@xyflow/react';
import { useScene } from '../state/sceneStore';
import { cssVar } from '../model/theme';
import { useArtifacts } from '../artifacts/load';
import { COMPONENTS } from '../model/components';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { useHw } from '../state/hwStore';
import { BLOCK_NAMES } from '../micro/names';
import { buildGraphV03, INSTANCE_MODULE_V03, INSTANCES_V03, V03_NODE_ID } from './rtlGraph';
import { SourceView } from './SourceView';
import type { ProcMode } from '../model/types';

type D = { inst: string; title: string; sub: string; cells: number | null; sel: boolean; active: boolean; dim: boolean; kind: 'block' | 'io'; ports: string[] };

const POS: Record<string, { x: number; y: number }> = {
  '$in': { x: 0, y: 190 },
  $raw: { x: 300, y: 0 },
  u_event: { x: 300, y: 130 },
  u_fstate: { x: 300, y: 300 },
  u_biquad: { x: 580, y: 300 },
  u_energy: { x: 860, y: 300 },
  u_ts: { x: 580, y: 470 },
  u_records: { x: 1150, y: 160 },
  $out: { x: 1440, y: 190 },
};

const PATHS: Record<ProcMode, Set<string>> = {
  EVENT: new Set(['$in', 'u_event', 'u_ts', 'u_records', '$out']),
  RAW: new Set(['$in', '$raw', 'u_ts', 'u_records', '$out']),
  FEATURE: new Set(['$in', 'u_fstate', 'u_biquad', 'u_energy', 'u_ts', 'u_records', '$out']),
  HYBRID: new Set(['$in', '$raw', 'u_fstate', 'u_biquad', 'u_energy', 'u_ts', 'u_records', '$out']),
};

function Block({ data }: NodeProps<Node<D>>) {
  const cls = ['blk', data.kind, data.sel && 'sel', data.active && 'active'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ opacity: data.dim ? 0.35 : 1 }} data-testid={`v03-block-${data.inst}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Bottom} id="wb" />
      <div className="blk-title">{data.title}</div>
      <div className="blk-mod mono">{data.sub}</div>
      {data.kind === 'block' && <div className="blk-meta">{data.cells !== null ? <span>{data.cells} cells</span> : <span className="faint">synth pending</span>}</div>}
      {data.kind === 'io' && <div className="blk-ports mono">{data.ports.slice(0, 9).map((p) => <div key={p}>{p}</div>)}</div>}
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="wbs" />
    </div>
  );
}
const nodeTypes = { block: Block };

export function CircuitV03() {
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const setLevel = useScene((s) => s.setLevel);
  const procMode = useScene((s) => s.procMode);
  const setProcMode = useScene((s) => s.setProcMode);
  const activeBlocks = useScene((s) => s.activeBlocks);
  const setGatesModule = useHw((s) => s.setGatesModule);
  const expert = useScene((s) => s.uiMode === 'inspect');
  const modules = useArtifacts((a) => a.modules);
  const synth = useArtifacts((a) => a.synth);
  const { edges: bedges, source } = useMemo(() => buildGraphV03(modules), [modules]);
  const active = new Set(activeBlocks);
  const onPath = PATHS[procMode];
  const cells = (mod: string) => synth?.modules.find((m) => m.module === mod)?.cells ?? null;
  const selNode = Object.keys(V03_NODE_ID).find((k) => V03_NODE_ID[k] === selectedId) ?? (selectedId === 'rtl.readout' ? null : null);

  const inputs = [...new Set(bedges.filter((e) => e.from === '').flatMap((e) => e.nets.map((n) => n.fromPort)))];
  const outputs = [...new Set(bedges.filter((e) => e.to === '$out').flatMap((e) => e.nets.map((n) => n.toPort)))];
  const nodes: Node<D>[] = [
    { id: '$in', type: 'block', position: POS.$in, data: { inst: '$in', title: 'Inputs (ADC-style)', sub: 'no back-pressure', cells: null, sel: false, active: active.has('rtl.readout'), dim: false, kind: 'io', ports: inputs } },
    ...INSTANCES_V03.map((inst) => {
      const id = V03_NODE_ID[inst];
      return {
        id: inst, type: 'block', position: POS[inst],
        data: {
          inst, title: expert ? (inst === '$raw' ? 'raw_gen (top-level logic)' : inst) : BLOCK_NAMES[id]?.friendly ?? COMPONENTS[id]?.name ?? inst,
          sub: inst === '$raw' ? (expert ? 'RAW path · raw_gen = accept & session & (RAW|HYBRID)' : 'raw_gen · top-level logic, not a module') : expert ? `${BLOCK_NAMES[id]?.friendly ?? ''} · ${INSTANCE_MODULE_V03[inst]}` : `${inst} · ${INSTANCE_MODULE_V03[inst]}`,
          cells: inst === '$raw' ? null : cells(INSTANCE_MODULE_V03[inst]),
          sel: selNode === inst, active: active.has(id), dim: !onPath.has(inst), kind: 'block' as const, ports: [],
        },
      };
    }),
    { id: '$out', type: 'block', position: POS.$out, data: { inst: '$out', title: 'Record stream', sub: 'rec_valid / rec_ready', cells: null, sel: false, active: active.has('rtl.u_records'), dim: false, kind: 'io', ports: outputs } },
  ];
  const edges: Edge[] = bedges.map((e) => {
    const from = e.from === '' ? '$in' : e.from;
    const lit = active.has(V03_NODE_ID[e.to] ?? '') && (from === '$in' || active.has(V03_NODE_ID[from] ?? ''));
    const live = onPath.has(from) && onPath.has(e.to);
    const label = e.nets.length === 1 ? e.nets[0].fromPort : `${e.nets.length} nets`;
    return {
      id: e.id, source: from, target: e.to, type: 'smoothstep', animated: lit,
      sourceHandle: e.writeback ? 'wbs' : undefined, targetHandle: e.writeback ? 'wb' : undefined,
      label, labelStyle: { fill: cssVar('--fg'), fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }, labelBgStyle: { fill: cssVar('--surface-panel'), fillOpacity: 0.85 },
      style: { stroke: lit ? cssVar('--accent') : live ? cssVar('--copper') : cssVar('--border'), strokeWidth: lit ? 3 : live ? 2 : 1, strokeDasharray: e.writeback ? '6 4' : undefined, opacity: live || lit ? 1 : 0.35 },
      markerEnd: { type: MarkerType.ArrowClosed, color: lit ? cssVar('--accent') : live ? cssVar('--copper') : cssVar('--border') },
    };
  });

  const selMod = selNode && selNode !== '$raw' ? INSTANCE_MODULE_V03[selNode] : 'hbci_readout_core';
  const comp = selectedId ? COMPONENTS[selectedId] : COMPONENTS['rtl.readout'];

  return (
    <div className="circuit" data-testid="circuit-v03">
      <div className="circuit-graph">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.1 }} minZoom={0.2} maxZoom={2.5}
          onNodeClick={(_, n) => select(V03_NODE_ID[n.id] ?? 'rtl.readout')}
          onNodeDoubleClick={(_, n) => {
            if (n.id === 'u_event') { select('rtl.core'); return; }
            const mod = INSTANCE_MODULE_V03[n.id];
            if (mod && n.id !== '$raw') { setGatesModule(mod); select(V03_NODE_ID[n.id]); setLevel('gates'); }
          }}
          onPaneClick={() => select('rtl.readout')}
          proOptions={{ hideAttribution: true }} colorMode={useScene.getState().theme === 'graphite' ? 'dark' : 'light'}>
          <Background color={cssVar('--border')} gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="circuit-legend">
          <div><b>hbci_readout_core</b> (v0.3) <EvidenceBadge e="RTL" />
            <div className="seg" style={{ marginLeft: 8 }}>
              {(['EVENT', 'RAW', 'FEATURE', 'HYBRID'] as ProcMode[]).map((m) => <button key={m} className={procMode === m ? 'on' : ''} onClick={() => setProcMode(m)}>{m}</button>)}
            </div>
          </div>
          <div className="faint">
            Connectivity: {source === 'artifact' ? 'derived from the Yosys netlist (rtl_modules.json v03)' : 'transcribed from docs/V03_READOUT_SPEC.md (netlist-derived version pending)'} ·
            dimmed = not used by {procMode} · double-click a block for its gates; double-click u_event for the legacy core diagram
          </div>
        </div>
      </div>
      <div className="circuit-detail">
        <div className="cd-pad" data-testid="circuit-v03-detail">
          <div className="cd-head"><h3>{comp?.name}</h3><EvidenceBadge e={comp?.evidence ?? 'RTL'} /></div>
          <div className="cd-k">Enters</div><p className="cd-math">{comp?.input}</p>
          <div className="cd-k">Computation</div><p className="cd-math">{comp?.transformation}</p>
          <div className="cd-k">Leaves</div><p className="cd-math">{comp?.output}</p>
          {comp?.remove && <><div className="cd-k">What changes if I remove it?</div><p className="cd-math">{comp.remove}</p></>}
          {comp?.modes && <div className="cd-hist">{comp.modes.map((m) => <span key={m} className={`chip${m === procMode ? ' on' : ''}`}>{m}</span>)}</div>}
          <div className="cd-actions">
            {selMod !== 'hbci_readout_core' && <button className="btn sm" onClick={() => { setGatesModule(selMod); setLevel('gates'); }}>Open gate-level schematic →</button>}
            <button className="btn sm" onClick={() => setLevel('die')}>Show on die</button>
          </div>
          <div className="cd-k">Verilog source</div>
          <SourceView module={selMod} />
        </div>
      </div>
    </div>
  );
}
