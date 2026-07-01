import { useViewerStore } from '../../store/viewerStore';
import { reachRatio } from '../../layout-viewer/insights';
import { layerColor } from './layerColors';

// Total-cap display: DSPF writes Farads.
function fmtCap(f: number): string {
  return f >= 1e-12 ? `${(f * 1e12).toFixed(3)} pF` : `${(f * 1e15).toFixed(3)} fF`;
}

export function LayoutInspector() {
  const model = useViewerStore(s => s.layoutModel);
  const layoutData = useViewerStore(s => s.layoutData);
  const selection = useViewerStore(s => s.selection);
  const setSelection = useViewerStore(s => s.setSelection);

  let body: React.ReactNode;
  if (!model) {
    body = <div className="insp-empty"><div className="insp-empty-icon">▦</div>Load a DSPF to build the physical map.</div>;
  } else if (!selection || selection.type === 'primitive') {
    const d = model.diagnostics;
    const st = model.stats;
    const warnings = [...d.warnings, ...model.warnings];
    body = (
      <div className="insp-body">
        {warnings.length > 0 && (
          <div className="layout-warnbox">
            {warnings.map((w, i) => <div key={i} className="warn-note">⚠ {w}</div>)}
          </div>
        )}
        <div className="insp-empty"><div className="insp-empty-icon">▦</div>Select a block or net on the canvas.</div>
        <div className="sub-h">Parse report</div>
        {layoutData?.generator && <div className="kv"><span className="k">Extractor</span><span className="v" title={layoutData.generator}>{layoutData.generator.slice(0, 28)}</span></div>}
        <div className="kv"><span className="k">Nets</span><span className="v">{d.nets}</span></div>
        <div className="kv"><span className="k">Devices (unique)</span><span className="v">{d.devices}</span></div>
        <div className="kv"><span className="k">Device pin points</span><span className="v">{d.devicePinPoints}</span></div>
        <div className="kv"><span className="k">Resistors</span><span className="v">{d.resistors} ({d.resistorsWithGeometry} w/ geometry)</span></div>
        <div className="kv"><span className="k">Capacitors</span><span className="v">{d.capacitors} ({d.couplingCaps} coupling)</span></div>
        <div className="kv"><span className="k">Points w/ coords</span><span className="v">{d.pointsWithCoords}</span></div>
        {layoutData && layoutData.groundNets.length > 0 && (
          <div className="kv"><span className="k">Ground nets</span><span className="v">{layoutData.groundNets.map(g => `"${g}"`).join(', ')}</span></div>
        )}
        {d.unitScale !== 1 && <div className="kv"><span className="k">Units</span><span className="v">scaled ×{d.unitScale.toLocaleString()}</span></div>}
        <div className="sub-h">Correlation</div>
        <div className="kv"><span className="k">Devices matched</span><span className="v">{st.devicesMatched} / {st.devicesTotal}</span></div>
        {st.devicesDummy > 0 && <div className="kv sub"><span className="k">· layout-only (fill/dummy)</span><span className="v">{st.devicesDummy}</span></div>}
        {st.devicesTopLevel > 0 && <div className="kv sub"><span className="k">· top-level (no sub-block)</span><span className="v">{st.devicesTopLevel}</span></div>}
        {st.devicesHierMiss > 0 && <div className="kv sub"><span className="k">· path not in CDL</span><span className="v">{st.devicesHierMiss}</span></div>}
        <div className="kv"><span className="k">Blocks placed</span><span className="v">{st.instancesMatched} / {st.instancesTotal}</span></div>
        {st.physicalBlocks > 0 && <div className="kv"><span className="k">Physical-only blocks</span><span className="v">{st.physicalBlocks}</span></div>}
      </div>
    );
  } else if (selection.type === 'instance') {
    const i = model.instances.find(x => x.id === selection.id);
    if (!i) {
      body = <div className="insp-empty">No physical data for this block.</div>;
    } else {
      // A net touches this block if it reaches the block itself OR anything
      // inside it (touch resolution records the DEEPEST block per node).
      // The design root contains every net by definition — list its PORT
      // nets (the I/O at this boundary) instead of a meaningless 0 or 1524.
      const isRoot = i.id === '';
      const nets = isRoot
        ? model.nets.filter(n => n.ports > 0)
        : model.nets.filter(n =>
            n.instances.some(id => id === i.id || id.startsWith(i.id + '/')));
      const w = i.bbox[2] - i.bbox[0], h = i.bbox[3] - i.bbox[1];
      body = (
        <div className="insp-body">
          <div className="det-h"><span className="tag inst">Instance</span><span className="ttl">{i.label}</span></div>
          <div className="det-sub">{i.master ? `master ${i.master} · ` : ''}depth {i.depth}</div>
          {i.origin === 'dspf' && (
            <div className="warn-note">◇ Physical-only block — present in the DSPF but not matched to any
            CDL instance (extractor-renamed hierarchy or fill family).</div>
          )}
          <div className="kv"><span className="k">Devices</span><span className="v">{i.deviceCount}</span></div>
          <div className="kv"><span className="k">Width × Height</span><span className="v">{w.toFixed(2)} × {h.toFixed(2)} µm</span></div>
          <div className="sub-h">Instance bbox</div>
          <div className="bboxline">SW <b>{i.bbox[0].toFixed(2)}, {i.bbox[1].toFixed(2)}</b><br />NE <b>{i.bbox[2].toFixed(2)}, {i.bbox[3].toFixed(2)}</b></div>
          <div className="sub-h">{isRoot ? `Top-level (port) nets (${nets.length})` : `Nets at this block (${nets.length})`}</div>
          <div className="layout-hint">Click a net to outline how far it physically reaches.</div>
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
      const reach = reachRatio(model, n.name);
      body = (
        <div className="insp-body">
          <div className="det-h"><span className="tag net">Net (PEX)</span><span className="ttl">{n.name}</span></div>
          {n.isGround && <div className="det-sub">declared ground net (*|GROUND_NET)</div>}
          {reach >= 1.2 && (
            <div className="reach-callout">Reaches <b>{reach.toFixed(1)}×</b> the footprint of the blocks it connects.</div>
          )}
          {n.totalCap !== null && (
            <div className="kv"><span className="k">Total cap</span><span className="v">{fmtCap(n.totalCap)}</span></div>
          )}
          <div className="kv"><span className="k">Ports</span><span className="v">{n.ports}</span></div>
          <div className="kv"><span className="k">Subnodes</span><span className="v">{n.subnodes}</span></div>
          <div className="kv"><span className="k">Parasitics</span><span className="v">{n.parasitics}</span></div>
          <div className="kv"><span className="k">Width × Height</span><span className="v">{w.toFixed(2)} × {h.toFixed(2)} µm</span></div>
          <div className="sub-h">Net bbox</div>
          <div className="bboxline">SW <b>{n.bbox[0].toFixed(2)}, {n.bbox[1].toFixed(2)}</b><br />NE <b>{n.bbox[2].toFixed(2)}, {n.bbox[3].toFixed(2)}</b></div>
          <div className="sub-h">Spans blocks ({n.instances.length})</div>
          <div>{n.instances.map(id => {
            const inst = model.instances.find(x => x.id === id);
            return <span key={id} className="chip" onClick={() => setSelection({ type: 'instance', id })}>{inst?.label ?? id}</span>;
          })}</div>
          <div className="sub-h">Metal layers</div>
          {model.layers.length === 0
            ? <div className="nolayer-note">Not available — this DSPF was extracted without layer tags.</div>
            : <div>{n.layers.map(l => (
                <span key={l} className="chip lay">
                  <i className="lay-sw" style={{ background: layerColor(l) }} />{l}
                </span>
              ))}</div>}
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
