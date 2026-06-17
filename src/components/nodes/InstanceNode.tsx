import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import { computeInstanceLayout, computeRadialLayout, type PlacedRow, type PinGroup } from '../../layout/pinGroups';
import { netInBusLabel } from '../../layout/busGrouping';
import type { Instance, Port } from '../../parser/types';

// A pin row is "active" when the focused/selected net is one of its nets — or,
// on a collapsed array block, when the focused net is a single member of the
// row's collapsed bus label (e.g. activeNet "D<5>" vs row label "D<1023:0>").
function rowMatchesActive(nets: string[], activeNet: string | null): boolean {
  if (!activeNet) return false;
  return nets.some(n => n === activeNet || netInBusLabel(activeNet, n));
}

export interface InstanceNodeData extends Record<string, unknown> {
  instance: Instance;
  masterPorts: Port[];
  isSelected: boolean;
  isConnected: boolean;
  // Net currently selected/focused, if any — its row(s) are highlighted so a
  // wire can be traced to its exact pin even when its drawn path loops
  // around the block and passes near other pins.
  activeNet: string | null;
  // >1 when this block stands in for a scalarized instance array (e.g.
  // `Xbit<1023:0>` = 1024 members). Rendered as a stacked "cards behind each
  // other" block with a ×N badge so it reads as a bundle, not one instance.
  arraySize?: number;
}

const GROUP_COLOR: Record<PinGroup, string> = {
  input: 'var(--pin-i)',
  output: 'var(--pin-o)',
  supply: 'var(--net-pwr)',
  ground: 'var(--net-gnd)',
};

// A pin's source/target handle pair (a colored dot, classic style) at its
// placed edge point. Outputs are the net's source; everything else is a target.
// The dot is colored by the pin's GROUP (not its side, since both sides hold a
// mix). Center is set exactly at (x, y); an active pin lights up in the focused
// net's own (brighter) category color.
function edgeHandle(p: PlacedRow, activeNet: string | null, activeColor: string) {
  const isOutput = p.group === 'output';
  const isActive = rowMatchesActive(p.row.nets, activeNet);
  const position = p.side === 'left' ? Position.Left : Position.Right;
  const posStyle = { top: p.y, left: p.x, transform: 'translate(-50%, -50%)' };
  const visibleStyle = {
    ...posStyle,
    background: isActive ? activeColor : GROUP_COLOR[p.group],
    width: isActive ? 11 : 8, height: isActive ? 11 : 8,
    border: isActive ? `2px solid ${activeColor}` : '2px solid var(--bg)',
    boxShadow: isActive ? `0 0 6px 1px ${activeColor}` : undefined,
    zIndex: isActive ? 10 : 3,
  };
  const hiddenStyle = { ...posStyle, width: 8, height: 8, opacity: 0, pointerEvents: 'none' as const };
  return (
    <Fragment key={p.row.repPin}>
      <Handle
        type={isOutput ? 'source' : 'target'}
        position={position}
        id={`${p.row.repPin}-${isOutput ? 'src' : 'tgt'}`}
        style={visibleStyle}
      />
      <Handle
        type={isOutput ? 'target' : 'source'}
        position={position}
        id={`${p.row.repPin}-${isOutput ? 'tgt' : 'src'}`}
        style={hiddenStyle}
      />
    </Fragment>
  );
}

// A single pin row on a side column — pin NAME only (net mapping lives in the
// Inspector). Highlighted in the active net's category color when focused.
function EdgePinRow({ p, activeNet, activeColor }: { p: PlacedRow; activeNet: string | null; activeColor: string }) {
  const { row } = p;
  const isActive = rowMatchesActive(row.nets, activeNet);
  return (
    <div
      className={`pin-row edge${row.isBus ? ' bus' : ''}${isActive ? ' active-net' : ''}`}
      style={isActive ? { color: activeColor } : undefined}
      title={row.isBus ? row.pins.join(', ') : `${row.pinLabel} → ${row.netLabel}`}
    >
      <span className="pin-name">{row.pinLabel}</span>
    </div>
  );
}

export function InstanceNode({ data }: NodeProps) {
  const d = data as InstanceNodeData;
  const { instance, masterPorts, isSelected, isConnected, activeNet, arraySize } = d;
  const { descend, setSelection, design, currentCell, nodeLayout } = useViewerStore();
  const isArray = (arraySize ?? 1) > 1;

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
  const arrayClass = isArray ? ' array' : '';
  const arrayBadge = isArray ? (
    <span className="array-badge" title={`Array — ${arraySize} members`}>×{arraySize}</span>
  ) : null;

  // BETA: a wide instance block with pins on both side edges. Pins are ordered
  // by group and split evenly between the left and right columns, so big
  // mostly-input blocks are about half as tall. Rows show the pin NAME only;
  // the net mapping is in the Inspector.
  if (nodeLayout === 'beta') {
    const layout = computeRadialLayout(instance.conn, masterPorts, netKindOf);
    return (
      <div
        className={`inst-node beta-edges${stateClass}${arrayClass}`}
        style={{ width: layout.width, height: layout.height }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={isArray ? `Array of ${arraySize} — double-click to descend` : 'Double-click to descend'}
      >
        {layout.rows.map(p => edgeHandle(p, activeNet, activeColor))}

        <div className="inst-head">
          {arrayBadge}
          <span className="inst-id">{instance.id}</span>
          <span className="inst-master" title={instance.master}>{instance.master}</span>
        </div>

        <div className="inst-mid">
          <div className="inst-col in">
            {layout.left.map(p => <EdgePinRow key={p.row.repPin} p={p} activeNet={activeNet} activeColor={activeColor} />)}
          </div>
          <div className="inst-col out">
            {layout.right.map(p => <EdgePinRow key={p.row.repPin} p={p} activeNet={activeNet} activeColor={activeColor} />)}
          </div>
        </div>
      </div>
    );
  }

  // CLASSIC: the four groups stacked as labeled IN/OUT/PWR/GND sections.
  const { sections } = computeInstanceLayout(instance.conn, masterPorts, netKindOf);
  return (
    <div
      className={`inst-node${stateClass}${arrayClass}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={isArray ? `Array of ${arraySize} — double-click to descend` : 'Double-click to descend'}
    >
      {/* Per-row handles — every row (a single pin, or a collapsed bus of
          consecutive pins) gets both a source and a target handle anchored to
          its first pin (repPin). `top` comes from the shared layout so handles
          line up exactly with their rendered rows. */}
      {sections.flatMap(section =>
        section.rows.map(({ row, top }) => {
          const isOutput = section.group === 'output';
          const position = isOutput ? Position.Right : Position.Left;
          const isActive = rowMatchesActive(row.nets, activeNet);
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
        {arrayBadge}
        <span className="inst-id">{instance.id}</span>
        <span className="inst-master" title={instance.master}>{instance.master}</span>
      </div>
      <div className="inst-body">
        {sections.map(section => (
          <div className="pin-section" key={section.group}>
            <div className="pin-section-head" style={{ color: section.color }}>{section.label}</div>
            {section.rows.map(({ row }) => {
              const isActive = rowMatchesActive(row.nets, activeNet);
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
