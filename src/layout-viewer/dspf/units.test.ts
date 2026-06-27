import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpiceNumber, isNumericToken, num } from './units';

test('parseSpiceNumber: plain + scientific', () => {
  assert.equal(parseSpiceNumber('1.5'), 1.5);
  assert.equal(parseSpiceNumber('-3.99e-6'), -3.99e-6);
  assert.equal(parseSpiceNumber('.25'), 0.25);
});

test('parseSpiceNumber: engineering suffixes', () => {
  assert.equal(parseSpiceNumber('0.5p'), 0.5e-12);
  assert.equal(parseSpiceNumber('1.2u'), 1.2e-6);
  assert.equal(parseSpiceNumber('5k'), 5e3);
  assert.equal(parseSpiceNumber('1meg'), 1e6);   // meg before milli
  assert.equal(parseSpiceNumber('2m'), 2e-3);
  // 3 * 1e-15 differs from the literal 3e-15 by one ULP, so assert against the
  // same float arithmetic the parser performs (this still verifies f => 1e-15).
  assert.equal(parseSpiceNumber('3f'), 3 * 1e-15);
});

test('parseSpiceNumber: trailing unit letters are ignored after the scale', () => {
  assert.equal(parseSpiceNumber('12.3ohm'), 12.3);   // 'o' is not a scale → value as-is
  assert.equal(Number.isNaN(parseSpiceNumber('abc')), true);
  assert.equal(Number.isNaN(parseSpiceNumber('')), true);
});

test('isNumericToken only accepts whole numeric tokens', () => {
  assert.equal(isNumericToken('9.94'), true);
  assert.equal(isNumericToken('-1e3'), true);
  assert.equal(isNumericToken('X9/M1:o'), false);
  assert.equal(isNumericToken('0.5p'), false);       // has suffix → not a bare coordinate
});

test('num returns null on absent/invalid', () => {
  assert.equal(num(undefined), null);
  assert.equal(num('1.322'), 1.322);
  assert.equal(num('nope'), null);
});
