import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign, cell } from '../../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../../hybrid/model';
import { classifyNets, classForDspfName } from './netClass';

test('nets on A:REF/BIAS block pins classify as bias (heuristic)', () => {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  // Pretend AMP is a bias generator: its instances' nets in TOP become bias.
  for (const b of model.blocks.values()) if (b.master === 'AMP') b.category = 'A:REF/BIAS';
  const classes = classifyNets(design, model);
  assert.equal(classes.get('|in'), 'bias');   // touches XU1 (AMP)
  assert.equal(classes.get('|mid'), 'bias');  // touches XU1 too
  assert.equal(classes.get('|out'), 'signal'); // only touches XU2 (DIV, unclassified)
});

test('clock class comes from net names and D:CLK blocks', () => {
  const design = tinyDesign();
  design.cells.set('TOP', cell('TOP', ['ck_in', 'out', 'vdd', 'vss'], [
    ['XU1', 'AMP', { a: 'ck_in', z: 'mid', vdd: 'vdd', vss: 'vss' }],
    ['XU2', 'DIV', { a: 'mid', z: 'out', vdd: 'vdd', vss: 'vss' }],
  ], []));
  const model = buildHybridModel(design);
  for (const b of model.blocks.values()) if (b.master === 'DIV') b.category = 'D:CLK';
  const classes = classifyNets(design, model);
  assert.equal(classes.get('|ck_in'), 'clock'); // by name
  assert.equal(classes.get('|mid'), 'clock');   // touches the D:CLK block
});

test('supply nets carry no class', () => {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  const classes = classifyNets(design, model);
  assert.equal(classes.get('|vdd'), undefined);
  assert.equal(classes.get('|vss'), undefined);
});

test('classForDspfName resolves hierarchical DSPF names to scoped classes', () => {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  for (const b of model.blocks.values()) if (b.master === 'STG') b.category = 'A:REF/BIAS';
  const classes = classifyNets(design, model);
  // AMP's internal net n1 touches XS1/XS2 (STG → bias); DSPF spells it xu1/n1.
  assert.equal(classForDspfName(classes, 'XU1/n1', ['/', ':']), 'bias');
  assert.equal(classForDspfName(classes, 'out', ['/', ':']), 'signal');
  assert.equal(classForDspfName(classes, 'nope/xyz', ['/', ':']), null);
});
