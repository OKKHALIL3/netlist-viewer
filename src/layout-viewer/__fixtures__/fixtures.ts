import type { Design, Cell, Instance, Primitive } from '../../parser/types';

// Build a minimal Design with the given cells. Each cell lists its subckt
// instances as [instanceId, masterCellName]. Optionally, `prims` lists the
// primitive device ids per cell (kind inferred from the id's first letter).
// Nets/ports are empty (correlation only walks the hierarchy).
export function makeDesign(
  topCell: string,
  cells: Record<string, Array<[string, string]>>,
  prims: Record<string, string[]> = {},
): Design {
  const map = new Map<string, Cell>();
  for (const [name, insts] of Object.entries(cells)) {
    const instances: Instance[] = insts.map(([id, master]) => ({
      id, master, conn: {}, portMap: [],
    }));
    const primitives: Primitive[] = (prims[name] ?? []).map(id => {
      const c = id[0]?.toUpperCase();
      const kind: Primitive['kind'] = c === 'R' ? 'R' : c === 'C' ? 'C' : 'M';
      return { id, kind, model: '', terms: [], params: {} };
    });
    map.set(name, { name, ports: [], instances, primitives, nets: [] });
  }
  return { cells: map, topCell, warnings: [] };
}
