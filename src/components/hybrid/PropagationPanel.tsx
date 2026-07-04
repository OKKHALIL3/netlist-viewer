// src/components/hybrid/PropagationPanel.tsx
import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';
import { Panel } from './HybridControls';

const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function PropagationPanel() {
  const { model, trace, selected, rootPath, jumpToPath } = useHybridStore();
  if (!model || !trace || selected === null) return null;
  const selBlock = model.blocks.get(selected);
  if (!selBlock || selBlock.parent === null) return null; // the top cell has no outside to connect to
  const rootDepth = model.blocks.get(rootPath)?.depth ?? 0;
  const levels = [...trace.byLevel.keys()].sort((a, b) => a - b);
  return (
    // Sits in the right overlay rail (HybridViewer) — shrinks + scrolls internally.
    <div style={{ flex: '0 1 auto', minHeight: 96, pointerEvents: 'auto', overflowY: 'auto' }}>
      <Panel title="Connected to" subject={selBlock.label}>
        <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, marginBottom: 6 }}>
          {pl(trace.nets.length, 'net')} · {pl(trace.blocks.size, 'block')} · {pl(trace.levelsCrossed, 'level')}
        </div>
        {trace.blocks.size === 0 && (
          <div style={{ fontSize: 11, color: T.faint }}>No connected signal blocks (supplies excluded).</div>
        )}
        {levels.map(lvl => (
          <div key={lvl} style={{ marginBottom: 6 }}>
            {/* levels shown relative to the current root, matching the rails */}
            <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.8px', color: T.faint, textTransform: 'uppercase' }}>
              Level {lvl - rootDepth >= 0 ? lvl - rootDepth : lvl}
            </div>
            {trace.byLevel.get(lvl)!.map(p => (
              <div key={p} title={p || model.blocks.get(p)?.label}
                   onClick={() => jumpToPath(p)}
                   style={{ fontFamily: T.mono, fontSize: 11.5, color: T.text, padding: '1px 0', cursor: 'pointer',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                   onMouseEnter={e => { (e.target as HTMLElement).style.color = T.accent; }}
                   onMouseLeave={e => { (e.target as HTMLElement).style.color = T.text; }}>
                {model.blocks.get(p)?.label ?? p}
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
