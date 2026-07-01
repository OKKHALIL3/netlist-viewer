import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickInstance, pickNetBox } from './pick';
import type { LayoutModel, Bbox } from '../../layout-viewer/model';

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

test('pickNetBox hits only near the box edge, not deep inside', () => {
  const nets = [{ name: 'N', bbox: [0, 0, 10, 10] as Bbox }];
  assert.equal(pickNetBox(nets, 0.1, 5, 0.5), 'N');    // near left edge
  assert.equal(pickNetBox(nets, 5, 5, 0.5), null);     // center — not a hit
  assert.equal(pickNetBox(nets, 10.4, 5, 0.5), 'N');   // just outside right edge
  assert.equal(pickNetBox(nets, 20, 5, 0.5), null);    // far away
  assert.equal(pickNetBox(nets, 5, 9.8, 0.5), 'N');    // near top edge
});

test('pickNetBox checks boxes in order (first shown wins)', () => {
  const nets = [
    { name: 'A', bbox: [0, 0, 10, 10] as Bbox },
    { name: 'B', bbox: [0, 0, 10.2, 10] as Bbox },
  ];
  assert.equal(pickNetBox(nets, 10.1, 5, 0.5), 'A');
});
