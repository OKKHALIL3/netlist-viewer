import { useViewerStore } from '../../store/viewerStore';

export function LayoutInspector() {
  const model = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const setSelection = useViewerStore(s => s.setSelection);

  let body: React.ReactNode;
  if (!model) {
    body = <div className="insp-empty"><div className="insp-empty-icon">▦</div>Load a DSPF to build the physical map.</div>;
  } else if (!selection || selection.type === 'primitive') {
    body = <div className="insp-empty"><div className="insp-empty-icon">▦</div>Select a block or net on the canvas.</div>;
  } else if (selection.type === 'instance') {
    const i = model.instances.find(x => x.id === selection.id);
    if (!i) {
      body = <div className="insp-empty">No physical data for this block.</div>;
    } else {
      const nets = model.nets.filter(n => n.instances.includes(i.id));
      const w = i.bbox[2] - i.bbox[0], h = i.bbox[3] - i.bbox[1];
      body = (
        <div className="insp-body">
          <div className="det-h"><span className="tag inst">Instance</span><span className="ttl">{i.label}</span></div>
          <div className="det-sub">depth {i.depth}</div>
          <div className="kv"><span className="k">Devices</span><span className="v">{i.deviceCount}</span></div>
          <div className="kv"><span className="k">Width × Height</span><span className="v">{w.toFixed(2)} × {h.toFixed(2)} µm</span></div>
          <div className="sub-h">Instance bbox</div>
          <div className="bboxline">SW <b>{i.bbox[0].toFixed(2)}, {i.bbox[1].toFixed(2)}</b><br />NE <b>{i.bbox[2].toFixed(2)}, {i.bbox[3].toFixed(2)}</b></div>
          <div className="sub-h">Nets at this block ({nets.length})</div>
          <div>{nets.map(n => <span key={n.name} className="chip net" onClick={() => setSelection({ type: 'net', name: n.name })}>{n.name}</span>)}</div>
        </div>
      );
    }
  } else {
    const n = model.nets.find(x => x.name === selection.name);
    if (!n) {
      body = <div className="insp-empty">No physical data for this net.</div>;
    } else {
      const w = n.bbox[2] - n.bbox[0], h = n.bbox[3] - n.bbox[1];
      body = (
        <div className="insp-body">
          <div className="det-h"><span className="tag net">Net (PEX)</span><span className="ttl">{n.name}</span></div>
          <div className="kv"><span className="k">Subnodes</span><span className="v">{n.subnodes}</span></div>
          <div className="kv"><span className="k">Parasitics</span><span className="v">{n.parasitics}</span></div>
          <div className="kv"><span className="k">Width × Height</span><span className="v">{w.toFixed(2)} × {h.toFixed(2)} µm</span></div>
          <div className="sub-h">Net bbox</div>
          <div className="bboxline">SW <b>{n.bbox[0].toFixed(2)}, {n.bbox[1].toFixed(2)}</b><br />NE <b>{n.bbox[2].toFixed(2)}, {n.bbox[3].toFixed(2)}</b></div>
          <div className="sub-h">Metal layers</div>
          {model.layers.length === 0
            ? <div className="nolayer-note">Not available — this DSPF was extracted without layer tags.</div>
            : <div>{n.layers.map(l => <span key={l} className="chip lay">{l}</span>)}</div>}
        </div>
      );
    }
  }

  return (
    <div className="panel-right">
      <div className="insp-header"><h3 className="insp-title">Inspector</h3></div>
      {body}
    </div>
  );
}
