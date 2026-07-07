// src/components/hybrid/PropagationPanel.tsx
import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';
import { Panel } from './HybridControls';

const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function PropagationPanel() {
  const { model, trace, selected, jumpToPath } = useHybridStore();
  if (!model || !trace || selected === null) return null;
  const selBlock = model.blocks.get(selected);
  if (!selBlock || selBlock.parent === null) return null; // the top cell has no outside to connect to
  return (
    // Sits in the right overlay rail (HybridViewer) — shrinks + scrolls internally.
    <div style={{ flex: '0 1 auto', minHeight: 96, pointerEvents: 'auto', overflowY: 'auto' }}>
      <Panel title="Connected to" subject={selBlock.label}>
        <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, marginBottom: 6 }}>
          {pl(trace.blocks.size, 'neighbor')} · {pl(trace.nets.length, 'net')}
        </div>
        {trace.blocks.size === 0 && (
          <div style={{ fontSize: 11, color: T.faint }}>No device-connected blocks (supplies excluded).</div>
        )}
        {/* Grouped by the shared net, not by tree depth — each group is one
            electrical node the selection's devices share with these blocks. */}
        {trace.nets.map(sn => (
          <div key={sn.name} style={{ marginBottom: 7 }}>
            <div title={sn.name}
                 style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, color: T.conn,
                          display: 'flex', alignItems: 'center', gap: 5,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: T.conn, flex: '0 0 auto' }} />
              {sn.name}
            </div>
            {sn.blocks.map(p => (
              <div key={p} title={p || model.blocks.get(p)?.label}
                   onClick={() => jumpToPath(p)}
                   style={{ fontFamily: T.mono, fontSize: 11.5, color: T.text, padding: '1px 0 1px 11px', cursor: 'pointer',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                   onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.accent; }}
                   onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.text; }}>
                {model.blocks.get(p)?.label ?? p}
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
