import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { arrayedDesign } from './__fixtures__/arrayed';
import { buildHybridModel } from './model';
import { computeRails, visiblePaths, SLIVER_W, CTX_W } from './slots';

const W = 150, GAP = 10; // layout defaults

test('closed root: a single full box on rail 0', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, []);
  assert.deepEqual(l.rails, [['']]);
  assert.deepEqual(l.items.get(''), { path: '', x: 0, w: W, lvl: 0, sliver: false });
  assert.equal(l.width, W);
});

test('open root: children appear on the rail below, all full (frontier); root compresses to context', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, ['']);
  assert.deepEqual(l.rails, [[''], ['xu1', 'xu2']]);
  assert.equal(l.width, 2 * W + GAP);
  assert.deepEqual(l.items.get(''), { path: '', x: (l.width - CTX_W) / 2, w: CTX_W, lvl: 0, sliver: false });
  assert.deepEqual(l.items.get('xu1'), { path: 'xu1', x: 0, w: W, lvl: 1, sliver: false });
  assert.equal(l.items.get('xu2')!.x, W + GAP);
});

test('open path: the open ancestor compresses, siblings collapse to slivers, frontier stays full', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, ['', 'xu1']);
  assert.deepEqual(l.rails[2], ['xu1/xs1', 'xu1/xs2']);
  const xu1 = l.items.get('xu1')!, xu2 = l.items.get('xu2')!;
  assert.equal(xu1.sliver, false);
  assert.equal(xu1.w, CTX_W);                            // context card, not full width
  assert.equal(xu2.sliver, true);
  assert.equal(xu2.w, SLIVER_W);
  const rail1W = CTX_W + GAP + SLIVER_W;
  assert.equal(xu1.x, (l.width - rail1W) / 2);
  assert.equal(xu2.x, xu1.x + CTX_W + GAP);
  // the frontier rail (xu1's children) is the widest and spans the content width
  assert.equal(l.width, 2 * W + GAP);
  assert.equal(l.items.get('xu1/xs1')!.sliver, false);
  assert.equal(l.items.get('xu1/xs1')!.w, W);            // frontier keeps full size
});

test('stale chain entries are dropped: layout stops at the first invalid hop', () => {
  const m = buildHybridModel(tinyDesign());
  assert.equal(computeRails(m, ['', 'nope']).rails.length, 2);        // '' still open
  assert.deepEqual(computeRails(m, ['xu1']).rails, [['']]);           // chain must start at root
  assert.equal(computeRails(m, ['', 'xu1', 'xu2']).rails.length, 3);  // xu2 is not xu1's child
});

test('order callback sorts every rail, open or frontier', () => {
  const m = buildHybridModel(tinyDesign());
  const rev = (a: string, b: string) => b.localeCompare(a);
  const l = computeRails(m, [''], rev);
  assert.deepEqual(l.rails[1], ['xu2', 'xu1']);
});

test('fullW callback sizes FRONTIER boxes only; context and slivers stay fixed', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, ['', 'xu1'], undefined, () => 100);
  assert.equal(l.items.get('xu1/xs1')!.w, 100);          // frontier obeys fullW
  assert.equal(l.items.get('xu1')!.w, CTX_W);            // open ancestor is compressed
  assert.equal(l.items.get('xu2')!.w, SLIVER_W);
});

test('visiblePaths matches the laid-out set', () => {
  const m = buildHybridModel(tinyDesign());
  for (const open of [[], [''], ['', 'xu1'], ['', 'nope']] as string[][]) {
    const l = computeRails(m, open);
    assert.deepEqual([...visiblePaths(m, open)].sort(), [...l.items.keys()].sort());
  }
});

test('rails lay out array groups, never members', () => {
  const m = buildHybridModel(arrayedDesign());
  const l = computeRails(m, ['', 'xa<2:0>']);
  assert.deepEqual(l.rails[1], ['xa<2:0>', 'xs', 'xt']);
  assert.deepEqual(l.rails[2], ['xa<0>/xb<1:0>']);       // representative subtree
  assert.ok(!l.items.has('xa<1>'));
});
