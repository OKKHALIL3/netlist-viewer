// src/components/hybrid/PropagationPanel.tsx
import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';
import { Panel } from './HybridControls';

export function PropagationPanel() {
  const { model, trace, selected } = useHybridStore();
  if (!model || !trace || selected === null) return null;
  const levels = [...trace.byLevel.keys()].sort((a, b) => a - b);
  return (
    <div style={{ position: 'absolute', bottom: 14, right: 14, width: 260, maxHeight: '50%', overflowY: 'auto' }}>
      <Panel title={`Connected to ${model.blocks.get(selected)?.label}`}>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
          {trace.nets.length} nets · {trace.blocks.size} blocks · {trace.levelsCrossed} levels
        </div>
        {levels.map(lvl => (
          <div key={lvl} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Level {lvl}</div>
            {trace.byLevel.get(lvl)!.map(p => (
              <div key={p} style={{ fontSize: 12, color: T.text, padding: '1px 0' }}>{model.blocks.get(p)?.label ?? p}</div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
