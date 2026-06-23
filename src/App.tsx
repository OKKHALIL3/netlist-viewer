import { useViewerStore } from './store/viewerStore';
import { TopBar } from './components/TopBar';
import { HierarchyPanel } from './components/HierarchyPanel';
import { SchematicCanvas } from './components/SchematicCanvas';
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary';
import { InspectorPanel } from './components/InspectorPanel';
import { DropZone } from './components/DropZone';
import { SearchPalette } from './components/SearchPalette';
import { LayoutView } from './components/layout/LayoutView';

export default function App() {
  const { design, warnings, currentCell, appMode } = useViewerStore();

  return (
    <div className="app">
      <TopBar />
      {!design ? (
        <DropZone />
      ) : appMode === 'layout' ? (
        <LayoutView />
      ) : (
        <div className="shell">
          <HierarchyPanel />
          <div className="canvas-col">
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
