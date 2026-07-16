import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchIndex } from './match';
import type { SearchResult } from '../../search/searchIndex';

const r = (kind: SearchResult['kind'], id: string, detail = '', extra: Partial<SearchResult> = {}): SearchResult =>
  ({ kind, id, cellName: 'TOP', detail, ...extra } as SearchResult);

const INDEX: SearchResult[] = [
  r('net', 'ck_int', 'net in TOP'),
  r('net', 'ck', 'net in TOP'),
  r('instance', 'XCK_BUF', 'CKBUF'),
  r('cell', 'CKBUF', 'cell'),
  r('pin', 'ck', 'net ck', { ownerKind: 'instance', ownerId: 'XI1' }),
  r('pin', 'D', 'net ck', { ownerKind: 'primitive', ownerId: 'M1' }),
];

test('exact id match ranks before prefix and substring', () => {
  const out = matchIndex(INDEX, 'ck');
  assert.equal(out[0].id, 'ck');
  assert.equal(out[0].kind, 'net');
  // pin "ck" is also exact — stable order keeps the net (earlier in index) first
  assert.equal(out[1].id, 'ck');
  assert.equal(out[1].kind, 'pin');
  assert.equal(out[2].id, 'ck_int'); // prefix
});

test('pins do not match on detail (connected net name)', () => {
  const out = matchIndex(INDEX, 'ck');
  // pin D's detail is "net ck" but pins only match on id
  assert.ok(!out.some(m => m.kind === 'pin' && m.id === 'D'));
});

test('non-pin detail matches rank last', () => {
  const out = matchIndex(INDEX, 'ckbuf');
  assert.equal(out[0].id, 'CKBUF'); // exact id
  assert.equal(out[1].id, 'XCK_BUF'); // id has no 'ckbuf' substring — matched via detail, ranked last
});

test('empty query matches nothing', () => {
  assert.deepEqual(matchIndex(INDEX, '   '), []);
});

test('limit truncates', () => {
  assert.equal(matchIndex(INDEX, 'ck', 2).length, 2);
});
