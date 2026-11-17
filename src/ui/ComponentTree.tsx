// Left sidebar: hierarchical component tree synchronised with the 3D selection and hover through
// useScene.selectedId. Adds search, kind letters, a restore (eye) control for hidden parts, an
// "Isolating" marker and a one-click Focus (select + fit).
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPONENTS, COMPONENT_LIST, ancestorsOf, childrenOf } from '../model/components';
import type { ComponentInfo, Level } from '../model/types';
import { useScene, isVisible } from '../state/sceneStore';
import { KIND_HELP, KIND_LABEL, kindOf, type Kind } from '../model/kind';
import { EVIDENCE_HELP } from './EvidenceBadge';
import { ensurePresetFor, selectAndNavigate } from './nav';
import './ui.css';
import './panels.css';

const LEVEL_SHORT: Record<Level, string> = { system: 'SYS', package: 'PKG', die: 'DIE', circuit: 'CKT', module: 'MOD', gates: 'GATE', cell: 'CELL', layout: '2D' };
const LEVEL_NAME: Record<Level, string> = { system: 'System', package: 'Package', die: 'Die', circuit: 'Circuit', module: 'Module', gates: 'Gates', cell: 'Standard cell', layout: 'Physical layout' };
const KIND_LETTER: Record<Kind, string> = { logical: 'L', physical: 'P', software: 'S', concept: 'C' };
const IS_3D: Record<Level, boolean> = { system: true, package: true, die: true, circuit: false, module: false, gates: false, cell: false, layout: false };

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 13.5l11-11" />}
    </svg>
  );
}

/** Select, navigate to the level (and preset) that shows it, and frame it in 3D. */
export function focusComponent(c: ComponentInfo) {
  selectAndNavigate(c);
  if (IS_3D[c.level]) useScene.getState().requestFit();
}

function matches(c: ComponentInfo, q: string): boolean {
  const hay = `${c.name} ${c.id} ${c.evidence} ${KIND_LABEL[kindOf(c)]} ${c.rtlModule ?? ''} ${c.physical}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

interface RowProps {
  c: ComponentInfo;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  /** When searching: the set of ids to show (matches and their ancestors); everything is expanded. */
  filter: Set<string> | null;
  hits: Set<string> | null;
}

function Row({ c, depth, expanded, onToggle, filter, hits }: RowProps) {
  const selected = useScene((s) => s.selectedId === c.id);
  const hovered = useScene((s) => s.hoveredId === c.id);
  const hiddenSelf = useScene((s) => !!s.hidden[c.id]);
  const visible = useScene((s) => isVisible(s, c.id));
  const isolated = useScene((s) => s.isolateId === c.id);
  const kids = childrenOf(c.id).filter((k) => !filter || filter.has(k.id));
  const open = filter ? true : !!expanded[c.id];
  const ref = useRef<HTMLDivElement>(null);
  const kind = kindOf(c);
  const hit = hits ? hits.has(c.id) : true;

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <>
      <div
        ref={ref}
        className={`tree-row${selected ? ' sel' : ''}${hovered ? ' hov' : ''}${visible ? '' : ' hid'}${hit ? '' : ' nohit'}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        role="treeitem"
        tabIndex={0}
        aria-selected={selected}
        aria-expanded={kids.length ? open : undefined}
        data-id={c.id}
        title={`${c.name}\n${c.id} · ${LEVEL_NAME[c.level]} level · ${c.evidence} · ${KIND_LABEL[kind]}\nClick: select${c.enter ? ' · Double-click: inspect deeper' : ''} · Enter: focus`}
        onClick={() => selectAndNavigate(c)}
        onDoubleClick={() => useScene.getState().enter(c.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); focusComponent(c); }
          else if (e.key === ' ') { e.preventDefault(); selectAndNavigate(c); }
          else if (e.key === 'ArrowRight' && kids.length && !open && !filter) onToggle(c.id);
          else if (e.key === 'ArrowLeft' && kids.length && open && !filter) onToggle(c.id);
        }}
        onMouseEnter={() => useScene.getState().hover(c.id)}
        onMouseLeave={() => useScene.getState().hoveredId === c.id && useScene.getState().hover(null)}
      >
        {kids.length ? (
          <button
            className={`tree-chev${open ? ' open' : ''}`}
            aria-label={open ? 'Collapse' : 'Expand'}
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); if (!filter) onToggle(c.id); }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden><path d="M3 1.5L7 5 3 8.5" /></svg>
          </button>
        ) : (
          <span className="tree-chev-sp" />
        )}
        <span className={`tree-kind kind-${kind}`} title={`${KIND_LABEL[kind]}: ${KIND_HELP[kind]}`} aria-label={KIND_LABEL[kind]}>{KIND_LETTER[kind]}</span>
        <span className={`ev-dot ev-${c.evidence}`} title={`${c.evidence}: ${EVIDENCE_HELP[c.evidence]}`} />
        <span className="tree-name">{c.name}</span>
        {isolated && <span className="tree-mark" title="Only this component and its sub-parts are shown in 3D">Isolating</span>}
        {hiddenSelf && <span className="tree-mark hidden" title="Hidden in 3D (click the eye to restore)">Hidden</span>}
        <span className="tree-lvl" title={`${LEVEL_NAME[c.level]} level`}>{LEVEL_SHORT[c.level]}</span>
        <button
          className="tree-act tree-focus"
          title="Focus: select and frame it in the view"
          aria-label="Focus"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); focusComponent(c); }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" /><circle cx="8" cy="8" r="1.6" /></svg>
        </button>
        <button
          className={`tree-act tree-iso${isolated ? ' on' : ''}`}
          title={isolated ? 'Stop isolating' : 'Isolate: show only this component and its sub-parts'}
          aria-label="Isolate"
          tabIndex={-1}
          disabled={!IS_3D[c.level]}
          onClick={(e) => {
            e.stopPropagation();
            const s = useScene.getState();
            if (isolated) return s.isolate(null);
            ensurePresetFor(c);
            if (c.level !== s.level) s.setLevel(c.level);
            useScene.getState().select(c.id);
            useScene.getState().isolate(c.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><circle cx="8" cy="8" r="2.5" /><circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" /></svg>
        </button>
        <button
          className={`tree-act tree-eye${hiddenSelf ? ' on' : ''}`}
          title={hiddenSelf ? 'Restore: show this component again' : 'Hide this component in 3D (it stays in the tree)'}
          aria-label={hiddenSelf ? 'Restore' : 'Hide'}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); useScene.getState().setHidden(c.id, !hiddenSelf); }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <EyeIcon off={hiddenSelf} />
        </button>
      </div>
      {open && kids.map((k) => <Row key={k.id} c={k} depth={depth + 1} expanded={expanded} onToggle={onToggle} filter={filter} hits={hits} />)}
    </>
  );
}

export function ComponentTree() {
  const selectedId = useScene((s) => s.selectedId);
  const hiddenCount = useScene((s) => Object.keys(s.hidden).length);
  const isolateId = useScene((s) => s.isolateId);
  const preset = useScene((s) => s.preset);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    'sys.root': true, 'cx.root': true, 'sys.hbci01': true, 'sys.ai_module': true, 'pkg.die': true, 'rtl.top04': true, 'rtl.ai': true, 'rtl.readout': true, 'rtl.core': false,
  });

  // Reveal the selection: expand its ancestors.
  useEffect(() => {
    if (!selectedId || !COMPONENTS[selectedId]) return;
    const anc = ancestorsOf(selectedId);
    setExpanded((e) => (anc.every((a) => e[a]) ? e : { ...e, ...Object.fromEntries(anc.map((a) => [a, true])) }));
  }, [selectedId]);

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  // The current preset's root; the HBCI-02 chip subtree stays reachable from both presets.
  const root = preset === 'cortical' ? COMPONENTS['cx.root'] : COMPONENTS['sys.root'];
  const shownCount = (id: string): number => 1 + childrenOf(id).reduce((a, k) => a + shownCount(k.id), 0);
  const count = shownCount(root.id) + (preset === 'cortical' ? shownCount('sys.hbci01') : 0);

  const q = query.trim().toLowerCase();
  const { filter, hits } = useMemo(() => {
    if (!q) return { filter: null, hits: null };
    const hits = new Set<string>();
    const filter = new Set<string>();
    for (const c of COMPONENT_LIST) {
      if (matches(c, q)) {
        hits.add(c.id);
        filter.add(c.id);
        for (const a of ancestorsOf(c.id)) filter.add(a);
      }
    }
    return { filter, hits };
  }, [q]);
  const hitCount = hits ? hits.size : 0;
  const rootShown = (id: string) => !filter || filter.has(id);

  return (
    <div className="tree" role="tree" aria-label="Components">
      <div className="tree-head">
        <div className="tree-head-row">
          <span className="panel-title" style={{ padding: 0 }}>
            Components <span className="faint">{count}</span>
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setExpanded(Object.fromEntries(COMPONENT_LIST.map((c) => [c.id, true])))} title="Expand every branch">
            Expand
          </button>
          <button className="btn sm" disabled={hiddenCount === 0 && !isolateId} onClick={() => useScene.getState().showAll()} title="Un-hide everything and stop isolating" data-testid="tree-show-all">
            Show all{hiddenCount ? ` (${hiddenCount})` : ''}
          </button>
        </div>
        <div className="tree-search">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
          <input
            type="search"
            value={query}
            placeholder="Search parts (name, id, kind, evidence)"
            aria-label="Search components"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); }
              if (e.key === 'Enter' && hits && hits.size > 0) {
                const first = COMPONENT_LIST.find((c) => hits.has(c.id));
                if (first) focusComponent(first);
              }
            }}
            data-testid="tree-search"
          />
          {q && <span className="tree-hits" data-testid="tree-hits">{hitCount} match{hitCount === 1 ? '' : 'es'}</span>}
        </div>
      </div>
      <div className="tree-body">
        {q && hitCount === 0 && <div className="tree-empty">No part matches “{query}”.</div>}
        {rootShown(root.id) && (
          <>
            <div className="tree-sec">{preset === 'cortical' ? 'Thin cortical candidate · CONCEPT' : 'Bench prototype'}</div>
            <Row key={root.id} c={root} depth={0} expanded={expanded} onToggle={toggle} filter={filter} hits={hits} />
          </>
        )}
        {preset === 'cortical' && rootShown('sys.hbci01') && (
          <>
            <div className="tree-sec" title="The HBCI-02 chip is shared: it stays reachable from both presets">HBCI-02 chip · shared by both presets</div>
            <Row c={COMPONENTS['sys.hbci01']} depth={0} expanded={expanded} onToggle={toggle} filter={filter} hits={hits} />
          </>
        )}
        {q && preset === 'bench' && filter && filter.has('cx.root') && (
          <>
            <div className="tree-sec">Thin cortical candidate · CONCEPT (other preset)</div>
            <Row c={COMPONENTS['cx.root']} depth={0} expanded={expanded} onToggle={toggle} filter={filter} hits={hits} />
          </>
        )}
      </div>
      <div className="tree-foot">
        <span className="tree-legend"><span className="tree-kind kind-logical">L</span> logical circuit (RTL) · <span className="tree-kind kind-physical">P</span> physical part type (concept geometry) · <span className="tree-kind kind-software">S</span> software · <span className="tree-kind kind-concept">C</span> concept</span>
        <span className="faint">Click selects · double-click inspects deeper · Enter focuses · hover highlights in 3D</span>
      </div>
    </div>
  );
}
