import { useState } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';

function Node({ path, depth }: { path: string; depth: number }) {
  const { model, selected, select, drillDown, trace } = useHybridStore();
  const [open, setOpen] = useState(depth < 2);
  const b = model!.blocks.get(path)!;
  const isSel = selected === path;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0 2px', paddingLeft: depth * 14,
                    cursor: 'pointer', color: isSel ? T.blue : T.text, fontSize: 12,
                    background: isSel ? T.accentSoft : 'transparent' }}
           title={b.children.length ? undefined : 'Leaf block'}
           onClick={() => select(isSel ? null : path)}
           onDoubleClick={() => b.children.length && drillDown(path)}>
        <span style={{ width: 12, color: T.muted, userSelect: 'none' }}
              onClick={e => { e.stopPropagation(); setOpen(!open); }}>
          {b.children.length ? (open ? '▾' : '▸') : ''}
        </span>
        <span>{b.label}</span>
        <span style={{ color: T.muted, fontSize: 10 }}>{b.devices}</span>
        {trace?.blocks.has(path) && (
          <span style={{ fontSize: 8, background: T.conn, color: T.bg, borderRadius: 3, padding: '0 4px', fontWeight: 700 }}>●</span>
        )}
      </div>
      {open && b.children.map(c => <Node key={c} path={c} depth={depth + 1} />)}
    </div>
  );
}

export function HierTreePanel() {
  const model = useHybridStore(s => s.model);
  if (!model) return null;
  return (
    <div style={{ width: 220, overflowY: 'auto', borderRight: `1px solid ${T.border}`, padding: 8, background: T.panel }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
        Hierarchy
      </div>
      <Node path="" depth={0} />
    </div>
  );
}
