import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickInstance } from './pick';
import type { LayoutModel } from '../../layout-viewer/model';

const model = {
  instances: [
    { id: '', label: 'TOP', depth: 0, deviceCount: 9, bbox: [0, 0, 10, 10] },
    { id: 'x9', label: 'X9', depth: 1, deviceCount: 4, bbox: [0, 0, 5, 5] },
    { id: 'x9/m1', label: 'M1', depth: 2, deviceCount: 1, bbox: [1, 1, 2, 2] },
  ],
} as unknown as LayoutModel;

test('returns the smallest box at/under depth that contains the point', () => {
  assert.equal(pickInstance(model, 2, 1.5, 1.5), 'x9/m1');
  assert.equal(pickInstance(model, 1, 1.5, 1.5), 'x9');   // m1 hidden at depth 1
  assert.equal(pickInstance(model, 1, 9, 9), '');          // only root contains it
  assert.equal(pickInstance(model, 2, 20, 20), null);      // outside everything
});
