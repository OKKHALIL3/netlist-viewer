import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameNetKind, refineNetKinds } from './netKinds';
import type { Design, Cell, Net } from './types';

function mkCell(name: string, p: Partial<Cell>): Cell {
  return { name, ports: [], instances: [], primitives: [], nets: [], ...p };
}
function net(name: string, endpoints: Net['endpoints'] = []): Net {
  return { name, kind: nameNetKind(name), endpoints };
}
function design(cells: Cell[], top: string): Design {
  return { cells: new Map(cells.map(c => [c.name, c])), topCell: top, warnings: [] };
}
const kindOf = (cell: Cell, name: string) => cell.nets.find(n => n.name === name)!.kind;

test('name heuristics: existing families still classify', () => {
  assert.equal(nameNetKind('VDD'), 'power');
  assert.equal(nameNetKind('AVDD'), 'power');
  assert.equal(nameNetKind('AVD_0V8'), 'power');
  assert.equal(nameNetKind('vcc_io'), 'power');
  assert.equal(nameNetKind('VSS'), 'ground');
  assert.equal(nameNetKind('AVS'), 'ground');
  assert.equal(nameNetKind('DGND'), 'ground');
  assert.equal(nameNetKind('VDATA'), 'signal'); // v+d but no digit/_ after
  assert.equal(nameNetKind('VCO_IN'), 'signal'); // v+c but no digit/_ after
});

test('name heuristics: new cases', () => {
  assert.equal(nameNetKind('0'), 'ground'); // SPICE ground node
  assert.equal(nameNetKind('GND!'), 'ground'); // global-net bang
  assert.equal(nameNetKind('VDD!'), 'power');
  assert.equal(nameNetKind('VGND'), 'ground'); // v-prefixed ground
  assert.equal(nameNetKind('GROUND'), 'ground');
  assert.equal(nameNetKind('AVRH'), 'signal'); // NOT name-detectable; topology's job
});

test('topology: pch bulk net becomes power, nch bulk becomes ground', () => {
  // Mirrors n16g_ck_clk_ckinvx2: AVRL is S/B of pch, VSS of nch.
  const inv = mkCell('inv', {
    ports: [{ name: 'A', dir: 'I' }, { name: 'AVRL', dir: 'B' }, { name: 'VSS', dir: 'B' }, { name: 'Z', dir: 'O' }],
    primitives: [
      { id: 'MTP', kind: 'M', model: 'pch_ulvt_mac', terms: [['d', 'Z'], ['g', 'A'], ['s', 'AVRL'], ['b', 'AVRL']], params: {} },
      { id: 'MTN', kind: 'M', model: 'nch_ulvt_mac', terms: [['d', 'Z'], ['g', 'A'], ['s', 'VSS'], ['b', 'VSS']], params: {} },
    ],
    nets: [
      net('A', [['__port__', 'A'], ['MTP', 'g'], ['MTN', 'g']]),
      net('AVRL', [['__port__', 'AVRL'], ['MTP', 's'], ['MTP', 'b']]),
      net('VSS', [['__port__', 'VSS'], ['MTN', 's'], ['MTN', 'b']]),
      net('Z', [['__port__', 'Z'], ['MTP', 'd'], ['MTN', 'd']]),
    ],
  });
  const d = design([inv], 'inv');
  refineNetKinds(d);
  assert.equal(kindOf(inv, 'AVRL'), 'power');
  assert.equal(kindOf(inv, 'VSS'), 'ground');
  assert.equal(kindOf(inv, 'Z'), 'signal');
  assert.equal(kindOf(inv, 'A'), 'signal');
});

test('propagation: parent net wired into a supply-classified child port becomes power', () => {
  // Mirrors n16g: XI17.AVD_0V8 pin (name-power port) is fed by net AVRH.
  const buf = mkCell('buf', {
    ports: [{ name: 'AVD_0V8', dir: 'I' }, { name: 'IN', dir: 'I' }],
    nets: [net('AVD_0V8', [['__port__', 'AVD_0V8']]), net('IN', [['__port__', 'IN']])],
  });
  const top = mkCell('top', {
    instances: [{ id: 'XI17', master: 'buf', conn: { AVD_0V8: 'AVRH', IN: 'C2IP' }, portMap: ['AVRH', 'C2IP'] }],
    nets: [net('AVRH', [['XI17', 'AVD_0V8']]), net('C2IP', [['XI17', 'IN']])],
  });
  const d = design([buf, top], 'top');
  refineNetKinds(d);
  assert.equal(kindOf(top, 'AVRH'), 'power');
  assert.equal(kindOf(top, 'C2IP'), 'signal');
});

test('propagation is transitive across levels (topology → port → parent net)', () => {
  // inv.AVRL power by topology → mid net RAIL power → top net AVRH power.
  const inv = mkCell('inv', {
    ports: [{ name: 'AVRL', dir: 'B' }],
    primitives: [{ id: 'MP', kind: 'M', model: 'pch', terms: [['d', 'x'], ['g', 'x'], ['s', 'AVRL'], ['b', 'AVRL']], params: {} }],
    nets: [net('AVRL', [['__port__', 'AVRL'], ['MP', 'b']]), net('x', [['MP', 'd'], ['MP', 'g']])],
  });
  const mid = mkCell('mid', {
    ports: [{ name: 'RAIL', dir: 'B' }],
    instances: [{ id: 'X1', master: 'inv', conn: { AVRL: 'RAIL' }, portMap: ['RAIL'] }],
    nets: [net('RAIL', [['__port__', 'RAIL'], ['X1', 'AVRL']])],
  });
  const top = mkCell('top', {
    instances: [{ id: 'X2', master: 'mid', conn: { RAIL: 'AVRH' }, portMap: ['AVRH'] }],
    nets: [net('AVRH', [['X2', 'RAIL']])],
  });
  const d = design([inv, mid, top], 'top');
  refineNetKinds(d);
  assert.equal(kindOf(top, 'AVRH'), 'power');
});

test('conflicting bulk votes leave the net a signal', () => {
  const c = mkCell('c', {
    primitives: [
      { id: 'MP', kind: 'M', model: 'pch', terms: [['d', 'a'], ['g', 'a'], ['s', 'a'], ['b', 'MIX']], params: {} },
      { id: 'MN', kind: 'M', model: 'nch', terms: [['d', 'a'], ['g', 'a'], ['s', 'a'], ['b', 'MIX']], params: {} },
    ],
    nets: [net('MIX', [['MP', 'b'], ['MN', 'b']]), net('a', [['MP', 'd'], ['MN', 'd']])],
  });
  const d = design([c], 'c');
  refineNetKinds(d);
  assert.equal(kindOf(c, 'MIX'), 'signal');
});

test('name heuristic outranks topology', () => {
  // A net NAMED like ground never flips to power, whatever the topology says.
  const c = mkCell('c', {
    primitives: [{ id: 'MP', kind: 'M', model: 'pch', terms: [['d', 'a'], ['g', 'a'], ['s', 'a'], ['b', 'VSS']], params: {} }],
    nets: [net('VSS', [['MP', 'b']]), net('a', [['MP', 'd'], ['MP', 'g'], ['MP', 's']])],
  });
  const d = design([c], 'c');
  refineNetKinds(d);
  assert.equal(kindOf(c, 'VSS'), 'ground');
});

test('conflicting child-port votes leave the parent net a signal', () => {
  const src = mkCell('src', {
    ports: [{ name: 'VDD', dir: 'B' }],
    nets: [net('VDD', [['__port__', 'VDD']])],
  });
  const snk = mkCell('snk', {
    ports: [{ name: 'GND', dir: 'B' }],
    nets: [net('GND', [['__port__', 'GND']])],
  });
  const top = mkCell('top', {
    instances: [
      { id: 'X1', master: 'src', conn: { VDD: 'MID' }, portMap: ['MID'] },
      { id: 'X2', master: 'snk', conn: { GND: 'MID' }, portMap: ['MID'] },
    ],
    nets: [net('MID', [['X1', 'VDD'], ['X2', 'GND']])],
  });
  const d = design([src, snk, top], 'top');
  refineNetKinds(d);
  assert.equal(kindOf(top, 'MID'), 'signal');
});
