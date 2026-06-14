import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react';

export interface FloatingEdgeData extends Record<string, unknown> {
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
  netName: string;
}

// A straight edge drawn between two pre-computed points (the nearest border
// point of each node facing the other), instead of fixed per-pin handles —
// used in "simple" diagram mode so wires take the shortest path between
// blocks regardless of which pins they connect.
export function FloatingEdge({ data, style, label, labelStyle, labelBgStyle }: EdgeProps) {
  const d = data as FloatingEdgeData | undefined;
  if (!d?.sourcePoint || !d?.targetPoint) return null;

  const [path, labelX, labelY] = getStraightPath({
    sourceX: d.sourcePoint.x,
    sourceY: d.sourcePoint.y,
    targetX: d.targetPoint.x,
    targetY: d.targetPoint.y,
  });

  const showLabelBg = typeof labelBgStyle?.fillOpacity === 'number' && labelBgStyle.fillOpacity > 0;

  return (
    <>
      <BaseEdge path={path} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="floating-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              ...labelStyle,
              background: showLabelBg ? (labelBgStyle?.fill as string) : 'transparent',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
