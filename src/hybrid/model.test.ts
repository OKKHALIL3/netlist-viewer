import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Design, Cell } from '../parser/types';
import { tinyDesign, cell } from './__fixtures__/tiny';
import { arrayedDesign } from './__fixtures__/arrayed';
import { buildHybridModel, displayPath, setGroupExpanded } from './model';

test('builds instance-path tree with normalized paths', () => {
  const m = buildHybridModel(tinyDesign());
  assert.deepEqual(
    [...m.blocks.keys()].sort(),
    ['', 'xu1', 'xu1/xs1', 'xu1/xs2', 'xu2'].sort(),
  );
  assert.equal(m.blocks.get('')!.master, 'TOP');
  assert.equal(m.blocks.get('xu1')!.label, 'XU1');
  assert.equal(m.blocks.get('xu1/xs1')!.depth, 2);
  assert.equal(m.blocks.get('xu1/xs1')!.parent, 'xu1');
  assert.deepEqual(m.blocks.get('')!.children, ['xu1', 'xu2']);
  assert.equal(m.maxDepth, 2);
});

test('recursive device rollups are memoized per cell and correct', () => {
  const m = buildHybridModel(tinyDesign());
  assert.equal(m.blocks.get('')!.devices, 6);
  assert.equal(m.blocks.get('xu1')!.devices, 4);
  assert.equal(m.blocks.get('xu2')!.devices, 2);
  assert.equal(m.blocks.get('xu1/xs2')!.devices, 2);
});

test('pin roles: supply from net kind, rest signal', () => {
  const m = buildHybridModel(tinyDesign());
  const amp = m.blocks.get('xu1')!;
  assert.equal(amp.pins, 4);
  assert.deepEqual(amp.pinRoles, { signal: 2, supply: 2, control: 0 });
});

test('supply domains: per block local, map lists TOP-LEVEL rails only', () => {
  const d = tinyDesign();
  // Simulate a topology-classifier vote deep in the tree: a block-local net
  // promoted to power. It must show on the block, NOT in the design map.
  d.cells.get('STG')!.nets.find(n => n.name === 'd')!.kind = 'power';
  const m = buildHybridModel(d);
  assert.deepEqual(m.blocks.get('xu2')!.domains.sort(), ['vdd', 'vss']);
  assert.deepEqual(m.blocks.get('xu1/xs1')!.domains.sort(), ['d', 'vdd', 'vss']);
  assert.deepEqual(m.supplyDomains.sort(), ['vdd', 'vss']);
});

test('level net counts sum master-cell nets per depth', () => {
  const m = buildHybridModel(tinyDesign());
  // depth0: TOP has 5 nets. depth1: AMP 5 + DIV 4 = 9. depth2: STG 4 + STG 4 = 8.
  assert.deepEqual(m.levelNetCounts, [5, 9, 8]);
});

// ---- master stacks -------------------------------------------------------

function stackDesign(copies: number): Design {
  const cells = new Map<string, Cell>();
  const insts: Array<[string, string, Record<string, string>]> = [
    ['XA', 'OTHER', { a: 'in', vdd: 'vdd', vss: 'vss' }],
  ];
  for (const i of [3, 7, 9].slice(0, copies)) {
    insts.push([`XI${i}`, 'INVX', { a: 'in', vdd: 'vdd', vss: 'vss' }]);
  }
  cells.set('STOP', cell('STOP', ['in', 'vdd', 'vss'], insts, []));
  for (const name of ['INVX', 'OTHER']) {
    cells.set(name, cell(name, ['a', 'vdd', 'vss'], [], [
      ['M1', 'M', 'nch', [['d', 'a'], ['g', 'a'], ['s', 'vss'], ['b', 'vss']]],
    ]));
  }
  return { cells, topCell: 'STOP', warnings: [] };
}

test('≥3 plain same-master siblings fold into a master stack', () => {
  const m = buildHybridModel(stackDesign(3));
  assert.deepEqual(m.blocks.get('')!.children, ['xa', '#invx']);
  const g = m.blocks.get('#invx')!;
  assert.deepEqual(g.members, ['xi3', 'xi7', 'xi9']);
  assert.equal(g.label, 'XI…');                 // common prefix of the member labels
  assert.equal(g.master, 'INVX');
  assert.equal(g.devices, 3);                   // summed — footer totals unchanged
  assert.equal(m.blocks.get('xi7')!.groupOf, '#invx');
  assert.equal(displayPath(m, 'xi7'), '#invx');
});

test('a pair stays individual: stacks need at least 3', () => {
  const m = buildHybridModel(stackDesign(2));
  assert.deepEqual(m.blocks.get('')!.children, ['xa', 'xi3', 'xi7']);
  assert.ok(!m.blocks.has('#invx'));
});

test('master stacks expand and fold like array groups', () => {
  const m = buildHybridModel(stackDesign(3));
  assert.ok(setGroupExpanded(m, '#invx', true));
  assert.deepEqual(m.blocks.get('')!.children, ['xa', 'xi3', 'xi7', 'xi9']);
  assert.equal(displayPath(m, 'xi7'), 'xi7');
  assert.ok(setGroupExpanded(m, '#invx', false));
  assert.deepEqual(m.blocks.get('')!.children, ['xa', '#invx']);
});

test('array groups keep their bus identity — never absorbed into a stack', () => {
  const d = arrayedDesign();
  const top = d.cells.get('TOP')!;
  // three PLAIN ACELL singletons beside the XA<0..2> bus family
  for (const id of ['XP', 'XQ', 'XR']) {
    top.instances.push({ id, master: 'ACELL', conn: { a: 'in', z: 'out', vdd: 'vdd', vss: 'vss' }, portMap: [] });
  }
  const m = buildHybridModel(d);
  const children = m.blocks.get('')!.children;
  assert.ok(children.includes('xa<2:0>'));      // the bus group survives
  assert.ok(children.includes('#acell'));       // the singletons stacked
  assert.deepEqual(m.blocks.get('#acell')!.members, ['xp', 'xq', 'xr']);
  assert.equal(m.blocks.get('#acell')!.label, 'ACELL'); // 1-char prefix → master name
});
