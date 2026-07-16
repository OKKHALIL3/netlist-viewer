import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLayout } from '../../hybrid/__fixtures__/fakeLayout';
import { tinyDesign } from '../../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../../hybrid/model';
import { classifyNets } from './netClass';
import { findNets } from './findNets';
import type { NetPairCoupling } from '../../hybrid/layoutStats';

const PAIRS: NetPairCoupling[] = [{ aIdx: 0, bIdx: 1, cap: 2e-15 }];

test('coupling threshold filters and sorts', () => {
  const { data } = fakeLayout();
  const hit = findNets({ data, pairs: PAIRS, supplyIdx: new Set(), classes: null, minCouplingF: 1e-15 });
  assert.equal(hit.total, 2);
  assert.deepEqual(hit.rows.map(r => r.net), ['in', 'mid']);
  assert.equal(hit.rows[0].worstPartner?.net, 'mid');

  const miss = findNets({ data, pairs: PAIRS, supplyIdx: new Set(), classes: null, minCouplingF: 3e-15 });
  assert.equal(miss.total, 0);
});

test('supply nets are excluded from both sides', () => {
  const { data } = fakeLayout();
  const out = findNets({ data, pairs: PAIRS, supplyIdx: new Set([0]), classes: null, minCouplingF: 1e-15 });
  assert.deepEqual(out.rows.map(r => r.net), ['mid']);
});

test('class filter joins the heuristic net classes', () => {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  for (const b of model.blocks.values()) if (b.master === 'AMP') b.category = 'A:REF/BIAS';
  const classes = classifyNets(design, model);
  const { data } = fakeLayout(); // nets "in" and "mid" exist in TOP scope
  const bias = findNets({ data, pairs: PAIRS, supplyIdx: new Set(), classes, klass: 'bias' });
  assert.deepEqual(bias.rows.map(r => r.net).sort(), ['in', 'mid']);
  assert.ok(bias.rows.every(r => r.class === 'bias'));
});

test('name pattern falls back to literal on invalid regex', () => {
  const { data } = fakeLayout();
  const out = findNets({ data, pairs: PAIRS, supplyIdx: new Set(), classes: null, namePattern: 'mid(' });
  assert.equal(out.total, 0); // no net literally named "mid("
  const ok = findNets({ data, pairs: PAIRS, supplyIdx: new Set(), classes: null, namePattern: 'mid' });
  assert.deepEqual(ok.rows.map(r => r.net), ['mid']);
});
