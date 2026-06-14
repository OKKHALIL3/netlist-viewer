// Use the self-contained browser bundle (no web-worker dependency)
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import type { Cell, Design } from '../parser/types';
import { computeInstanceLayout } from './pinGroups';

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_WIDTH = 180;
const PRIM_SIZE = 56;
const PORT_WIDTH = 70;
const PORT_HEIGHT = 54;

let elkInstance: InstanceType<typeof ELK> | null = null;
function getElk() {
  if (!elkInstance) elkInstance = new ELK();
  return elkInstance;
}

export async function layoutCell(cell: Cell, design: Design | null): Promise<Map<string, NodePosition>> {
  const elk = getElk();

  const netKindOf = (() => {
    const kinds = new Map(cell.nets.map(n => [n.name, n.kind]));
    return (net: string) => kinds.get(net) ?? 'signal';
  })();

  const children: ElkNode[] = [
    ...cell.instances.map(inst => ({
      id: inst.id,
      width: NODE_WIDTH,
      height: computeInstanceLayout(
        inst.conn,
        design?.cells.get(inst.master)?.ports ?? [],
        netKindOf,
      ).height,
    })),
    ...cell.primitives.map(prim => ({
      id: prim.id,
      width: PRIM_SIZE,
      height: PRIM_SIZE + 24,
    })),
    // Pin cell-boundary ports to a fixed edge of the layout — inputs (and
    // bidirectional/unknown-direction ports) to the left, outputs to the
    // right — so I/O lands in the same place across every cell instead of
    // wherever connectivity happens to push it.
    ...cell.ports.map(port => ({
      id: `__port__:${port.name}`,
      width: PORT_WIDTH,
      height: PORT_HEIGHT,
      layoutOptions: {
        'elk.layered.layering.layerConstraint': port.dir === 'O' ? 'LAST_SEPARATE' : 'FIRST_SEPARATE',
      },
    })),
  ];

  if (children.length === 0) return new Map();

  const seenEdge = new Set<string>();
  const edges: ElkExtendedEdge[] = [];

  // Cell-boundary connections (the "__port__" pseudo-node) get their own
  // layout node per port (`__port__:<name>`) so a pin whose only other
  // connection is the cell's I/O boundary is still laid out next to a wire,
  // instead of floating with no edges at all.
  for (const net of cell.nets) {
    const eps = net.endpoints.map(([id, pin]) => (id === '__port__' ? `__port__:${pin}` : id));
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
    return positions;
  } catch (err) {
    console.warn('ELK layout failed, using fallback grid', err);
    return fallbackGrid(children);
  }
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
