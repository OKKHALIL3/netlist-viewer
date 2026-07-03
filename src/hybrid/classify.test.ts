import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { ruleClassifier, classifyModel, saveOverride, TAXONOMY, UNCLASSIFIED } from './classify';

test('taxonomy matches spec v1 exactly', () => {
  assert.equal(TAXONOMY.A.length, 10);
  assert.equal(TAXONOMY.D.length, 8);
  assert.equal(TAXONOMY.AMS.length, 8);
  assert.ok(TAXONOMY.AMS.includes('IO'));
  assert.ok(TAXONOMY.A.includes('REF/BIAS'));
});

test('name rules classify reference-design cell names', () => {
  const c = ruleClassifier();
  assert.equal(c.classify('hpio_iobuf_pair_itop', undefined), 'AMS:IO');  // spec policy: IO under AMS
  assert.equal(c.classify('obuf_pslew', undefined), 'AMS:IO');
  assert.equal(c.classify('std_inv_hv', undefined), 'D:LOGIC');
  assert.equal(c.classify('glitch_filter', undefined), 'D:CLK');          // spec: glitch filters → D:CLK
  assert.equal(c.classify('osc_bias_core', undefined), 'A:OSC');          // first match wins (osc before bias)
  assert.equal(c.classify('tia_stage1', undefined), 'A:AMP');
  assert.equal(c.classify('sense_amp_ff', undefined), 'A:AMP');
  assert.equal(c.classify('totally_novel_cell', undefined), null);
});

test('classifyModel: overrides beat rules; unknown lands Unclassified', () => {
  const d = tinyDesign();
  const m = buildHybridModel(d);
  classifyModel(m, d, 'tiny');
  assert.equal(m.blocks.get('xu1')!.category, 'A:AMP');       // 'AMP' name rule
  assert.equal(m.blocks.get('xu2')!.category, 'D:CLK');       // 'DIV' → div rule
  assert.equal(m.blocks.get('xu1/xs1')!.category, UNCLASSIFIED); // 'STG' matches nothing
  saveOverride('tiny', 'STG', 'A:AMP');
  classifyModel(m, d, 'tiny');
  assert.equal(m.blocks.get('xu1/xs1')!.category, 'A:AMP');
  saveOverride('tiny', 'STG', null);                          // remove override
});
