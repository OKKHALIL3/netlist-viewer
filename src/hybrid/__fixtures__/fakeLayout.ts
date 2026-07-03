import type { LayoutData, LayoutModel, DspfNet } from '../../layout-viewer/model';

export function dnet(name: string, r: number, c: number, coupling: Array<[string, number]>): DspfNet {
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

export function fakeLayout(): { data: LayoutData; lm: LayoutModel } {
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
