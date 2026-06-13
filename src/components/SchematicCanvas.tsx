import { useEffect, useState, useCallback } from 'react';
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

import { useViewerStore, type SelectionType } from '../store/viewerStore';
import { layoutCell } from '../layout/elk';
import { InstanceNode, type InstanceNodeData } from './nodes/InstanceNode';
import { PrimitiveNode, type PrimitiveNodeData } from './nodes/PrimitiveNode';
import { PortNode, type PortNodeData } from './nodes/PortNode';
import type { Cell, Design, Net } from '../parser/types';
import type { NodePosition } from '../layout/elk';

const nodeTypes = { instanceNode: InstanceNode, primitiveNode: PrimitiveNode, portNode: PortNode };

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

  const addNet = (net: Net) => {
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
    nodes.push({
      id: inst.id,
      type: 'instanceNode',
      position: { x: pos.x, y: pos.y },
      data: { instance: inst, masterPorts, isSelected, isConnected } as InstanceNodeData,
      style: { width: pos.width },
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
          data: { port, netKind: net.kind, isFocused, isHighlighted } as PortNodeData,
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

      for (let i = 0; i < realEps.length; i++) {
        if (i === srcIdx) continue;
        const { nodeId: tgtId, handle: tgtPin } = realEps[i];
        edges.push({
          id: `e_${net.name}_${i}`,
          source: srcId,
          sourceHandle: `${srcPin}-src`,
          target: tgtId,
          targetHandle: `${tgtPin}-tgt`,
          type: 'smoothstep',
          label: net.name,
          labelStyle: {
            fill: isDimmed ? 'transparent' : 'var(--txt-faint)',
            fontSize: 9,
            fontFamily: 'Space Mono, monospace',
          },
          labelBgStyle: { fill: '#10141a', fillOpacity: (isFocused || isHighlighted) ? 0.9 : 0 },
          style: { stroke: color, strokeWidth, opacity },
          data: { netName: net.name },
        });
      }
    }
  }

  return { nodes, edges };
}

function Canvas() {
  const { design, currentCell, mode, hideSupply, focusNet, selection, setSelection, setFocusNet } =
    useViewerStore();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const [laying, setLaying] = useState(false);
  const { fitView } = useReactFlow();

  const cell = design?.cells.get(currentCell);

  useEffect(() => {
    if (!cell) return;
    setLaying(true);
    layoutCell(cell).then(pos => { setPositions(pos); setLaying(false); });
  }, [currentCell]);

  useEffect(() => {
    if (!cell || positions.size === 0) return;
    const { nodes: n, edges: e } = buildGraph(cell, selection, mode, hideSupply, focusNet, design, positions);
    setNodes(n);
    setEdges(e);
  }, [cell, positions, selection, mode, hideSupply, focusNet, design]);

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
