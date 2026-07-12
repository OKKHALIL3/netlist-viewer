import type { Design, Cell, Instance, Primitive, Net } from '../../parser/types';

// Build a minimal Design with the given cells. Each cell lists its subckt
// instances as [instanceId, masterCellName]. Optionally, `prims` lists the
// primitive device ids per cell (kind inferred from the id's first letter)
// and `nets` the net names per cell. A master named in an instance but absent
// from `cells` models a blackbox (a cell with no CDL body).
export function makeDesign(
  topCell: string,
  cells: Record<string, Array<[string, string]>>,
  prims: Record<string, string[]> = {},
  nets: Record<string, string[]> = {},
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
    const cellNets: Net[] = (nets[name] ?? []).map(n => ({
      name: n, kind: 'signal', endpoints: [],
    }));
    map.set(name, { name, ports: [], instances, primitives, nets: cellNets });
  }
  return { cells: map, topCell, warnings: [] };
}
