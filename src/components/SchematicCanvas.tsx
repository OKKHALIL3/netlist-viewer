import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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

import { useViewerStore } from '../store/viewerStore';
import { layoutCell, type NodePosition } from '../layout/elk';
import { buildGraph, buildPinMaps, computeHighlight } from '../viz/buildScene';
import { InstanceNode } from './nodes/InstanceNode';
import { PrimitiveNode } from './nodes/PrimitiveNode';
import { PortNode } from './nodes/PortNode';

const nodeTypes = { instanceNode: InstanceNode, primitiveNode: PrimitiveNode, portNode: PortNode };

function Canvas() {
  const { design, currentCell, mode, nodeLayout, hideSupply, focusNet, selection, setSelection, setFocusNet, focusRequest } =
    useViewerStore();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const [laying, setLaying] = useState(false);
  const { fitView, fitBounds } = useReactFlow();

  // Power/ground wires are suppressed while "Hide supply nets" is on (except in
  // Net mode, which always draws them) — see the matching guard in buildGraph.
  // The legend greys out those entries so it matches what's actually drawn.
  const supplyHidden = hideSupply && mode !== 'net';

  const cell = design?.cells.get(currentCell);

  // Selection-independent per-cell pin/handle maps. Rebuilt only when the cell
  // (or design) changes — not on every selection click, which on big cells
  // would otherwise re-run a per-instance layout for all ~500 blocks each time.
  const pinMaps = useMemo(() => (cell ? buildPinMaps(cell, design) : null), [cell, design]);

  useEffect(() => {
    if (!cell) return;
    setLaying(true);
    layoutCell(cell, design, nodeLayout).then(pos => { setPositions(pos); setLaying(false); });
  }, [currentCell, design, nodeLayout]);

  useEffect(() => {
    if (!cell || !pinMaps || positions.size === 0) return;
    const { nodes: n, edges: e } = buildGraph(cell, selection, mode, hideSupply, focusNet, design, positions, pinMaps);
    setNodes(n);
    setEdges(e);
  }, [cell, pinMaps, positions, selection, mode, hideSupply, focusNet, design]);

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
  useEffect(() => {
    if (!cell || positions.size === 0) return;
    const cellChanged = prevCellRef.current !== currentCell;
    const navRequested = prevFocusRef.current !== focusRequest;
    if (!cellChanged && !navRequested) return;
    prevCellRef.current = currentCell;
    prevFocusRef.current = focusRequest;

    let targetIds: string[] = [];
    if (selection?.type === 'instance' || selection?.type === 'primitive') {
      targetIds = [selection.id];
    } else if (selection?.type === 'net') {
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
  }, [positions, currentCell, focusRequest, selection, cell, fitBounds]);

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
        <div className={`legend-row${supplyHidden ? ' muted' : ''}`}>
          <span className="legend-line pwr" />power net{supplyHidden && ' (hidden)'}
        </div>
        <div className={`legend-row${supplyHidden ? ' muted' : ''}`}>
          <span className="legend-line gnd" />ground net{supplyHidden && ' (hidden)'}
        </div>
        <div className="legend-row legend-note">selected / focus → brighter</div>
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
