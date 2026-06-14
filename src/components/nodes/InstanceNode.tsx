import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import { computeInstanceLayout, computeRadialLayout, type PlacedRow } from '../../layout/pinGroups';
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

const SIDE_COLOR: Record<PlacedRow['side'], string> = {
  left: 'var(--pin-i)',
  right: 'var(--pin-o)',
  top: 'var(--net-pwr)',
  bottom: 'var(--net-gnd)',
};
const SIDE_POSITION: Record<PlacedRow['side'], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

// A pin drawn as a tick mark crossing the symbol edge, colored by group. The
// React Flow handle IS the tick — a thin line centered on the edge point (a
// source for outputs, a target otherwise), with a hidden complementary handle
// at the same spot so a wire can attach from either end. The pin/net detail is
// in the Inspector; a hover title gives a quick peek. An active pin lights up
// in the focused net's own (brighter) category color.
function symbolPin(p: PlacedRow, activeNet: string | null, activeColor: string) {
  const isOutput = p.side === 'right';
  const isActive = !!activeNet && p.row.nets.includes(activeNet);
  const horiz = p.side === 'left' || p.side === 'right';
  const len = isActive ? 13 : 10;
  const thick = isActive ? 3 : 2;
  const tick = {
    top: p.y, left: p.x, transform: 'translate(-50%, -50%)',
    width: horiz ? len : thick,
    height: horiz ? thick : len,
    minWidth: 0, minHeight: 0,
    borderRadius: 1, border: 'none',
    background: isActive ? activeColor : SIDE_COLOR[p.side],
    boxShadow: isActive ? `0 0 5px 1px ${activeColor}` : undefined,
    zIndex: isActive ? 10 : 3,
  };
  const hidden = {
    top: p.y, left: p.x, transform: 'translate(-50%, -50%)',
    width: 7, height: 7, border: 'none', background: 'transparent',
    opacity: 0, pointerEvents: 'none' as const,
  };
  const title = `${p.row.pinLabel} → ${p.row.netLabel}`;
  return (
    <Fragment key={p.row.repPin}>
      <Handle
        type={isOutput ? 'source' : 'target'}
        position={SIDE_POSITION[p.side]}
        id={`${p.row.repPin}-${isOutput ? 'src' : 'tgt'}`}
        style={tick}
        title={title}
      />
      <Handle
        type={isOutput ? 'target' : 'source'}
        position={SIDE_POSITION[p.side]}
        id={`${p.row.repPin}-${isOutput ? 'tgt' : 'src'}`}
        style={hidden}
      />
    </Fragment>
  );
}

export function InstanceNode({ data }: NodeProps) {
  const d = data as InstanceNodeData;
  const { instance, masterPorts, isSelected, isConnected, activeNet } = d;
  const { descend, setSelection, design, currentCell, nodeLayout } = useViewerStore();

  // Pins are grouped into IN / OUT / PWR / GND; supply/ground membership comes
  // from the net's kind, so we need a name → kind lookup.
  const cell = design?.cells.get(currentCell);
  const netKindOf = (net: string) => cell?.nets.find(n => n.name === net)?.kind ?? 'signal';

  // The active (selected/focused) net lights its pins up in a brighter version
  // of its own category color — not a separate golden highlight.
  const activeKind = activeNet ? netKindOf(activeNet) : null;
  const activeColor = activeKind === 'power'
    ? 'var(--net-pwr-hi)'
    : activeKind === 'ground'
    ? 'var(--net-gnd-hi)'
    : 'var(--net-sig-hi)';

  const handleDoubleClick = () => {
    if (design?.cells.has(instance.master)) {
      descend(instance.id, instance.master);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection({ type: 'instance', id: instance.id });
  };

  const stateClass = isSelected ? ' sel' : isConnected ? ' connected' : '';

  // BETA: the block as a schematic symbol — a box with tick-mark pins on its
  // four edges (inputs left, outputs right, supply top, ground bottom) and no
  // inline text. The pin→net mapping lives in the Inspector.
  if (nodeLayout === 'beta') {
    const layout = computeRadialLayout(instance.conn, masterPorts, netKindOf);
    return (
      <div
        className={`inst-node beta-symbol${stateClass}`}
        style={{ width: layout.width, height: layout.height }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title="Double-click to descend"
      >
        {layout.rows.map(p => symbolPin(p, activeNet, activeColor))}
        <div className="sym-label">
          <span className="sym-id">{instance.id}</span>
          <span className="sym-master" title={instance.master}>{instance.master}</span>
        </div>
      </div>
    );
  }

  // CLASSIC: the four groups stacked as labeled IN/OUT/PWR/GND sections.
  const { sections } = computeInstanceLayout(instance.conn, masterPorts, netKindOf);
  return (
    <div
      className={`inst-node${stateClass}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Double-click to descend"
    >
      {/* Per-row handles — every row (a single pin, or a collapsed bus of
          consecutive pins) gets both a source and a target handle anchored to
          its first pin (repPin). `top` comes from the shared layout so handles
          line up exactly with their rendered rows. */}
      {sections.flatMap(section =>
        section.rows.map(({ row, top }) => {
          const isOutput = section.group === 'output';
          const position = isOutput ? Position.Right : Position.Left;
          const isActive = !!activeNet && row.nets.includes(activeNet);
          const visibleStyle = {
            top,
            background: isActive ? activeColor : isOutput ? 'var(--pin-o)' : 'var(--pin-i)',
            width: isActive ? 11 : 8, height: isActive ? 11 : 8,
            border: isActive ? `2px solid ${activeColor}` : '2px solid var(--bg)',
            boxShadow: isActive ? `0 0 6px 1px ${activeColor}` : undefined,
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
                <div
                  key={row.repPin}
                  className={`pin-row${row.isBus ? ' bus' : ''}${isActive ? ' active-net' : ''}`}
                  style={isActive ? { color: activeColor } : undefined}
                >
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
