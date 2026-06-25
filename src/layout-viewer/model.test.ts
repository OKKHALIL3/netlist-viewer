import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBbox, extendBbox, bboxValid, bboxSize, bboxArea } from './model';
import type { LayoutData } from './model';

test('emptyBbox is invalid until extended', () => {
  const b = emptyBbox();
  assert.equal(bboxValid(b), false);
});

test('extendBbox grows to contain points', () => {
  const b = emptyBbox();
  extendBbox(b, 3, -7.5);
  extendBbox(b, 21.5, 17);
  assert.deepEqual(b, [3, -7.5, 21.5, 17]);
  assert.equal(bboxValid(b), true);
  assert.deepEqual(bboxSize(b), [18.5, 24.5]);
  assert.equal(bboxArea(b), 18.5 * 24.5);
});

test('LayoutData has the rich shape with diagnostics', () => {
  const d: LayoutData = {
    divider: '/', delimiter: ':', busDelimiter: null,
    groundNets: [], design: null, generator: null,
    layerMap: {}, layersPresent: false, layers: [],
    nets: [], devices: [],
    diagnostics: {
      logicalLines: 0, nets: 0, devices: 0, resistors: 0,
      resistorsWithGeometry: 0, capacitors: 0, couplingCaps: 0,
      pointsWithCoords: 0, unitScale: 1, unrecognized: 0, warnings: [],
    },
  };
  assert.equal(d.diagnostics.unitScale, 1);
  assert.equal(emptyBbox().length, 4);
});
