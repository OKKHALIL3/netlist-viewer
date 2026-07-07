import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitView, worldToScreen, screenToWorld, zoomAt } from './transform';

test('fitView centers the extent and round-trips coords (Y is flipped)', () => {
  const v = fitView([0, 0, 10, 10], 200, 200, 20);
  const [, sy0] = worldToScreen(v, 0, 0);
  const [, sy1] = worldToScreen(v, 0, 10);
  assert.ok(sy0 > sy1, 'higher world Y is higher on screen (smaller sy)');
  const [wx, wy] = screenToWorld(v, ...worldToScreen(v, 4, 6));
  assert.ok(Math.abs(wx - 4) < 1e-9 && Math.abs(wy - 6) < 1e-9);
});

test('fitView never returns a negative scale on a viewport narrower than the padding', () => {
  // 92px viewport with 48px padding → (92 - 96) is negative; a negative scale
  // would mirror the map and invert hit-testing.
  const v = fitView([0, 0, 10, 10], 92, 92, 48);
  assert.ok(v.scale > 0, `scale should stay positive, got ${v.scale}`);
});

test('zoomAt keeps the cursor world point fixed', () => {
  const v = fitView([0, 0, 10, 10], 200, 200, 20);
  const before = screenToWorld(v, 150, 150);
  const z = zoomAt(v, 2, 150, 150);
  const after = screenToWorld(z, 150, 150);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9);
  assert.ok(Math.abs(before[1] - after[1]) < 1e-9);
});
