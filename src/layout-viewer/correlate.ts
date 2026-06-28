import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel, LayoutInstance, LayoutNet, LayoutConnection, Bbox } from './model';
import { emptyBbox, extendBbox, bboxValid } from './model';

export interface HierNode { id: string; label: string; depth: number; segs: string[] }

// Normalize one hierarchy segment: lowercase and drop finger suffixes
// (`<@n>`, trailing `@n`) so a CDL id and a DSPF node name compare equal.
export function normSeg(seg: string): string {
  return seg.toLowerCase().replace(/<@[^>]*>/g, '').replace(/@\d+$/, '').trim();
}

// Layout instance ids are the normalized instance-path segments joined by '/'.
// Used by the hierarchy panel to map a clicked CDL node to its layout box.
export function pathToInstanceId(instanceLabels: string[]): string {
  return instanceLabels.map(normSeg).filter(Boolean).join('/');
}

// Lowercase a hierarchical name and split into normalized segments. `seps` is
// the set of separator chars.
export function normSegments(name: string, seps: string[]): string[] {
  const escaped = seps.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const splitter = new RegExp(`[${escaped}]`);
  return name.split(splitter).map(normSeg).filter(Boolean);
}

export function enumerateHierarchy(design: Design): HierNode[] {
  const nodes: HierNode[] = [{ id: '', label: design.topCell, depth: 0, segs: [] }];
  const seen = new Set<string>(['']);
  // Node ids are normalized the SAME way device paths are (normSeg), so finger
  // suffixes match; dedup then collapses finger-expanded siblings (e.g. CDL
  // MM7@1 + MM7@2 both → mm7) into one block instead of duplicate instances.
  const add = (segs: string[], label: string, depth: number) => {
    const id = segs.join('/');
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, depth, segs });
  };
  const walk = (cellName: string, prefix: string[], depth: number) => {
    const cell = design.cells.get(cellName);
    if (!cell) return;
    // Only subckt instances are blocks. Primitive devices (transistors, R, C)
    // are intentionally NOT enumerated — this viewer shows instance boundaries,
    // not device-level boxes. Devices still position their parent instance's
    // bbox via the prefix match in correlate().
    for (const inst of cell.instances) {
      const segs = [...prefix, normSeg(inst.id) || inst.id.toLowerCase()];
      add(segs, inst.id, depth);
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

  // LVS markers for layout-only devices that have no schematic counterpart
  // (fill, decap, antenna diodes, dummies). These can never correlate — they
  // are not a CDL/DSPF mismatch, so we count them separately.
  const DUMMY_RE = /(unmatched|noxref)/i;
  let devicesMatched = 0, devicesDummy = 0, devicesTopLevel = 0, devicesHierMiss = 0;
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
    else if (DUMMY_RE.test(dev.path)) devicesDummy++;   // layout-only dummy
    else if (segs.length <= 1) devicesTopLevel++;        // direct top-cell device
    else devicesHierMiss++;                              // path prefix not in the CDL
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
  const devicesTotal = data.devices.length;

  // Surface CDL↔DSPF correlation health. A genuine naming mismatch (devices on
  // hierarchy paths absent from the CDL) is worth a warning; LVS dummies and
  // top-level devices are expected and not flagged. The full breakdown lives in
  // the inspector so an empty/partial canvas explains itself.
  const warnings: string[] = [];
  const realDevices = devicesTotal - devicesDummy;
  if (devicesHierMiss > 0 && realDevices > 0 && devicesHierMiss / realDevices >= 0.2) {
    warnings.push(
      `${devicesHierMiss} of ${realDevices} non-dummy devices sit on hierarchy paths not in the CDL — likely a CDL/DSPF naming mismatch.`,
    );
  }

  return {
    design: design.topCell,
    extent: bboxValid(extent) ? extent : [0, 0, 1, 1],
    layers: data.layers,
    instances, nets, connections,
    stats: {
      instancesMatched: instances.filter(i => i.depth >= 1).length,
      instancesTotal: nodes.filter(n => n.depth >= 1).length,
      devicesMatched, devicesTotal, devicesDummy, devicesTopLevel, devicesHierMiss,
    },
    warnings,
    diagnostics: data.diagnostics,
  };
}
