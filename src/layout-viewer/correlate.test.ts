import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normSegments, enumerateHierarchy, correlate } from './correlate';
import { makeDesign } from './__fixtures__/fixtures';
import { parseDspf } from './dspf/parseDspf';

test('normSegments lowercases, splits on separators, strips fingers', () => {
  assert.deepEqual(normSegments('X100/X55/M1', ['/', ':']), ['x100', 'x55', 'm1']);
  assert.deepEqual(normSegments('X9|X26|M1<@3>', ['|', ':']), ['x9', 'x26', 'm1']);
  assert.deepEqual(normSegments('A:b@2', [':']), ['a', 'b']);
});

test('enumerateHierarchy walks the instance tree with depths', () => {
  const design = makeDesign('TOP', {
    TOP: [['XI9', 'SGL'], ['XI10', 'SGL']],
    SGL: [['XI26', 'INBUF']],
    INBUF: [],
  });
  const nodes = enumerateHierarchy(design);
  const byId = Object.fromEntries(nodes.map(n => [n.id, n.depth]));
  assert.equal(byId[''], 0);
  assert.equal(byId['xi9'], 1);
  assert.equal(byId['xi10'], 1);
  assert.equal(byId['xi9/xi26'], 2);
  assert.equal(byId['xi10/xi26'], 2);
  assert.equal(nodes.find(n => n.id === 'xi9/xi26')?.label, 'XI26');
});

test('correlate computes instance + net boxes, connections, stats', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|DIVIDER /', '*|DELIMITER :',
    '*|NET VOUT 1',
    '*|S (X9/M1:o 4 5)',
    '*|S (X9/M2:o 8 9)',
    'R1 X9/M1:o X9/M2:o 1 $layer=metal2',
    '*|I (X9/M1:d X9/M1 d nch 0.5 4 5)',
    '*|I (X9/M2:d X9/M2 d nch 0.5 8 9)',
  ].join('\n'));

  const m = correlate(design, dspf);

  const x9 = m.instances.find(i => i.id === 'x9')!;
  assert.deepEqual(x9.bbox, [4, 5, 8, 9]);
  assert.equal(x9.deviceCount, 2);
  assert.equal(x9.depth, 1);

  const root = m.instances.find(i => i.id === '')!;
  assert.deepEqual(root.bbox, [4, 5, 8, 9]);

  const net = m.nets.find(n => n.name === 'VOUT')!;
  assert.deepEqual(net.bbox, [4, 5, 8, 9]);
  assert.equal(net.subnodes, 2);
  assert.deepEqual(net.layers, ['metal2']);
  assert.ok(net.instances.includes('x9'));

  assert.deepEqual(m.connections, [{ net: 'VOUT', layer: 'metal2', points: [[4, 5], [8, 9]] }]);
  assert.deepEqual(m.extent, [4, 5, 8, 9]);
  assert.equal(m.layers.length, 1);
  assert.equal(m.stats.devicesMatched, 2);
  assert.equal(m.stats.instancesMatched, 1);
});

test('no-layer DSPF ⇒ layers [], connection layer null', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|NET N 1', '*|S (X9/M1:o 0 0)', '*|S (X9/M2:o 2 2)',
    'R1 X9/M1:o X9/M2:o 1',
    '*|I (X9/M1:d X9/M1 d nch 0.5 0 0)',
  ].join('\n'));
  const m = correlate(design, dspf);
  assert.deepEqual(m.layers, []);
  assert.equal(m.connections[0].layer, null);
});

test('connections use resistor slab geometry when present', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|NET VOUT 1',
    '*|S (X9/M1:o 4 5)', '*|S (X9/M2:o 8 9)',
    'R1 X9/M1:o X9/M2:o 1 $layer=metal2 $X=4 $Y=5 $X2=8 $Y2=9',
    '*|I (X9/M1:d X9/M1 d nch 0.5 4 5)',
  ].join('\n'));
  const m = correlate(design, dspf);
  assert.deepEqual(m.connections, [{ net: 'VOUT', layer: 'metal2', points: [[4, 5], [8, 9]] }]);
  assert.equal(m.diagnostics.resistorsWithGeometry, 1);
});

test('net layers gather from subnode + resistor + coupling cap', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*3 m1', '*5 m3',
    '*|NET N 1',
    '*|S (X9/M1:o $lvl=3 0 0)', '*|S (X9/M2:o 2 2)',
    'R1 X9/M1:o X9/M2:o 1 $lvl=5',
    '*|I (X9/M1:d X9/M1 d nch 0.5 0 0)',
  ].join('\n'));
  const m = correlate(design, dspf);
  const net = m.nets.find(n => n.name === 'N')!;
  assert.deepEqual(net.layers.sort(), ['m1', 'm3']);
});
