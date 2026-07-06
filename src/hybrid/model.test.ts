import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';

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
