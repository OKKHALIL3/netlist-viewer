import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { computeSlots } from './slots';

test('leaf slots increment, parents center over children', () => {
  const m = buildHybridModel(tinyDesign());
  const { slot, width } = computeSlots(m, '', 2);
  // leaves in document order: xu1/xs1=0, xu1/xs2=1, xu2=2
  assert.equal(slot.get('xu1/xs1'), 0);
  assert.equal(slot.get('xu1/xs2'), 1);
  assert.equal(slot.get('xu2'), 2);
  assert.equal(slot.get('xu1'), 0.5);      // mean of children
  assert.equal(slot.get(''), 1.25);        // mean(0.5, 2)
  assert.equal(width, 3);
});

test('depth cap turns inner nodes into leaves', () => {
  const m = buildHybridModel(tinyDesign());
  const { slot, width } = computeSlots(m, '', 1);
  assert.equal(slot.get('xu1'), 0);
  assert.equal(slot.get('xu2'), 1);
  assert.equal(slot.has('xu1/xs1'), false);
  assert.equal(width, 2);
});

test('custom order reorders siblings inside parent span', () => {
  const m = buildHybridModel(tinyDesign());
  const rev = (a: string, b: string) => b.localeCompare(a);
  const { slot } = computeSlots(m, '', 2, rev);
  assert.equal(slot.get('xu2'), 0);        // reversed: xu2 first
  assert.equal(slot.get('xu1/xs2'), 1);
  assert.equal(slot.get('xu1/xs1'), 2);
});

test('re-rooting at a block lays out only its subtree', () => {
  const m = buildHybridModel(tinyDesign());
  const { slot, width } = computeSlots(m, 'xu1', 1);
  assert.deepEqual([...slot.keys()].sort(), ['xu1', 'xu1/xs1', 'xu1/xs2']);
  assert.equal(width, 2);
});
