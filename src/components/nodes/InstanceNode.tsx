import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import { computeInstanceLayout, pinDirection } from '../../layout/pinGroups';
import type { Instance, Port } from '../../parser/types';

export interface InstanceNodeData extends Record<string, unknown> {
  instance: Instance;
  masterPorts: Port[];
  isSelected: boolean;
  isConnected: boolean;
  // Net currently selected/focused, if any — its row(s) are highlighted so a
  // wire can be traced to its exact pin even when its drawn path loops
  // around the block and passes near other pins.
  activeNet: string | null;
}

export function InstanceNode({ data }: NodeProps) {
  const d = data as InstanceNodeData;
  const { instance, masterPorts, isSelected, isConnected, activeNet } = d;
  const { descend, setSelection, design, currentCell } = useViewerStore();

  // Pins are grouped into IN / OUT / PWR / GND sections; supply/ground
  // membership comes from the net's kind, so we need a name → kind lookup.
  const cell = design?.cells.get(currentCell);
  const netKindOf = (net: string) => cell?.nets.find(n => n.name === net)?.kind ?? 'signal';
  const { sections } = computeInstanceLayout(instance.conn, masterPorts, netKindOf);

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
      {/* Per-row handles — every row (a single pin, or a collapsed bus of
          consecutive pins) gets both a source and a target handle at the
          same position, anchored to its first pin (repPin), since a wire
          can connect to either end regardless of which side buildGraph
          picks as the "source" of the net's edges. The unused handle is
          invisible but still anchors edges. `top` comes from the shared
          layout so handles line up exactly with their rendered rows. */}
      {sections.flatMap(section =>
        section.rows.map(({ row, top }) => {
          const isOutput = pinDirection(row.repPin, masterPorts) === 'O';
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
        }),
      )}

      <div className="inst-head">
        <span className="inst-id">{instance.id}</span>
        <span className="inst-master" title={instance.master}>{instance.master}</span>
      </div>
      <div className="inst-body">
        {sections.map(section => (
          <div className="pin-section" key={section.group}>
            <div className="pin-section-head" style={{ color: section.color }}>{section.label}</div>
            {section.rows.map(({ row }) => {
              const isActive = !!activeNet && row.nets.includes(activeNet);
              return (
                <div key={row.repPin} className={`pin-row${row.isBus ? ' bus' : ''}${isActive ? ' active-net' : ''}`}>
                  <span className="pin-name" title={row.isBus ? row.pins.join(', ') : row.pinLabel}>{row.pinLabel}</span>
                  <span className="net-name" title={row.isBus ? row.nets.join(', ') : row.netLabel}>{row.netLabel}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
