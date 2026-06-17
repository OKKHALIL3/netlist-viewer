import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Primitive } from '../../parser/types';
import { deviceSymbol, mosPolarity, supplyStub } from './deviceSymbols';

export interface PrimitiveNodeData extends Record<string, unknown> {
  primitive: Primitive;
  isSelected: boolean;
  isConnected: boolean;
  // Terminals tied to a supply/ground net whose wire is currently hidden
  // ("hide supply"). Each is capped with a ground/VDD stub glyph instead of
  // left as a bare, floating-looking pin. Keyed by terminal name.
  supplyStubs?: Record<string, 'power' | 'ground'>;
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
  const { primitive, isSelected, isConnected, supplyStubs } = d;
  const { setSelection } = useViewerStore();

  const color = KIND_COLOR[primitive.kind] ?? 'var(--txt-dim)';
  const sym = deviceSymbol(primitive);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection({ type: 'primitive', id: primitive.id });
  };

  const stateClass = isSelected ? ' sel' : isConnected ? ' connected' : '';

  // Fallback: no symbol for this kind — keep the old labelled glyph box so
  // unusual devices still render and stay wired.
  if (!sym) {
    return (
      <div
        className={`prim-node${stateClass}`}
        onClick={handleClick}
        style={{ '--prim-color': color } as React.CSSProperties}
      >
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

  // Ground/VDD stub glyphs for any terminal whose supply wire is hidden, so a
  // cap/transistor reads as terminated instead of having a floating pin.
  const stubs = supplyStubs
    ? primitive.terms.flatMap(([term]) => {
        const kind = supplyStubs[term];
        const slot = sym.slots[term];
        return kind && slot ? [supplyStub(term, slot, kind)] : [];
      })
    : [];

  return (
    <div
      className={`prim-node sym${stateClass}`}
      onClick={handleClick}
      style={{ '--prim-color': color } as React.CSSProperties}
    >
      <div className="prim-symbol" style={{ width: sym.width, height: sym.height }}>
        {/* The bare glyph draws in its own coordinate box; offset it so the
            reserved stub margins surround it (slots/handles are already in
            footprint coordinates). */}
        <div className="dev-core" style={{ position: 'absolute', left: sym.drawX, top: sym.drawY }}>
          {sym.svg}
        </div>

        {/* Supply stubs: ground/VDD glyphs standing in for the wires hidden by
            "hide supply", so terminals don't look unconnected. */}
        {stubs.length > 0 && (
          <svg className="dev-stubs" width={sym.width} height={sym.height}>{stubs}</svg>
        )}

        {/* One source + one target handle per terminal, anchored exactly on the
            symbol's terminal tip. Either may be picked as a net's source, so
            both exist at the same spot; the visible dot is the target. A
            stubbed terminal hides its dot — the ground/VDD glyph already shows
            the termination, so a bare pin would just read as redundant. */}
        {primitive.terms.map(([term]) => {
          const slot = sym.slots[term];
          if (!slot) return null;
          const stubbed = !!supplyStubs?.[term];
          const posStyle = { left: slot.x, top: slot.y, transform: 'translate(-50%, -50%)' };
          return (
            <Fragment key={term}>
              <Handle
                type="target"
                position={slot.position}
                id={`${term}-tgt`}
                style={stubbed
                  ? { ...posStyle, width: 7, height: 7, opacity: 0, pointerEvents: 'none' }
                  : { ...posStyle, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }}
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
