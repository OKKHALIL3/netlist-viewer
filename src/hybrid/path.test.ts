import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { buildConductors } from './connectivity';
import { findPath, resolvePinRef } from './path';

const setup = () => {
  const d = tinyDesign();
  const m = buildHybridModel(d);
  return { d, m, c: buildConductors(d, m) };
};

test('same-conductor pins: one net, endpoint blocks only', () => {
  const { d, m, c } = setup();
  const r = findPath(d, m, c, { block: 'xu1', pin: 'z' }, { block: 'xu2', pin: 'a' })!;
  assert.equal(r.netCount, 1);
  assert.deepEqual(r.blocks, ['xu1', 'xu2']);
});

test('multi-hop path crosses hierarchy through a bridging block', () => {
  const { d, m, c } = setup();
  // xs1.d rides C(n1); xu2.z rides C(out). Route: C(n1) → xs2 → C(mid) → xu2 → C(out)
  const r = findPath(d, m, c, { block: 'xu1/xs1', pin: 'd' }, { block: 'xu2', pin: 'z' })!;
  assert.equal(r.netCount, 3);
  assert.deepEqual(r.blocks, ['xu1/xs1', 'xu1/xs2', 'xu2']);
});

test('top-level subckt pin is a valid endpoint', () => {
  const { d, m, c } = setup();
  const r = findPath(d, m, c, { block: '', pin: 'in' }, { block: 'xu1/xs1', pin: 'g' })!;
  assert.equal(r.netCount, 1);            // same conductor C(in)
});

test('supply pins have no conductor → explicit null', () => {
  const { d, m, c } = setup();
  assert.equal(findPath(d, m, c, { block: 'xu1', pin: 'vdd' }, { block: 'xu2', pin: 'a' }), null);
});

test('"top" (any case) aliases the root cell in pin refs', () => {
  const { d, m } = setup();
  assert.deepEqual(resolvePinRef(d, m, { block: 'top', pin: 'in' }), { block: '', pin: 'in' });
  assert.deepEqual(resolvePinRef(d, m, { block: 'TOP', pin: 'IN' }), { block: '', pin: 'in' });
  assert.equal(resolvePinRef(d, m, { block: 'top', pin: 'nope' }), null);
});
