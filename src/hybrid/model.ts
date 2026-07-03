import type { Design, Cell } from '../parser/types';
import { normSeg } from '../layout-viewer/correlate';

export interface HybridBlock {
  path: string; label: string; master: string; depth: number;
  parent: string | null; children: string[];
  devices: number; pins: number;
  pinRoles: { signal: number; supply: number; control: number };
  netCount: number; domains: string[];
  category: string | null;
  parasiticR: number | null; parasiticC: number | null; couplingC: number | null;
  dspfNets: Set<number> | null;
}

export interface HybridModel {
  blocks: Map<string, HybridBlock>;
  root: string; maxDepth: number;
  levelNetCounts: number[];
  supplyDomains: string[];
  hasLayout: boolean;
}

// Control-pin heuristic on the PORT NAME (supply comes from net kind, not names).
export const CONTROL_RE = /(^|_)(en|enb|sel|cfg|trim|test|scan|rst|clr|pg|mode)($|_|\d)/i;

function recursiveDevices(design: Design, cellName: string, memo: Map<string, number>, guard: Set<string>): number {
  const hit = memo.get(cellName);
  if (hit !== undefined) return hit;
  if (guard.has(cellName)) return 0; // malformed cycle — count nothing, don't recurse
  const cell = design.cells.get(cellName);
  if (!cell) return 0; // unresolved master = opaque leaf
  guard.add(cellName);
  let n = cell.primitives.length;
  for (const inst of cell.instances) n += recursiveDevices(design, inst.master, memo, guard);
  guard.delete(cellName);
  memo.set(cellName, n);
  return n;
}

function cellFacts(cell: Cell) {
  const kinds = new Map(cell.nets.map(n => [n.name, n.kind]));
  const roles = { signal: 0, supply: 0, control: 0 };
  for (const p of cell.ports) {
    const kind = kinds.get(p.name);
    if (kind === 'power' || kind === 'ground') roles.supply++;
    else if (CONTROL_RE.test(p.name)) roles.control++;
    else roles.signal++;
  }
  const domains = cell.nets.filter(n => n.kind !== 'signal').map(n => n.name);
  return { roles, domains, netCount: cell.nets.length, pins: cell.ports.length };
}

export function buildHybridModel(design: Design): HybridModel {
  const blocks = new Map<string, HybridBlock>();
  const memo = new Map<string, number>();
  const supplyDomains = new Set<string>();
  const levelNetCounts: number[] = [];
  let maxDepth = 0;

  const add = (path: string, label: string, master: string, depth: number, parent: string | null): HybridBlock | null => {
    if (blocks.has(path)) return null; // finger-collapsed duplicate (same normSeg) — keep first
    const cell = design.cells.get(master);
    const facts = cell ? cellFacts(cell) : { roles: { signal: 0, supply: 0, control: 0 }, domains: [], netCount: 0, pins: 0 };
    for (const d of facts.domains) supplyDomains.add(d);
    const b: HybridBlock = {
      path, label, master, depth, parent, children: [],
      devices: recursiveDevices(design, master, memo, new Set()),
      pins: facts.pins, pinRoles: facts.roles, netCount: facts.netCount, domains: facts.domains,
      category: null, parasiticR: null, parasiticC: null, couplingC: null, dspfNets: null,
    };
    blocks.set(path, b);
    if (parent !== null) blocks.get(parent)!.children.push(path);
    maxDepth = Math.max(maxDepth, depth);
    levelNetCounts[depth] = (levelNetCounts[depth] ?? 0) + facts.netCount;
    return b;
  };

  add('', design.topCell, design.topCell, 0, null);
  const walk = (cellName: string, prefix: string, depth: number, guard: Set<string>) => {
    if (guard.has(cellName)) return;
    const cell = design.cells.get(cellName);
    if (!cell) return;
    guard.add(cellName);
    for (const inst of cell.instances) {
      const seg = normSeg(inst.id) || inst.id.toLowerCase();
      const path = prefix ? `${prefix}/${seg}` : seg;
      const created = add(path, inst.id, inst.master, depth, prefix);
      if (created) walk(inst.master, path, depth + 1, guard);
    }
    guard.delete(cellName);
  };
  walk(design.topCell, '', 1, new Set());

  return {
    blocks, root: '', maxDepth,
    levelNetCounts: Array.from(levelNetCounts, v => v ?? 0),
    supplyDomains: [...supplyDomains],
    hasLayout: false,
  };
}
