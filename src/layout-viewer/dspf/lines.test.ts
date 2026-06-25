import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLogicalLines } from './lines';

test('joins +-continuation lines into one logical line', () => {
  const text = [
    '*|I (X100/M1:d X100/M1',
    '+    d pch 0.5 3.99 8.33)',
    'R1 a b 1.0',
  ].join('\n');
  assert.deepEqual(toLogicalLines(text), [
    '*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)',
    'R1 a b 1.0',
  ]);
});

test('joins trailing-backslash continuations', () => {
  const text = 'R9 a b 1.0 $w=0.05 \\\n+   $layer=M2 $X=1 $Y=2';
  assert.deepEqual(toLogicalLines(text), ['R9 a b 1.0 $w=0.05  $layer=M2 $X=1 $Y=2']);
});

test('drops blank lines and CRLF, right-trims', () => {
  const text = '*|NET N 1   \r\n\r\n*|S (N:1 0 0)\r\n';
  assert.deepEqual(toLogicalLines(text), ['*|NET N 1', '*|S (N:1 0 0)']);
});

test('handles multiple consecutive + continuations', () => {
  const text = 'R1 a b 1\n+ $x=1\n+ $y=2\n+ $x2=3';
  assert.deepEqual(toLogicalLines(text), ['R1 a b 1 $x=1 $y=2 $x2=3']);
});
