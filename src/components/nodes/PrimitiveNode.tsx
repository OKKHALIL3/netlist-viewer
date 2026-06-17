import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Primitive } from '../../parser/types';
import { deviceSymbol, mosPolarity } from './deviceSymbols';

export interface PrimitiveNodeData extends Record<string, unknown> {
  primitive: Primitive;
  isSelected: boolean;
  isConnected: boolean;
  // >1 when this device stands in for a scalarized device array (e.g.
  // M0<4095:0>): rendered as a stacked symbol with a ×N badge.
  arraySize?: number;
}

const KIND_COLOR: Record<string, string> = {
  M: 'var(--m)',
  R: 'var(--r)',
  C: 'var(--c)',
};

// A device's display kind, used for the small caption under the symbol.
function kindLabel(prim: Primitive): string {
  if (prim.kind === 'M') {
    const p = mosPolarity(prim.model);
    return p === 'p' ? 'PMOS' : p === 'n' ? 'NMOS' : 'MOS';
  }
  return prim.kind === 'R' ? 'RES' : prim.kind === 'C' ? 'CAP' : prim.kind;
}

export function PrimitiveNode({ data }: NodeProps) {
  const d = data as PrimitiveNodeData;
  const { primitive, isSelected, isConnected, arraySize } = d;
  const { setSelection } = useViewerStore();

  const color = KIND_COLOR[primitive.kind] ?? 'var(--txt-dim)';
  const sym = deviceSymbol(primitive);
  const isArray = (arraySize ?? 1) > 1;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection({ type: 'primitive', id: primitive.id });
  };

  const stateClass = isSelected ? ' sel' : isConnected ? ' connected' : '';
  const arrayClass = isArray ? ' array' : '';
  const arrayBadge = isArray ? (
    <div className="array-badge" title={`Array — ${arraySize} devices`}>×{arraySize}</div>
  ) : null;

  // Fallback: no symbol for this kind — keep the old labelled glyph box so
  // unusual devices still render and stay wired.
  if (!sym) {
    return (
      <div
        className={`prim-node${stateClass}${arrayClass}`}
        onClick={handleClick}
        style={{ '--prim-color': color } as React.CSSProperties}
      >
        {arrayBadge}
        {primitive.terms.map(([term], i) => (
          <Fragment key={term}>
            <Handle type="target" position={Position.Left} id={`${term}-tgt`}
              style={{ top: 8 + i * 16, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }} />
            <Handle type="source" position={Position.Left} id={`${term}-src`}
              style={{ top: 8 + i * 16, width: 7, height: 7, opacity: 0, pointerEvents: 'none' }} />
          </Fragment>
        ))}
        <div className="prim-glyph">{primitive.kind}</div>
        <div className="prim-label">
          <span title={primitive.id}>{primitive.id}</span>
          <span className="prim-model" title={primitive.model}>{primitive.model}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`prim-node sym${stateClass}${arrayClass}`}
      onClick={handleClick}
      style={{ '--prim-color': color } as React.CSSProperties}
    >
      {arrayBadge}
      <div className="prim-symbol" style={{ width: sym.width, height: sym.height }}>
        {sym.svg}
        {/* One source + one target handle per terminal, anchored exactly on the
            symbol's terminal tip. Either may be picked as a net's source, so
            both exist at the same spot; the visible dot is the target. */}
        {primitive.terms.map(([term]) => {
          const slot = sym.slots[term];
          if (!slot) return null;
          const posStyle = { left: slot.x, top: slot.y, transform: 'translate(-50%, -50%)' };
          return (
            <Fragment key={term}>
              <Handle
                type="target"
                position={slot.position}
                id={`${term}-tgt`}
                style={{ ...posStyle, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }}
              />
              <Handle
                type="source"
                position={slot.position}
                id={`${term}-src`}
                style={{ ...posStyle, width: 7, height: 7, opacity: 0, pointerEvents: 'none' }}
              />
            </Fragment>
          );
        })}
      </div>
      <div className="prim-label">
        <span title={primitive.id}>{primitive.id}</span>
        <span className="prim-model" title={primitive.model}>{kindLabel(primitive)} · {primitive.model}</span>
      </div>
    </div>
  );
}
