import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDspf } from './parseDspf';

test('header divider/delimiter parsed; defaults when absent', () => {
  const withHeader = parseDspf('*|DIVIDER |\n*|DELIMITER #\n');
  assert.equal(withHeader.divider, '|');
  assert.equal(withHeader.delimiter, '#');
  const noHeader = parseDspf('* nothing\n');
  assert.equal(noHeader.divider, '/');
  assert.equal(noHeader.delimiter, ':');
});

test('net subnodes capture coords; *|I with coords yields a device, without does not', () => {
  const d = parseDspf([
    '*|NET VOUTP 1.0',
    '*|S (VOUTP:1 9.94 3.81)',
    '*|S (VOUTP:2 18.69 12.86)',
    '*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)',
    '*|I (X100/M2:g X100/M2 g pch 0.5)',
  ].join('\n'));
  assert.equal(d.nets.length, 1);
  assert.equal(d.nets[0].subnodes.length, 2);
  assert.deepEqual([d.nets[0].subnodes[0].x, d.nets[0].subnodes[0].y], [9.94, 3.81]);
  assert.deepEqual(d.devices, [{ path: 'X100/M1', x: 3.99, y: 8.33 }]);
});

test('resistor geometry + $layer captured; layers collected', () => {
  const d = parseDspf([
    '*|NET N 1',
    '*|S (N:1 0 0)', '*|S (N:2 1 1)',
    'R1 N:1 N:2 12.3 $layer=metal3 $X=0 $Y=0 $X2=1 $Y2=1',
    'C1 N:1 0 0.5f',
  ].join('\n'));
  const r = d.nets[0].resistors[0];
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 1, 1]);
  assert.equal(r.layer, 'metal3');
  assert.deepEqual(d.layers, ['metal3']);
  assert.equal(d.layersPresent, true);
  assert.equal(d.diagnostics.resistorsWithGeometry, 1);
  assert.equal(d.diagnostics.capacitors, 1);
});

test('$lvl resolves through the *N layer map', () => {
  const d = parseDspf([
    '*5 metal3',
    '*|NET N 1',
    '*|S (N:1 0 0)', '*|S (N:2 1 1)',
    'R1 N:1 N:2 1 $lvl=5',
  ].join('\n'));
  assert.equal(d.nets[0].resistors[0].layer, 'metal3');
  assert.deepEqual(d.layers, ['metal3']);
});

test('+ continuation across an *|I line is parsed', () => {
  const d = parseDspf([
    '*|NET N 1',
    '*|I (X1/M1:d X1/M1',
    '+    d nch 0.5 4 5)',
  ].join('\n'));
  assert.deepEqual(d.devices, [{ path: 'X1/M1', x: 4, y: 5 }]);
});

test('no $layer anywhere ⇒ layersPresent false, layers []', () => {
  const d = parseDspf('*|NET N 1\n*|S (N:1 0 0)\nR1 N:1 N:2 5\n');
  assert.equal(d.layersPresent, false);
  assert.deepEqual(d.layers, []);
});

test('devices fall back to *|S names when no *|I has coords (CLKGEN)', () => {
  const d = parseDspf([
    '*|DELIMITER :',
    '*|NET N 1',
    '*|S (X9/X26/M1:s 4 5)',
    '*|I (X9/X26/M1:g X9/X26/M1 g nch 0.5)',
  ].join('\n'));
  assert.deepEqual(d.devices, [{ path: 'X9/X26/M1', x: 4, y: 5 }]);
});

test('meters coordinates are auto-scaled to microns', () => {
  const d = parseDspf([
    '*|NET N 1',
    '*|S (N:1 1.322e-6 0.7e-6)',
    '*|S (N:2 1.347e-6 0.945e-6)',
  ].join('\n'));
  assert.equal(d.diagnostics.unitScale, 1e6);
  assert.equal(d.nets[0].subnodes[0].x, 1.322);
  assert.equal(d.nets[0].subnodes[0].y, 0.7);
});

test('opts.unitScale overrides inference', () => {
  const d = parseDspf('*|NET N 1\n*|S (N:1 2 4)\n', { unitScale: 1 });
  assert.equal(d.nets[0].subnodes[0].x, 2);
});

test('coupling capacitor flagged; ground net + design captured', () => {
  const d = parseDspf([
    '*|DESIGN "TOP"',
    '*|GROUND_NET VSS',
    '*|NET N 1',
    '*|S (N:1 0 0)',
    'C7 N:1 VCLK:3 0.02f',
  ].join('\n'));
  assert.equal(d.design, 'TOP');
  assert.deepEqual(d.groundNets, ['VSS']);
  assert.equal(d.nets[0].capacitors[0].coupling, true);
  assert.equal(d.diagnostics.couplingCaps, 1);
});

test('capacitor coords participate in unit inference', () => {
  const d = parseDspf('*|NET N 1\nC1 N:1 0 1f $X=1e-6 $Y=2e-6\n');
  assert.equal(d.diagnostics.unitScale, 1e6);
  assert.equal(d.nets[0].capacitors[0].x, 1);
  assert.equal(d.nets[0].capacitors[0].y, 2);
});
