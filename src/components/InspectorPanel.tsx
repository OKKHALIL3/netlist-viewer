import { useState, useEffect, useCallback } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { describeCell, getApiKey, getCachedDescription, setApiKey } from '../ai/describeCell';
import type { Cell } from '../parser/types';

// Keyed by cell.name from the caller so a remount resets state when the
// selected instance's master cell changes.
function CellDescription({ cell }: { cell: Cell }) {
  const [description, setDescription] = useState<string | null>(() => getCachedDescription(cell.name));
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveKey = () => {
    if (!keyInput.trim()) return;
    setApiKey(keyInput.trim());
    setHasKey(true);
    setKeyInput('');
  };

  const generate = useCallback(async (target: Cell, force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setDescription(await describeCell(target, force));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Every instance gets its description automatically: generate it on first
  // view if we don't already have a cached one (and a key is set).
  useEffect(() => {
    if (!description && hasKey) void Promise.resolve().then(() => generate(cell, false));
  }, [cell, description, hasKey, generate]);

  return (
    <>
      <div className="insp-subhead">Functional description</div>
      {description && <p className="ai-desc-text">{description}</p>}
      {error && <p className="ai-desc-error">{error}</p>}
      {!hasKey ? (
        <div className="ai-desc-keyform">
          <input
            type="password"
            placeholder="Anthropic API key"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveKey()}
          />
          <button className="btn-secondary" onClick={saveKey}>Save key</button>
        </div>
      ) : (
        <button className="btn-secondary" onClick={() => generate(cell, !!description)} disabled={loading}>
          {loading ? 'Generating…' : description ? 'Regenerate' : 'Generate with AI'}
        </button>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="insp-empty">
      <div className="insp-empty-icon">＋</div>
      Select a block, net, or device on the canvas to inspect it.
    </div>
  );
}

function InstanceDetail() {
  const { selection, design, currentCell, descend, setSelection } = useViewerStore();
  if (selection?.type !== 'instance') return null;

  const cell = design?.cells.get(currentCell);
  const inst = cell?.instances.find(i => i.id === selection.id);
  if (!inst) return null;

  const masterCell = design?.cells.get(inst.master);
  const childCount = masterCell
    ? masterCell.instances.length + masterCell.primitives.length
    : '—';

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
          onClick={masterCell ? () => descend(inst.id, inst.master) : undefined}
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

      {masterCell && <CellDescription key={masterCell.name} cell={masterCell} />}

      <div className="insp-subhead">Pin → Net mapping</div>
      {Object.entries(inst.conn).map(([pin, net]) => (
        <div key={pin} className="conn-row">
          <span className="conn-pin">{pin}</span>
          <span
            className="conn-net"
            onClick={() => setSelection({ type: 'net', name: net })}
          >
            {net}
          </span>
        </div>
      ))}
    </div>
  );
}

function NetDetail() {
  const { selection, design, currentCell } = useViewerStore();
  if (selection?.type !== 'net') return null;

  const cell = design?.cells.get(currentCell);
  const net = cell?.nets.find(n => n.name === selection.name);
  if (!net) return null;

  const kindColor = net.kind === 'power'
    ? 'var(--net-pwr)'
    : net.kind === 'ground'
    ? 'var(--net-gnd)'
    : 'var(--net-sig)';
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
    </div>
  );
}

function PrimitiveDetail() {
  const { selection, design, currentCell } = useViewerStore();
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

      {Object.keys(prim.params).length > 0 && (
        <>
          <div className="insp-subhead">Parameters</div>
          <div className="pill-row">
            {Object.entries(prim.params).map(([k, v]) => (
              <span key={k} className="pill">{k}={v}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function InspectorPanel() {
  const { selection } = useViewerStore();

  return (
    <div className="panel-right">
      <div className="panel-head">
        <h3>Inspector</h3>
      </div>
      <div className="insp-body">
        {selection?.type === 'instance' ? (
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
