import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import { arrayedDesign } from './__fixtures__/arrayed';
import { dnet } from './__fixtures__/fakeLayout';
import { cell } from './__fixtures__/tiny';
import type { Design } from '../parser/types';
import { buildHybridModel, displayPath, subtreeDepth } from './model';
import { computeSlots } from './slots';
import { buildConductors, traceConnectivity } from './connectivity';
import { findPath } from './path';
import { relatedDisplay } from './coupling';
import { attachLayoutStats } from './layoutStats';
import { criticalityScores } from './criticality';

test('indexed same-master siblings fold into one array group', () => {
  const m = buildHybridModel(arrayedDesign());
  assert.deepEqual(m.blocks.get('')!.children, ['xa<2:0>', 'xs', 'xt']);
  const g = m.blocks.get('xa<2:0>')!;
  assert.deepEqual(g.members, ['xa<0>', 'xa<1>', 'xa<2>']);
  assert.equal(g.label, 'XA<2:0>');
  assert.equal(g.master, 'ACELL');
  assert.equal(g.depth, 1);
  assert.equal(g.parent, '');
  // stats are summed over members: footer totals unchanged by collapsing
  assert.equal(g.devices, 9);        // 3 × (1 + 2×1)
  assert.equal(g.pins, 12);          // 3 × 4 ports
  assert.equal(g.netCount, 15);      // 3 × 5 ACELL nets
  // members keep their real blocks and point back at the group
  assert.equal(m.blocks.get('xa<1>')!.groupOf, 'xa<2:0>');
  assert.equal(m.blocks.get('xa<1>')!.devices, 3);
  // real tree is untouched underneath
  assert.equal(m.maxDepth, 2);
  assert.deepEqual(m.levelNetCounts, [7, 24, 24]);
});

test('nested arrays fold too, and the group displays its representative subtree', () => {
  const m = buildHybridModel(arrayedDesign());
  const g = m.blocks.get('xa<2:0>')!;
  assert.deepEqual(g.children, ['xa<0>/xb<1:0>']);
  const nested = m.blocks.get('xa<0>/xb<1:0>')!;
  assert.deepEqual(nested.members, ['xa<0>/xb<0>', 'xa<0>/xb<1>']);
  assert.equal(nested.label, 'XB<1:0>');
  assert.equal(nested.devices, 2);
});

test('displayPath maps members, member subtrees, and identities', () => {
  const m = buildHybridModel(arrayedDesign());
  assert.equal(displayPath(m, ''), '');
  assert.equal(displayPath(m, 'xs'), 'xs');
  assert.equal(displayPath(m, 'xa<2:0>'), 'xa<2:0>');
  assert.equal(displayPath(m, 'xa<1>'), 'xa<2:0>');
  // a path THROUGH a member lands on the structural twin under the representative
  assert.equal(displayPath(m, 'xa<1>/xb<0>'), 'xa<0>/xb<1:0>');
  assert.equal(displayPath(m, 'xa<0>/xb<1>'), 'xa<0>/xb<1:0>');
});

test('slots lay out groups instead of members', () => {
  const m = buildHybridModel(arrayedDesign());
  const { slot } = computeSlots(m, '', 3);
  assert.ok(slot.has('xa<2:0>'));
  assert.ok(slot.has('xa<0>/xb<1:0>'));
  assert.ok(slot.has('xs') && slot.has('xt'));
  assert.ok(!slot.has('xa<1>'));
  assert.ok(!slot.has('xa<0>/xb<0>'));
});

test('trace collapses hit members onto their group', () => {
  const design = arrayedDesign();
  const m = buildHybridModel(design);
  const cond = buildConductors(design, m);
  // XT rides bus<2>, which XA<2> drives — the hit shows as the array group
  const t = traceConnectivity(design, m, cond, 'xt');
  assert.deepEqual([...t.blocks].sort(), ['xa<0>/xb<1:0>', 'xa<2:0>', 'xs']);
});

test('trace from a group seeds from EVERY member, not just the representative', () => {
  const design = arrayedDesign();
  const m = buildHybridModel(design);
  const cond = buildConductors(design, m);
  const t = traceConnectivity(design, m, cond, 'xa<2:0>');
  // xt is reachable only through member xa<2> (bus<2>) — rep-only seeding would miss it
  assert.ok(t.blocks.has('xt'));
  assert.ok(t.blocks.has('xs'));
  // the group itself and its members never appear in their own trace
  assert.ok(!t.blocks.has('xa<2:0>'));
  assert.ok(!t.blocks.has('xa<2>'));
});

test('findPath accepts group pins and returns display-mapped blocks', () => {
  const design = arrayedDesign();
  const m = buildHybridModel(design);
  const cond = buildConductors(design, m);
  const r = findPath(design, m, cond, { block: 'xa<2:0>', pin: 'a' }, { block: 'xt', pin: 't' });
  assert.ok(r);
  assert.deepEqual(r.blocks, ['xa<2:0>', 'xt']);
  assert.equal(r.netCount, 2); // in → bus<2>
});

test('relatedDisplay treats a group as all of its members', () => {
  const m = buildHybridModel(arrayedDesign());
  assert.ok(relatedDisplay(m, 'xa<2:0>', 'xa<1>'));
  assert.ok(relatedDisplay(m, 'xa<2:0>', 'xa<0>/xb<1:0>')); // group vs displayed rep subtree
  assert.ok(relatedDisplay(m, 'xs', 'xs'));
  assert.ok(!relatedDisplay(m, 'xa<2:0>', 'xs'));
});

test('group label keeps original case even when instance ids carry finger suffixes', () => {
  const cells = new Map();
  cells.set('FTOP', cell('FTOP', ['vdd', 'vss'], [
    ['XF<0>@1', 'FC', { p: 'vdd', q: 'vss' }],
    ['XF<1>@1', 'FC', { p: 'vdd', q: 'vss' }],
  ], []));
  cells.set('FC', cell('FC', ['p', 'q'], [], [['M1', 'M', 'nch', [['d', 'p'], ['g', 'p'], ['s', 'q'], ['b', 'q']]]]));
  const m = buildHybridModel({ cells, topCell: 'FTOP', warnings: [] } as Design);
  const g = m.blocks.get('xf<1:0>')!;
  assert.ok(g);
  assert.equal(g.label, 'XF<1:0>'); // not the lowercase path fallback
});

test('criticality scores cover display blocks only (hidden groups excluded)', () => {
  const m = buildHybridModel(arrayedDesign());
  const scores = criticalityScores(m, [0.3, 0.2, 0.3, 0.2]);
  assert.ok(scores.has('xa<2:0>'));
  assert.ok(scores.has('xa<0>/xb<1:0>'));       // displayed nested group
  assert.ok(!scores.has('xa<1>/xb<1:0>'));      // hidden twin under a non-rep member
  assert.ok(!scores.has('xa<1>'));              // members aren't ranked either
});

test('subtreeDepth reflects the display subtree, not the design', () => {
  const m = buildHybridModel(arrayedDesign());
  assert.equal(subtreeDepth(m, ''), 2);
  assert.equal(subtreeDepth(m, 'xa<2:0>'), 1);
  assert.equal(subtreeDepth(m, 'xs'), 0);
});

test('layout stats reach array groups as the union over members', () => {
  const m = buildHybridModel(arrayedDesign());
  const nets = [dnet('n1', 2, 1, []), dnet('n2', 1, 0, [])];
  const data = {
    divider: '/', delimiter: ':', busDelimiter: null, fingerDelim: null,
    groundNets: [], design: null, generator: null, topCellName: 'TOP', topPorts: [],
    layerMap: {}, layersPresent: false, layers: [], nets,
    devicePoints: [], devices: [], nodeCoord: new Map(), diagnostics: {} as LayoutData['diagnostics'],
  } as LayoutData;
  const lm = {
    nets: [
      { name: 'n1', instances: ['xa<1>'] },          // a non-representative member
      { name: 'n2', instances: ['xa<1>/xb<0>'] },    // deep inside that member
    ],
  } as unknown as LayoutModel;
  attachLayoutStats(m, data, lm);
  const g = m.blocks.get('xa<2:0>')!;
  assert.deepEqual([...g.dspfNets!].sort(), [0, 1]);
  assert.equal(g.parasiticR, 3);  // 2 + 1
  assert.equal(g.parasiticC, 1);
  // the DISPLAYED nested group belongs to the representative subtree — xa<1>'s
  // nets do not leak into it (drill-in shows one element's stats)
  assert.equal(m.blocks.get('xa<0>/xb<1:0>')!.parasiticR, 0);
});
