import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useViewerStore } from '../../store/viewerStore';
import type { Primitive } from '../../parser/types';

export interface PrimitiveNodeData extends Record<string, unknown> {
  primitive: Primitive;
  isSelected: boolean;
}

const KIND_COLOR: Record<string, string> = {
  M: 'var(--m)',
  R: 'var(--r)',
  C: 'var(--c)',
};

export function PrimitiveNode({ data }: NodeProps) {
  const d = data as PrimitiveNodeData;
  const { primitive, isSelected } = d;
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
      className={`prim-node${isSelected ? ' sel' : ''}`}
      onClick={handleClick}
      style={{ '--prim-color': color } as React.CSSProperties}
    >
      {/* Left-side handles (first half of terminals) */}
      {primitive.terms.slice(0, Math.ceil(midPoint)).map(([term], i) => (
        <Handle
          key={`t-${term}`}
          type="target"
          position={Position.Left}
          id={`${term}-tgt`}
          style={{ top: 8 + i * 16, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }}
        />
      ))}

      {/* Right-side handles (second half of terminals) */}
      {primitive.terms.slice(Math.ceil(midPoint)).map(([term], i) => (
        <Handle
          key={`s-${term}`}
          type="source"
          position={Position.Right}
          id={`${term}-src`}
          style={{ top: 8 + i * 16, width: 7, height: 7, background: color, border: '2px solid var(--bg)' }}
        />
      ))}

      <div className="prim-glyph">{primitive.kind}</div>
      <div className="prim-label">
        <span>{primitive.id}</span>
        <span className="prim-model">{primitive.model}</span>
      </div>
    </div>
  );
}
