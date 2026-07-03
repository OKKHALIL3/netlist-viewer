import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { criticalityScores, criticalityOrder } from './criticality';

test('level max scores 1, smaller siblings score less, log-normalized', () => {
  const m = buildHybridModel(tinyDesign());
  const s = criticalityScores(m, [0.3, 0.2, 0.3, 0.2]);
  // depth1: xu1 (dev 4, nets 5) vs xu2 (dev 2, nets 4) — xu1 is max on both live components
  assert.equal(s.get('xu1'), 1);
  assert.ok(s.get('xu2')! < 1 && s.get('xu2')! > 0);
});

test('null DSPF components redistribute weight (scores still sum sensibly)', () => {
  const m = buildHybridModel(tinyDesign()); // no DSPF → parasitics/coupling null
  const s = criticalityScores(m, [0, 0, 0.5, 0.5]); // ALL weight on missing components
  // redistribution falls back to equal weight over live components — not NaN, not 0 for the max
  assert.equal(s.get('xu1'), 1);
  assert.ok(Number.isFinite(s.get('xu2')!));
});

test('order is descending with path tie-break, stable input-independent', () => {
  const m = buildHybridModel(tinyDesign());
  const s = criticalityScores(m, [0.3, 0.2, 0.3, 0.2]);
  const cmp = criticalityOrder(s);
  assert.ok(cmp('xu1', 'xu2') < 0); // xu1 more critical → first
});
