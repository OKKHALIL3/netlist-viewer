import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Net, Port } from '../../parser/types';

export interface PortNodeData extends Record<string, unknown> {
  port: Port;
  netKind: Net['kind'] | null;
  isFocused: boolean;
  isHighlighted: boolean;
}

const KIND_COLOR: Record<Net['kind'], string> = {
  power: 'var(--net-pwr)',
  ground: 'var(--net-gnd)',
  signal: 'var(--net-sig)',
};

export function PortNode({ data }: NodeProps) {
  const d = data as PortNodeData;
  const { port, netKind, isFocused, isHighlighted } = d;
  const { mode, setSelection, setFocusNet } = useViewerStore();

  const color = isFocused || isHighlighted
    ? 'var(--sel)'
    : netKind ? KIND_COLOR[netKind] : 'var(--line)';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === 'net') setFocusNet(port.name);
    setSelection({ type: 'net', name: port.name });
  };

  return (
    <div
      className={`port-node${isFocused || isHighlighted ? ' connected' : ''}`}
      onClick={handleClick}
      title={`Cell port: ${port.name}${port.dir ? ` (${port.dir})` : ''}`}
    >
      <Handle type="target" position={Position.Left} id="port-tgt" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="port-src" style={{ opacity: 0, pointerEvents: 'none' }} />
      <div className="port-glyph" style={{ borderColor: color, color }}>{port.dir ?? '?'}</div>
      <div className="port-label">{port.name}</div>
    </div>
  );
}
