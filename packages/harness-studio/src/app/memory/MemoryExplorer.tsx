import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CaretRight } from '@phosphor-icons/react/CaretRight';
import { Folder } from '@phosphor-icons/react/Folder';
import { FileText } from '@phosphor-icons/react/FileText';
import { filterMemoryTree, flattenMemoryTree, memoryEditorKey, memoryTreeAncestors, type MemoryTreeNode } from './tree-model.js';

export function MemoryExplorer({ nodes, query, activeKey, initialView, onOpen, label }: { nodes: MemoryTreeNode[]; query: string; activeKey?: string; initialView: string; onOpen: (item: NonNullable<MemoryTreeNode['item']>) => void; label: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(() => new Set([initialView]));
  const [focused, setFocused] = useState<string>();
  const scroll = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => filterMemoryTree(nodes, query), [nodes, query]);
  const rows = useMemo(() => flattenMemoryTree(filtered, expanded, !!query), [filtered, expanded, query]);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 34, overscan: 8 });
  const virtualized = rows.length > 50;
  const visible = virtualized ? virtual.getVirtualItems().map(item => ({ index: item.index, offset: item.start })) : rows.map((_, index) => ({ index, offset: 0 }));
  useEffect(() => { if (activeKey) { const ancestors = memoryTreeAncestors(nodes, activeKey); if (ancestors) setExpanded(current => new Set([...current, ...ancestors])); } }, [nodes, activeKey]);
  function focus(index: number): void {
    const row = rows[index]; if (!row) return;
    setFocused(row.node.id);
    if (virtualized) virtual.scrollToIndex(index);
    requestAnimationFrame(() => scroll.current?.querySelector<HTMLButtonElement>(`[data-tree-index="${index}"]`)?.focus());
  }
  function toggle(id: string, open?: boolean): void { setExpanded(current => { const next = new Set(current); (open ?? !next.has(id)) ? next.add(id) : next.delete(id); return next; }); }
  return <div ref={scroll} className="memory-tree-scroll" role="tree" aria-label={label}>
    <div className={virtualized ? 'memory-virtual-list' : undefined} style={virtualized ? { height: virtual.getTotalSize() } : undefined}>
      {visible.map(({ index, offset }) => { const row = rows[index]!, node = row.node, folder = node.children !== undefined, open = !!query || expanded.has(node.id), selected = !!node.item && memoryEditorKey(node.item.row.document.id, node.item.row.entry?.id) === activeKey;
        return <button key={node.id} className="memory-tree-row" data-tree-index={index} data-index={index} ref={virtualized ? virtual.measureElement : undefined} type="button" role="treeitem" aria-label={node.label} aria-level={row.level} aria-posinset={row.position} aria-setsize={row.size} aria-expanded={folder ? open : undefined} aria-selected={folder ? undefined : selected} tabIndex={focused === node.id || (!rows.some(item => item.node.id === focused) && index === 0) ? 0 : -1} title={node.title ?? node.label} style={{ paddingInlineStart: `calc(var(--space-sm) + ${(row.level - 1)} * var(--space-lg))`, ...(virtualized ? { position: 'absolute', width: '100%', transform: `translateY(${offset}px)` } : {}) }} onFocus={() => setFocused(node.id)} onClick={() => folder ? toggle(node.id) : node.item && onOpen(node.item)} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focus(Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
          else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focus(event.key === 'Home' ? 0 : rows.length - 1); }
          else if (event.key === 'ArrowRight' && folder) { event.preventDefault(); open ? focus(index + 1) : toggle(node.id, true); }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); if (folder && open) toggle(node.id, false); else if (row.parent) focus(rows.findIndex(value => value.node.id === row.parent)); }
        }}>{folder ? <><CaretRight className={open ? 'is-open' : undefined} size={11} aria-hidden="true" /><Folder size={15} aria-hidden="true" /></> : <><span className="memory-tree-indent" /><FileText size={15} aria-hidden="true" /></>}<span className="memory-tree-label">{node.label}</span></button>;
      })}
    </div>
  </div>;
}
