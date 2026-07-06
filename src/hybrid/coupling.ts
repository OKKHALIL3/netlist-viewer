import type { Design, Net } from '../parser/types';
import type { HybridModel } from './model';
import type { LayoutData } from '../layout-viewer/model';
import type { NetPairCoupling } from './layoutStats';
import { nameNetKind } from '../parser/netKinds';
import { normSeg, normSegments } from '../layout-viewer/correlate';

export interface CouplingNeighbor {
  block: string; total: number;
  pairs: Array<{ netA: string; netB: string; cap: number }>;
}

const related = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/') || a === '' || b === '';

// Display-path relatedness: an ARRAY GROUP stands for all of its members, so
// "self coupling" between a group and anything inside ANY member (e.g. the
// group vs its own displayed representative subtree) must be excluded.
export function relatedDisplay(model: HybridModel, a: string, b: string): boolean {
  const ra = model.blocks.get(a)?.members ?? [a];
  const rb = model.blocks.get(b)?.members ?? [b];
  for (const x of ra) for (const y of rb) if (related(x, y)) return true;
  return false;
}

// Resolve a flattened DSPF net name to the CDL Design's topology-refined
// Net.kind for that scope. Name regexes alone miss rails like AVRH (no
// vdd/vss substring) — see ARCHITECTURE.md §8 — so supply-ness must come
// from here, not from the name.
function cdlNetKind(design: Design, model: HybridModel, data: LayoutData, name: string): Net['kind'] | undefined {
  const segs = normSegments(name, [data.divider, data.delimiter]);
  const last = segs[segs.length - 1];
  const cell = segs.length <= 1
    ? design.cells.get(design.topCell)
    : (() => {
        const master = model.blocks.get(segs.slice(0, -1).join('/'))?.master;
        return master ? design.cells.get(master) : undefined;
      })();
  return cell?.nets.find(n => normSeg(n.name) === last)?.kind;
}

// DSPF net indices that are supply (ground flag, name pattern, or the CDL's
// topology-refined kind). Depends only on the loaded design + DSPF — build it
// once and cache; on hpio-scale extractions the per-net CDL lookups dominate
// couplingFor's cost when recomputed per selection.
export function buildSupplyIndex(design: Design, model: HybridModel, data: LayoutData): Set<number> {
  const supplyIdx = new Set<number>();
  data.nets.forEach((n, i) => {
    const topoKind = n.name ? cdlNetKind(design, model, data, n.name) : undefined;
    if (n.isGround || nameNetKind(n.name) !== 'signal' || (topoKind && topoKind !== 'signal')) supplyIdx.add(i);
  });
  return supplyIdx;
}

export function couplingFor(
  design: Design, model: HybridModel, data: LayoutData, pairs: NetPairCoupling[],
  selected: string, candidates: string[], minC: number, includeSupply: boolean,
  supplyIdx?: Set<number>,
): CouplingNeighbor[] {
  const sel = model.blocks.get(selected);
  if (!sel?.dspfNets) return [];
  const supply = supplyIdx ?? buildSupplyIndex(design, model, data);
  const isSupplyNet = (i: number) => supply.has(i);
  const out = new Map<string, CouplingNeighbor>();
  for (const cand of candidates) {
    if (relatedDisplay(model, selected, cand)) continue;
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
