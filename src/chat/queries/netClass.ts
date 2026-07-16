import type { Design } from '../../parser/types';
import type { HybridModel } from '../../hybrid/model';
import { normSeg } from '../../layout-viewer/correlate';

// HEURISTIC net classes for the find intent. True bias-net identification was
// deferred by the source spec (its open question Q3) — until it exists, a net
// is "bias" when it touches a pin of an instance whose master cell classifies
// as A:REF/BIAS, and "clock" by name or by touching a D:CLK block. Every
// answer surface that uses these classes must say "heuristic".

export type NetClass = 'bias' | 'clock' | 'signal';

const CLOCK_NAME_RE = /(^|[^a-z])(clk|ck|clock)([^a-z]|$)/i;

// Keys match Conductors.idOf: `${scope}|${net}` with scope = real (non-group)
// hybrid block path and net = raw net name from Cell.nets. Supply/ground nets
// are omitted entirely — they have no class.
export function classifyNets(design: Design, model: HybridModel): Map<string, NetClass> {
  // Category by master cell name: classification rules key on the cell, so any
  // block instance of that master carries the same category.
  const categoryOfMaster = new Map<string, string | null>();
  for (const b of model.blocks.values()) {
    if (!categoryOfMaster.has(b.master)) categoryOfMaster.set(b.master, b.category);
  }

  const out = new Map<string, NetClass>();
  for (const b of model.blocks.values()) {
    if (b.members) continue; // array groups are display stand-ins, not scopes
    const cell = design.cells.get(b.master);
    if (!cell) continue;

    const classOf = new Map<string, NetClass>();
    for (const net of cell.nets) {
      if (net.kind !== 'signal') continue;
      classOf.set(net.name, CLOCK_NAME_RE.test(net.name) ? 'clock' : 'signal');
    }

    for (const inst of cell.instances) {
      const cat = categoryOfMaster.get(inst.master) ?? null;
      if (cat !== 'A:REF/BIAS' && cat !== 'D:CLK') continue;
      for (const net of Object.values(inst.conn)) {
        const cur = classOf.get(net);
        if (cur === undefined) continue; // supply or unknown
        if (cat === 'A:REF/BIAS') classOf.set(net, 'bias'); // bias wins over clock-by-name
        else if (cur === 'signal') classOf.set(net, 'clock');
      }
    }

    for (const [net, klass] of classOf) {
      out.set(`${b.path}|${net}`, klass); // raw name — matches Conductors.idOf
      const norm = normSeg(net);
      if (norm !== net) out.set(`${b.path}|${norm}`, klass); // normalized — matches DSPF lookups
    }
  }
  return out;
}

// Class lookup for a DSPF net name (hierarchical, e.g. "xu1/xs2:n1" or a top
// port "ck"): normalize segments with the DSPF's own separators, treat the
// leading segments as the scope path and the last as the net name.
export function classForDspfName(
  classes: Map<string, NetClass>,
  name: string,
  seps: string[],
): NetClass | null {
  const escaped = seps.filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const segs = (escaped ? name.split(new RegExp(`[${escaped}]`)) : [name]).map(normSeg).filter(Boolean);
  if (segs.length === 0) return null;
  const net = segs[segs.length - 1];
  const scope = segs.slice(0, -1).join('/');
  // Exact scoped hit first; top-scope fallback for port-level names.
  return classes.get(`${scope}|${net}`) ?? classes.get(`|${net}`) ?? null;
}
