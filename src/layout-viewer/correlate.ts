import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel, LayoutInstance, LayoutNet, LayoutConnection, Bbox } from './model';
import { emptyBbox, extendBbox, bboxValid, unionInto } from './model';

export interface HierNode { id: string; label: string; depth: number; segs: string[]; master: string | null }

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

function splitterFor(seps: string[]): RegExp {
  const escaped = seps.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`[${escaped}]`);
}

// Lowercase a hierarchical name and split into normalized segments. `seps` is
// the set of separator chars.
export function normSegments(name: string, seps: string[]): string[] {
  return name.split(splitterFor(seps)).map(normSeg).filter(Boolean);
}

// Split keeping the original case (for display labels).
export function rawSegments(name: string, seps: string[]): string[] {
  return name.split(splitterFor(seps)).filter(Boolean);
}

// A trailing bus index on an instance name ([146], <3>): physical fill/decap
// families arrive as thousands of indexed siblings — group them as one family.
const BUS_IDX_RE = /(\[\d+\]|<\d+>)$/;

// LVS markers for layout-only devices that have no schematic counterpart
// (fill, decap, antenna diodes, dummies). These can never correlate — they
// are not a CDL/DSPF mismatch, so we count them separately. This catches only
// the marker conventions we KNOW (Calibre/Quantus); extractors are free to
// name dummies anything, so the structural guard is the CDL-declaration check
// in correlate() — a unit under a matched prefix must name something the CDL
// actually declares in that cell, or it is layout-only regardless of naming.
const DUMMY_RE = /(unmatched|noxref)/i;

// Cap on drawn physical-only families — beyond this the canvas stops being
// readable; the drop is reported in warnings (no silent truncation).
const PHYS_CAP = 64;

export function enumerateHierarchy(design: Design): HierNode[] {
  const nodes: HierNode[] = [{ id: '', label: design.topCell, depth: 0, segs: [], master: null }];
  const seen = new Set<string>(['']);
  // Node ids are normalized the SAME way device paths are (normSeg), so finger
  // suffixes match; dedup then collapses finger-expanded siblings (e.g. CDL
  // MM7@1 + MM7@2 both → mm7) into one block instead of duplicate instances.
  const add = (segs: string[], label: string, depth: number, master: string) => {
    const id = segs.join('/');
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, depth, segs, master });
  };
  // `guard` carries the cells open on the current branch so a malformed cyclic
  // subckt (A instantiates A) stops instead of recursing forever — the same
  // guard hybrid/model.ts uses. It is add/deleted per branch, so a cell shared
  // across sibling branches (a diamond) is still enumerated on each path.
  const walk = (cellName: string, prefix: string[], depth: number, guard: Set<string>) => {
    if (guard.has(cellName)) return;
    const cell = design.cells.get(cellName);
    if (!cell) return;
    guard.add(cellName);
    // Only subckt instances are blocks. Primitive devices (transistors, R, C)
    // are intentionally NOT enumerated — this viewer shows instance boundaries,
    // not device-level boxes. Devices still position their parent instance's
    // bbox via the prefix match in correlate().
    for (const inst of cell.instances) {
      const segs = [...prefix, normSeg(inst.id) || inst.id.toLowerCase()];
      add(segs, inst.id, depth, inst.master);
      if (design.cells.has(inst.master)) walk(inst.master, segs, depth + 1, guard);
    }
    guard.delete(cellName);
  };
  walk(design.topCell, [], 1, new Set());
  return nodes;
}

export function correlate(design: Design, data: LayoutData): LayoutModel {
  const dspfSeps = [data.divider, data.delimiter];
  const nodes = enumerateHierarchy(design);

  const nodeBox = new Map<string, Bbox>();
  const nodeCount = new Map<string, number>();
  for (const n of nodes) { nodeBox.set(n.id, emptyBbox()); nodeCount.set(n.id, 0); }
  const nodeIds = new Set(nodes.map(n => n.id));

  // Every CDL node id on a path's ancestor chain (deepest CDL knowledge wins
  // per level; a path can light up several nested boxes).
  const matchedIds = (segs: string[]): string[] => {
    const ids: string[] = [];
    for (let len = 1; len <= segs.length; len++) {
      const id = segs.slice(0, len).join('/');
      if (nodeIds.has(id)) ids.push(id);
    }
    return ids;
  };
  // CDL-declaration check. `matchedIds` only proves the path's PREFIX is CDL
  // hierarchy — it says nothing about what hangs below it. LVS dummy fill is
  // regularly scoped under a matched instance (XI9/XI26/<fill>) with naming we
  // cannot predict, and its geometry sits anywhere on the die (on mirrored
  // twin channels it landed inside the twin). The CDL is the authority on what
  // a cell contains: the segment just below the deepest matched instance must
  // be a primitive that cell declares (device units), or a primitive/net/port
  // (net-node geometry). Deeper segments are extractor subdevice detail. A
  // master with no CDL body (blackbox PDK leaf) can't contradict anything —
  // stay lenient there.
  const nodeMaster = new Map<string, string | null>();
  for (const n of nodes) nodeMaster.set(n.id, n.master);
  interface CellLeaves { prims: Set<string>; netsPorts: Set<string> }
  const cellLeafCache = new Map<string, CellLeaves | null>();
  const leavesOf = (master: string | null): CellLeaves | null => {
    if (!master) return null;
    let entry = cellLeafCache.get(master);
    if (entry === undefined) {
      const cell = design.cells.get(master);
      if (!cell) entry = null;                       // blackbox — no CDL body
      else {
        const prims = new Set<string>();
        for (const p of cell.primitives) { const s = normSeg(p.id); if (s) prims.add(s); }
        const netsPorts = new Set<string>();
        for (const nt of cell.nets) { const s = normSeg(nt.name); if (s) netsPorts.add(s); }
        for (const pt of cell.ports) { const s = normSeg(pt.name); if (s) netsPorts.add(s); }
        entry = { prims, netsPorts };
      }
      cellLeafCache.set(master, entry);
    }
    return entry;
  };
  // `ids` are contiguous from the root (a node's parent is always a node), so
  // ids.length is the depth of CDL knowledge and segs[ids.length] is the first
  // segment the CDL must vouch for.
  const cdlGenuine = (segs: string[], ids: string[], isDevice: boolean): boolean => {
    const k = ids.length;
    if (k >= segs.length) return true;               // the whole path is CDL hierarchy
    const leaves = leavesOf(nodeMaster.get(ids[k - 1]) ?? null);
    if (!leaves) return true;                        // blackbox master — lenient
    const leaf = segs[k];
    return leaves.prims.has(leaf) || (!isDevice && leaves.netsPorts.has(leaf));
  };
  // Layout↔schematic naming: some extractors prefix a nested subckt instance
  // with an extra X (DSPF "XXI107" vs CDL "XI107"). ONLY when the path didn't
  // match as-is, retry with a doubled leading X collapsed — a safe fallback
  // that can't disturb paths that already correlate.
  const resolveSegs = (path: string): { segs: string[]; ids: string[] } => {
    let segs = normSegments(path, dspfSeps);
    let ids = matchedIds(segs);
    if (ids.length === 0 && /^xx/.test(segs[0] ?? '')) {
      const collapsed = [segs[0].replace(/^x/, ''), ...segs.slice(1)];
      const retry = matchedIds(collapsed);
      if (retry.length > 0) { segs = collapsed; ids = retry; }
    }
    return { segs, ids };
  };

  // ── device accounting ────────────────────────────────────────────────────
  // Units: unique device identities (from *|I / device statements), plus —
  // for files whose *|I carries no coordinates — geometry-only node paths
  // derived from *|S names. Geometry-only units shape boxes but are not
  // counted as devices.
  const pointsByPath = new Map<string, Array<[number, number]>>();
  for (const p of data.devicePoints) {
    let arr = pointsByPath.get(p.path);
    if (!arr) { arr = []; pointsByPath.set(p.path, arr); }
    arr.push([p.x, p.y]);
  }
  interface Unit { path: string; isDevice: boolean; points: Array<[number, number]> }
  const units = new Map<string, Unit>();
  for (const dev of data.devices) {
    units.set(dev.path, { path: dev.path, isDevice: true, points: pointsByPath.get(dev.path) ?? [] });
  }
  for (const [path, points] of pointsByPath) {
    if (!units.has(path)) units.set(path, { path, isDevice: false, points });
  }

  // `members` = every eligible unit (real devices AND, in coordinate-less
  // files, geometry-only net nodes) — it shapes the box and orders families.
  // `devices` counts only real devices, so the reported deviceCount matches the
  // CDL-block accounting (which also counts devices, not geometry nodes).
  interface PhysGroup { key: string; label: string; box: Bbox; members: number; devices: number }
  const physGroups = new Map<string, PhysGroup>();

  const root = nodeBox.get('')!;
  let devicesMatched = 0, devicesDummy = 0, devicesTopLevel = 0, devicesHierMiss = 0;
  for (const unit of units.values()) {
    for (const [x, y] of unit.points) extendBbox(root, x, y);
    const { segs, ids } = resolveSegs(unit.path);
    // Layout-only fill/decap geometry can physically sit anywhere on the die —
    // even when the extractor scopes it under a matched hierarchy path. It
    // must never shape or count into a CDL block: on mirrored twin channels,
    // one channel's dummy fill was stretching the OTHER channel's block box
    // across the pair. Known LVS markers catch it by name; the CDL-declaration
    // check catches it whatever the extractor calls it. (The die-extent root
    // box above still covers it either way.)
    const isDummy = DUMMY_RE.test(unit.path)
      || (ids.length > 0 && !cdlGenuine(segs, ids, unit.isDevice));
    if (!isDummy) {
      for (const id of ids) {
        const box = nodeBox.get(id)!;
        for (const [x, y] of unit.points) extendBbox(box, x, y);
        if (unit.isDevice) nodeCount.set(id, nodeCount.get(id)! + 1);
      }
    }
    if (unit.isDevice) {
      nodeCount.set('', nodeCount.get('')! + 1);
      if (isDummy) devicesDummy++;                         // layout-only dummy
      else if (ids.length > 0) devicesMatched++;
      else if (segs.length <= 1) devicesTopLevel++;        // direct top-cell device
      else devicesHierMiss++;                              // path prefix not in the CDL
    }
    // Unmatched + hierarchical → candidate for a physical-only block family
    // (DSPF hierarchy the CDL doesn't know about). Dummy DEVICES never found
    // a family (fill/guard-ring instances), but a dummy-NAMED net node (xACT
    // renames uncorrelated nets "noxref_N") still carries geometry as long
    // as the family prefix itself is clean — that is exactly the renumbered-
    // hierarchy case (X100|X55|X1|noxref_10 places family X100).
    const prefixClean = !DUMMY_RE.test(segs.slice(0, -1).join('/'));
    const unitEligible = unit.isDevice ? !DUMMY_RE.test(unit.path) : prefixClean;
    if (ids.length === 0 && segs.length >= 2 && unitEligible) {
      const raw0 = rawSegments(unit.path, dspfSeps)[0] ?? unit.path;
      const key = (normSeg(raw0) || raw0.toLowerCase()).replace(BUS_IDX_RE, '');
      let g = physGroups.get(key);
      if (!g) { g = { key, label: raw0.replace(BUS_IDX_RE, ''), box: emptyBbox(), members: 0, devices: 0 }; physGroups.set(key, g); }
      g.members++;
      if (unit.isDevice) g.devices++;
      for (const [x, y] of unit.points) extendBbox(g.box, x, y);
    }
  }

  const instances: LayoutInstance[] = nodes
    .filter(n => bboxValid(nodeBox.get(n.id)!))
    .map(n => ({
      id: n.id, label: n.label, master: n.master, origin: 'cdl' as const, depth: n.depth,
      deviceCount: nodeCount.get(n.id)!, bbox: nodeBox.get(n.id)!,
    }));
  const cdlPlaced = instances.filter(i => i.depth >= 1).length;

  // ── physical-only blocks (largest families first, capped) ───────────────
  const physShown = [...physGroups.values()]
    .filter(g => bboxValid(g.box))
    .sort((a, b) => b.members - a.members)
    .slice(0, PHYS_CAP);
  const physIdByKey = new Map<string, string>();
  for (const g of physShown) {
    const id = `dspf:${g.key}`;
    physIdByKey.set(g.key, id);
    instances.push({
      id, label: g.label, master: null, origin: 'dspf', depth: 1,
      deviceCount: g.devices, bbox: g.box,
    });
  }
  const physTotal = [...physGroups.values()].filter(g => bboxValid(g.box)).length;

  // ── nets ─────────────────────────────────────────────────────────────────
  const nets: LayoutNet[] = data.nets.map(dn => {
    const box = emptyBbox();
    const touched = new Set<string>();
    const layerSet = new Set<string>();
    // Deepest CDL box this node name sits in — or its physical family.
    const touchByName = (name: string) => {
      const orig = normSegments(name, dspfSeps);
      let segs = orig;
      for (let pass = 0; pass < 2; pass++) {
        for (let len = segs.length - 1; len >= 1; len--) {
          const id = segs.slice(0, len).join('/');
          if (nodeIds.has(id)) { touched.add(id); return; }
        }
        if (pass === 0 && /^xx/.test(segs[0] ?? '')) {
          segs = [segs[0].replace(/^x/, ''), ...segs.slice(1)];
        } else break;
      }
      // Physical-only families are keyed from the ORIGINAL leading segment on
      // the device side, so match that here — not the XX-collapsed one, which
      // would look up a key that was never registered.
      if (orig.length >= 2) {
        const pid = physIdByKey.get(orig[0].replace(BUS_IDX_RE, ''));
        if (pid) touched.add(pid);
      }
    };
    for (const p of dn.ports) {
      if (p.layer) layerSet.add(p.layer);
      if (p.x !== null && p.y !== null) extendBbox(box, p.x, p.y);
    }
    for (const s of dn.subnodes) {
      if (s.layer) layerSet.add(s.layer);
      if (s.x === null || s.y === null) continue;
      extendBbox(box, s.x, s.y);
      touchByName(s.name);
    }
    for (const ip of dn.instPins) {
      if (ip.layer) layerSet.add(ip.layer);
      if (ip.x !== null && ip.y !== null) extendBbox(box, ip.x, ip.y);
      // Identity works even with no coordinates (Calibre xACT): the inst
      // path's parent chain names the block this net physically enters.
      touchByName(ip.inst);
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
      totalCap: dn.totalCap, isGround: dn.isGround, ports: dn.ports.length,
      layers: [...layerSet], instances: [...touched],
    };
  });

  // ── RC skeleton ──────────────────────────────────────────────────────────
  // Prefer resistor slab geometry; else resolve endpoints by name through the
  // GLOBAL node index (R endpoints regularly reference the net's port name or
  // another section's pin node).
  const connections: LayoutConnection[] = [];
  for (const dn of data.nets) {
    for (const r of dn.resistors) {
      if (r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null) {
        connections.push({ net: dn.name, layer: r.layer, points: [[r.x1, r.y1], [r.x2, r.y2]] });
        continue;
      }
      const a = data.nodeCoord.get(r.a);
      const b = data.nodeCoord.get(r.b);
      if (a && b) connections.push({ net: dn.name, layer: r.layer, points: [a, b] });
    }
  }

  const extent = emptyBbox();
  if (bboxValid(root)) unionInto(extent, root);
  for (const g of physShown) unionInto(extent, g.box);

  const devicesTotal = devicesMatched + devicesDummy + devicesTopLevel + devicesHierMiss;

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
  if (physTotal > physShown.length) {
    warnings.push(
      `${physTotal - physShown.length} more physical-only block families exist — drawing the ${PHYS_CAP} largest.`,
    );
  }

  return {
    design: design.topCell,
    extent: bboxValid(extent) ? extent : [0, 0, 1, 1],
    layers: data.layers,
    instances, nets, connections,
    stats: {
      instancesMatched: cdlPlaced,
      instancesTotal: nodes.filter(n => n.depth >= 1).length,
      devicesMatched, devicesTotal, devicesUnique: data.devices.length,
      devicesDummy, devicesTopLevel, devicesHierMiss,
      physicalBlocks: physShown.length,
    },
    warnings,
    diagnostics: data.diagnostics,
  };
}
