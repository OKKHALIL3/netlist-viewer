import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Instance, Port } from '../../parser/types';

export interface InstanceNodeData extends Record<string, unknown> {
  instance: Instance;
  masterPorts: Port[];
  isSelected: boolean;
  isConnected: boolean;
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
  const { instance, masterPorts, isSelected, isConnected } = d;
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
      className={`inst-node${isSelected ? ' sel' : isConnected ? ' connected' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Double-click to descend"
    >
      {/* Handles — every pin gets both a source and a target handle at the
          same position, since a wire can connect to either end of a pin
          regardless of which side buildGraph picks as the "source" of the
          net's edges. The unused handle is invisible but still anchors edges. */}
      {pins.map(([pin], i) => {
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
