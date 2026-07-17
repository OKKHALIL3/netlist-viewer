import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { buildSearchIndex, buildOccurrenceCounts } from './searchIndex';
import { matchIndex } from '../chat/queries/match';
import { buildViewerSections, type ViewerRowsOpts } from './viewerRows';

function setup(query: string, opts: Partial<ViewerRowsOpts> = {}) {
  const design = tinyDesign();
  const matches = matchIndex(buildSearchIndex(design), query);
  const counts = buildOccurrenceCounts(design);
  return buildViewerSections(design, matches, counts, {
    activeViewer: 'schematic',
    hybridEnabled: true,
    layoutEnabled: true,
    layoutNets: null,
    layoutInstances: null,
    ...opts,
  });
}

test('active viewer section comes first', () => {
  const schemFirst = setup('xu1');
  assert.equal(schemFirst[0].viewer, 'schematic');
  const hybridFirst = setup('xu1', { activeViewer: 'hybrid' });
  assert.equal(hybridFirst[0].viewer, 'hybrid');
});

test('hybrid section carries only instances and cells', () => {
  const sections = setup('mid'); // a net
  const hybrid = sections.find(s => s.viewer === 'hybrid');
  assert.equal(hybrid, undefined, 'net-only match has no hybrid section');
  const sections2 = setup('xu');
  const hybrid2 = sections2.find(s => s.viewer === 'hybrid');
  assert.ok(hybrid2 && hybrid2.entries.every(e => e.type !== 'occ' || e.result.kind === 'instance' || e.result.kind === 'cell'));
});

test('layout section requires physical presence per occurrence', () => {
  const present = setup('mid', { layoutNets: new Set(['mid']), layoutInstances: new Set() });
  const layout = present.find(s => s.viewer === 'layout');
  assert.ok(layout, 'physical net appears in the layout section');
  const absent = setup('out', { layoutNets: new Set(['mid']), layoutInstances: new Set() });
  assert.equal(absent.find(s => s.viewer === 'layout'), undefined, 'non-physical net has no layout row');
});

test('layout section omitted entirely without a DSPF', () => {
  const sections = setup('xu1', { layoutNets: null, layoutInstances: null });
  assert.equal(sections.find(s => s.viewer === 'layout'), undefined);
});

test('hybrid disabled (public build) hides the hybrid section', () => {
  const sections = setup('xu1', { hybridEnabled: false });
  assert.deepEqual(sections.map(s => s.viewer), ['schematic']);
});

test('per-section caps bound the clickable rows', () => {
  const sections = setup('m', { activeCap: 2, otherCap: 1 });
  const schem = sections.find(s => s.viewer === 'schematic')!;
  assert.ok(schem.entries.filter(e => e.type === 'occ').length <= 2);
});

test('scoped layout instance keys match normalized slash paths', () => {
  const sections = setup('xs2', {
    activeViewer: 'layout',
    layoutNets: new Set<string>(),
    layoutInstances: new Set(['xu1/xs2']),
  });
  const layout = sections.find(s => s.viewer === 'layout');
  assert.ok(layout, 'nested instance present in layout');
  const occ = layout!.entries.find(e => e.type === 'occ');
  assert.ok(occ && occ.type === 'occ' && occ.result.id === 'XS2');
});

test('active viewer splits: this level first, then rest of the design', () => {
  const sections = setup('m', { currentCell: 'STG' }); // M1/M2 in STG, M1/R1 in DIV, net mid in TOP
  assert.equal(sections[0].viewer, 'schematic');
  assert.equal(sections[0].scope, 'level');
  assert.equal(sections[0].levelName, 'STG');
  const levelCells = sections[0].entries.filter(e => e.type === 'occ').map(e => e.type === 'occ' ? e.result.cellName : '');
  assert.ok(levelCells.every(c => c === 'STG'), `level rows stay in STG: ${levelCells}`);
  assert.equal(sections[1].scope, 'rest');
  const restRows = sections[1].entries.filter(e => e.type === 'occ');
  assert.ok(restRows.some(e => e.type === 'occ' && e.result.cellName !== 'STG'));
});

test('the on-screen occurrence ranks first within the level', () => {
  // STG is instantiated twice inside AMP (XS1, XS2); user stands in XS2.
  const sections = setup('m1', {
    currentCell: 'STG',
    currentPathLabels: ['TOP', 'XU1', 'XS2'],
  });
  const level = sections.find(s => s.scope === 'level')!;
  const first = level.entries.find(e => e.type === 'occ');
  assert.ok(first && first.type === 'occ');
  if (first && first.type === 'occ') {
    assert.deepEqual(first.path.map(p => p.label), ['TOP', 'XU1', 'XS2']);
  }
});

test('no currentCell means no split (single all-scope active section)', () => {
  const sections = setup('m');
  assert.equal(sections[0].scope, 'all');
  assert.ok(sections.every(s => s.scope === 'all'));
});
