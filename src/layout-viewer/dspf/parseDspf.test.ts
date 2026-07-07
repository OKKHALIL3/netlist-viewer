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

test('tab-separated header (Calibre xACT) is parsed', () => {
  const d = parseDspf([
    '*|DSPF\t1.5',
    '*|DESIGN\tX327T0408',
    '*|DIVIDER\t|',
    '*|DELIMITER\t:',
    '*|GROUND_NET\t0',
  ].join('\n'));
  assert.equal(d.divider, '|');
  assert.equal(d.delimiter, ':');
  assert.equal(d.design, 'X327T0408');
  assert.deepEqual(d.groundNets, ['0']);
  assert.equal(d.diagnostics.unrecognized, 0);
});

test('warns when the DSPF carries no coordinates', () => {
  const d = parseDspf('*|NET N 1\nC1 N:1 0 1f\n');
  assert.equal(d.diagnostics.pointsWithCoords, 0);
  assert.ok(d.diagnostics.warnings.some(w => /coordinate/i.test(w)),
    `expected a no-coordinate warning, got ${JSON.stringify(d.diagnostics.warnings)}`);
});

test('net subnodes capture coords; *|I with coords yields a point, identity either way', () => {
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
  assert.deepEqual(d.devicePoints, [{ path: 'X100/M1', x: 3.99, y: 8.33 }]);
  // BOTH devices exist as identities — the coordinate-less one still maps nets to blocks.
  assert.deepEqual(d.devices.map(x => x.path).sort(), ['X100/M1', 'X100/M2']);
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
  assert.deepEqual(d.devicePoints, [{ path: 'X1/M1', x: 4, y: 5 }]);
});

test('no $layer anywhere ⇒ layersPresent false, layers []', () => {
  const d = parseDspf('*|NET N 1\n*|S (N:1 0 0)\nR1 N:1 N:2 5\n');
  assert.equal(d.layersPresent, false);
  assert.deepEqual(d.layers, []);
});

test('device points fall back to *|S names when no *|I has coords (CLKGEN)', () => {
  const d = parseDspf([
    '*|DELIMITER :',
    '*|NET N 1',
    '*|S (X9/X26/M1:s 4 5)',
    '*|I (X9/X26/M1:g X9/X26/M1 g nch 0.5)',
  ].join('\n'));
  assert.deepEqual(d.devicePoints, [{ path: 'X9/X26/M1', x: 4, y: 5 }]);
  assert.deepEqual(d.devices.map(x => x.path), ['X9/X26/M1']);
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

// ── Task 3 additions: full header/net-section coverage ─────────────────────

test('net totalCap parses engineering suffixes (xACT)', () => {
  const d = parseDspf('*|DELIMITER :\n*|NET N1 0.259853f\n*|S (N1:1 1.0 2.0)\n');
  assert.equal(d.nets[0].totalCap, 0.259853e-15);
});

test('GROUND_NET marks nets, accepts multiple names, ghosts unsectioned ones', () => {
  const d = parseDspf('*|GROUND_NET GND VSS2\n*|NET GND 1e-15\n*|S (GND:1 0 0)\n');
  assert.deepEqual(d.groundNets, ['GND', 'VSS2']);
  assert.equal(d.nets.find(n => n.name === 'GND')!.isGround, true);
  // VSS2 never had a section — it still exists as a record
  assert.equal(d.nets.find(n => n.name === 'VSS2')!.isGround, true);
});

test('GROUND_NET declared AFTER the net section still marks it', () => {
  const d = parseDspf('*|NET G 1e-15\n*|S (G:1 0 0)\n*|GROUND_NET G\n');
  assert.equal(d.nets.find(n => n.name === 'G')!.isGround, true);
  assert.equal(d.nets.length, 1);
});

test('DeviceFingerDelim is read and unquoted', () => {
  const d = parseDspf('*|DeviceFingerDelim "@"\n');
  assert.equal(d.fingerDelim, '@');
});

test('duplicate *|NET sections merge', () => {
  const d = parseDspf('*|NET A 1e-15\n*|S (A:1 0 0)\n*|NET A 1e-15\n*|S (A:2 1 1)\n');
  assert.equal(d.nets.length, 1);
  assert.equal(d.nets[0].subnodes.length, 2);
  assert.equal(d.diagnostics.netsMerged, 1);
});

test('*|I captures instance identity even with no coords (xACT)', () => {
  const d = parseDspf('*|DIVIDER |\n*|DELIMITER :\n*|NET X1|n 1f\n*|I (X1|M3:g X1|M3 g B 0.0)\n');
  const ip = d.nets[0].instPins[0];
  assert.equal(ip.inst, 'X1|M3');
  assert.equal(ip.pin, 'g');
  assert.equal(ip.pinType, 'B');
  assert.equal(ip.x, null);
});

test('*|P captures pinType and cap, with and without coords', () => {
  const d = parseDspf('*|NET A 1f\n*|P (A X 0 2.07 0.21)\n*|P (B I 0.0)\n');
  assert.equal(d.nets[0].ports[0].pinType, 'X');
  assert.equal(d.nets[0].ports[0].cap, 0);
  assert.deepEqual([d.nets[0].ports[0].x, d.nets[0].ports[0].y], [2.07, 0.21]);
  assert.equal(d.nets[0].ports[1].pinType, 'I');
  assert.equal(d.nets[0].ports[1].x, null);
  assert.equal(d.diagnostics.ports, 2);
});

test('.SUBCKT records top cell name and ports (case-insensitive keyword)', () => {
  const d = parseDspf('.subckt StrongARMLatch1  VDD VOUTN GND\n*|NET A 1f\n');
  assert.equal(d.topCellName, 'StrongARMLatch1');
  assert.deepEqual(d.topPorts, ['VDD', 'VOUTN', 'GND']);
});

test('unique devices dedupe from *|I; pin points stay per-pin', () => {
  const d = parseDspf([
    '*|DELIMITER :', '*|NET N 1f',
    '*|I (M1:d M1 d B 0 1 1)', '*|I (M1:g M1 g B 0 2 2)', '*|I (M2:d M2 d B 0 3 3)',
  ].join('\n'));
  assert.equal(d.devices.length, 2);
  assert.equal(d.devicePoints.length, 3);
  assert.equal(d.diagnostics.devices, 2);
  assert.equal(d.diagnostics.devicePinPoints, 3);
  assert.equal(d.devices.find(x => x.path === 'M1')!.pins, 2);
});

test('global node-coordinate index covers ports, subnodes, inst pins', () => {
  const d = parseDspf('*|NET A 1f\n*|P (A X 0 5 6)\n*|S (A:1 7 8)\n*|I (M1:d M1 d B 0 9 10)\n');
  assert.deepEqual(d.nodeCoord.get('A'), [5, 6]);
  assert.deepEqual(d.nodeCoord.get('A:1'), [7, 8]);
  assert.deepEqual(d.nodeCoord.get('M1:d'), [9, 10]);
});

test('nodeCoord values are unit-scaled with everything else', () => {
  const d = parseDspf('*|NET N 1\n*|S (N:1 1.322e-6 0.7e-6)\n*|S (N:2 1.347e-6 0.945e-6)\n');
  assert.equal(d.diagnostics.unitScale, 1e6);
  assert.deepEqual(d.nodeCoord.get('N:1'), [1.322, 0.7]);
});

test('quoted *|NET names are unquoted', () => {
  const d = parseDspf('*|NET "N1" 1e-15\n*|S (N1:1 0 0)\n');
  assert.equal(d.nets[0].name, 'N1');
});

// ── Task 4 additions: elements + instance-section devices ──────────────────

test('coupling cap = b node on a foreign net; ground/same-net caps are not coupling', () => {
  const d = parseDspf([
    '*|DELIMITER :', '*|GROUND_NET 0', '*|NET A 1f', '*|S (A:1 0 0)',
    'C1 A:1 0 1f',        // ground cap
    'C2 A:1 A:2 1f',      // same-net cap
    'C3 A:1 B:9 1f',      // coupling to net B
  ].join('\n'));
  const caps = d.nets[0].capacitors;
  assert.deepEqual(caps.map(c => c.coupling), [false, false, true]);
  assert.equal(d.diagnostics.couplingCaps, 1);
});

test('caps to a declared ground net are not coupling (Quantus CB to 0-style)', () => {
  const d = parseDspf([
    '*|DELIMITER #', '*|GROUND_NET GNDX', '*|NET A 1f', '*|S (A#1 0 0)',
    'Cg1 A#1 GNDX 1f',
  ].join('\n'));
  assert.equal(d.nets[0].capacitors[0].coupling, false);
  assert.equal(d.diagnostics.couplingCaps, 0);
});

test('caps to a ground-net subnode are not coupling', () => {
  const d = parseDspf([
    '*|DELIMITER :', '*|GROUND_NET VSS', '*|NET A 1f', '*|S (A:1 0 0)',
    'C1 A:1 VSS:88 0.05f',    // cap to a ground SUBNODE, not the bare ground node
  ].join('\n'));
  assert.equal(d.nets[0].capacitors[0].coupling, false);
  assert.equal(d.diagnostics.couplingCaps, 0);
});

test('native R/C device cards are counted as devices, not net parasitics', () => {
  const d = parseDspf([
    '*|NET N 1f',
    'R1 N:1 N:2 1.5',                    // a real parasitic (numeric value)
    'C1 N:1 N:3 0.5f',                   // a real parasitic (suffixed value)
    '*Instance Section',
    'RBIAS n1 n2 rppolywo w=1u l=5u',    // a poly-resistor DEVICE (model in value slot)
    'CDECAP n3 n4 mimcap',               // a MIM-cap DEVICE
  ].join('\n'));
  assert.equal(d.nets[0].resistors.length, 1, 'only the real parasitic R stays on the net');
  assert.equal(d.nets[0].capacitors.length, 1, 'only the real parasitic C stays on the net');
  assert.ok(d.devices.find(x => x.path === 'RBIAS'), 'RBIAS counted as a device');
  assert.ok(d.devices.find(x => x.path === 'CDECAP'), 'CDECAP counted as a device');
});

test('instance-section devices merge into the device list with models', () => {
  const d = parseDspf([
    '*|DELIMITER #', '*|NET N 1f', '*|I (M7#d M7 d B 0 1 2)',
    '*Instance Section',
    'M7 M7#d M7#g nch_mac l=6e-9',
    'D60 D60#POS D60#NEG nwdio AREA=1',
  ].join('\n'));
  assert.equal(d.devices.length, 2);
  assert.equal(d.devices.find(x => x.path === 'M7')!.model, 'nch_mac');
  assert.equal(d.devices.find(x => x.path === 'D60')!.model, 'nwdio');
});

test('TAB-delimited instance lines with continuations parse (Quantus)', () => {
  const d = parseDspf([
    '*|NET N 1f',
    'D61_unmatched\tD61_unmatched#POS\tD61_unmatched#NEG\tnwdio',
    '+ AREA=4.69526e-12\tPJ=1.1028e-05',
  ].join('\n'));
  assert.equal(d.devices.find(x => x.path === 'D61_unmatched')!.model, 'nwdio');
});
