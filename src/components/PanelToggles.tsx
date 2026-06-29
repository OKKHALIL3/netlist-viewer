import { useViewerStore } from '../store/viewerStore';

// Edge handles pinned to the canvas's left/right borders that collapse or
// reveal the hierarchy (left) and inspector (right) side panels. Rendered
// inside `.canvas-col` (position: relative) so they sit on the panel seams.
export function PanelToggles() {
  const leftOpen = useViewerStore(s => s.leftPanelOpen);
  const rightOpen = useViewerStore(s => s.rightPanelOpen);
  const toggleLeft = useViewerStore(s => s.toggleLeftPanel);
  const toggleRight = useViewerStore(s => s.toggleRightPanel);
  return (
    <>
      <button
        className="panel-toggle left"
        onClick={toggleLeft}
        title={leftOpen ? 'Collapse hierarchy panel' : 'Show hierarchy panel'}
        aria-label={leftOpen ? 'Collapse hierarchy panel' : 'Show hierarchy panel'}
      >
        {leftOpen ? '‹' : '›'}
      </button>
      <button
        className="panel-toggle right"
        onClick={toggleRight}
        title={rightOpen ? 'Collapse inspector' : 'Show inspector'}
        aria-label={rightOpen ? 'Collapse inspector' : 'Show inspector'}
      >
        {rightOpen ? '›' : '‹'}
      </button>
    </>
  );
}
