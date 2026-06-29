import { HierarchyPanel } from '../HierarchyPanel';
import { PanelToggles } from '../PanelToggles';
import { LayoutCanvas } from './LayoutCanvas';
import { DepthSelector } from './DepthSelector';
import { LayerPanel } from './LayerPanel';
import { ZoneSelect } from './ZoneSelect';
import { InsightsPanel } from './InsightsPanel';
import { LayoutInspector } from './LayoutInspector';
import { useViewerStore } from '../../store/viewerStore';

export function LayoutView() {
  const model = useViewerStore(s => s.layoutModel);
  const leftPanelOpen = useViewerStore(s => s.leftPanelOpen);
  const rightPanelOpen = useViewerStore(s => s.rightPanelOpen);
  const ext = model?.extent;
  const shellClass = `shell${leftPanelOpen ? '' : ' left-collapsed'}${rightPanelOpen ? '' : ' right-collapsed'}`;
  return (
    <div className={shellClass}>
      <HierarchyPanel />
      <div className="canvas-col">
        <PanelToggles />
        <div className="layout-bar">
          <ZoneSelect />
          <DepthSelector />
          <LayerPanel />
          {model && ext && (() => {
            const warnings = [...model.diagnostics.warnings, ...model.warnings];
            return (
              <div className="layout-bar-right">
                {warnings.length > 0 && (
                  <span className="layout-warn" title={warnings.join('\n')}>
                    ⚠ {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                  </span>
                )}
                <span className="layout-stats">
                  {model.stats.instancesMatched}/{model.stats.instancesTotal} blocks placed
                  {' · '}{(ext[2] - ext[0]).toFixed(1)} × {(ext[3] - ext[1]).toFixed(1)} µm
                </span>
              </div>
            );
          })()}
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
