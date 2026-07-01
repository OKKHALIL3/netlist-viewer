import { useViewerStore } from '../../store/viewerStore';

import { layerColor } from './layerColors';

export function LayerPanel() {
  const model = useViewerStore(s => s.layoutModel);
  const vis = useViewerStore(s => s.layerVisibility);
  const toggle = useViewerStore(s => s.toggleLayer);
  if (!model) return null;
  // Graceful no-layer degradation — but SAY so (the mockup's disabled panel):
  // whether a DSPF carries layer tags depends entirely on extraction options.
  if (model.layers.length === 0) {
    return (
      <div className="layer-chips disabled"
           title="Whether a DSPF carries metal-layer tags depends on the extraction options used to generate it. This file has none — connections draw in a neutral color.">
        <span className="layer-note">layers: not in this DSPF</span>
      </div>
    );
  }
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
