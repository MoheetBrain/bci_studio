import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './circuit.css';
import { useScene } from '../state/sceneStore';
import { cssVar } from '../model/theme';
import { useHw } from '../state/hwStore';
import { useArtifacts } from '../artifacts/load';
import { COMPONENTS, INSTANCE_TO_ID } from '../model/components';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { buildGraph, INSTANCE_MODULE, INSTANCES, BLOCK_WAVES } from './rtlGraph';
import { SourceView } from './SourceView';
import { DigitalWaves } from '../lab/DigitalWaves';
import { useLab } from '../lab/labStore';
import { CircuitV03 } from './CircuitV03';
import { CircuitV04 } from './CircuitV04';
import { AI_BLOCKS } from '../model/components';

const LEGACY_IDS = new Set(['rtl.core', 'rtl.u_state', 'rtl.u_baseline', 'rtl.u_threshold', 'rtl.u_refractory', 'rtl.u_timestamp', 'rtl.u_packer']);
const AI_IDS = new Set(['rtl.ai', ...AI_BLOCKS]);
const TOP_IDS = new Set(['rtl.top04', 'rtl.regs', 'rtl.u_bist', 'die.pads', 'pkg.die', 'sys.hbci01']);

/**
 * Level 3: four netlist diagrams. The selection decides which one is shown: the v0.4 integrated top
 * (hbci02_digital_top) for the top, register file, BIST or chip; the on-chip decoder for its blocks; the v0.3
 * readout core for its blocks; the legacy event core for its blocks.
 */
export function CircuitView() {
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const setViewEvidence = useScene((s) => s.setViewEvidence);
  const legacy = selectedId !== null && LEGACY_IDS.has(selectedId);
  const ai = selectedId !== null && AI_IDS.has(selectedId);
  const top = selectedId === null || TOP_IDS.has(selectedId);
  const which = legacy ? 'legacy' : ai ? 'ai' : top ? 'top' : 'v03';
  useEffect(() => setViewEvidence('RTL'), [setViewEvidence]);
  return (
    <>
      {which === 'legacy' ? <CircuitLegacy /> : which === 'ai' ? <CircuitV04 diagram="ai" /> : which === 'top' ? <CircuitV04 diagram="top" /> : <CircuitV03 />}
      <div className="circuit-switch seg" data-testid="circuit-switch">
        <button className={which === 'top' ? 'on' : ''} onClick={() => select('rtl.top04')} data-testid="diagram-v04">v0.4 digital top</button>
        <button className={which === 'ai' ? 'on' : ''} onClick={() => select('rtl.ai')} data-testid="diagram-ai">v0.4 AI decoder</button>
        <button className={which === 'v03' ? 'on' : ''} onClick={() => select('rtl.readout')}>v0.3 readout core</button>
        <button className={which === 'legacy' ? 'on' : ''} onClick={() => select('rtl.core')} data-testid="legacy-diagram">legacy event core</button>
      </div>
    </>
  );
}

type BlockData = {
  inst: string;
  title: string;
  module: string;
  cells: number | null;
  flops: number | null;
  selected: boolean;
  active: boolean;
  onPath: boolean;
  kind: 'block' | 'io';
  ports: string[];
};

const POS: Record<string, { x: number; y: number }> = {
  $in: { x: 0, y: 150 },
  u_state: { x: 260, y: 110 },
  u_baseline: { x: 540, y: 10 },
  u_threshold: { x: 820, y: 10 },
  u_refractory: { x: 1100, y: 200 },
  u_timestamp: { x: 820, y: 360 },
  u_packer: { x: 1380, y: 90 },
  $out: { x: 1660, y: 150 },
};

function BlockNode({ data }: NodeProps<Node<BlockData>>) {
  const cls = ['blk', data.kind, data.selected && 'sel', data.active && 'active', data.onPath && 'path'].filter(Boolean).join(' ');
  return (
    <div className={cls} data-testid={`block-${data.inst || 'inputs'}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Bottom} id="wb" />
      <div className="blk-title">{data.title}</div>
      {data.kind === 'block' ? (
        <>
          <div className="blk-mod mono">{data.module} · {data.inst}</div>
          <div className="blk-meta">
            {data.cells !== null ? <span title="Generic Yosys cells including submodules">{data.cells} cells</span> : <span className="faint">synth n/a</span>}
            {data.flops !== null && <span>{data.flops} FF</span>}
          </div>
        </>
      ) : (
        <div className="blk-ports mono">{data.ports.map((p) => <div key={p}>{p}</div>)}</div>
      )}
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="wbs" />
    </div>
  );
}

const nodeTypes = { block: BlockNode };

function CircuitLegacy() {
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const setLevel = useScene((s) => s.setLevel);
  const activeBlocks = useScene((s) => s.activeBlocks);
  const setViewEvidence = useScene((s) => s.setViewEvidence);
  const setGatesModule = useHw((s) => s.setGatesModule);
  const modules = useArtifacts((a) => a.modules);
  const synth = useArtifacts((a) => a.synth);
  const trace = useArtifacts((a) => a.trace);
  const labCursor = useLab((s) => s.cursor);
  const labMode = useLab((s) => s.mode);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  useEffect(() => setViewEvidence('RTL'), [setViewEvidence]);

  const { edges: bedges, source } = useMemo(() => buildGraph(modules), [modules]);
  const selInst = selectedId ? COMPONENTS[selectedId]?.rtlInstance ?? null : null;
  const activeInst = new Set(activeBlocks.map((id) => COMPONENTS[id]?.rtlInstance).filter((x): x is string => !!x));

  const statsFor = (mod: string) => synth?.modules.find((m) => m.module === mod) ?? null;

  const inputs = useMemo(() => [...new Set(bedges.filter((e) => e.from === '').flatMap((e) => e.nets.map((n) => n.fromPort)))], [bedges]);
  const outputs = useMemo(() => [...new Set(bedges.filter((e) => e.to === '$out').flatMap((e) => e.nets.map((n) => n.toPort)))], [bedges]);

  const pathInst = useMemo(() => {
    if (!selInst) return new Set<string>();
    const s = new Set<string>([selInst]);
    bedges.forEach((e) => {
      if (e.writeback) return;
      if (e.from === selInst) s.add(e.to);
      if (e.to === selInst) s.add(e.from);
    });
    return s;
  }, [selInst, bedges]);

  const nodes: Node<BlockData>[] = [
    {
      id: '$in', type: 'block', position: POS.$in,
      data: { inst: '', title: 'Top-level inputs', module: '', cells: null, flops: null, selected: false, active: activeInst.size > 0 && activeBlocks.includes('rtl.core'), onPath: pathInst.has(''), kind: 'io', ports: inputs },
    },
    ...INSTANCES.map((inst) => {
      const id = INSTANCE_TO_ID[inst];
      const st = statsFor(INSTANCE_MODULE[inst]);
      return {
        id: inst, type: 'block', position: POS[inst],
        data: {
          inst, title: COMPONENTS[id]?.name ?? inst, module: INSTANCE_MODULE[inst],
          cells: st?.cells ?? null, flops: st?.flops ?? null,
          selected: selInst === inst, active: activeInst.has(inst), onPath: pathInst.has(inst), kind: 'block' as const, ports: [],
        },
      };
    }),
    {
      id: '$out', type: 'block', position: POS.$out,
      data: { inst: '$out', title: 'Top-level outputs', module: '', cells: null, flops: null, selected: false, active: activeBlocks.includes('rtl.u_packer'), onPath: pathInst.has('$out'), kind: 'io', ports: outputs },
    },
  ];

  const edges: Edge[] = bedges.map((e) => {
    const lit = (activeInst.has(e.from) || e.from === '') && activeInst.has(e.to);
    const onPath = selInst !== null && (e.from === selInst || e.to === selInst);
    const bits = e.nets.reduce((a, n) => a + n.width, 0);
    const label = e.nets.length === 1 ? `${e.nets[0].fromPort}${e.nets[0].width > 1 ? `[${e.nets[0].width - 1}:0]` : ''}` : `${e.nets.length} nets · ${bits} b`;
    return {
      id: e.id,
      source: e.from === '' ? '$in' : e.from,
      target: e.to,
      sourceHandle: e.writeback ? 'wbs' : undefined,
      targetHandle: e.writeback ? 'wb' : undefined,
      type: 'smoothstep',
      animated: lit,
      label: hoverEdge === e.id || onPath ? e.nets.map((n) => `${n.fromPort}→${n.toPort}`).join(', ') : label,
      labelStyle: { fill: cssVar('--fg'), fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' },
      labelBgStyle: { fill: cssVar('--surface-panel'), fillOpacity: 0.85 },
      style: {
        stroke: lit ? cssVar('--accent') : onPath ? cssVar('--copper-hi') : e.writeback ? cssVar('--fg-tertiary') : cssVar('--copper'),
        strokeWidth: lit ? 3 : Math.min(4, 1 + Math.log2(1 + bits) / 2),
        strokeDasharray: e.writeback ? '6 4' : undefined,
        opacity: selInst && !onPath && !lit ? 0.35 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: lit ? cssVar('--accent') : cssVar('--copper') },
    };
  });

  const selModule = selInst ? INSTANCE_MODULE[selInst] : null;
  const modInfo = selModule ? modules?.modules.find((m) => m.name === selModule) ?? null : null;
  const comp = selectedId ? COMPONENTS[selectedId] : null;
  const st = selModule ? statsFor(selModule) : null;
  const cycle = trace ? trace.samples[Math.min(labMode === 'rtl' ? labCursor : 0, trace.samples.length - 1)]?.cycle ?? 0 : 0;
  const waves = trace && selInst ? trace.waves.filter((w) => BLOCK_WAVES[selInst]?.test(w.name)) : [];

  return (
    <div className="circuit" data-testid="circuit-view">
      <div className="circuit-graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={2.5}
          onNodeClick={(_, n) => {
            const id = n.id === '$in' || n.id === '$out' ? 'rtl.core' : INSTANCE_TO_ID[n.id];
            if (id) select(id);
          }}
          onNodeDoubleClick={(_, n) => {
            const mod = INSTANCE_MODULE[n.id];
            if (mod) {
              setGatesModule(mod);
              select(INSTANCE_TO_ID[n.id]);
              setLevel('gates');
            }
          }}
          onPaneClick={() => select('rtl.core')}
          onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
          onEdgeMouseLeave={() => setHoverEdge(null)}
          proOptions={{ hideAttribution: true }}
          colorMode={useScene.getState().theme === 'graphite' ? 'dark' : 'light'}
        >
          <Background color={cssVar('--border')} gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => ((n.data as BlockData).active ? cssVar('--accent') : (n.data as BlockData).selected ? cssVar('--copper') : cssVar('--surface-raised'))} maskColor={cssVar('--surface-sunken') + 'cc'} style={{ background: cssVar('--surface-panel') }} />
        </ReactFlow>
        <div className="circuit-legend">
          <div><b>hbci_event_core</b> functional blocks <EvidenceBadge e="RTL" /></div>
          <div className="faint">
            Connectivity: {source === 'artifact' ? 'derived from the Yosys netlist (rtl_modules.json)' : 'transcribed from rtl/hbci_event_core.v (artifact missing)'} ·
            dashed = state write-back · click a block to inspect · double-click for its gate-level netlist
          </div>
        </div>
      </div>
      <div className="circuit-detail">
        {!selInst ? (
          <div className="cd-pad">
            <div className="panel-title" style={{ padding: 0 }}>Top module</div>
            <h3>hbci_event_core</h3>
            <p className="muted">Six functional blocks process one sample per clock. Select a block to see what enters it, what leaves, the computation, the cells that implement it, its Verilog and its waveform signals.</p>
            {synth && <p className="mono faint">Top: {synth.modules.find((m) => m.module === 'hbci_event_core')?.cells ?? '?'} generic cells · {synth.modules.find((m) => m.module === 'hbci_event_core')?.flops ?? '?'} flip-flops</p>}
            <SourceView module="hbci_event_core" />
          </div>
        ) : (
          <div className="cd-pad" data-testid="circuit-detail">
            <div className="cd-head">
              <h3>{comp?.name}</h3>
              <EvidenceBadge e="RTL" />
            </div>
            <div className="mono faint">{selModule} · instance {selInst}</div>
            <div className="cd-io">
              <div>
                <div className="cd-k">Enters</div>
                {(modInfo?.ports.filter((p) => p.dir === 'input') ?? []).map((p) => <div key={p.name} className="mono">→ {p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}{p.signed ? ' s' : ''}</div>)}
                {!modInfo && <div className="muted">{comp?.input}</div>}
              </div>
              <div>
                <div className="cd-k">Leaves</div>
                {(modInfo?.ports.filter((p) => p.dir === 'output') ?? []).map((p) => <div key={p.name} className="mono">{p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}{p.signed ? ' s' : ''} →</div>)}
                {!modInfo && <div className="muted">{comp?.output}</div>}
              </div>
            </div>
            <div className="cd-k">Computation</div>
            <p className="cd-math">{comp?.transformation}</p>
            <div className="cd-k">Implemented by <EvidenceBadge e="SYNTH" /></div>
            {st ? (
              <div className="cd-cells">
                <span className="mono">{st.cells} cells · {st.flops} flip-flops</span>
                <div className="cd-hist">
                  {Object.entries(st.cell_types).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => (
                    <span key={k} className="chip" title={k}>{k.replace(/^\$_?|_$/g, '')} ×{v}</span>
                  ))}
                </div>
              </div>
            ) : <div className="missing">synth_stats.json not generated yet</div>}
            <div className="cd-actions">
              <button className="btn sm" onClick={() => { setGatesModule(selModule); setLevel('gates'); }} data-testid="open-gates">Open gate-level schematic →</button>
              <button className="btn sm" onClick={() => setLevel('die')}>Show on die</button>
            </div>
            <div className="cd-k">Connected to</div>
            <div className="cd-links">
              {bedges.filter((e) => e.from === selInst || e.to === selInst).map((e) => (
                <div key={e.id} className="mono">
                  {e.from === selInst ? '→ ' + (e.to === '$out' ? 'outputs' : e.to) : '← ' + (e.from === '' ? 'inputs' : e.from)}{' '}
                  <span className="faint">{e.nets.map((n) => (e.from === selInst ? n.fromPort : n.toPort)).join(', ')}</span>
                </div>
              ))}
            </div>
            <div className="cd-k">Waveform signals {trace ? <EvidenceBadge e="RTL" /> : null}</div>
            {trace && waves.length ? (
              <div className="cd-waves"><DigitalWaves waves={waves} cycle={cycle} span={48} /></div>
            ) : <div className="missing">{trace ? 'No traced top-level signals for this block' : 'rtl_trace.json not generated yet'}</div>}
            <div className="faint" style={{ fontSize: 10 }}>{labMode === 'rtl' ? 'Synchronised with the RTL trace cursor in the signal lab.' : 'Switch the signal lab to RTL trace to scrub these waveforms.'}</div>
            <div className="cd-k">Verilog source</div>
            <SourceView module={selModule!} />
          </div>
        )}
      </div>
    </div>
  );
}
