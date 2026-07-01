import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResistor, parseCapacitor, parseDeviceStatement, type ResolveLayer } from './elements';
import { splitTokens } from './tokens';

const direct: ResolveLayer = (p) => p.get('layer') ?? null;

test('parseResistor reads nodes, value, layer, slab geometry', () => {
  const r = parseResistor(
    splitTokens('rnet8|6 net8:9 net8:11 0.322765 $w=0.05 $l=0.0353553 $layer=M1 $X=1.322 $Y=0.7 $X2=1.347 $Y2=0.945'),
    direct,
  )!;
  assert.equal(r.name, 'rnet8|6');
  assert.equal(r.a, 'net8:9');
  assert.equal(r.b, 'net8:11');
  assert.equal(r.value, 0.322765);
  assert.equal(r.layer, 'M1');
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [1.322, 0.7, 1.347, 0.945]);
  assert.equal(r.width, 0.05);
});

test('parseResistor with no geometry → null coords, still valid', () => {
  const r = parseResistor(splitTokens('R1 a b 1'), direct)!;
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [null, null, null, null]);
  assert.equal(r.layer, null);
});

test('parseCapacitor: grounded vs coupling', () => {
  const grounded = parseCapacitor(splitTokens('C1 VOUTP:1 0 0.5f'), direct)!;
  assert.equal(grounded.coupling, false);
  assert.equal(grounded.value, 0.5e-15);
  const coupling = parseCapacitor(splitTokens('C7 VOUTP:1 VCLK:3 0.02f'), direct)!;
  assert.equal(coupling.coupling, true);
  assert.equal(coupling.b, 'VCLK:3');
});

test('resolveLayer maps $lvl through a provided map', () => {
  const map = new Map([['5', 'metal3']]);
  const viaLvl: ResolveLayer = (p) => p.get('layer') ?? (p.get('lvl') ? map.get(p.get('lvl')!) ?? null : null);
  const r = parseResistor(splitTokens('R2 a b 1 $lvl=5'), viaLvl)!;
  assert.equal(r.layer, 'metal3');
});

test('bare $flags on R lines are tolerated (Quantus $active)', () => {
  const r = parseResistor(splitTokens('Reb_2_B6000 AVRH#1 AVRH#3 0.0001 $active $W=0.006'), direct)!;
  assert.equal(r.a, 'AVRH#1');
  assert.equal(r.b, 'AVRH#3');
  assert.equal(r.value, 0.0001);
  assert.equal(r.width, 0.006);
});

test('R value accepts engineering suffix', () => {
  const r = parseResistor(splitTokens('R1 a b 1.5k'), direct)!;
  assert.equal(r.value, 1500);
});

test('device statement: name, nodes, trailing model, params skipped', () => {
  const dev = parseDeviceStatement(splitTokens('D60_unmatched D60_unmatched#POS D60_unmatched#NEG nwdio AREA=4.7e-12 PJ=1.1e-05'))!;
  assert.equal(dev.name, 'D60_unmatched');
  assert.deepEqual(dev.nodes, ['D60_unmatched#POS', 'D60_unmatched#NEG']);
  assert.equal(dev.model, 'nwdio');
});

test('device statement with a single positional token has no model', () => {
  const dev = parseDeviceStatement(splitTokens('M1 M1#d'))!;
  assert.equal(dev.name, 'M1');
  assert.deepEqual(dev.nodes, ['M1#d']);
  assert.equal(dev.model, null);
});
