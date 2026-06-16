import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Port } from '../../parser/types';

export interface PortNodeData extends Record<string, unknown> {
  port: Port;
  isFocused: boolean;
  isHighlighted: boolean;
  // When this port is the head of a collapsed bus run, `label` is the
  // "base<hi:lo>" display name and `members` lists every bundled port. A plain
  // single port leaves these undefined and renders by its own name.
  label?: string;
  isBus?: boolean;
  members?: string[];
}

function PortNodeImpl({ data }: NodeProps) {
  const d = data as PortNodeData;
  const { port, isFocused, isHighlighted, label, isBus, members } = d;
  const displayName = label ?? port.name;
  // Per-slice selectors (see InstanceNode) so a selection click doesn't
  // re-render every port node.
  const mode = useViewerStore(s => s.mode);
  const setSelection = useViewerStore(s => s.setSelection);
  const setFocusNet = useViewerStore(s => s.setFocusNet);
  const design = useViewerStore(s => s.design);
  const currentCell = useViewerStore(s => s.currentCell);

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
      className={`port-node${isOutput ? ' out' : ' in'}${active ? ' connected' : ''}${isBus ? ' bus' : ''}`}
      onClick={handleClick}
      title={isBus
        ? `Cell port bus: ${displayName} — ${members?.length ?? 0} pins (${members?.join(', ')})`
        : `Cell port: ${port.name}${port.dir ? ` (${port.dir})` : ''}`}
    >
      <span className="port-label">{displayName}</span>
      {/* Handles live inside the flag so the wire attaches to its tip (the
          design-facing point), not the node's outer bounding edge. */}
      <span
        className={`port-flag${isBus ? ' bus' : ''}`}
        style={{ background: color, boxShadow: active ? `0 0 8px ${color}` : undefined }}
      >
        <Handle type="target" position={handlePos} id="port-tgt" style={{ opacity: 0 }} />
        <Handle type="source" position={handlePos} id="port-src" style={{ opacity: 0, pointerEvents: 'none' }} />
      </span>
    </div>
  );
}

// Only re-render when this port's own inputs change (see InstanceNode).
function sameData(a: NodeProps, b: NodeProps): boolean {
  const x = a.data as PortNodeData;
  const y = b.data as PortNodeData;
  return x.port === y.port && x.isFocused === y.isFocused && x.isHighlighted === y.isHighlighted &&
    x.label === y.label && x.isBus === y.isBus;
}

export const PortNode = memo(PortNodeImpl, sameData);
