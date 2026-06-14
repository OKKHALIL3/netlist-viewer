import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useViewerStore, type SelectionType, type DiagramStyle } from '../store/viewerStore';
import { layoutCell, rectCenter, rectExitPoint } from '../layout/elk';
import { InstanceNode, type InstanceNodeData } from './nodes/InstanceNode';
import { PrimitiveNode, type PrimitiveNodeData } from './nodes/PrimitiveNode';
import { PortNode, type PortNodeData } from './nodes/PortNode';
import { FloatingEdge, type FloatingEdgeData } from './edges/FloatingEdge';
import type { Cell, Design, Net } from '../parser/types';
import type { NodePosition } from '../layout/elk';

const nodeTypes = { instanceNode: InstanceNode, primitiveNode: PrimitiveNode, portNode: PortNode };
const edgeTypes = { floating: FloatingEdge };

// Extra perpendicular spacing applied to parallel floating edges between the
// same pair of nodes, so they don't draw exactly on top of each other.
const FLOAT_PARALLEL_OFFSET = 14;

function netColor(net: Net): string {
  if (net.kind === 'power') return 'var(--net-pwr)';
  if (net.kind === 'ground') return 'var(--net-gnd)';
  return 'var(--net-sig)';
}

function pinIsOutput(name: string): boolean {
  return /^(out|y|z|q|qb?|do|dout|co|cout|s|sum|f|g)$/i.test(name) || /(_o|_out|_y)$/i.test(name);
}

// A cell-boundary connection appears in a net's endpoints as ["__port__", portName].
// Give each port its own node id so it can be laid out and drawn like any
// other node, instead of being dropped (which left boundary-connected pins
// looking unconnected).
function portNodeId(pin: string): string {
  return `__port__:${pin}`;
}

// Selecting a node or net highlights everything electrically connected to it:
// the nets touching the selected node (or, for a selected net, that net
// itself) and every node those nets touch.
function computeHighlight(cell: Cell, selection: SelectionType | null): { nets: Set<string>; nodes: Set<string> } {
  const nets = new Set<string>();
  const nodes = new Set<string>();
  if (!selection) return { nets, nodes };

  // Power/ground nets are shared by nearly every block in the design, so
  // following them would highlight almost everything — only trace signal nets.
  const addNet = (net: Net) => {
    if (net.kind !== 'signal') return;
    nets.add(net.name);
    for (const [id, pin] of net.endpoints) {
      nodes.add(id === '__port__' ? portNodeId(pin) : id);
    }
  };

  if (selection.type === 'net') {
    const net = cell.nets.find(n => n.name === selection.name);
    if (net) addNet(net);
    return { nets, nodes };
  }

  for (const net of cell.nets) {
    if (net.endpoints.some(([id]) => id === selection.id)) addNet(net);
  }
  return { nets, nodes };
}

function buildGraph(
  cell: Cell,
  selection: SelectionType | null,
  mode: string,
  hideSupply: boolean,
  focusNet: string | null,
  design: Design | null,
  positions: Map<string, NodePosition>,
  diagramStyle: DiagramStyle,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const { nets: highlightedNets, nodes: highlightedNodes } = computeHighlight(cell, selection);

  for (const inst of cell.instances) {
    const pos = positions.get(inst.id);
    if (!pos) continue;
    const masterPorts = design?.cells.get(inst.master)?.ports ?? [];
    const isSelected = selection?.type === 'instance' && selection.id === inst.id;
    const isConnected = !isSelected && highlightedNodes.has(inst.id);
    // Simple mode collapses instances to a header-only card unless selected,
    // in which case the card expands in place (overlaying neighbors, hence
    // the bumped zIndex) to show its full pin table.
    const isExpanded = diagramStyle === 'detailed' || isSelected;
    nodes.push({
      id: inst.id,
      type: 'instanceNode',
      position: { x: pos.x, y: pos.y },
      data: { instance: inst, masterPorts, isSelected, isConnected, isExpanded } as InstanceNodeData,
      style: { width: pos.width },
      zIndex: diagramStyle === 'simple' && isExpanded ? 1000 : undefined,
    });
  }

  for (const prim of cell.primitives) {
    const pos = positions.get(prim.id);
    if (!pos) continue;
    const isSelected = selection?.type === 'primitive' && selection.id === prim.id;
    const isConnected = !isSelected && highlightedNodes.has(prim.id);
    nodes.push({
      id: prim.id,
      type: 'primitiveNode',
      position: { x: pos.x, y: pos.y },
      data: { primitive: prim, isSelected, isConnected } as PrimitiveNodeData,
    });
  }

  if (mode !== 'inst') {
    const addedPorts = new Set<string>();

    // Simple mode: collect floating-edge endpoints first, then group by node
    // pair below so parallel edges between the same two nodes can be spread
    // apart instead of drawing exactly on top of each other.
    interface PendingFloatEdge {
      id: string;
      srcId: string;
      tgtId: string;
      sourcePoint: { x: number; y: number };
      targetPoint: { x: number; y: number };
      label: string;
      labelStyle: Record<string, unknown>;
      labelBgStyle: Record<string, unknown>;
      style: Record<string, unknown>;
    }
    const pendingFloat: PendingFloatEdge[] = [];

    for (const net of cell.nets) {
      if (hideSupply && net.kind !== 'signal' && mode !== 'net') continue;

      const isFocused = focusNet === net.name;
      const isHighlighted = highlightedNets.has(net.name);
      const isDimmed = focusNet !== null && !isFocused && mode === 'net';

      const eps = net.endpoints.map(([id, pin]) =>
        id === '__port__' ? { nodeId: portNodeId(pin), handle: 'port', portName: pin } : { nodeId: id, handle: pin, portName: null }
      );

      // Render a node for each cell-boundary port this net touches.
      for (const ep of eps) {
        if (!ep.portName || addedPorts.has(ep.nodeId)) continue;
        const pos = positions.get(ep.nodeId);
        const port = cell.ports.find(p => p.name === ep.portName);
        if (!pos || !port) continue;
        addedPorts.add(ep.nodeId);
        nodes.push({
          id: ep.nodeId,
          type: 'portNode',
          position: { x: pos.x, y: pos.y },
          data: { port, isFocused, isHighlighted } as PortNodeData,
        });
      }

      const realEps = eps.filter(ep => positions.has(ep.nodeId));
      if (realEps.length < 2) continue;

      const color = (isFocused || isHighlighted) ? 'var(--sel)' : netColor(net);
      const opacity = isDimmed ? 0.05 : (isFocused || isHighlighted) ? 0.95 : 0.65;
      const strokeWidth = (isFocused || isHighlighted) ? 2.4 : 1.6;

      const outIdx = realEps.findIndex(ep => pinIsOutput(ep.handle));
      const srcIdx = outIdx !== -1 ? outIdx : 0;
      const { nodeId: srcId, handle: srcPin } = realEps[srcIdx];

      const labelStyle = {
        fill: isDimmed ? 'transparent' : 'var(--txt-faint)',
        fontSize: 9,
        fontFamily: 'Space Mono, monospace',
      };
      const labelBgStyle = { fill: '#10141a', fillOpacity: (isFocused || isHighlighted) ? 0.9 : 0 };
      const edgeStyle = { stroke: color, strokeWidth, opacity };

      for (let i = 0; i < realEps.length; i++) {
        if (i === srcIdx) continue;
        const { nodeId: tgtId, handle: tgtPin } = realEps[i];

        if (diagramStyle === 'simple') {
          const srcPos = positions.get(srcId);
          const tgtPos = positions.get(tgtId);
          if (!srcPos || !tgtPos) continue;
          const srcCenter = rectCenter(srcPos);
          const tgtCenter = rectCenter(tgtPos);
          pendingFloat.push({
            id: `e_${net.name}_${i}`,
            srcId,
            tgtId,
            sourcePoint: rectExitPoint(srcPos, tgtCenter.x, tgtCenter.y),
            targetPoint: rectExitPoint(tgtPos, srcCenter.x, srcCenter.y),
            label: net.name,
            labelStyle,
            labelBgStyle,
            style: edgeStyle,
          });
          continue;
        }

        edges.push({
          id: `e_${net.name}_${i}`,
          source: srcId,
          sourceHandle: `${srcPin}-src`,
          target: tgtId,
          targetHandle: `${tgtPin}-tgt`,
          type: 'smoothstep',
          label: net.name,
          labelStyle,
          labelBgStyle,
          style: edgeStyle,
          data: { netName: net.name },
        });
      }
    }

    // Spread parallel floating edges (same node pair, either direction)
    // apart perpendicular to the line between them.
    if (pendingFloat.length > 0) {
      const groups = new Map<string, PendingFloatEdge[]>();
      for (const pe of pendingFloat) {
        const key = [pe.srcId, pe.tgtId].sort().join('|');
        const group = groups.get(key);
        if (group) group.push(pe);
        else groups.set(key, [pe]);
      }
      for (const group of groups.values()) {
        const n = group.length;
        group.forEach((pe, idx) => {
          let { sourcePoint, targetPoint } = pe;
          if (n > 1) {
            const offset = (idx - (n - 1) / 2) * FLOAT_PARALLEL_OFFSET;
            const dx = targetPoint.x - sourcePoint.x;
            const dy = targetPoint.y - sourcePoint.y;
            const len = Math.hypot(dx, dy) || 1;
            const px = (-dy / len) * offset;
            const py = (dx / len) * offset;
            sourcePoint = { x: sourcePoint.x + px, y: sourcePoint.y + py };
            targetPoint = { x: targetPoint.x + px, y: targetPoint.y + py };
          }
          edges.push({
            id: pe.id,
            source: pe.srcId,
            sourceHandle: 'float-src',
            target: pe.tgtId,
            targetHandle: 'float-tgt',
            type: 'floating',
            label: pe.label,
            labelStyle: pe.labelStyle,
            labelBgStyle: pe.labelBgStyle,
            style: pe.style,
            data: { netName: pe.label, sourcePoint, targetPoint } as FloatingEdgeData,
          });
        });
      }
    }
  }

  return { nodes, edges };
}

function Canvas() {
  const { design, currentCell, mode, diagramStyle, hideSupply, focusNet, selection, setSelection, setFocusNet, focusRequest } =
    useViewerStore();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const [laying, setLaying] = useState(false);
  const { fitView, fitBounds } = useReactFlow();

  const cell = design?.cells.get(currentCell);

  useEffect(() => {
    if (!cell) return;
    setLaying(true);
    layoutCell(cell, diagramStyle).then(pos => { setPositions(pos); setLaying(false); });
  }, [currentCell, diagramStyle]);

  useEffect(() => {
    if (!cell || positions.size === 0) return;
    const { nodes: n, edges: e } = buildGraph(cell, selection, mode, hideSupply, focusNet, design, positions, diagramStyle);
    setNodes(n);
    setEdges(e);
  }, [cell, positions, selection, mode, hideSupply, focusNet, design, diagramStyle]);

  // Pan/zoom the viewport to the current selection whenever the cell changed
  // (descend/ascend/search jumped here) or a search jump landed on a result
  // already in this cell. Plain in-canvas clicks don't trigger this, so the
  // camera doesn't jump around during normal exploration.
  //
  // This is computed from the ELK `positions` map directly (not from the
  // rendered React Flow nodes) — calling fitView/fitBounds in the same tick
  // as setNodes would otherwise act on unmeasured nodes and silently no-op.
  const prevCellRef = useRef<string | null>(null);
  const prevFocusRef = useRef(focusRequest);
  const prevStyleRef = useRef(diagramStyle);
  useEffect(() => {
    if (!cell || positions.size === 0) return;
    const cellChanged = prevCellRef.current !== currentCell;
    const navRequested = prevFocusRef.current !== focusRequest;
    // Simple/Detailed reflows the whole cell (instance sizes change), so
    // refit to everything rather than just the current selection.
    const styleChanged = prevStyleRef.current !== diagramStyle;
    if (!cellChanged && !navRequested && !styleChanged) return;
    prevCellRef.current = currentCell;
    prevFocusRef.current = focusRequest;
    prevStyleRef.current = diagramStyle;

    let targetIds: string[] = [];
    if (!styleChanged && (selection?.type === 'instance' || selection?.type === 'primitive')) {
      targetIds = [selection.id];
    } else if (!styleChanged && selection?.type === 'net') {
      targetIds = [...computeHighlight(cell, selection).nodes];
    }
    if (targetIds.length === 0) targetIds = [...positions.keys()];

    const boxes = targetIds.map(id => positions.get(id)).filter((p): p is NodePosition => !!p);
    if (boxes.length === 0) return;
    const minX = Math.min(...boxes.map(p => p.x));
    const minY = Math.min(...boxes.map(p => p.y));
    const maxX = Math.max(...boxes.map(p => p.x + p.width));
    const maxY = Math.max(...boxes.map(p => p.y + p.height));
    fitBounds(
      { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) },
      { padding: 0.3, duration: 400 },
    );
  }, [positions, currentCell, focusRequest, diagramStyle, selection, cell, fitBounds]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(eds => applyEdgeChanges(changes, eds));
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const netName = (edge.data as { netName: string } | undefined)?.netName;
    if (!netName) return;
    if (mode === 'net') setFocusNet(netName);
    setSelection({ type: 'net', name: netName });
  }, [mode, setFocusNet, setSelection]);

  const onPaneClick = useCallback(() => {
    setSelection(null);
    if (mode === 'net') setFocusNet(null);
  }, [mode, setSelection, setFocusNet]);

  // "F" key → fit view (standard EDA shortcut)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        fitView({ padding: 0.15, duration: 300 });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fitView]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {laying && <div className="layout-spinner">Computing layout…</div>}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} color="#1c232e" gap={22} size={1.2} />
        <Controls showInteractive={false} style={{ background: 'var(--panel)', border: '1px solid var(--line)' }} />
      </ReactFlow>
      <div className="canvas-legend">
        <div className="legend-row"><span className="legend-line sig" />signal net</div>
        <div className="legend-row"><span className="legend-line pwr" />power net</div>
        <div className="legend-row"><span className="legend-line gnd" />ground net</div>
        <div className="legend-row"><span className="legend-line sel" />selected / focus</div>
      </div>
      <button
        className="fit-btn"
        onClick={() => fitView({ padding: 0.15, duration: 300 })}
        title="Fit view (F)"
      >
        ⊡ Fit  <kbd>F</kbd>
      </button>
      <div className="canvas-hint">click a block, port, or net to highlight its connections · double-click to descend · click a wire to focus net</div>
    </div>
  );
}

export function SchematicCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
