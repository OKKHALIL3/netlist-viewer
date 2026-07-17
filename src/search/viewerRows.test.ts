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
