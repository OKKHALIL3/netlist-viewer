import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type EdgeProps } from '@xyflow/react';
import { rectCenter, rectExitPoint, type NodePosition } from '../../layout/elk';

export interface FloatingEdgeData extends Record<string, unknown> {
  netName: string;
  // Perpendicular offset (px) applied to spread parallel edges between the
  // same node pair apart from each other.
  offset?: number;
}

// A straight edge drawn between the nearest border points of its two nodes
// (the points facing each other), instead of fixed per-pin handles — used in
// "simple" diagram mode so wires take the shortest path between blocks
// regardless of which pins they connect. Endpoints are recomputed from live
// node positions on every render so the wire follows its nodes when dragged.
export function FloatingEdge({ data, style, label, labelStyle, labelBgStyle, source, target }: EdgeProps) {
  const d = data as FloatingEdgeData | undefined;
  const srcNode = useInternalNode(source);
  const tgtNode = useInternalNode(target);
  if (!d || !srcNode || !tgtNode) return null;

  const srcPos: NodePosition = {
    x: srcNode.internals.positionAbsolute.x,
    y: srcNode.internals.positionAbsolute.y,
    width: srcNode.measured.width ?? 0,
    height: srcNode.measured.height ?? 0,
  };
  const tgtPos: NodePosition = {
    x: tgtNode.internals.positionAbsolute.x,
    y: tgtNode.internals.positionAbsolute.y,
    width: tgtNode.measured.width ?? 0,
    height: tgtNode.measured.height ?? 0,
  };

  const srcCenter = rectCenter(srcPos);
  const tgtCenter = rectCenter(tgtPos);
  let sourcePoint = rectExitPoint(srcPos, tgtCenter.x, tgtCenter.y);
  let targetPoint = rectExitPoint(tgtPos, srcCenter.x, srcCenter.y);

  const offset = d.offset ?? 0;
  if (offset !== 0) {
    const dx = targetPoint.x - sourcePoint.x;
    const dy = targetPoint.y - sourcePoint.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * offset;
    const py = (dx / len) * offset;
    sourcePoint = { x: sourcePoint.x + px, y: sourcePoint.y + py };
    targetPoint = { x: targetPoint.x + px, y: targetPoint.y + py };
  }

  const [path, labelX, labelY] = getStraightPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
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
