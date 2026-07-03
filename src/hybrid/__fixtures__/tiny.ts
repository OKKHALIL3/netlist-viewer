import type { Design, Cell, Net } from '../../parser/types';

type InstSpec = [id: string, master: string, conn: Record<string, string>];
type PrimSpec = [id: string, kind: 'M' | 'R' | 'C', model: string, terms: Array<[string, string]>];

const SUPPLY: Record<string, Net['kind']> = { vdd: 'power', vss: 'ground' };

function cell(name: string, ports: string[], instances: InstSpec[], primitives: PrimSpec[]): Cell {
  const nets = new Map<string, Net>();
  const net = (n: string): Net => {
    let e = nets.get(n);
    if (!e) { e = { name: n, kind: SUPPLY[n] ?? 'signal', endpoints: [] }; nets.set(n, e); }
    return e;
  };
  for (const p of ports) net(p);
  for (const [id, , conn] of instances)
    for (const [pin, n] of Object.entries(conn)) net(n).endpoints.push([id, pin]);
  for (const [id, , , terms] of primitives)
    for (const [term, n] of terms) net(n).endpoints.push([id, term]);
  return {
    name,
    ports: ports.map(p => ({ name: p, dir: null })),
    instances: instances.map(([id, master, conn]) => ({ id, master, conn, portMap: Object.values(conn) })),
    primitives: primitives.map(([id, kind, model, terms]) => ({ id, kind, model, terms, params: {} })),
    nets: [...nets.values()],
  };
}

export function tinyDesign(): Design {
  const cells = new Map<string, Cell>();
  cells.set('TOP', cell('TOP', ['in', 'out', 'vdd', 'vss'], [
    ['XU1', 'AMP', { a: 'in', z: 'mid', vdd: 'vdd', vss: 'vss' }],
    ['XU2', 'DIV', { a: 'mid', z: 'out', vdd: 'vdd', vss: 'vss' }],
  ], []));
  cells.set('AMP', cell('AMP', ['a', 'z', 'vdd', 'vss'], [
    ['XS1', 'STG', { g: 'a', d: 'n1', vdd: 'vdd', vss: 'vss' }],
    ['XS2', 'STG', { g: 'n1', d: 'z', vdd: 'vdd', vss: 'vss' }],
  ], []));
  cells.set('STG', cell('STG', ['g', 'd', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 'd'], ['g', 'g'], ['s', 'vss'], ['b', 'vss']]],
    ['M2', 'M', 'pch', [['d', 'd'], ['g', 'g'], ['s', 'vdd'], ['b', 'vdd']]],
  ]));
  cells.set('DIV', cell('DIV', ['a', 'z', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 'z'], ['g', 'a'], ['s', 'vss'], ['b', 'vss']]],
    ['R1', 'R', 'rp', [['p', 'a'], ['m', 'z']]],
  ]));
  return { cells, topCell: 'TOP', warnings: [] };
}
