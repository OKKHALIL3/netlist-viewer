import type { Design } from '../parser/types';
import type { HybridModel } from './model';
import { displayPath } from './model';
import { normSeg } from '../layout-viewer/correlate';

export interface ScopedNet { scope: string; net: string }
export interface Conductors {
  idOf: Map<string, number>;
  members: Map<number, ScopedNet[]>;
  blocksOf: Map<number, Set<string>>;
  // Device-level view of the same graph: a block is an ENDPOINT on a conductor
  // when a real DEVICE of its own sits on that net — a primitive terminal, or
  // a childless leaf the CDL couldn't resolve (the diode/moscap wrappers). A
  // hierarchy block that merely routes the net through to a child is NOT an
  // endpoint. The device trace keeps only these endpoint blocks.
  deviceBlocksOf: Map<number, Set<string>>;
}

const key = (scope: string, net: string) => `${scope}|${net}`;

class UF {
  parent: number[] = [];
  make(): number { this.parent.push(this.parent.length); return this.parent.length - 1; }
  find(i: number): number { while (this.parent[i] !== i) { this.parent[i] = this.parent[this.parent[i]]; i = this.parent[i]; } return i; }
  union(a: number, b: number): void { this.parent[this.find(a)] = this.find(b); }
}

export function buildConductors(design: Design, model: HybridModel): Conductors {
  const uf = new UF();
  const rawId = new Map<string, number>();          // scoped-net key → uf node
  const scopedByRaw: ScopedNet[] = [];
  const pinBlocks: Array<Set<string>> = [];         // per uf node

  // register every SIGNAL net of every block scope. Array groups are display
  // stand-ins, not scopes — conductors live on real instance paths only.
  for (const b of model.blocks.values()) {
    if (b.members) continue;
    const cell = design.cells.get(b.master);
    if (!cell) continue;
    for (const net of cell.nets) {
      if (net.kind !== 'signal') continue;
      const k = key(b.path, net.name);
      if (rawId.has(k)) continue;
      const id = uf.make();
      rawId.set(k, id);
      scopedByRaw[id] = { scope: b.path, net: net.name };
      pinBlocks[id] = new Set();
    }
  }

  // union across boundaries + collect pin blocks
  for (const b of model.blocks.values()) {
    if (b.members) continue;
    const cell = design.cells.get(b.master);
    if (!cell) continue;
    for (const inst of cell.instances) {
      const seg = normSeg(inst.id) || inst.id.toLowerCase();
      const childPath = b.path ? `${b.path}/${seg}` : seg;
      if (!model.blocks.has(childPath)) continue;
      for (const [pin, net] of Object.entries(inst.conn)) {
        const outer = rawId.get(key(b.path, net));
        if (outer === undefined) continue;          // outer net is supply → no conductor
        pinBlocks[outer].add(childPath);
        const inner = rawId.get(key(childPath, pin)); // CDL: port name = inner net name
        if (inner !== undefined) uf.union(outer, inner);
      }
    }
  }

  const idOf = new Map<string, number>();
  const members = new Map<number, ScopedNet[]>();
  const blocksOf = new Map<number, Set<string>>();
  for (const [k, raw] of rawId) {
    const root = uf.find(raw);
    idOf.set(k, root);
    if (!members.has(root)) { members.set(root, []); blocksOf.set(root, new Set()); }
    members.get(root)!.push(scopedByRaw[raw]);
    for (const bp of pinBlocks[raw]) blocksOf.get(root)!.add(bp);
  }

  // Device endpoints per conductor. Two independent sources, both keyed off the
  // post-union conductor id (idOf):
  //   (a) a block whose master cell holds a PRIMITIVE terminating on the net;
  //   (b) a childless leaf sitting on the net — an unresolved device wrapper
  //       (esd diode / moscap) that carries a device the parser couldn't expand.
  // A block with children but no own primitive on the net is pure routing and
  // is deliberately left out.
  const deviceBlocksOf = new Map<number, Set<string>>();
  const addDev = (id: number, bp: string) => {
    let s = deviceBlocksOf.get(id);
    if (!s) deviceBlocksOf.set(id, s = new Set());
    s.add(bp);
  };
  for (const [id, bset] of blocksOf) {
    for (const bp of bset) {
      if ((model.blocks.get(bp)?.children.length ?? 0) === 0) addDev(id, bp); // (b)
    }
  }
  for (const b of model.blocks.values()) {
    if (b.members) continue;
    const cell = design.cells.get(b.master);
    if (!cell) continue;
    for (const prim of cell.primitives) {
      for (const [, net] of prim.terms) {
        const id = idOf.get(key(b.path, net));
        if (id !== undefined) addDev(id, b.path); // (a)
      }
    }
  }
  return { idOf, members, blocksOf, deviceBlocksOf };
}

const netName = (cond: Conductors, id: number): string => {
  const m0 = cond.members.get(id)?.[0];
  return m0 ? (m0.scope ? `${m0.scope}/${m0.net}` : m0.net) : '?';
};

// Every real block inside a selection (its group members expanded) — used to
// gather the selection's device nets and to exclude its own internals from the
// neighbor list.
function subtreeReal(model: HybridModel, path: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(model.blocks.get(path)?.members ?? [path])];
  while (stack.length) {
    const p = stack.pop()!;
    const b = model.blocks.get(p);
    if (!b || out.has(p)) continue;
    if (b.members) { stack.push(...b.members); continue; } // a group stands in for its members
    out.add(p);
    for (const c of b.children) stack.push(c);
  }
  return out;
}

export interface SharedNet { name: string; blocks: string[] }
export interface DeviceTrace {
  blocks: Set<string>;          // distinct device-neighbor display paths
  nets: SharedNet[];            // shared nets, each with the neighbors that ride it
  netOf: Map<string, string>;   // neighbor display path → a representative shared net
}

// Device-level connectivity for the selected block: the OTHER blocks that hold
// a device on one of the nets ON THE SELECTION'S OWN PINS. Seeding from the
// block's interface (not its whole interior) keeps the neighbor list about what
// it connects to at its boundary, so a big block doesn't drag in every net
// buried inside it. Pure routing blocks and supplies never appear; the
// selection's own subtree and ancestors are excluded. Neighbors are grouped by
// the shared net for the panel and the fly-line labels.
export function traceDeviceConnectivity(design: Design, model: HybridModel, cond: Conductors, blockPath: string): DeviceTrace {
  const result: DeviceTrace = { blocks: new Set(), nets: [], netOf: new Map() };
  const block = model.blocks.get(blockPath);
  if (!block || block.parent === null) return result;
  const parentCell = design.cells.get(model.blocks.get(block.parent)!.master);
  if (!parentCell) return result;

  // Seed from the conductors on the selection's own pins (parent scope). An
  // array group seeds from every member.
  const segs = new Set((block.members ?? [blockPath]).map(p => p.split('/').pop()!));
  const seeds = new Set<number>();
  for (const inst of parentCell.instances) {
    if (!segs.has(normSeg(inst.id) || inst.id.toLowerCase())) continue;
    for (const net of Object.values(inst.conn)) {
      const id = cond.idOf.get(`${block.parent}|${net}`);
      if (id !== undefined) seeds.add(id);
    }
  }

  // exclude, in DISPLAY terms, the selection's own subtree (internal devices)
  // and its ancestors
  const sub = subtreeReal(model, blockPath);
  const excluded = new Set<string>();
  for (const p of sub) excluded.add(displayPath(model, p));
  for (let p: string | null = blockPath; p !== null; p = model.blocks.get(p)!.parent) excluded.add(displayPath(model, p));

  for (const id of seeds) {
    const here: string[] = [];
    const seen = new Set<string>();
    for (const bp of cond.deviceBlocksOf.get(id) ?? []) {
      const dp = displayPath(model, bp);          // collapse array members onto their group
      if (excluded.has(dp) || seen.has(dp)) continue;
      seen.add(dp);
      here.push(dp);
      result.blocks.add(dp);
    }
    if (here.length) {
      const name = netName(cond, id);
      result.nets.push({ name, blocks: here.sort() });
      for (const dp of here) if (!result.netOf.has(dp)) result.netOf.set(dp, name);
    }
  }
  result.nets.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export interface TraceResult {
  blocks: Set<string>;
  nets: ScopedNet[];
  byLevel: Map<number, string[]>;
  levelsCrossed: number;
}

export function traceConnectivity(design: Design, model: HybridModel, cond: Conductors, blockPath: string): TraceResult {
  const block = model.blocks.get(blockPath);
  const result: TraceResult = { blocks: new Set(), nets: [], byLevel: new Map(), levelsCrossed: 0 };
  if (!block || block.parent === null) return result;

  // seed conductors: parent-scope nets on the block's pins. An ARRAY GROUP
  // seeds from every member — "what does this array connect to" is the union
  // over its elements' pins.
  const parent = model.blocks.get(block.parent)!;
  const parentCell = design.cells.get(parent.master);
  if (!parentCell) return result;
  const segs = new Set((block.members ?? [blockPath]).map(p => p.split('/').pop()!));
  const seeds = new Set<number>();
  for (const inst of parentCell.instances) {
    if (!segs.has(normSeg(inst.id) || inst.id.toLowerCase())) continue; // all finger-collapsed twins
    for (const net of Object.values(inst.conn)) {
      const id = cond.idOf.get(`${block.parent}|${net}`);
      if (id !== undefined) seeds.add(id);
    }
  }

  // exclude the selected chain in DISPLAY terms — conductors carry real
  // instance paths, so ancestors must be display-mapped before the check.
  const ancestors = new Set<string>();
  for (let p: string | null = blockPath; p !== null; p = model.blocks.get(p)!.parent) ancestors.add(displayPath(model, p));

  const seenNet = new Set<string>();
  for (const id of seeds) {
    for (const sn of cond.members.get(id) ?? []) {
      const k = `${sn.scope}|${sn.net}`;
      if (!seenNet.has(k)) { seenNet.add(k); result.nets.push(sn); }
    }
    for (const bp of cond.blocksOf.get(id) ?? []) {
      const dp = displayPath(model, bp);      // collapse array members onto their group
      if (ancestors.has(dp)) continue;
      result.blocks.add(dp);
    }
  }
  for (const bp of result.blocks) {
    const d = model.blocks.get(bp)!.depth;
    if (!result.byLevel.has(d)) result.byLevel.set(d, []);
    result.byLevel.get(d)!.push(bp);
  }
  for (const list of result.byLevel.values()) list.sort();
  result.levelsCrossed = result.byLevel.size;
  return result;
}
