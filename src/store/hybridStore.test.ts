import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { useHybridStore, passesFilters } from './hybridStore';

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
