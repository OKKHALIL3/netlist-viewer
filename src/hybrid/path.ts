import type { Design } from '../parser/types';
import type { HybridModel } from './model';
import { displayPath } from './model';
import type { Conductors } from './connectivity';
import { normSeg } from '../layout-viewer/correlate';

export interface PinRef { block: string; pin: string }
// One net traversal in REAL-path terms (display collapsing loses the
// adjacency): the path enters conductor i from block `from` and leaves it
// into block `to`. null = the top cell's own port (only possible at the ends).
export interface PathHop { conductor: number; from: string | null; to: string | null }
export interface PathResult { blocks: string[]; conductors: number[]; netCount: number; netNames: string[]; hops: PathHop[] }

// Resolve a TYPED "block:pin" ref to canonical form, or null if it names no
// real pin. Users type paths as displayed (original case, e.g. "XU1/XS2"),
// but model paths are normSeg'd; port names resolve case-insensitively when
// the exact case misses. Doubles as the validity gate that tells "still
// typing" apart from "valid pins but genuinely no path" (no BFS on partials).
export function resolvePinRef(design: Design, model: HybridModel, pin: PinRef): PinRef | null {
  let block = pin.block === '' ? '' : pin.block.split('/').map(s => normSeg(s) || s.toLowerCase()).join('/');
  // "top" is the picker's label for the root cell (same as the tree's root
  // row) — honor it unless a real top-level instance is literally named top.
  if (block === 'top' && !model.blocks.has(block)) block = '';
  const cellName = block === '' ? design.topCell : model.blocks.get(block)?.master;
  if (!cellName) return null;
  const cell = design.cells.get(cellName);
  if (!cell) return null;
  const exact = cell.ports.find(p => p.name === pin.pin);
  const port = exact ?? cell.ports.find(p => p.name.toLowerCase() === pin.pin.toLowerCase());
  return port ? { block, pin: port.name } : null;
}

export function pinConductor(design: Design, model: HybridModel, cond: Conductors, pin: PinRef): number | null {
  if (pin.block === '') return cond.idOf.get(`|${pin.pin}`) ?? null; // top-cell pin: port name = top-scope net
  // An ARRAY GROUP pin resolves through the representative member — a path is
  // traced through one element of the array.
  const real = model.blocks.get(pin.block)?.members?.[0] ?? pin.block;
  const block = model.blocks.get(real);
  if (!block || block.parent === null) return null;
  const parentCell = design.cells.get(model.blocks.get(block.parent)!.master);
  if (!parentCell) return null;
  const seg = real.split('/').pop()!;
  for (const inst of parentCell.instances) {
    if ((normSeg(inst.id) || inst.id.toLowerCase()) !== seg) continue;
    const net = inst.conn[pin.pin];
    if (net === undefined) continue;
    return cond.idOf.get(`${block.parent}|${net}`) ?? null;
  }
  return null;
}

// blocks a block's pins ride: parent-scope conductors of each pin
function blockConductors(design: Design, model: HybridModel, cond: Conductors, blockPath: string): number[] {
  const b = model.blocks.get(blockPath);
  if (!b) return [];
  const cell = design.cells.get(b.master);
  if (!cell) return [];
  const out = new Set<number>();
  for (const p of cell.ports) {
    const id = pinConductor(design, model, cond, { block: blockPath, pin: p.name });
    if (id !== null) out.add(id);
  }
  return [...out];
}

export function findPath(design: Design, model: HybridModel, cond: Conductors, start: PinRef, end: PinRef): PathResult | null {
  const s = pinConductor(design, model, cond, start);
  const e = pinConductor(design, model, cond, end);
  if (s === null || e === null) return null;

  // BFS over alternating conductor → block → conductor
  type Node = { kind: 'c' | 'b'; id: string | number };
  const ck = (id: number) => `c:${id}`, bk = (p: string) => `b:${p}`;
  const prev = new Map<string, Node | null>([[ck(s), null]]);
  const q: Node[] = [{ kind: 'c', id: s }];
  let found = s === e;
  while (q.length && !found) {
    const cur = q.shift()!;
    if (cur.kind === 'c') {
      for (const bp of cond.blocksOf.get(cur.id as number) ?? []) {
        if (prev.has(bk(bp))) continue;
        prev.set(bk(bp), cur);
        q.push({ kind: 'b', id: bp });
      }
    } else {
      for (const cid of blockConductors(design, model, cond, cur.id as string)) {
        if (prev.has(ck(cid))) continue;
        prev.set(ck(cid), cur);
        if (cid === e) { found = true; }
        q.push({ kind: 'c', id: cid });
      }
    }
  }
  if (!found) return null;

  // reconstruct
  const conductors: number[] = [];
  const raw: string[] = [];
  let node: Node | null = { kind: 'c', id: e };
  while (node) {
    if (node.kind === 'c') conductors.unshift(node.id as number);
    else raw.unshift(node.id as string);
    node = prev.get(node.kind === 'c' ? ck(node.id as number) : bk(node.id as string)) ?? null;
  }
  // BFS runs on real instance paths; collapse array members onto their groups
  // for display (keep-first order, dedup — a hop through two elements of the
  // same array is one visit of the collapsed block).
  const blocks: string[] = [];
  for (const bp of raw) {
    const dp = displayPath(model, bp);
    if (!blocks.includes(dp)) blocks.push(dp);
  }
  // endpoint blocks (unless a pin is the top cell itself) — display-mapped too:
  // a typed ref may name a real array member, which must surface as its group
  const sb = start.block && displayPath(model, start.block);
  const eb = end.block && displayPath(model, end.block);
  if (sb && blocks[0] !== sb) blocks.unshift(sb);
  if (eb && blocks[blocks.length - 1] !== eb) blocks.push(eb);

  const netNames = conductors.map(id => {
    const m0 = cond.members.get(id)?.[0];
    return m0 ? (m0.scope ? `${m0.scope}/${m0.net}` : m0.net) : '?';
  });
  // Hop chain on the raw alternation (c b c b … c): raw[i] bridges conductor
  // i and i+1. Endpoint blocks resolve like pinConductor does — an array
  // group is traced through its representative member.
  const realOf = (p: PinRef): string | null =>
    p.block === '' ? null : (model.blocks.get(p.block)?.members?.[0] ?? p.block);
  const hops = conductors.map((c, i) => ({
    conductor: c,
    from: i === 0 ? realOf(start) : raw[i - 1],
    to: i === conductors.length - 1 ? realOf(end) : raw[i],
  }));
  return { blocks, conductors, netCount: conductors.length, netNames, hops };
}
