import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { buildConductors, traceConnectivity } from './connectivity';

const setup = () => {
  const d = tinyDesign();
  const m = buildHybridModel(d);
  return { d, m, c: buildConductors(d, m) };
};

test('conductors merge across boundaries; supplies form no conductor', () => {
  const { c } = setup();
  // C(in): TOP.in ~ AMP.a ~ STG.g(xs1)
  const cin = c.idOf.get('|in')!;
  assert.equal(c.idOf.get('xu1|a'), cin);
  assert.equal(c.idOf.get('xu1/xs1|g'), cin);
  // C(mid): TOP.mid ~ AMP.z(xu1) ~ STG.d(xs2) ~ DIV.a(xu2)
  const cmid = c.idOf.get('|mid')!;
  assert.equal(c.idOf.get('xu1|z'), cmid);
  assert.equal(c.idOf.get('xu1/xs2|d'), cmid);
  assert.equal(c.idOf.get('xu2|a'), cmid);
  // vdd/vss excluded everywhere
  assert.equal(c.idOf.has('|vdd'), false);
  assert.equal(c.idOf.has('xu1|vss'), false);
});

test('hand-verified net 1: trace from xu1 reaches across and down', () => {
  const { d, m, c } = setup();
  const r = traceConnectivity(d, m, c, 'xu1');
  // in→xs1, mid→{xu2, xs2}; ancestors and self excluded
  assert.deepEqual([...r.blocks].sort(), ['xu1/xs1', 'xu1/xs2', 'xu2'].sort());
  assert.equal(r.levelsCrossed, 2); // depths 1 and 2
  assert.deepEqual(r.byLevel.get(1), ['xu2']);
});

test('hand-verified net 2: trace from a leaf ascends through parent boundary', () => {
  const { d, m, c } = setup();
  const r = traceConnectivity(d, m, c, 'xu1/xs2');
  // xs2 pins: g→C(n1)→{xs1}; d→C(mid)→{xu2} — xu1 is an ANCESTOR of the
  // selection (it contains xs2) so it is excluded, like the selection itself.
  assert.deepEqual([...r.blocks].sort(), ['xu1/xs1', 'xu2'].sort());
});

test('hand-verified net 3: supply exclusion keeps vdd out of every trace', () => {
  const { d, m, c } = setup();
  const r = traceConnectivity(d, m, c, 'xu2');
  assert.ok(r.nets.every(n => n.net !== 'vdd' && n.net !== 'vss'));
  // xu2 pins a,z (vdd/vss dead): a→C(mid)→{xu1, xs2}; z→C(out)→{}
  assert.deepEqual([...r.blocks].sort(), ['xu1', 'xu1/xs2'].sort());
});
