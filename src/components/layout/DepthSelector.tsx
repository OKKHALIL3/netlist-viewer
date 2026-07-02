import { useMemo } from 'react';
import { useViewerStore } from '../../store/viewerStore';

// Depth buttons span the DESIGN's actual hierarchy — 0..maxDepth, then All —
// not a hard-coded 0/1/2. The Focus toggle isolates the selected block's
// branch (everything off-branch is hidden, its whole subtree is shown).
export function DepthSelector() {
  const depth = useViewerStore(s => s.layoutDepth);
  const setDepth = useViewerStore(s => s.setLayoutDepth);
  const model = useViewerStore(s => s.layoutModel);
  const focusMode = useViewerStore(s => s.focusMode);
  const toggleFocusMode = useViewerStore(s => s.toggleFocusMode);

  const maxDepth = useMemo(
    () => (model ? model.instances.reduce((m, i) => Math.max(m, i.depth), 0) : 2),
    [model],
  );
  const levels = useMemo(() => Array.from({ length: maxDepth + 1 }, (_, i) => i), [maxDepth]);

  return (
    <div className="depth-row">
      <span className="depth-label">Depth</span>
      {levels.map(v => (
        <button key={v} className={depth === v ? 'on' : ''} onClick={() => setDepth(v)}>{v}</button>
      ))}
      <button className={depth === 'all' ? 'on' : ''} onClick={() => setDepth('all')}>All</button>
      <button
        className={`focus-btn${focusMode ? ' on' : ''}`}
        onClick={toggleFocusMode}
        title="Focus mode: selecting a block hides everything off its branch and shows its whole subtree"
      >
        ⌖ Focus
      </button>
    </div>
  );
}
