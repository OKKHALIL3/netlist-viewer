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

export const SLIVER_W = 12;   // context sliver (siblings of open ancestors)
export const CTX_W = 96;      // compressed open-ancestor card
const FULL_W = 150, GAP = 10;

export interface RailItem { path: string; x: number; w: number; lvl: number; sliver: boolean }
export interface RailsLayout {
  items: Map<string, RailItem>;
  rails: string[][];      // rails[lvl] = ordered display paths on that rail
  width: number;          // content width (widest rail); rails are centered in it
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
  const chain = validChain(model, openPath);
  if (!model.blocks.has('')) return { items, rails, width: 0, openPath: chain };

  rails.push(['']);
  for (const open of chain) {
    const kids = [...model.blocks.get(open)!.children];
    if (order) kids.sort((a, b) => order(a, b) || a.localeCompare(b));
    rails.push(kids);
  }

  // rail lvl's open child is chain[lvl] (undefined on the frontier → all full)
  const frontier = chain.length;
  const isSliver = (p: string, lvl: number) => lvl > 0 && chain[lvl] !== undefined && p !== chain[lvl];
  const widthOf = (p: string, lvl: number) =>
    isSliver(p, lvl) ? SLIVER_W : lvl < frontier ? CTX_W : fullW(p);
  const railW = rails.map((rail, lvl) =>
    rail.reduce((a, p) => a + widthOf(p, lvl), 0) + GAP * Math.max(0, rail.length - 1));
  const width = Math.max(0, ...railW);
  rails.forEach((rail, lvl) => {
    let x = (width - railW[lvl]) / 2;
    for (const p of rail) {
      const w = widthOf(p, lvl);
      items.set(p, { path: p, x, w, lvl, sliver: isSliver(p, lvl) });
      x += w + GAP;
    }
  });
  return { items, rails, width, openPath: chain };
}

// The visible display set without geometry — for the footer totals and the
// coupling panel, which only need to know WHAT is on canvas.
export function visiblePaths(model: HybridModel, openPath: string[]): string[] {
  if (!model.blocks.has('')) return [];
  const out = [''];
  for (const open of validChain(model, openPath)) out.push(...model.blocks.get(open)!.children);
  return out;
}
