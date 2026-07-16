import type { LayoutData } from '../../layout-viewer/model';
import type { NetPairCoupling } from '../../hybrid/layoutStats';
import { classForDspfName, type NetClass } from './netClass';

// Predicate search over DSPF nets: (heuristic) class × coupling threshold ×
// total-cap threshold × name pattern. This is the find intent's engine — the
// raw all-pairs coupling index already exists (attachLayoutStats); this joins
// it with the class map and per-net facts and applies the filters.

export interface NetFinding {
  net: string;
  idx: number;
  class: NetClass | 'unknown';
  couplingTotal: number;
  worstPartner: { net: string; cap: number } | null;
  totalCap: number | null;
}

export interface FindNetsOptions {
  data: LayoutData;
  pairs: NetPairCoupling[];
  supplyIdx: Set<number>;
  classes: Map<string, NetClass> | null; // null = no CDL model (class filter unavailable)
  klass?: NetClass | 'any';
  minCouplingF?: number;
  minTotalCapF?: number;
  namePattern?: string;
  limit?: number;
}

export function findNets(opts: FindNetsOptions): { rows: NetFinding[]; total: number } {
  const { data, pairs, supplyIdx } = opts;
  const limit = opts.limit ?? 25;

  const couplingOf = new Map<number, number>();
  const worstOf = new Map<number, { idx: number; cap: number }>();
  for (const p of pairs) {
    for (const [self, other] of [[p.aIdx, p.bIdx], [p.bIdx, p.aIdx]] as const) {
      if (supplyIdx.has(self)) continue;
      couplingOf.set(self, (couplingOf.get(self) ?? 0) + p.cap);
      const worst = worstOf.get(self);
      if (!worst || p.cap > worst.cap) worstOf.set(self, { idx: other, cap: p.cap });
    }
  }

  const seps = [data.divider, data.delimiter].filter(Boolean) as string[];
  const nameRe = opts.namePattern ? safeRegex(opts.namePattern) : null;

  const rows: NetFinding[] = [];
  let total = 0;
  for (let idx = 0; idx < data.nets.length; idx++) {
    const net = data.nets[idx];
    if (net.isGround || supplyIdx.has(idx)) continue;
    const couplingTotal = couplingOf.get(idx) ?? 0;
    if (opts.minCouplingF !== undefined && couplingTotal < opts.minCouplingF) continue;
    if (opts.minTotalCapF !== undefined && (net.totalCap ?? 0) < opts.minTotalCapF) continue;
    if (nameRe && !nameRe.test(net.name)) continue;
    const klass: NetFinding['class'] = opts.classes
      ? classForDspfName(opts.classes, net.name, seps) ?? 'unknown'
      : 'unknown';
    if (opts.klass && opts.klass !== 'any' && klass !== opts.klass) continue;
    total++;
    const worst = worstOf.get(idx);
    rows.push({
      net: net.name,
      idx,
      class: klass,
      couplingTotal,
      worstPartner: worst ? { net: data.nets[worst.idx]?.name ?? `net#${worst.idx}`, cap: worst.cap } : null,
      totalCap: net.totalCap,
    });
  }

  rows.sort((a, b) => b.couplingTotal - a.couplingTotal || (b.totalCap ?? 0) - (a.totalCap ?? 0));
  return { rows: rows.slice(0, limit), total };
}

// User-supplied pattern: try as regex, fall back to a literal substring match
// so a stray "(" can't throw out of a chat turn.
function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}
