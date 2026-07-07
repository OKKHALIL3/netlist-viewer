// Analytical helpers over a LayoutModel — surface the nets whose physical
// extent dwarfs the blocks they connect, i.e. the ones a physical designer
// should worry about. Pure + unit-tested.
import type { LayoutModel, Bbox } from './model';
import { emptyBbox, unionInto, bboxArea, bboxValid, bboxSize } from './model';

export interface SprawlNet {
  name: string;
  area: number;        // net bbox area (µm²)
  span: [number, number];
  reach: number;       // net area ÷ footprint of the blocks it touches (≥1 ⇒ spreads beyond)
  instances: number;   // how many blocks it spans
}

// Union bbox of the blocks a net touches (its "footprint").
function touchedFootprint(model: LayoutModel, instanceIds: string[]): Bbox | null {
  const byId = new Map(model.instances.map(i => [i.id, i.bbox]));
  const u = emptyBbox();
  let any = false;
  for (const id of instanceIds) {
    const b = byId.get(id);
    if (b) { unionInto(u, b); any = true; }
  }
  return any && bboxValid(u) ? u : null;
}

// How far a net spreads relative to the blocks it serves. ≥1 means the net's
// bbox is larger than the combined footprint of the blocks it connects.
export function reachRatio(model: LayoutModel, netName: string): number {
  const net = model.nets.find(n => n.name === netName);
  if (!net || !bboxValid(net.bbox)) return 0;
  const foot = touchedFootprint(model, net.instances);
  const footArea = foot ? bboxArea(foot) : 0;
  const netArea = bboxArea(net.bbox);
  return footArea > 1e-9 ? netArea / footArea : 0;
}

// Top nets by physical spread (bbox area), descending. Degenerate
// zero-area nets are skipped. The instance-bbox index is built ONCE and the
// reach is computed from the net object in hand — the per-net reachRatio()
// rebuilt that index and re-found the net by name, making this O(nets²) and
// freezing the Insights panel on large designs.
export function rankBySprawl(model: LayoutModel, limit = 8): SprawlNet[] {
  const byId = new Map(model.instances.map(i => [i.id, i.bbox]));
  const reachOf = (net: LayoutModel['nets'][number]): number => {
    const u = emptyBbox();
    let any = false;
    for (const id of net.instances) { const b = byId.get(id); if (b) { unionInto(u, b); any = true; } }
    const footArea = any && bboxValid(u) ? bboxArea(u) : 0;
    return footArea > 1e-9 ? bboxArea(net.bbox) / footArea : 0;
  };
  const ranked: SprawlNet[] = [];
  for (const n of model.nets) {
    if (!bboxValid(n.bbox)) continue;
    const area = bboxArea(n.bbox);
    if (area <= 0) continue;
    ranked.push({
      name: n.name, area, span: bboxSize(n.bbox),
      reach: reachOf(n), instances: n.instances.length,
    });
  }
  ranked.sort((a, b) => b.area - a.area);
  return ranked.slice(0, limit);
}
