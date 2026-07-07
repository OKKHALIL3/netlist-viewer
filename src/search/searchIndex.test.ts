import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Design, Cell } from '../parser/types';
import { buildSearchIndex, buildOccurrenceCounts, pathsToCell } from './searchIndex';

const emptyCell = (name: string, instances: Cell['instances'] = []): Cell =>
  ({ name, ports: [], instances, primitives: [], nets: [] });

function design(): Design {
  const cells = new Map<string, Cell>([
    ['TOP', emptyCell('TOP', [{ id: 'XI1', master: 'MID', conn: {}, portMap: [] }])],
    ['MID', emptyCell('MID')],
    ['LIBCELL', emptyCell('LIBCELL')], // defined but never instantiated
  ]);
  return { cells, topCell: 'TOP', warnings: [] };
}

test('buildSearchIndex includes an uninstantiated cell', () => {
  const idx = buildSearchIndex(design());
  assert.ok(idx.some(r => r.kind === 'cell' && r.id === 'LIBCELL'));
});

test('pathsToCell opens an uninstantiated cell as its own root instead of returning nothing', () => {
  const d = design();
  const counts = buildOccurrenceCounts(d);
  const reachable = pathsToCell(d, 'MID', 8, counts);
  assert.equal(reachable.paths.length, 1);          // MID is reachable from TOP
  const orphan = pathsToCell(d, 'LIBCELL', 8, counts);
  assert.equal(orphan.paths.length, 1, 'LIBCELL is searchable as its own root');
  assert.deepEqual(orphan.paths[0], [{ label: 'LIBCELL', cellName: 'LIBCELL' }]);
});
