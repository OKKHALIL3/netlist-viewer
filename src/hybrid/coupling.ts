import type { HybridModel } from './model';
import type { LayoutData } from '../layout-viewer/model';
import type { NetPairCoupling } from './layoutStats';
import { nameNetKind } from '../parser/netKinds';

export interface CouplingNeighbor {
  block: string; total: number;
  pairs: Array<{ netA: string; netB: string; cap: number }>;
}

const related = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/') || a === '' || b === '';

export function couplingFor(
  model: HybridModel, data: LayoutData, pairs: NetPairCoupling[],
  selected: string, candidates: string[], minC: number, includeSupply: boolean,
): CouplingNeighbor[] {
  const sel = model.blocks.get(selected);
  if (!sel?.dspfNets) return [];
  const isSupplyNet = (i: number) =>
    data.nets[i].isGround || nameNetKind(data.nets[i].name) !== 'signal';
  const out = new Map<string, CouplingNeighbor>();
  for (const cand of candidates) {
    if (related(selected, cand)) continue;
    const nb = model.blocks.get(cand);
    if (!nb?.dspfNets) continue;
    for (const p of pairs) {
      if (!includeSupply && (isSupplyNet(p.aIdx) || isSupplyNet(p.bIdx))) continue;
      const hit =
        (sel.dspfNets.has(p.aIdx) && nb.dspfNets.has(p.bIdx)) ? [p.aIdx, p.bIdx] :
        (sel.dspfNets.has(p.bIdx) && nb.dspfNets.has(p.aIdx)) ? [p.bIdx, p.aIdx] : null;
      if (!hit) continue;
      let e = out.get(cand);
      if (!e) { e = { block: cand, total: 0, pairs: [] }; out.set(cand, e); }
      e.total += p.cap;
      e.pairs.push({ netA: data.nets[hit[0]].name, netB: data.nets[hit[1]].name, cap: p.cap });
    }
  }
  const list = [...out.values()].filter(n => n.total >= minC);
  for (const n of list) n.pairs.sort((a, b) => b.cap - a.cap);
  return list.sort((a, b) => b.total - a.total);
}
