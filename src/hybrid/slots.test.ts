import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Design, Cell } from '../parser/types';
import { tinyDesign, cell } from './__fixtures__/tiny';
import { arrayedDesign } from './__fixtures__/arrayed';
import { buildHybridModel } from './model';
import { computeRails, visiblePaths, SLIVER_W, CTX_W } from './slots';

const W = 150, GAP = 10; // layout defaults

// n leaf cells with DISTINCT masters (no stacking) and one device each (not
// empty leaves) — plain frontier fodder for wrap/stub tests.
function fanDesign(n: number, firstMaster?: string): Design {
  const cells = new Map<string, Cell>();
  const insts: Array<[string, string, Record<string, string>]> = [];
  for (let i = 0; i < n; i++) {
    const master = i === 0 && firstMaster ? firstMaster : `LEAF${i}`;
    insts.push([`XM${i}`, master, { a: 'in', vdd: 'vdd', vss: 'vss' }]);
    if (!cells.has(master)) {
      cells.set(master, cell(master, ['a', 'vdd', 'vss'], [], [
        ['M1', 'M', 'nch', [['d', 'a'], ['g', 'a'], ['s', 'vss'], ['b', 'vss']]],
      ]));
    }
  }
  cells.set('FTOP', cell('FTOP', ['in', 'vdd', 'vss'], insts, []));
  return { cells, topCell: 'FTOP', warnings: [] };
}

test('closed root: a single full box on rail 0', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, []);
  assert.deepEqual(l.rails, [['']]);
  assert.deepEqual(l.items.get(''), { path: '', x: 0, w: W, lvl: 0, row: 0, sliver: false });
  assert.equal(l.width, W);
  assert.deepEqual(l.rowsAt, [1]);
  assert.deepEqual(l.stubs, []);
});

test('open root: children appear on the rail below, all full; root compresses onto the spine', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, ['']);
  assert.deepEqual(l.rails, [[''], ['xu1', 'xu2']]);
  assert.equal(l.width, 2 * W + GAP);
  const root = l.items.get('')!;
  assert.equal(root.w, CTX_W);
  assert.equal(root.x + CTX_W / 2, l.width / 2);         // centered on the spine
  const xs = [l.items.get('xu1')!, l.items.get('xu2')!];
  assert.ok(xs.every(it => it.w === W && it.lvl === 1 && it.row === 0 && !it.sliver));
  assert.deepEqual(xs.map(it => it.x).sort((a, b) => a - b), [0, W + GAP]);
});

test('open path: the chain runs down the spine, siblings collapse to slivers, frontier stays full', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, ['', 'xu1']);
  assert.deepEqual(l.rails[2], ['xu1/xs1', 'xu1/xs2']);
  const root = l.items.get('')!, xu1 = l.items.get('xu1')!, xu2 = l.items.get('xu2')!;
  assert.equal(xu1.sliver, false);
  assert.equal(xu1.w, CTX_W);                            // context card, not full width
  assert.equal(xu2.sliver, true);
  assert.equal(xu2.w, SLIVER_W);
  // every open ancestor is centered — a straight vertical spine
  assert.equal(root.x + CTX_W / 2, l.width / 2);
  assert.equal(xu1.x + CTX_W / 2, l.width / 2);
  assert.equal(xu2.x, xu1.x + CTX_W + GAP);              // first sibling right of the spine
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

test('the strongest frontier block sits exactly on the spine', () => {
  const m = buildHybridModel(fanDesign(3));
  const first = (a: string, b: string) => (a === 'xm1' ? -1 : b === 'xm1' ? 1 : a.localeCompare(b));
  const l = computeRails(m, [''], first);
  const it = l.items.get('xm1')!;
  assert.equal(it.x + it.w / 2, l.width / 2);
});

test('fullW callback sizes FRONTIER boxes only; context and slivers stay fixed', () => {
  const m = buildHybridModel(tinyDesign());
  const l = computeRails(m, ['', 'xu1'], undefined, () => 100);
  assert.equal(l.items.get('xu1/xs1')!.w, 100);          // frontier obeys fullW
  assert.equal(l.items.get('xu1')!.w, CTX_W);            // open ancestor is compressed
  assert.equal(l.items.get('xu2')!.w, SLIVER_W);
});

test('visiblePaths matches the laid-out set when nothing is hidden or truncated', () => {
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

test('0-dev/0-net leaves are dropped from the rails and counted as hidden', () => {
  const cells = new Map<string, Cell>();
  cells.set('HTOP', cell('HTOP', ['in', 'vdd', 'vss'], [
    ['XR', 'RCELL', { a: 'in', vdd: 'vdd', vss: 'vss' }],
    ['XC0', 'mnoscap', { p: 'in', q: 'vss' }],           // unresolved master → 0 dev / 0 net
    ['XC1', 'mnoscap', { p: 'in', q: 'vss' }],
  ], []));
  cells.set('RCELL', cell('RCELL', ['a', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 'a'], ['g', 'a'], ['s', 'vss'], ['b', 'vss']]],
  ]));
  const m = buildHybridModel({ cells, topCell: 'HTOP', warnings: [] });
  const l = computeRails(m, ['']);
  assert.deepEqual(l.rails[1], ['xr']);
  assert.ok(!l.items.has('xc0'));
  assert.deepEqual(l.hidden, [0, 2]);
  // footer semantics unchanged: hidden leaves still belong to the open level
  assert.ok(visiblePaths(m, ['']).includes('xc0'));
});

test('context slivers cap per side; the overflow becomes +N stubs', () => {
  // xm0 gets a child so it can be the open chain's tail
  const design = fanDesign(12);
  design.cells.set('LEAF0', cell('LEAF0', ['a', 'vdd', 'vss'], [
    ['XI', 'LEAF1', { a: 'a', vdd: 'vdd', vss: 'vss' }],
  ], []));
  const m = buildHybridModel(design);
  const l = computeRails(m, ['', 'xm0']);
  const slivers = [...l.items.values()].filter(it => it.lvl === 1 && it.sliver);
  assert.equal(slivers.length, 8);                       // 4 per side
  assert.deepEqual(l.stubs.map(s => s.count).sort(), [1, 2]); // 11 siblings − 8 shown
  assert.ok(l.stubs.every(s => s.lvl === 1));
  const open = l.items.get('xm0')!;
  assert.equal(open.x + CTX_W / 2, l.width / 2);         // stubs don't push the spine
});

test('a wide frontier wraps into centered rows', () => {
  const m = buildHybridModel(fanDesign(20));
  const l = computeRails(m, ['']);
  assert.equal(l.rowsAt[1], 4);                          // 6 × 150 + gaps per row
  const items = [...l.items.values()].filter(it => it.lvl === 1);
  assert.equal(items.length, 20);
  assert.deepEqual([...new Set(items.map(it => it.row))].sort(), [0, 1, 2, 3]);
  // every row is centered on the spine (within one card of dead center)
  for (const r of [0, 1, 2, 3]) {
    const row = items.filter(it => it.row === r);
    const min = Math.min(...row.map(it => it.x)), max = Math.max(...row.map(it => it.x + it.w));
    assert.ok(Math.abs((min + max) / 2 - l.width / 2) < 1);
  }
});
