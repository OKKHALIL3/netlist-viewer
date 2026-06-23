import { HierarchyPanel } from '../HierarchyPanel';
import { LayoutCanvas } from './LayoutCanvas';
import { DepthSelector } from './DepthSelector';
import { LayerPanel } from './LayerPanel';
import { LayoutInspector } from './LayoutInspector';
import { useViewerStore } from '../../store/viewerStore';

export function LayoutView() {
  const model = useViewerStore(s => s.layoutModel);
  return (
    <div className="shell">
      <HierarchyPanel />
      <div className="canvas-col">
        <div className="layout-bar">
          <DepthSelector />
          <LayerPanel />
          {model && (
            <span className="layout-stats">
              {model.stats.instancesMatched}/{model.stats.instancesTotal} blocks placed
            </span>
          )}
        </div>
        {model
          ? <LayoutCanvas />
          : <div className="insp-empty" style={{ marginTop: 80 }}>Load a DSPF (top bar) to build the physical map.</div>}
      </div>
      <LayoutInspector />
    </div>
  );
}
