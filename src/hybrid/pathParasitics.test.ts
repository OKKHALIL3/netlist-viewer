import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from './__fixtures__/tiny';
import { buildHybridModel } from './model';
import { buildConductors } from './connectivity';
import { findPath, type PinRef } from './path';
import { parseDspf } from '../layout-viewer/dspf/parseDspf';
import { pathParasitics } from './pathParasitics';

const near = (a: number | null, b: number, tol = 1e-9) => {
  assert.notEqual(a, null);
  assert.ok(Math.abs(a! - b) <= tol * Math.max(1e-30, Math.abs(b)), `${a} !≈ ${b}`);
};

const setup = () => {
  const d = tinyDesign();
  const m = buildHybridModel(d);
  return { d, m, c: buildConductors(d, m) };
};

// Matches tinyDesign: in → XU1(XS1→n1→XS2) → mid → XU2 → out. The n1 net is
// deliberately absent so one segment exercises the no-DSPF case. Values are
// hand-solvable: every net is a short R chain.
const DSPF = `
*|DSPF 1.5
*|DESIGN "TOP"
*|DIVIDER /
*|DELIMITER :
*|GROUND_NET VSS

.SUBCKT TOP in out vdd vss

*|NET in 9.9e-15
*|P (in I 1.0e-15 0.0 0.0)
*|I (XU1/XS1/M1:g XU1/XS1/M1 g I 0.5e-15 1.0 1.0)
*|S (in:1)
Rin1 in in:1 100
Rin2 in:1 XU1/XS1/M1:g 100
Cin1 in:1 0 1.0e-15
Cin2 XU1/XS1/M1:g VSS 1.0e-15

*|NET mid 9.9e-15
*|I (XU1/XS2/M1:d XU1/XS2/M1 d O 0 2.0 2.0)
*|I (XU2/M1:g XU2/M1 g I 0 3.0 3.0)
*|S (mid:1)
*|S (mid:2)
Rm1 mid:1 XU1/XS2/M1:d 200
Rm2 mid:1 XU2/M1:g 300
Cm1 mid:1 0 2.0e-15
Ccx mid:1 out:1 5.0e-16
Cint mid:1 mid:2 9.9e-15

*|NET out 9.9e-15
*|P (out O 0 9.0 9.0)
*|I (XU2/M1:d XU2/M1 d O 0 3.0 3.0)
*|S (out:1)
Ro1 out out:1 25
Ro2 out:1 XU2/M1:d 25
Co1 out:1 0 1.0e-15
Co2 0 out:1 2.0e-16

.ENDS
`;

test('top-to-top path: per-net R/C/Elmore across hierarchical block hops', () => {
  const { d, m, c } = setup();
  const data = parseDspf(DSPF);
  const ends: [PinRef, PinRef] = [{ block: '', pin: 'in' }, { block: '', pin: 'out' }];
  const r = findPath(d, m, c, ends[0], ends[1])!;
  // The BFS hops THROUGH XU1 at its boundary (in → xu1 → mid → xu2 → out);
  // xu1's internal n1 wire belongs to the block hop, not to any net segment.
  assert.equal(r.netCount, 3);

  const p = pathParasitics(data, c, r, ends);
  assert.equal(p.segments.length, 3);
  const [sIn, sMid, sOut] = p.segments;

  // in: port anchor → XU1's device pins (prefix-matched under xu1/). 100+100 Ω.
  // τ = 1f·v(in:1) + (1f + 0.5f pin)·v(M1:g) = 1f·100 + 1.5f·200 = 400 fs.
  assert.equal(sIn.status, 'ok');
  assert.equal(sIn.dspfNet, 'in');
  near(sIn.r, 200);
  near(sIn.c, 3.5e-15);   // Cin1 + Cin2 + port cap + pin cap
  near(sIn.elmore, 4.0e-13);

  // mid: XU1's pins → XU2's pins, 200+300 Ω. Same-net Cint is internal (not
  // load); the coupling cap counts. τ = (2f + 0.5f)·v(mid:1) = 2.5f·200.
  assert.equal(sMid.status, 'ok');
  near(sMid.r, 500);
  near(sMid.c, 2.5e-15);
  near(sMid.elmore, 5.0e-13);

  // out: XU2 pin → top port, 25+25 Ω. Loads at out:1: Co1 + reversed-terminal
  // Co2 + the coupling cap declared in MID's section (foreign side) = 1.7 fF;
  // v(out:1) = 25 → τ = 42.5 fs.
  assert.equal(sOut.status, 'ok');
  near(sOut.r, 50);
  near(sOut.c, 1.7e-15);
  near(sOut.elmore, 4.25e-14);

  assert.equal(p.matched, 3);
  assert.equal(p.solved, 3);
  near(p.totalR, 750);
  near(p.totalC, 7.7e-15);
  near(p.totalElmore, 9.425e-13);
});

test('inner start: a CDL-only net is a no-DSPF hole; the end stub reads 0 Ω', () => {
  const { d, m, c } = setup();
  const data = parseDspf(DSPF);
  const ends: [PinRef, PinRef] = [{ block: 'xu1/xs1', pin: 'd' }, { block: 'xu2', pin: 'z' }];
  const r = findPath(d, m, c, ends[0], ends[1])!;
  const p = pathParasitics(data, c, r, ends);
  assert.equal(p.segments.length, 3); // n1, mid, out

  // n1 lives only in the CDL — no extraction data, honestly unmatched.
  const sN1 = p.segments[0];
  assert.equal(sN1.status, 'no-dspf');
  assert.ok(sN1.net.includes('n1'));
  assert.equal(sN1.r, null);
  assert.equal(sN1.c, null);

  near(p.segments[1].r, 500);

  // The path ends AT xu2's contact with `out` — entered and exited by the
  // same block, so no out-wire traversal; its load still hangs off the end.
  const last = p.segments[2];
  assert.equal(last.status, 'ok');
  near(last.r, 0);
  near(last.elmore, 0);
  near(last.c, 1.7e-15);

  assert.equal(p.matched, 2);
  assert.equal(p.solved, 2);
  near(p.totalR, 500);
});

test('doubled leading X on DSPF instance paths still anchors (xx→x collapse)', () => {
  const { d, m, c } = setup();
  const data = parseDspf(`
*|DIVIDER /
*|DELIMITER :
.SUBCKT TOP in out vdd vss
*|NET mid 1.0e-15
*|I (XXU1/XS2/M1:d XXU1/XS2/M1 d O 0 2.0 2.0)
*|I (XXU2/M1:g XXU2/M1 g I 0 3.0 3.0)
Rm1 XXU1/XS2/M1:d XXU2/M1:g 400
.ENDS
`);
  const ends: [PinRef, PinRef] = [{ block: 'xu1/xs2', pin: 'd' }, { block: 'xu2', pin: 'z' }];
  const r = findPath(d, m, c, ends[0], ends[1])!;
  const p = pathParasitics(data, c, r, ends);
  const mid = p.segments.find(s => s.dspfNet === 'mid')!;
  assert.equal(mid.status, 'ok');
  near(mid.r, 400);
});

test('a block with no device pins on the net reports unanchored, keeping C', () => {
  const { d, m, c } = setup();
  const data = parseDspf(`
*|DIVIDER /
*|DELIMITER :
.SUBCKT TOP in out vdd vss
*|NET mid 1.0e-15
*|I (XU2/M1:g XU2/M1 g I 0 3.0 3.0)
Rm1 mid XU2/M1:g 400
Cm1 mid 0 3.0e-15
.ENDS
`);
  const ends: [PinRef, PinRef] = [{ block: 'xu1/xs2', pin: 'd' }, { block: 'xu2', pin: 'z' }];
  const r = findPath(d, m, c, ends[0], ends[1])!;
  const p = pathParasitics(data, c, r, ends);
  const mid = p.segments.find(s => s.dspfNet === 'mid')!;
  assert.equal(mid.status, 'unanchored');
  assert.equal(mid.r, null);
  near(mid.c, 3.0e-15);
  assert.ok(p.solved < p.segments.length);
});

test('C-only extraction: 0 Ω with the extractor header cap as fallback', () => {
  const { d, m, c } = setup();
  const data = parseDspf(`
*|DIVIDER /
*|DELIMITER :
.SUBCKT TOP in out vdd vss
*|NET mid 4.0e-15
*|I (XU2/M1:g XU2/M1 g I 0 3.0 3.0)
.ENDS
`);
  const ends: [PinRef, PinRef] = [{ block: 'xu1/xs2', pin: 'd' }, { block: 'xu2', pin: 'z' }];
  const r = findPath(d, m, c, ends[0], ends[1])!;
  const p = pathParasitics(data, c, r, ends);
  const mid = p.segments.find(s => s.dspfNet === 'mid')!;
  assert.equal(mid.status, 'no-r');
  near(mid.r, 0);
  near(mid.c, 4.0e-15); // *|NET header total, since no elements were extracted
  near(mid.elmore, 0);
});

test('hops carry the real block adjacency for every conductor', () => {
  const { d, m, c } = setup();
  const r = findPath(d, m, c, { block: 'xu1/xs1', pin: 'd' }, { block: 'xu2', pin: 'z' })!;
  assert.deepEqual(
    r.hops.map(h => [h.from, h.to]),
    [['xu1/xs1', 'xu1/xs2'], ['xu1/xs2', 'xu2'], ['xu2', 'xu2']],
  );
  const top = findPath(d, m, c, { block: '', pin: 'in' }, { block: 'xu1/xs1', pin: 'g' })!;
  assert.deepEqual(top.hops.map(h => [h.from, h.to]), [[null, 'xu1/xs1']]);
});
