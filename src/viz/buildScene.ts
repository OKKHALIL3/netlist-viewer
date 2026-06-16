// Framework-agnostic scene builder — turns a parsed Design (one cell of it)
// into the React-Flow-ready { nodes, edges } scene the viewer draws. This is
// pure data: no React, no DOM, no browser globals, so it runs unchanged in the
// browser canvas AND headless in Node (see server/subcircuit_visualize.ts and
// the `visualizeSubcircuit` entry point at the bottom).
//
// The `nodes`/`edges` it returns are plain JSON-serializable objects (the
// @xyflow/react Node/Edge shape: id, type, position, data, style, …). Colors
// are emitted as CSS custom-property references (e.g. "var(--net-sig)") — see
// docs/subcircuit-visualize.md for the palette a non-browser consumer resolves.

import { layoutCell, type NodePosition } from '../layout/elk';
import { clusterBusRibbons } from '../layout/busGrouping';
import { computeInstanceLayout, pinDirection } from '../layout/pinGroups';
import type { Node, Edge } from '@xyflow/react';
import type { InstanceNodeData } from '../components/nodes/InstanceNode';
import type { PrimitiveNodeData } from '../components/nodes/PrimitiveNode';
import type { PortNodeData } from '../components/nodes/PortNode';
import type { Cell, Design, Net, Port } from '../parser/types';
import type { SelectionType, ViewMode, NodeLayout } from '../store/viewerStore';

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
export function computeHighlight(cell: Cell, selection: SelectionType | null): { nets: Set<string>; nodes: Set<string> } {
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

// Per-cell structural maps that don't depend on the current selection:
//   pinRepMap     — every (instance pin) → the repPin of its collapsed row, so
//                   net endpoints resolve to a handle that actually exists.
//   instancePorts — each instance's master ports, for picking a net's source.
// Built from the same layout the node renders so the handle ids always match.
// Memoized by the caller so selecting/clicking (which doesn't change the cell)
// doesn't re-run a per-instance layout for every block on the canvas.
export interface PinMaps {
  pinRepMap: Map<string, Map<string, string>>;
  instancePorts: Map<string, Port[]>;
}

export function buildPinMaps(cell: Cell, design: Design | null): PinMaps {
  const netKindOf = (net: string) => cell.nets.find(n => n.name === net)?.kind ?? 'signal';
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
  return { pinRepMap, instancePorts };
}

export function buildGraph(
  cell: Cell,
  selection: SelectionType | null,
  mode: string,
  hideSupply: boolean,
  focusNet: string | null,
  design: Design | null,
  positions: Map<string, NodePosition>,
  pinMaps: PinMaps,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const { nets: highlightedNets, nodes: highlightedNodes } = computeHighlight(cell, selection);

  // The net whose connected pin(s) should be highlighted in instance pin
  // tables — lets a user trace a wire to its exact pin even when its drawn
  // path loops around the block and passes near other pins.
  const activeNet = selection?.type === 'net' ? selection.name : focusNet;

  const { pinRepMap, instancePorts } = pinMaps;

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
      data: { instance: inst, masterPorts, isSelected, isConnected, activeNet } as InstanceNodeData,
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
      const wiresHidden = hideSupply && net.kind !== 'signal' && mode !== 'net';

      const isFocused = focusNet === net.name;
      const isHighlighted = highlightedNets.has(net.name);
      const isActive = isFocused || isHighlighted;
      const isDimmed = focusNet !== null && !isFocused && mode === 'net';
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
        nodes.push({
          id: ep.nodeId,
          type: 'portNode',
          position: { x: pos.x, y: pos.y },
          data: { port, isFocused, isHighlighted } as PortNodeData,
        });
      }

      // Pins/ports for this net are now placed; for hidden supply nets we stop
      // here so no wires are drawn.
      if (wiresHidden) continue;

      const realEps = eps.filter(ep => positions.has(ep.nodeId));
      if (realEps.length < 2) continue;

      const color = isActive ? netColorHi(net) : netColor(net);
      const opacity = isDimmed ? 0.05 : isActive ? 0.95 : hasFocus ? 0.15 : 0.65;
      const strokeWidth = isActive ? 2.4 : 1.6;

      const outIdx = realEps.findIndex(ep => pinDirection(ep.handle, instancePorts.get(ep.nodeId) ?? []) === 'O');
      const srcIdx = outIdx !== -1 ? outIdx : 0;
      const { nodeId: srcId, handle: srcPin } = realEps[srcIdx];

      const labelStyle = {
        fill: isDimmed ? 'transparent' : 'var(--txt-faint)',
        fontSize: 9,
        fontFamily: 'Space Mono, monospace',
      };
      const labelBgStyle = { fill: '#10141a', fillOpacity: isActive ? 0.9 : 0 };
      // Active nets get a neon glow in their own (brighter) category color.
      const edgeStyle = { stroke: color, strokeWidth, opacity, filter: isActive ? `drop-shadow(0 0 3px ${color})` : undefined };

      for (let i = 0; i < realEps.length; i++) {
        if (i === srcIdx) continue;
        const { nodeId: tgtId, handle: tgtPin } = realEps[i];

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
          const rep = ribbon.members[0];
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

// ── Headless entry point ─────────────────────────────────────────────────────
// One call that takes a parsed Design and produces the laid-out scene for a
// single cell — exactly what the canvas draws, but runnable anywhere. Used by
// the subcircuit_visualize route and reusable for snapshots, tests, exports.

export interface VisualizeOptions {
  /** Which cell of the design to render. Defaults to the design's topCell. */
  cell?: string;
  /** 'inst' (blocks only), 'both' (blocks + wires, default), or 'net'. */
  mode?: ViewMode;
  /** Hide supply/ground wires (pins stay). Defaults to true, as in the UI. */
  hideSupply?: boolean;
  /** 'classic' stacked sections (default) or 'beta' two-column blocks. */
  nodeLayout?: NodeLayout;
  /** Pre-focus a net by name (its wires/pins light up). */
  focusNet?: string | null;
  /** Pre-select an instance / primitive / net (highlights its connections). */
  selection?: SelectionType | null;
}

export interface VisualizeResult {
  /** The cell that was laid out. */
  cell: string;
  /** The design's detected top cell (for reference). */
  topCell: string;
  /** React-Flow nodes with ELK-computed positions baked in. */
  nodes: Node[];
  /** React-Flow edges (wires / bus ribbons). */
  edges: Edge[];
  /** Per-node bounding boxes from the layout engine, keyed by node id. */
  positions: Record<string, NodePosition>;
}

export async function visualizeSubcircuit(design: Design, opts: VisualizeOptions = {}): Promise<VisualizeResult> {
  const cellName = opts.cell ?? design.topCell;
  const cell = design.cells.get(cellName);
  if (!cell) {
    const available = [...design.cells.keys()];
    throw new Error(`Cell "${cellName}" not found. Available cells: ${available.join(', ') || '(none)'}`);
  }

  const mode: ViewMode = opts.mode ?? 'both';
  const hideSupply = opts.hideSupply ?? true;
  const nodeLayout: NodeLayout = opts.nodeLayout ?? 'classic';
  const focusNet = opts.focusNet ?? null;
  const selection = opts.selection ?? null;

  const positions = await layoutCell(cell, design, nodeLayout);
  const pinMaps = buildPinMaps(cell, design);
  const { nodes, edges } = buildGraph(cell, selection, mode, hideSupply, focusNet, design, positions, pinMaps);

  return {
    cell: cellName,
    topCell: design.topCell,
    nodes,
    edges,
    positions: Object.fromEntries(positions),
  };
}
