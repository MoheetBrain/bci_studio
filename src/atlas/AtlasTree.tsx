// Search (name + synonyms) and the expandable anatomical tree. The tree mirrors the source hierarchy exactly.
// Keyboard: ↑/↓ move, → expand, ← collapse / go to parent, Enter or Space select. Focusing a row highlights the
// structure in 3D — the keyboard equivalent of hovering.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlas } from './atlasStore';
import { searchAtlas } from './search';
import type { TreeNode } from './types';

interface Row { id: string; depth: number; node: TreeNode; expanded: boolean; hasChildren: boolean }

export function AtlasSearch({ onPicked }: { onPicked?: () => void }) {
  const tree = useAtlas((s) => s.tree);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchAtlas(q, tree.values()), [q, tree]);
  const st = useAtlas.getState();
  const pick = (id: string) => {
    st.select(id);
    st.camera({ kind: 'fit', ids: st.idsOf(id) });
    st.hover(null);
    setQ('');
    onPicked?.();
  };
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (hits[active]) useAtlas.getState().hover(hits[active].id, 'tree'); else if (q) useAtlas.getState().hover(null);
  }, [active, hits, q]);

  return (
    <div className="atlas-search" role="search">
      <input
        type="search"
        value={q}
        placeholder="Search structures (e.g. motor, hippocampus, M1)"
        aria-label="Search atlas structures by name or synonym"
        aria-controls="atlas-search-results"
        aria-expanded={hits.length > 0}
        role="combobox"
        aria-autocomplete="list"
        aria-activedescendant={hits[active] ? `hit-${hits[active].id}` : undefined}
        data-testid="atlas-search"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(hits.length - 1, a + 1)); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
          else if (e.key === 'Enter' && hits[active]) { pick(hits[active].id); e.preventDefault(); }
          else if (e.key === 'Escape') { setQ(''); useAtlas.getState().hover(null); e.stopPropagation(); }
        }}
      />
      {q && (
        <ul id="atlas-search-results" className="atlas-hits" role="listbox" aria-label="Search results" data-testid="atlas-search-results">
          {hits.length === 0 && <li className="atlas-hit-none" role="option" aria-selected="false">No structure in this atlas matches “{q}”.</li>}
          {hits.map((h, i) => (
            <li
              key={h.id}
              id={`hit-${h.id}`}
              role="option"
              aria-selected={i === active}
              className={`atlas-hit${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(h.id); }}
              data-id={h.id}
            >
              <span className="hit-name">{h.name}</span>
              {h.kind === 'group' && <span className="hit-kind">group</span>}
              {h.via && <span className="hit-via">matches “{h.via}”{h.note ? ` — ${h.note}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AtlasTree() {
  const tree = useAtlas((s) => s.tree);
  const rootId = useAtlas((s) => s.rootId);
  const selectedId = useAtlas((s) => s.selectedId);
  const vis = useAtlas((s) => s.vis);
  const members = useAtlas((s) => s.members);
  const [open, setOpen] = useState<Set<string>>(() => new Set([rootId, 'prosencephalon', 'telencephalon']));
  const [focusId, setFocusId] = useState<string>(rootId);
  const list = useRef<HTMLUListElement | null>(null);

  // Reveal the selection in the tree.
  useEffect(() => {
    if (!selectedId) return;
    const next = new Set(open);
    let n = tree.get(selectedId);
    let changed = false;
    while (n?.parentId) { if (!next.has(n.parentId)) { next.add(n.parentId); changed = true; } n = tree.get(n.parentId); }
    if (changed) setOpen(next);
    setFocusId(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tree]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (id: string, depth: number) => {
      const node = tree.get(id);
      if (!node) return;
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && open.has(id);
      out.push({ id, depth, node, expanded, hasChildren });
      if (expanded) for (const c of node.children) walk(c, depth + 1);
    };
    walk(rootId, 0);
    return out;
  }, [tree, rootId, open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusId, rows]);

  const st = useAtlas.getState();
  const toggle = (id: string, to?: boolean) => setOpen((o) => {
    const n = new Set(o);
    if (to ?? !n.has(id)) n.add(id); else n.delete(id);
    return n;
  });
  const focusRow = (id: string) => {
    setFocusId(id);
    st.hover(id, 'tree');
    // Move DOM focus at once when the row is already rendered, so a key pressed immediately afterwards acts on it;
    // a row that only appears after expanding its parent is focused on the next frame.
    const el = list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (el) el.focus();
    else requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
  };
  const onKey = (e: React.KeyboardEvent, row: Row) => {
    const i = rows.findIndex((r) => r.id === row.id);
    if (e.key === 'ArrowDown' && rows[i + 1]) focusRow(rows[i + 1].id);
    else if (e.key === 'ArrowUp' && rows[i - 1]) focusRow(rows[i - 1].id);
    else if (e.key === 'ArrowRight') { if (row.hasChildren && !row.expanded) toggle(row.id, true); else if (row.expanded) focusRow(row.node.children[0]); }
    else if (e.key === 'ArrowLeft') { if (row.expanded) toggle(row.id, false); else if (row.node.parentId) focusRow(row.node.parentId); }
    else if (e.key === 'Enter' || e.key === ' ') { st.select(row.id); st.camera({ kind: 'fit', ids: st.idsOf(row.id) }); }
    else if (e.key === 'Home') focusRow(rows[0].id);
    else if (e.key === 'End') focusRow(rows[rows.length - 1].id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <ul ref={list} className="atlas-tree" role="tree" aria-label="Anatomical hierarchy (from the source atlas)" data-testid="atlas-tree" onMouseLeave={() => st.hover(null)}>
      {rows.map((row) => {
        const ids = members.get(row.id) ?? [row.id];
        const hidden = ids.length > 0 && ids.every((id) => vis[id] === 'hidden');
        return (
          <li
            key={row.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={selectedId === row.id}
            tabIndex={focusId === row.id ? 0 : -1}
            data-id={row.id}
            className={`tree-row${selectedId === row.id ? ' selected' : ''}${hidden ? ' is-hidden' : ''}`}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            onKeyDown={(e) => onKey(e, row)}
            onFocus={() => { setFocusId(row.id); st.hover(row.id, 'tree'); }}
            onMouseEnter={() => st.hover(row.id, 'tree')}
            onClick={() => { st.select(row.id); setFocusId(row.id); }}
            onDoubleClick={() => st.camera({ kind: 'fit', ids })}
          >
            <span
              className={`tree-caret${row.hasChildren ? '' : ' leaf'}`}
              aria-hidden="true"
              onClick={(e) => { if (row.hasChildren) { e.stopPropagation(); toggle(row.id); } }}
            >{row.hasChildren ? (row.expanded ? '▾' : '▸') : '·'}</span>
            <span className="tree-name">{row.node.name}</span>
            {row.hasChildren && <span className="tree-count">{ids.length}</span>}
            <button
              type="button"
              className="tree-eye"
              tabIndex={-1}
              aria-label={`${hidden ? 'Show' : 'Hide'} ${row.node.name}`}
              title={hidden ? 'Show' : 'Hide'}
              onClick={(e) => { e.stopPropagation(); st.setVis(ids, hidden ? undefined : 'hidden'); }}
            >{hidden ? '○' : '●'}</button>
          </li>
        );
      })}
    </ul>
  );
}
