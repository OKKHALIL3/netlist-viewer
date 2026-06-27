import { useViewerStore, type LayoutDepth } from '../../store/viewerStore';

const OPTS: Array<{ v: LayoutDepth; label: string }> = [
  { v: 0, label: '0' }, { v: 1, label: '1' }, { v: 2, label: '2' }, { v: 'all', label: 'All' },
];

export function DepthSelector() {
  const depth = useViewerStore(s => s.layoutDepth);
  const setDepth = useViewerStore(s => s.setLayoutDepth);
  return (
    <div className="depth-row">
      <span className="depth-label">Depth</span>
      {OPTS.map(o => (
        <button key={String(o.v)} className={depth === o.v ? 'on' : ''} onClick={() => setDepth(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}
