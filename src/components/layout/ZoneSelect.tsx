import { useViewerStore } from '../../store/viewerStore';

// The brief's zone dropdown: CDL-driven top-level blocks; selecting one
// frames its block extent (and, via the canvas, the net extents around it).
export function ZoneSelect() {
  const model = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const selectAndFocus = useViewerStore(s => s.selectAndFocus);
  if (!model) return null;
  const blocks = model.instances.filter(i => i.depth === 1 && i.origin === 'cdl');
  if (blocks.length === 0) return null;
  const val = selection?.type === 'instance' ? selection.id : '';
  return (
    <select className="zone-select" value={blocks.some(b => b.id === val) ? val : ''}
            onChange={e => { if (e.target.value) selectAndFocus({ type: 'instance', id: e.target.value }); }}>
      <option value="">Zone (from CDL)…</option>
      {blocks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
    </select>
  );
}
