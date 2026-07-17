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

import { useViewerStore, type SelectionType } from '../store/viewerStore';
import { layoutCell, layoutCellGrouped } from '../layout/elk';
import { clusterBusRibbons } from '../layout/busGrouping';
import { computeInstanceLayout, pinDirection } from '../layout/pinGroups';
import { buildCellView, type CellView } from '../layout/cellView';
import { isFloatingNet } from '../layout/netStatus';
import { computeGroups, type OrganizeGroup } from '../organize/groups';
import { labelGroups, getCachedGroupLabels, type GroupLabels } from '../organize/labelGroups';
import { getApiKey } from '../ai/describeCell';
import { InstanceNode, type InstanceNodeData } from './nodes/InstanceNode';
import { PrimitiveNode, type PrimitiveNodeData } from './nodes/PrimitiveNode';
import { PortNode, type PortNodeData } from './nodes/PortNode';
import { GroupNode, type GroupNodeData } from './nodes/GroupNode';
import type { Design, Net, Port } from '../parser/types';
import type { NodePosition } from '../layout/elk';

const nodeTypes = { instanceNode: InstanceNode, primitiveNode: PrimitiveNode, portNode: PortNode, groupNode: GroupNode };

// One padding for every "fit the whole thing" path — the F key, the Fit button,
// the initial fit and the fit on arriving at a cell — so they all land on the
// same view. Framing one selected target zooms closer, with more air around it.
const FIT_PADDING = 0.15;
const ZOOM_TO_TARGET_PADDING = 0.3;
const FIT_DURATION = 300;

// Decorative section boxes for the Organize view. Placed FIRST in the node
// array so they paint behind the real blocks, and non-interactive so a click
// falls through to the block inside.
function buildGroupNodes(
  groups: OrganizeGroup[],
  boxes: Map<string, NodePosition>,
  labels: GroupLabels,
): Node[] {
  const out: Node[] = [];
  for (const g of groups) {
    const box = boxes.get(g.id);
    if (!box) continue;
    const lab = labels[g.id];
    out.push({
      id: `__group__:${g.id}`,
      type: 'groupNode',
      position: { x: box.x, y: box.y },
      data: { label: lab?.name ?? g.label, note: lab?.note ?? '', kind: g.kind } as GroupNodeData,
      style: { width: box.width, height: box.height },
      selectable: false,
      draggable: false,
      connectable: false,
      zIndex: 0,
    });
  }
  return out;
}

function netColor(net: Net): string {
  if (net.kind === 'power') return 'var(--net-pwr)';
  if (net.kind === 'ground') return 'var(--net-gnd)';
  return 'var(--net-sig)';
}

// Selected/focused nets aren't a separate golden color — they're a brighter
// neon version of the net's own category color.
function netColorHi(net: Net): string {
  if (net.kind === 'power') return 'var(--net-pwr-hi)';
  if (net.kind === 'ground') return 'var(--net-gnd-hi)';
  return 'var(--net-sig-hi)';
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
function computeHighlight(cell: CellView, selection: SelectionType | null): { nets: Set<string>; nodes: Set<string> } {
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

  // An explicit net selection highlights that exact net even when it's a shared
  // power/ground rail — the user clicked this specific wire/pin. The signal-only
  // guard in addNet only applies when tracing outward from a selected *node*,
  // where following a rail would light up nearly the whole design.
  if (selection.type === 'net') {
    const net = cell.nets.find(n => n.name === selection.name);
    if (net) {
      nets.add(net.name);
      for (const [id, pin] of net.endpoints) {
        nodes.add(id === '__port__' ? portNodeId(pin) : id);
      }
    }
    return { nets, nodes };
  }

  // An instance/primitive selection may target a collapsed array member —
  // resolve it to the array's display id so the merged node (and its nets) light up.
  const selId = selection.type === 'primitive'
    ? (cell.primitivesById.get(selection.id)?.id ?? selection.id)
    : (cell.instancesById.get(selection.id)?.id ?? selection.id);
  for (const net of cell.nets) {
    if (net.endpoints.some(([id]) => id === selId)) addNet(net);
  }
  return { nets, nodes };
}

function buildGraph(
  cell: CellView,
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

  // The net whose connected pin(s) should be highlighted in instance pin
  // tables — lets a user trace a wire to its exact pin even when its drawn
  // path loops around the block and passes near other pins.
  const activeNet = selection?.type === 'net' ? selection.name : focusNet;

  const netKindOf = (net: string) => cell.nets.find(n => n.name === net)?.kind ?? 'signal';

  // The sectioned pin layout (see pinGroups/InstanceNode) merges runs of
  // bus-bit pins into one row with a single handle anchored at the row's
  // first pin (repPin). Map every bus-bit pin to its row's repPin so net
  // endpoints resolve to a handle that actually exists on the node — using
  // the same layout the node renders so the ids always match. Also remember
  // each instance's master ports for picking a net's source endpoint.
  const pinRepMap = new Map<string, Map<string, string>>();
  const instancePorts = new Map<string, Port[]>();
  for (const inst of cell.instances) {
    const masterPorts = design?.cells.get(inst.master)?.ports ?? [];
    instancePorts.set(inst.id, masterPorts);
    const repMap = new Map<string, string>();
    for (const section of computeInstanceLayout(inst.conn, masterPorts, netKindOf).sections) {
      for (const { row } of section.rows) {
        for (const pin of row.pins) repMap.set(pin, row.repPin);
      }
    }
    pinRepMap.set(inst.id, repMap);
  }

  // A selection landing on a collapsed array member resolves to its array block.
  const selDisplayId = selection?.type === 'instance'
    ? (cell.instancesById.get(selection.id)?.id ?? selection.id)
    : null;

  for (const inst of cell.instances) {
    const pos = positions.get(inst.id);
    if (!pos) continue;
    const masterPorts = design?.cells.get(inst.master)?.ports ?? [];
    const isSelected = selDisplayId === inst.id;
    const isConnected = !isSelected && highlightedNodes.has(inst.id);
    nodes.push({
      id: inst.id,
      type: 'instanceNode',
      position: { x: pos.x, y: pos.y },
      data: { instance: inst, masterPorts, isSelected, isConnected, activeNet, arraySize: inst.arraySize } as InstanceNodeData,
      style: { width: pos.width },
    });
  }

  const selPrimId = selection?.type === 'primitive'
    ? (cell.primitivesById.get(selection.id)?.id ?? selection.id)
    : null;

  // With supply wires hidden, a device terminal tied to a power/ground net
  // would render as a bare, floating-looking pin (the wire is suppressed but
  // the pin stays). Map each such terminal to its net kind so the device node
  // can cap it with a ground/VDD stub glyph instead. Same condition as the
  // wire-hiding guard below.
  const supplyStubsByPrim = new Map<string, Record<string, 'power' | 'ground'>>();
  if (hideSupply) {
    const netKind = new Map(cell.nets.map(n => [n.name, n.kind]));
    for (const prim of cell.primitives) {
      let stubs: Record<string, 'power' | 'ground'> | undefined;
      for (const [term, netName] of prim.terms) {
        const kind = netKind.get(netName);
        if (kind === 'power' || kind === 'ground') (stubs ??= {})[term] = kind;
      }
      if (stubs) supplyStubsByPrim.set(prim.id, stubs);
    }
  }

  // Dangling/floating nets (≤1 endpoint) — flag any device terminal sitting on
  // one so it reads as a deliberately-marked open pin, not a rendering glitch.
  const floatingNets = new Set(cell.nets.filter(isFloatingNet).map(n => n.name));

  for (const prim of cell.primitives) {
    const pos = positions.get(prim.id);
    if (!pos) continue;
    const isSelected = selPrimId === prim.id;
    const isConnected = !isSelected && highlightedNodes.has(prim.id);
    const floatingTerms = prim.terms.filter(([, net]) => floatingNets.has(net)).map(([t]) => t);
    nodes.push({
      id: prim.id,
      type: 'primitiveNode',
      position: { x: pos.x, y: pos.y },
      data: {
        primitive: prim,
        isSelected,
        isConnected,
        arraySize: prim.arraySize,
        supplyStubs: supplyStubsByPrim.get(prim.id),
        floatingTerms: floatingTerms.length ? floatingTerms : undefined,
      } as PrimitiveNodeData,
    });
  }

  // Cell-boundary port flags point toward the design so the wire exits the fin
  // tip. Which way "toward the design" is depends on the edge ELK actually
  // placed the port on — not its declared PININFO direction, which is often
  // missing or disagrees with the laid-out side. Deriving the side from the
  // port's x against the core's horizontal midpoint keeps every fin on an edge
  // pointing the same way (inward), instead of a stray input-flagged port on
  // the right edge pointing its fin and wire stub back out of the cell.
  let coreMinX = Infinity, coreMaxX = -Infinity;
  for (const core of [...cell.instances, ...cell.primitives]) {
    const p = positions.get(core.id);
    if (!p) continue;
    coreMinX = Math.min(coreMinX, p.x);
    coreMaxX = Math.max(coreMaxX, p.x + p.width);
  }
  const coreCenterX = coreMinX <= coreMaxX ? (coreMinX + coreMaxX) / 2 : 0;

  if (mode !== 'inst') {
    const addedPorts = new Set<string>();

    // Collect per-pin smoothstep edges first, then merge runs
    // that land on the same (collapsed) handle pair and form a contiguous
    // bus into a single labeled "ribbon" edge below.
    interface PendingSmoothEdge {
      id: string;
      source: string;
      sourceHandle: string;
      target: string;
      targetHandle: string;
      netName: string;
      labelStyle: Record<string, unknown>;
      labelBgStyle: Record<string, unknown>;
      style: Record<string, unknown>;
    }
    const pendingSmooth: PendingSmoothEdge[] = [];

    for (const net of cell.nets) {
      // "Hide supply nets" hides the supply/ground WIRES only — the pins (block
      // pins via InstanceNode, and the boundary ports added below) stay visible.
      // An explicitly selected rail net is the exception: selecting it always
      // reveals its wire so the highlight has something to land on.
      const isSelectedNet = selection?.type === 'net' && selection.name === net.name;
      const wiresHidden = hideSupply && net.kind !== 'signal' && !isSelectedNet;

      const isFocused = focusNet === net.name;
      const isHighlighted = highlightedNets.has(net.name);
      const isActive = isFocused || isHighlighted;
      // When something is selected/focused, fade unrelated wires further so
      // the active net's path reads as an isolated wire rather than one of
      // several similarly-weighted lines grazing the same pin rows.
      const hasFocus = selection !== null || focusNet !== null;

      const eps = net.endpoints.map(([id, pin]) =>
        id === '__port__'
          ? { nodeId: portNodeId(pin), handle: 'port', portName: pin }
          : { nodeId: id, handle: pinRepMap.get(id)?.get(pin) ?? pin, portName: null }
      );

      // Render a node for each cell-boundary port this net touches.
      for (const ep of eps) {
        if (!ep.portName || addedPorts.has(ep.nodeId)) continue;
        const pos = positions.get(ep.nodeId);
        const port = cell.ports.find(p => p.name === ep.portName);
        if (!pos || !port) continue;
        addedPorts.add(ep.nodeId);
        const side = (pos.x + pos.width / 2) >= coreCenterX ? 'right' : 'left';
        nodes.push({
          id: ep.nodeId,
          type: 'portNode',
          position: { x: pos.x, y: pos.y },
          data: { port, isFocused, isHighlighted, side, repNet: port.repNet, isArrayPort: port.isArray, count: port.count } as PortNodeData,
        });
      }

      // Pins/ports for this net are now placed; for hidden supply nets we stop
      // here so no wires are drawn.
      if (wiresHidden) continue;

      const realEps = eps.filter(ep => positions.has(ep.nodeId));
      if (realEps.length < 2) continue;

      const color = isActive ? netColorHi(net) : netColor(net);
      const opacity = isActive ? 0.95 : hasFocus ? 0.15 : 0.65;
      const strokeWidth = isActive ? 2.4 : 1.6;

      const outIdx = realEps.findIndex(ep => pinDirection(ep.handle, instancePorts.get(ep.nodeId) ?? []) === 'O');
      const srcIdx = outIdx !== -1 ? outIdx : 0;
      const { nodeId: srcId, handle: srcPin } = realEps[srcIdx];

      const labelStyle = {
        fill: 'var(--txt-faint)',
        fontSize: 9,
        fontFamily: 'Space Mono, monospace',
      };
      const labelBgStyle = { fill: '#10141a', fillOpacity: isActive ? 0.9 : 0 };
      // Active nets get a neon glow in their own (brighter) category color.
      const edgeStyle = { stroke: color, strokeWidth, opacity, filter: isActive ? `drop-shadow(0 0 3px ${color})` : undefined };

      for (let i = 0; i < realEps.length; i++) {
        if (i === srcIdx) continue;
        const { nodeId: tgtId, handle: tgtPin } = realEps[i];
        // After array folding both endpoints of an intra-array chain net resolve
        // to the same display node; skip the self-loop (ELK skips it too, so no
        // space is reserved for it) — the connection is internal to the array.
        if (tgtId === srcId) continue;

        pendingSmooth.push({
          id: `e_${net.name}_${i}`,
          source: srcId,
          sourceHandle: `${srcPin}-src`,
          target: tgtId,
          targetHandle: `${tgtPin}-tgt`,
          netName: net.name,
          labelStyle,
          labelBgStyle,
          style: edgeStyle,
        });
      }
    }

    // Detailed mode: merge per-pin edges that land on the same (collapsed)
    // handle pair and whose net names form a contiguous bus into a single
    // "<hi:lo>"-labeled ribbon edge — the wire-side counterpart of the
    // collapsed pin-table rows.
    if (pendingSmooth.length > 0) {
      const groups = new Map<string, PendingSmoothEdge[]>();
      for (const pe of pendingSmooth) {
        const key = `${pe.source}|${pe.sourceHandle}|${pe.target}|${pe.targetHandle}`;
        const group = groups.get(key);
        if (group) group.push(pe);
        else groups.set(key, [pe]);
      }
      for (const group of groups.values()) {
        for (const ribbon of clusterBusRibbons(group, pe => pe.netName)) {
          // Prefer an active/focused member as the ribbon representative so its
          // (active) style + netName win — otherwise focusing a single bus
          // member that isn't the lowest-index one wouldn't light the wire.
          const rep = (activeNet && ribbon.members.find(m => m.netName === activeNet)) || ribbon.members[0];
          const isBus = ribbon.members.length > 1;
          edges.push({
            id: rep.id,
            source: rep.source,
            sourceHandle: rep.sourceHandle,
            target: rep.target,
            targetHandle: rep.targetHandle,
            type: 'smoothstep',
            label: ribbon.label,
            labelStyle: rep.labelStyle,
            labelBgStyle: rep.labelBgStyle,
            style: isBus ? { ...rep.style, strokeWidth: (rep.style.strokeWidth as number) + 2 } : rep.style,
            className: isBus ? 'bus-edge' : undefined,
            data: { netName: rep.netName },
          });
        }
      }
    }
  }

  return { nodes, edges };
}

function Canvas() {
  const { design, currentCell, mode, nodeLayout, hideSupply, organize, focusNet, selection, setSelection, focusRequest } =
    useViewerStore();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  // Which cell `positions` was laid out for. ELK runs async and the old
  // positions stay on screen until it lands, so without this the auto-fit below
  // would frame a new cell using the previous cell's boxes.
  const [positionsCell, setPositionsCell] = useState<string | null>(null);
  const [groupBoxes, setGroupBoxes] = useState<Map<string, NodePosition>>(new Map());
  // Claude-fetched labels, keyed by cell name so a fetch never leaks across cells.
  const [fetchedLabels, setFetchedLabels] = useState<Record<string, GroupLabels>>({});
  const [laying, setLaying] = useState(false);
  const { fitView, fitBounds } = useReactFlow();

  // Power/ground wires are suppressed while "Hide supply nets" is on — see the
  // matching guard in buildGraph. The legend greys out those entries so it
  // matches what's actually drawn.
  const supplyHidden = hideSupply;

  const cell = design?.cells.get(currentCell);

  // The schematic renders a "view" of the cell where scalarized instance arrays
  // (and boundary port buses) are folded into single stacked nodes — otherwise a
  // thousand-wide array would lay out and mount a thousand blocks and crash the
  // canvas. Everything downstream (ELK, buildGraph, highlight) consumes the view.
  const view = useMemo(() => (cell ? buildCellView(cell) : null), [cell]);

  // Organize view: cluster this cell's blocks into functional sections. Only
  // worth boxing when there are ≥2 distinct groups — a single-group cell (e.g. a
  // flat transistor leaf) falls back to the plain layout so nothing changes.
  const groups = useMemo(
    () => (view && organize ? computeGroups(view, design) : []),
    [view, organize, design],
  );
  const useGroups = organize && groups.length >= 2;

  // Labels shown on the boxes: deterministic ones seeded from cache during
  // render (no flash), overridden by a Claude fetch for this cell once it lands.
  const seededLabels = useMemo<GroupLabels>(
    () => (view && useGroups ? getCachedGroupLabels(view.name) ?? {} : {}),
    [view, useGroups],
  );
  const groupLabels: GroupLabels = (view && fetchedLabels[view.name]) || seededLabels;

  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLaying(true);
    });
    const run = useGroups
      ? layoutCellGrouped(view, design, nodeLayout, groups)
      : layoutCell(view, design, nodeLayout).then(positions => ({ positions, groupBoxes: new Map<string, NodePosition>() }));
    Promise.resolve(run).then(({ positions, groupBoxes }) => {
      if (cancelled) return;
      setPositions(positions);
      setPositionsCell(view.name);
      setGroupBoxes(groupBoxes);
      setLaying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, design, nodeLayout, useGroups, groups]);

  // Sharpen group labels via Claude when a section view is active. Strictly
  // additive: the deterministic labels already render; this only upgrades them
  // when a key is present and the call succeeds. State is set only in the async
  // callback (never synchronously in the effect body).
  useEffect(() => {
    if (!view || !useGroups) return;
    if (getCachedGroupLabels(view.name) || fetchedLabels[view.name] || !getApiKey()) return;
    const cellName = view.name;
    let cancelled = false;
    labelGroups(view, groups)
      .then(labels => { if (!cancelled) setFetchedLabels(m => ({ ...m, [cellName]: labels })); })
      .catch(() => { /* keep deterministic labels */ });
    return () => { cancelled = true; };
  }, [view, useGroups, groups, fetchedLabels]);

  useEffect(() => {
    if (!view || positions.size === 0) return;
    const { nodes: n, edges: e } = buildGraph(view, selection, mode, hideSupply, focusNet, design, positions);
    const groupNodes = useGroups ? buildGroupNodes(groups, groupBoxes, groupLabels) : [];
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setNodes([...groupNodes, ...n]);
      setEdges(e);
    });
    return () => {
      cancelled = true;
    };
  }, [view, positions, selection, mode, hideSupply, focusNet, design, useGroups, groups, groupBoxes, groupLabels]);

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
    if (!view || positions.size === 0) return;
    // Wait for ELK: until the positions belong to the cell we are showing, the
    // boxes below are the PREVIOUS cell's. Framing those would point the camera
    // at the wrong place — and consuming the flags here would then suppress the
    // real fit once the correct layout arrives, leaving the cell off-screen.
    if (positionsCell !== view.name) return;
    const cellChanged = prevCellRef.current !== currentCell;
    const navRequested = prevFocusRef.current !== focusRequest;
    if (!cellChanged && !navRequested) return;
    prevCellRef.current = currentCell;
    prevFocusRef.current = focusRequest;

    let targetIds: string[] = [];
    if (selection?.type === 'instance') {
      targetIds = [view.instancesById.get(selection.id)?.id ?? selection.id];
    } else if (selection?.type === 'primitive') {
      targetIds = [view.primitivesById.get(selection.id)?.id ?? selection.id];
    } else if (selection?.type === 'net') {
      targetIds = [...computeHighlight(view, selection).nodes];
    }
    // Nothing specific to frame: show the whole cell, and frame it exactly as
    // the Fit control would — landing on a cell and pressing F should not give
    // two different views of it.
    const wholeCell = targetIds.length === 0;
    if (wholeCell) targetIds = [...positions.keys()];

    const boxes = targetIds.map(id => positions.get(id)).filter((p): p is NodePosition => !!p);
    if (boxes.length === 0) return;
    const minX = Math.min(...boxes.map(p => p.x));
    const minY = Math.min(...boxes.map(p => p.y));
    const maxX = Math.max(...boxes.map(p => p.x + p.width));
    const maxY = Math.max(...boxes.map(p => p.y + p.height));
    fitBounds(
      { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) },
      { padding: wholeCell ? FIT_PADDING : ZOOM_TO_TARGET_PADDING, duration: 400 },
    );
  }, [positions, positionsCell, currentCell, focusRequest, selection, view, fitBounds]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(eds => applyEdgeChanges(changes, eds));
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const netName = (edge.data as { netName: string } | undefined)?.netName;
    if (!netName) return;
    setSelection({ type: 'net', name: netName });
  }, [setSelection]);

  const onPaneClick = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  // "F" key → fit view (standard EDA shortcut, same in every viewer)
  const fitAll = useCallback(
    () => { fitView({ padding: FIT_PADDING, duration: FIT_DURATION }); },
    [fitView],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // don't hijack ⌘F / ctrl+F
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      fitAll();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fitAll]);

  // Double-clicking empty canvas fits, matching the other two viewers. React
  // Flow's own double-click zoom is off: in this app a double-click means
  // "descend into this block", so an extra 2x zoom on the pane is a surprise.
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('react-flow__pane')) fitAll();
  }, [fitAll]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }} onDoubleClick={onDoubleClick}>
      {laying && <div className="layout-spinner">Computing layout…</div>}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        proOptions={{ hideAttribution: true }}
        nodeTypes={nodeTypes}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        // Read-only viewer: nothing creates connections, and leaving handles
        // connectable makes a pointer-down on a pin start a dangling drag that
        // swallows the click. Disabling it lets pin dots fire onClick (select net).
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: FIT_PADDING }}
        zoomOnDoubleClick={false}
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
        onClick={fitAll}
        title="Fit view (F)"
      >
        ⊡ Fit  <kbd>F</kbd>
      </button>
      <div className="canvas-hint">click a block, pin, port, or net to highlight its connections · double-click to descend</div>
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
