import type { LayoutData } from '../../layout-viewer/model';
import type { NetPairCoupling } from '../../hybrid/layoutStats';

// Parasitic summary over a slice — the set of DSPF nets a hybrid block (and
// its subtree, per HybridBlock.dspfNets rollup) touches. All figures are sums
// of extracted elements (exact, no prediction): rTotal is the sum of the
// net's resistor elements (a wire-mass proxy, NOT point-to-point effective R),
// cGround counts grounded caps, cCoupling counts cross-net coupling caps from
// the design-wide pair index, cPin counts instance pin caps.

export interface NetParasitics {
  net: string;
  idx: number;
  rTotal: number;
  cGround: number;
  cCoupling: number;
  cPin: number;
  partners: Array<{ net: string; cap: number }>;
}

export interface SliceParasitics {
  nets: NetParasitics[];
  totals: { r: number; cGround: number; cCoupling: number; cPin: number };
  netCount: number;
  truncated: boolean;
}

const TOP_PARTNERS = 5;

export function sliceParasitics(
  dspfNets: Set<number>,
  data: LayoutData,
  pairs: NetPairCoupling[],
  topN = 25,
): SliceParasitics {
  // Coupling exposure per slice net, and each net's partner breakdown.
  const couplingOf = new Map<number, number>();
  const partnersOf = new Map<number, Map<number, number>>();
  let pairTotal = 0; // each pair counted once for the slice total
  for (const p of pairs) {
    const aIn = dspfNets.has(p.aIdx);
    const bIn = dspfNets.has(p.bIdx);
    if (!aIn && !bIn) continue;
    pairTotal += p.cap;
    for (const [self, other, isIn] of [[p.aIdx, p.bIdx, aIn], [p.bIdx, p.aIdx, bIn]] as const) {
      if (!isIn) continue;
      couplingOf.set(self, (couplingOf.get(self) ?? 0) + p.cap);
      let m = partnersOf.get(self);
      if (!m) partnersOf.set(self, m = new Map());
      m.set(other, (m.get(other) ?? 0) + p.cap);
    }
  }

  const nets: NetParasitics[] = [];
  const totals = { r: 0, cGround: 0, cCoupling: pairTotal, cPin: 0 };
  for (const idx of dspfNets) {
    const net = data.nets[idx];
    if (!net) continue;
    let rTotal = 0;
    for (const r of net.resistors) if (typeof r.value === 'number') rTotal += r.value;
    let cGround = 0;
    for (const c of net.capacitors) if (!c.coupling && typeof c.value === 'number') cGround += c.value;
    let cPin = 0;
    for (const p of net.instPins) if (typeof p.cap === 'number') cPin += p.cap;
    const partners = [...(partnersOf.get(idx) ?? [])]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_PARTNERS)
      .map(([otherIdx, cap]) => ({ net: data.nets[otherIdx]?.name ?? `net#${otherIdx}`, cap }));
    nets.push({ net: net.name, idx, rTotal, cGround, cCoupling: couplingOf.get(idx) ?? 0, cPin, partners });
    totals.r += rTotal;
    totals.cGround += cGround;
    totals.cPin += cPin;
  }

  nets.sort((a, b) => (b.cGround + b.cCoupling) - (a.cGround + a.cCoupling));
  const truncated = nets.length > topN;
  return { nets: nets.slice(0, topN), totals, netCount: nets.length, truncated };
}
