import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../../hybrid/model';
import { fakeLayout } from '../../hybrid/__fixtures__/fakeLayout';
import { rankBlocksDetailed, rankNetsBy } from './rank';
import type { NetPairCoupling } from '../../hybrid/layoutStats';

const WEIGHTS: [number, number, number, number] = [0.3, 0.2, 0.3, 0.2];
const PAIRS: NetPairCoupling[] = [{ aIdx: 0, bIdx: 1, cap: 2e-15 }];

test('rankBlocksDetailed orders by score and carries component breakdown', () => {
  const model = buildHybridModel(tinyDesign());
  const ranked = rankBlocksDetailed(model, WEIGHTS, 3);
  assert.ok(ranked.length > 0 && ranked.length <= 3);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
  const top = ranked[0];
  assert.ok(top.components.devices >= 0);
  assert.equal(top.components.parasitics, null); // no DSPF attached
});

test('rankNetsBy coupling aggregates pair caps per net', () => {
  const { data } = fakeLayout();
  const out = rankNetsBy(data, PAIRS, new Set(), 'coupling', 5);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0].value - 2e-15) < 1e-24);
});

test('rankNetsBy totalCap falls back to summed elements when header cap is null', () => {
  const { data } = fakeLayout();
  const out = rankNetsBy(data, PAIRS, new Set(), 'totalCap', 5);
  assert.equal(out[0].net, 'in'); // 2fF grounded + 2fF coupling = 4fF beats mid's 1fF
  assert.ok(Math.abs(out[0].value - 4e-15) < 1e-24);
});
