import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Instance, Port } from '../../parser/types';

export interface InstanceNodeData extends Record<string, unknown> {
  instance: Instance;
  masterPorts: Port[];
  isSelected: boolean;
  isConnected: boolean;
  // Detailed mode always shows the full pin table; simple mode shows a
  // header-only card unless the instance is selected.
  isExpanded: boolean;
}

const HEADER_H = 42;
const PIN_H = 20;

// Invisible handle pair every node carries so "floating" edges (simple mode)
// always have a valid anchor, independent of per-pin handles.
const FLOAT_HANDLE_STYLE = {
  left: '50%', top: '50%', width: 1, height: 1,
  opacity: 0, pointerEvents: 'none' as const, transform: 'translate(-50%, -50%)',
};

function pinDir(name: string, ports: Port[]): 'I' | 'O' | 'B' {
  const p = ports.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (p?.dir) return p.dir;
  if (/^(out|y|z|q|qb?|do|dout|co|cout|s|sum|f|g)$/i.test(name)) return 'O';
  if (/(_o|_out|_y)$/i.test(name)) return 'O';
  return 'I';
}

export function InstanceNode({ data }: NodeProps) {
  const d = data as InstanceNodeData;
  const { instance, masterPorts, isSelected, isConnected, isExpanded } = d;
  const { descend, setSelection, design } = useViewerStore();
  const pins = Object.entries(instance.conn);

  const handleDoubleClick = () => {
    if (design?.cells.has(instance.master)) {
      descend(instance.id, instance.master);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection({ type: 'instance', id: instance.id });
  };

  return (
    <div
      className={`inst-node${isSelected ? ' sel' : isConnected ? ' connected' : ''}${isExpanded ? ' expanded' : ' collapsed'}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Double-click to descend"
    >
      {/* Generic floating-edge anchor — always present so simple-mode wires
          (which connect to the nearest border point, not a specific pin)
          always have a valid handle to attach to. */}
      <Handle type="source" position={Position.Left} id="float-src" style={FLOAT_HANDLE_STYLE} />
      <Handle type="target" position={Position.Left} id="float-tgt" style={FLOAT_HANDLE_STYLE} />

      {/* Per-pin handles — every pin gets both a source and a target handle
          at the same position, since a wire can connect to either end of a
          pin regardless of which side buildGraph picks as the "source" of
          the net's edges. The unused handle is invisible but still anchors
          edges. Only rendered when the pin table itself is visible. */}
      {isExpanded && pins.map(([pin], i) => {
        const dir = pinDir(pin, masterPorts);
        const top = HEADER_H + i * PIN_H + PIN_H / 2;
        const isOutput = dir === 'O';
        const position = isOutput ? Position.Right : Position.Left;
        const visibleStyle = {
          top,
          background: isOutput ? 'var(--pin-o)' : 'var(--pin-i)',
          width: 8, height: 8, border: '2px solid var(--bg)',
        };
        const hiddenStyle = { top, width: 8, height: 8, opacity: 0, pointerEvents: 'none' as const };
        return (
          <Fragment key={pin}>
            <Handle
              type={isOutput ? 'source' : 'target'}
              position={position}
              id={`${pin}-${isOutput ? 'src' : 'tgt'}`}
              style={visibleStyle}
            />
            <Handle
              type={isOutput ? 'target' : 'source'}
              position={position}
              id={`${pin}-${isOutput ? 'tgt' : 'src'}`}
              style={hiddenStyle}
            />
          </Fragment>
        );
      })}

      <div className="inst-head">
        <span className="inst-id">{instance.id}</span>
        <span className="inst-master" title={instance.master}>{instance.master}</span>
      </div>
      {isExpanded && (
        <div className="inst-body">
          {pins.map(([pin, net]) => (
            <div key={pin} className="pin-row">
              <span className="pin-name" title={pin}>{pin}</span>
              <span className="net-name" title={net}>{net}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
