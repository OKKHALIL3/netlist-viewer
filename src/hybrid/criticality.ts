import type { HybridModel } from './model';
import { displayPath } from './model';

const comps = (b: { devices: number; netCount: number; parasiticR: number | null; parasiticC: number | null; couplingC: number | null }): Array<number | null> => [
  b.devices,
  b.netCount,
  b.parasiticR === null && b.parasiticC === null ? null : (b.parasiticR ?? 0) + (b.parasiticC ?? 0),
  b.couplingC,
];

export function criticalityScores(model: HybridModel, weights: [number, number, number, number]): Map<string, number> {
  // Score DISPLAY blocks only: hidden array groups under non-representative
  // members carry union'd DSPF stats that would otherwise own the level max
  // and deflate every block the user can actually see.
  // …and skip EXPANDED groups: while a ×N group is popped open its members are
  // on canvas and it is not, but its summed stats would still own the level max
  // and deflate every visible block at that depth.
  const blocks = [...model.blocks.values()]
    .filter(b => displayPath(model, b.path) === b.path && !(b.members && b.expanded));
  // per-level max per component
  const levelMax = new Map<number, number[]>();
  for (const b of blocks) {
    const m = levelMax.get(b.depth) ?? [0, 0, 0, 0];
    comps(b).forEach((v, i) => { if (v !== null && v > m[i]) m[i] = v; });
    levelMax.set(b.depth, m);
  }
  const scores = new Map<string, number>();
  for (const b of blocks) {
    const max = levelMax.get(b.depth)!;
    const c = comps(b);
    // live components: value present AND level max > 0
    const live = c.map((v, i) => v !== null && max[i] > 0);
    let wSum = 0;
    live.forEach((ok, i) => { if (ok) wSum += weights[i]; });
    let score = 0;
    c.forEach((v, i) => {
      if (!live[i]) return;
      const w = wSum > 0 ? weights[i] / wSum : 1 / live.filter(Boolean).length;
      // log1p, not log(1 + x): for a sub-2^-53 max, 1 + x rounds to 1.0 and
      // Math.log(1 + x) is 0 → 0/0 = NaN. log1p stays accurate for tiny values,
      // so the divisor is > 0 whenever max[i] > 0.
      score += w * (Math.log1p(v as number) / Math.log1p(max[i]));
    });
    scores.set(b.path, score);
  }
  return scores;
}

export function criticalityOrder(scores: Map<string, number>): (a: string, b: string) => number {
  return (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b);
}
