import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Design } from '../parser/types';
import { tinyDesign, cell } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { buildConductors, traceDeviceConnectivity } from './connectivity';

const setup = () => {
  const d = tinyDesign();
  const m = buildHybridModel(d);
  return { d, m, c: buildConductors(d, m) };
};

test('deviceBlocksOf lists device endpoints only — the feed-through wrapper is excluded', () => {
  const { c } = setup();
  const cmid = c.idOf.get('|mid')!;
  // xu1/xs2 (STG device on d) and xu2 (DIV device on a) both sit on mid.
  assert.deepEqual([...c.deviceBlocksOf.get(cmid)!].sort(), ['xu1/xs2', 'xu2'].sort());
  // xu1 (AMP) only PASSES mid through a port — no device of its own on it.
  assert.ok(!c.deviceBlocksOf.get(cmid)!.has('xu1'));
});

test('device trace from xu2: the neighbor is the real device block, not the AMP wrapper', () => {
  const { d, m, c } = setup();
  const r = traceDeviceConnectivity(d, m, c, 'xu2');
  assert.deepEqual([...r.blocks].sort(), ['xu1/xs2']);
});

test('device trace from a wrapper (AMP) skips its own subtree, keeps the external neighbor', () => {
  const { d, m, c } = setup();
  const r = traceDeviceConnectivity(d, m, c, 'xu1');
  // xu1/xs1 and xu1/xs2 are INSIDE xu1 (internal) — excluded; xu2 is external.
  assert.deepEqual([...r.blocks].sort(), ['xu2']);
});

test('device trace from a leaf reaches both device neighbors across the boundary', () => {
  const { d, m, c } = setup();
  const r = traceDeviceConnectivity(d, m, c, 'xu1/xs2');
  assert.deepEqual([...r.blocks].sort(), ['xu1/xs1', 'xu2'].sort());
});

test('device trace never connects through supplies', () => {
  const { d, m, c } = setup();
  const r = traceDeviceConnectivity(d, m, c, 'xu2');
  assert.ok(r.nets.every(n => n.name !== 'vdd' && n.name !== 'vss'));
});

test('device trace groups neighbors under the shared net', () => {
  const { d, m, c } = setup();
  const r = traceDeviceConnectivity(d, m, c, 'xu1/xs2');
  assert.deepEqual(r.nets.find(n => n.name === 'mid')?.blocks, ['xu2']);
  assert.deepEqual(r.nets.find(n => n.name === 'xu1/n1')?.blocks, ['xu1/xs1']);
  assert.equal(r.netOf.get('xu2'), 'mid');
});

test('an unresolved device-cell leaf (no primitives) still counts as an endpoint', () => {
  // XA is a resolved cell with a device on `sig`; XB is an unresolved master
  // (a childless leaf, like the ESD diode wrappers) also tied to `sig`.
  const cells = new Map();
  cells.set('TOP', cell('TOP', ['sig', 'vdd', 'vss'], [
    ['XA', 'LEAFP', { p: 'sig', vdd: 'vdd', vss: 'vss' }],
    ['XB', 'UNRES', { p: 'sig' }],
  ], []));
  cells.set('LEAFP', cell('LEAFP', ['p', 'vdd', 'vss'], [], [
    ['R1', 'R', 'r', [['a', 'p'], ['b', 'vdd']]],
  ]));
  const d: Design = { cells, topCell: 'TOP', warnings: [] };
  const m = buildHybridModel(d);
  const c = buildConductors(d, m);
  const r = traceDeviceConnectivity(d, m, c, 'xa');
  assert.deepEqual([...r.blocks].sort(), ['xb']);
});
