import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CellView } from '../layout/cellView';
import { computeGroups, groupOfNode, kindOfCategory } from './groups';

// Minimal CellView — computeGroups only reads instances (id, master) and
// primitives (id, kind), so a partial view is enough to exercise the logic.
function view(
  instances: Array<{ id: string; master: string }>,
  primitives: Array<{ id: string; kind: 'M' | 'R' | 'C' }> = [],
): CellView {
  return {
    name: 'test',
    ports: [],
    instances,
    primitives,
    nets: [],
    instancesById: new Map(),
    primitivesById: new Map(),
  } as unknown as CellView;
}

test('kindOfCategory folds the fine taxonomy into display groups', () => {
  assert.equal(kindOfCategory('A:AMP'), 'core');
  assert.equal(kindOfCategory('A:CMP'), 'core');
  assert.equal(kindOfCategory('A:REF/BIAS'), 'bias');
  assert.equal(kindOfCategory('A:PM'), 'bias');
  assert.equal(kindOfCategory('A:PROT'), 'passive');
  assert.equal(kindOfCategory('D:LOGIC'), 'digital');
  assert.equal(kindOfCategory('D:SEQ'), 'digital');
  assert.equal(kindOfCategory('AMS:IO'), 'io');
  assert.equal(kindOfCategory('AMS:PLL'), 'core');   // mixed-signal sits with the core
  assert.equal(kindOfCategory(null), 'other');       // unclassified
});

test('computeGroups clusters sub-blocks by master name', () => {
  const groups = computeGroups(
    view([
      { id: 'XA', master: 'tia_stage1' },     // A:AMP  → core
      { id: 'XB', master: 'diff_amp' },        // A:AMP  → core
      { id: 'XC', master: 'bias_gen' },        // A:REF/BIAS → bias
      { id: 'XD', master: 'std_inv_x2' },      // D:LOGIC → digital
      { id: 'XE', master: 'obuf_pslew' },      // AMS:IO → io
      { id: 'XF', master: 'totally_novel' },   // unclassified → other
    ]),
    null,
  );
  const byKind = new Map(groups.map(g => [g.kind, g.memberIds]));
  assert.deepEqual(byKind.get('core'), ['XA', 'XB']);
  assert.deepEqual(byKind.get('bias'), ['XC']);
  assert.deepEqual(byKind.get('digital'), ['XD']);
  assert.deepEqual(byKind.get('io'), ['XE']);
  assert.deepEqual(byKind.get('other'), ['XF']);
});

test('computeGroups sorts groups left→right (io, bias, core, digital, passive, other)', () => {
  const groups = computeGroups(
    view([
      { id: 'XN', master: 'novel' },        // other
      { id: 'XD', master: 'std_nand' },     // digital
      { id: 'XI', master: 'iobuf_top' },    // io
      { id: 'XC', master: 'amp_core' },     // core
    ]),
    null,
  );
  assert.deepEqual(groups.map(g => g.kind), ['io', 'core', 'digital', 'other']);
});

test('computeGroups routes raw devices: transistors→core, R/C→passive', () => {
  const groups = computeGroups(
    view([], [
      { id: 'M0', kind: 'M' },
      { id: 'M1', kind: 'M' },
      { id: 'R0', kind: 'R' },
      { id: 'C0', kind: 'C' },
    ]),
    null,
  );
  const byKind = new Map(groups.map(g => [g.kind, g.memberIds]));
  assert.deepEqual(byKind.get('core'), ['M0', 'M1']);
  assert.deepEqual(byKind.get('passive'), ['R0', 'C0']);
});

test('computeGroups drops empty groups and labels every group', () => {
  const groups = computeGroups(view([{ id: 'XA', master: 'amp' }]), null);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Analog Core');
});

test('groupOfNode maps each member id back to its group kind', () => {
  const groups = computeGroups(
    view([{ id: 'XA', master: 'amp' }, { id: 'XB', master: 'bias_ref' }]),
    null,
  );
  const map = groupOfNode(groups);
  assert.equal(map.get('XA'), 'core');
  assert.equal(map.get('XB'), 'bias');
});
