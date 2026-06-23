import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel, LayoutInstance, LayoutNet, LayoutConnection, Bbox } from './model';
import { emptyBbox, extendBbox, bboxValid } from './model';

export interface HierNode { id: string; label: string; depth: number; segs: string[] }

// Lowercase a hierarchical name and split into segments, dropping finger
// suffixes (`<@n>`, trailing `@n`). `seps` is the set of separator chars to
// split on (DSPF divider+delimiter, or the CDL separators).
export function normSegments(name: string, seps: string[]): string[] {
  const escaped = seps.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const splitter = new RegExp(`[${escaped}]`);
  return name
    .toLowerCase()
    .split(splitter)
    .map(seg => seg.replace(/<@[^>]*>/g, '').replace(/@\d+$/, '').trim())
    .filter(Boolean);
}

// Walk the CDL instance tree from the top cell. Returns one node per instance
// at every depth, plus the depth-0 root (id ""). `id` is the normalized,
// "/"-joined instance path; `segs` is the same as an array for prefix matching.
export function enumerateHierarchy(design: Design): HierNode[] {
  const nodes: HierNode[] = [{ id: '', label: design.topCell, depth: 0, segs: [] }];
  const walk = (cellName: string, prefix: string[], depth: number) => {
    const cell = design.cells.get(cellName);
    if (!cell) return;
    for (const inst of cell.instances) {
      const segs = [...prefix, inst.id.toLowerCase()];
      nodes.push({ id: segs.join('/'), label: inst.id, depth, segs });
      if (design.cells.has(inst.master)) walk(inst.master, segs, depth + 1);
    }
  };
  walk(design.topCell, [], 1);
  return nodes;
}

export function correlate(design: Design, data: LayoutData): LayoutModel {
  const dspfSeps = [data.divider, data.delimiter];
  const nodes = enumerateHierarchy(design);

  // Index nodes by their normalized path string for prefix lookup.
  const nodeBox = new Map<string, Bbox>();
  const nodeCount = new Map<string, number>();
  for (const n of nodes) { nodeBox.set(n.id, emptyBbox()); nodeCount.set(n.id, 0); }

  // Assign each device to every ancestor node whose path is a prefix of it.
  let devicesMatched = 0;
  for (const dev of data.devices) {
    const segs = normSegments(dev.path, dspfSeps);
    let matched = false;
    // root (id "") always contains the device
    extendBbox(nodeBox.get('')!, dev.x, dev.y);
    nodeCount.set('', nodeCount.get('')! + 1);
    for (let len = 1; len <= segs.length; len++) {
      const id = segs.slice(0, len).join('/');
      const box = nodeBox.get(id);
      if (box) { extendBbox(box, dev.x, dev.y); nodeCount.set(id, nodeCount.get(id)! + 1); matched = true; }
    }
    if (matched) devicesMatched++;
  }

  const instances: LayoutInstance[] = nodes
    .filter(n => bboxValid(nodeBox.get(n.id)!))
    .map(n => ({
      id: n.id, label: n.label, depth: n.depth,
      deviceCount: nodeCount.get(n.id)!, bbox: nodeBox.get(n.id)!,
    }));

  // Net bboxes + which instance nodes each net touches (by subnode prefix).
  const nodeIds = new Set(nodes.map(n => n.id));
  const nets: LayoutNet[] = data.nets.map(dn => {
    const box = emptyBbox();
    const touched = new Set<string>();
    const layerSet = new Set<string>();
    for (const s of dn.subnodes) {
      extendBbox(box, s.x, s.y);
      const segs = normSegments(s.name, dspfSeps);
      // deepest matching instance node for this subnode
      for (let len = segs.length - 1; len >= 1; len--) {
        const id = segs.slice(0, len).join('/');
        if (nodeIds.has(id)) { touched.add(id); break; }
      }
    }
    for (const r of dn.resistors) if (r.layer) layerSet.add(r.layer);
    return {
      name: dn.name,
      bbox: bboxValid(box) ? box : [0, 0, 0, 0],
      subnodes: dn.subnodes.length, parasitics: dn.parasitics,
      layers: [...layerSet], instances: [...touched],
    };
  });

  // RC skeleton: one polyline per resistor, endpoints resolved by subnode name.
  const connections: LayoutConnection[] = [];
  for (const dn of data.nets) {
    const coord = new Map<string, [number, number]>();
    for (const s of dn.subnodes) coord.set(s.name, [s.x, s.y]);
    for (const r of dn.resistors) {
      const a = coord.get(r.a); const b = coord.get(r.b);
      if (a && b) connections.push({ net: dn.name, layer: r.layer, points: [a, b] });
    }
  }

  const extent = nodeBox.get('')!;
  return {
    design: design.topCell,
    extent: bboxValid(extent) ? extent : [0, 0, 1, 1],
    layers: data.layers,
    instances, nets, connections,
    stats: {
      instancesMatched: instances.filter(i => i.depth >= 1).length,
      instancesTotal: nodes.filter(n => n.depth >= 1).length,
      devicesMatched,
    },
  };
}
