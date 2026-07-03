import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { attachLayoutStats } from './layoutStats';
import type { LayoutData, LayoutModel, DspfNet } from '../layout-viewer/model';

function dnet(name: string, r: number, c: number, coupling: Array<[string, number]>): DspfNet {
  return {
    name, totalCap: null, isGround: false, ports: [], subnodes: [], instPins: [],
    resistors: Array.from({ length: r }, (_, i) => ({
      name: `R${i}`, a: `${name}:1`, b: `${name}:2`, value: 1, layer: null,
      x1: null, y1: null, x2: null, y2: null, width: null, length: null,
    })),
    capacitors: [
      ...Array.from({ length: c }, (_, i) => ({
        name: `C${i}`, a: `${name}:1`, b: '0', value: 1e-15, layer: null, x: null, y: null, coupling: false,
      })),
      ...coupling.map(([other, v], i) => ({
        name: `CC${i}`, a: `${name}:1`, b: other, value: v, layer: null, x: null, y: null, coupling: true,
      })),
    ],
  };
}

function fakeLayout(): { data: LayoutData; lm: LayoutModel } {
  // net 'in' touches xu1; 'mid' touches xu1+xu2; coupling 2fF between them.
  const nets = [dnet('in', 3, 2, [['mid:1', 2e-15]]), dnet('mid', 5, 1, [])];
  const data = {
    divider: '/', delimiter: ':', busDelimiter: null, fingerDelim: null,
    groundNets: ['vss'], design: null, generator: null, topCellName: 'TOP', topPorts: [],
    layerMap: {}, layersPresent: false, layers: [], nets,
    devicePoints: [], devices: [], nodeCoord: new Map(), diagnostics: {} as LayoutData['diagnostics'],
  } as LayoutData;
  const lm = {
    nets: [
      { name: 'in', instances: ['xu1'] },
      { name: 'mid', instances: ['xu1', 'xu2'] },
    ],
  } as unknown as LayoutModel;
  return { data, lm };
}

test('attaches per-block R/C/coupling with ancestor rollup', () => {
  const m = buildHybridModel(tinyDesign());
  const { data, lm } = fakeLayout();
  const pairs = attachLayoutStats(m, data, lm);
  assert.equal(m.hasLayout, true);
  assert.equal(m.blocks.get('xu1')!.parasiticR, 8);       // in(3) + mid(5)
  assert.equal(m.blocks.get('xu2')!.parasiticR, 5);       // mid only
  assert.equal(m.blocks.get('')!.parasiticR, 8);          // root sees all (dedup)
  assert.equal(m.blocks.get('xu1')!.parasiticC, 3);       // ground caps: 2 + 1
  assert.equal(m.blocks.get('xu1')!.couplingC, 2e-15);    // one coupling cap counted once
  assert.equal(m.blocks.get('xu2')!.couplingC, 2e-15);    // other side of the same cap
  assert.equal(m.blocks.get('xu1/xs1')!.parasiticR, 0);   // in scope but owns nothing
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].cap, 2e-15);
});
