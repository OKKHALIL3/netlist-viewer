import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../hybrid/model';
import { createResolver, crumbsToHybridPath } from './resolve';

function setup() {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  return { design, model, resolver: createResolver(design, model) };
}

test('crumbsToHybridPath drops the top entry and normalizes segments', () => {
  const { model } = setup();
  const path = crumbsToHybridPath(
    [
      { label: 'TOP', cellName: 'TOP' },
      { label: 'XU1', cellName: 'AMP' },
      { label: 'XS2', cellName: 'STG' },
    ],
    model,
  );
  assert.equal(path, 'xu1/xs2');
});

test('cell mention resolves to a cell candidate with occurrences', () => {
  const { resolver } = setup();
  const { candidates } = resolver.resolveEntity('AMP', 'cell');
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.kind, 'cell');
  if (c.kind === 'cell') {
    assert.equal(c.cellName, 'AMP');
    assert.equal(c.total, 1);
    assert.deepEqual(c.occurrences[0].map(p => p.label), ['TOP', 'XU1']);
  }
});

test('instance mention resolves to a block with hybrid path and crumbs', () => {
  const { resolver } = setup();
  const { candidates } = resolver.resolveEntity('XU2', 'block');
  const block = candidates.find(c => c.kind === 'block');
  assert.ok(block && block.kind === 'block');
  if (block && block.kind === 'block') {
    assert.equal(block.hybridPath, 'xu2');
    assert.equal(block.cellName, 'DIV');
    assert.deepEqual(block.crumbs.map(c => c.label), ['TOP', 'XU2']);
  }
});

test('direct slash path resolves without a name match', () => {
  const { resolver } = setup();
  const { candidates } = resolver.resolveEntity('XU1/XS2', 'block');
  const block = candidates.find(c => c.kind === 'block');
  assert.ok(block && block.kind === 'block');
  if (block && block.kind === 'block') {
    assert.equal(block.hybridPath, 'xu1/xs2');
    assert.equal(block.cellName, 'STG');
  }
});

test('category mention finds classified blocks with no name overlap', () => {
  const { model, resolver } = setup();
  model.blocks.get('xu1')!.category = 'AMS:PLL';
  const { candidates } = resolver.resolveEntity('pll', 'block');
  const block = candidates.find(c => c.kind === 'block' && c.hybridPath === 'xu1');
  assert.ok(block, 'expected xu1 via its AMS:PLL category');
});

test('net mention resolves with scopes', () => {
  const { resolver } = setup();
  const { candidates } = resolver.resolveEntity('mid', 'net');
  const net = candidates.find(c => c.kind === 'net');
  assert.ok(net && net.kind === 'net');
  if (net && net.kind === 'net') {
    assert.equal(net.netName, 'mid');
    assert.equal(net.cellName, 'TOP');
    assert.deepEqual(net.scopes, ['']); // lives in the top cell → top scope
  }
});

test('no match returns an explanatory note', () => {
  const { resolver } = setup();
  const res = resolver.resolveEntity('zzz_nothing');
  assert.equal(res.candidates.length, 0);
  assert.ok(res.note?.includes('zzz_nothing'));
});

test('ambiguity is flagged', () => {
  const { resolver } = setup();
  // "M1" exists in both STG and DIV
  const res = resolver.resolveEntity('M1', 'device');
  assert.ok(res.candidates.length > 1);
  assert.ok(res.note?.includes('multiple'));
});
