import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { attachLayoutStats } from './layoutStats';
import { fakeLayout } from './__fixtures__/fakeLayout';

test('attaches per-block R/C/coupling with ancestor rollup', () => {
  const m = buildHybridModel(tinyDesign());
  const { data, lm } = fakeLayout();
  const pairs = attachLayoutStats(m, data, lm);
  assert.equal(m.hasLayout, true);
  assert.equal(m.blocks.get('xu1')!.parasiticR, 8);       // in(3) + mid(5)
  assert.equal(m.blocks.get('xu2')!.parasiticR, 5);       // mid only
  assert.equal(m.blocks.get('')!.parasiticR, 8);          // root sees all (dedup)
  assert.equal(m.blocks.get('xu1')!.parasiticC, 3);       // ground caps: 2 + 1
  assert.equal(m.blocks.get('xu1')!.couplingC, 2e-15);    // one coupling cap counted once
  assert.equal(m.blocks.get('xu2')!.couplingC, 2e-15);    // other side of the same cap
  assert.equal(m.blocks.get('xu1/xs1')!.parasiticR, 0);   // in scope but owns nothing
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].cap, 2e-15);
});
