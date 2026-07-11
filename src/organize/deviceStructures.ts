// Device-level structure detection for the Organize view.
//
// Leaf cells (all transistors, no sub-blocks) previously collapsed into a
// single "Analog Core" bucket, so Organize had nothing to box. This module
// recognizes the idioms an analog designer actually draws — differential
// pairs first, then cross-coupled pairs, current mirrors, complementary
// (CMOS) pairs, and series stacks — and turns each occurrence into its own
// labeled group. Detection is purely topological (terminal nets + net kinds
// + device polarity/size), deterministic, and greedy in priority order: a
// device belongs to at most one structure.

import type { Cell, Primitive } from '../parser/types';
import type { GroupKind } from './groups';

export interface DeviceStructure {
  /** Unique group id, e.g. "pair:0", "mirror:1". */
  id: string;
  /** Display color bucket (reuses the existing organize palette). */
  kind: GroupKind;
  label: string;
  memberIds: string[];
}

interface Mos {
  id: string;
  pol: 'n' | 'p';
  model: string;
  sizeKey: string;
  d: string; g: string; s: string;
}

// MOSFET polarity from the model name (nch_svt_mac / pch_18_mac / nfet / …).
function polarityOf(model: string): 'n' | 'p' | null {
  const m = model.toLowerCase();
  if (/^n/.test(m)) return 'n';
  if (/^p/.test(m)) return 'p';
  return null;
}

// Matched-device size identity: same channel length and width/fin count.
// Multiplier (m) is allowed to differ — ratioed mirrors stay one structure.
function sizeKeyOf(p: Primitive): string {
  const par = p.params ?? {};
  return `${par.l ?? ''}|${par.nfin ?? par.w ?? ''}`;
}

export function detectDeviceStructures(cell: Cell, displayPrims: Primitive[]): DeviceStructure[] {
  const netKind = new Map(cell.nets.map(n => [n.name, n.kind]));
  const isRail = (net: string) => (netKind.get(net) ?? 'signal') !== 'signal';

  const mosById = new Map<string, Mos>();
  for (const p of displayPrims) {
    if (p.kind !== 'M' || !p.model) continue;
    const pol = polarityOf(p.model);
    if (!pol) continue;
    const t = new Map(p.terms ?? []);
    const d = t.get('d'), g = t.get('g'), s = t.get('s');
    if (!d || !g || !s) continue;
    mosById.set(p.id, { id: p.id, pol, model: p.model, sizeKey: sizeKeyOf(p), d, g, s });
  }
  // Stable iteration order for deterministic group numbering.
  const mos = [...mosById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const claimed = new Set<string>();
  const free = () => mos.filter(m => !claimed.has(m.id));
  const structures: DeviceStructure[] = [];
  const counters = new Map<string, number>();
  const push = (tag: string, kind: GroupKind, label: string, members: Mos[]) => {
    const n = counters.get(tag) ?? 0;
    counters.set(tag, n + 1);
    structures.push({ id: `${tag}:${n}`, kind, label, memberIds: members.map(m => m.id) });
    for (const m of members) claimed.add(m.id);
  };

  // 0 · Dummy tie-offs — every terminal on a rail (fill/matching devices).
  // One aggregate group; individually boxing dummies is exactly the clutter
  // this view exists to remove. Claimed first so a degenerate all-rail pair
  // can't satisfy the differential/cross-coupled rules below.
  const dummies = free().filter(m => isRail(m.d) && isRail(m.g) && isRail(m.s));
  if (dummies.length) push('dummy', 'passive', `Dummies / ties ×${dummies.length}`, dummies);

  // 1 · Differential pairs — exactly two matched same-polarity devices whose
  // sources join on a non-rail tail node, gates on two different signal nets.
  // Labeled by the differential signals so the pair reads at a glance.
  const byTail = new Map<string, Mos[]>();
  for (const m of free()) {
    if (isRail(m.s)) continue;
    const key = `${m.s}|${m.pol}|${m.model}|${m.sizeKey}`;
    const arr = byTail.get(key);
    if (arr) arr.push(m); else byTail.set(key, [m]);
  }
  for (const cands of byTail.values()) {
    if (cands.length !== 2) continue;
    const [a, b] = cands;
    if (a.g === b.g || a.d === b.d) continue;         // common-gate/common-drain ≠ diff pair
    if (isRail(a.g) || isRail(b.g)) continue;
    if (a.g === b.d && b.g === a.d) continue;          // cross-coupled — pass 2's job
    push('pair', 'core', `Differential pair — ${a.g} / ${b.g}`, [a, b]);
  }

  // 2 · Cross-coupled pairs — gates crossed to each other's drains (two
  // distinct signal nodes), sources on the same net (latch / sense-amp core).
  for (const a of free()) {
    if (claimed.has(a.id) || isRail(a.g) || isRail(a.d)) continue;
    const b = free().find(x => x.id !== a.id && x.pol === a.pol
      && x.s === a.s && x.d !== a.d && a.g === x.d && x.g === a.d);
    if (!b) continue;
    push('xc', 'core', `Cross-coupled pair — ${a.d} / ${b.d}`, [a, b]);
  }

  // 3 · Current mirrors — same-polarity devices sharing a gate net, sources on
  // the same rail, anchored by a diode-connected device (g = d).
  const byMirror = new Map<string, Mos[]>();
  for (const m of free()) {
    if (!isRail(m.s) || isRail(m.g)) continue;
    const key = `${m.g}|${m.s}|${m.pol}`;
    const arr = byMirror.get(key);
    if (arr) arr.push(m); else byMirror.set(key, [m]);
  }
  for (const cands of byMirror.values()) {
    if (cands.length < 2 || !cands.some(m => m.g === m.d)) continue;
    push('mirror', 'bias', `Current mirror — ${cands[0].g}`, cands);
  }

  // 4 · Complementary (CMOS) pairs — one n + one p sharing gate AND drain: an
  // inverter, or the output driver when the drain is the cell's output.
  for (const a of free()) {
    if (claimed.has(a.id) || a.pol !== 'n') continue;
    const b = free().find(x => x.pol === 'p' && x.g === a.g && x.d === a.d);
    if (!b) continue;
    push('cmos', 'digital', `Inverter — ${a.g} → ${a.d}`, [a, b]);
  }

  // 5 · Series stacks — same-polarity devices chained source→drain through
  // internal two-terminal nets (cascodes, keeper stacks). Internal = the net
  // appears on exactly two source/drain terminals in the whole cell.
  const sdCount = new Map<string, number>();
  for (const p of displayPrims) {
    if (p.kind !== 'M') continue;
    for (const [term, net] of p.terms ?? []) {
      if (term !== 'd' && term !== 's') continue;
      sdCount.set(net, (sdCount.get(net) ?? 0) + 1);
    }
  }
  const isInternal = (net: string) => !isRail(net) && sdCount.get(net) === 2
    && !cell.ports.some(pt => pt.name === net);
  const stackNext = (m: Mos, pool: Mos[]) =>
    pool.find(x => x.id !== m.id && x.pol === m.pol && x.d === m.s && isInternal(m.s));
  for (const top of free()) {
    if (claimed.has(top.id)) continue;
    // walk down: top.s → next.d → …
    const chain = [top];
    let cur = top;
    for (;;) {
      const nxt = stackNext(cur, free().filter(x => !chain.includes(x)));
      if (!nxt) break;
      chain.push(nxt);
      cur = nxt;
    }
    if (chain.length < 2) continue;
    // only claim a chain whose head isn't itself someone's continuation
    const above = free().find(x => !chain.includes(x) && x.pol === top.pol && x.s === top.d && isInternal(top.d));
    if (above) continue;
    push('stack', 'core', `Stack — ${chain.length} devices, ${chain[0].d} → ${chain[chain.length - 1].s}`, chain);
  }

  return structures;
}
