import type { Design } from '../parser/types';
import type { BreadcrumbEntry } from '../store/viewerStore';

export interface SearchResult {
  kind: 'instance' | 'primitive' | 'net' | 'cell' | 'pin';
  id: string;
  cellName: string;
  detail: string;
  // For pin results: the net connected to this pin (highlighted when jumping
  // here) and the instance/primitive that owns the pin (jumped to directly,
  // so multiple matches of the same pin name resolve to distinct targets).
  netName?: string;
  ownerKind?: 'instance' | 'primitive';
  ownerId?: string;
}

// Flat, design-wide index of everything a user might want to jump to:
// instances, primitives, pins (instance terminals and primitive terminals),
// and nets within every cell, plus the cells themselves (so "search for a
// master cell" works even with no instances shown). Built once per loaded
// design.
export function buildSearchIndex(design: Design): SearchResult[] {
  const results: SearchResult[] = [];
  for (const cell of design.cells.values()) {
    results.push({ kind: 'cell', id: cell.name, cellName: cell.name, detail: `${cell.instances.length} instance${cell.instances.length === 1 ? '' : 's'}` });
    for (const inst of cell.instances) {
      results.push({ kind: 'instance', id: inst.id, cellName: cell.name, detail: inst.master });
      for (const [pin, net] of Object.entries(inst.conn)) {
        results.push({ kind: 'pin', id: pin, cellName: cell.name, detail: `${inst.id} → ${net}`, netName: net, ownerKind: 'instance', ownerId: inst.id });
      }
    }
    for (const prim of cell.primitives) {
      results.push({ kind: 'primitive', id: prim.id, cellName: cell.name, detail: prim.model });
      for (const [term, net] of prim.terms) {
        results.push({ kind: 'pin', id: term, cellName: cell.name, detail: `${prim.id} → ${net}`, netName: net, ownerKind: 'primitive', ownerId: prim.id });
      }
    }
    for (const net of cell.nets) {
      results.push({ kind: 'net', id: net.name, cellName: cell.name, detail: net.kind });
    }
  }
  return results;
}

// Breadcrumb entries are an instantiation path, so jumping to a search result
// requires finding *some* path of instances from the top cell down to the
// cell that contains it. BFS over the cell-instantiation graph gives the
// shortest such path (a cell may be instantiated more than once; any path works).
export function findPath(design: Design, targetCell: string): BreadcrumbEntry[] | null {
  const root: BreadcrumbEntry = { label: design.topCell, cellName: design.topCell };
  if (targetCell === design.topCell) return [root];

  const visited = new Set<string>([design.topCell]);
  const queue: BreadcrumbEntry[][] = [[root]];

  while (queue.length > 0) {
    const path = queue.shift()!;
    const cell = design.cells.get(path[path.length - 1].cellName);
    if (!cell) continue;
    for (const inst of cell.instances) {
      if (!design.cells.has(inst.master) || visited.has(inst.master)) continue;
      const nextPath = [...path, { label: inst.id, cellName: inst.master }];
      if (inst.master === targetCell) return nextPath;
      visited.add(inst.master);
      queue.push(nextPath);
    }
  }
  return null;
}
