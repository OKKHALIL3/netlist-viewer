import type { LayoutModel } from '../../layout-viewer/model';
import { bboxArea } from '../../layout-viewer/model';

// Topmost = smallest-area instance box (depth ≤ maxDepth) containing (wx,wy).
export function pickInstance(model: LayoutModel, maxDepth: number, wx: number, wy: number): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const inst of model.instances) {
    if (inst.depth > maxDepth) continue;
    const [x0, y0, x1, y1] = inst.bbox;
    if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
    const area = bboxArea(inst.bbox);
    if (area < bestArea) { bestArea = area; best = inst.id; }
  }
  return best;
}
