import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, Primitive } from '../parser/types';
import { detectDeviceStructures } from './deviceStructures';

// Minimal cell fixture: MOSFETs as [id, model, d, g, s], with net kinds
// declared for rails; every other net defaults to signal.
function cell(
  devices: Array<[string, string, string, string, string]>,
  rails: Record<string, 'power' | 'ground'> = { vdd: 'power', vss: 'ground' },
  ports: string[] = [],
): { c: Cell; prims: Primitive[] } {
  const nets = new Set<string>();
  const prims: Primitive[] = devices.map(([id, model, d, g, s]) => {
    for (const n of [d, g, s]) nets.add(n);
    return {
      id, kind: 'M', model,
      terms: [['d', d], ['g', g], ['s', s], ['b', s]],
      params: { l: '20n', nfin: '12' },
    } as unknown as Primitive;
  });
  const c = {
    name: 'test',
    ports: ports.map(name => ({ name, dir: 'I' })),
    nets: [...nets].map(name => ({ name, kind: rails[name] ?? 'signal', endpoints: [] })),
    instances: [],
    primitives: prims,
  } as unknown as Cell;
  return { c, prims };
}

const byTag = (st: ReturnType<typeof detectDeviceStructures>, tag: string) =>
  st.filter(s => s.id.startsWith(`${tag}:`));

test('detects a differential pair on a common tail, labeled by its gate signals', () => {
  // classic 5T input stage: tail current source + matched pair
  const { c, prims } = cell([
    ['MTAIL', 'nch', 'tail', 'vbias', 'vss'],
    ['M1', 'nch', 'outp', 'vinp', 'tail'],
    ['M2', 'nch', 'outn', 'vinn', 'tail'],
  ]);
  const pairs = byTag(detectDeviceStructures(c, prims), 'pair');
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].memberIds.sort(), ['M1', 'M2']);
  assert.ok(/vinp/.test(pairs[0].label) && /vinn/.test(pairs[0].label),
    `label names the differential signals: ${pairs[0].label}`);
});

test('no differential pair when sources sit on a rail or sizes differ', () => {
  const onRail = cell([
    ['M1', 'nch', 'o1', 'a', 'vss'],
    ['M2', 'nch', 'o2', 'b', 'vss'],
  ]);
  assert.equal(byTag(detectDeviceStructures(onRail.c, onRail.prims), 'pair').length, 0);

  const { c, prims } = cell([
    ['M1', 'nch', 'o1', 'a', 'tail'],
    ['M2', 'nch', 'o2', 'b', 'tail'],
  ]);
  (prims[1] as { params: Record<string, string> }).params = { l: '20n', nfin: '99' };
  assert.equal(byTag(detectDeviceStructures(c, prims), 'pair').length, 0, 'mismatched sizes');
});

test('detects a cross-coupled pair (gates crossed to distinct drains)', () => {
  const { c, prims } = cell([
    ['M15', 'pch', 'voutp', 'voutn', 'vdd'],
    ['M16', 'pch', 'voutn', 'voutp', 'vdd'],
  ]);
  const xc = byTag(detectDeviceStructures(c, prims), 'xc');
  assert.equal(xc.length, 1);
  assert.deepEqual(xc[0].memberIds.sort(), ['M15', 'M16']);
});

test('all-rail dummies aggregate into one group and never form pairs', () => {
  const { c, prims } = cell([
    ['MD1', 'nch', 'vss', 'vss', 'vss'],
    ['MD2', 'nch', 'vss', 'vss', 'vss'],
    ['MD3', 'pch', 'vdd', 'vdd', 'vdd'],
  ]);
  const st = detectDeviceStructures(c, prims);
  const dummies = byTag(st, 'dummy');
  assert.equal(dummies.length, 1);
  assert.equal(dummies[0].memberIds.length, 3);
  assert.equal(byTag(st, 'xc').length, 0, 'degenerate all-rail devices must not cross-couple');
  assert.equal(byTag(st, 'pair').length, 0);
});

test('detects a current mirror anchored by its diode device', () => {
  const { c, prims } = cell([
    ['MDIODE', 'pch', 'nbias', 'nbias', 'vdd'],
    ['MOUT1', 'pch', 'leg1', 'nbias', 'vdd'],
    ['MOUT2', 'pch', 'leg2', 'nbias', 'vdd'],
  ]);
  const mirrors = byTag(detectDeviceStructures(c, prims), 'mirror');
  assert.equal(mirrors.length, 1);
  assert.deepEqual(mirrors[0].memberIds.sort(), ['MDIODE', 'MOUT1', 'MOUT2']);
});

test('shared-gate devices without a diode are not a mirror', () => {
  const { c, prims } = cell([
    ['M1', 'pch', 'leg1', 'en', 'vdd'],
    ['M2', 'pch', 'leg2', 'en', 'vdd'],
  ]);
  assert.equal(byTag(detectDeviceStructures(c, prims), 'mirror').length, 0);
});

test('detects complementary CMOS pairs (shared gate + drain)', () => {
  const { c, prims } = cell([
    ['MN', 'nch', 'out', 'in', 'vss'],
    ['MP', 'pch', 'out', 'in', 'vdd'],
  ]);
  const cmos = byTag(detectDeviceStructures(c, prims), 'cmos');
  assert.equal(cmos.length, 1);
  assert.ok(/in/.test(cmos[0].label) && /out/.test(cmos[0].label));
});

test('detects a series stack through internal two-terminal nets', () => {
  const { c, prims } = cell([
    ['MT', 'pch', 'out', 'en', 'mid1'],
    ['MM', 'pch', 'mid1', 'en', 'mid2'],
    ['MB', 'pch', 'mid2', 'en', 'vdd'],
  ]);
  const stacks = byTag(detectDeviceStructures(c, prims), 'stack');
  assert.equal(stacks.length, 1);
  assert.deepEqual(stacks[0].memberIds.sort(), ['MB', 'MM', 'MT']);
});

test('a chain through a cell port is not an internal stack', () => {
  const { c, prims } = cell(
    [
      ['MT', 'pch', 'out', 'en', 'mid'],
      ['MB', 'pch', 'mid', 'en', 'vdd'],
    ],
    { vdd: 'power', vss: 'ground' },
    ['mid'],                                   // mid is a boundary port
  );
  assert.equal(byTag(detectDeviceStructures(c, prims), 'stack').length, 0);
});

test('each device belongs to at most one structure', () => {
  // the diff pair's devices must not be re-claimed by the cmos/stack passes
  const { c, prims } = cell([
    ['MTAIL', 'nch', 'tail', 'vbias', 'vss'],
    ['M1', 'nch', 'outp', 'vinp', 'tail'],
    ['M2', 'nch', 'outn', 'vinn', 'tail'],
    ['MP1', 'pch', 'outp', 'vinp', 'vdd'],     // shares g+d with M1
  ]);
  const st = detectDeviceStructures(c, prims);
  const seen = new Set<string>();
  for (const s of st) for (const id of s.memberIds) {
    assert.ok(!seen.has(id), `${id} claimed twice`);
    seen.add(id);
  }
  assert.equal(byTag(st, 'pair').length, 1);
});
