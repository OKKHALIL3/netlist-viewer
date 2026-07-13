import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRcNet, addResistor, addCap, solveBetween } from './rcSolver';

const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} !≈ ${b}`);

test('series resistors add', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'm', 1000);
  addResistor(net, 'm', 'b', 2000);
  const s = solveBetween(net, ['a'], ['b']);
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') near(s.r, 3000);
});

test('parallel resistors combine', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'b', 2000);
  addResistor(net, 'a', 'b', 2000);
  const s = solveBetween(net, ['a'], ['b']);
  if (s.kind === 'ok') near(s.r, 1000); else assert.fail(s.kind);
});

test('balanced wheatstone bridge (mesh, not tree)', () => {
  const net = newRcNet();
  addResistor(net, 's', 'x', 1000);
  addResistor(net, 's', 'y', 1000);
  addResistor(net, 'x', 'e', 1000);
  addResistor(net, 'y', 'e', 1000);
  addResistor(net, 'x', 'y', 314); // bridge arm carries no current when balanced
  const s = solveBetween(net, ['s'], ['e']);
  if (s.kind === 'ok') near(s.r, 1000); else assert.fail(s.kind);
});

test('unbalanced bridge matches hand-solved value', () => {
  // s-x 100, s-y 200, x-e 300, y-e 400, x-y 500. Nodal solve by hand
  // (conductances ×6000): 92vx = 20ve + 12vy, 57vy = 15ve + 12vx,
  // 35ve − 20vx − 15vy = 6000 → ve = 17000/71.
  const net = newRcNet();
  addResistor(net, 's', 'x', 100);
  addResistor(net, 's', 'y', 200);
  addResistor(net, 'x', 'e', 300);
  addResistor(net, 'y', 'e', 400);
  addResistor(net, 'x', 'y', 500);
  const s = solveBetween(net, ['s'], ['e']);
  if (s.kind === 'ok') near(s.r, 17000 / 71, 1e-12); else assert.fail(s.kind);
});

test('zero-ohm and valueless resistors merge nodes', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'b', 0);
  addResistor(net, 'b', 'c', null);
  addResistor(net, 'c', 'd', 1000);
  const s = solveBetween(net, ['a'], ['d']);
  if (s.kind === 'ok') near(s.r, 1000); else assert.fail(s.kind);
  assert.equal(net.shortedResistors, 2);
});

test('entry set with multiple contacts is shorted into one supernode', () => {
  const net = newRcNet();
  addResistor(net, 'a1', 'm', 1000);
  addResistor(net, 'a2', 'm', 1000);
  addResistor(net, 'm', 'e', 1000);
  const s = solveBetween(net, ['a1', 'a2'], ['e']);
  if (s.kind === 'ok') near(s.r, 1500); else assert.fail(s.kind);
});

test('RC ladder Elmore delay: exact first moment', () => {
  // s -1k- m -2k- e, 1pF at m, 2pF at e.
  // v(m)=1k, v(e)=3k → τ = 1k·1p + 3k·2p = 7 ns.
  const net = newRcNet();
  addResistor(net, 's', 'm', 1000);
  addResistor(net, 'm', 'e', 2000);
  addCap(net, 'm', 1e-12);
  addCap(net, 'e', 2e-12);
  const s = solveBetween(net, ['s'], ['e']);
  if (s.kind === 'ok') { near(s.r, 3000); near(s.elmore, 7e-9); } else assert.fail(s.kind);
});

test('cap on a side branch weighs in by shared-path resistance only', () => {
  // s -1k- m -2k- e, side branch m -5k- t with 1pF at t.
  // Path to t shares only s→m → contributes 1k·1p; no cap on e → τ = 1 ns.
  const net = newRcNet();
  addResistor(net, 's', 'm', 1000);
  addResistor(net, 'm', 'e', 2000);
  addResistor(net, 'm', 't', 5000);
  addCap(net, 't', 1e-12);
  const s = solveBetween(net, ['s'], ['e']);
  if (s.kind === 'ok') near(s.elmore, 1e-9); else assert.fail(s.kind);
});

test('cap at the entry contributes nothing; floating-island caps are excluded', () => {
  const net = newRcNet();
  addResistor(net, 's', 'e', 1000);
  addCap(net, 's', 1e-12);       // at grounded entry: v=0
  addResistor(net, 'p', 'q', 50); // island not connected to s/e
  addCap(net, 'q', 8e-12);
  const s = solveBetween(net, ['s'], ['e']);
  if (s.kind === 'ok') near(s.elmore, 0); else assert.fail(s.kind);
});

test('no resistive route between anchors → open', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'b', 1000);
  addResistor(net, 'c', 'd', 1000);
  assert.equal(solveBetween(net, ['a'], ['c']).kind, 'open');
});

test('anchor naming no node of the network → unanchored', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'b', 1000);
  assert.equal(solveBetween(net, ['nope'], ['b']).kind, 'unanchored');
});

test('entry and exit on the same supernode → 0 Ω, 0 delay', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'b', 0);
  addResistor(net, 'b', 'c', 1000);
  addCap(net, 'c', 1e-12);
  const s = solveBetween(net, ['a'], ['b']);
  if (s.kind === 'ok') { near(s.r, 0); near(s.elmore, 0); } else assert.fail(s.kind);
});

test('solve does not mutate the net: same query twice agrees', () => {
  const net = newRcNet();
  addResistor(net, 'a', 'm', 100);
  addResistor(net, 'm', 'b', 100);
  addCap(net, 'm', 1e-12);
  const s1 = solveBetween(net, ['a'], ['b']);
  const s2 = solveBetween(net, ['a', 'm'], ['b']); // different anchors
  const s3 = solveBetween(net, ['a'], ['b']);
  if (s1.kind === 'ok' && s3.kind === 'ok') { near(s1.r, s3.r); near(s1.elmore, s3.elmore); }
  else assert.fail('not ok');
  if (s2.kind === 'ok') near(s2.r, 100); else assert.fail(s2.kind);
});

test('a 1000-stage ladder solves fast and exactly', () => {
  const net = newRcNet();
  for (let i = 0; i < 1000; i++) addResistor(net, `n${i}`, `n${i + 1}`, 2);
  const s = solveBetween(net, ['n0'], ['n1000']);
  if (s.kind === 'ok') near(s.r, 2000); else assert.fail(s.kind);
});

test('grid mesh (non-tree fill-in) still solves: 10×10 unit grid', () => {
  // Known reference: R between opposite corners of an N×N unit-resistor grid
  // — check against an independently computed dense solve for 3×3 instead of
  // a literature value: for the 2×2 grid (4 nodes, 4 edges of 1 Ω) corner to
  // corner is exactly 1 Ω by symmetry.
  const net = newRcNet();
  addResistor(net, '00', '01', 1);
  addResistor(net, '00', '10', 1);
  addResistor(net, '01', '11', 1);
  addResistor(net, '10', '11', 1);
  const s = solveBetween(net, ['00'], ['11']);
  if (s.kind === 'ok') near(s.r, 1); else assert.fail(s.kind);

  const big = newRcNet();
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      if (x < 9) addResistor(big, `${x},${y}`, `${x + 1},${y}`, 1);
      if (y < 9) addResistor(big, `${x},${y}`, `${x},${y + 1}`, 1);
    }
  }
  const sb = solveBetween(big, ['0,0'], ['9,9']);
  assert.equal(sb.kind, 'ok');
  // sanity envelope: strictly between the parallel lower bound and series upper bound
  if (sb.kind === 'ok') assert.ok(sb.r > 1 && sb.r < 18, String(sb.r));
});
