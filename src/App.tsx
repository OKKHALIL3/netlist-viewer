import { useViewerStore } from './store/viewerStore';
import { TopBar } from './components/TopBar';
import { HierarchyPanel } from './components/HierarchyPanel';
import { SchematicCanvas } from './components/SchematicCanvas';
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary';
import { InspectorPanel } from './components/InspectorPanel';
import { PanelToggles } from './components/PanelToggles';
import { Landing } from './components/Landing';
import { SearchPalette } from './components/SearchPalette';
import { LayoutView } from './components/layout/LayoutView';
import { HybridViewer } from './components/hybrid/HybridViewer';
import { ChatPanel } from './components/chat/ChatPanel';
import { CHAT_ENABLED, HYBRID_ENABLED, LAYOUT_ENABLED } from './flags';

export default function App() {
  const { design, warnings, currentCell, appMode, landing } = useViewerStore();
  const leftPanelOpen = useViewerStore(s => s.leftPanelOpen);
  const rightPanelOpen = useViewerStore(s => s.rightPanelOpen);
  const shellClass = `shell${leftPanelOpen ? '' : ' left-collapsed'}${rightPanelOpen ? '' : ' right-collapsed'}`;

  // The landing page owns the whole frame (it has its own header) until the
  // user opens a viewer from it.
  if (landing || !design) {
    return (
      <div className="app">
        <Landing />
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

  return (
    <div className="app">
      <TopBar />
      {LAYOUT_ENABLED && appMode === 'layout' ? (
        <LayoutView />
      ) : HYBRID_ENABLED && appMode === 'hybrid' ? (
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
      {CHAT_ENABLED && <ChatPanel />}
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
