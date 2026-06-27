import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel, LayoutInstance, LayoutNet, LayoutConnection, Bbox } from './model';
import { emptyBbox, extendBbox, bboxValid } from './model';

export interface HierNode { id: string; label: string; depth: number; segs: string[] }

// Lowercase a hierarchical name and split into segments, dropping finger
// suffixes (`<@n>`, trailing `@n`). `seps` is the set of separator chars.
export function normSegments(name: string, seps: string[]): string[] {
  const escaped = seps.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const splitter = new RegExp(`[${escaped}]`);
  return name
    .toLowerCase()
    .split(splitter)
    .map(seg => seg.replace(/<@[^>]*>/g, '').replace(/@\d+$/, '').trim())
    .filter(Boolean);
}

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

  const nodeBox = new Map<string, Bbox>();
  const nodeCount = new Map<string, number>();
  for (const n of nodes) { nodeBox.set(n.id, emptyBbox()); nodeCount.set(n.id, 0); }

  let devicesMatched = 0;
  for (const dev of data.devices) {
    const segs = normSegments(dev.path, dspfSeps);
    let matched = false;
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

  const nodeIds = new Set(nodes.map(n => n.id));
  const nets: LayoutNet[] = data.nets.map(dn => {
    const box = emptyBbox();
    const touched = new Set<string>();
    const layerSet = new Set<string>();
    const points = [...dn.ports, ...dn.subnodes, ...dn.instPins];
    for (const s of points) {
      if (s.layer) layerSet.add(s.layer);
      if (s.x === null || s.y === null) continue;
      extendBbox(box, s.x, s.y);
      const segs = normSegments(s.name, dspfSeps);
      for (let len = segs.length - 1; len >= 1; len--) {
        const id = segs.slice(0, len).join('/');
        if (nodeIds.has(id)) { touched.add(id); break; }
      }
    }
    for (const r of dn.resistors) {
      if (r.layer) layerSet.add(r.layer);
      if (r.x1 !== null && r.y1 !== null) extendBbox(box, r.x1, r.y1);
      if (r.x2 !== null && r.y2 !== null) extendBbox(box, r.x2, r.y2);
    }
    for (const cp of dn.capacitors) if (cp.layer) layerSet.add(cp.layer);
    return {
      name: dn.name,
      bbox: bboxValid(box) ? box : [0, 0, 0, 0],
      subnodes: dn.subnodes.length,
      parasitics: dn.resistors.length + dn.capacitors.length,
      layers: [...layerSet], instances: [...touched],
    };
  });

  // RC skeleton: prefer resistor slab geometry; else resolve endpoints by name.
  const connections: LayoutConnection[] = [];
  for (const dn of data.nets) {
    const coord = new Map<string, [number, number]>();
    for (const s of [...dn.ports, ...dn.subnodes, ...dn.instPins]) {
      if (s.x !== null && s.y !== null) coord.set(s.name, [s.x, s.y]);
    }
    for (const r of dn.resistors) {
      if (r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null) {
        connections.push({ net: dn.name, layer: r.layer, points: [[r.x1, r.y1], [r.x2, r.y2]] });
        continue;
      }
      const a = coord.get(r.a);
      const b = coord.get(r.b);
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
    diagnostics: data.diagnostics,
  };
}
