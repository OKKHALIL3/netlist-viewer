import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFloatingNet, classifyDangling } from './netStatus';

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

test('dangling classification by name / endpoint id', () => {
  // net named like a dummy resistor segment
  assert.equal(
    classifyDangling({ name: 'XR0_1__dmy0__m1', endpoints: [['XR0', 'b']] }),
    'dummy-leg',
  );
  // sole endpoint device is dummy-named
  assert.equal(
    classifyDangling({ name: 'weird', endpoints: [['XR0_2__dmy0__m1', 'b']] }),
    'dummy-leg',
  );
  // plain float without any dummy marker in reach
  assert.equal(
    classifyDangling({ name: 'net1', endpoints: [['XR0', 'a']] }),
    'floating',
  );
});

test('floating net whose sole device also drives __dmy nets is a dummy leg', () => {
  // mirrors n16g_clk_cml2cmos_buff: XR0 net1 XR0_1__dmy0__m1 rhim — net1 is
  // the open end of a snaked dummy-resistor chain.
  const cell = {
    primitives: [{
      id: 'XR0', kind: 'R' as const, model: 'rhim', params: {},
      terms: [['a', 'net1'], ['b', 'XR0_1__dmy0__m1']] as Array<[string, string]>,
    }],
  };
  assert.equal(
    classifyDangling({ name: 'net1', endpoints: [['XR0', 'a']] }, cell),
    'dummy-leg',
  );
});

test('connected nets classify as null', () => {
  assert.equal(classifyDangling({ name: 'n', endpoints: [['A', 'x'], ['B', 'y']] }), null);
});
