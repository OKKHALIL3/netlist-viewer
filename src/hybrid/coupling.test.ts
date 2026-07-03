import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { attachLayoutStats } from './layoutStats';
import { couplingFor } from './coupling';
import { fakeLayout, fakeLayoutWithSupply, dnet } from './__fixtures__/fakeLayout';

test('aggregates coupling per neighbor with threshold and supply filter', () => {
  const design = tinyDesign();
  const m = buildHybridModel(design);
  const { data, lm } = fakeLayout();          // 'in'@xu1 ↔ 'mid'@{xu1,xu2}: 2fF
  const pairs = attachLayoutStats(m, data, lm);
  const res = couplingFor(design, m, data, pairs, 'xu1', ['xu2'], 1e-15, false);
  assert.equal(res.length, 1);
  assert.equal(res[0].block, 'xu2');
  assert.equal(res[0].total, 2e-15);
  assert.deepEqual(res[0].pairs[0], { netA: 'in', netB: 'mid', cap: 2e-15 });
  // threshold above the cap → edge hidden
  assert.equal(couplingFor(design, m, data, pairs, 'xu1', ['xu2'], 5e-15, false).length, 0);
});

test('excludes a pair when the SELECTED block side is the supply net, by default', () => {
  const design = tinyDesign();
  const m = buildHybridModel(design);
  // adds 'vss'@xu1 ↔ 'mid'@{xu1,xu2}: 3fF on top of the base 'in'↔'mid': 2fF pair
  const { data, lm } = fakeLayoutWithSupply();
  const pairs = attachLayoutStats(m, data, lm);

  // includeSupply=false: vss (selected-side supply) must not leak through, even
  // though the neighbor-side net ('mid') is an ordinary signal.
  const withoutSupply = couplingFor(design, m, data, pairs, 'xu1', ['xu2'], 1e-15, false);
  assert.equal(withoutSupply.length, 1);
  assert.equal(withoutSupply[0].block, 'xu2');
  assert.equal(withoutSupply[0].total, 2e-15);
  assert.deepEqual(withoutSupply[0].pairs, [{ netA: 'in', netB: 'mid', cap: 2e-15 }]);

  // includeSupply=true: the vss pair is included again.
  const withSupply = couplingFor(design, m, data, pairs, 'xu1', ['xu2'], 1e-15, true);
  assert.equal(withSupply.length, 1);
  assert.equal(withSupply[0].total, 5e-15);
  assert.deepEqual(withSupply[0].pairs, [
    { netA: 'vss', netB: 'mid', cap: 3e-15 },
    { netA: 'in', netB: 'mid', cap: 2e-15 },
  ]);
});

test('excludes a topology-classified rail with no vdd/vss name pattern (AVRH regression)', () => {
  // 'avrh' matches neither PWR_RE nor GND_RE — only the CDL's topology-refined
  // Net.kind (set directly here, standing in for bulk-vote/propagation results)
  // marks it as supply. isSupplyNet must consult that kind, not just the name.
  const design = tinyDesign();
  const top = design.cells.get('TOP')!;
  top.nets.push({ name: 'avrh', kind: 'power', endpoints: [] });
  const m = buildHybridModel(design);

  const base = fakeLayout();                 // 'in'@xu1 ↔ 'mid'@{xu1,xu2}: 2fF
  const avrh = dnet('avrh', 1, 0, [['mid:1', 5e-15]]);
  const data: LayoutData = { ...base.data, nets: [...base.data.nets, avrh] };
  const lm = { nets: [...base.lm.nets, { name: 'avrh', instances: ['xu1'] }] } as unknown as LayoutModel;
  const pairs = attachLayoutStats(m, data, lm);

  // includeSupply=false: avrh (topology supply, name-innocent) must not leak
  // through — only the ordinary in↔mid pair survives.
  const withoutSupply = couplingFor(design, m, data, pairs, 'xu1', ['xu2'], 1e-15, false);
  assert.equal(withoutSupply.length, 1);
  assert.equal(withoutSupply[0].block, 'xu2');
  assert.deepEqual(withoutSupply[0].pairs, [{ netA: 'in', netB: 'mid', cap: 2e-15 }]);

  // includeSupply=true: the avrh pair is included again.
  const withSupply = couplingFor(design, m, data, pairs, 'xu1', ['xu2'], 1e-15, true);
  assert.equal(withSupply.length, 1);
  assert.equal(withSupply[0].total, 7e-15);
  assert.deepEqual(withSupply[0].pairs, [
    { netA: 'avrh', netB: 'mid', cap: 5e-15 },
    { netA: 'in', netB: 'mid', cap: 2e-15 },
  ]);
});
