import type { Design } from '../parser/types';
import type { HybridModel } from './model';
import { displayPath } from './model';
import { normSeg } from '../layout-viewer/correlate';

export interface ScopedNet { scope: string; net: string }
export interface Conductors {
  idOf: Map<string, number>;
  members: Map<number, ScopedNet[]>;
  blocksOf: Map<number, Set<string>>;
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
  return { idOf, members, blocksOf };
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
