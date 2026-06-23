import { useViewerStore } from '../../store/viewerStore';

const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
};

export function LayerPanel() {
  const model = useViewerStore(s => s.layoutModel);
  const vis = useViewerStore(s => s.layerVisibility);
  const toggle = useViewerStore(s => s.toggleLayer);
  if (!model || model.layers.length === 0) return null; // graceful no-layer degradation
  return (
    <div className="layer-chips">
      {model.layers.map(l => (
        <button key={l} className={`layer-chip${vis[l] ? '' : ' off'}`} onClick={() => toggle(l)}>
          <span className="layer-sw" style={{ background: LAYER_COLOR[l] ?? '#6b7689' }} />{l}
        </button>
      ))}
    </div>
  );
}
