import type { HybridModel } from './model';

// Path-expansion rail layout (Amr's round-3 navigation model): the canvas
// shows ONE rail per open level, not the whole subtree. Rail 0 is the top
// cell; double-clicking a block opens its children on the rail below it —
// the block itself stays where it is. Only the chain of open blocks
// (`openPath`) expands; siblings of an open block stay visible as thin
// slivers "just to know what is beside you".
//
// Round 4 ("it should give you only its children, with everything else in
// this hierarchy on the side, faded and compressed"): the deepest (frontier)
// rail is the CONTENT — full-size, full-strength. Every rail above it is
// CONTEXT — the open ancestor renders as a compressed card (CTX_W) and its
// siblings as extra-thin slivers; the canvas fades them too.
//
// Round 6 (large designs): the open chain runs straight down a CENTER SPINE —
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

export interface RailItem { path: string; x: number; w: number; lvl: number; row: number; sliver: boolean }
export interface RailStub { lvl: number; x: number; w: number; count: number }
export interface RailsLayout {
  items: Map<string, RailItem>;
  rails: string[][];      // rails[lvl] = ordered display paths (hidden empties removed)
  stubs: RailStub[];      // "+N" chips standing in for truncated slivers
  hidden: number[];       // hidden[lvl] = empty-leaf instances dropped from that rail
  rowsAt: number[];       // rows per rail — the frontier may stack into several
  width: number;          // content width; the spine sits at width / 2
  openPath: string[];     // the validated open chain actually laid out
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
): RailsLayout {
  const items = new Map<string, RailItem>();
  const rails: string[][] = [];
  const stubs: RailStub[] = [];
  const hidden: number[] = [];
  const rowsAt: number[] = [];
  const chain = validChain(model, openPath);
  if (!model.blocks.has('')) return { items, rails, stubs, hidden, rowsAt, width: 0, openPath: chain };

  // A 0-dev/0-net leaf is a device the CDL couldn't resolve into a cell
  // (moscap/dummy wrappers) — not a block worth a card (Amr round 6 item 6).
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
