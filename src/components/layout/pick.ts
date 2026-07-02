import type { LayoutModel, Bbox } from '../../layout-viewer/model';
import { bboxArea } from '../../layout-viewer/model';

// Topmost = smallest-area instance box (depth ≤ maxDepth) containing (wx,wy).
// `eligible` narrows the candidates (focus mode picks within the branch only).
export function pickInstance(
  model: LayoutModel, maxDepth: number, wx: number, wy: number,
  eligible?: (inst: LayoutModel['instances'][number]) => boolean,
): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const inst of model.instances) {
    if (inst.depth > maxDepth) continue;
    if (eligible && !eligible(inst)) continue;
    const [x0, y0, x1, y1] = inst.bbox;
    if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
    const area = bboxArea(inst.bbox);
    if (area < bestArea) { bestArea = area; best = inst.id; }
  }
  return best;
}

// A net bbox is a dashed OUTLINE — clicking it means clicking near its edge
// (within tol world units), not anywhere in its (usually huge) interior,
// which must stay clickable for the blocks underneath.
export function pickNetBox(
  nets: Array<{ name: string; bbox: Bbox }>,
  wx: number, wy: number, tol: number,
): string | null {
  for (const n of nets) {
    const [x0, y0, x1, y1] = n.bbox;
    const withinOuter = wx >= x0 - tol && wx <= x1 + tol && wy >= y0 - tol && wy <= y1 + tol;
    const withinInner = wx >= x0 + tol && wx <= x1 - tol && wy >= y0 + tol && wy <= y1 - tol;
    if (withinOuter && !withinInner) return n.name;
  }
  return null;
}
