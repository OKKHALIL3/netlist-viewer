import { HierarchyPanel } from '../HierarchyPanel';
import { LayoutCanvas } from './LayoutCanvas';
import { DepthSelector } from './DepthSelector';
import { LayerPanel } from './LayerPanel';
import { ZoneSelect } from './ZoneSelect';
import { InsightsPanel } from './InsightsPanel';
import { LayoutInspector } from './LayoutInspector';
import { useViewerStore } from '../../store/viewerStore';

export function LayoutView() {
  const model = useViewerStore(s => s.layoutModel);
  const ext = model?.extent;
  return (
    <div className="shell">
      <HierarchyPanel />
      <div className="canvas-col">
        <div className="layout-bar">
          <ZoneSelect />
          <DepthSelector />
          <LayerPanel />
          {model && ext && (
            <span className="layout-stats">
              {model.stats.instancesMatched}/{model.stats.instancesTotal} blocks placed
              {' · '}{(ext[2] - ext[0]).toFixed(1)} × {(ext[3] - ext[1]).toFixed(1)} µm
            </span>
          )}
        </div>
        {model ? (
          <>
            <LayoutCanvas />
            <InsightsPanel />
          </>
        ) : (
          <div className="insp-empty" style={{ marginTop: 80 }}>Load a DSPF (top bar) to build the physical map.</div>
        )}
      </div>
      <LayoutInspector />
    </div>
  );
}
