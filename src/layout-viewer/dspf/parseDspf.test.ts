import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDspf } from './parseDspf';

test('reads divider/delimiter from header, defaults when absent', () => {
  const withHeader = parseDspf('*|DIVIDER |\n*|DELIMITER :\n');
  assert.equal(withHeader.divider, '|');
  assert.equal(withHeader.delimiter, ':');
  const noHeader = parseDspf('* nothing\n');
  assert.equal(noHeader.divider, '/');
  assert.equal(noHeader.delimiter, ':');
});

test('collects subnode coords per net from *|S', () => {
  const text = [
    '*|DIVIDER /',
    '*|DELIMITER :',
    '*|NET VOUTP 1.0',
    '*|S (VOUTP:1 9.94 3.81)',
    '*|S (VOUTP:2 18.69 12.86)',
  ].join('\n');
  const d = parseDspf(text);
  assert.equal(d.nets.length, 1);
  assert.equal(d.nets[0].name, 'VOUTP');
  assert.deepEqual(d.nets[0].subnodes, [
    { name: 'VOUTP:1', x: 9.94, y: 3.81 },
    { name: 'VOUTP:2', x: 18.69, y: 12.86 },
  ]);
});

test('*|I with coords yields a device; *|I without coords does not', () => {
  const text = [
    '*|NET N 1',
    '*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)',
    '*|I (X100/M2:g X100/M2 g pch 0.5)',
  ].join('\n');
  const d = parseDspf(text);
  assert.deepEqual(d.devices, [{ path: 'X100/M1', x: 3.99, y: 8.33 }]);
});

test('counts parasitics and collects layers from R lines', () => {
  const text = [
    '*|NET N 1',
    '*|S (N:1 0 0)',
    '*|S (N:2 1 1)',
    'R1 N:1 N:2 12.3 $layer=metal3',
    'C1 N:1 0 0.5',
  ].join('\n');
  const d = parseDspf(text);
  assert.equal(d.nets[0].parasitics, 2);          // 1 R + 1 C
  assert.equal(d.nets[0].resistors.length, 1);
  assert.equal(d.nets[0].resistors[0].layer, 'metal3');
  assert.equal(d.layersPresent, true);
  assert.deepEqual(d.layers, ['metal3']);
});

test('no $layer= anywhere ⇒ layersPresent false, layers []', () => {
  const d = parseDspf('*|NET N 1\nR1 N:1 N:2 5\n');
  assert.equal(d.layersPresent, false);
  assert.deepEqual(d.layers, []);
  assert.equal(d.nets[0].resistors[0].layer, null);
});

test('devices fall back to *|S names when no *|I has coords', () => {
  const text = [
    '*|DELIMITER :',
    '*|NET N 1',
    '*|S (X9/X26/M1:s 4 5)',
    '*|I (X9/X26/M1:g X9/X26/M1 g nch 0.5)',  // no coords
  ].join('\n');
  const d = parseDspf(text);
  assert.deepEqual(d.devices, [{ path: 'X9/X26/M1', x: 4, y: 5 }]);
});
