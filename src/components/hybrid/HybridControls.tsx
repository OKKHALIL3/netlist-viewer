import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, borderRadius: 12, padding: '12px 14px', marginBottom: 12, border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.teal, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function HybridControls() {
  const { model, rootPath, depth, setDepth } = useHybridStore();
  if (!model) return null;
  const maxBelow = model.maxDepth - model.blocks.get(rootPath)!.depth;
  return (
    <div style={{ width: 244, padding: 12, overflowY: 'auto', borderRight: `1px solid ${T.border}`, background: T.bg }}>
      <Panel title="Hier depth">
        <input type="range" min={0} max={Math.max(1, maxBelow)} value={Math.min(depth, maxBelow)}
               onChange={e => setDepth(+e.target.value)} style={{ width: '100%', accentColor: T.blue }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.muted }}>
          <span>Top only</span><span>All levels</span>
        </div>
      </Panel>
    </div>
  );
}
