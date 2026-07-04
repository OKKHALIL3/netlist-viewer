import type { Design, Cell } from '../../parser/types';
import { cell } from './tiny';

// Arrayed design for the collapse tests:
//   TOP ── XA<0> XA<1> XA<2> (ACELL)  → folds to xa<2:0> ×3
//        ├─ XS (SINK)  on bus<0..2>   → connected to every array element
//        └─ XT (TCELL) on bus<2> ONLY → proves trace seeds from ALL members,
//                                       not just the representative xa<0>
//   ACELL ── XB<0> XB<1> (BCELL)      → nested fold xa<k>/xb<1:0> ×2
export function arrayedDesign(): Design {
  const cells = new Map<string, Cell>();
  cells.set('TOP', cell('TOP', ['in', 'out', 'vdd', 'vss'], [
    ['XA<0>', 'ACELL', { a: 'in', z: 'bus<0>', vdd: 'vdd', vss: 'vss' }],
    ['XA<1>', 'ACELL', { a: 'in', z: 'bus<1>', vdd: 'vdd', vss: 'vss' }],
    ['XA<2>', 'ACELL', { a: 'in', z: 'bus<2>', vdd: 'vdd', vss: 'vss' }],
    ['XS', 'SINK', { p: 'bus<0>', q: 'bus<1>', r: 'bus<2>', z: 'out', vdd: 'vdd', vss: 'vss' }],
    ['XT', 'TCELL', { t: 'bus<2>', vdd: 'vdd', vss: 'vss' }],
  ], []));
  cells.set('ACELL', cell('ACELL', ['a', 'z', 'vdd', 'vss'], [
    ['XB<0>', 'BCELL', { g: 'a', d: 'm', vdd: 'vdd', vss: 'vss' }],
    ['XB<1>', 'BCELL', { g: 'm', d: 'z', vdd: 'vdd', vss: 'vss' }],
  ], [
    ['M1', 'M', 'nch', [['d', 'z'], ['g', 'a'], ['s', 'vss'], ['b', 'vss']]],
  ]));
  cells.set('BCELL', cell('BCELL', ['g', 'd', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 'd'], ['g', 'g'], ['s', 'vss'], ['b', 'vss']]],
  ]));
  cells.set('SINK', cell('SINK', ['p', 'q', 'r', 'z', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 'z'], ['g', 'p'], ['s', 'vss'], ['b', 'vss']]],
  ]));
  cells.set('TCELL', cell('TCELL', ['t', 'vdd', 'vss'], [], [
    ['M1', 'M', 'nch', [['d', 't'], ['g', 't'], ['s', 'vss'], ['b', 'vss']]],
  ]));
  return { cells, topCell: 'TOP', warnings: [] };
}
