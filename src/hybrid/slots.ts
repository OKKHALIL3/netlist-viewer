import type { HybridModel } from './model';

export interface SlotLayout { slot: Map<string, number>; width: number }

export function computeSlots(
  model: HybridModel, rootPath: string, maxDepth: number,
  order?: (a: string, b: string) => number,
): SlotLayout {
  const slot = new Map<string, number>();
  const rootDepth = model.blocks.get(rootPath)?.depth ?? 0;
  let cursor = 0;
  const dfs = (path: string): number => {
    const b = model.blocks.get(path)!;
    const kids = b.depth - rootDepth < maxDepth ? [...b.children] : [];
    if (order) kids.sort((x, y) => order(x, y) || x.localeCompare(y));
    if (kids.length === 0) { const s = cursor++; slot.set(path, s); return s; }
    const xs = kids.map(dfs);
    const s = xs.reduce((a, v) => a + v, 0) / xs.length;
    slot.set(path, s);
    return s;
  };
  if (model.blocks.has(rootPath)) dfs(rootPath);
  return { slot, width: cursor };
}
