// ── Array collapsing: the "view cell" the canvas actually renders ────────────
//
// A CDL bus instance like `Xbit<1023:0>` is scalarized by the parser into 1024
// separate Instance objects (`Xbit<0>` … `Xbit<1023>`), all pointing at the
// same master cell. Rendering one block per member means ELK lays out thousands
// of nodes and React Flow mounts thousands of DOM subtrees — which freezes/
// crashes the canvas. The hierarchy tree already collapses these back into one
// row by `busBase`; this module does the same for the schematic, mirroring how
// busGrouping collapses bus pins/nets into a single "<hi:lo>" row.
//
// `buildCellView` turns a Cell into a CellView with:
//   • instance arrays (≥2 members sharing a busBase) folded into ONE
//     DisplayInstance whose synthesized `conn` shows each master pin wired to
//     the shared net (e.g. VDD) or to the collapsed bus of per-member nets
//     (e.g. "D<1023:0>"),
//   • cell-boundary port buses folded into ONE DisplayPort, and
//   • every net's endpoints remapped onto those display nodes (and deduped),
// so a thousand-wide array becomes a single stacked block wired by a single
// bus ribbon. A CellView is structurally a Cell (display arrays are a superset
// of Instance/Port), so ELK, buildGraph, and computeHighlight consume it
// unchanged — they just see far fewer, larger nodes.

import type { Cell, Instance, Net, Port, Primitive } from '../parser/types';
import { busLabel, parseBusSuffix } from './busGrouping';

// A grouped run needs at least this many members to collapse — a lone bus bit
// (`Xbit<0>` with no siblings) stays a normal block, matching the hierarchy
// panel's `isBus = insts.length > 1`.
const MIN_ARRAY_SIZE = 2;

export interface DisplayInstance extends Instance {
  /** True when this block stands in for ≥2 scalarized array members. */
  isArray: boolean;
  /** Number of members folded in (1 for an ordinary instance). */
  arraySize: number;
  /** The members, sorted by bus index — for the inspector. */
  members: Instance[];
}

export interface DisplayPrimitive extends Primitive {
  /** True when this device stands in for ≥2 scalarized array members. */
  isArray: boolean;
  /** Number of members folded in (1 for an ordinary device). */
  arraySize: number;
  /** The members, sorted by bus index — for the inspector. */
  members: Primitive[];
}

export interface DisplayPort extends Port {
  /** True when this port stands in for ≥2 boundary bus bits. */
  isArray: boolean;
  /** Number of boundary ports folded in (1 for an ordinary port). */
  count: number;
  /** A real member net name — selected when the (bus) port is clicked, so the
   *  inspector still resolves to an actual net. */
  repNet: string;
  /** Member port names, sorted by bus index. */
  members: string[];
}

export interface CellView {
  name: string;
  ports: DisplayPort[];
  instances: DisplayInstance[];
  primitives: DisplayPrimitive[];
  nets: Net[];
  /** display node id (and every member id) → DisplayInstance, for inspector / selection. */
  instancesById: Map<string, DisplayInstance>;
  /** display node id (and every member id) → DisplayPrimitive. */
  primitivesById: Map<string, DisplayPrimitive>;
}

// Picks a single net string to show for a master pin across all array members:
// the shared net when every member ties the pin to the same wire (e.g. VDD),
// the collapsed "<hi:lo>" bus when the per-member nets form one bus, otherwise
// a plain "N nets" summary.
function summarizeNets(nets: string[]): string {
  let allSame = true;
  for (let i = 1; i < nets.length; i++) {
    if (nets[i] !== nets[0]) { allSame = false; break; }
  }
  if (allSame) return nets[0] ?? '';

  let base: string | null = null;
  let brackets: '<>' | '[]' = '<>';
  const indices: number[] = [];
  for (const n of nets) {
    const s = parseBusSuffix(n);
    if (!s) { base = null; break; }
    if (base === null) { base = s.base; brackets = s.brackets; }
    else if (s.base !== base || s.brackets !== brackets) { base = null; break; }
    indices.push(s.index);
  }
  if (base !== null) return busLabel(base, brackets, indices);

  const distinct = new Set(nets).size;
  return `${distinct} nets`;
}

// Folds a cell's scalarized array instances into single DisplayInstance blocks.
// Returns the display instances plus a member-id → display-id remap (only array
// members appear in it; everything else keeps its own id).
function collapseInstances(cell: Cell): {
  instances: DisplayInstance[];
  nodeRemap: Map<string, string>;
} {
  // Group by busBase; non-bus instances are their own singleton group keyed by
  // a prefix that can never collide with a real busBase.
  const groups = new Map<string, Instance[]>();
  const order: string[] = [];
  for (const inst of cell.instances) {
    const key = inst.busBase ? `bus:${inst.busBase}` : `one:${inst.id}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); order.push(key); }
    g.push(inst);
  }

  const instances: DisplayInstance[] = [];
  const nodeRemap = new Map<string, string>();

  for (const key of order) {
    const members = groups.get(key)!;
    // busBase is derived from the instance name alone, so guard that the run
    // really is one array: ≥2 members all pointing at the same master. A lone
    // bus bit, or a base shared by differing masters, passes through as ordinary
    // blocks (avoids merging mismatched pins under one label).
    const sameMaster = members.every(m => m.master === members[0].master);
    if (members.length < MIN_ARRAY_SIZE || !members[0].busBase || !sameMaster) {
      for (const inst of members) {
        instances.push({ ...inst, isArray: false, arraySize: 1, members: [inst] });
      }
      continue;
    }

    // A real array → one stacked block.
    const sorted = [...members].sort((a, b) => (a.busIndex ?? 0) - (b.busIndex ?? 0));
    const base = sorted[0].busBase!;
    const brackets = parseBusSuffix(sorted[0].id)?.brackets ?? '<>';
    const id = busLabel(base, brackets, sorted.map(m => m.busIndex ?? 0));

    // Synthesize the array's pin→net map: master-port order from the first
    // member, each pin showing its shared net or collapsed per-member bus.
    const conn: Record<string, string> = {};
    for (const pin of Object.keys(sorted[0].conn)) {
      conn[pin] = summarizeNets(sorted.map(m => m.conn[pin]).filter(n => n !== undefined));
    }

    for (const m of sorted) nodeRemap.set(m.id, id);
    instances.push({
      id,
      master: sorted[0].master,
      conn,
      portMap: sorted[0].portMap,
      busBase: base,
      isArray: true,
      arraySize: sorted.length,
      members: sorted,
    });
  }

  return { instances, nodeRemap };
}

// Folds cell-boundary port buses (`in<0>` … `in<1023>`) into single DisplayPort
// flags. Returns the display ports plus a member-name → display-name remap.
function collapsePorts(cell: Cell): {
  ports: DisplayPort[];
  portRemap: Map<string, string>;
} {
  const groups = new Map<string, Port[]>();
  const order: string[] = [];
  for (const port of cell.ports) {
    const s = parseBusSuffix(port.name);
    const key = s ? `bus:${s.base} ${s.brackets}` : `one:${port.name}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); order.push(key); }
    g.push(port);
  }

  const ports: DisplayPort[] = [];
  const portRemap = new Map<string, string>();

  for (const key of order) {
    const members = groups.get(key)!;
    if (members.length < MIN_ARRAY_SIZE || !key.startsWith('bus:')) {
      for (const p of members) {
        ports.push({ ...p, isArray: false, count: 1, repNet: p.name, members: [p.name] });
      }
      continue;
    }

    const sorted = [...members].sort(
      (a, b) => (parseBusSuffix(a.name)?.index ?? 0) - (parseBusSuffix(b.name)?.index ?? 0),
    );
    const first = parseBusSuffix(sorted[0].name)!;
    const name = busLabel(first.base, first.brackets, sorted.map(p => parseBusSuffix(p.name)!.index));
    // Direction is shared across a bus in practice; fall back to the first
    // member, or null if members disagree.
    const dir = sorted.every(p => p.dir === sorted[0].dir) ? sorted[0].dir : null;

    for (const p of sorted) portRemap.set(p.name, name);
    ports.push({
      name,
      dir,
      isArray: true,
      count: sorted.length,
      repNet: sorted[0].name,
      members: sorted.map(p => p.name),
    });
  }

  return { ports, portRemap };
}

// Folds scalarized device arrays (M0<0>..M0<4095>, a resistor ladder, a decap
// bank, a bitcell array) into single stacked PrimitiveNodes. Primitives carry
// no busBase in the data model, so the bus base is derived from the id; only
// runs sharing a base AND the same kind+model collapse. Mirrors
// collapseInstances; returns the display devices plus a member-id → display-id
// remap.
function collapsePrimitives(cell: Cell): {
  primitives: DisplayPrimitive[];
  primRemap: Map<string, string>;
} {
  const groups = new Map<string, Primitive[]>();
  const order: string[] = [];
  for (const prim of cell.primitives) {
    const s = parseBusSuffix(prim.id);
    const key = s ? `bus:${s.base} ${s.brackets} ${prim.kind} ${prim.model}` : `one:${prim.id}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); order.push(key); }
    g.push(prim);
  }

  const primitives: DisplayPrimitive[] = [];
  const primRemap = new Map<string, string>();

  for (const key of order) {
    const members = groups.get(key)!;
    if (members.length < MIN_ARRAY_SIZE || !key.startsWith('bus:')) {
      for (const p of members) primitives.push({ ...p, isArray: false, arraySize: 1, members: [p] });
      continue;
    }

    const sorted = [...members].sort(
      (a, b) => (parseBusSuffix(a.id)?.index ?? 0) - (parseBusSuffix(b.id)?.index ?? 0),
    );
    const first = parseBusSuffix(sorted[0].id)!;
    const id = busLabel(first.base, first.brackets, sorted.map(p => parseBusSuffix(p.id)!.index));

    // Synthesize collapsed terminals: terminal order from the first member,
    // each shown as its shared net or collapsed per-member bus. PrimitiveNode
    // keys handles by terminal name, identical across members.
    const terms: Array<[string, string]> = sorted[0].terms.map(([term]) => {
      const nets = sorted
        .map(m => m.terms.find(t => t[0] === term)?.[1])
        .filter((n): n is string => n !== undefined);
      return [term, summarizeNets(nets)];
    });

    for (const m of sorted) primRemap.set(m.id, id);
    primitives.push({
      id,
      kind: sorted[0].kind,
      model: sorted[0].model,
      terms,
      params: sorted[0].params,
      isArray: true,
      arraySize: sorted.length,
      members: sorted,
    });
  }

  return { primitives, primRemap };
}

// A Cell object is stable for the life of a loaded design, so the view is
// memoized per Cell — the canvas and the inspector both call buildCellView and
// share one result instead of each recomputing the collapse + net remap.
const viewCache = new WeakMap<Cell, CellView>();

export function buildCellView(cell: Cell): CellView {
  const cached = viewCache.get(cell);
  if (cached) return cached;

  const { instances, nodeRemap } = collapseInstances(cell);
  const { primitives, primRemap } = collapsePrimitives(cell);
  const { ports, portRemap } = collapsePorts(cell);

  // One member-id → display-id remap covering instances and primitives (their
  // id spaces are disjoint: X* vs M/R/C*).
  const idRemap = new Map<string, string>([...nodeRemap, ...primRemap]);

  // Remap every net's endpoints onto the display nodes, deduping so the
  // thousand identical (arrayId, pin) hits a shared net (VDD) now collapses to
  // one endpoint and a per-member bus collapses to a single shared handle.
  const nets: Net[] = cell.nets.map(net => {
    const seen = new Set<string>();
    const endpoints: Array<[string, string]> = [];
    for (const [id, pin] of net.endpoints) {
      const nid = id === '__port__' ? '__port__' : (idRemap.get(id) ?? id);
      const npin = id === '__port__' ? (portRemap.get(pin) ?? pin) : pin;
      const k = `${nid} ${npin}`;
      if (seen.has(k)) continue;
      seen.add(k);
      endpoints.push([nid, npin]);
    }
    return { name: net.name, kind: net.kind, endpoints };
  });

  // Index by display id AND by every collapsed member id, so a selection/search
  // landing on a member (`Xbit<3>`, `M0<5>`) still resolves to its array block.
  const instancesById = new Map<string, DisplayInstance>();
  for (const di of instances) {
    instancesById.set(di.id, di);
    if (di.isArray) for (const m of di.members) instancesById.set(m.id, di);
  }
  const primitivesById = new Map<string, DisplayPrimitive>();
  for (const dp of primitives) {
    primitivesById.set(dp.id, dp);
    if (dp.isArray) for (const m of dp.members) primitivesById.set(m.id, dp);
  }

  const view: CellView = { name: cell.name, ports, instances, primitives, nets, instancesById, primitivesById };
  viewCache.set(cell, view);
  return view;
}
