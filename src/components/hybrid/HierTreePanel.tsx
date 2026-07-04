import { useState } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';

function Node({ path, depth }: { path: string; depth: number }) {
  const { model, selected, select, drillDown, trace } = useHybridStore();
  const [open, setOpen] = useState(depth < 2);
  const b = model!.blocks.get(path)!;
  const isSel = selected === path;
  const name = depth === 0 ? 'top' : b.label; // root row: instance-style "top" + cell pill, like Amr's navigator
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 0', paddingLeft: depth * 14,
                    cursor: 'pointer', color: isSel ? T.blue : T.text, fontSize: 12,
                    background: isSel ? T.accentSoft : 'transparent' }}
           title={`${name} (${b.master})${b.members ? ` — array of ${b.members.length}` : b.children.length ? '' : ' — leaf block'}`}
           onClick={() => select(isSel ? null : path)}
           onDoubleClick={() => b.children.length && drillDown(path)}>
        <span style={{ width: 12, flexShrink: 0, color: T.muted, userSelect: 'none' }}
              onClick={e => { e.stopPropagation(); setOpen(!open); }}>
          {b.children.length ? (open ? '▾' : '▸') : ''}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {b.members && (
          <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, background: T.accent, color: T.bg, borderRadius: 6, padding: '0 4px', lineHeight: '11px' }}>
            ×{b.members.length}
          </span>
        )}
        {trace?.blocks.has(path) && (
          <span style={{ flexShrink: 0, fontSize: 8, background: T.conn, color: T.bg, borderRadius: 3, padding: '0 4px', fontWeight: 700 }}>●</span>
        )}
        {/* cell (master) name in a rounded pill, right-aligned — the navigator
            convention from Amr's reference (and the schematic tree's master chip) */}
        <span style={{ marginLeft: 'auto', flexShrink: 1, minWidth: 0, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap', color: T.muted, fontSize: 10, fontFamily: "'Space Mono', monospace",
                       background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '1px 7px' }}>
          {b.master}
        </span>
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
