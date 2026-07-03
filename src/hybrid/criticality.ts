import type { HybridModel } from './model';

const comps = (b: { devices: number; netCount: number; parasiticR: number | null; parasiticC: number | null; couplingC: number | null }): Array<number | null> => [
  b.devices,
  b.netCount,
  b.parasiticR === null && b.parasiticC === null ? null : (b.parasiticR ?? 0) + (b.parasiticC ?? 0),
  b.couplingC,
];

export function criticalityScores(model: HybridModel, weights: [number, number, number, number]): Map<string, number> {
  // per-level max per component
  const levelMax = new Map<number, number[]>();
  for (const b of model.blocks.values()) {
    const m = levelMax.get(b.depth) ?? [0, 0, 0, 0];
    comps(b).forEach((v, i) => { if (v !== null && v > m[i]) m[i] = v; });
    levelMax.set(b.depth, m);
  }
  const scores = new Map<string, number>();
  for (const b of model.blocks.values()) {
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
      score += w * (Math.log(1 + (v as number)) / Math.log(1 + max[i]));
    });
    scores.set(b.path, score);
  }
  return scores;
}

export function criticalityOrder(scores: Map<string, number>): (a: string, b: string) => number {
  return (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b);
}
