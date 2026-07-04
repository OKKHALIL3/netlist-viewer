import type { HybridModel } from './model';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';

export interface NetPairCoupling { aIdx: number; bIdx: number; cap: number }

export function attachLayoutStats(model: HybridModel, data: LayoutData, lm: LayoutModel): NetPairCoupling[] {
  const netIdxByName = new Map<string, number>();
  data.nets.forEach((n, i) => netIdxByName.set(n.name, i));

  // node name → owning net index (net name + every named node in its section,
  // INCLUDING R/C element terminals — extractors reference internal nodes like
  // `mid:1` that appear only as element endpoints, never as *|S subnodes)
  const nodeNet = new Map<string, number>();
  const claim = (name: string, i: number) => { if (!nodeNet.has(name)) nodeNet.set(name, i); };
  data.nets.forEach((n, i) => {
    claim(n.name, i);
    for (const s of n.subnodes) claim(s.name, i);
    for (const p of n.ports) claim(p.name, i);
    for (const ip of n.instPins) claim(ip.name, i);
    for (const r of n.resistors) { claim(r.a, i); claim(r.b, i); }
    for (const c of n.capacitors) if (!c.coupling) { claim(c.a, i); claim(c.b, i); }
  });

  // per-block net sets with ancestor rollup
  for (const b of model.blocks.values()) b.dspfNets = new Set();
  const addToChain = (blockPath: string, netIdx: number) => {
    let p: string | null = blockPath;
    while (p !== null) {
      const blk = model.blocks.get(p);
      if (!blk) break;
      blk.dspfNets!.add(netIdx);
      // Array groups sit beside (not on) the real parent chain — feed them as
      // the chain passes their members so a group's parasitics/coupling are
      // the union over all elements.
      if (blk.groupOf) model.blocks.get(blk.groupOf)!.dspfNets!.add(netIdx);
      p = blk.parent;
    }
  };
  for (const ln of lm.nets) {
    const idx = netIdxByName.get(ln.name);
    if (idx === undefined) continue;
    model.blocks.get('')!.dspfNets!.add(idx);
    for (const inst of ln.instances) addToChain(inst, idx);
  }

  // net-pair coupling index
  const pairs: NetPairCoupling[] = [];
  const capsByNet: Array<Array<{ other: number; cap: number; id: string }>> = data.nets.map(() => []);
  data.nets.forEach((n, aIdx) => {
    for (const c of n.capacitors) {
      if (!c.coupling || c.value === null) continue;
      // one terminal is local to this section, the other is the foreign net's node
      const na = nodeNet.get(c.a), nb = nodeNet.get(c.b);
      const bIdx = nb !== undefined && nb !== aIdx ? nb : na !== undefined && na !== aIdx ? na : undefined;
      if (bIdx === undefined) continue;
      const id = `${aIdx}:${c.name}`;
      pairs.push({ aIdx, bIdx, cap: c.value });
      capsByNet[aIdx].push({ other: bIdx, cap: c.value, id });
      capsByNet[bIdx].push({ other: aIdx, cap: c.value, id });
    }
  });

  // per-block counters
  for (const b of model.blocks.values()) {
    let r = 0, cGnd = 0, coup = 0;
    const seenCap = new Set<string>();
    for (const idx of b.dspfNets!) {
      const n = data.nets[idx];
      r += n.resistors.length;
      cGnd += n.capacitors.filter(c => !c.coupling).length;
      for (const cc of capsByNet[idx]) {
        if (seenCap.has(cc.id)) continue;
        seenCap.add(cc.id);
        coup += cc.cap;
      }
    }
    b.parasiticR = r; b.parasiticC = cGnd; b.couplingC = coup;
  }
  model.hasLayout = true;
  return pairs;
}
