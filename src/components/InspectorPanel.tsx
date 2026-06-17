import { useState, useEffect, useCallback, useMemo } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { describeCell, getApiKey, getCachedDescription, setApiKey } from '../ai/describeCell';
import { buildCellView } from '../layout/cellView';
import type { Cell } from '../parser/types';

const BULLET_RE = /^[-*•]\s+/;

// Splits the AI description into a leading summary line(s) and a bullet
// list, so the response reads as a quick-skim summary rather than a
// wall of prose.
function DescriptionView({ text }: { text: string }) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const summary = lines.filter(l => !BULLET_RE.test(l));
  const bullets = lines.filter(l => BULLET_RE.test(l)).map(l => l.replace(BULLET_RE, ''));

  return (
    <>
      {summary.map((l, i) => <p key={i} className="ai-desc-text">{l}</p>)}
      {bullets.length > 0 && (
        <ul className="ai-desc-bullets">
          {bullets.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </>
  );
}

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
      {description && <DescriptionView text={description} />}
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
  const cell = design?.cells.get(currentCell);
  // The canvas collapses instance arrays into one block; the selection id can be
  // an array label ("Xbit<1023:0>") that isn't a real instance, so resolve it
  // through the same view the canvas renders.
  const view = useMemo(() => (cell ? buildCellView(cell) : null), [cell]);

  if (selection?.type !== 'instance') return null;

  const di = view?.instancesById.get(selection.id);
  if (!di) return null;

  const isArray = di.isArray;
  const masterCell = design?.cells.get(di.master);
  const childCount = masterCell
    ? masterCell.instances.length + masterCell.primitives.length
    : '—';
  const lastMember = di.members[di.members.length - 1];

  return (
    <div>
      <div className="insp-header">
        <span className="insp-tag inst">{isArray ? 'Array' : 'Instance'}</span>
        <span className="insp-title">{di.id}</span>
      </div>

      <div className="kv-row">
        <span className="kv-key">Master cell</span>
        <span
          className={`kv-val${masterCell ? ' link' : ''}`}
          onClick={masterCell ? () => descend(di.id, di.master) : undefined}
        >
          {di.master}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Parent</span>
        <span className="kv-val">{currentCell}</span>
      </div>
      {isArray && (
        <>
          <div className="kv-row">
            <span className="kv-key">Members</span>
            <span className="kv-val">{di.arraySize}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Range</span>
            <span className="kv-val">{di.members[0].id} … {lastMember.id}</span>
          </div>
        </>
      )}
      <div className="kv-row">
        <span className="kv-key">Child count</span>
        <span className="kv-val">{childCount}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Pins</span>
        <span className="kv-val">{Object.keys(di.conn).length}</span>
      </div>

      {masterCell && <CellDescription key={masterCell.name} cell={masterCell} />}

      <div className="insp-subhead">Pin → Net mapping{isArray ? ' (shared / per-member bus)' : ''}</div>
      {Object.entries(di.conn).map(([pin, net]) => {
        const isRealNet = !!cell?.nets.some(n => n.name === net);
        return (
          <div key={pin} className="conn-row">
            <span className="conn-pin">{pin}</span>
            <span
              className={isRealNet ? 'conn-net' : 'conn-net plain'}
              onClick={isRealNet ? () => setSelection({ type: 'net', name: net }) : undefined}
            >
              {net}
            </span>
          </div>
        );
      })}
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
  const cell = design?.cells.get(currentCell);
  // A collapsed device array's selection id is a label ("M0<4095:0>") that
  // isn't a real primitive — resolve it (and member ids) through the view.
  const view = useMemo(() => (cell ? buildCellView(cell) : null), [cell]);

  if (selection?.type !== 'primitive') return null;

  const prim = view?.primitivesById.get(selection.id);
  if (!prim) return null;

  const isArray = prim.isArray;
  const label = prim.kind === 'R' ? 'Resistor' : prim.kind === 'C' ? 'Capacitor' : 'MOSFET';
  const lastMember = prim.members[prim.members.length - 1];

  return (
    <div>
      <div className="insp-header">
        <span className="insp-tag prim">{isArray ? `${label} array` : label}</span>
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
      {isArray && (
        <>
          <div className="kv-row">
            <span className="kv-key">Devices</span>
            <span className="kv-val">{prim.arraySize}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Range</span>
            <span className="kv-val">{prim.members[0].id} … {lastMember.id}</span>
          </div>
        </>
      )}

      <div className="insp-subhead">Terminals{isArray ? ' (shared / per-member bus)' : ''}</div>
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
