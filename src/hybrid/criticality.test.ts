import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Design } from '../parser/types';
import { tinyDesign, cell } from './__fixtures__/tiny';
import { buildHybridModel, setGroupExpanded } from './model';
import { criticalityScores, criticalityOrder } from './criticality';

function stackDesign(): Design {
  const cells = new Map();
  const insts: Array<[string, string, Record<string, string>]> = [['XA', 'OTHER', { a: 'in', vdd: 'vdd', vss: 'vss' }]];
  for (const i of [3, 7, 9]) insts.push([`XI${i}`, 'INVX', { a: 'in', vdd: 'vdd', vss: 'vss' }]);
  cells.set('STOP', cell('STOP', ['in', 'vdd', 'vss'], insts, []));
  for (const name of ['INVX', 'OTHER']) {
    cells.set(name, cell(name, ['a', 'vdd', 'vss'], [], [['M1', 'M', 'nch', [['d', 'a'], ['g', 'a'], ['s', 'vss'], ['b', 'vss']]]]));
  }
  return { cells, topCell: 'STOP', warnings: [] };
}

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

test('a sub-epsilon level max yields finite scores, not NaN', () => {
  const m = buildHybridModel(tinyDesign());
  // A coupling value so tiny that 1 + v rounds to 1.0 made Math.log(1 + v) === 0
  // → NaN scores → NaN block widths. log1p keeps the ratio finite.
  m.blocks.get('xu1')!.couplingC = 5e-17;
  m.blocks.get('xu2')!.couplingC = 2e-17;
  const s = criticalityScores(m, [0, 0, 0, 1]);
  assert.ok(Number.isFinite(s.get('xu1')!), `xu1 finite, got ${s.get('xu1')}`);
  assert.ok(Number.isFinite(s.get('xu2')!), `xu2 finite, got ${s.get('xu2')}`);
});

test('an expanded ×N group is excluded from criticality (its summed stats do not skew the level)', () => {
  const m = buildHybridModel(stackDesign());
  assert.ok(criticalityScores(m, [1, 0, 0, 0]).has('#invx'), 'collapsed group is scored');
  setGroupExpanded(m, '#invx', true);
  assert.ok(!criticalityScores(m, [1, 0, 0, 0]).has('#invx'), 'expanded group is not scored');
});

test('order is descending with path tie-break, stable input-independent', () => {
  const m = buildHybridModel(tinyDesign());
  const s = criticalityScores(m, [0.3, 0.2, 0.3, 0.2]);
  const cmp = criticalityOrder(s);
  assert.ok(cmp('xu1', 'xu2') < 0); // xu1 more critical → first
});
