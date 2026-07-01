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

test('enumerateHierarchy includes only subckt instances, not primitive devices', () => {
  const design = makeDesign(
    'TOP',
    { TOP: [['X9', 'BLK']], BLK: [] },
    { TOP: ['MM0'], BLK: ['MR1'] },
  );
  const ids = enumerateHierarchy(design).map(n => n.id);
  assert.ok(ids.includes('x9'));
  assert.ok(!ids.includes('mm0'), 'a top-level primitive must not be a node');
  assert.ok(!ids.includes('x9/mr1'), 'a nested primitive must not be a node');
});

test('flat design (only primitives) has no instance boxes; devices are top-level', () => {
  const design = makeDesign('TOP', { TOP: [] }, { TOP: ['MM15', 'MS1'] });
  const dspf = parseDspf([
    '*|NET N 1',
    '*|I (MM15:d MM15 d nch 0.5 4 5)',
    '*|I (MS1:d MS1 d nch 0.5 0 0)',
  ].join('\n'));
  const m = correlate(design, dspf);
  assert.equal(m.instances.filter(i => i.depth >= 1).length, 0, 'no sub-instance boxes');
  // every device accounted for in exactly one category (all top-level here)
  assert.equal(m.stats.devicesTotal, 2);
  assert.equal(m.stats.devicesMatched, 0);
  assert.equal(m.stats.devicesTopLevel, 2);
  assert.equal(m.stats.devicesDummy, 0);
  assert.equal(m.stats.devicesHierMiss, 0);
  // the depth-0 (whole-design) box still spans the devices
  const root = m.instances.find(i => i.id === '')!;
  assert.deepEqual(root.bbox, [0, 0, 4, 5]);
});

test('finger-suffixed instance (XI5@2) still matches its DSPF devices', () => {
  const design = makeDesign('TOP', { TOP: [['XI5@2', 'BLK']], BLK: [] });
  const m = correlate(design, parseDspf('*|NET N 1\n*|I (XI5@2/M1:d XI5@2/M1 d nch 0.5 4 5)\n'));
  assert.ok(m.instances.find(i => i.id === 'xi5'), 'finger-suffixed instance should match');
  assert.equal(m.stats.devicesMatched, 1);
});

test('finger-expanded instances (XI7@1, XI7@2) collapse to one block', () => {
  const design = makeDesign('TOP', { TOP: [['XI7@1', 'BLK'], ['XI7@2', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|NET N 1',
    '*|I (XI7@1/M1:d XI7@1/M1 d nch 0.5 0 0)',
    '*|I (XI7@2/M1:d XI7@2/M1 d nch 0.5 4 4)',
  ].join('\n'));
  const m = correlate(design, dspf);
  const xi7 = m.instances.filter(i => i.id === 'xi7');
  assert.equal(xi7.length, 1);                 // dedup: one block, not two
  assert.deepEqual(xi7[0].bbox, [0, 0, 4, 4]);
  assert.equal(m.stats.instancesTotal, 1);
});

test('categorizes uncorrelated devices into dummy / top-level / hierarchy-miss', () => {
  const design = makeDesign('TOP', { TOP: [['XI1', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|NET N 1',
    '*|I (XI1/M1:d XI1/M1 d nch 0.5 0 0)',            // matched (under XI1)
    '*|I (XI1/M0_unmatched:d XI1/M0_unmatched d nch 0.5 1 1)',  // matched wins over the dummy marker
    '*|I (M9_noxref:d M9_noxref d nch 0.5 2 2)',         // LVS dummy (no schematic xref)
    '*|I (MTOP:d MTOP d nch 0.5 3 3)',              // top-level primitive
    '*|I (XZZ/M1:d XZZ/M1 d nch 0.5 4 4)',            // hierarchy path not in the CDL
  ].join('\n'));
  const m = correlate(design, dspf);
  assert.equal(m.stats.devicesTotal, 5);
  assert.equal(m.stats.devicesMatched, 2);
  assert.equal(m.stats.devicesDummy, 1);
  assert.equal(m.stats.devicesTopLevel, 1);
  assert.equal(m.stats.devicesHierMiss, 1);
});

test('doubled leading X in DSPF paths correlates to the CDL instance (XXI107 → XI107)', () => {
  const design = makeDesign('TOP', { TOP: [['XI107', 'BLK']], BLK: [['XI3', 'SUB']], SUB: [] });
  // The extractor writes the top instance as XXI107 (extra leading X); the
  // deeper segments (XI3, MM1) line up with the CDL.
  const dspf = parseDspf('*|NET N 1\n*|I (XXI107/XI3/MM1:d XXI107/XI3/MM1 d nch 0.5 4 5)\n');
  const m = correlate(design, dspf);
  assert.ok(m.instances.find(i => i.id === 'xi107'), 'XXI107 should map to CDL XI107');
  assert.ok(m.instances.find(i => i.id === 'xi107/xi3'), 'nested XI3 box too');
  assert.equal(m.stats.devicesMatched, 1);
  assert.equal(m.stats.devicesHierMiss, 0);
});

test('the X-collapse fallback only fires on an unmatched path (no double-count)', () => {
  const design = makeDesign('TOP', { TOP: [['XI107', 'BLK']], BLK: [] });
  const m = correlate(design, parseDspf('*|NET N 1\n*|I (XI107/MM1:d XI107/MM1 d nch 0.5 1 1)\n'));
  assert.equal(m.stats.devicesMatched, 1);
  assert.deepEqual(m.instances.find(i => i.id === 'xi107')!.bbox, [1, 1, 1, 1]);
});

test('a genuinely-absent doubled-X path stays a hierarchy-miss (no false match)', () => {
  const design = makeDesign('TOP', { TOP: [['XI107', 'BLK']], BLK: [] });
  const m = correlate(design, parseDspf('*|NET N 1\n*|I (XXZZ/MM1:d XXZZ/MM1 d nch 0.5 2 2)\n'));
  assert.equal(m.stats.devicesMatched, 0);
  assert.equal(m.stats.devicesHierMiss, 1);
});

test('warns about hierarchy-miss devices (naming mismatch), not about dummies', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf('*|NET N 1\n*|I (ZZ/M1:d ZZ/M1 d nch 0.5 4 5)\n');
  const m = correlate(design, dspf);
  assert.equal(m.stats.devicesHierMiss, 1);
  assert.ok(m.warnings.some(w => /mismatch|hierarch/i.test(w)),
    `expected a naming-mismatch warning, got ${JSON.stringify(m.warnings)}`);
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

// ── Task 5 additions: unique devices, identity mapping, physical blocks ────

test('device stats count unique devices, not pin points', () => {
  const design = makeDesign('TOP', { TOP: [['XA', 'LEAF']], LEAF: [] });
  const data = parseDspf([
    '*|DELIMITER :', '*|DIVIDER /', '*|NET N 1f',
    '*|I (XA/M1:d XA/M1 d B 0 1 1)', '*|I (XA/M1:g XA/M1 g B 0 2 2)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.equal(m.stats.devicesUnique, 1);
  assert.equal(m.stats.devicesTotal, 1);
  assert.equal(m.stats.devicesMatched, 1);
  const xa = m.instances.find(i => i.id === 'xa')!;
  assert.equal(xa.deviceCount, 1);
  assert.deepEqual(xa.bbox, [1, 1, 2, 2]); // both pin points still shape the box
});

test('net→instances resolves through *|I inst identity even with no coords', () => {
  const design = makeDesign('TOP', { TOP: [['X1', 'LEAF']], LEAF: [] });
  const data = parseDspf([
    '*|DIVIDER |', '*|DELIMITER :', '*|NET n 1f',
    '*|S (n:1 1 1)', '*|I (X1|M3:g X1|M3 g B 0.0)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.deepEqual(m.nets[0].instances, ['x1']);
});

test('net→instances applies the doubled-X collapse too', () => {
  const design = makeDesign('TOP', { TOP: [['XI107', 'LEAF']], LEAF: [] });
  const data = parseDspf([
    '*|DIVIDER /', '*|DELIMITER #', '*|NET n 1f',
    '*|I (XXI107/MM1#d XXI107/MM1 d B 0 1 1)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.deepEqual(m.nets[0].instances, ['xi107']);
});

test('unmatched multi-segment paths become physical-only blocks', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DIVIDER |', '*|DELIMITER :', '*|NET n 1f',
    '*|I (X100|M0:d X100|M0 d B 0 1 1)', '*|I (X100|M1:d X100|M1 d B 0 2 2)',
  ].join('\n'));
  const m = correlate(design, data);
  const phys = m.instances.filter(i => i.origin === 'dspf');
  assert.equal(phys.length, 1);
  assert.equal(phys[0].label, 'X100');
  assert.equal(phys[0].id, 'dspf:x100');
  assert.equal(phys[0].deviceCount, 2);
  assert.equal(m.stats.physicalBlocks, 1);
  assert.deepEqual(phys[0].bbox, [1, 1, 2, 2]);
  // the net touches the physical block
  assert.deepEqual(m.nets[0].instances, ['dspf:x100']);
});

test('bus-indexed physical families collapse into one block', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DIVIDER |', '*|DELIMITER :', '*|NET n 1f',
    '*|I (XDCAP1[3]|M0:d XDCAP1[3]|M0 d B 0 0 0)',
    '*|I (XDCAP1[7]|M0:d XDCAP1[7]|M0 d B 0 5 5)',
  ].join('\n'));
  const m = correlate(design, data);
  const phys = m.instances.filter(i => i.origin === 'dspf');
  assert.equal(phys.length, 1);
  assert.equal(phys[0].label, 'XDCAP1');
  assert.deepEqual(phys[0].bbox, [0, 0, 5, 5]);
});

test('dummy devices do NOT form physical blocks', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DIVIDER /', '*|DELIMITER #', '*|NET n 1f',
    '*|I (XX9/M0_unmatched#d XX9/M0_unmatched d B 0 1 1)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.equal(m.instances.filter(i => i.origin === 'dspf').length, 0);
});

test('connections resolve endpoints across sections via the global node index', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DELIMITER :', '*|NET A 1f', '*|P (A X 0 5 6)', '*|S (A:1 7 8)',
    'R1 A A:1 10',
  ].join('\n'));
  const m = correlate(design, data);
  assert.deepEqual(m.connections[0].points, [[5, 6], [7, 8]]);
});

test('net enrichment: totalCap, isGround, ports flow through', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf('*|GROUND_NET G\n*|NET G 2f\n*|P (G X 0 1 1)\n');
  const m = correlate(design, data);
  assert.equal(m.nets[0].totalCap, 2e-15);
  assert.equal(m.nets[0].isGround, true);
  assert.equal(m.nets[0].ports, 1);
});

test('CDL instances carry master + origin', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const data = parseDspf('*|NET N 1\n*|I (X9/M1:d X9/M1 d nch 0.5 4 5)\n');
  const m = correlate(design, data);
  const x9 = m.instances.find(i => i.id === 'x9')!;
  assert.equal(x9.master, 'BLK');
  assert.equal(x9.origin, 'cdl');
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
