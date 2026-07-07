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

// A cell can be instantiated many times, so an item inside it really exists
// once per instantiation path. Counts how many elaborated copies of each cell
// exist (= number of distinct top→cell instantiation paths) in one topo pass,
// clamped so deeply-reused cells don't overflow. Used for the "+N more" note.
const COUNT_CLAMP = 99999;

export function buildOccurrenceCounts(design: Design): Map<string, number> {
  const count = new Map<string, number>();
  count.set(design.topCell, 1);

  // Topological order (a cell before every cell it instantiates), via DFS
  // post-order on the instantiation DAG. Netlists are acyclic.
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const cell = design.cells.get(name);
    if (cell) for (const inst of cell.instances) if (design.cells.has(inst.master)) visit(inst.master);
    order.push(name);
  };
  visit(design.topCell);
  order.reverse();

  for (const name of order) {
    const c = count.get(name) ?? 0;
    if (c === 0) continue;
    const cell = design.cells.get(name);
    if (!cell) continue;
    for (const inst of cell.instances) {
      if (!design.cells.has(inst.master)) continue;
      count.set(inst.master, Math.min((count.get(inst.master) ?? 0) + c, COUNT_CLAMP));
    }
  }
  return count;
}

// Enumerates up to `cap` instantiation paths (breadcrumbs) from the top cell to
// a view of `targetCell`, plus the true total occurrence count. Branches that
// can't reach the target are pruned, so this stays cheap even in big designs.
export function pathsToCell(
  design: Design,
  targetCell: string,
  cap: number,
  counts: Map<string, number>,
): { paths: BreadcrumbEntry[][]; total: number } {
  const reach = new Map<string, boolean>();
  const canReach = (x: string): boolean => {
    if (x === targetCell) return true;
    const memo = reach.get(x);
    if (memo !== undefined) return memo;
    reach.set(x, false); // cycle guard (DAG, but be safe)
    const cell = design.cells.get(x);
    let r = false;
    if (cell) {
      for (const inst of cell.instances) {
        if (design.cells.has(inst.master) && canReach(inst.master)) { r = true; break; }
      }
    }
    reach.set(x, r);
    return r;
  };

  const paths: BreadcrumbEntry[][] = [];
  const dfs = (path: BreadcrumbEntry[], cellName: string) => {
    if (paths.length >= cap) return;
    if (cellName === targetCell) { paths.push(path); return; }
    const cell = design.cells.get(cellName);
    if (!cell) return;
    for (const inst of cell.instances) {
      if (paths.length >= cap) break;
      if (!design.cells.has(inst.master) || !canReach(inst.master)) continue;
      dfs([...path, { label: inst.id, cellName: inst.master }], inst.master);
    }
  };
  dfs([{ label: design.topCell, cellName: design.topCell }], design.topCell);

  // A cell the top can't reach (an unused library cell, or a second independent
  // top in a multi-top file) has no instantiation path, but it IS in the index —
  // let it open as its own root view instead of showing "no matches".
  if (paths.length === 0 && targetCell !== design.topCell
      && design.cells.has(targetCell) && !canReach(design.topCell)) {
    paths.push([{ label: targetCell, cellName: targetCell }]);
  }

  return { paths, total: counts.get(targetCell) ?? paths.length };
}
