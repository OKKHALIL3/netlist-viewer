import type { Design, Cell, Instance } from '../../parser/types';

// Build a minimal Design with the given cells. Each cell lists its subckt
// instances as [instanceId, masterCellName]. Primitives/nets/ports are empty
// (correlation only walks the instance tree).
export function makeDesign(
  topCell: string,
  cells: Record<string, Array<[string, string]>>,
): Design {
  const map = new Map<string, Cell>();
  for (const [name, insts] of Object.entries(cells)) {
    const instances: Instance[] = insts.map(([id, master]) => ({
      id, master, conn: {}, portMap: [],
    }));
    map.set(name, { name, ports: [], instances, primitives: [], nets: [] });
  }
  return { cells: map, topCell, warnings: [] };
}
