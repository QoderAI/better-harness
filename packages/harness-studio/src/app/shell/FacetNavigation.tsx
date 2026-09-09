import { useId, useRef, useState, type ReactNode } from 'react';

export interface FacetGroup {
  id: string;
  label: string;
  items: { id: string; label: string; current: boolean; count?: number; status?: string; icon?: ReactNode; onSelect: () => void }[];
}

/** One Tab stop across filter groups; arrows move focus, Enter/Space applies. */
export function FacetNavigation({ groups, label, className = '' }: { groups: FacetGroup[]; label: string; className?: string }): React.JSX.Element {
  const prefix = useId();
  const rows = groups.flatMap(group => group.items);
  const [focused, setFocused] = useState('');
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const tabStop = rows.some(row => row.id === focused) ? focused : (rows.find(row => row.current) ?? rows[0])?.id;
  return <nav className={`studio-facet-nav ${className}`} aria-label={label} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || rows.length === 0) return;
    event.preventDefault();
    const current = Math.max(0, rows.findIndex(row => row.id === tabStop));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
    const id = rows[next]!.id;
    setFocused(id); refs.current.get(id)?.focus();
  }}>
    {groups.map(group => <section key={group.id} aria-labelledby={`${prefix}-${group.id}`}>
      <h2 id={`${prefix}-${group.id}`}>{group.label}</h2>
      {group.items.map(row => <button key={row.id} type="button"
        ref={node => { if (node) refs.current.set(row.id, node); else refs.current.delete(row.id); }}
        tabIndex={tabStop === row.id ? 0 : -1} aria-current={row.current ? 'true' : undefined}
        onFocus={() => setFocused(row.id)} onClick={() => { setFocused(row.id); row.onSelect(); }}>
        {row.icon}<span>{row.label}</span>
        {row.status !== undefined ? <small className="studio-facet-status">{row.status}</small> : row.count !== undefined && <small>{row.count}</small>}
      </button>)}
    </section>)}
  </nav>;
}
