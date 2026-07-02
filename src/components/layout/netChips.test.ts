import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupNetChips } from './netChips';

test('bus siblings collapse into one group with a <hi:lo> label', () => {
  const groups = groupNetChips(['ck_ch', 'therm<15>', 'therm<27>', 'therm<7>', 'VDD_PA']);
  assert.deepEqual(groups.map(g => g.label), ['ck_ch', 'therm<27:7>', 'VDD_PA']);
  assert.deepEqual(groups[1].members, ['therm<15>', 'therm<27>', 'therm<7>']);
});

test('fewer than minGroup siblings stay individual chips', () => {
  const groups = groupNetChips(['a<0>', 'a<1>', 'plain']);
  assert.deepEqual(groups.map(g => g.label), ['a<0>', 'a<1>', 'plain']);
});

test('order follows first appearance', () => {
  const groups = groupNetChips(['z', 'b<1>', 'a', 'b<2>', 'b<3>']);
  assert.deepEqual(groups.map(g => g.label), ['z', 'b<3:1>', 'a']);
});

test('plain names pass through untouched', () => {
  const groups = groupNetChips(['AVRH', 'VSS']);
  assert.deepEqual(groups.map(g => g.label), ['AVRH', 'VSS']);
  assert.deepEqual(groups[0].members, ['AVRH']);
});
