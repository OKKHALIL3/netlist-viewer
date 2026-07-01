import { useViewerStore } from '../../store/viewerStore';

import { layerColor } from './layerColors';

export function LayerPanel() {
  const model = useViewerStore(s => s.layoutModel);
  const vis = useViewerStore(s => s.layerVisibility);
  const toggle = useViewerStore(s => s.toggleLayer);
  if (!model || model.layers.length === 0) return null; // graceful no-layer degradation
  return (
    <div className="layer-chips">
      {model.layers.map(l => (
        <button key={l} className={`layer-chip${vis[l] ? '' : ' off'}`} onClick={() => toggle(l)}>
          <span className="layer-sw" style={{ background: layerColor(l) }} />{l}
        </button>
      ))}
    </div>
  );
}
