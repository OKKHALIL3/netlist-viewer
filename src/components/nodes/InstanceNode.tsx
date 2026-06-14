import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import { groupPinConnections } from '../../layout/busGrouping';
import type { Instance, Port } from '../../parser/types';

export interface InstanceNodeData extends Record<string, unknown> {
  instance: Instance;
  masterPorts: Port[];
  isSelected: boolean;
  isConnected: boolean;
  // Detailed mode always shows the full pin table; simple mode shows a
  // header-only card unless the instance is selected.
  isExpanded: boolean;
  // Net currently selected/focused, if any — its row(s) are highlighted so a
  // wire can be traced to its exact pin even when its drawn path loops
  // around the block and passes near other pins.
  activeNet: string | null;
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
  const { instance, masterPorts, isSelected, isConnected, isExpanded, activeNet } = d;
  const { descend, setSelection, design } = useViewerStore();
  // Collapses runs of consecutive scalarized bus bits (e.g. D<0>..D<23>,
  // wired to a correspondingly-indexed run of nets) into single rows shown
  // as "D<23:0>". Each row's first pin anchors its handles/edges.
  const rows = groupPinConnections(Object.entries(instance.conn));

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

      {/* Per-row handles — every row (a single pin, or a collapsed bus of
          consecutive pins) gets both a source and a target handle at the
          same position, anchored to its first pin (repPin), since a wire
          can connect to either end regardless of which side buildGraph
          picks as the "source" of the net's edges. The unused handle is
          invisible but still anchors edges. Only rendered when the pin
          table itself is visible. */}
      {isExpanded && rows.map((row, i) => {
        const dir = pinDir(row.repPin, masterPorts);
        const top = HEADER_H + i * PIN_H + PIN_H / 2;
        const isOutput = dir === 'O';
        const position = isOutput ? Position.Right : Position.Left;
        const isActive = !!activeNet && row.nets.includes(activeNet);
        const visibleStyle = {
          top,
          background: isActive ? 'var(--sel)' : isOutput ? 'var(--pin-o)' : 'var(--pin-i)',
          width: isActive ? 11 : 8, height: isActive ? 11 : 8,
          border: isActive ? '2px solid var(--sel)' : '2px solid var(--bg)',
          boxShadow: isActive ? '0 0 6px 1px var(--sel)' : undefined,
          zIndex: isActive ? 10 : undefined,
        };
        const hiddenStyle = { top, width: 8, height: 8, opacity: 0, pointerEvents: 'none' as const };
        return (
          <Fragment key={row.repPin}>
            <Handle
              type={isOutput ? 'source' : 'target'}
              position={position}
              id={`${row.repPin}-${isOutput ? 'src' : 'tgt'}`}
              style={visibleStyle}
            />
            <Handle
              type={isOutput ? 'target' : 'source'}
              position={position}
              id={`${row.repPin}-${isOutput ? 'tgt' : 'src'}`}
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
          {rows.map(row => {
            const isActive = !!activeNet && row.nets.includes(activeNet);
            return (
              <div key={row.repPin} className={`pin-row${row.isBus ? ' bus' : ''}${isActive ? ' active-net' : ''}`}>
                <span className="pin-name" title={row.isBus ? row.pins.join(', ') : row.pinLabel}>{row.pinLabel}</span>
                <span className="net-name" title={row.isBus ? row.nets.join(', ') : row.netLabel}>{row.netLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
