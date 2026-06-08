import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Instance, Port } from '../../parser/types';

export interface InstanceNodeData extends Record<string, unknown> {
  instance: Instance;
  masterPorts: Port[];
  isSelected: boolean;
}

const HEADER_H = 42;
const PIN_H = 20;

function pinDir(name: string, ports: Port[]): 'I' | 'O' | 'B' {
  const p = ports.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (p?.dir) return p.dir;
  if (/^(out|y|z|q|qb?|do|dout|co|cout|s|sum|f|g)$/i.test(name)) return 'O';
  if (/(_o|_out|_y)$/i.test(name)) return 'O';
  return 'I';
}

export function InstanceNode({ data }: NodeProps) {
  const d = data as InstanceNodeData;
  const { instance, masterPorts, isSelected } = d;
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
      className={`inst-node${isSelected ? ' sel' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Double-click to descend"
    >
      {/* Handles */}
      {pins.map(([pin], i) => {
        const dir = pinDir(pin, masterPorts);
        const top = HEADER_H + i * PIN_H + PIN_H / 2;
        if (dir === 'O') {
          return (
            <Handle
              key={`s-${pin}`}
              type="source"
              position={Position.Right}
              id={`${pin}-src`}
              style={{ top, background: 'var(--pin-o)', width: 8, height: 8, border: '2px solid var(--bg)' }}
            />
          );
        }
        return (
          <Handle
            key={`t-${pin}`}
            type="target"
            position={Position.Left}
            id={`${pin}-tgt`}
            style={{ top, background: 'var(--pin-i)', width: 8, height: 8, border: '2px solid var(--bg)' }}
          />
        );
      })}

      <div className="inst-head">
        <span className="inst-id">{instance.id}</span>
        <span className="inst-master">{instance.master}</span>
      </div>
      <div className="inst-body">
        {pins.map(([pin, net]) => (
          <div key={pin} className="pin-row">
            <span className="pin-name">{pin}</span>
            <span className="net-name">{net}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
