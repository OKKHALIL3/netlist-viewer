import { useViewerStore } from './store/viewerStore';
import { TopBar } from './components/TopBar';
import { HierarchyPanel } from './components/HierarchyPanel';
import { SchematicCanvas } from './components/SchematicCanvas';
import { InspectorPanel } from './components/InspectorPanel';
import { DropZone } from './components/DropZone';
import { SearchPalette } from './components/SearchPalette';

export default function App() {
  const { design, warnings } = useViewerStore();

  return (
    <div className="app">
      <TopBar />
      {!design ? (
        <DropZone />
      ) : (
        <div className="shell">
          <HierarchyPanel />
          <div className="canvas-col">
            <SchematicCanvas />
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
