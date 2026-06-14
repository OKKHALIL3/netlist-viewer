// Use the self-contained browser bundle (no web-worker dependency)
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import type { Cell } from '../parser/types';
import type { DiagramStyle } from '../store/viewerStore';

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
const HEADER_H = 42;
const PIN_ROW_H = 20;
const BODY_PAD = 10;

// In simple mode, instances render header-only (no pin table) unless
// selected, so lay them out at a fixed collapsed height regardless of pin
// count — the expanded card overlays on top via CSS without affecting layout.
const COLLAPSED_INST_H = HEADER_H + 14;

export function instanceHeight(numPins: number, diagramStyle: DiagramStyle = 'detailed'): number {
  if (diagramStyle === 'simple') return COLLAPSED_INST_H;
  return HEADER_H + numPins * PIN_ROW_H + BODY_PAD;
}

export function rectCenter(rect: NodePosition): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// Where a ray from a rect's center toward (towardX, towardY) exits the rect's
// border — used to anchor "floating" edges at the nearest point on each node
// facing the other node, instead of fixed per-pin handle positions.
export function rectExitPoint(rect: NodePosition, towardX: number, towardY: number): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const scale = Math.min(
    dx !== 0 ? Math.abs(hw / dx) : Infinity,
    dy !== 0 ? Math.abs(hh / dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

let elkInstance: InstanceType<typeof ELK> | null = null;
function getElk() {
  if (!elkInstance) elkInstance = new ELK();
  return elkInstance;
}

export async function layoutCell(cell: Cell, diagramStyle: DiagramStyle = 'detailed'): Promise<Map<string, NodePosition>> {
  const elk = getElk();

  const children: ElkNode[] = [
    ...cell.instances.map(inst => ({
      id: inst.id,
      width: NODE_WIDTH,
      height: instanceHeight(Object.keys(inst.conn).length, diagramStyle),
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
