import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { useHybridStore } from './hybridStore';

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
