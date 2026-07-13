// Point-to-point parasitics along a traced path. Every net the path rides is
// an RC network in the DSPF; for each one, anchor the entry/exit at the
// device pins of the adjacent blocks and run the nodal solve (rcSolver) for
// effective resistance and Elmore delay. Blocks themselves are active devices
// — their delay needs transistor models a DSPF doesn't carry — so the report
// is interconnect-only, stated as such in the UI.

import type { LayoutData, DspfNet } from '../layout-viewer/model';
import type { Conductors } from './connectivity';
import type { PathResult, PinRef } from './path';
import { normSeg, normSegments } from '../layout-viewer/correlate';
import { newRcNet, addResistor, addCap, solveBetween } from './rcSolver';

export type SegmentStatus = 'ok' | 'no-dspf' | 'no-r' | 'unanchored' | 'open' | 'too-large';

export interface SegmentParasitics {
  net: string;                // hierarchy-scoped display name (PathResult.netNames)
  dspfNet: string | null;     // the matched extraction net, or null
  status: SegmentStatus;
  r: number | null;           // Ω through the net, entry pins → exit pins
  c: number | null;           // F of total load: wire + coupling (both sections) + pin caps
  elmore: number | null;      // s — first-moment delay of this segment
  resistors: number;
  nodes: number;              // solved component size (0 when not solved)
}

export interface PathParasitics {
  segments: SegmentParasitics[];
  totalR: number;             // Σ over solved segments
  totalC: number;             // Σ over matched segments
  totalElmore: number;
  matched: number;            // segments with a DSPF net
  solved: number;             // segments whose r/elmore made it into the totals
}

// ── per-DSPF index, built once and cached on the LayoutData ────────────────
// byKey: normalized full net name → net index (same normalization as the
// netLayers map, so whatever matched a layer tag matches here). foreign: a
// coupling cap sits in ONE net's section but loads BOTH nets — each net's
// foreign list carries the other sections' caps that terminate on it, found
// by node ownership exactly the way layoutStats claims nodes.
interface DspfIndex { byKey: Map<string, number>; foreign: Array<Array<[string, number]>> }
const indexCache = new WeakMap<LayoutData, DspfIndex>();

function dspfIndex(data: LayoutData): DspfIndex {
  const hit = indexCache.get(data);
  if (hit) return hit;
  const seps = [data.divider, data.delimiter];
  const byKey = new Map<string, number>();
  const owner = new Map<string, number>();
  const claim = (name: string, i: number) => { if (!owner.has(name)) owner.set(name, i); };
  data.nets.forEach((n, i) => {
    const key = normSegments(n.name, seps).join('/');
    if (!byKey.has(key)) byKey.set(key, i);
    claim(n.name, i);
    for (const s of n.subnodes) claim(s.name, i);
    for (const p of n.ports) claim(p.name, i);
    for (const ip of n.instPins) claim(ip.name, i);
    for (const r of n.resistors) { claim(r.a, i); claim(r.b, i); }
    for (const c of n.capacitors) if (!c.coupling) { claim(c.a, i); claim(c.b, i); }
  });
  const foreign: Array<Array<[string, number]>> = data.nets.map(() => []);
  data.nets.forEach((n, aIdx) => {
    for (const c of n.capacitors) {
      if (!c.coupling || c.value === null) continue;
      const na = owner.get(c.a), nb = owner.get(c.b);
      if (nb !== undefined && nb !== aIdx) foreign[nb].push([c.b, c.value]);
      else if (na !== undefined && na !== aIdx) foreign[na].push([c.a, c.value]);
    }
  });
  const idx = { byKey, foreign };
  indexCache.set(data, idx);
  return idx;
}

const isPrefix = (pre: string[], full: string[]) =>
  pre.length <= full.length && pre.every((s, i) => s === full[i]);

// Device pins of `block` (real model path) on this net: *|I entries whose
// instance path lies at-or-under the block. Extractors occasionally emit a
// doubled leading X on hierarchical paths (DSPF XXI107 for CDL XI107) — when
// the direct match misses, retry with it collapsed, like correlate() does.
function blockPins(net: DspfNet, divider: string, block: string): string[] {
  const want = block.split('/');
  const out: string[] = [];
  for (const ip of net.instPins) {
    const segs = normSegments(ip.inst, [divider]);
    const hit = isPrefix(want, segs)
      || (segs[0]?.startsWith('xx') && isPrefix(want, [segs[0].slice(1), ...segs.slice(1)]));
    if (hit) out.push(ip.name);
  }
  return out;
}

// A top-cell endpoint contacts the net at its boundary: the matching *|P
// port, any port failing that, and the bare net-name node as the extractor
// convention of last resort.
function portAnchors(net: DspfNet, pin: string): string[] {
  const match = net.ports.filter(p => normSeg(p.name) === normSeg(pin)).map(p => p.name);
  if (match.length) return match;
  if (net.ports.length) return net.ports.map(p => p.name);
  return [net.name];
}

export function pathParasitics(
  data: LayoutData, cond: Conductors, result: PathResult, ends: [PinRef, PinRef],
): PathParasitics {
  const idx = dspfIndex(data);
  const segments = result.hops.map((hop, i): SegmentParasitics => {
    const display = result.netNames[i] ?? '?';
    const none: SegmentParasitics = {
      net: display, dspfNet: null, status: 'no-dspf', r: null, c: null, elmore: null, resistors: 0, nodes: 0,
    };
    // A conductor is one electrical node named at several scopes — any one of
    // its names may be the one the extractor kept.
    let netIdx: number | undefined;
    for (const m of cond.members.get(hop.conductor) ?? []) {
      const key = (m.scope ? `${m.scope}/${m.net}` : m.net).split('/').map(normSeg).join('/');
      netIdx = idx.byKey.get(key);
      if (netIdx !== undefined) break;
    }
    if (netIdx === undefined) return none;
    const net = data.nets[netIdx];

    // Node ownership inside the section (verbatim names — no cross-section
    // normalization needed within one file).
    const nodeSet = new Set<string>([net.name]);
    for (const s of net.subnodes) nodeSet.add(s.name);
    for (const p of net.ports) nodeSet.add(p.name);
    for (const ip of net.instPins) nodeSet.add(ip.name);
    for (const r of net.resistors) { nodeSet.add(r.a); nodeSet.add(r.b); }

    const g = newRcNet();
    for (const r of net.resistors) addResistor(g, r.a, r.b, r.value);

    let c = 0, cKnown = false;
    for (const cap of net.capacitors) {
      if (cap.value === null) continue;
      const aIn = nodeSet.has(cap.a), bIn = nodeSet.has(cap.b);
      if (aIn && bIn) continue; // both ends on this net: internal, not a load
      cKnown = true; c += cap.value;
      const local = aIn ? cap.a : bIn ? cap.b : null;
      if (local) addCap(g, local, cap.value);
    }
    for (const [node, value] of idx.foreign[netIdx]) {
      cKnown = true; c += value;
      addCap(g, node, value);
    }
    for (const ip of net.instPins) {
      if (ip.cap !== null && ip.cap > 0) { cKnown = true; c += ip.cap; addCap(g, ip.name, ip.cap); }
    }
    for (const p of net.ports) {
      if (p.cap !== null && p.cap > 0) { cKnown = true; c += p.cap; addCap(g, p.name, p.cap); }
    }
    if (!cKnown && net.totalCap !== null) { c = net.totalCap; cKnown = true; }
    const cOut = cKnown ? c : null;

    // C-only extraction: no resistance data means the wire reads ideal —
    // report 0 Ω honestly rather than refusing.
    if (net.resistors.length === 0) {
      return { net: display, dspfNet: net.name, status: 'no-r', r: 0, c: cOut, elmore: 0, resistors: 0, nodes: 0 };
    }

    const entry = hop.from === null ? portAnchors(net, ends[0].pin) : blockPins(net, data.divider, hop.from);
    const exit = hop.to === null ? portAnchors(net, ends[1].pin) : blockPins(net, data.divider, hop.to);
    const s = solveBetween(g, entry, exit);
    const base = { net: display, dspfNet: net.name, c: cOut, resistors: net.resistors.length };
    if (s.kind === 'ok') return { ...base, status: 'ok', r: s.r, elmore: s.elmore, nodes: s.nodes };
    const status: SegmentStatus = s.kind === 'open' ? 'open' : s.kind === 'tooLarge' ? 'too-large' : 'unanchored';
    return { ...base, status, r: null, elmore: null, nodes: 0 };
  });

  let totalR = 0, totalC = 0, totalElmore = 0, matched = 0, solved = 0;
  for (const s of segments) {
    if (s.dspfNet !== null) matched++;
    if (s.c !== null) totalC += s.c;
    if (s.r !== null && s.elmore !== null) { solved++; totalR += s.r; totalElmore += s.elmore; }
  }
  return { segments, totalR, totalC, totalElmore, matched, solved };
}
