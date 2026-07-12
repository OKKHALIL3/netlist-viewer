import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewers } from './flags';

test('unset means every viewer is enabled (local dev default)', () => {
  assert.deepEqual(parseViewers(undefined), { hybrid: true, layout: true });
});

test('empty string means every viewer is enabled', () => {
  assert.deepEqual(parseViewers(''), { hybrid: true, layout: true });
});

test('"all" enables every viewer', () => {
  assert.deepEqual(parseViewers('all'), { hybrid: true, layout: true });
});

test('"schematic" disables hybrid and layout', () => {
  assert.deepEqual(parseViewers('schematic'), { hybrid: false, layout: false });
});

test('"schematic,hybrid" enables hybrid only', () => {
  assert.deepEqual(parseViewers('schematic,hybrid'), { hybrid: true, layout: false });
});

test('"schematic,hybrid,layout" enables everything', () => {
  assert.deepEqual(parseViewers('schematic,hybrid,layout'), { hybrid: true, layout: true });
});

test('tokens are trimmed and case-insensitive', () => {
  assert.deepEqual(parseViewers(' Schematic , HYBRID '), { hybrid: true, layout: false });
});

test('unknown tokens are ignored', () => {
  assert.deepEqual(parseViewers('schematic,banana'), { hybrid: false, layout: false });
});
