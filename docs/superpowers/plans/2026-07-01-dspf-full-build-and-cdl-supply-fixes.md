# DSPF Full Build-Out + CDL Supply/Ground/Dangling Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Abstract Layout Viewer to the full handoff-brief spec (complete DSPF parser, correlation, always-on layer-colored connections, block-net boxes, zone/layer/inspector UX, physical-only block fallback) and fix the boss-reported CDL bugs (supply/ground net detection via topology+propagation, dangling-resistor explanation).

**Architecture:** The DSPF parser stays a custom single-pass line-oriented reader in a web worker (evidence: eda-netlist-parser discards all coordinates). It gains full directive coverage (`*|GROUND_NET`, `*|DeviceFingerDelim`, engineering-suffix caps, `*|I` instance identity, instance-section device statements, global node-coordinate index, unique-device identity). `correlate()` consumes the richer parse to fix device counts, net→block mapping (works for coordinate-less `*|I` files like xACT), and adds DSPF-derived "physical-only" blocks for paths that provably aren't in the CDL (CLKGEN). The canvas moves to the mockup behavior: connections always drawn (layer-gated, budgeted), net bboxes for the selected block's nets. CDL net classification adds a TS post-pass: name heuristics + MOSFET-bulk topology votes + bottom-up port propagation to a fixed point (catches `AVRH`/`AVRL`).

**Tech Stack:** TypeScript + React + Zustand + Canvas2D (existing), node:test via tsx for TS tests (`npm run test:layout`), pyodide adapter suite (`npm test`). No new dependencies.

## Global Constraints

- Never hard-code divider/delimiter — read `*|DIVIDER`, `*|DELIMITER`, `*|DeviceFingerDelim` from the header (brief §5).
- Layer data is extraction-dependent: full coloring when present, graceful+explained degradation when absent (brief §5, the two mockups).
- Connections are an RC-network skeleton, not routing polygons — label honestly (brief §5).
- The browser never renders raw DSPF; parse in the worker, render from the compact model (brief §7).
- Real sample truths (validate against): StrongARM xRC = `/`+`:`, layers on every R, 10 nets, `*|GROUND_NET GND`; n16g Quantus = `/`+`#`, `*|GROUND_NET 0`, quoted `*|DeviceFingerDelim "@"`, `$active` bare flag on R, coupling caps `CB*` reference foreign nets, TAB-delimited instance section at EOF; CLKGEN xACT = `|`+`:`, TAB-delimited header tags, `*|NET <name> 0.259853f` (suffix!), `*|P`/`*|I` carry NO coords, DSPF instance names (`X100`, `XDCAP4BWP16P901[7]`) don't exist in the CDL.
- CDL truths: `AVRH`/`AVRL` are supply rails detectable only by topology; `AVD_0V8`/`AVS`/`AVDD`/`AVSS` by name; `net1` in `n16g_clk_cml2cmos_buff` is a genuinely dangling dummy-resistor leg (`XR0*__dmy0__m1` chain).
- Commit style: `type(scope): summary`, no attribution trailers, no pushes.
- All tests green after every task: `npm run test:layout` (fast) per task; `npm test` (pyodide, slow) when the adapter/netKinds boundary changes; `npm run build` at the end.

---

### Task 1: Shared net-kind heuristics + topology/propagation classifier

**Files:**
- Create: `src/parser/netKinds.ts`
- Create: `src/parser/netKinds.test.ts`
- Modify: `src/parser/pyodide/pyodideParser.ts` (call `refineNetKinds` in `jsonToDesign`)
- Modify: `src/viz/validateDesign.ts:19-28` (import shared heuristic, delete stale local regexes)
- Modify: `package.json` (`test:layout` glob gains `"src/parser/**/*.test.ts"`)

**Interfaces:**
- Produces: `nameNetKind(name: string): 'power' | 'ground' | 'signal'`, `refineNetKinds(design: Design): void` (mutates `net.kind` in place), exported `PWR_RE`, `GND_RE`.
- Consumers: `pyodideParser.jsonToDesign` (every parse), `validateDesign.netKind`, later tasks read `net.kind` as today.

- [ ] **Step 1: Write the failing tests**

```ts
// src/parser/netKinds.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameNetKind, refineNetKinds } from './netKinds';
import type { Design, Cell, Net } from './types';

function mkCell(name: string, p: Partial<Cell>): Cell {
  return { name, ports: [], instances: [], primitives: [], nets: [], ...p };
}
function net(name: string, endpoints: Net['endpoints'] = []): Net {
  return { name, kind: nameNetKind(name), endpoints };
}
function design(cells: Cell[], top: string): Design {
  return { cells: new Map(cells.map(c => [c.name, c])), topCell: top, warnings: [] };
}

test('name heuristics: existing families still classify', () => {
  assert.equal(nameNetKind('VDD'), 'power');
  assert.equal(nameNetKind('AVDD'), 'power');
  assert.equal(nameNetKind('AVD_0V8'), 'power');
  assert.equal(nameNetKind('vcc_io'), 'power');
  assert.equal(nameNetKind('VSS'), 'ground');
  assert.equal(nameNetKind('AVS'), 'ground');
  assert.equal(nameNetKind('DGND'), 'ground');
  assert.equal(nameNetKind('VDATA'), 'signal');  // v+d but no digit/_ after
  assert.equal(nameNetKind('VCO_IN'), 'signal'); // v+c but no digit/_ after
});

test('name heuristics: new cases', () => {
  assert.equal(nameNetKind('0'), 'ground');       // SPICE ground node
  assert.equal(nameNetKind('GND!'), 'ground');    // global-net bang
  assert.equal(nameNetKind('VDD!'), 'power');
  assert.equal(nameNetKind('VGND'), 'ground');    // v-prefixed ground
  assert.equal(nameNetKind('GROUND'), 'ground');
  assert.equal(nameNetKind('AVRH'), 'signal');    // NOT name-detectable; topology's job
});

test('topology: pch bulk net becomes power, nch bulk becomes ground', () => {
  // Mirrors n16g_ck_clk_ckinvx2: AVRL is S/B of pch, VSS of nch.
  const inv = mkCell('inv', {
    ports: [{ name: 'A', dir: 'I' }, { name: 'AVRL', dir: 'B' }, { name: 'VSS', dir: 'B' }, { name: 'Z', dir: 'O' }],
    primitives: [
      { id: 'MTP', kind: 'M', model: 'pch_ulvt_mac', terms: [['d', 'Z'], ['g', 'A'], ['s', 'AVRL'], ['b', 'AVRL']], params: {} },
      { id: 'MTN', kind: 'M', model: 'nch_ulvt_mac', terms: [['d', 'Z'], ['g', 'A'], ['s', 'VSS'], ['b', 'VSS']], params: {} },
    ],
    nets: [
      net('A', [['__port__', 'A'], ['MTP', 'g'], ['MTN', 'g']]),
      net('AVRL', [['__port__', 'AVRL'], ['MTP', 's'], ['MTP', 'b']]),
      net('VSS', [['__port__', 'VSS'], ['MTN', 's'], ['MTN', 'b']]),
      net('Z', [['__port__', 'Z'], ['MTP', 'd'], ['MTN', 'd']]),
    ],
  });
  const d = design([inv], 'inv');
  refineNetKinds(d);
  assert.equal(inv.nets.find(n => n.name === 'AVRL')!.kind, 'power');
  assert.equal(inv.nets.find(n => n.name === 'VSS')!.kind, 'ground');
  assert.equal(inv.nets.find(n => n.name === 'Z')!.kind, 'signal');
  assert.equal(inv.nets.find(n => n.name === 'A')!.kind, 'signal');
});

test('propagation: parent net wired into a supply-classified child port becomes power', () => {
  // Mirrors n16g: XI17.AVD_0V8 pin (name-power port) is fed by net AVRH.
  const buf = mkCell('buf', {
    ports: [{ name: 'AVD_0V8', dir: 'I' }, { name: 'IN', dir: 'I' }],
    nets: [net('AVD_0V8', [['__port__', 'AVD_0V8']]), net('IN', [['__port__', 'IN']])],
  });
  const top = mkCell('top', {
    instances: [{ id: 'XI17', master: 'buf', conn: { AVD_0V8: 'AVRH', IN: 'C2IP' }, portMap: ['AVRH', 'C2IP'] }],
    nets: [net('AVRH', [['XI17', 'AVD_0V8']]), net('C2IP', [['XI17', 'IN']])],
  });
  const d = design([buf, top], 'top');
  refineNetKinds(d);
  assert.equal(top.nets.find(n => n.name === 'AVRH')!.kind, 'power');
  assert.equal(top.nets.find(n => n.name === 'C2IP')!.kind, 'signal');
});

test('propagation is transitive across levels (topology → port → parent net)', () => {
  // inv.AVRL power by topology → mid net RAIL power → top net AVRH power.
  const inv = mkCell('inv', {
    ports: [{ name: 'AVRL', dir: 'B' }],
    primitives: [{ id: 'MP', kind: 'M', model: 'pch', terms: [['d', 'x'], ['g', 'x'], ['s', 'AVRL'], ['b', 'AVRL']], params: {} }],
    nets: [net('AVRL', [['__port__', 'AVRL'], ['MP', 'b']]), net('x', [['MP', 'd'], ['MP', 'g']])],
  });
  const mid = mkCell('mid', {
    ports: [{ name: 'RAIL', dir: 'B' }],
    instances: [{ id: 'X1', master: 'inv', conn: { AVRL: 'RAIL' }, portMap: ['RAIL'] }],
    nets: [net('RAIL', [['__port__', 'RAIL'], ['X1', 'AVRL']])],
  });
  const top = mkCell('top', {
    instances: [{ id: 'X2', master: 'mid', conn: { RAIL: 'AVRH' }, portMap: ['AVRH'] }],
    nets: [net('AVRH', [['X2', 'RAIL']])],
  });
  const d = design([inv, mid, top], 'top');
  refineNetKinds(d);
  assert.equal(top.nets.find(n => n.name === 'AVRH')!.kind, 'power');
});

test('conflicting bulk votes leave the net a signal', () => {
  const c = mkCell('c', {
    primitives: [
      { id: 'MP', kind: 'M', model: 'pch', terms: [['d', 'a'], ['g', 'a'], ['s', 'a'], ['b', 'MIX']], params: {} },
      { id: 'MN', kind: 'M', model: 'nch', terms: [['d', 'a'], ['g', 'a'], ['s', 'a'], ['b', 'MIX']], params: {} },
    ],
    nets: [net('MIX', [['MP', 'b'], ['MN', 'b']]), net('a', [['MP', 'd'], ['MN', 'd']])],
  });
  const d = design([c], 'c');
  refineNetKinds(d);
  assert.equal(c.nets.find(n => n.name === 'MIX')!.kind, 'signal');
});

test('name heuristic outranks topology', () => {
  // A net NAMED like ground never flips to power, whatever the topology says.
  const c = mkCell('c', {
    primitives: [{ id: 'MP', kind: 'M', model: 'pch', terms: [['d', 'a'], ['g', 'a'], ['s', 'a'], ['b', 'VSS']], params: {} }],
    nets: [net('VSS', [['MP', 'b']]), net('a', [['MP', 'd'], ['MP', 'g'], ['MP', 's']])],
  });
  const d = design([c], 'c');
  refineNetKinds(d);
  assert.equal(c.nets.find(n => n.name === 'VSS')!.kind, 'ground');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/parser/netKinds.test.ts`
Expected: FAIL — `Cannot find module './netKinds'`.

- [ ] **Step 3: Implement `src/parser/netKinds.ts`**

```ts
// Net classification: is a net a power rail, a ground rail, or a signal?
//
// Three evidence sources, strongest first:
//   1. NAME — VDD/VCC/VSS/GND families (with analog/digital/io prefixes and
//      voltage suffixes), SPICE node "0", global-net "!" forms. Ported from
//      cdl_adapter.py and kept in sync with it.
//   2. TOPOLOGY — inside a cell, the net tied to the BULK of PMOS devices is a
//      supply, the bulk of NMOS a ground (how rails are actually wired; catches
//      rails the naming misses, e.g. AVRL in the n16g PDK cells).
//   3. PROPAGATION — a cell port whose inner net classified power/ground makes
//      every parent net wired into that port power/ground too (AVRH feeding
//      XI17.AVD_0V8 / XI107.AVDD). Runs bottom-up to a fixed point.
//
// Only upward propagation is sound: a cell's nets are shared by ALL its
// instantiations, so pushing a parent's rail kind DOWN into a child cell could
// mislabel other instantiations. Topology gives leaves their own evidence.
import type { Design, Cell, Net } from './types';

// Keep in sync with PWR_RE/GND_RE in src/parser/pyodide/cdl_adapter.py.
export const PWR_RE = /^(?:a|d|p|io|dig)?v(?:dd|cc)|^(?:a|d|p|io|dig)?v[dc](?:[0-9_]|$)/i;
export const GND_RE = /^(?:a|d|p|io|dig)?(?:gnd|vss)|^(?:a|d|p|io|dig)?vs(?:[0-9_]|$)|^v?gnd|^ground$|^0$/i;

export function nameNetKind(name: string): Net['kind'] {
  if (PWR_RE.test(name)) return 'power';
  if (GND_RE.test(name)) return 'ground';
  return 'signal';
}

const PMOS_MODEL = /^p(ch|mos|fet|hv|lv)?|pmos/i;
const NMOS_MODEL = /^n(ch|mos|fet|hv|lv)?|nmos/i;

type Kind = Net['kind'];

// One cell's local evidence: name first, then unanimous bulk votes.
function localKinds(cell: Cell): Map<string, Kind> {
  const kinds = new Map<string, Kind>();
  const votes = new Map<string, { p: number; n: number }>();
  for (const prim of cell.primitives) {
    if (prim.kind !== 'M') continue;
    const bulk = prim.terms.find(([t]) => t === 'b')?.[1];
    if (!bulk) continue;
    const v = votes.get(bulk) ?? { p: 0, n: 0 };
    if (PMOS_MODEL.test(prim.model)) v.p++;
    else if (NMOS_MODEL.test(prim.model)) v.n++;
    votes.set(bulk, v);
  }
  for (const net of cell.nets) {
    const byName = nameNetKind(net.name);
    if (byName !== 'signal') { kinds.set(net.name, byName); continue; }
    const v = votes.get(net.name);
    if (v && v.p > 0 && v.n === 0) kinds.set(net.name, 'power');
    else if (v && v.n > 0 && v.p === 0) kinds.set(net.name, 'ground');
    else kinds.set(net.name, 'signal');
  }
  return kinds;
}

// Mutates net.kind across the whole design.
export function refineNetKinds(design: Design): void {
  const kinds = new Map<string, Map<string, Kind>>();
  for (const [name, cell] of design.cells) kinds.set(name, localKinds(cell));

  // Fixed point: wire child-port kinds up into parent nets. Name evidence is
  // never overridden; signal→power/ground promotions only. Conflicting
  // child-port evidence (one says power, another ground) leaves signal.
  const maxIter = design.cells.size + 2;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const [cellName, cell] of design.cells) {
      const mine = kinds.get(cellName)!;
      const votes = new Map<string, { p: number; g: number }>();
      for (const inst of cell.instances) {
        const child = kinds.get(inst.master);
        if (!child) continue;
        for (const [pin, netName] of Object.entries(inst.conn)) {
          if (!netName) continue;
          const childKind = child.get(pin);
          if (childKind !== 'power' && childKind !== 'ground') continue;
          const v = votes.get(netName) ?? { p: 0, g: 0 };
          if (childKind === 'power') v.p++; else v.g++;
          votes.set(netName, v);
        }
      }
      for (const [netName, v] of votes) {
        if (mine.get(netName) !== 'signal') continue;
        if (nameNetKind(netName) !== 'signal') continue; // name already spoke
        const next: Kind | null = v.p > 0 && v.g === 0 ? 'power' : v.g > 0 && v.p === 0 ? 'ground' : null;
        if (next) { mine.set(netName, next); changed = true; }
      }
    }
    if (!changed) break;
  }

  for (const [cellName, cell] of design.cells) {
    const mine = kinds.get(cellName)!;
    for (const net of cell.nets) net.kind = mine.get(net.name) ?? net.kind;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/parser/netKinds.test.ts`
Expected: PASS (7 tests). If `VGND`/`GROUND`/`0` fail, the GND_RE alternation is wrong — every alternative must be anchored (`^v?gnd`, `^ground$`, `^0$`).

- [ ] **Step 5: Wire into the parse path + consolidate validateDesign**

In `src/parser/pyodide/pyodideParser.ts`, import and call:

```ts
import { refineNetKinds } from '../netKinds';
// ...in jsonToDesign, before return:
function jsonToDesign(json: string): Design {
  const parsed = JSON.parse(json) as DesignJSON;
  const design: Design = {
    cells: new Map(Object.entries(parsed.cells)),
    topCell: parsed.topCell,
    warnings: parsed.warnings,
  };
  refineNetKinds(design);
  return design;
}
```

In `src/viz/validateDesign.ts`, delete the local `PWR_RE`/`GND_RE`/`netKind` (lines 19–28) and replace with:

```ts
import { nameNetKind as netKind } from '../parser/netKinds';
```

(The identifier `netKind` is referenced later in that file; aliasing keeps the diff minimal.)

In `package.json`, extend the layout test glob:

```json
"test:layout": "node --import tsx --test \"src/parser/netKinds.test.ts\" \"src/layout-viewer/**/*.test.ts\" \"src/components/layout/**/*.test.ts\" \"src/store/**/*.test.ts\" \"src/layout/**/*.test.ts\"",
```

- [ ] **Step 6: Run the full fast suite**

Run: `npm run test:layout`
Expected: PASS (old 16 layout + new netKinds tests). Also run `npm test` (pyodide adapter suite) — expected 65/65 pass, since the adapter itself is untouched.

- [ ] **Step 7: Commit**

```bash
git add src/parser/netKinds.ts src/parser/netKinds.test.ts src/parser/pyodide/pyodideParser.ts src/viz/validateDesign.ts package.json
git commit -m "fix(schematic): classify supply/ground nets by topology + hierarchical propagation"
```

---

### Task 2: Dangling-net classification (floating vs dummy leg) + inspector explanation

**Files:**
- Modify: `src/layout/netStatus.ts`
- Modify: `src/layout/netStatus.test.ts`
- Modify: `src/components/InspectorPanel.tsx:194-207` (message per kind)

**Interfaces:**
- Produces: `classifyDangling(net: Pick<Net,'name'|'endpoints'>): 'floating' | 'dummy-leg' | null` (null = normally connected). `isFloatingNet` unchanged.

- [ ] **Step 1: Add failing tests to `src/layout/netStatus.test.ts`**

```ts
import { classifyDangling } from './netStatus';

test('dangling net on a __dmy resistor chain is a dummy leg', () => {
  assert.equal(
    classifyDangling({ name: 'net1', endpoints: [['XR0', 'a']] }),
    'floating', // net1 itself: endpoint device XR0 is NOT dmy-named...
  );
  assert.equal(
    classifyDangling({ name: 'XR0_1__dmy0__m1', endpoints: [['XR0', 'b']] }),
    'dummy-leg', // net named like a dummy segment
  );
  assert.equal(
    classifyDangling({ name: 'weird', endpoints: [['XR0_2__dmy0__m1', 'b']] }),
    'dummy-leg', // sole endpoint is a dummy device
  );
});

test('connected nets classify as null', () => {
  assert.equal(classifyDangling({ name: 'n', endpoints: [['A', 'x'], ['B', 'y']] }), null);
});
```

NOTE the first assertion: `net1`'s endpoint is `XR0` (no `__dmy`), so plain `'floating'` is correct — the inspector copy (step 3) is what tells the user the neighbor chain is a dummy structure. To ALSO catch `net1`, `classifyDangling` accepts an optional cell so it can look at the device the net hangs off:

```ts
test('floating net whose sole device also drives __dmy nets is a dummy leg', () => {
  const cell = {
    primitives: [{ id: 'XR0', kind: 'R', model: 'rhim', params: {},
      terms: [['a', 'net1'], ['b', 'XR0_1__dmy0__m1']] }],
  };
  assert.equal(
    classifyDangling({ name: 'net1', endpoints: [['XR0', 'a']] }, cell as never),
    'dummy-leg',
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/layout/netStatus.test.ts`
Expected: FAIL — `classifyDangling` not exported.

- [ ] **Step 3: Implement**

Append to `src/layout/netStatus.ts`:

```ts
const DMY_RE = /__?dmy/i;

// Why is this net dangling? auCdl netlists snake long resistors into segment
// chains whose interior nets/instances carry a "__dmy" marker, and one end of
// a matching/dummy leg is legitimately left open in the source. Distinguishing
// that from an accidental float answers "is it floating in the design itself?"
// (a real reviewer question) inside the tool.
export function classifyDangling(
  net: Pick<Net, 'name' | 'endpoints'>,
  cell?: Pick<Cell, 'primitives'>,
): 'floating' | 'dummy-leg' | null {
  if (!isFloatingNet(net)) return null;
  if (DMY_RE.test(net.name)) return 'dummy-leg';
  if (net.endpoints.some(([id]) => DMY_RE.test(id))) return 'dummy-leg';
  if (cell) {
    for (const [id] of net.endpoints) {
      const prim = cell.primitives.find(p => p.id === id);
      if (prim && prim.terms.some(([, n]) => DMY_RE.test(n))) return 'dummy-leg';
    }
  }
  return 'floating';
}
```

Add `Cell` to the type import at the top: `import type { Net, Cell } from '../parser/types';`

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test src/layout/netStatus.test.ts` — PASS.

- [ ] **Step 5: Inspector copy**

In `src/components/InspectorPanel.tsx`, replace the floating-note block (uses `getCell()` result already in scope as `cell`):

```tsx
const dangling = classifyDangling(net, cell);
// ...
{dangling === 'floating' && (
  <div className="floating-note">
    ⚠ Floating net — touches only {realEps.length} pin{realEps.length === 1 ? '' : 's'} and
    nothing else. This is how it appears in the source CDL (not a parse artifact).
  </div>
)}
{dangling === 'dummy-leg' && (
  <div className="floating-note">
    ◌ Dangling by design — this net ends a dummy/matching resistor leg
    (a *__dmy* segment chain in the source netlist). Expected for snaked or
    matching resistors; not an error.
  </div>
)}
```

Import: `import { classifyDangling } from '../layout/netStatus';` (replacing or alongside `isFloatingNet`).

- [ ] **Step 6: Full fast suite + commit**

Run: `npm run test:layout` — PASS.

```bash
git add src/layout/netStatus.ts src/layout/netStatus.test.ts src/components/InspectorPanel.tsx
git commit -m "feat(schematic): explain dangling nets — real floats vs dummy resistor legs"
```

---

### Task 3: DSPF model types + header/net-section completeness

**Files:**
- Modify: `src/layout-viewer/model.ts` (types)
- Modify: `src/layout-viewer/dspf/parseDspf.ts`
- Modify: `src/layout-viewer/dspf/tokens.ts` (paren payload keeps full `rest`)
- Modify: `src/layout-viewer/dspf/parseDspf.test.ts`, `src/layout-viewer/dspf/tokens.test.ts`

**Interfaces (produced, consumed by Tasks 4–8):**

```ts
// model.ts — replaces/extends existing types
export interface DspfInstPin { name: string; inst: string; pin: string; pinType: string | null; cap: number | null; x: number | null; y: number | null; layer: string | null }
export interface DspfPort { name: string; pinType: string | null; cap: number | null; x: number | null; y: number | null; layer: string | null }
export interface DspfNet {
  name: string; totalCap: number | null; isGround: boolean;
  ports: DspfPort[]; subnodes: DspfPoint[]; instPins: DspfInstPin[];
  resistors: DspfResistor[]; capacitors: DspfCapacitor[];
}
export interface DspfDevicePoint { path: string; x: number; y: number }
export interface DspfDeviceInfo { path: string; model: string | null; pins: number }
export interface LayoutData {
  divider: string; delimiter: string; busDelimiter: string | null; fingerDelim: string | null;
  groundNets: string[]; design: string | null; generator: string | null;
  topCellName: string | null; topPorts: string[];
  layerMap: Record<string, string>; layersPresent: boolean; layers: string[];
  nets: DspfNet[]; devicePoints: DspfDevicePoint[]; devices: DspfDeviceInfo[];
  nodeCoord: Map<string, [number, number]>;
  diagnostics: DspfDiagnostics;
}
export interface DspfDiagnostics {
  logicalLines: number; nets: number; netsMerged: number;
  devices: number; devicePinPoints: number;
  resistors: number; resistorsWithGeometry: number;
  capacitors: number; couplingCaps: number;
  ports: number; instPins: number; subnodes: number;
  pointsWithCoords: number; unitScale: number;
  unrecognized: number; warnings: string[];
}
```

- [ ] **Step 1: Failing tests** (extend `parseDspf.test.ts`; keep every existing test compiling by updating field names where the type changed — `data.devices` becomes `data.devicePoints` where positions are asserted)

```ts
test('net totalCap parses engineering suffixes (xACT)', () => {
  const d = parseDspf('*|DELIMITER :\n*|NET N1 0.259853f\n*|S (N1:1 1.0 2.0)\n');
  assert.equal(d.nets[0].totalCap, 0.259853e-15);
});

test('GROUND_NET marks nets and accepts multiple names', () => {
  const d = parseDspf('*|GROUND_NET GND VSS2\n*|NET GND 1e-15\n*|S (GND:1 0 0)\n');
  assert.deepEqual(d.groundNets, ['GND', 'VSS2']);
  assert.equal(d.nets[0].isGround, true);
});

test('DeviceFingerDelim is read and unquoted', () => {
  const d = parseDspf('*|DeviceFingerDelim "@"\n');
  assert.equal(d.fingerDelim, '@');
});

test('duplicate *|NET sections merge', () => {
  const d = parseDspf('*|NET A 1e-15\n*|S (A:1 0 0)\n*|NET A 1e-15\n*|S (A:2 1 1)\n');
  assert.equal(d.nets.length, 1);
  assert.equal(d.nets[0].subnodes.length, 2);
  assert.equal(d.diagnostics.netsMerged, 1);
});

test('*|I captures instance identity even with no coords (xACT)', () => {
  const d = parseDspf('*|DIVIDER |\n*|DELIMITER :\n*|NET X1|n 1f\n*|I (X1|M3:g X1|M3 g B 0.0)\n');
  const ip = d.nets[0].instPins[0];
  assert.equal(ip.inst, 'X1|M3');
  assert.equal(ip.pin, 'g');
  assert.equal(ip.pinType, 'B');
  assert.equal(ip.x, null);
});

test('*|P captures pinType and cap, with and without coords', () => {
  const d = parseDspf('*|NET A 1f\n*|P (A X 0 2.07 0.21)\n*|P (B I 0.0)\n');
  assert.equal(d.nets[0].ports[0].pinType, 'X');
  assert.deepEqual([d.nets[0].ports[0].x, d.nets[0].ports[0].y], [2.07, 0.21]);
  assert.equal(d.nets[0].ports[1].x, null);
});

test('.SUBCKT records top cell name and ports', () => {
  const d = parseDspf('.SUBCKT  TOP A B VSS\n*|NET A 1f\n');
  assert.equal(d.topCellName, 'TOP');
  assert.deepEqual(d.topPorts, ['A', 'B', 'VSS']);
});

test('unique devices dedupe from *|I; pin points stay per-pin', () => {
  const d = parseDspf([
    '*|DELIMITER :', '*|NET N 1f',
    '*|I (M1:d M1 d B 0 1 1)', '*|I (M1:g M1 g B 0 2 2)', '*|I (M2:d M2 d B 0 3 3)',
  ].join('\n'));
  assert.equal(d.devices.length, 2);
  assert.equal(d.devicePoints.length, 3);
  assert.equal(d.diagnostics.devices, 2);
  assert.equal(d.diagnostics.devicePinPoints, 3);
});

test('global node-coordinate index covers ports, subnodes, inst pins', () => {
  const d = parseDspf('*|NET A 1f\n*|P (A X 0 5 6)\n*|S (A:1 7 8)\n*|I (M1:d M1 d B 0 9 10)\n');
  assert.deepEqual(d.nodeCoord.get('A'), [5, 6]);
  assert.deepEqual(d.nodeCoord.get('A:1'), [7, 8]);
  assert.deepEqual(d.nodeCoord.get('M1:d'), [9, 10]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/layout-viewer/dspf/parseDspf.test.ts`
Expected: FAIL (type + behavior).

- [ ] **Step 3: Implement**

`tokens.ts` — extend `ParenInfo` so callers see the raw fields:

```ts
export interface ParenInfo { name: string; rest: string[]; x: number | null; y: number | null; params: Map<string, string> }
// parseParenPayload: return { name, rest, x, y, params } — rest is the full
// non-param token list (name at rest[0]). Coordinate extraction unchanged:
// $x/$y params first, else the LAST TWO numeric tokens.
```

`parseDspf.ts` — full replacement of the directive switch and bookkeeping (complete file rewrite; key parts):

```ts
const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');

// header
case '*|DIVIDER': data.divider = rest.split(/\s+/)[0] || '/'; break;
case '*|DELIMITER': data.delimiter = rest.split(/\s+/)[0] || ':'; break;
case '*|BUSBIT':
case '*|BUS_DELIMITER': data.busDelimiter = unquote(rest.split(/\s+/)[0] ?? '') || null; break;
case '*|DEVICEFINGERDELIM': data.fingerDelim = unquote(rest.trim()) || null; break;
case '*|GROUND_NET': for (const g of rest.split(/\s+/).filter(Boolean)) data.groundNets.push(unquote(g)); break;
case '*|DESIGN': data.design = unquote(rest) || null; break;
case '*|DSPF': case '*|PROGRAM': case '*|VERSION':
  data.generator = (data.generator ? data.generator + ' ' : '') + unquote(rest); break;
case '*|DATE': case '*|VENDOR': case '*|GLOBAL_TEMPERATURE': case '*|OPERATING_TEMPERATURE':
  break; // recognized; nothing to keep

// nets: merge by name
case '*|NET': {
  const tok = rest.split(/\s+/);
  const name = unquote(tok[0] ?? '');
  const cap = tok[1] !== undefined ? parseSpiceNumber(tok[1]) : NaN;
  const existing = netByName.get(name);
  if (existing) { net = existing; diag.netsMerged++; }
  else {
    net = { name, totalCap: Number.isFinite(cap) ? cap : null,
      isGround: groundSet.has(name),
      ports: [], subnodes: [], instPins: [], resistors: [], capacitors: [] };
    netByName.set(name, net); data.nets.push(net); diag.nets++;
  }
  break;
}

// *|P → DspfPort { name, pinType: rest[1] ?? null, cap: num(rest[2]), x, y, layer }
// *|S → DspfPoint (unchanged shape)
// *|I → DspfInstPin { name: rest[0], inst: rest[1] ?? stripPin(rest[0], delim),
//        pin: rest[2] ?? '', pinType: rest[3] ?? null, cap: num(rest[4]), x, y, layer }
//   devices: uniqueDevices Map<path, DspfDeviceInfo> keyed by inst (raw);
//   devicePoints: push {path: inst, x, y} when coords exist.
// every point with coords ALSO goes into data.nodeCoord (first write wins).
```

`.SUBCKT` handling replaces the blanket `.`-skip:

```ts
if (head === '.') {
  const tok = splitTokens(line);
  const kw = tok[0].toUpperCase();
  if (kw === '.SUBCKT' && data.topCellName === null) {
    data.topCellName = tok[1] ?? null;
    data.topPorts = tok.slice(2);
  }
  return; // .ENDS/.END/.PARAM etc: structure not needed
}
```

Ground nets declared but never sectioned still appear: after the parse loop,

```ts
for (const g of data.groundNets) {
  if (!netByName.has(g)) {
    const ghost: DspfNet = { name: g, totalCap: null, isGround: true,
      ports: [], subnodes: [], instPins: [], resistors: [], capacitors: [] };
    netByName.set(g, ghost); data.nets.push(ghost); diag.nets++;
  } else { netByName.get(g)!.isGround = true; }
}
```

CLKGEN device fallback (no `*|I` coords anywhere): unchanged in spirit but now populates BOTH `devices` (dedup by stripped path) and `devicePoints`.

- [ ] **Step 4: Run the dspf test files**

Run: `node --import tsx --test "src/layout-viewer/dspf/*.test.ts"`
Expected: PASS after updating pre-existing assertions to the new field names (`devicePoints`, `ports[0].name`…).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/model.ts src/layout-viewer/dspf/ src/layout-viewer/correlate.ts
git commit -m "feat(dspf): full header/net-section coverage — ground nets, finger delim, merged nets, instance identity, node index"
```

(`correlate.ts` compiles against renamed fields in this commit; behavior upgrades land in Task 5.)

---

### Task 4: DSPF elements + instance-section device statements

**Files:**
- Modify: `src/layout-viewer/dspf/elements.ts` (+`parseDeviceStatement`)
- Modify: `src/layout-viewer/dspf/parseDspf.ts` (element/device dispatch, coupling detection)
- Modify: `src/layout-viewer/dspf/elements.test.ts`, `parseDspf.test.ts`

**Interfaces:**
- Produces: `parseDeviceStatement(tokens: string[]): { name: string; nodes: string[]; model: string | null } | null`; capacitor classification `coupling` now means "b-node belongs to a different net".

- [ ] **Step 1: Failing tests**

```ts
// elements.test.ts
test('bare $flags on R lines are tolerated (Quantus $active)', () => {
  const r = parseResistor(splitTokens('Reb_2_B6000 AVRH#1 AVRH#3 0.0001 $active $W=0.006'), () => null);
  assert.equal(r!.a, 'AVRH#1');
  assert.equal(r!.b, 'AVRH#3');
  assert.equal(r!.value, 0.0001);
  assert.equal(r!.width, 0.006);
});

test('R value accepts engineering suffix', () => {
  const r = parseResistor(splitTokens('R1 a b 1.5k'), () => null);
  assert.equal(r!.value, 1500);
});

test('device statement: name, nodes, trailing model, params skipped', () => {
  const dev = parseDeviceStatement(splitTokens('D60_unmatched D60_unmatched#POS D60_unmatched#NEG nwdio AREA=4.7e-12 PJ=1.1e-05'));
  assert.equal(dev!.name, 'D60_unmatched');
  assert.deepEqual(dev!.nodes, ['D60_unmatched#POS', 'D60_unmatched#NEG']);
  assert.equal(dev!.model, 'nwdio');
});

// parseDspf.test.ts
test('coupling cap = b node on a foreign net; ground cap is not coupling', () => {
  const d = parseDspf([
    '*|DELIMITER :', '*|GROUND_NET 0', '*|NET A 1f', '*|S (A:1 0 0)',
    'C1 A:1 0 1f',        // ground cap
    'C2 A:1 A:2 1f',      // same-net cap
    'C3 A:1 B:9 1f',      // coupling to net B
  ].join('\n'));
  const caps = d.nets[0].capacitors;
  assert.deepEqual(caps.map(c => c.coupling), [false, false, true]);
  assert.equal(d.diagnostics.couplingCaps, 1);
});

test('instance-section devices merge into the device list with models', () => {
  const d = parseDspf([
    '*|DELIMITER #', '*|NET N 1f', '*|I (M7#d M7 d B 0 1 2)',
    '*Instance Section',
    'M7 M7#d M7#g nch_mac l=6e-9', 'D60 D60#POS D60#NEG nwdio AREA=1',
  ].join('\n'));
  assert.equal(d.devices.length, 2);
  assert.equal(d.devices.find(x => x.path === 'M7')!.model, 'nch_mac');
  assert.equal(d.devices.find(x => x.path === 'D60')!.model, 'nwdio');
});
```

- [ ] **Step 2: Run to verify failure** — `node --import tsx --test "src/layout-viewer/dspf/*.test.ts"` FAILS.

- [ ] **Step 3: Implement**

`elements.ts`:
- `parseKeyVals` already routes `$active` (no `=`) into `rest` — resistor/capacitor take `a=rest[0], b=rest[1], value=parseSpiceNumber(rest[2])`; ignore later bare flags. (`$W=0.006` → `params.w` — already the `width` source.)
- Add:

```ts
export function parseDeviceStatement(tokens: string[]): { name: string; nodes: string[]; model: string | null } | null {
  if (tokens.length < 2) return null;
  const name = tokens[0];
  const { rest } = parseKeyVals(tokens.slice(1));
  if (rest.length === 0) return null;
  // last non-param token is the model; everything before it is node refs
  const model = rest.length >= 2 ? rest[rest.length - 1] : null;
  const nodes = rest.slice(0, model ? -1 : undefined);
  return { name, nodes, model };
}
```

`parseDspf.ts` dispatch after the `r`/`c` branches (replaces the "ignored" comment):

```ts
// device statements (m/x/d/q/…): identity + model for the abstract map.
// Terminal nodes are subnode refs; coords resolve via nodeCoord later.
const dev = parseDeviceStatement(splitTokens(line));
if (dev) {
  const known = uniqueDevices.get(dev.name);
  if (known) { if (!known.model && dev.model) known.model = dev.model; }
  else uniqueDevices.set(dev.name, { path: dev.name, model: dev.model, pins: dev.nodes.length });
}
```

Coupling classification in the `c === 'c'` branch:

```ts
const sameNet = (node: string, netName: string) =>
  node === netName || node.startsWith(netName + data.delimiter);
cap.coupling = cap.b !== '' && cap.b !== '0' && !groundSet.has(cap.b) && !sameNet(cap.b, net.name);
```

- [ ] **Step 4: Run tests** — PASS. Also spot-check no regression: `node --import tsx --test "src/layout-viewer/**/*.test.ts"`.

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/
git commit -m "feat(dspf): element robustness (bare flags, suffixes) + instance-section device statements"
```

---

### Task 5: correlate() — honest devices, reliable net→block mapping, physical-only blocks, cross-section skeleton

**Files:**
- Modify: `src/layout-viewer/correlate.ts`
- Modify: `src/layout-viewer/model.ts` (`LayoutInstance` gains `master: string | null; origin: 'cdl' | 'dspf'`; `LayoutNet` gains `totalCap: number | null; isGround: boolean; ports: number`; stats gain `devicesUnique: number; physicalBlocks: number`)
- Modify: `src/layout-viewer/correlate.test.ts`, `__fixtures__/fixtures.ts` (nets in fixtures get the new fields via the parse helper — fixtures build LayoutData through `parseDspf`, so mostly automatic)

**Interfaces:**
- Produces: `LayoutModel` with `instances` including `origin:'dspf'` fallback blocks (ids prefixed `dspf:`), enriched nets, `stats.devicesUnique`, `stats.physicalBlocks`.
- `enumerateHierarchy` nodes carry `master` so instances get it.

- [ ] **Step 1: Failing tests (`correlate.test.ts`)**

```ts
test('device stats count unique devices, not pin points', () => {
  const design = makeDesign('TOP', { TOP: [['XA', 'LEAF']], LEAF: [] });
  const data = parseDspf([
    '*|DELIMITER :', '*|DIVIDER /', '*|NET N 1f',
    '*|I (XA/M1:d XA/M1 d B 0 1 1)', '*|I (XA/M1:g XA/M1 g B 0 2 2)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.equal(m.stats.devicesUnique, 1);
  assert.equal(m.stats.devicesMatched, 1);       // unique-device accounting
  assert.equal(m.instances.find(i => i.id === 'xa')!.deviceCount, 1);
});

test('net→instances resolves through *|I inst identity even with no coords', () => {
  const design = makeDesign('TOP', { TOP: [['X1', 'LEAF']], LEAF: [] });
  const data = parseDspf([
    '*|DIVIDER |', '*|DELIMITER :', '*|NET n 1f',
    '*|S (n:1 1 1)', '*|I (X1|M3:g X1|M3 g B 0.0)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.deepEqual(m.nets[0].instances, ['x1']);
});

test('unmatched multi-segment paths become physical-only blocks', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DIVIDER |', '*|DELIMITER :', '*|NET n 1f',
    '*|I (X100|M0:d X100|M0 d B 0 1 1)', '*|I (X100|M1:d X100|M1 d B 0 2 2)',
  ].join('\n'));
  const m = correlate(design, data);
  const phys = m.instances.filter(i => i.origin === 'dspf');
  assert.equal(phys.length, 1);
  assert.equal(phys[0].label, 'X100');
  assert.equal(phys[0].deviceCount, 2);
  assert.equal(m.stats.physicalBlocks, 1);
  assert.deepEqual(phys[0].bbox, [1, 1, 2, 2]);
});

test('dummy devices do NOT form physical blocks', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DIVIDER /', '*|DELIMITER #', '*|NET n 1f',
    '*|I (XX9/M0_unmatched#d XX9/M0_unmatched d B 0 1 1)',
  ].join('\n'));
  const m = correlate(design, data);
  assert.equal(m.instances.filter(i => i.origin === 'dspf').length, 0);
});

test('connections resolve endpoints across sections via the global node index', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf([
    '*|DELIMITER :', '*|NET A 1f', '*|P (A X 0 5 6)', '*|S (A:1 7 8)',
    'R1 A A:1 10',
  ].join('\n'));
  const m = correlate(design, data);
  assert.deepEqual(m.connections[0].points, [[5, 6], [7, 8]]);
});

test('net enrichment: totalCap, isGround, ports flow through', () => {
  const design = makeDesign('TOP', { TOP: [] });
  const data = parseDspf('*|GROUND_NET G\n*|NET G 2f\n*|P (G X 0 1 1)\n');
  const m = correlate(design, data);
  assert.equal(m.nets[0].totalCap, 2e-15);
  assert.equal(m.nets[0].isGround, true);
  assert.equal(m.nets[0].ports, 1);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in `correlate.ts`**

Key changes (complete behaviors):

```ts
// 1. enumerateHierarchy: nodes carry master (cell name for the instance), root master null.
export interface HierNode { id: string; label: string; depth: number; segs: string[]; master: string | null }

// 2. Device accounting iterates data.devices (unique) for stats/counts, and
//    data.devicePoints for bbox extension. attach() extends boxes per PIN POINT
//    (same as today) but nodeCount increments once per DEVICE:
//    - group devicePoints by path first:
const pointsByDevice = new Map<string, Array<{ x: number; y: number }>>();
for (const p of data.devicePoints) {
  (pointsByDevice.get(p.path) ?? pointsByDevice.set(p.path, []).get(p.path)!).push(p);
}
//    - for each unique device (union of data.devices and pointsByDevice keys):
//      segs = normSegments(path); try attach as-is, retry with ^xx collapsed;
//      matched → devicesMatched++; every ancestor node's bbox extends with ALL
//      the device's points, nodeCount += 1 (device, not pin).
//    - unmatched, non-dummy, segs.length >= 2, has points → collect for
//      physical fallback keyed by segs[0] (original-case label from the raw
//      path's first segment).

// 3. Physical-only blocks (after the device loop):
for (const [seg0, group] of physGroups) {
  const box = emptyBbox();
  for (const pt of group.points) extendBbox(box, pt.x, pt.y);
  if (!bboxValid(box)) continue;
  instances.push({
    id: `dspf:${seg0}`, label: group.label, master: null, origin: 'dspf',
    depth: 1, deviceCount: group.deviceCount, bbox: box,
  });
  unionInto(extent, box);
}

// 4. Net→instances: union of
//    (a) subnode/port name prefixes (existing walk), and
//    (b) instPins: normSegments(ip.inst) prefix-walk (works with no coords),
//    (c) physical blocks: first segment of unmatched inst paths → `dspf:` id.

// 5. Connections: coord lookup via data.nodeCoord (global), falling back to
//    the per-net map — resistor slab geometry ($X/$Y/$X2/$Y2) still wins.

// 6. Instance construction from HierNode keeps master and origin:'cdl'.

// 7. stats: devicesUnique = union size; devicesTotal stays devicePoints-based
//    naming is misleading — devicesTotal = unique devices; add
//    devicePinPoints via diagnostics (already there). physicalBlocks = count.
```

- [ ] **Step 4: Run tests** — `node --import tsx --test "src/layout-viewer/**/*.test.ts"` PASS (update the handful of existing correlate assertions that counted pin-points as devices: n16g-style doubled-X test still passes because attach logic is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/
git commit -m "feat(correlate): unique-device accounting, coordless net→block mapping, physical-only DSPF blocks, global node index for skeletons"
```

---

### Task 6: Store/UI plumbing for the enriched model

**Files:**
- Modify: `src/store/viewerStore.ts` (no shape change needed — verify `loadLayout` still correlates; expose nothing new)
- Modify: `src/store/viewerStore.layout.test.ts` (compile against new model fields)
- Modify: `src/components/HierarchyPanel.tsx:74-79` (unchanged logic; verify `dspf:` ids never collide with `pathToInstanceId` output — they can't, CDL ids never contain `:`)

**Interfaces:** none new — this task is the compile-and-verify checkpoint between the data layer and the canvas work.

- [ ] **Step 1: Run the full fast suite + typecheck**

Run: `npm run test:layout && npx tsc -b`
Expected: PASS/clean. Fix any compile fallout (e.g. `LayoutInstance` literals in tests missing `master`/`origin` — add `master: null, origin: 'cdl'`).

- [ ] **Step 2: Commit**

```bash
git add -A src/
git commit -m "chore(layout): compile fallout for enriched layout model"
```

---

### Task 7: Canvas to mockup spec — always-on layered connections, block-net boxes, net picking, physical-block styling

**Files:**
- Modify: `src/components/layout/LayoutCanvas.tsx`
- Modify: `src/components/layout/pick.ts` (+`pickNetBox`)
- Modify: `src/components/layout/pick.test.ts`
- Modify: `src/index.css` (`.layout-conn-note` chip)

**Interfaces:**
- Produces: `pickNetBox(nets: Array<{name: string; bbox: Bbox}>, wx: number, wy: number, tol: number): string | null` — returns the net whose bbox EDGE is within `tol` world units.
- Draw rules (the spec for this task):
  1. Connections draw for every layer-visible net when the design's total segment count ≤ 24 000; otherwise only the selected net's. Selected net's polylines are `lineWidth 3`, others `1.6`; when a net is selected all other connections dim to `alpha 0.12` (mockup behavior).
  2. Selecting an instance ALSO draws dashed net bboxes for every net touching it (green `#5fd0a0`, `rgba` fill 0.08), the way the mockup does; the selected net's own bbox stays yellow.
  3. Physical-only (`origin:'dspf'`) blocks draw with `setLineDash([5,4])`, hue `#e0a3ff`, and a `◇` prefix on the label.
  4. Click picking: shown net-box edges first (8 px tolerance), then instances.

- [ ] **Step 1: Failing pick tests**

```ts
// pick.test.ts additions
test('pickNetBox hits only near the box edge, not deep inside', () => {
  const nets = [{ name: 'N', bbox: [0, 0, 10, 10] as Bbox }];
  assert.equal(pickNetBox(nets, 0.1, 5, 0.5), 'N');   // near left edge
  assert.equal(pickNetBox(nets, 5, 5, 0.5), null);     // center — not a hit
  assert.equal(pickNetBox(nets, 10.4, 5, 0.5), 'N');   // just outside right edge
  assert.equal(pickNetBox(nets, 20, 5, 0.5), null);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`pick.ts`:

```ts
export function pickNetBox(
  nets: Array<{ name: string; bbox: Bbox }>, wx: number, wy: number, tol: number,
): string | null {
  for (const n of nets) {
    const [x0, y0, x1, y1] = n.bbox;
    const withinOuter = wx >= x0 - tol && wx <= x1 + tol && wy >= y0 - tol && wy <= y1 + tol;
    const withinInner = wx >= x0 + tol && wx <= x1 - tol && wy >= y0 + tol && wy <= y1 - tol;
    if (withinOuter && !withinInner) return n.name;
  }
  return null;
}
```

`LayoutCanvas.tsx` `draw()` restructure (complete rules from the Interfaces block):

```ts
const SEG_BUDGET = 24_000;
// group connections per net once per draw:
const connsByNet = new Map<string, LayoutConnection[]>();
let totalSegs = 0;
for (const c of model.connections) {
  (connsByNet.get(c.net) ?? connsByNet.set(c.net, []).get(c.net)!).push(c);
  totalSegs += c.points.length - 1;
}
const drawAll = totalSegs <= SEG_BUDGET;
// pass 1 — connections (under boxes):
//   if (selNet)                → all nets drawn dimmed 0.12, selNet bold 3px full alpha
//   else if (drawAll)          → all nets at 0.85 alpha, 1.6px
//   else                       → nothing (note chip explains)
// batching: accumulate Path2D per (layer color) then one stroke() each.
// pass 2 — shownNetBoxes:
//   selNet ? [selNet] : selInst ? nets touching selInst (top 12 by bbox area, desc) : []
//   drawn dashed; yellow when it IS the selected net, green otherwise; label "<name> · net".
// pass 3 — instance boxes: existing logic + origin:'dspf' styling (dashed, ◇ label, #e0a3ff).
// pass 4 — nothing (net box moved to pass 2 so blocks stay clickable on top edges).
```

`onUp` picking:

```ts
const tol = 8 / v.scale; // 8 px in world units
const netHit = pickNetBox(shownNetBoxesRef.current, wx, wy, tol);
if (netHit) { setSelection({ type: 'net', name: netHit }); return; }
const id = pickInstance(model, depthMax(layoutDepth), wx, wy);
setSelection(id !== null ? { type: 'instance', id } : null);
```

(`shownNetBoxesRef` is set inside `draw()` each frame with the same list pass 2 rendered.)

Legend/note: when `!drawAll && !selNet`, render `<div className="layout-conn-note">RC skeleton hidden at this scale ({totalSegs.toLocaleString()} segments) — select a net to trace it.</div>` inside the canvas wrap.

- [ ] **Step 4: Run tests + manual sanity**

Run: `node --import tsx --test "src/components/layout/*.test.ts"` — PASS.
Run: `npm run dev`, load `StrongARMLatch.cdl` + `StrongARMLatch_pex.dspf`: layer-colored skeleton visible immediately; select `MM15`-block → green dashed VOUTP/VDD net boxes; click a net box edge → net selection.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/ src/index.css
git commit -m "feat(layout): mockup-parity canvas — always-on layered RC skeleton, block net boxes, net-edge picking, physical-block styling"
```

---

### Task 8: Layer panel disabled state + inspector/zone完 parity

**Files:**
- Modify: `src/components/layout/LayerPanel.tsx`
- Modify: `src/components/layout/LayoutInspector.tsx`
- Modify: `src/components/layout/ZoneSelect.tsx`
- Modify: `src/index.css` (`.layer-chips.disabled`, `.chip.phys`, swatch styles)

**Interfaces:** consumes Task 5's `master`, `origin`, `totalCap`, `isGround`, `ports`, `stats.devicesUnique`, `stats.physicalBlocks`.

- [ ] **Step 1: Implement LayerPanel disabled state** (mockup `clkgen_no_layers`):

```tsx
if (!model) return null;
if (model.layers.length === 0) {
  return (
    <div className="layer-chips disabled" title="Whether a DSPF carries metal-layer tags depends on the extraction options. This file has none — connections draw in a neutral color.">
      <span className="layer-note">layers: not in this DSPF</span>
    </div>
  );
}
```

- [ ] **Step 2: LayoutInspector**

Instance view adds:

```tsx
<div className="det-sub">{i.master ? `master ${i.master} · ` : ''}depth {i.depth}</div>
{i.origin === 'dspf' && (
  <div className="warn-note">◇ Physical-only block — present in the DSPF but not matched to any CDL instance (extractor-renamed hierarchy).</div>
)}
```

Net view adds (before Subnodes):

```tsx
{n.isGround && <div className="det-sub">declared ground net</div>}
{n.totalCap !== null && (
  <div className="kv"><span className="k">Total cap</span><span className="v">{(n.totalCap * 1e15).toFixed(3)} fF</span></div>
)}
<div className="kv"><span className="k">Ports</span><span className="v">{n.ports}</span></div>
```

Layer chips get color swatches (mockup): `<span className="chip lay"><i style={{ background: LAYER_COLOR[l] ?? '#6b7689' }} />{l}</span>` (share `LAYER_COLOR` by exporting it from `LayerPanel.tsx` and importing in both canvas and inspector — single source).

Overview (no selection) adds:

```tsx
<div className="kv"><span className="k">Devices (unique)</span><span className="v">{st.devicesUnique}</span></div>
{st.physicalBlocks > 0 && <div className="kv"><span className="k">Physical-only blocks</span><span className="v">{st.physicalBlocks}</span></div>}
{data-groundNets…: <div className="kv"><span className="k">Ground nets</span><span className="v">{groundNets.join(', ') || '—'}</span></div>}
```

(`groundNets` comes from `useViewerStore(s => s.layoutData)?.groundNets`.)

- [ ] **Step 3: ZoneSelect label per brief** — first option text becomes `Zone (from CDL)…`; include `origin==='cdl'` depth-1 blocks only (physical-only blocks are canvas objects, not CDL zones).

- [ ] **Step 4: Verify + commit**

Run: `npm run test:layout && npx tsc -b` — PASS/clean; `npm run dev` sanity on CLKGEN pair (disabled layer chip with tooltip, physical-only blocks visible and inspectable).

```bash
git add src/components/layout/ src/index.css
git commit -m "feat(layout): layer-panel no-layer state, inspector master/cap/ports/physical badges, CDL zone labeling"
```

---

### Task 9: Worker progress reporting

**Files:**
- Modify: `src/layout-viewer/dspf/dspf.worker.ts`, `parseDspfAsync.ts`, `src/layout-viewer/dspf/parseDspf.ts` (optional `onProgress`), `src/components/TopBar.tsx` (badge shows %)

**Interfaces:**
- `parseDspf(text, opts?: { unitScale?: number; onProgress?: (frac: number) => void })` — called every 50 000 logical lines.
- Worker message union: `{ id, progress }` interleaved before the final `{ id, ok, data }`.
- `parseDspfAsync(text, onProgress?)`.

- [ ] **Step 1: Implement** (no isolated unit test — exercised by the integration script; the worker protocol change is 20 lines). `TopBar` state: `const [dspfProgress, setDspfProgress] = useState<number | null>(null)`; badge text `Parsing… {Math.round(p*100)}%` while parsing.

- [ ] **Step 2: Verify with CLKGEN (22 MB) in `npm run dev` — badge counts up; UI stays responsive.**

- [ ] **Step 3: Commit**

```bash
git add src/layout-viewer/dspf/ src/components/TopBar.tsx
git commit -m "feat(dspf): parse-progress reporting from the worker (22 MB files)"
```

---

### Task 10: Real-file validation harness

**Files:**
- Create: `scripts/validate-real.mjs`
- Modify: `package.json` (`"validate:real": "node scripts/validate-real.mjs"`)

**Interfaces:** consumes the public APIs only (`parseDspf`, `correlate`, pyodide adapter). Loads the three pairs from `~/Downloads/Abstract_Layout_Viewer_Handoff/`; skips gracefully (exit 0 with a notice) when the directory is absent so CI/other machines don't break.

- [ ] **Step 1: Write the script**

```js
// scripts/validate-real.mjs — parse+correlate the three real handoff pairs and
// assert the layer story + correlation health the brief demands.
// tsx can't host pyodide, so CDL parsing runs here in plain node (pyodide) and
// the TS modules load through tsx's ESM API.
import { readFileSync, existsSync } from 'fs';
import { loadPyodide } from 'pyodide';

const ROOT = new URL('..', import.meta.url).pathname;
const HANDOFF = `${process.env.HOME}/Downloads/Abstract_Layout_Viewer_Handoff`;
if (!existsSync(HANDOFF)) { console.log('handoff samples not present — skipping'); process.exit(0); }

const { tsImport } = await import('tsx/esm/api');
const { parseDspf } = await tsImport('../src/layout-viewer/dspf/parseDspf.ts', import.meta.url);
const { correlate } = await tsImport('../src/layout-viewer/correlate.ts', import.meta.url);
const { refineNetKinds } = await tsImport('../src/parser/netKinds.ts', import.meta.url);

const pyodide = await loadPyodide();
await pyodide.loadPackage('micropip');
await pyodide.pyimport('micropip').install('eda-netlist-parser');
pyodide.runPython(readFileSync(`${ROOT}src/parser/pyodide/cdl_adapter.py`, 'utf-8'));
const parseCdlPy = pyodide.globals.get('parse_cdl');
const parseCDL = (text) => {
  const parsed = JSON.parse(parseCdlPy(text));
  const design = { cells: new Map(Object.entries(parsed.cells)), topCell: parsed.topCell, warnings: parsed.warnings };
  refineNetKinds(design);
  return design;
};

let failures = 0;
const expect = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const PAIRS = [
  ['StrongARMLatch.cdl', 'StrongARMLatch_pex.dspf'],
  ['n16g_CLK_PRE_BUF.cdl', 'n16g_CLK_PRE_BUF_quantus.dspf'],
  ['CLKGEN_icnet.cdl', 'CLKGEN_xact.dspf'],
];
for (const [cdlName, dspfName] of PAIRS) {
  console.log(`\n── ${dspfName} ${'─'.repeat(Math.max(0, 56 - dspfName.length))}`);
  const design = parseCDL(readFileSync(`${HANDOFF}/sample_cdl/${cdlName}`, 'utf-8'));
  const t0 = Date.now();
  const data = parseDspf(readFileSync(`${HANDOFF}/sample_dspf/${dspfName}`, 'utf-8'));
  const model = correlate(design, data);
  const d = data.diagnostics, st = model.stats;
  console.log(`  parse ${Date.now() - t0} ms · divider "${data.divider}" delimiter "${data.delimiter}" finger "${data.fingerDelim ?? '—'}"`);
  console.log(`  nets ${d.nets} (merged ${d.netsMerged}) · devices ${st.devicesUnique} · pinPoints ${d.devicePinPoints} · R ${d.resistors} · C ${d.capacitors} (${d.couplingCaps} coupling)`);
  console.log(`  layers [${data.layers.join(', ')}] · ground [${data.groundNets.join(', ')}]`);
  console.log(`  matched ${st.devicesMatched} dummy ${st.devicesDummy} topLevel ${st.devicesTopLevel} hierMiss ${st.devicesHierMiss} · blocks ${st.instancesMatched}/${st.instancesTotal} +${st.physicalBlocks} physical`);
  console.log(`  connections ${model.connections.length} · warnings ${[...d.warnings, ...model.warnings].length}`);

  if (dspfName.startsWith('StrongARM')) {
    expect('full layer story', data.layersPresent && ['poly', 'metal1', 'metal2'].every(l => data.layers.includes(l)));
    expect('ground net GND', data.groundNets.includes('GND'));
    expect('every device placed somewhere', st.devicesUnique > 0 && st.devicesHierMiss === 0);
    expect('RC skeleton exists', model.connections.length > 500);
  }
  if (dspfName.startsWith('n16g')) {
    expect('ground net 0', data.groundNets.includes('0'));
    expect('finger delim @', data.fingerDelim === '@');
    expect('all real devices correlate (X-collapse)', st.devicesHierMiss === 0);
    expect('all 41 CDL blocks placed', st.instancesMatched === st.instancesTotal, `${st.instancesMatched}/${st.instancesTotal}`);
    const top = design.cells.get(design.topCell);
    expect('AVRH classified power', top.nets.find(n => n.name === 'AVRH')?.kind === 'power');
    expect('VSS classified ground', top.nets.find(n => n.name === 'VSS')?.kind === 'ground');
  }
  if (dspfName.startsWith('CLKGEN')) {
    expect('layerless story', !data.layersPresent);
    expect('totalCap suffix parsed', data.nets[0].totalCap !== null);
    expect('physical-only blocks surfaced', st.physicalBlocks > 0);
    expect('top-name nets still map', model.nets.some(n => n.instances.length > 0));
  }
}
console.log(failures ? `\n${failures} expectation(s) FAILED` : '\nall real-file expectations hold');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run** `npm run validate:real` — all expectations hold. Iterate on parser/correlate until they do; any legitimate discovery (e.g. n16g layer list) gets encoded back into these expectations.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-real.mjs package.json
git commit -m "test(real): three-extractor validation harness asserting the brief's layer + correlation story"
```

---

### Task 11: Full-suite verification + docs

**Files:**
- Modify: `ARCHITECTURE.md` (DSPF section: directives covered, device identity, physical-only blocks, net-kind pipeline)
- Modify: `docs/superpowers/plans/2026-07-01-dspf-full-build-and-cdl-supply-fixes.md` (check boxes)

- [ ] **Step 1: Run everything**

```bash
npm run test:layout && npm test && npm run validate:real && npm run build
```
Expected: all green, build clean.

- [ ] **Step 2: Update ARCHITECTURE.md** — extend the parser section with: net-kind refinement pipeline (name → bulk topology → port propagation), DSPF directive coverage table, unique-device identity, physical-only block fallback, connection budget.

- [ ] **Step 3: Final commit**

```bash
git add ARCHITECTURE.md docs/
git commit -m "docs: architecture notes for net-kind pipeline and full DSPF coverage"
```

## Self-Review

- **Spec coverage:** brief §2 viewer behaviors → Tasks 5/7/8 (boxes, depth, zone, inspect, connections-by-layer); §5 DSPF realities → Tasks 3/4 (directives, header, suffixes, honest skeleton); §6 correlation → Task 5; §7 JSON model → LayoutModel parity via Tasks 3–6; mockups' no-layer story → Task 8; boss complaints 1/2/3/9 → Tasks 1/2 (+ deploy note); CLKGEN gap → Task 5 physical-only blocks; 22 MB preprocessing → worker kept + Task 9 progress.
- **Placeholder scan:** none — every step has code or an exact command.
- **Type consistency:** `DspfDevicePoint/DspfDeviceInfo` introduced Task 3, consumed Task 5; `origin`/`master` introduced Task 5, consumed Tasks 7/8; `pickNetBox` signature matches its test.
