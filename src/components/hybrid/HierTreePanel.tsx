import { useState } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';

function Node({ path, depth }: { path: string; depth: number }) {
  const { model, selected, select, drillDown, toggleGroup, trace } = useHybridStore();
  const [open, setOpen] = useState(depth < 2);
  const b = model!.blocks.get(path)!;
  const isSel = selected === path;
  const name = depth === 0 ? 'top' : b.label; // root row: instance-style "top" + cell pill, same as the schematic navigator
  return (
    <div>
      {/* Same row classes as the schematic hierarchy tree (.tree-row/.tree-chev/
          .tree-id/.tree-master) so hover, selection, and type treatment match. */}
      <div className={`tree-row${isSel ? ' active' : ''}`}
           style={{ paddingLeft: 8 + depth * 14 }}
           title={`${name} (${b.master})${b.members ? ` — array of ${b.members.length}` : b.children.length ? '' : ' — leaf block'}`}
           onClick={() => select(isSel ? null : path)}
           onDoubleClick={() => b.children.length && drillDown(path)}>
        <span className="tree-chev" onClick={e => { e.stopPropagation(); setOpen(!open); }}>
          {b.children.length ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="tree-id" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {b.members && (
          // clickable, same as the canvas chip: pop the array open into members
          <span title={`expand ${b.members.length} array elements`}
                onClick={e => { e.stopPropagation(); toggleGroup(path); }}
                onDoubleClick={e => e.stopPropagation()}
                style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, background: T.accent, color: T.bg, borderRadius: 6, padding: '0 4px', lineHeight: '11px', cursor: 'pointer' }}>
            ×{b.members.length}
          </span>
        )}
        {b.groupOf && model!.blocks.get(b.groupOf)?.expanded && (
          // expanded array member: outline chip folds the family back
          <span title={`collapse back to ${model!.blocks.get(b.groupOf)!.label} (×${model!.blocks.get(b.groupOf)!.members!.length})`}
                onClick={e => { e.stopPropagation(); toggleGroup(b.groupOf!); }}
                onDoubleClick={e => e.stopPropagation()}
                style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, color: T.accent, border: `1px solid ${T.accent}`, borderRadius: 6, padding: '0 4px', lineHeight: '9px', cursor: 'pointer' }}>
            ×
          </span>
        )}
        {trace?.blocks.has(path) && (
          <span style={{ flexShrink: 0, fontSize: 8, background: T.conn, color: T.bg, borderRadius: 3, padding: '0 4px', fontWeight: 700 }}>●</span>
        )}
        {/* cell (master) name pill — same convention as the schematic navigator */}
        <span className="tree-master">{b.master}</span>
      </div>
      {open && b.children.map(c => <Node key={c} path={c} depth={depth + 1} />)}
    </div>
  );
}

export function HierTreePanel() {
  const model = useHybridStore(s => s.model);
  if (!model) return null;
  return (
    <div style={{ width: 232, overflowY: 'auto', borderRight: `1px solid ${T.border}`, padding: '10px 8px', background: T.panel }}>
      {/* .panel-head h3 convention: 11px uppercase, 1.3px tracking, dim, 600 */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.3px', textTransform: 'uppercase', color: T.muted, margin: '0 0 8px 8px' }}>
        Hierarchy
      </div>
      <Node path="" depth={0} />
    </div>
  );
}
