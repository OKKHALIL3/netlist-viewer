import type { HybridModel } from './model';
import { displayPath } from './model';

// Path-expansion rail layout: the canvas shows ONE rail per open level, not
// the whole subtree. Rail 0 is the top cell; double-clicking a block opens
// its children on the rail below it — the block itself stays where it is.
// Only the chain of open blocks (`openPath`) expands; siblings of an open
// block stay visible as thin slivers — enough to know what sits beside you.
//
// Focus model: the deepest (frontier) rail is the CONTENT — full-size,
// full-strength. Every rail above it is CONTEXT — the open ancestor renders
// as a compressed card (CTX_W) and its siblings as extra-thin slivers; the
// canvas fades them too.
//
// For large designs the open chain runs straight down a CENTER SPINE —
// every open ancestor is centered, siblings alternate outward most-critical-
// first, capped per side with a "+N" stub for the rest. The frontier wraps
// into stacked, centered rows instead of one endless strip, strongest blocks
// in the middle of each row. 0-dev/0-net leaf blocks (device wrappers the
// CDL can't resolve) are dropped from the rails entirely and only reported
// as a per-rail hidden count.

export const SLIVER_W = 12;   // context sliver (siblings of open ancestors)
export const CTX_W = 96;      // compressed open-ancestor card
export const STUB_W = 18;     // "+N" aggregate stub for truncated slivers
const FULL_W = 150, GAP = 10;
const MAX_SLIVERS_SIDE = 4;   // slivers kept per side of an open ancestor
const MAX_ROW_W = 1080;       // frontier wraps into stacked rows beyond this

// `kind` is only set by the multi-branch REVEAL layout, where a block's render
// class can't be read off its rail (full-size targets live at any depth). The
// single-chain layout leaves it undefined and the renderer derives it from
// `sliver` + the frontier, so its item shape is unchanged.
export type RailKind = 'full' | 'context' | 'sliver';
export interface RailItem { path: string; x: number; w: number; lvl: number; row: number; sliver: boolean; kind?: RailKind }
export interface RailStub { lvl: number; x: number; w: number; count: number }
export interface RailsLayout {
  items: Map<string, RailItem>;
  rails: string[][];      // rails[lvl] = ordered display paths (hidden empties removed)
  stubs: RailStub[];      // "+N" chips standing in for truncated slivers
  hidden: number[];       // hidden[lvl] = empty-leaf instances dropped from that rail
  rowsAt: number[];       // rows per rail — the frontier may stack into several
  width: number;          // content width; the spine sits at width / 2
  openPath: string[];     // the validated open chain actually laid out
  edges?: [string, string][]; // reveal only: explicit parent→child links to draw
}

// openPath entries must form a parent→child chain from the root — anything
// stale (model rebuilt, filters changed the tree) truncates the chain there.
function validChain(model: HybridModel, openPath: string[]): string[] {
  const chain: string[] = [];
  for (let i = 0; i < openPath.length; i++) {
    const p = openPath[i];
    if (!model.blocks.has(p)) break;
    if (i === 0 ? p !== '' : !model.blocks.get(chain[i - 1])!.children.includes(p)) break;
    chain.push(p);
  }
  return chain;
}

export function computeRails(
  model: HybridModel, openPath: string[],
  order?: (a: string, b: string) => number,
  fullW: (path: string) => number = () => FULL_W,
  reveal?: string[],
): RailsLayout {
  if (reveal && reveal.length) return computeRevealRails(model, validChain(model, openPath), reveal, order, fullW);
  const items = new Map<string, RailItem>();
  const rails: string[][] = [];
  const stubs: RailStub[] = [];
  const hidden: number[] = [];
  const rowsAt: number[] = [];
  const chain = validChain(model, openPath);
  if (!model.blocks.has('')) return { items, rails, stubs, hidden, rowsAt, width: 0, openPath: chain };

  // A 0-dev/0-net leaf is a device the CDL couldn't resolve into a cell
  // (moscap/dummy wrappers) — not a block worth a card.
  const emptyLeaf = (p: string) => {
    const b = model.blocks.get(p)!;
    return b.devices === 0 && b.netCount === 0 && b.children.length === 0;
  };
  const instancesOf = (p: string) => model.blocks.get(p)!.members?.length ?? 1;

  rails.push(['']);
  hidden.push(0);
  for (const open of chain) {
    const all = model.blocks.get(open)!.children;
    hidden.push(all.reduce((a, p) => a + (emptyLeaf(p) ? instancesOf(p) : 0), 0));
    const kids = all.filter(p => !emptyLeaf(p));
    if (order) kids.sort((a, b) => order(a, b) || a.localeCompare(b));
    rails.push(kids);
  }

  const frontier = chain.length;

  // Geometry in CENTERED coordinates: x measured from the spine at 0, so the
  // open chain runs straight down the middle; shifted to >= 0 at the end.
  interface Placed { path: string; x: number; w: number; lvl: number; row: number; sliver: boolean }
  const placed: Placed[] = [];

  rails.forEach((rail, lvl) => {
    rowsAt.push(1);
    if (lvl < frontier) {
      // Context rail: the open ancestor sits on the spine; siblings alternate
      // outward most-critical-first, capped per side, the rest one "+N" stub.
      const openP = chain[lvl];
      placed.push({ path: openP, x: -CTX_W / 2, w: CTX_W, lvl, row: 0, sliver: false });
      const sides: string[][] = [[], []]; // 0 = right of spine, 1 = left
      rail.filter(p => p !== openP).forEach((p, i) => sides[i % 2].push(p));
      sides.forEach((side, s) => {
        const dir = s === 0 ? 1 : -1;
        let edge = CTX_W / 2;
        for (const p of side.slice(0, MAX_SLIVERS_SIDE)) {
          placed.push({ path: p, x: dir === 1 ? edge + GAP : -(edge + GAP + SLIVER_W), w: SLIVER_W, lvl, row: 0, sliver: true });
          edge += GAP + SLIVER_W;
        }
        if (side.length > MAX_SLIVERS_SIDE) {
          stubs.push({ lvl, x: dir === 1 ? edge + GAP : -(edge + GAP + STUB_W), w: STUB_W, count: side.length - MAX_SLIVERS_SIDE });
        }
      });
      return;
    }
    // Frontier rail: full cards, greedily packed into rows (criticality
    // order), each row centered on the spine with its strongest card in the
    // middle and weaker ones alternating outward.
    const ws = rail.map(p => fullW(p));
    const rows: number[][] = [[]];
    let acc = 0;
    rail.forEach((_, i) => {
      const row = rows[rows.length - 1];
      const wWith = acc + (row.length ? GAP : 0) + ws[i];
      if (row.length && wWith > MAX_ROW_W) { rows.push([i]); acc = ws[i]; }
      else { row.push(i); acc = wWith; }
    });
    rowsAt[lvl] = rows.length;
    rows.forEach((idxs, r) => {
      const seq: number[] = [];
      idxs.forEach((idx, i) => { if (i % 2 === 0) seq.push(idx); else seq.unshift(idx); });
      const total = seq.reduce((a, idx) => a + ws[idx], 0) + GAP * Math.max(0, seq.length - 1);
      let x = -total / 2;
      for (const idx of seq) {
        placed.push({ path: rail[idx], x, w: ws[idx], lvl, row: r, sliver: false });
        x += ws[idx] + GAP;
      }
    });
  });

  let minX = Infinity, maxX = -Infinity;
  for (const it of placed) { minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x + it.w); }
  for (const st of stubs) { minX = Math.min(minX, st.x); maxX = Math.max(maxX, st.x + st.w); }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; }
  for (const it of placed) items.set(it.path, { ...it, x: it.x - minX });
  for (const st of stubs) st.x -= minX;
  return { items, rails, stubs, hidden, rowsAt, width: maxX - minX, openPath: chain };
}

// ---- Multi-branch reveal layout -----------------------------------------
//
// When a block is selected, the canvas opens a branch to the selection AND to
// each of its device neighbors at once. The result is no longer one open chain
// but a small tree: the selection and its neighbors are the full-size leaves,
// the ancestors linking them to the root are compressed CONTEXT cards, and each
// open ancestor's other children stay as thin slivers (capped, the rest a "+N"
// stub). Laid out as a tidy tree — subtree widths bottom-up, positions
// top-down so children sit under their parent — and the renderer draws the
// explicit parent→child edges.

const MAX_REVEAL_SLIVERS = 4; // per open ancestor before the rest fold into +N

function dparent(model: HybridModel, p: string): string | null {
  const par = model.blocks.get(p)?.parent;
  return par === null || par === undefined ? null : displayPath(model, par);
}

function computeRevealRails(
  model: HybridModel, chain: string[], reveal: string[],
  order: ((a: string, b: string) => number) | undefined,
  fullW: (path: string) => number,
): RailsLayout {
  const items = new Map<string, RailItem>();
  const rails: string[][] = [];
  const stubs: RailStub[] = [];
  const hidden: number[] = [];
  const edges: [string, string][] = [];
  if (!model.blocks.has('')) return { items, rails, stubs, hidden, rowsAt: [], width: 0, openPath: chain, edges };

  const targets = new Set<string>();
  for (const t of reveal) if (model.blocks.has(t)) targets.add(t);

  // Open nodes = every block whose children must be shown: the manual chain,
  // plus every ancestor of every target down from the root.
  const openSet = new Set<string>(chain);
  openSet.add('');
  for (const t of targets) for (let p = dparent(model, t); p !== null; p = dparent(model, p)) openSet.add(p);

  const emptyLeaf = (p: string) => {
    const b = model.blocks.get(p)!;
    return b.devices === 0 && b.netCount === 0 && b.children.length === 0;
  };
  const instancesOf = (p: string) => model.blocks.get(p)!.members?.length ?? 1;
  const kindOf = (p: string): RailKind => (targets.has(p) ? 'full' : openSet.has(p) ? 'context' : 'sliver');
  const itemW = (p: string) => { const k = kindOf(p); return k === 'sliver' ? SLIVER_W : k === 'full' ? fullW(p) : CTX_W; };

  // Children of an open node that earn a slot: all target/open children, then a
  // capped run of sliver siblings; the rest are reported as one "+N" stub.
  const shownChildren = (p: string): { kids: string[]; stub: number } => {
    if (!openSet.has(p)) return { kids: [], stub: 0 };
    const all = model.blocks.get(p)!.children.filter(c => !emptyLeaf(c));
    if (order) all.sort((a, b) => order(a, b) || a.localeCompare(b));
    const heavy = all.filter(c => targets.has(c) || openSet.has(c));
    const slivs = all.filter(c => !targets.has(c) && !openSet.has(c));
    return { kids: [...heavy, ...slivs.slice(0, MAX_REVEAL_SLIVERS)], stub: Math.max(0, slivs.length - MAX_REVEAL_SLIVERS) };
  };

  const subW = new Map<string, number>();
  const width = (p: string): number => {
    const hit = subW.get(p);
    if (hit !== undefined) return hit;
    const { kids, stub } = shownChildren(p);
    let w = itemW(p);
    if (kids.length || stub) {
      const parts = kids.map(width);
      if (stub) parts.push(STUB_W);
      const cw = parts.reduce((a, b) => a + b, 0) + GAP * Math.max(0, parts.length - 1);
      w = Math.max(w, cw);
    }
    subW.set(p, w);
    return w;
  };

  // Each node owns the span [x0, x0+subtreeWidth]; its own card is centered in
  // that span and its children are centered as a group beneath it.
  const place = (p: string, x0: number, lvl: number) => {
    const wsub = width(p), own = itemW(p);
    items.set(p, { path: p, x: x0 + (wsub - own) / 2, w: own, lvl, row: 0, sliver: kindOf(p) === 'sliver', kind: kindOf(p) });
    (rails[lvl] ??= []).push(p);
    if (openSet.has(p)) {
      const raw = model.blocks.get(p)!.children;
      hidden[lvl + 1] = (hidden[lvl + 1] ?? 0) + raw.reduce((a, c) => a + (emptyLeaf(c) ? instancesOf(c) : 0), 0);
    }
    const { kids, stub } = shownChildren(p);
    if (!kids.length && !stub) return;
    const parts = kids.map(width);
    if (stub) parts.push(STUB_W);
    const total = parts.reduce((a, b) => a + b, 0) + GAP * Math.max(0, parts.length - 1);
    let cur = x0 + (wsub - total) / 2;
    kids.forEach((c, i) => {
      place(c, cur, lvl + 1);
      edges.push([p, c]);
      cur += parts[i] + GAP;
    });
    if (stub) stubs.push({ lvl: lvl + 1, x: cur, w: STUB_W, count: stub });
  };
  place('', 0, 0);

  let minX = Infinity, maxX = -Infinity;
  for (const it of items.values()) { minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x + it.w); }
  for (const st of stubs) { minX = Math.min(minX, st.x); maxX = Math.max(maxX, st.x + st.w); }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; }
  for (const [k, it] of items) items.set(k, { ...it, x: it.x - minX });
  for (const st of stubs) st.x -= minX;
  const rowsAt = rails.map(() => 1);
  for (let i = 0; i < rails.length; i++) if (hidden[i] === undefined) hidden[i] = 0;
  return { items, rails, stubs, hidden, rowsAt, width: maxX - minX, openPath: chain, edges };
}

// The visible display set without geometry — for the footer totals and the
// coupling panel, which only need to know WHAT is on canvas. Deliberately
// includes empty leaves and stub-truncated siblings: totals describe the open
// levels, not the subset that won a card.
export function visiblePaths(model: HybridModel, openPath: string[]): string[] {
  if (!model.blocks.has('')) return [];
  const out = [''];
  for (const open of validChain(model, openPath)) out.push(...model.blocks.get(open)!.children);
  return out;
}
