import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { arrayedDesign } from '../hybrid/__fixtures__/arrayed';
import { useHybridStore, passesFilters, layersFor } from './hybridStore';
import type { PathResult } from '../hybrid/path';

const s = () => useHybridStore.getState();

test('build populates model and resets navigation', () => {
  s().build(tinyDesign(), null, null);
  assert.ok(s().model);
  assert.equal(s().rootPath, '');
  assert.deepEqual(s().crumbs, ['']);
});

test('drillDown pushes crumb; navigation clears selection', () => {
  s().build(tinyDesign(), null, null);
  s().select('xu1');
  s().drillDown('xu1');
  assert.equal(s().rootPath, 'xu1');
  assert.deepEqual(s().crumbs, ['', 'xu1']);
  assert.equal(s().selected, null);           // clear-on-navigation rule
  s().select('xu1/xs1');
  s().goToCrumb(0);
  assert.equal(s().rootPath, '');
  assert.equal(s().selected, null);
  s().select('xu2');
  s().setDepth(2);
  assert.equal(s().selected, null);
});

test('passesFilters: unclassified and domain-less blocks always pass', () => {
  s().build(tinyDesign(), null, null);
  const m = s().model!;
  const xs1 = m.blocks.get('xu1/xs1')!;   // Unclassified
  assert.ok(passesFilters(xs1, new Set(['A:AMP']), new Set()));
  const xu1 = m.blocks.get('xu1')!;       // A:AMP, domains vdd+vss
  assert.ok(!passesFilters(xu1, new Set(['A:AMP']), new Set()));
  assert.ok(!passesFilters(xu1, new Set(), new Set(['vdd', 'vss'])));
  assert.ok(passesFilters(xu1, new Set(), new Set(['vdd'])));   // one live domain is enough
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
  s().drillDown('xu1');
  assert.equal(s().trace, null);
  s().select(null);
  assert.equal(s().trace, null);
});

test('path pins run findPath; navigation clears result', () => {
  s().build(tinyDesign(), null, null);
  s().togglePathMode();
  s().setPathPins('xu1/xs1:d', 'xu2:z');
  assert.equal(s().pathResult!.netCount, 3);
  s().setDepth(1);
  assert.equal(s().pathResult, null);
  s().setPathPins('xu1:vdd', 'xu2:a');   // supply pin → explicit no-path
  assert.equal(s().pathResult, null);
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

test('drillDown never duplicates crumbs: current root is a no-op, ancestors jump back', () => {
  s().build(tinyDesign(), null, null);
  s().drillDown('');                       // double-click the root row/card — Amr's repeated-crumb bug
  assert.deepEqual(s().crumbs, ['']);
  s().drillDown('xu1');
  s().drillDown('xu1');                    // re-drill the current root — still a no-op
  assert.deepEqual(s().crumbs, ['', 'xu1']);
  assert.equal(s().rootPath, 'xu1');
  s().drillDown('');                       // drill "down" to an ancestor → jump back, not append
  assert.deepEqual(s().crumbs, ['']);
  assert.equal(s().rootPath, '');
});

test('drillDown on a deep block builds the FULL ancestor trail', () => {
  s().build(tinyDesign(), null, null);
  s().drillDown('xu1/xs1');                // tree shows the whole design — deep double-click
  assert.deepEqual(s().crumbs, ['', 'xu1', 'xu1/xs1']); // no skipped levels
  assert.equal(s().rootPath, 'xu1/xs1');
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

test('jumpTo builds the full crumb trail, selects, and traces (search jump)', () => {
  s().build(tinyDesign(), null, null);
  s().jumpTo(['XU1', 'XS2']);
  assert.equal(s().rootPath, 'xu1');
  assert.deepEqual(s().crumbs, ['', 'xu1']);
  assert.equal(s().selected, 'xu1/xs2');
  assert.ok(s().trace);
  s().jumpTo(['XU2']);                       // top-level target → root view
  assert.deepEqual(s().crumbs, ['']);
  assert.equal(s().selected, 'xu2');
  s().jumpTo(['XU1', 'NOPE']);               // unknown path → no-op, state kept
  assert.equal(s().selected, 'xu2');
});

test('jumpTo lands on the array group when the target is a member', () => {
  s().build(arrayedDesign(), null, null);
  s().jumpTo(['XA<1>', 'XB<0>']);            // deep inside a non-representative member
  assert.equal(s().selected, 'xa<0>/xb<1:0>'); // structural twin under the representative
  assert.deepEqual(s().crumbs, ['', 'xa<2:0>']);
  assert.equal(s().rootPath, 'xa<2:0>');
  s().jumpTo(['XA<2>']);                     // the member itself → its group
  assert.equal(s().selected, 'xa<2:0>');
  assert.deepEqual(s().crumbs, ['']);
});

test('build is a no-op on identical design/layoutData/layoutModel references; a new design still resets', () => {
  const design = tinyDesign();
  s().build(design, null, null);
  s().drillDown('xu1');
  assert.equal(s().rootPath, 'xu1');
  assert.deepEqual(s().crumbs, ['', 'xu1']);

  s().build(design, null, null);           // same references — HybridViewer remount, e.g. a mode switch
  assert.equal(s().rootPath, 'xu1');        // navigation preserved, not reset
  assert.deepEqual(s().crumbs, ['', 'xu1']);

  s().build(tinyDesign(), null, null);      // a genuinely new design object
  assert.equal(s().rootPath, '');           // resets as before
  assert.deepEqual(s().crumbs, ['']);
});
