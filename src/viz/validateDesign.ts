// Validates and normalizes an incoming subcircuit JSON into the internal,
// Map-based Design the scene builder expects. Accepts the full shape the CDL
// parser emits, and also a leaner hand-authored shape — `conn` and `nets` are
// derived when omitted, so a caller only has to supply the structural minimum:
//
//   { topCell, cells: { <name>: { name, ports, instances, primitives } } }
//
// See docs/subcircuit-visualize.md for the full field reference.

import type { Cell, Design, Instance, Net, Port, Primitive } from '../parser/types';

export class DesignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignValidationError';
  }
}

// Same net classification the Python adapter uses, so derived nets are tagged
// identically to parser-produced ones.
const PWR_RE = /^(vcc|vdd|vddio|vccio|vccpst|vcco|vddo|dvdd|avdd|pvdd|iovdd)/i;
const GND_RE = /^(vss|gnd|vssio|vsso|agnd|dgnd|pgnd|iovss|avss)/i;

function netKind(name: string): Net['kind'] {
  if (PWR_RE.test(name)) return 'power';
  if (GND_RE.test(name)) return 'ground';
  return 'signal';
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(path: string, msg: string): never {
  throw new DesignValidationError(`${path}: ${msg}`);
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, `expected string, got ${typeof v}`);
  return v;
}

function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, `expected array, got ${typeof v}`);
  return v;
}

function normalizePort(raw: unknown, path: string): Port {
  if (!isObject(raw)) fail(path, 'expected an object { name, dir }');
  const dir = raw.dir;
  if (dir != null && dir !== 'I' && dir !== 'O' && dir !== 'B') {
    fail(`${path}.dir`, `expected "I" | "O" | "B" | null, got ${JSON.stringify(dir)}`);
  }
  return { name: asString(raw.name, `${path}.name`), dir: (dir ?? null) as Port['dir'] };
}

function normalizeInstance(raw: unknown, path: string): Instance {
  if (!isObject(raw)) fail(path, 'expected an object');
  const id = asString(raw.id, `${path}.id`);
  const master = asString(raw.master, `${path}.master`);
  const portMap = raw.portMap == null ? [] : asArray(raw.portMap, `${path}.portMap`).map((n, i) => asString(n, `${path}.portMap[${i}]`));
  // `conn` is optional in the wire-up below — keep what was given, fill later.
  const conn: Record<string, string> = {};
  if (raw.conn != null) {
    if (!isObject(raw.conn)) fail(`${path}.conn`, 'expected an object { pin: net }');
    for (const [pin, net] of Object.entries(raw.conn)) conn[pin] = asString(net, `${path}.conn.${pin}`);
  }
  return {
    id,
    master,
    conn,
    portMap,
    busBase: raw.busBase == null ? undefined : asString(raw.busBase, `${path}.busBase`),
    busIndex: raw.busIndex == null ? undefined : Number(raw.busIndex),
  };
}

function normalizePrimitive(raw: unknown, path: string): Primitive {
  if (!isObject(raw)) fail(path, 'expected an object');
  const kind = raw.kind;
  if (kind !== 'M' && kind !== 'R' && kind !== 'C') fail(`${path}.kind`, `expected "M" | "R" | "C", got ${JSON.stringify(kind)}`);
  const terms = asArray(raw.terms, `${path}.terms`).map((t, i) => {
    const pair = asArray(t, `${path}.terms[${i}]`);
    if (pair.length !== 2) fail(`${path}.terms[${i}]`, 'expected a [terminal, net] pair');
    return [asString(pair[0], `${path}.terms[${i}][0]`), asString(pair[1], `${path}.terms[${i}][1]`)] as [string, string];
  });
  const params: Record<string, string> = {};
  if (raw.params != null) {
    if (!isObject(raw.params)) fail(`${path}.params`, 'expected an object');
    for (const [k, v] of Object.entries(raw.params)) params[k] = String(v);
  }
  return { id: asString(raw.id, `${path}.id`), kind, model: asString(raw.model ?? '', `${path}.model`), terms, params };
}

function normalizeNet(raw: unknown, path: string): Net {
  if (!isObject(raw)) fail(path, 'expected an object');
  const name = asString(raw.name, `${path}.name`);
  const kind = raw.kind == null ? netKind(name) : raw.kind;
  if (kind !== 'signal' && kind !== 'power' && kind !== 'ground') fail(`${path}.kind`, `expected "signal" | "power" | "ground"`);
  const endpoints = asArray(raw.endpoints, `${path}.endpoints`).map((e, i) => {
    const pair = asArray(e, `${path}.endpoints[${i}]`);
    if (pair.length !== 2) fail(`${path}.endpoints[${i}]`, 'expected a [nodeId, pin] pair');
    return [asString(pair[0], `${path}.endpoints[${i}][0]`), asString(pair[1], `${path}.endpoints[${i}][1]`)] as [string, string];
  });
  return { name, kind, endpoints };
}

// Resolve each instance's pin→net map from its ordered portMap when `conn`
// wasn't supplied — using the master cell's port names if the master is in the
// design, else positional p0/p1/… (mirrors the Python adapter's second pass).
function fillConnections(cells: Map<string, Cell>): void {
  for (const cell of cells.values()) {
    for (const inst of cell.instances) {
      if (Object.keys(inst.conn).length > 0) continue;
      const master = cells.get(inst.master);
      if (master) {
        master.ports.forEach((port, i) => { inst.conn[port.name] = inst.portMap[i] ?? ''; });
      } else {
        inst.portMap.forEach((net, i) => { inst.conn[`p${i}`] = net; });
      }
    }
  }
}

// Build each cell's net list from its ports, instance connections, and
// primitive terminals when `nets` wasn't supplied (mirrors the adapter).
function fillNets(cell: Cell): Net[] {
  const netMap = new Map<string, Net>();
  const add = (netName: string, nodeId: string, pin: string) => {
    if (!netName) return;
    let net = netMap.get(netName);
    if (!net) { net = { name: netName, kind: netKind(netName), endpoints: [] }; netMap.set(netName, net); }
    net.endpoints.push([nodeId, pin]);
  };
  for (const p of cell.ports) add(p.name, '__port__', p.name);
  for (const inst of cell.instances) for (const [pin, net] of Object.entries(inst.conn)) add(net, inst.id, pin);
  for (const prim of cell.primitives) for (const [pin, net] of prim.terms) add(net, prim.id, pin);
  return [...netMap.values()];
}

export function validateAndNormalizeDesign(raw: unknown): Design {
  if (!isObject(raw)) throw new DesignValidationError('root: expected a JSON object { topCell, cells }');
  if (!isObject(raw.cells)) fail('cells', 'expected an object keyed by cell name');

  const cellEntries = Object.entries(raw.cells);
  if (cellEntries.length === 0) fail('cells', 'a design must contain at least one cell');

  const cells = new Map<string, Cell>();
  for (const [name, rawCell] of cellEntries) {
    if (!isObject(rawCell)) fail(`cells.${name}`, 'expected a cell object');
    const ports = asArray(rawCell.ports ?? [], `cells.${name}.ports`).map((p, i) => normalizePort(p, `cells.${name}.ports[${i}]`));
    const instances = asArray(rawCell.instances ?? [], `cells.${name}.instances`).map((inst, i) => normalizeInstance(inst, `cells.${name}.instances[${i}]`));
    const primitives = asArray(rawCell.primitives ?? [], `cells.${name}.primitives`).map((pr, i) => normalizePrimitive(pr, `cells.${name}.primitives[${i}]`));
    // nets may be supplied or derived — defer derivation until conn is filled.
    const suppliedNets = rawCell.nets == null
      ? null
      : asArray(rawCell.nets, `cells.${name}.nets`).map((n, i) => normalizeNet(n, `cells.${name}.nets[${i}]`));
    cells.set(name, { name: asString(rawCell.name ?? name, `cells.${name}.name`), ports, instances, primitives, nets: suppliedNets ?? [] });
    // stash whether nets were supplied via a sentinel on the closure below
    if (suppliedNets) (cells.get(name) as Cell & { __hasNets?: boolean }).__hasNets = true;
  }

  fillConnections(cells);

  for (const cell of cells.values()) {
    const tagged = cell as Cell & { __hasNets?: boolean };
    if (!tagged.__hasNets) cell.nets = fillNets(cell);
    delete tagged.__hasNets;
  }

  let topCell = typeof raw.topCell === 'string' ? raw.topCell : '';
  if (!topCell || !cells.has(topCell)) {
    // Fall back to the last cell nobody instantiates (a sensible "root").
    const referenced = new Set<string>();
    for (const cell of cells.values()) for (const inst of cell.instances) referenced.add(inst.master);
    const names = [...cells.keys()];
    topCell = [...names].reverse().find(n => !referenced.has(n)) ?? names[names.length - 1];
  }

  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === 'string') : [];
  return { cells, topCell, warnings };
}
