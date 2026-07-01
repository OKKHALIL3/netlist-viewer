// Net classification: is a net a power rail, a ground rail, or a signal?
//
// Three evidence sources, strongest first:
//   1. NAME — VDD/VCC/VSS/GND families (with analog/digital/io prefixes and
//      voltage suffixes), SPICE node "0", global-net "!" forms. Ported from
//      cdl_adapter.py and kept in sync with it.
//   2. TOPOLOGY — inside a cell, the net tied to the BULK of PMOS devices is a
//      supply and the bulk of NMOS devices a ground (that is how rails are
//      physically wired; catches rails the naming misses, e.g. AVRL/AVRH in
//      the n16g PDK cells).
//   3. PROPAGATION — a cell port whose inner net classified power/ground makes
//      every parent net wired into that port power/ground too (AVRH feeding
//      XI17.AVD_0V8 / XI107.AVDD). Runs bottom-up to a fixed point.
//
// Only upward propagation is sound: a cell's nets are shared by ALL of its
// instantiations, so pushing a parent's rail kind DOWN into a child cell could
// mislabel other instantiations. Topology gives leaf cells their own evidence.
import type { Design, Cell, Net } from './types';

// Keep in sync with PWR_RE/GND_RE in src/parser/pyodide/cdl_adapter.py.
export const PWR_RE = /^(?:a|d|p|io|dig)?v(?:dd|cc)|^(?:a|d|p|io|dig)?v[dc](?:[0-9_]|$)/i;
export const GND_RE = /^(?:a|d|p|io|dig)?(?:gnd|vss)|^(?:a|d|p|io|dig)?vs(?:[0-9_]|$)|^v?gnd|^ground$|^0$/i;

export function nameNetKind(name: string): Net['kind'] {
  if (PWR_RE.test(name)) return 'power';
  if (GND_RE.test(name)) return 'ground';
  return 'signal';
}

// MOS polarity from the model name. Deliberately tight (pch/pmos/pfet stems
// only): a missed vote is safe — name or propagation evidence can still
// classify the net — while a wrong vote would mislabel a real signal.
const PMOS_MODEL = /^p(ch|mos|fet)/i;
const NMOS_MODEL = /^n(ch|mos|fet)/i;

type Kind = Net['kind'];

// One cell's local evidence: name first, then unanimous bulk votes.
function localKinds(cell: Cell): Map<string, Kind> {
  const kinds = new Map<string, Kind>();
  const votes = new Map<string, { p: number; n: number }>();
  for (const prim of cell.primitives) {
    if (prim.kind !== 'M') continue;
    const bulk = prim.terms.find(([t]) => t === 'b')?.[1];
    if (!bulk) continue;
    const v = votes.get(bulk) ?? { p: 0, n: 0 };
    if (PMOS_MODEL.test(prim.model)) v.p++;
    else if (NMOS_MODEL.test(prim.model)) v.n++;
    votes.set(bulk, v);
  }
  for (const net of cell.nets) {
    const byName = nameNetKind(net.name);
    if (byName !== 'signal') { kinds.set(net.name, byName); continue; }
    const v = votes.get(net.name);
    if (v && v.p > 0 && v.n === 0) kinds.set(net.name, 'power');
    else if (v && v.n > 0 && v.p === 0) kinds.set(net.name, 'ground');
    else kinds.set(net.name, 'signal');
  }
  return kinds;
}

// Mutates net.kind across the whole design.
export function refineNetKinds(design: Design): void {
  const kinds = new Map<string, Map<string, Kind>>();
  for (const [name, cell] of design.cells) kinds.set(name, localKinds(cell));

  // Fixed point: wire child-port kinds up into parent nets. Name evidence is
  // never overridden; only signal→power/ground promotions happen. Conflicting
  // child-port evidence (one pin says power, another ground) leaves signal.
  const maxIter = design.cells.size + 2;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const [cellName, cell] of design.cells) {
      const mine = kinds.get(cellName)!;
      const votes = new Map<string, { p: number; g: number }>();
      for (const inst of cell.instances) {
        const child = kinds.get(inst.master);
        if (!child) continue;
        for (const [pin, netName] of Object.entries(inst.conn)) {
          if (!netName) continue;
          const childKind = child.get(pin);
          if (childKind !== 'power' && childKind !== 'ground') continue;
          const v = votes.get(netName) ?? { p: 0, g: 0 };
          if (childKind === 'power') v.p++; else v.g++;
          votes.set(netName, v);
        }
      }
      for (const [netName, v] of votes) {
        if (mine.get(netName) !== 'signal') continue;
        if (nameNetKind(netName) !== 'signal') continue; // name already spoke
        const next: Kind | null = v.p > 0 && v.g === 0 ? 'power' : v.g > 0 && v.p === 0 ? 'ground' : null;
        if (next) { mine.set(netName, next); changed = true; }
      }
    }
    if (!changed) break;
  }

  for (const [cellName, cell] of design.cells) {
    const mine = kinds.get(cellName)!;
    for (const net of cell.nets) net.kind = mine.get(net.name) ?? net.kind;
  }
}
