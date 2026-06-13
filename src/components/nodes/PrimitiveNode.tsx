import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Primitive } from '../../parser/types';

export interface PrimitiveNodeData extends Record<string, unknown> {
  primitive: Primitive;
  isSelected: boolean;
  isConnected: boolean;
}

const KIND_COLOR: Record<string, string> = {
  M: 'var(--m)',
  R: 'var(--r)',
  C: 'var(--c)',
};

export function PrimitiveNode({ data }: NodeProps) {
  const d = data as PrimitiveNodeData;
  const { primitive, isSelected, isConnected } = d;
  const { setSelection } = useViewerStore();

  const color = KIND_COLOR[primitive.kind] ?? 'var(--txt-dim)';
  const numTerms = primitive.terms.length;
  const midPoint = numTerms / 2;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection({ type: 'primitive', id: primitive.id });
  };

  return (
    <div
      className={`prim-node${isSelected ? ' sel' : isConnected ? ' connected' : ''}`}
      onClick={handleClick}
      style={{ '--prim-color': color } as React.CSSProperties}
    >
      {/* Left-side terminals (first half) — visible target handle plus an
          invisible source handle at the same spot, so an edge that picks
          this terminal as its "source" still has a handle to anchor to. */}
      {primitive.terms.slice(0, Math.ceil(midPoint)).map(([term], i) => (
        <Fragment key={`l-${term}`}>
          <Handle
            type="target"
            position={Position.Left}
            id={`${term}-tgt`}
            style={{ top: 8 + i * 16, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }}
          />
          <Handle
            type="source"
            position={Position.Left}
            id={`${term}-src`}
            style={{ top: 8 + i * 16, width: 7, height: 7, opacity: 0, pointerEvents: 'none' }}
          />
        </Fragment>
      ))}

      {/* Right-side terminals (second half) — same pairing, mirrored. */}
      {primitive.terms.slice(Math.ceil(midPoint)).map(([term], i) => (
        <Fragment key={`r-${term}`}>
          <Handle
            type="source"
            position={Position.Right}
            id={`${term}-src`}
            style={{ top: 8 + i * 16, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }}
          />
          <Handle
            type="target"
            position={Position.Right}
            id={`${term}-tgt`}
            style={{ top: 8 + i * 16, width: 7, height: 7, opacity: 0, pointerEvents: 'none' }}
          />
        </Fragment>
      ))}

      <div className="prim-glyph">{primitive.kind}</div>
      <div className="prim-label">
        <span>{primitive.id}</span>
        <span className="prim-model">{primitive.model}</span>
      </div>
    </div>
  );
}
