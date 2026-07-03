import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { attachLayoutStats } from './layoutStats';
import { couplingFor } from './coupling';
import { fakeLayout } from './__fixtures__/fakeLayout';

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
