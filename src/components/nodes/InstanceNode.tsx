import { Fragment, memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import { computeInstanceLayout, computeRadialLayout, type PlacedRow, type PinGroup } from '../../layout/pinGroups';
import { netInBusLabel } from '../../layout/busGrouping';
import type { Instance, Port } from '../../parser/types';

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
  const position = p.side === 'left' ? Position.Left
    : p.side === 'right' ? Position.Right
    : p.side === 'top' ? Position.Top
    : Position.Bottom;
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

// A beta pin label, absolutely placed at its handle (computed in
// computeRadialLayout). Left/right (input/output) labels sit just inside the
// edge next to their dot; top/bottom (supply/ground) labels are centered over
// their dot. Highlighted in the active net's category color when focused.
function BetaPinLabel({ p, width, activeNet, activeColor }: { p: PlacedRow; width: number; activeNet: string | null; activeColor: string }) {
  const { row, side } = p;
  const isActive = rowMatchesActive(row.nets, activeNet);
  const PAD = 9; // gap between the dot and its label
  const style: React.CSSProperties =
    side === 'left' ? { left: p.x + PAD, top: p.y, transform: 'translateY(-50%)', textAlign: 'left' }
    : side === 'right' ? { right: width - p.x + PAD, top: p.y, transform: 'translateY(-50%)', textAlign: 'right' }
    : { left: p.x, top: p.y, transform: 'translate(-50%, -50%)' };
  if (isActive) style.color = activeColor;
  return (
    <div
      className={`beta-pin ${side}${row.isBus ? ' bus' : ''}${isActive ? ' active-net' : ''}`}
      style={style}
      title={row.isBus ? row.pins.join(', ') : `${row.pinLabel} → ${row.netLabel}`}
    >
      {row.pinLabel}
    </div>
  );
}

function InstanceNodeImpl({ data }: NodeProps) {
  const d = data as InstanceNodeData;
  const { instance, masterPorts, isSelected, isConnected, activeNet, arraySize } = d;
  // Subscribe to each slice individually rather than the whole store. Selecting
  // an instance only changes `selection`, which none of these read — so a click
  // no longer re-renders (and re-lays-out) every block on the canvas, just the
  // one or two whose highlight state actually changed. On large hierarchy views
  // with hundreds of blocks, the whole-store subscription made every click
  // re-render all blocks at once, which is what locked the tab up.
  const descend = useViewerStore(s => s.descend);
  const setSelection = useViewerStore(s => s.setSelection);
  const design = useViewerStore(s => s.design);
  const currentCell = useViewerStore(s => s.currentCell);
  const nodeLayout = useViewerStore(s => s.nodeLayout);
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
    <span className="array-badge" title={`Array - ${arraySize} members`}>x{arraySize}</span>
  ) : null;

  // BETA: a schematic-symbol block — inputs on the left edge, outputs on the
  // right, supply along the top, ground along the bottom. Each side wraps into
  // sub-columns when it has many pins, so the block stays compact. All pins are
  // absolutely placed from the shared layout, so labels line up with handles.
  if (nodeLayout === 'beta') {
    const layout = computeRadialLayout(instance.conn, masterPorts, netKindOf);
    return (
      <div
        className={`inst-node beta-edges${stateClass}${arrayClass}`}
        style={{ width: layout.width, height: layout.height }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={isArray ? `Array of ${arraySize} - double-click to descend` : 'Double-click to descend'}
      >
        {layout.rows.map(p => edgeHandle(p, activeNet, activeColor))}

        <div className="inst-head">
          {arrayBadge}
          <span className="inst-id">{instance.id}</span>
          <span className="inst-master" title={instance.master}>{instance.master}</span>
        </div>

        {layout.rows.map(p => (
          <BetaPinLabel key={p.row.repPin} p={p} width={layout.width} activeNet={activeNet} activeColor={activeColor} />
        ))}
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
      title={isArray ? `Array of ${arraySize} - double-click to descend` : 'Double-click to descend'}
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

// React Flow rebuilds the whole `nodes` array (new data objects) on every
// selection change, which would otherwise re-render every block. Skip the
// re-render unless this block's own inputs changed — `instance`/`masterPorts`
// keep a stable reference across rebuilds, so only the blocks whose
// highlight/active-net state flipped actually re-render. nodeLayout/currentCell
// come through the store hooks above and still trigger a re-render when they
// change.
function sameData(a: NodeProps, b: NodeProps): boolean {
  const x = a.data as InstanceNodeData;
  const y = b.data as InstanceNodeData;
  return (
    x.instance === y.instance &&
    x.masterPorts === y.masterPorts &&
    x.isSelected === y.isSelected &&
    x.isConnected === y.isConnected &&
    x.activeNet === y.activeNet &&
    x.arraySize === y.arraySize
  );
}

export const InstanceNode = memo(InstanceNodeImpl, sameData);
