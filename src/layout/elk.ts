// Use the self-contained browser bundle (no web-worker dependency)
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import type { Cell, Design } from '../parser/types';
import type { NodeLayout } from '../store/viewerStore';
import { computeInstanceLayout, computeRadialLayout } from './pinGroups';
import { groupPorts } from './busGrouping';
import { deviceFootprint } from '../components/nodes/deviceSymbols';

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_WIDTH = 180;
const PRIM_SIZE = 56;
const PRIM_LABEL = 30; // room under a device for its id/model caption
const PORT_WIDTH = 70;
const PORT_HEIGHT = 54;

let elkInstance: InstanceType<typeof ELK> | null = null;
function getElk() {
  if (!elkInstance) elkInstance = new ELK();
  return elkInstance;
}

export async function layoutCell(
  cell: Cell,
  design: Design | null,
  nodeLayout: NodeLayout,
): Promise<Map<string, NodePosition>> {
  const elk = getElk();

  const netKindOf = (() => {
    const kinds = new Map(cell.nets.map(n => [n.name, n.kind]));
    return (net: string) => kinds.get(net) ?? 'signal';
  })();

  const instanceSize = (inst: Cell['instances'][number]) => {
    const ports = design?.cells.get(inst.master)?.ports ?? [];
    return nodeLayout === 'beta'
      ? computeRadialLayout(inst.conn, ports, netKindOf)
      : { width: NODE_WIDTH, height: computeInstanceLayout(inst.conn, ports, netKindOf).height };
  };

  // Collapse contiguous bus-bit ports (addr<0>..addr<30>) into one layout node
  // each, so a wide port bus takes a single row instead of a tall stack. Every
  // bit maps to its group's representative port id — the handle anchor the
  // edges below and the scene builder both use.
  const portGroups = groupPorts(cell.ports);
  const portRep = new Map<string, string>();
  for (const g of portGroups) for (const name of g.names) portRep.set(name, g.repName);

  const children: ElkNode[] = [
    ...cell.instances.map(inst => {
      const { width, height } = instanceSize(inst);
      return { id: inst.id, width, height };
    }),
    // Devices render as real schematic symbols. Reserve the symbol's full
    // footprint (including the supply-stub margins) plus room for the id/model
    // caption; unknown kinds fall back to the generic glyph box.
    ...cell.primitives.map(prim => {
      const fp = deviceFootprint(prim);
      return fp
        ? { id: prim.id, width: fp.width, height: fp.height + PRIM_LABEL }
        : { id: prim.id, width: PRIM_SIZE, height: PRIM_SIZE + PRIM_LABEL };
    }),
    // Pin cell-boundary ports to a fixed edge of the layout — inputs (and
    // bidirectional/unknown-direction ports) to the left, outputs to the
    // right — so I/O lands in the same place across every cell instead of
    // wherever connectivity happens to push it. Supply/ground port groups are
    // the exception: they get no horizontal constraint here because they're
    // lifted onto the top/bottom rails afterward (see repositionSupplyRails).
    ...portGroups.map(g => {
      const kind = netKindOf(g.repName);
      const isRail = kind === 'power' || kind === 'ground';
      return {
        id: `__port__:${g.repName}`,
        width: PORT_WIDTH,
        height: PORT_HEIGHT,
        layoutOptions: isRail
          ? {}
          : { 'elk.layered.layering.layerConstraint': g.dir === 'O' ? 'LAST_SEPARATE' : 'FIRST_SEPARATE' },
      };
    }),
  ];

  if (children.length === 0) return new Map();

  const seenEdge = new Set<string>();
  const edges: ElkExtendedEdge[] = [];

  // Cell-boundary connections (the "__port__" pseudo-node) get their own
  // layout node per port (`__port__:<name>`) so a pin whose only other
  // connection is the cell's I/O boundary is still laid out next to a wire,
  // instead of floating with no edges at all.
  for (const net of cell.nets) {
    const eps = net.endpoints.map(([id, pin]) => (id === '__port__' ? `__port__:${portRep.get(pin) ?? pin}` : id));
    if (eps.length < 2) continue;
    for (let i = 0; i < eps.length - 1; i++) {
      const src = eps[i];
      const tgt = eps[i + 1];
      if (src === tgt) continue;
      const key = `${src}→${tgt}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ id: `e_${net.name}_${i}`, sources: [src], targets: [tgt] });
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children,
    edges,
  };

  try {
    const result = await elk.layout(graph);
    const positions = new Map<string, NodePosition>();
    for (const node of result.children ?? []) {
      positions.set(node.id ?? '', {
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? NODE_WIDTH,
        height: node.height ?? PRIM_SIZE,
      });
    }
    repositionSupplyRails(portGroups, netKindOf, positions);
    return positions;
  } catch (err) {
    console.warn('ELK layout failed, using fallback grid', err);
    return fallbackGrid(children);
  }
}

// Lift the cell-boundary supply/ground ports out of ELK's left/right columns
// and lay them along the top (power) and bottom (ground) of the core schematic
// — the conventional rail placement (VDD up, VSS down). The ports stay wired;
// React Flow just reroutes to the new positions.
function repositionSupplyRails(
  portGroups: ReturnType<typeof groupPorts>,
  netKindOf: (net: string) => string,
  positions: Map<string, NodePosition>,
): void {
  const portId = (name: string) => `__port__:${name}`;
  const powerPorts = portGroups.filter(g => netKindOf(g.repName) === 'power').map(g => portId(g.repName));
  const groundPorts = portGroups.filter(g => netKindOf(g.repName) === 'ground').map(g => portId(g.repName));
  if (powerPorts.length === 0 && groundPorts.length === 0) return;

  const rail = new Set([...powerPorts, ...groundPorts]);

  // Bounds of the core schematic — everything that is NOT a rail port — so the
  // two rails frame the actual content rather than each other.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [id, p] of positions) {
    if (rail.has(id)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.width);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + p.height);
  }
  if (!isFinite(minX)) { minX = 0; maxX = NODE_WIDTH; minY = 0; maxY = PORT_HEIGHT; }

  const ROW_GAP = 70;
  const placeRow = (ids: string[], y: number) => {
    if (ids.length === 0) return;
    // Centre the row over the schematic, widening it if the ports would
    // otherwise overlap.
    const minSpacing = PORT_WIDTH + 16;
    const rowWidth = Math.max(maxX - minX, ids.length * minSpacing);
    const startX = (minX + maxX) / 2 - rowWidth / 2;
    ids.forEach((id, i) => {
      const pos = positions.get(id);
      if (!pos) return;
      const cx = startX + ((i + 0.5) / ids.length) * rowWidth;
      positions.set(id, { ...pos, x: cx - pos.width / 2, y });
    });
  };

  placeRow(powerPorts, minY - ROW_GAP - PORT_HEIGHT);
  placeRow(groundPorts, maxY + ROW_GAP);
}

function fallbackGrid(nodes: ElkNode[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const COLS = 4;
  nodes.forEach((n, i) => {
    positions.set(n.id ?? '', {
      x: (i % COLS) * 250,
      y: Math.floor(i / COLS) * 200,
      width: n.width ?? NODE_WIDTH,
      height: n.height ?? PRIM_SIZE,
    });
  });
  return positions;
}
