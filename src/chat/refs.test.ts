import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRef, parseMarkers, refKey, refLabel, type Ref } from './refs';

const ROUND_TRIPS: Ref[] = [
  { kind: 'cell', cell: 'CKBUF' },
  { kind: 'block', path: 'XTOP/XPLL' },
  { kind: 'net', net: 'ck' },
  { kind: 'net', net: 'ck', scope: 'XTOP/XPLL' },
  { kind: 'net', net: 'ck', scope: '' },
  { kind: 'device', cell: 'AMP', id: 'M3' },
];

test('formatRef/parseMarkers round-trips every ref kind', () => {
  for (const ref of ROUND_TRIPS) {
    const parsed = parseMarkers(formatRef(ref));
    assert.deepEqual(parsed, [ref], formatRef(ref));
  }
});

test('prose with two markers splits into interleaved segments', () => {
  const text = 'Net [[net:ck]] couples into [[block:XTOP/XDIV]] hard.';
  const parts = parseMarkers(text);
  assert.equal(parts.length, 5);
  assert.equal(parts[0], 'Net ');
  assert.deepEqual(parts[1], { kind: 'net', net: 'ck' });
  assert.equal(parts[2], ' couples into ');
  assert.deepEqual(parts[3], { kind: 'block', path: 'XTOP/XDIV' });
  assert.equal(parts[4], ' hard.');
});

test('malformed markers stay literal text', () => {
  assert.deepEqual(parseMarkers('see [[bogus:xyz]] here'), ['see [[bogus:xyz]] here']);
  assert.deepEqual(parseMarkers('bad device [[device:noslash]] ok'), ['bad device [[device:noslash]] ok']);
});

test('refKey distinguishes scoped and unscoped nets', () => {
  assert.notEqual(refKey({ kind: 'net', net: 'ck' }), refKey({ kind: 'net', net: 'ck', scope: 'XA' }));
});

test('refLabel gives the short display name', () => {
  assert.equal(refLabel({ kind: 'block', path: 'XTOP/XPLL' }), 'XPLL');
  assert.equal(refLabel({ kind: 'device', cell: 'AMP', id: 'M3' }), 'M3');
});
