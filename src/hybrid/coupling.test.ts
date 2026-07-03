import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { attachLayoutStats } from './layoutStats';
import { couplingFor } from './coupling';
import { fakeLayout, fakeLayoutWithSupply } from './__fixtures__/fakeLayout';

test('aggregates coupling per neighbor with threshold and supply filter', () => {
  const m = buildHybridModel(tinyDesign());
  const { data, lm } = fakeLayout();          // 'in'@xu1 ↔ 'mid'@{xu1,xu2}: 2fF
  const pairs = attachLayoutStats(m, data, lm);
  const res = couplingFor(m, data, pairs, 'xu1', ['xu2'], 1e-15, false);
  assert.equal(res.length, 1);
  assert.equal(res[0].block, 'xu2');
  assert.equal(res[0].total, 2e-15);
  assert.deepEqual(res[0].pairs[0], { netA: 'in', netB: 'mid', cap: 2e-15 });
  // threshold above the cap → edge hidden
  assert.equal(couplingFor(m, data, pairs, 'xu1', ['xu2'], 5e-15, false).length, 0);
});

test('excludes a pair when the SELECTED block side is the supply net, by default', () => {
  const m = buildHybridModel(tinyDesign());
  // adds 'vss'@xu1 ↔ 'mid'@{xu1,xu2}: 3fF on top of the base 'in'↔'mid': 2fF pair
  const { data, lm } = fakeLayoutWithSupply();
  const pairs = attachLayoutStats(m, data, lm);

  // includeSupply=false: vss (selected-side supply) must not leak through, even
  // though the neighbor-side net ('mid') is an ordinary signal.
  const withoutSupply = couplingFor(m, data, pairs, 'xu1', ['xu2'], 1e-15, false);
  assert.equal(withoutSupply.length, 1);
  assert.equal(withoutSupply[0].block, 'xu2');
  assert.equal(withoutSupply[0].total, 2e-15);
  assert.deepEqual(withoutSupply[0].pairs, [{ netA: 'in', netB: 'mid', cap: 2e-15 }]);

  // includeSupply=true: the vss pair is included again.
  const withSupply = couplingFor(m, data, pairs, 'xu1', ['xu2'], 1e-15, true);
  assert.equal(withSupply.length, 1);
  assert.equal(withSupply[0].total, 5e-15);
  assert.deepEqual(withSupply[0].pairs, [
    { netA: 'vss', netB: 'mid', cap: 3e-15 },
    { netA: 'in', netB: 'mid', cap: 2e-15 },
  ]);
});
