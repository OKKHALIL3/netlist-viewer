/**
 * Stress test suite — weird edge cases for production readiness.
 * Run with: npx tsx test-stress.ts
 */

import { parseCDL } from './src/parser/cdl';

let pass = 0, fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✅ ${label}`); pass++; }
  else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${e}`);
    console.log(`     actual:   ${a}`);
    fail++;
  }
}
function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section('Empty / degenerate inputs');

check('empty string',
  parseCDL('').topCell, '');

check('only whitespace',
  parseCDL('   \n\t\n   ').cells.size, 0);

check('only comments',
  parseCDL('* this is a comment\n* another\n').cells.size, 0);

check('subckt with no body',
  parseCDL('.SUBCKT EMPTY A B\n.ENDS').cells.get('EMPTY')?.ports.map(p=>p.name), ['A','B']);

check('subckt with no ports',
  parseCDL('.SUBCKT NOPORTS\n.ENDS').cells.get('NOPORTS')?.ports, []);

check('file ends without .ENDS (unclosed subckt)',
  parseCDL('.SUBCKT OPEN A B\nM1 A B A A nmos\n').cells.get('OPEN')?.primitives.length, 1);

// ─────────────────────────────────────────────────────────────────────────────
section('Case insensitivity');

check('.subckt lowercase',
  parseCDL('.subckt inv y a vdd vss\nM1 y a vdd vdd pmos\n.ends').cells.has('inv'), true);

check('.SUBCKT uppercase',
  parseCDL('.SUBCKT INV Y A VDD VSS\nM1 Y A VDD VDD PMOS\n.ENDS').cells.has('INV'), true);

check('Mixed case .SubCkt',
  parseCDL('.SubCkt Foo A B\n.EndS').cells.has('Foo'), true);

// ─────────────────────────────────────────────────────────────────────────────
section('Continuation lines');

check('multi-continuation instance (3 + lines)',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP out a b c vdd vss
XBIG out a
+ b c
+ vdd vss
+ MYCELL
.ENDS
.SUBCKT MYCELL out a b c vdd vss
M1 out a vdd vdd pmos
.ENDS
`);
    return d.cells.get('TOP')?.instances[0]?.master;
  })(), 'MYCELL');

check('continuation strips leading + correctly',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP o i vdd vss
XI1 vdd vss i /
+ DCAP
.ENDS
`);
    return d.cells.get('TOP')?.instances[0]?.master;
  })(), 'DCAP');

check('PININFO spanning continuation lines',
  (() => {
    const d = parseCDL(`
*.PININFO A:I
+ B:O C:B
.SUBCKT FOO A B C
M1 A B C C nmos
.ENDS
`);
    return d.cells.get('FOO')?.ports.map(p => p.dir);
  })(), ['I', 'O', 'B']);

// ─────────────────────────────────────────────────────────────────────────────
section('PININFO placement variants');

check('PININFO before .SUBCKT (auCdl style)',
  (() => {
    const d = parseCDL(`
*.PININFO Y:O A:I VDD:I VSS:I
.SUBCKT INV Y A VDD VSS
M1 Y A VDD VDD pmos
M2 Y A VSS VSS nmos
.ENDS
`);
    return d.cells.get('INV')?.ports[0]?.dir;
  })(), 'O');

check('PININFO after .SUBCKT (inline)',
  (() => {
    const d = parseCDL(`
.SUBCKT INV Y A VDD VSS
*.PININFO Y:O A:I VDD:I VSS:I
M1 Y A VDD VDD pmos
.ENDS
`);
    return d.cells.get('INV')?.ports[1]?.dir;
  })(), 'I');

check('PININFO with no colon directions',
  (() => {
    const d = parseCDL(`
*.PININFO Y A VDD VSS
.SUBCKT INV Y A VDD VSS
.ENDS
`);
    // names should parse but dir = undefined (null)
    return d.cells.get('INV')?.ports.map(p => p.name);
  })(), ['Y', 'A', 'VDD', 'VSS']);

// ─────────────────────────────────────────────────────────────────────────────
section('Bus notation — <n> and [n]');

check('<n> bus parsed with busBase',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a vdd vss
XI1<0> a vdd vss CELL
XI1<1> a vdd vss CELL
XI1<2> a vdd vss CELL
.ENDS
`);
    const insts = d.cells.get('TOP')!.instances;
    return insts.every(i => i.busBase === 'XI1');
  })(), true);

check('[n] bus parsed with busBase',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a vdd vss
X_CAP[0] vdd vss DCAP4
X_CAP[1] vdd vss DCAP4
.ENDS
`);
    const insts = d.cells.get('TOP')!.instances;
    return insts.every(i => i.busBase === 'X_CAP');
  })(), true);

check('bus index correctly parsed (XI1<5>)',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b
XI1<5> a b CELL
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].busIndex;
  })(), 5);

check('non-bus instance has no busBase',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b
XINV a b INV
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].busBase;
  })(), undefined);

// ─────────────────────────────────────────────────────────────────────────────
section('Special characters in identifiers');

check('$ in instance ID (CLKGEN style: X_I$173)',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vdd vss
X_I$173 a b vdd vss INV_X8_LVT
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].id;
  })(), 'X_I$173');

check('$ instance master resolved correctly',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vdd vss
X_I$173 a b vdd vss INV_X8_LVT
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].master;
  })(), 'INV_X8_LVT');

check('very long cell name (pcell hash)',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vdd vss
XI77 a b vdd vss trans_18_mac_pcell_16870293108113351378
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].master;
  })(), 'trans_18_mac_pcell_16870293108113351378');

check('instance ID with underscore-number suffix',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b
XR12_m3 a b CELL
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].id;
  })(), 'XR12_m3');

// ─────────────────────────────────────────────────────────────────────────────
section('Device type classification edge cases');

check('_mac in cell name is NOT a MOSFET',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vdd vss
Xtrans a b vdd vss trans_18_mac_pcell_123
.ENDS
`);
    const cell = d.cells.get('TOP')!;
    return { instances: cell.instances.length, primitives: cell.primitives.length };
  })(), { instances: 1, primitives: 0 });

check('rhim_m model → R primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vss
XR1 a b vss rhim_m lr=1e-6 wr=1e-6 m=1
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'R');

check('rhim (without _m) → R primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vss
XR1 a b vss rhim lr=1e-6
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'R');

check('rpoly → R primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b gnd
XR5 a b gnd rpoly w=100n l=500n
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'R');

check('mim → C primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b
XC1 a b mim_cap c=100f
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'C');

check('cfmom → C primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b
XC1 a b cfmom_4t c=100f
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'C');

check('DCAPX cell name → instance (NOT capacitor)',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP vdd vss
X_CAP vdd vss DCAPX64
.ENDS
`);
    const cell = d.cells.get('TOP')!;
    return { instances: cell.instances.length, primitives: cell.primitives.length };
  })(), { instances: 1, primitives: 0 });

check('native C* line → C primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b vdd
CC1 a b 10f mimcap
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'C');

check('native R* line → R primitive',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP a b
R1 a b 1k poly
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'R');

check('native M* line always → M primitive (never from X*)',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP d g s b
MM1 d g s b nfet_lvt w=200n l=30n
.ENDS
`);
    return d.cells.get('TOP')!.primitives[0]?.kind;
  })(), 'M');

// ─────────────────────────────────────────────────────────────────────────────
section('Slash-form vs no-slash parsing');

check('slash-form: nets before slash, master after',
  (() => {
    const d = parseCDL(`
.SUBCKT CHILD a b vdd vss
M1 a b vdd vdd pmos
.ENDS
.SUBCKT TOP out in vdd vss
XI1 out in vdd vss /
+ CHILD
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].master;
  })(), 'CHILD');

check('slash-form connectivity: port mapping correct',
  (() => {
    const d = parseCDL(`
.SUBCKT CHILD a b vdd vss
M1 a b vdd vdd pmos
.ENDS
.SUBCKT TOP out in vdd vss
XI1 out in vdd vss /
+ CHILD
.ENDS
`);
    const inst = d.cells.get('TOP')!.instances[0];
    return inst.conn;
  })(), { a: 'out', b: 'in', vdd: 'vdd', vss: 'vss' });

check('no-slash: last non-param token is master',
  (() => {
    const d = parseCDL(`
.SUBCKT CHILD a b
M1 a b a a nmos
.ENDS
.SUBCKT TOP x y
XI1 x y CHILD
.ENDS
`);
    return d.cells.get('TOP')!.instances[0].master;
  })(), 'CHILD');

check('no-slash with params: master before params',
  (() => {
    const d = parseCDL(`
.SUBCKT TOP x y
XI1 x y SOMECELL w=100n l=30n m=2
.ENDS
`);
    const inst = d.cells.get('TOP')!.instances[0];
    return { master: inst.master, params_count: Object.keys(inst.portMap).length };
  })(), { master: 'SOMECELL', params_count: 2 });

// ─────────────────────────────────────────────────────────────────────────────
section('Top cell detection');

check('header comment wins over position',
  (() => {
    const d = parseCDL(`
* Top Cell Name: REAL_TOP
.SUBCKT REAL_TOP a b
.ENDS
.SUBCKT NOT_TOP x
.ENDS
`);
    return d.topCell;
  })(), 'REAL_TOP');

check('last unreferenced cell (CDL bottom-up order)',
  (() => {
    const d = parseCDL(`
.SUBCKT LEAF a b
M1 a b a a nmos
.ENDS
.SUBCKT MID a b
XLEAF a b LEAF
.ENDS
.SUBCKT TOP a b
XMID a b MID
.ENDS
`);
    return d.topCell;
  })(), 'TOP');

check('single cell → that cell is top',
  (() => {
    return parseCDL('.SUBCKT ONLY a\n.ENDS').topCell;
  })(), 'ONLY');

check('header comment pointing to nonexistent cell falls back',
  (() => {
    const d = parseCDL(`
* Top Cell Name: GHOST
.SUBCKT REAL a b
.ENDS
`);
    return d.topCell;
  })(), 'REAL');

// ─────────────────────────────────────────────────────────────────────────────
section('Connectivity correctness');

check('net in1 shared between two instances',
  (() => {
    const d = parseCDL(`
.SUBCKT INV y a vdd vss
M1 y a vdd vdd pmos
.ENDS
.SUBCKT TOP out1 out2 in vdd vss
X1 out1 in vdd vss INV
X2 out2 in vdd vss INV
.ENDS
`);
    const net = d.cells.get('TOP')!.nets.find(n => n.name === 'in')!;
    const eps = net.endpoints.filter(([id]) => id !== '__port__');
    return eps.map(([id, pin]) => `${id}.${pin}`).sort();
  })(), ['X1.a', 'X2.a']);

check('no spurious net A→VDD confusion (level 4 problem)',
  (() => {
    const d = parseCDL(`
.SUBCKT INV Y A VDD VSS
M1 Y A VDD VDD PMOS
M2 Y A VSS VSS NMOS
.ENDS
.SUBCKT TOP out in vdd vss
X1 out in vdd vss INV
.ENDS
`);
    const inst = d.cells.get('TOP')!.instances[0];
    // A must map to 'in', NOT 'vdd'
    return inst.conn;
  })(), { Y: 'out', A: 'in', VDD: 'vdd', VSS: 'vss' });

check('cell port appears in net endpoints as __port__',
  (() => {
    const d = parseCDL(`
.SUBCKT INV Y A VDD VSS
M1 Y A VDD VDD pmos
.ENDS
`);
    const net = d.cells.get('INV')!.nets.find(n => n.name === 'VDD')!;
    return net.endpoints.some(([id]) => id === '__port__');
  })(), true);

check('net with single real endpoint (dangling) still captured',
  (() => {
    const d = parseCDL(`
.SUBCKT FOO a b c
M1 a b c c nmos
.ENDS
`);
    const cell = d.cells.get('FOO')!;
    return cell.nets.map(n => n.name).sort();
  })(), ['a', 'b', 'c']);

// ─────────────────────────────────────────────────────────────────────────────
section('Net classification (power / ground / signal)');

const NET_CDL = `
.SUBCKT FOO vdd vss vddio vccpst agnd iovss sig
M1 sig vdd vss vss nmos
.ENDS
`;
const netCell = parseCDL(NET_CDL).cells.get('FOO')!;

check('vdd → power', netCell.nets.find(n=>n.name==='vdd')?.kind, 'power');
check('vddio → power', netCell.nets.find(n=>n.name==='vddio')?.kind, 'power');
check('vccpst → power', netCell.nets.find(n=>n.name==='vccpst')?.kind, 'power');
check('vss → ground', netCell.nets.find(n=>n.name==='vss')?.kind, 'ground');
check('agnd → ground', netCell.nets.find(n=>n.name==='agnd')?.kind, 'ground');
check('iovss → ground', netCell.nets.find(n=>n.name==='iovss')?.kind, 'ground');
check('sig → signal', netCell.nets.find(n=>n.name==='sig')?.kind, 'signal');

// ─────────────────────────────────────────────────────────────────────────────
section('Line ending variants');

const CRLF_CDL = '.SUBCKT CRLF A B\r\nM1 A B A A nmos\r\n.ENDS\r\n';
const CR_CDL   = '.SUBCKT CR A B\rM1 A B A A nmos\r.ENDS\r';

check('CRLF (\\r\\n) normalized: cell found', parseCDL(CRLF_CDL).cells.has('CRLF'), true);
check('CRLF: primitive parsed', parseCDL(CRLF_CDL).cells.get('CRLF')!.primitives.length, 1);
check('CR-only (\\r) normalized: cell found', parseCDL(CR_CDL).cells.has('CR'), true);

// ─────────────────────────────────────────────────────────────────────────────
section('Skipped directives (no false positives)');

check('.PARAM not parsed as instance',
  (() => {
    const d = parseCDL(`
.SUBCKT FOO a b
.PARAM scale=1.0 factor=2
M1 a b a a nmos
.ENDS
`);
    return d.cells.get('FOO')!.instances.length;
  })(), 0);

check('.GLOBAL not parsed as instance',
  (() => {
    const d = parseCDL(`
.SUBCKT FOO a b
.GLOBAL VDD VSS
M1 a b a a nmos
.ENDS
`);
    return d.cells.get('FOO')!.instances.length;
  })(), 0);

check('.MODEL not parsed as instance',
  (() => {
    const d = parseCDL(`
.SUBCKT FOO a b
.MODEL nfet NMOS level=14
M1 a b a a nmos
.ENDS
`);
    return d.cells.get('FOO')!.instances.length;
  })(), 0);

check('.INCLUDE not parsed as instance',
  (() => {
    const d = parseCDL(`
.INCLUDE "models.spi"
.SUBCKT FOO a b
M1 a b a a nmos
.ENDS
`);
    return d.cells.get('FOO')!.instances.length;
  })(), 0);

check('$ comment lines skipped',
  (() => {
    const d = parseCDL(`
.SUBCKT FOO a b
$ This is a Spectre comment
M1 a b a a nmos
.ENDS
`);
    return d.cells.get('FOO')!.primitives.length;
  })(), 1);

// ─────────────────────────────────────────────────────────────────────────────
section('Diamond dependency / deep hierarchy');

check('diamond: D referenced by both B and C, no duplication',
  (() => {
    const d = parseCDL(`
.SUBCKT D x y\nM1 x y x x nmos\n.ENDS
.SUBCKT B x y\nXD x y D\n.ENDS
.SUBCKT C x y\nXD x y D\n.ENDS
.SUBCKT TOP a b c d\nXB a b B\nXC c d C\n.ENDS
`);
    return {
      cells: d.cells.size,
      top: d.topCell,
      topInst: d.cells.get('TOP')!.instances.length,
    };
  })(), { cells: 4, top: 'TOP', topInst: 2 });

check('deep chain: top cell detected correctly (A→B→C→D→E)',
  (() => {
    const chain = ['E','D','C','B','A'].map(n =>
      `.SUBCKT ${n} x y\n${n==='E'?'M1 x y x x nmos':'X1 x y '+String.fromCharCode(n.charCodeAt(0)+1)}\n.ENDS`
    ).join('\n');
    return parseCDL(chain).topCell;
  })(), 'A');

// ─────────────────────────────────────────────────────────────────────────────
section('Malformed lines — warnings, no crash');

check('M line with too few tokens: warning emitted, no crash',
  (() => {
    const d = parseCDL('.SUBCKT FOO a\nM1 a a\n.ENDS');
    return d.warnings.length > 0;
  })(), true);

check('instance with missing master: warning, no crash',
  (() => {
    // XINV with no nets and no master (empty rest) → should warn
    const d = parseCDL('.SUBCKT FOO a b\nXINV\n.ENDS');
    return d.warnings.length > 0;
  })(), true);

check('empty line inside subckt: no crash',
  (() => {
    const d = parseCDL('.SUBCKT FOO a b\n\n\nM1 a b a a nmos\n\n.ENDS');
    return d.cells.get('FOO')!.primitives.length;
  })(), 1);

// ─────────────────────────────────────────────────────────────────────────────
// Real-file spot checks require local CDL sample files (not in repo).
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(62)}`);
console.log(`STRESS TEST RESULTS: ${pass} passed, ${fail} failed / ${pass+fail} total`);
if (fail > 0) {
  console.log('\nFailed checks:');
  process.exit(1);
} else {
  console.log('All edge cases handled correctly.');
}
