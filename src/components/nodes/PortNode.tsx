import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Port } from '../../parser/types';

export interface PortNodeData extends Record<string, unknown> {
  port: Port;
  isFocused: boolean;
  isHighlighted: boolean;
  // For a collapsed boundary bus (e.g. "in<1023:0>" standing in for in<0>..
  // in<1023>): a real member net to select when clicked (so the inspector
  // resolves to an actual net), the member count, and a flag.
  repNet?: string;
  isArrayPort?: boolean;
  count?: number;
}

export function PortNode({ data }: NodeProps) {
  const d = data as PortNodeData;
  const { port, isFocused, isHighlighted } = d;
  const { mode, setSelection, setFocusNet, design, currentCell } = useViewerStore();

  // For a bus port, port.name is a synthetic "<hi:lo>" label, not a real net —
  // resolve interactions/coloring through a real member net instead.
  const selectNet = d.repNet ?? port.name;

  const active = isFocused || isHighlighted;
  // Cell-boundary ports use a dedicated color so they read as "cell I/O"; when
  // focused they light up in a brighter version of their net's category color.
  const kind = design?.cells.get(currentCell)?.nets.find(n => n.name === selectNet)?.kind ?? 'signal';
  const hiColor = kind === 'power' ? 'var(--net-pwr-hi)' : kind === 'ground' ? 'var(--net-gnd-hi)' : 'var(--net-sig-hi)';
  const color = active ? hiColor : 'var(--port)';

  // Outputs sit on the right boundary (design to their left), inputs on the left
  // (design to their right). Put the wire handle on the design-facing side and
  // point the flag that way, so the wire comes straight out of the pin tip.
  const isOutput = port.dir === 'O';
  const handlePos = isOutput ? Position.Left : Position.Right;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === 'net') setFocusNet(selectNet);
    setSelection({ type: 'net', name: selectNet });
  };

  return (
    <div
      className={`port-node${isOutput ? ' out' : ' in'}${active ? ' connected' : ''}${d.isArrayPort ? ' array' : ''}`}
      onClick={handleClick}
      title={d.isArrayPort
        ? `Cell port bus: ${port.name} — ${d.count} bits${port.dir ? ` (${port.dir})` : ''}`
        : `Cell port: ${port.name}${port.dir ? ` (${port.dir})` : ''}`}
    >
      <span className="port-label">{port.name}</span>
      {d.isArrayPort && <span className="port-count">×{d.count}</span>}
      {/* Handles live inside the flag so the wire attaches to its tip (the
          design-facing point), not the node's outer bounding edge. */}
      <span
        className="port-flag"
        style={{ background: color, boxShadow: active ? `0 0 8px ${color}` : undefined }}
      >
        <Handle type="target" position={handlePos} id="port-tgt" style={{ opacity: 0 }} />
        <Handle type="source" position={handlePos} id="port-src" style={{ opacity: 0, pointerEvents: 'none' }} />
      </span>
    </div>
  );
}
