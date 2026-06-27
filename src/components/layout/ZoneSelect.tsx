import { useViewerStore } from '../../store/viewerStore';

// Quick-jump dropdown over the top-level blocks (the CDL "zones"): selecting one
// frames it on the canvas. Mirrors the brief's zone dropdown.
export function ZoneSelect() {
  const model = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const selectAndFocus = useViewerStore(s => s.selectAndFocus);
  if (!model) return null;
  const blocks = model.instances.filter(i => i.depth === 1);
  if (blocks.length === 0) return null;
  const val = selection?.type === 'instance' ? selection.id : '';
  return (
    <select className="zone-select" value={blocks.some(b => b.id === val) ? val : ''}
            onChange={e => { if (e.target.value) selectAndFocus({ type: 'instance', id: e.target.value }); }}>
      <option value="">Jump to block…</option>
      {blocks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
    </select>
  );
}
