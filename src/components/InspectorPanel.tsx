import { useState } from 'react';
import { useViewerStore } from '../store/viewerStore';

function EmptyState() {
  return (
    <div className="insp-empty">
      <div className="insp-empty-icon">＋</div>
      Select a block, net, or device on the canvas to inspect it.
      <br /><br />
      Selections can be pushed into the Review list.
    </div>
  );
}

function InstanceDetail() {
  const { selection, design, currentCell, descend, addToReview, setSelection } = useViewerStore();
  if (selection?.type !== 'instance') return null;

  const cell = design?.cells.get(currentCell);
  const inst = cell?.instances.find(i => i.id === selection.id);
  if (!inst) return null;

  const masterCell = design?.cells.get(inst.master);
  const childCount = masterCell
    ? masterCell.instances.length + masterCell.primitives.length
    : '—';

  const handleDescend = () => {
    if (masterCell) descend(inst.id, inst.master);
  };

  const handleNetClick = (net: string) => {
    setSelection({ type: 'net', name: net });
  };

  return (
    <div>
      <div className="insp-header">
        <span className="insp-tag inst">Instance</span>
        <span className="insp-title">{inst.id}</span>
      </div>

      <div className="kv-row">
        <span className="kv-key">Master cell</span>
        <span
          className={`kv-val${masterCell ? ' link' : ''}`}
          onClick={masterCell ? handleDescend : undefined}
        >
          {inst.master}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Parent</span>
        <span className="kv-val">{currentCell}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Child count</span>
        <span className="kv-val">{childCount}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Pins</span>
        <span className="kv-val">{Object.keys(inst.conn).length}</span>
      </div>

      <div className="insp-subhead">Pin → Net mapping</div>
      {Object.entries(inst.conn).map(([pin, net]) => (
        <div key={pin} className="conn-row">
          <span className="conn-pin">{pin}</span>
          <span className="conn-net" onClick={() => handleNetClick(net)}>{net}</span>
        </div>
      ))}

      <button
        className="addbtn"
        onClick={() => addToReview({ type: 'instance', id: inst.id })}
      >
        + Add to Review (zone)
      </button>
    </div>
  );
}

function NetDetail() {
  const { selection, design, currentCell, addToReview, setMode } = useViewerStore();
  if (selection?.type !== 'net') return null;

  const cell = design?.cells.get(currentCell);
  const net = cell?.nets.find(n => n.name === selection.name);
  if (!net) return null;

  const kindColor = net.kind === 'power' ? 'var(--net-pwr)' : net.kind === 'ground' ? 'var(--net-gnd)' : 'var(--net-sig)';
  const realEps = net.endpoints.filter(([id]) => id !== '__port__');

  return (
    <div>
      <div className="insp-header">
        <span className="insp-tag net">Net</span>
        <span className="insp-title">{net.name}</span>
      </div>

      <div className="kv-row">
        <span className="kv-key">Type</span>
        <span className="kv-val" style={{ color: kindColor }}>{net.kind}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Fanout</span>
        <span className="kv-val">{realEps.length}</span>
      </div>

      <div className="insp-subhead">Connected pins</div>
      {realEps.map(([id, pin]) => (
        <div key={`${id}.${pin}`} className="conn-row">
          <span className="conn-pin">{id}</span>
          <span className="conn-net">{pin}</span>
        </div>
      ))}

      <button
        className="addbtn"
        onClick={() => { setMode('net'); addToReview({ type: 'net', id: net.name }); }}
      >
        + Focus &amp; Add to Review
      </button>
    </div>
  );
}

function PrimitiveDetail() {
  const { selection, design, currentCell, addToReview } = useViewerStore();
  if (selection?.type !== 'primitive') return null;

  const cell = design?.cells.get(currentCell);
  const prim = cell?.primitives.find(p => p.id === selection.id);
  if (!prim) return null;

  const label = prim.kind === 'R' ? 'Resistor' : prim.kind === 'C' ? 'Capacitor' : 'MOSFET';

  return (
    <div>
      <div className="insp-header">
        <span className="insp-tag prim">{label}</span>
        <span className="insp-title">{prim.id}</span>
      </div>

      <div className="kv-row">
        <span className="kv-key">Model</span>
        <span className="kv-val">{prim.model}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Kind</span>
        <span className="kv-val">{prim.kind}</span>
      </div>

      <div className="insp-subhead">Terminals</div>
      {prim.terms.map(([term, net]) => (
        <div key={term} className="conn-row">
          <span className="conn-pin">{term}</span>
          <span className="conn-net">{net}</span>
        </div>
      ))}

      <div className="insp-subhead">Parameters</div>
      <div className="pill-row">
        {Object.entries(prim.params).map(([k, v]) => (
          <span key={k} className="pill">{k}={v}</span>
        ))}
      </div>

      <button className="addbtn" onClick={() => addToReview({ type: 'primitive', id: prim.id })}>
        + Add to Review (zone)
      </button>
    </div>
  );
}

function ReviewList() {
  const { reviewList, removeFromReview } = useViewerStore();

  if (reviewList.length === 0) {
    return (
      <div className="insp-empty">
        <div className="insp-empty-icon">▦</div>
        No items in review yet.
        <br />Add nets / instances from the canvas.
      </div>
    );
  }

  return (
    <div>
      {reviewList.map((item, i) => (
        <div key={i} className="rev-item">
          <span className={`insp-tag ${item.type === 'net' ? 'net' : item.type === 'primitive' ? 'prim' : 'inst'}`}>
            {item.type}
          </span>
          <span className="rev-id">{item.id}</span>
          <span className="rev-remove" onClick={() => removeFromReview(i)}>✕</span>
        </div>
      ))}
      <button className="addbtn" onClick={() => alert(`Handing ${reviewList.length} items to zone-creation flow`)}>
        Create Zone from {reviewList.length} item{reviewList.length !== 1 ? 's' : ''}
      </button>
    </div>
  );
}

export function InspectorPanel() {
  const { selection, reviewList } = useViewerStore();
  const [tab, setTab] = useState<'sel' | 'rev'>('sel');

  const selCount = selection ? 1 : 0;

  return (
    <div className="panel-right">
      <div className="insp-tabs">
        <button className={tab === 'sel' ? 'on' : ''} onClick={() => setTab('sel')}>
          Current Selection ({selCount})
        </button>
        <button className={tab === 'rev' ? 'on' : ''} onClick={() => setTab('rev')}>
          Review ({reviewList.length})
        </button>
      </div>

      <div className="insp-body">
        {tab === 'rev' ? (
          <ReviewList />
        ) : selection?.type === 'instance' ? (
          <InstanceDetail />
        ) : selection?.type === 'net' ? (
          <NetDetail />
        ) : selection?.type === 'primitive' ? (
          <PrimitiveDetail />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

