import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Design, Cell } from '../parser/types';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { arrayedDesign } from '../hybrid/__fixtures__/arrayed';
import { cell } from '../hybrid/__fixtures__/tiny';
import { useHybridStore, passesFilters, layersFor } from './hybridStore';
import type { PathResult } from '../hybrid/path';

const s = () => useHybridStore.getState();

// two non-leaf siblings — branch-switch coverage that tiny (one non-leaf) can't give
function twinDesign(): Design {
  const cells = new Map<string, Cell>();
  cells.set('T2', cell('T2', ['in', 'out', 'vdd', 'vss'], [
    ['XA', 'AMP2', { a: 'in', z: 'mid', vdd: 'vdd', vss: 'vss' }],
    ['XB', 'AMP2', { a: 'mid', z: 'out', vdd: 'vdd', vss: 'vss' }],
  ], []));
  cells.set('AMP2', cell('AMP2', ['a', 'z', 'vdd', 'vss'], [
    ['XS1', 'STG2', { g: 'a', d: 'z', vdd: 'vdd', vss: 'vss' }],
  ], []));
  cells.set('STG2', cell('STG2', ['g', 'd', 'vdd', 'vss'], [
    ['XM', 'UNIT2', { g: 'g', d: 'd', vdd: 'vdd', vss: 'vss' }],
  ], []));
  cells.set('UNIT2', cell('UNIT2', ['g', 'd', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 'd'], ['g', 'g'], ['s', 'vss'], ['b', 'vss']]],
  ]));
  return { cells, topCell: 'T2', warnings: [] };
}

test('build populates model and resets navigation to the closed top box', () => {
  s().build(tinyDesign(), null, null);
  assert.ok(s().model);
  assert.deepEqual(s().openPath, []);
});

test('toggleOpen opens the level below, toggles closed, ignores leaves', () => {
  s().build(tinyDesign(), null, null);
  s().toggleOpen('');                        // regression: double-click the top block
  assert.deepEqual(s().openPath, ['']);      // children now on rail 1, top box stays
  s().toggleOpen('xu1');                     // regression: children open BELOW xu1
  assert.deepEqual(s().openPath, ['', 'xu1']);
  s().toggleOpen('xu1');                     // toggle shut
  assert.deepEqual(s().openPath, ['']);
  s().toggleOpen('xu1');
  s().toggleOpen('xu2');                     // leaf — nothing underneath → no-op
  assert.deepEqual(s().openPath, ['', 'xu1']);
  s().toggleOpen('');                        // closing an open ancestor collapses its chain
  assert.deepEqual(s().openPath, []);
});

test('toggleOpen on a closed sibling switches the branch at that level', () => {
  s().build(twinDesign(), null, null);
  s().toggleOpen('');
  s().toggleOpen('xa');
  assert.deepEqual(s().openPath, ['', 'xa']);
  s().toggleOpen('xb');                      // double-click the sliver beside the open block
  assert.deepEqual(s().openPath, ['', 'xb']); // branch switched, old branch collapsed
});

test('toggleOpen on a deep closed block opens the FULL ancestor trail', () => {
  s().build(twinDesign(), null, null);
  s().toggleOpen('xa/xs1');                  // straight from the closed top view
  assert.deepEqual(s().openPath, ['', 'xa', 'xa/xs1']);
});

test('navigation clears selection and overlays', () => {
  s().build(tinyDesign(), null, null);
  s().select('xu1');
  s().toggleOpen('xu1');
  assert.deepEqual(s().openPath, ['', 'xu1']);
  assert.equal(s().selected, null);           // clear-on-navigation rule
  s().select('xu1/xs1');
  s().goToCrumb(0);
  assert.deepEqual(s().openPath, ['']);
  assert.equal(s().selected, null);
});

test('drillDown opens down to the block; a leaf opens to its parent', () => {
  s().build(tinyDesign(), null, null);
  s().drillDown('xu1');                      // tree-panel double-click
  assert.deepEqual(s().openPath, ['', 'xu1']);
  s().drillDown('xu1');                      // idempotent — no duplicate levels
  assert.deepEqual(s().openPath, ['', 'xu1']);
  s().drillDown('xu1/xs1');                  // leaf → parent chain, leaf visible on the frontier
  assert.deepEqual(s().openPath, ['', 'xu1']);
  s().drillDown('');                         // "drill" the root → just the first level open
  assert.deepEqual(s().openPath, ['']);
});

test('goToCrumb collapses everything below the clicked level', () => {
  s().build(twinDesign(), null, null);
  s().drillDown('xa/xs1');
  assert.deepEqual(s().openPath, ['', 'xa', 'xa/xs1']);
  s().goToCrumb(1);
  assert.deepEqual(s().openPath, ['', 'xa']);
  s().goToCrumb(0);
  assert.deepEqual(s().openPath, ['']);
  s().goToCrumb(5);                          // out of range → no-op
  assert.deepEqual(s().openPath, ['']);
});

test('passesFilters: unclassified and domain-less blocks always pass', () => {
  s().build(tinyDesign(), null, null);
  const m = s().model!;
  const xs1 = m.blocks.get('xu1/xs1')!;   // Unclassified
  assert.ok(passesFilters(xs1, new Set(['A:AMP']), new Set()));
  const xu1 = m.blocks.get('xu1')!;       // A:AMP, power domain vdd (vss is not a domain)
  assert.ok(!passesFilters(xu1, new Set(['A:AMP']), new Set()));
  // The map lists POWER rails only, so grounds must not rescue a block whose
  // power rail is unchecked — unchecking vdd dims vdd-domain blocks.
  assert.ok(!passesFilters(xu1, new Set(), new Set(['vdd'])));
  assert.ok(passesFilters(xu1, new Set(), new Set()));
});

test('filters are default-on via disabled-sets', () => {
  s().build(tinyDesign(), null, null);
  assert.equal(s().funcOff.size, 0);
  s().toggleFunc('D:LOGIC');
  assert.ok(s().funcOff.has('D:LOGIC'));
  s().toggleFunc('D:LOGIC');
  assert.ok(!s().funcOff.has('D:LOGIC'));
});

test('select runs trace; navigation clears it', () => {
  s().build(tinyDesign(), null, null);
  s().select('xu1');
  assert.ok(s().trace);
  assert.ok(s().trace!.blocks.has('xu2'));
  s().toggleOpen('xu1');
  assert.equal(s().trace, null);
  s().select(null);
  assert.equal(s().trace, null);
});

test('path pins run findPath; navigation clears result', () => {
  s().build(tinyDesign(), null, null);
  s().togglePathMode();
  s().setPathPins('xu1/xs1:d', 'xu2:z');
  assert.equal(s().pathResult!.netCount, 3);
  s().toggleOpen('');
  assert.equal(s().pathResult, null);
  s().setPathPins('xu1:vdd', 'xu2:a');   // supply pin → explicit no-path
  assert.equal(s().pathResult, null);
  s().togglePathMode();
});

test('coupling: defaults and toggles', () => {
  s().build(tinyDesign(), null, null);
  assert.deepEqual(s().coupling, { on: false, minC: 1e-15, includeSupply: false });
  s().toggleCoupling();
  assert.equal(s().coupling.on, true);
  s().setCouplingMinC(2e-15);
  assert.equal(s().coupling.minC, 2e-15);
  s().toggleCouplingSupply();
  assert.equal(s().coupling.includeSupply, true);
});

test('layersFor normalizes conductor net names the same way netLayers keys were built', () => {
  // netLayers keys come from normSegments (normSeg per '/'-segment on the DSPF
  // side): lowercase, finger suffixes stripped.
  const netLayers = new Map([['xi1/net5', ['M2', 'M3']]]);
  const pr = (netNames: string[]): PathResult => ({ blocks: [], conductors: [], netCount: netNames.length, netNames });
  assert.deepEqual(layersFor(pr(['XI1/net5']), netLayers), ['M2', 'M3']);      // case mismatch
  assert.deepEqual(layersFor(pr(['xi1/net5@2']), netLayers), ['M2', 'M3']);    // finger suffix
  assert.equal(layersFor(pr(['xi1/net6']), netLayers), null);                 // genuinely absent → unavailable
  assert.equal(layersFor(pr(['xi1/net5']), null), null);                      // no DSPF → unavailable
});

test('path pins resolve display-cased input and expose display-mapped ends', () => {
  s().build(tinyDesign(), null, null);
  s().togglePathMode();
  s().setPathPins('XU1/XS1:D', 'XU2:Z');   // typed as displayed — not normalized
  assert.equal(s().pathResult!.netCount, 3);
  assert.deepEqual(s().pathEnds, [{ block: 'xu1/xs1', pin: 'd' }, { block: 'xu2', pin: 'z' }]);
  s().setPathPins('XU1/XS1:D', 'XU2:');    // partial second pin — no error state, no result
  assert.equal(s().pathResult, null);
  assert.equal(s().pathPinsValid, false);
  s().togglePathMode();
});

test('path through an array member surfaces its group at the endpoints', () => {
  s().build(arrayedDesign(), null, null);
  s().togglePathMode();
  s().setPathPins('XA<1>:a', 'XT:t');      // start pin typed on a NON-representative member
  assert.ok(s().pathResult);
  assert.equal(s().pathResult!.blocks[0], 'xa<2:0>'); // member never leaks into the display list
  assert.equal(s().pathEnds![0].block, 'xa<2:0>');
  s().togglePathMode();
});

test('jumpTo opens the trail to the parent, selects, and traces (search jump)', () => {
  s().build(tinyDesign(), null, null);
  s().jumpTo(['XU1', 'XS2']);
  assert.deepEqual(s().openPath, ['', 'xu1']);   // target visible on xu1's rail
  assert.equal(s().selected, 'xu1/xs2');
  assert.ok(s().trace);
  s().jumpTo(['XU2']);                       // top-level target → root open, target on rail 1
  assert.deepEqual(s().openPath, ['']);
  assert.equal(s().selected, 'xu2');
  s().jumpTo(['XU1', 'NOPE']);               // unknown path → no-op, state kept
  assert.equal(s().selected, 'xu2');
});

test('jumpTo lands on the array group when the target is a member', () => {
  s().build(arrayedDesign(), null, null);
  s().jumpTo(['XA<1>', 'XB<0>']);            // deep inside a non-representative member
  assert.equal(s().selected, 'xa<0>/xb<1:0>'); // structural twin under the representative
  assert.deepEqual(s().openPath, ['', 'xa<2:0>']);
  s().jumpTo(['XA<2>']);                     // the member itself → its group
  assert.equal(s().selected, 'xa<2:0>');
  assert.deepEqual(s().openPath, ['']);
});

test('toggleGroup expands the ×N group into members and folds them back', () => {
  s().build(arrayedDesign(), null, null);
  s().toggleOpen('');
  const v0 = s().version;
  s().toggleGroup('xa<2:0>');
  assert.deepEqual(s().model!.blocks.get('')!.children, ['xa<0>', 'xa<1>', 'xa<2>', 'xs', 'xt']);
  assert.ok(s().version > v0);              // canvas/panels re-derive from the swapped tree
  assert.deepEqual(s().openPath, ['']);     // rail intact — the group itself wasn't open
  s().toggleOpen('xa<1>');                  // members are real blocks: open one
  assert.deepEqual(s().openPath, ['', 'xa<1>']);
  s().toggleGroup('xa<2:0>');               // folding away the open member truncates the chain
  assert.deepEqual(s().openPath, ['']);
  assert.deepEqual(s().model!.blocks.get('')!.children, ['xa<2:0>', 'xs', 'xt']);
});

test('build is a no-op on identical design/layoutData/layoutModel references; a new design still resets', () => {
  const design = tinyDesign();
  s().build(design, null, null);
  s().toggleOpen('');
  s().toggleOpen('xu1');
  assert.deepEqual(s().openPath, ['', 'xu1']);

  s().build(design, null, null);           // same references — HybridViewer remount, e.g. a mode switch
  assert.deepEqual(s().openPath, ['', 'xu1']); // navigation preserved, not reset

  s().build(tinyDesign(), null, null);      // a genuinely new design object
  assert.deepEqual(s().openPath, []);       // resets as before
});
