import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLayout } from '../../hybrid/__fixtures__/fakeLayout';
import { sliceParasitics } from './sliceParasitics';
import type { NetPairCoupling } from '../../hybrid/layoutStats';

// fakeLayout: net 0 "in" = 3×1Ω R, 2×1fF grounded C, one 2fF coupling cap to
// net 1 "mid" = 5×1Ω R, 1×1fF grounded C.
const PAIRS: NetPairCoupling[] = [{ aIdx: 0, bIdx: 1, cap: 2e-15 }];

test('sums R, grounded C, coupling C, and partners over a slice', () => {
  const { data } = fakeLayout();
  const out = sliceParasitics(new Set([0, 1]), data, PAIRS);
  assert.equal(out.netCount, 2);
  assert.equal(out.truncated, false);
  assert.equal(out.totals.r, 8);
  assert.ok(Math.abs(out.totals.cGround - 3e-15) < 1e-24);
  assert.ok(Math.abs(out.totals.cCoupling - 2e-15) < 1e-24); // pair counted once
  const inNet = out.nets.find(n => n.net === 'in')!;
  assert.equal(inNet.rTotal, 3);
  assert.deepEqual(inNet.partners, [{ net: 'mid', cap: 2e-15 }]);
});

test('a pair with one end outside the slice still counts as exposure', () => {
  const { data } = fakeLayout();
  const out = sliceParasitics(new Set([0]), data, PAIRS);
  assert.ok(Math.abs(out.totals.cCoupling - 2e-15) < 1e-24);
  assert.equal(out.nets[0].partners[0].net, 'mid');
});

test('truncation keeps the highest-C nets and reports the full count', () => {
  const { data } = fakeLayout();
  const out = sliceParasitics(new Set([0, 1]), data, PAIRS, 1);
  assert.equal(out.nets.length, 1);
  assert.equal(out.netCount, 2);
  assert.equal(out.truncated, true);
  assert.equal(out.nets[0].net, 'in'); // 2fF ground + 2fF coupling beats mid
});
