import { useViewerStore } from '../../store/viewerStore';
import { rankBySprawl } from '../../layout-viewer/insights';

// Floating card that auto-surfaces the nets whose physical extent dwarfs the
// blocks they connect — the "where are my problems" view. Click one to frame it.
export function InsightsPanel() {
  const model = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const selectAndFocus = useViewerStore(s => s.selectAndFocus);
  if (!model) return null;
  const top = rankBySprawl(model, 8);
  if (top.length === 0) return null;
  return (
    <div className="insights-panel">
      <div className="insights-title">Most sprawling nets</div>
      <div className="insights-sub">net extent ÷ block footprint</div>
      <div className="insights-list">
        {top.map(t => {
          const active = selection?.type === 'net' && selection.name === t.name;
          return (
            <button key={t.name} className={`insight-row${active ? ' active' : ''}`}
                    onClick={() => selectAndFocus({ type: 'net', name: t.name })}>
              <span className="insight-name" title={t.name}>{t.name}</span>
              <span className="insight-metric">{t.reach >= 1 ? `${t.reach.toFixed(1)}×` : '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
