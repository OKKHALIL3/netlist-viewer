import type { Design, Cell } from '../parser/types';
import { normSeg } from '../layout-viewer/correlate';
import { parseBusSuffix, busLabel } from '../layout/busGrouping';

export interface HybridBlock {
  path: string; label: string; master: string; depth: number;
  parent: string | null; children: string[];
  devices: number; pins: number;
  pinRoles: { signal: number; supply: number; control: number };
  netCount: number; domains: string[];
  category: string | null;
  parasiticR: number | null; parasiticC: number | null; couplingC: number | null;
  dspfNets: Set<number> | null;
  // Array collapse (same navigator convention as the schematic viewer):
  // an ARRAY GROUP block stands in for indexed same-master siblings
  // (X<0>..X<N>) — `members` lists their real paths, lowest index first
  // (members[0] is the representative whose subtree the group displays).
  // Each member carries `groupOf` back to its group. Real blocks stay in
  // the map untouched: conductors/DSPF correlation keep working on real
  // instance paths, and displayPath() maps them onto the collapsed view.
  members?: string[];
  groupOf?: string;
  // Group only: the user popped the ×N chip open — members are swapped into
  // the display tree and displayPath stops folding them (see setGroupExpanded).
  expanded?: boolean;
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
  const levelNetCounts: number[] = [];
  let maxDepth = 0;

  const add = (path: string, label: string, master: string, depth: number, parent: string | null): HybridBlock | null => {
    if (blocks.has(path)) return null; // finger-collapsed duplicate (same normSeg) — keep first
    const cell = design.cells.get(master);
    const facts = cell ? cellFacts(cell) : { roles: { signal: 0, supply: 0, control: 0 }, domains: [], netCount: 0, pins: 0 };
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

  const model: HybridModel = {
    blocks, root: '', maxDepth,
    levelNetCounts: Array.from(levelNetCounts, v => v ?? 0),
    // Top cell's rails only (Amr): deeper cells contribute locally-voted rail
    // names (topology classifier) that flood the supply domain map with
    // block-local net names meaningless at design scope.
    supplyDomains: [...blocks.get('')!.domains],
    hasLayout: false,
  };
  groupArrays(model);
  return model;
}

// ---- Array collapse -----------------------------------------------------

// Fold indexed same-master siblings (X<0>..X<N>, ≥2, sparse runs included —
// fill families arrive with gaps) into one ARRAY GROUP block per parent,
// mirroring the schematic viewer's bus folding. Group stats are summed over
// members so footer totals are unchanged by collapsing; the group's children
// are the representative member's (drill in = see one element's structure).
// Deepest parents first, so a group copies its representative's children
// AFTER those children were themselves grouped (nested arrays).
function groupArrays(model: HybridModel): void {
  const parents = [...model.blocks.values()].sort((a, b) => b.depth - a.depth);
  for (const parent of parents) {
    if (parent.children.length < 2) continue;

    type Entry = { path: string; index: number; label: string };
    type Run = { base: string; brackets: '<>' | '[]'; master: string; entries: Entry[] };
    const runs = new Map<string, Run>();
    const keyOf = (path: string): string | null => {
      const parsed = parseBusSuffix(path.split('/').pop()!);
      return parsed ? `${parsed.base}|${parsed.brackets}|${model.blocks.get(path)!.master}` : null;
    };
    for (const cp of parent.children) {
      const key = keyOf(cp);
      if (key === null) continue;
      const seg = parseBusSuffix(cp.split('/').pop()!)!;
      const child = model.blocks.get(cp)!;
      let run = runs.get(key);
      if (!run) { run = { base: seg.base, brackets: seg.brackets, master: child.master, entries: [] }; runs.set(key, run); }
      run.entries.push({ path: cp, index: seg.index, label: child.label });
    }

    const emitted = new Set<string>();
    const failed = new Set<string>();
    const next: string[] = [];
    for (const cp of parent.children) {
      const key = keyOf(cp);
      const run = key !== null ? runs.get(key)! : undefined;
      if (!run || run.entries.length < 2 || failed.has(key!)) { next.push(cp); continue; }
      if (emitted.has(key!)) continue;
      const gpath = makeGroup(model, parent, run);
      if (gpath === null) { failed.add(key!); next.push(cp); continue; }
      emitted.add(key!);
      next.push(gpath);
    }
    parent.children = next;
  }
}

function makeGroup(
  model: HybridModel, parent: HybridBlock,
  run: { base: string; brackets: '<>' | '[]'; master: string; entries: Array<{ path: string; index: number; label: string }> },
): string | null {
  const sorted = [...run.entries].sort((a, b) => a.index - b.index);
  const gseg = busLabel(run.base, run.brackets, sorted.map(e => e.index));
  const gpath = parent.path ? `${parent.path}/${gseg}` : gseg;
  if (model.blocks.has(gpath)) return null; // freak name collision — leave ungrouped

  const members = sorted.map(e => e.path);
  const rep = model.blocks.get(members[0])!;
  // Label keeps the instance ids' original case; path indices are authoritative.
  // Strip finger suffixes (X<0>@2) the way normSeg does — but case-preserving —
  // or the suffix blocks the bus parse and the label falls back to lowercase.
  const cleanLabel = sorted[0].label.replace(/<@[^>]*>/g, '').replace(/@\d+$/, '').trim();
  const labelParse = parseBusSuffix(cleanLabel);
  const label = labelParse
    ? busLabel(labelParse.base, labelParse.brackets, sorted.map(e => e.index))
    : gseg;

  const g: HybridBlock = {
    path: gpath, label, master: run.master, depth: rep.depth, parent: parent.path,
    children: [...rep.children],
    devices: 0, pins: 0,
    pinRoles: { signal: 0, supply: 0, control: 0 },
    netCount: 0, domains: rep.domains,
    category: null, parasiticR: null, parasiticC: null, couplingC: null, dspfNets: null,
    members,
  };
  for (const p of members) {
    const m = model.blocks.get(p)!;
    m.groupOf = gpath;
    g.devices += m.devices; g.pins += m.pins; g.netCount += m.netCount;
    g.pinRoles.signal += m.pinRoles.signal; g.pinRoles.supply += m.pinRoles.supply; g.pinRoles.control += m.pinRoles.control;
  }
  model.blocks.set(gpath, g);
  return gpath;
}

// Map a REAL instance path onto the collapsed display tree: a path ending on
// an array member displays as its group; a path THROUGH a member displays as
// the same position under the representative's subtree (structural twin).
// Paths already on the display tree map to themselves.
export function displayPath(model: HybridModel, path: string): string {
  if (!path) return path;
  const segs = path.split('/');
  let cur = '';
  for (let i = 0; i < segs.length; i++) {
    cur = cur ? `${cur}/${segs[i]}` : segs[i];
    const g = model.blocks.get(cur)?.groupOf;
    if (!g || model.blocks.get(g)?.expanded) continue; // expanded groups don't fold their members
    if (i === segs.length - 1) return g;
    const rep = model.blocks.get(g)!.members![0];
    if (rep !== cur) cur = rep;
  }
  return cur;
}

// Toggle an array group between its collapsed ×N stand-in and the individual
// members (Amr: "when it says ×4 you can expand that if needed"). Structural:
// the group/members swap places in the parent's children — and in the outer
// group's display copy when the parent is a representative member — and
// displayPath stops folding members of an expanded group, so traces, search,
// coupling and criticality all follow automatically. Returns false on a no-op
// (not a group, or already in the requested state).
export function setGroupExpanded(model: HybridModel, gpath: string, expanded: boolean): boolean {
  const g = model.blocks.get(gpath);
  if (!g?.members || (g.expanded ?? false) === expanded) return false;
  const swap = (list: string[], from: string[], to: string[]) => {
    const i = list.indexOf(from[0]);
    if (i >= 0) list.splice(i, from.length, ...to);
  };
  const holders: string[][] = [];
  const parent = g.parent !== null ? model.blocks.get(g.parent) : undefined;
  if (parent) {
    holders.push(parent.children);
    // a nested group under a REPRESENTATIVE member also sits in the outer
    // group's display children (copied at build time) — keep both in sync
    const outer = parent.groupOf ? model.blocks.get(parent.groupOf) : undefined;
    if (outer?.members?.[0] === parent.path) holders.push(outer.children);
  }
  g.expanded = expanded;
  for (const h of holders) {
    if (expanded) swap(h, [gpath], g.members);
    else swap(h, g.members, [gpath]);
  }
  return true;
}
