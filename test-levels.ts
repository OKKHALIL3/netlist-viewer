import { parseCDL } from './src/parser/cdl';

let pass = 0, fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${e}`);
    console.log(`     actual:   ${a}`);
    fail++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Level 2: Parser extracts a flat cell ─────────────────────────────────');

const L2 = parseCDL(`
.SUBCKT INV Y A VDD VSS
M1 Y A VDD VDD PMOS
M2 Y A VSS VSS NMOS
.ENDS
`);

const inv = L2.cells.get('INV')!;
check('cell name', inv?.name, 'INV');
check('ports', inv?.ports.map(p => p.name), ['Y', 'A', 'VDD', 'VSS']);
check('primitive count (2 MOSFETs)', inv?.primitives.length, 2);
check('M1 kind', inv?.primitives[0]?.kind, 'M');
check('M1 model', inv?.primitives[0]?.model, 'PMOS');
check('M1 drain=Y', inv?.primitives[0]?.terms[0], ['d', 'Y']);
check('M1 gate=A',  inv?.primitives[0]?.terms[1], ['g', 'A']);
check('M2 kind', inv?.primitives[1]?.kind, 'M');
check('M2 model', inv?.primitives[1]?.model, 'NMOS');
check('top cell', L2.topCell, 'INV');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Level 3: Hierarchy works ─────────────────────────────────────────────');

const L3 = parseCDL(`
.SUBCKT INV Y A VDD VSS
M1 Y A VDD VDD PMOS
M2 Y A VSS VSS NMOS
.ENDS

.SUBCKT NAND Y A B VDD VSS
M1 Y A VDD VDD PMOS
M2 Y B VDD VDD PMOS
M3 Y A mid VSS NMOS
M4 mid B VSS VSS NMOS
.ENDS

.SUBCKT TOP out in1 in2 VDD VSS
X1 w1 in1 VDD VSS INV
X2 out in1 in2 VDD VSS NAND
.ENDS
`);

const top = L3.cells.get('TOP')!;
check('TOP has 2 instances', top?.instances.length, 2);
check('X1 master=INV', top?.instances[0]?.master, 'INV');
check('X2 master=NAND', top?.instances[1]?.master, 'NAND');
check('top cell is TOP', L3.topCell, 'TOP');

// Hierarchy tree: TOP references INV and NAND
const referenced = new Set<string>();
for (const cell of L3.cells.values())
  for (const inst of cell.instances) referenced.add(inst.master);
check('INV is referenced', referenced.has('INV'), true);
check('NAND is referenced', referenced.has('NAND'), true);
check('TOP is NOT referenced (it is the top)', referenced.has('TOP'), false);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Level 4: Connectivity works ─────────────────────────────────────────');

// After second pass, conn maps port-name → net-name for each instance.
// X1 connects: Y→w1, A→in1, VDD→VDD, VSS→VSS
check('X1 conn Y→w1',  top?.instances[0]?.conn['Y'],   'w1');
check('X1 conn A→in1', top?.instances[0]?.conn['A'],   'in1');
check('X1 conn VDD→VDD', top?.instances[0]?.conn['VDD'], 'VDD');
check('X1 conn VSS→VSS', top?.instances[0]?.conn['VSS'], 'VSS');

// X2: Y→out, A→in1, B→in2, VDD→VDD, VSS→VSS
check('X2 conn Y→out',  top?.instances[1]?.conn['Y'],   'out');
check('X2 conn A→in1',  top?.instances[1]?.conn['A'],   'in1');
check('X2 conn B→in2',  top?.instances[1]?.conn['B'],   'in2');

// Net 'w1' appears at X1.Y and nowhere else at this level → fanout 1 (plus port)
const w1 = top?.nets.find(n => n.name === 'w1');
check('net w1 exists', !!w1, true);
check('w1 endpoint at X1 pin Y', w1?.endpoints.some(([id, pin]) => id === 'X1' && pin === 'Y'), true);

// Net 'in1' connects X1.A and X2.A
const in1 = top?.nets.find(n => n.name === 'in1');
check('in1 at X1.A', in1?.endpoints.some(([id, pin]) => id === 'X1' && pin === 'A'), true);
check('in1 at X2.A', in1?.endpoints.some(([id, pin]) => id === 'X2' && pin === 'A'), true);

// ─────────────────────────────────────────────────────────────────────────────
// Level 5: Real-file tests require local CDL sample files (not in repo).
// Run them separately with your own CDL files in ./samples/.
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} checks`);
if (fail > 0) process.exit(1);
