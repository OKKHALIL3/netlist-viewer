import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankBySprawl, reachRatio } from './insights';
import type { LayoutModel } from './model';

const model = {
  instances: [
    { id: 'x1', label: 'X1', depth: 1, deviceCount: 2, bbox: [0, 0, 2, 2] },
    { id: 'x2', label: 'X2', depth: 1, deviceCount: 2, bbox: [10, 0, 12, 2] },
  ],
  nets: [
    // wide net spanning both far-apart blocks
    { name: 'sprawl', bbox: [0, 0, 12, 2], subnodes: 4, parasitics: 6, layers: [], instances: ['x1', 'x2'] },
    // local net inside one block
    { name: 'local', bbox: [0, 0, 2, 2], subnodes: 2, parasitics: 2, layers: [], instances: ['x1'] },
    // degenerate zero-area net — must be skipped
    { name: 'point', bbox: [5, 5, 5, 5], subnodes: 1, parasitics: 0, layers: [], instances: [] },
  ],
} as unknown as LayoutModel;

test('rankBySprawl orders by bbox area and skips zero-area nets', () => {
  const top = rankBySprawl(model, 8);
  assert.deepEqual(top.map(t => t.name), ['sprawl', 'local']); // 'point' dropped
  assert.equal(top[0].area, 24);
  assert.equal(top[1].area, 4);
});

test('reachRatio is large when a net spreads beyond its blocks', () => {
  // sprawl net area 24 vs union of x1+x2 footprint (also 24) ⇒ ~1; but a net
  // touching only x1 (area 4) while spanning 24 reaches 6×.
  assert.ok(reachRatio(model, 'sprawl') >= 1);
  assert.equal(reachRatio(model, 'local'), 1);     // local net == its block
});
