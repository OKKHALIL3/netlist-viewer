import type { HybridModel } from '../../hybrid/model';
import { criticalityScores } from '../../hybrid/criticality';
import type { LayoutData } from '../../layout-viewer/model';
import type { NetPairCoupling } from '../../hybrid/layoutStats';

// Ranking surfaces for the rank intent: the existing criticality composite
// per block, re-joined with each block's raw component values so an answer
// can say WHY a block ranks high; plus simple net rankings by coupling or
// total cap (physical sprawl ranking already exists in layout-viewer/insights).

export interface RankedBlock {
  path: string;
  score: number;
  components: {
    devices: number;
    nets: number;
    parasitics: number | null; // R+C element count (null = no DSPF data)
    coupling: number | null;   // summed coupling farads
  };
}

export function rankBlocksDetailed(
  model: HybridModel,
  weights: [number, number, number, number],
  limit = 10,
): RankedBlock[] {
  const scores = criticalityScores(model, weights);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, score]) => {
      const b = model.blocks.get(path)!;
      return {
        path,
        score,
        components: {
          devices: b.devices,
          nets: b.netCount,
          parasitics: b.parasiticR === null && b.parasiticC === null ? null : (b.parasiticR ?? 0) + (b.parasiticC ?? 0),
          coupling: b.couplingC,
        },
      };
    });
}

export function rankNetsBy(
  data: LayoutData,
  pairs: NetPairCoupling[],
  supplyIdx: Set<number>,
  by: 'coupling' | 'totalCap',
  limit = 10,
): Array<{ net: string; idx: number; value: number }> {
  const value = new Map<number, number>();
  if (by === 'coupling') {
    for (const p of pairs) {
      for (const [self] of [[p.aIdx], [p.bIdx]] as const) {
        if (supplyIdx.has(self)) continue;
        value.set(self, (value.get(self) ?? 0) + p.cap);
      }
    }
  } else {
    for (let idx = 0; idx < data.nets.length; idx++) {
      const net = data.nets[idx];
      if (net.isGround || supplyIdx.has(idx)) continue;
      let v = net.totalCap;
      if (v === null) {
        v = 0;
        for (const c of net.capacitors) if (typeof c.value === 'number') v += c.value;
        for (const p of net.instPins) if (typeof p.cap === 'number') v += p.cap;
      }
      if (v > 0) value.set(idx, v);
    }
  }
  return [...value.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([idx, v]) => ({ net: data.nets[idx]?.name ?? `net#${idx}`, idx, value: v }));
}
