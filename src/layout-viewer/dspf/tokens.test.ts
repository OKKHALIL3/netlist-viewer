import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTokens, parseKeyVals, parseParenPayload } from './tokens';

test('parseKeyVals separates $key=val from positional tokens', () => {
  const { params, rest } = parseKeyVals(splitTokens('a b 1.0 $w=0.05 $layer=M1 tc1=0.001'));
  assert.deepEqual(rest, ['a', 'b', '1.0']);
  assert.equal(params.get('w'), '0.05');
  assert.equal(params.get('layer'), 'M1');
  assert.equal(params.get('tc1'), '0.001');
});

test('parseParenPayload: trailing two numerics are the coords', () => {
  assert.deepEqual(parseParenPayload('(VOUTP:1 9.94 3.81)'),
    { name: 'VOUTP:1', rest: ['VOUTP:1', '9.94', '3.81'], x: 9.94, y: 3.81, params: new Map() });
});

test('parseParenPayload: variable arity, coords still trailing', () => {
  const info = parseParenPayload('(X100/M1:d X100/M1 d pch 0.5 3.99 8.33)')!;
  assert.equal(info.name, 'X100/M1:d');
  assert.equal(info.x, 3.99);
  assert.equal(info.y, 8.33);
});

test('parseParenPayload: no trailing numerics → null coords (CLKGEN)', () => {
  const info = parseParenPayload('(X100/M2:g X100/M2 g pch 0.5)')!;
  assert.equal(info.name, 'X100/M2:g');
  assert.equal(info.x, null);
  assert.equal(info.y, null);
});

test('parseParenPayload: explicit $x/$y override + layer param survives', () => {
  const info = parseParenPayload('(N:2 $lvl=5 $x=18.69 $y=12.86)')!;
  assert.equal(info.x, 18.69);
  assert.equal(info.y, 12.86);
  assert.equal(info.params.get('lvl'), '5');
});
