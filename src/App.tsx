import { useViewerStore } from './store/viewerStore';
import { TopBar } from './components/TopBar';
import { HierarchyPanel } from './components/HierarchyPanel';
import { SchematicCanvas } from './components/SchematicCanvas';
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary';
import { InspectorPanel } from './components/InspectorPanel';
import { PanelToggles } from './components/PanelToggles';
import { DropZone } from './components/DropZone';
import { SearchPalette } from './components/SearchPalette';
import { LayoutView } from './components/layout/LayoutView';
import { HybridViewer } from './components/hybrid/HybridViewer';

export default function App() {
  const { design, warnings, currentCell, appMode } = useViewerStore();
  const leftPanelOpen = useViewerStore(s => s.leftPanelOpen);
  const rightPanelOpen = useViewerStore(s => s.rightPanelOpen);
  const shellClass = `shell${leftPanelOpen ? '' : ' left-collapsed'}${rightPanelOpen ? '' : ' right-collapsed'}`;

  return (
    <div className="app">
      <TopBar />
      {!design ? (
        <DropZone />
      ) : appMode === 'layout' ? (
        <LayoutView />
      ) : appMode === 'hybrid' ? (
        <CanvasErrorBoundary resetKey={design.topCell}>
          <HybridViewer />
        </CanvasErrorBoundary>
      ) : (
        <div className={shellClass}>
          <HierarchyPanel />
          <div className="canvas-col">
            <PanelToggles />
            <CanvasErrorBoundary resetKey={currentCell}>
              <SchematicCanvas />
            </CanvasErrorBoundary>
          </div>
          <InspectorPanel />
        </div>
      )}
      <SearchPalette />
      {warnings.length > 0 && (
        <details className="warnings-bar">
          <summary>{warnings.length} parse warning{warnings.length !== 1 ? 's' : ''}</summary>
          <ul>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
