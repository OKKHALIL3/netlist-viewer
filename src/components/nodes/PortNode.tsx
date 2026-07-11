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
  repNet?: string;
  isArrayPort?: boolean;
  count?: number;
  // Which boundary edge the layout placed this port on. Drives the fin
  // direction for signal ports (see below) so it follows the actual side
  // rather than the declared — often missing — PININFO direction.
  side?: 'left' | 'right';
}

function PortNodeImpl({ data }: NodeProps) {
  const d = data as PortNodeData;
  const { port, isFocused, isHighlighted, label, isBus, members } = d;
  const displayName = label ?? port.name;
  const selectNet = d.repNet ?? port.name;
  // Per-slice selectors (see InstanceNode) so a selection click doesn't
  // re-render every port node.
  const setSelection = useViewerStore(s => s.setSelection);
  const design = useViewerStore(s => s.design);
  const currentCell = useViewerStore(s => s.currentCell);

  const active = isFocused || isHighlighted;
  // Cell-boundary ports use a dedicated color so they read as "cell I/O"; when
  // focused they light up in a brighter version of their net's category color.
  const kind = design?.cells.get(currentCell)?.nets.find(n => n.name === selectNet)?.kind ?? 'signal';
  const isPower = kind === 'power';
  const isGround = kind === 'ground';
  const hiColor = isPower ? 'var(--net-pwr-hi)' : isGround ? 'var(--net-gnd-hi)' : 'var(--net-sig-hi)';
  // Supply/ground ports are tinted by their rail colour so VDD/VSS read at a
  // glance; signal I/O keeps the neutral port colour.
  const baseColor = isPower ? 'var(--net-pwr)' : isGround ? 'var(--net-gnd)' : 'var(--port)';
  const color = active ? hiColor : baseColor;

  // Supply/ground ports live on the top/bottom rails (see repositionSupplyRails)
  // with the design below/above them, so their wire exits the bottom/top.
  // Signal ports point toward the design with the wire leaving the fin tip:
  // ports laid out on the right boundary point left, those on the left point
  // right. The side comes from the layout (passed in via `side`) so a port
  // whose PININFO direction disagrees with where it actually landed still
  // points inward; we fall back to the declared direction if no side is given.
  const onRight = d.side ? d.side === 'right' : port.dir === 'O';
  const handlePos = isPower ? Position.Bottom
    : isGround ? Position.Top
    : onRight ? Position.Left : Position.Right;
  const orientClass = isPower ? ' pwr' : isGround ? ' gnd' : onRight ? ' out' : ' in';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection({ type: 'net', name: selectNet });
  };

  return (
    <div
      className={`port-node${orientClass}${active ? ' connected' : ''}${isBus ? ' bus' : ''}${d.isArrayPort ? ' array' : ''}`}
      onClick={handleClick}
      title={(isBus || d.isArrayPort)
        ? `Cell port bus: ${displayName} - ${members?.length ?? d.count ?? 0} pins${port.dir ? ` (${port.dir})` : ''}`
        : `Cell port: ${port.name}${port.dir ? ` (${port.dir})` : ''}`}
    >
      <span className="port-label">{displayName}</span>
      {d.isArrayPort && <span className="port-count">x{d.count}</span>}
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
    x.label === y.label && x.isBus === y.isBus && x.repNet === y.repNet && x.side === y.side &&
    x.isArrayPort === y.isArrayPort && x.count === y.count;
}

export const PortNode = memo(PortNodeImpl, sameData);
