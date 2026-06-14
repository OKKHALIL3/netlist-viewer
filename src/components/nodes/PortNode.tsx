import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Port } from '../../parser/types';

export interface PortNodeData extends Record<string, unknown> {
  port: Port;
  isFocused: boolean;
  isHighlighted: boolean;
}

export function PortNode({ data }: NodeProps) {
  const d = data as PortNodeData;
  const { port, isFocused, isHighlighted } = d;
  const { mode, setSelection, setFocusNet, design, currentCell } = useViewerStore();

  const active = isFocused || isHighlighted;
  // Cell-boundary ports use a dedicated color so they read as "cell I/O"; when
  // focused they light up in a brighter version of their net's category color.
  const kind = design?.cells.get(currentCell)?.nets.find(n => n.name === port.name)?.kind ?? 'signal';
  const hiColor = kind === 'power' ? 'var(--net-pwr-hi)' : kind === 'ground' ? 'var(--net-gnd-hi)' : 'var(--net-sig-hi)';
  const color = active ? hiColor : 'var(--port)';

  // Outputs sit on the right boundary (design to their left), inputs on the left
  // (design to their right). Put the wire handle on the design-facing side and
  // point the flag that way, so the wire comes straight out of the pin tip.
  const isOutput = port.dir === 'O';
  const handlePos = isOutput ? Position.Left : Position.Right;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === 'net') setFocusNet(port.name);
    setSelection({ type: 'net', name: port.name });
  };

  return (
    <div
      className={`port-node${isOutput ? ' out' : ' in'}${active ? ' connected' : ''}`}
      onClick={handleClick}
      title={`Cell port: ${port.name}${port.dir ? ` (${port.dir})` : ''}`}
    >
      <span className="port-label">{port.name}</span>
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
