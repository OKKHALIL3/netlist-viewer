import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewers } from './flags';

test('unset means every viewer is enabled (local dev default)', () => {
  assert.deepEqual(parseViewers(undefined), { hybrid: true, layout: true, chat: true });
});

test('empty string means every viewer is enabled', () => {
  assert.deepEqual(parseViewers(''), { hybrid: true, layout: true, chat: true });
});

test('"all" enables every viewer', () => {
  assert.deepEqual(parseViewers('all'), { hybrid: true, layout: true, chat: true });
});

test('"schematic" disables hybrid, layout, and chat', () => {
  assert.deepEqual(parseViewers('schematic'), { hybrid: false, layout: false, chat: false });
});

test('"schematic,hybrid" enables hybrid only', () => {
  assert.deepEqual(parseViewers('schematic,hybrid'), { hybrid: true, layout: false, chat: false });
});

test('"schematic,hybrid,layout" enables hybrid and layout but not chat', () => {
  assert.deepEqual(parseViewers('schematic,hybrid,layout'), { hybrid: true, layout: true, chat: false });
});

test('"schematic,chat" enables chat only', () => {
  assert.deepEqual(parseViewers('schematic,chat'), { hybrid: false, layout: false, chat: true });
});

test('tokens are trimmed and case-insensitive', () => {
  assert.deepEqual(parseViewers(' Schematic , HYBRID '), { hybrid: true, layout: false, chat: false });
});

test('unknown tokens are ignored', () => {
  assert.deepEqual(parseViewers('schematic,banana'), { hybrid: false, layout: false, chat: false });
});
