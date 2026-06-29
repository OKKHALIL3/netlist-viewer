import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFloatingNet } from './netStatus';

test('a net with <=1 endpoint is floating (dangling)', () => {
  assert.equal(isFloatingNet({ endpoints: [['XR0', 'a']] }), true);       // internal net, one device pin
  assert.equal(isFloatingNet({ endpoints: [['__port__', 'P']] }), true);  // port unused inside the cell
  assert.equal(isFloatingNet({ endpoints: [] }), true);
});

test('a net that connects two things is not floating', () => {
  assert.equal(isFloatingNet({ endpoints: [['XR0', 'a'], ['XR1', 'b']] }), false);
  // pass-through: a port plus one device pin connects up to the parent
  assert.equal(isFloatingNet({ endpoints: [['__port__', 'P'], ['M1', 'd']] }), false);
});
