# Abstract Layout Viewer v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second "layout" app mode to the CDL Schematic Viewer that correlates a CDL netlist with a DSPF parasitic file and draws an abstract physical map (instance bounding boxes, net bounding boxes, layer-tagged RC-skeleton connections) on a Canvas2D coordinate canvas.

**Architecture:** Pure data pipeline `parseDspf(text) → LayoutData`, then `correlate(Design, LayoutData) → LayoutModel`, rendered by a Canvas2D `LayoutCanvas`. A `appMode` flag in the existing Zustand store toggles between the untouched schematic view and the new layout view. DSPF parsing runs in a web worker. Correlation, parsing, and the view transform are pure functions with unit tests.

**Tech Stack:** TypeScript, React 19, Zustand, Canvas2D, web worker (Vite `new Worker(new URL(...))`). Tests via Node's built-in test runner through `tsx` (`node --import tsx --test`). The existing CDL parser (Pyodide `eda-netlist-parser`) and its `npm test` suite are unchanged.

## Global Constraints

- **Do NOT read** `~/Downloads/Abstract_Layout_Viewer_Handoff/sample_cdl/` or `sample_dspf/`. All tests use hand-authored synthetic fixtures.
- The existing **65 CDL adapter tests (`npm test`) must stay green** the entire time.
- Schematic mode behavior must be **unchanged** — layout is additive.
- New layout tests run via: `node --import tsx --test "src/layout-viewer/**/*.test.ts" "src/components/layout/**/*.test.ts"`.
- Coordinates are µm; bbox tuples are always `[minx, miny, maxx, maxy]`.
- No new runtime dependencies (Canvas2D + workers are built-in). `tsx` is already a devDependency.
- Reuse existing CSS tokens: `--inst #4f9dff`, `--net #5fd0a0`, `--sel #ffd23f`, `--bg`, `--panel`, `--line`, `--txt`, `--txt-dim`, `--txt-faint`.

---

## File Structure

**Create:**
- `src/layout-viewer/model.ts` — `LayoutData`, `LayoutModel` types + bbox helpers.
- `src/layout-viewer/dspf/parseDspf.ts` — pure DSPF text → `LayoutData`.
- `src/layout-viewer/dspf/parseDspf.test.ts`
- `src/layout-viewer/dspf/dspf.worker.ts` — worker shell calling `parseDspf`.
- `src/layout-viewer/dspf/parseDspfAsync.ts` — main-thread async wrapper.
- `src/layout-viewer/correlate.ts` — pure `(Design, LayoutData) → LayoutModel` + helpers.
- `src/layout-viewer/correlate.test.ts`
- `src/layout-viewer/__fixtures__/fixtures.ts` — synthetic `Design`/`LayoutData` builders for tests.
- `src/components/layout/transform.ts` — pure world↔screen view transform.
- `src/components/layout/transform.test.ts`
- `src/components/layout/pick.ts` — pure hit-testing.
- `src/components/layout/pick.test.ts`
- `src/components/layout/LayoutCanvas.tsx` — Canvas2D render + interaction.
- `src/components/layout/DepthSelector.tsx`
- `src/components/layout/LayerPanel.tsx`
- `src/components/layout/LayoutInspector.tsx`
- `src/components/layout/LayoutView.tsx` — composes the layout-mode shell body.

**Modify:**
- `package.json` — add `test:layout` script.
- `src/store/viewerStore.ts` — add `appMode` + layout state/actions.
- `src/App.tsx` — render `LayoutView` when `appMode === 'layout'`.
- `src/components/TopBar.tsx` — mode toggle + "Add DSPF" button.
- `src/index.css` — layout-mode styles.

---

## Task 1: Layout model types + bbox helpers

**Files:**
- Create: `src/layout-viewer/model.ts`
- Create: `src/layout-viewer/model.test.ts`
- Modify: `package.json` (add `test:layout` script)

**Interfaces:**
- Produces: the `Bbox` type and all `LayoutData`/`LayoutModel` interfaces below; helpers `emptyBbox()`, `extendBbox(b,x,y)`, `bboxValid(b)`, `bboxSize(b)`, `bboxArea(b)`, `unionInto(a,b)`. Every later task imports from here.

- [ ] **Step 1: Add the test script to package.json**

In `package.json` `"scripts"`, add after the `"test"` line:
```json
    "test:layout": "node --import tsx --test \"src/layout-viewer/**/*.test.ts\" \"src/components/layout/**/*.test.ts\"",
```

- [ ] **Step 2: Write the failing test**

Create `src/layout-viewer/model.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBbox, extendBbox, bboxValid, bboxSize, bboxArea } from './model';

test('emptyBbox is invalid until extended', () => {
  const b = emptyBbox();
  assert.equal(bboxValid(b), false);
});

test('extendBbox grows to contain points', () => {
  const b = emptyBbox();
  extendBbox(b, 3, -7.5);
  extendBbox(b, 21.5, 17);
  assert.deepEqual(b, [3, -7.5, 21.5, 17]);
  assert.equal(bboxValid(b), true);
  assert.deepEqual(bboxSize(b), [18.5, 24.5]);
  assert.equal(bboxArea(b), 18.5 * 24.5);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:layout`
Expected: FAIL — `Cannot find module './model'`.

- [ ] **Step 4: Write the implementation**

Create `src/layout-viewer/model.ts`:
```ts
// Shared types + geometry helpers for the Abstract Layout Viewer.
// Bbox is always [minx, miny, maxx, maxy] in µm.
export type Bbox = [number, number, number, number];

// ---- DSPF parse output (design-agnostic) -------------------------------
export interface DspfSubnode { name: string; x: number; y: number }
export interface DspfResistor { a: string; b: string; layer: string | null }
export interface DspfNet {
  name: string;
  subnodes: DspfSubnode[];
  parasitics: number;          // count of R + C elements
  resistors: DspfResistor[];   // endpoints + layer, for the RC skeleton
}
export interface DspfDevice { path: string; x: number; y: number }
export interface LayoutData {
  divider: string;             // hierarchy separator from *|DIVIDER (e.g. "/")
  delimiter: string;           // pin separator from *|DELIMITER (e.g. ":")
  nets: DspfNet[];
  devices: DspfDevice[];       // coordinate-bearing device points
  layersPresent: boolean;
  layers: string[];            // distinct layer names, [] when none
}

// ---- Correlated, viewer-ready model ------------------------------------
export interface LayoutInstance {
  id: string;                  // normalized path, e.g. "xi9/xi26"
  label: string;               // leaf instance id as written in CDL
  depth: number;               // 0 = whole design, 1 = top children, ...
  deviceCount: number;
  bbox: Bbox;
}
export interface LayoutNet {
  name: string;
  bbox: Bbox;
  subnodes: number;
  parasitics: number;
  layers: string[];
  instances: string[];         // instance ids this net touches
}
export interface LayoutConnection {
  net: string;
  layer: string | null;
  points: Array<[number, number]>;
}
export interface LayoutModel {
  design: string;
  extent: Bbox;
  layers: string[];            // [] ⇒ no-layer mode
  instances: LayoutInstance[];
  nets: LayoutNet[];
  connections: LayoutConnection[];
  stats: { instancesMatched: number; instancesTotal: number; devicesMatched: number };
}

// ---- Geometry helpers --------------------------------------------------
export function emptyBbox(): Bbox { return [Infinity, Infinity, -Infinity, -Infinity]; }
export function extendBbox(b: Bbox, x: number, y: number): void {
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x;
  if (y > b[3]) b[3] = y;
}
export function bboxValid(b: Bbox): boolean { return b[0] <= b[2] && b[1] <= b[3]; }
export function bboxSize(b: Bbox): [number, number] { return [b[2] - b[0], b[3] - b[1]]; }
export function bboxArea(b: Bbox): number { return (b[2] - b[0]) * (b[3] - b[1]); }
export function unionInto(a: Bbox, b: Bbox): void {
  if (b[0] < a[0]) a[0] = b[0];
  if (b[1] < a[1]) a[1] = b[1];
  if (b[2] > a[2]) a[2] = b[2];
  if (b[3] > a[3]) a[3] = b[3];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (2 tests). Then run `npm test` — expected 65 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json src/layout-viewer/model.ts src/layout-viewer/model.test.ts
git commit -m "feat(layout): add layout model types and bbox helpers"
```

---

## Task 2: DSPF parser — header + coordinate directives

**Files:**
- Create: `src/layout-viewer/dspf/parseDspf.ts`
- Create: `src/layout-viewer/dspf/parseDspf.test.ts`

**Interfaces:**
- Consumes: `LayoutData`, `DspfNet`, `DspfSubnode` from `../model`.
- Produces: `parseDspf(text: string): LayoutData`. This task implements header (`*|DIVIDER`, `*|DELIMITER`, `*|DESIGN`), `*|NET`, and the coordinate directives `*|S` / `*|P` / `*|I`. Parasitics/layers/devices come in Task 3.

> **Format note (validation risk #1):** coordinates are the trailing two floats inside the `(...)`. Per-directive inner-token arity decides whether coords exist: `*|S` = `(name X Y)` (3 tokens), `*|P` = `(name type cap X Y)` (5), `*|I` = `(instPin inst pin type cap X Y)` (7, coords present) vs `(instPin inst pin type cap)` (5, no coords — the CLKGEN case). Detect coords as "≥ expected arity AND last two tokens are finite floats."

- [ ] **Step 1: Write the failing test**

Create `src/layout-viewer/dspf/parseDspf.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDspf } from './parseDspf';

test('reads divider/delimiter from header, defaults when absent', () => {
  const withHeader = parseDspf('*|DIVIDER |\n*|DELIMITER :\n');
  assert.equal(withHeader.divider, '|');
  assert.equal(withHeader.delimiter, ':');
  const noHeader = parseDspf('* nothing\n');
  assert.equal(noHeader.divider, '/');
  assert.equal(noHeader.delimiter, ':');
});

test('collects subnode coords per net from *|S', () => {
  const text = [
    '*|DIVIDER /',
    '*|DELIMITER :',
    '*|NET VOUTP 1.0',
    '*|S (VOUTP:1 9.94 3.81)',
    '*|S (VOUTP:2 18.69 12.86)',
  ].join('\n');
  const d = parseDspf(text);
  assert.equal(d.nets.length, 1);
  assert.equal(d.nets[0].name, 'VOUTP');
  assert.deepEqual(d.nets[0].subnodes, [
    { name: 'VOUTP:1', x: 9.94, y: 3.81 },
    { name: 'VOUTP:2', x: 18.69, y: 12.86 },
  ]);
});

test('*|I with coords yields a device; *|I without coords does not', () => {
  const text = [
    '*|NET N 1',
    '*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)',
    '*|I (X100/M2:g X100/M2 g pch 0.5)',
  ].join('\n');
  const d = parseDspf(text);
  // device path strips the pin suffix after the delimiter ":"
  assert.deepEqual(d.devices, [{ path: 'X100/M1', x: 3.99, y: 8.33 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:layout`
Expected: FAIL — `Cannot find module './parseDspf'`.

- [ ] **Step 3: Write the implementation**

Create `src/layout-viewer/dspf/parseDspf.ts`:
```ts
import type { LayoutData, DspfNet } from '../model';

// Parse the "(...)" payload of a coordinate directive. Returns the leading
// name plus X,Y when the inner-token arity and trailing floats indicate coords.
function parseParen(payload: string, minArityForCoords: number):
  { name: string; x: number; y: number } | { name: string; x: null; y: null } | null {
  const inner = payload.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return null;
  const tok = inner.split(/\s+/);
  const name = tok[0];
  if (tok.length >= minArityForCoords) {
    const x = Number(tok[tok.length - 2]);
    const y = Number(tok[tok.length - 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { name, x, y };
  }
  return { name, x: null, y: null };
}

export function parseDspf(text: string): LayoutData {
  const data: LayoutData = {
    divider: '/', delimiter: ':', nets: [], devices: [],
    layersPresent: false, layers: [],
  };
  let net: DspfNet | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('*|DIVIDER')) { data.divider = line.split(/\s+/)[1] ?? '/'; continue; }
    if (line.startsWith('*|DELIMITER')) { data.delimiter = line.split(/\s+/)[1] ?? ':'; continue; }

    if (line.startsWith('*|NET')) {
      net = { name: line.split(/\s+/)[1] ?? '', subnodes: [], parasitics: 0, resistors: [] };
      data.nets.push(net);
      continue;
    }

    if (line.startsWith('*|S')) {
      const p = parseParen(line.slice(3).trim(), 3);
      if (p && p.x !== null && net) net.subnodes.push({ name: p.name, x: p.x, y: p.y });
      continue;
    }
    if (line.startsWith('*|P')) {
      const p = parseParen(line.slice(3).trim(), 5);
      if (p && p.x !== null && net) net.subnodes.push({ name: p.name, x: p.x, y: p.y });
      continue;
    }
    if (line.startsWith('*|I')) {
      const p = parseParen(line.slice(3).trim(), 7);
      if (p && p.x !== null) {
        // device path = instance-pin name with the trailing ":pin" stripped
        const cut = p.name.lastIndexOf(data.delimiter);
        const path = cut > 0 ? p.name.slice(0, cut) : p.name;
        data.devices.push({ path, x: p.x, y: p.y });
      }
      continue;
    }
  }
  return data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/parseDspf.ts src/layout-viewer/dspf/parseDspf.test.ts
git commit -m "feat(layout): parse DSPF header and coordinate directives"
```

---

## Task 3: DSPF parser — parasitics, layers, device fallback

**Files:**
- Modify: `src/layout-viewer/dspf/parseDspf.ts`
- Modify: `src/layout-viewer/dspf/parseDspf.test.ts`

**Interfaces:**
- Produces: parasitic counting, `$layer=` extraction (`layersPresent`/`layers`/`resistors[].layer`), and the `*|S`-based device fallback when no `*|I` carried coordinates.

- [ ] **Step 1: Write the failing tests**

Append to `src/layout-viewer/dspf/parseDspf.test.ts`:
```ts
test('counts parasitics and collects layers from R lines', () => {
  const text = [
    '*|NET N 1',
    '*|S (N:1 0 0)',
    '*|S (N:2 1 1)',
    'R1 N:1 N:2 12.3 $layer=metal3',
    'C1 N:1 0 0.5',
  ].join('\n');
  const d = parseDspf(text);
  assert.equal(d.nets[0].parasitics, 2);          // 1 R + 1 C
  assert.equal(d.nets[0].resistors.length, 1);
  assert.equal(d.nets[0].resistors[0].layer, 'metal3');
  assert.equal(d.layersPresent, true);
  assert.deepEqual(d.layers, ['metal3']);
});

test('no $layer= anywhere ⇒ layersPresent false, layers []', () => {
  const d = parseDspf('*|NET N 1\nR1 N:1 N:2 5\n');
  assert.equal(d.layersPresent, false);
  assert.deepEqual(d.layers, []);
  assert.equal(d.nets[0].resistors[0].layer, null);
});

test('devices fall back to *|S names when no *|I has coords', () => {
  const text = [
    '*|DELIMITER :',
    '*|NET N 1',
    '*|S (X9/X26/M1:s 4 5)',
    '*|I (X9/X26/M1:g X9/X26/M1 g nch 0.5)',  // no coords
  ].join('\n');
  const d = parseDspf(text);
  assert.deepEqual(d.devices, [{ path: 'X9/X26/M1', x: 4, y: 5 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:layout`
Expected: FAIL — parasitics is 0 / layers empty / devices empty (logic not yet added).

- [ ] **Step 3: Update the implementation**

In `src/layout-viewer/dspf/parseDspf.ts`, add a layer-set accumulator and an `*|S`-points buffer, parse R/C lines, and apply the device fallback at the end.

Replace the function body's declarations and add the R/C branch + fallback. Full updated file:
```ts
import type { LayoutData, DspfNet } from '../model';

function parseParen(payload: string, minArityForCoords: number):
  { name: string; x: number; y: number } | { name: string; x: null; y: null } | null {
  const inner = payload.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return null;
  const tok = inner.split(/\s+/);
  const name = tok[0];
  if (tok.length >= minArityForCoords) {
    const x = Number(tok[tok.length - 2]);
    const y = Number(tok[tok.length - 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { name, x, y };
  }
  return { name, x: null, y: null };
}

const LAYER_RE = /\$layer\s*=\s*(\S+)/i;

export function parseDspf(text: string): LayoutData {
  const data: LayoutData = {
    divider: '/', delimiter: ':', nets: [], devices: [],
    layersPresent: false, layers: [],
  };
  const layerSet = new Set<string>();
  // Subnode (name → coord) per net, kept so the *|S device fallback and the
  // RC-skeleton (Task 5) can resolve resistor endpoints by name.
  let net: DspfNet | null = null;
  let sawInstCoords = false;
  const subnodePoints: Array<{ name: string; x: number; y: number }> = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('*|DIVIDER')) { data.divider = line.split(/\s+/)[1] ?? '/'; continue; }
    if (line.startsWith('*|DELIMITER')) { data.delimiter = line.split(/\s+/)[1] ?? ':'; continue; }
    if (line.startsWith('*|NET')) {
      net = { name: line.split(/\s+/)[1] ?? '', subnodes: [], parasitics: 0, resistors: [] };
      data.nets.push(net);
      continue;
    }
    if (line.startsWith('*|S')) {
      const p = parseParen(line.slice(3).trim(), 3);
      if (p && p.x !== null) { if (net) net.subnodes.push({ name: p.name, x: p.x, y: p.y }); subnodePoints.push({ name: p.name, x: p.x, y: p.y }); }
      continue;
    }
    if (line.startsWith('*|P')) {
      const p = parseParen(line.slice(3).trim(), 5);
      if (p && p.x !== null && net) net.subnodes.push({ name: p.name, x: p.x, y: p.y });
      continue;
    }
    if (line.startsWith('*|I')) {
      const p = parseParen(line.slice(3).trim(), 7);
      if (p && p.x !== null) {
        sawInstCoords = true;
        const cut = p.name.lastIndexOf(data.delimiter);
        data.devices.push({ path: cut > 0 ? p.name.slice(0, cut) : p.name, x: p.x, y: p.y });
      }
      continue;
    }
    if (line.startsWith('*|')) continue; // other directives ignored

    // Parasitic elements: "R<id> a b val [$layer=m]" / "C<id> a b val ..."
    const head = line[0];
    if ((head === 'R' || head === 'r' || head === 'C' || head === 'c') && net) {
      net.parasitics += 1;
      if (head === 'R' || head === 'r') {
        const tok = line.split(/\s+/);
        const m = line.match(LAYER_RE);
        const layer = m ? m[1] : null;
        if (layer) { data.layersPresent = true; layerSet.add(layer); }
        net.resistors.push({ a: tok[1] ?? '', b: tok[2] ?? '', layer });
      }
    }
  }

  // CLKGEN case: no *|I coordinates → derive device points from *|S names.
  if (!sawInstCoords) {
    for (const s of subnodePoints) {
      const cut = s.name.lastIndexOf(data.delimiter);
      data.devices.push({ path: cut > 0 ? s.name.slice(0, cut) : s.name, x: s.x, y: s.y });
    }
  }

  data.layers = [...layerSet];
  return data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/parseDspf.ts src/layout-viewer/dspf/parseDspf.test.ts
git commit -m "feat(layout): parse DSPF parasitics, layers, and *|S device fallback"
```

---

## Task 4: Test fixtures + correlation helpers (normalize, hierarchy)

**Files:**
- Create: `src/layout-viewer/__fixtures__/fixtures.ts`
- Create: `src/layout-viewer/correlate.ts`
- Create: `src/layout-viewer/correlate.test.ts`

**Interfaces:**
- Consumes: `Design`, `Cell`, `Instance` from `../parser/types`; `LayoutData` from `./model`.
- Produces (exported from `correlate.ts`):
  - `normSegments(name: string, seps: string[]): string[]` — lowercased path segments, finger suffixes stripped.
  - `enumerateHierarchy(design: Design): HierNode[]` where `HierNode = { id: string; label: string; depth: number; segs: string[] }`.
- Produces (from `fixtures.ts`): `makeDesign(spec)` and re-exports `parseDspf` usage helpers for tests.

- [ ] **Step 1: Write the fixtures helper**

Create `src/layout-viewer/__fixtures__/fixtures.ts`:
```ts
import type { Design, Cell, Instance } from '../../parser/types';

// Build a minimal Design with the given cells. Each cell lists its subckt
// instances as [instanceId, masterCellName]. Primitives/nets/ports are empty
// (correlation only walks the instance tree).
export function makeDesign(
  topCell: string,
  cells: Record<string, Array<[string, string]>>,
): Design {
  const map = new Map<string, Cell>();
  for (const [name, insts] of Object.entries(cells)) {
    const instances: Instance[] = insts.map(([id, master]) => ({
      id, master, conn: {}, portMap: [],
    }));
    map.set(name, { name, ports: [], instances, primitives: [], nets: [] });
  }
  return { cells: map, topCell, warnings: [] };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/layout-viewer/correlate.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normSegments, enumerateHierarchy } from './correlate';
import { makeDesign } from './__fixtures__/fixtures';

test('normSegments lowercases, splits on separators, strips fingers', () => {
  assert.deepEqual(normSegments('X100/X55/M1', ['/', ':']), ['x100', 'x55', 'm1']);
  assert.deepEqual(normSegments('X9|X26|M1<@3>', ['|', ':']), ['x9', 'x26', 'm1']);
  assert.deepEqual(normSegments('A:b@2', [':']), ['a', 'b']);
});

test('enumerateHierarchy walks the instance tree with depths', () => {
  const design = makeDesign('TOP', {
    TOP: [['XI9', 'SGL'], ['XI10', 'SGL']],
    SGL: [['XI26', 'INBUF']],
    INBUF: [],
  });
  const nodes = enumerateHierarchy(design);
  // depth 0 root + XI9, XI10 (d1) + XI9/XI26, XI10/XI26 (d2)
  const byId = Object.fromEntries(nodes.map(n => [n.id, n.depth]));
  assert.equal(byId[''], 0);
  assert.equal(byId['xi9'], 1);
  assert.equal(byId['xi10'], 1);
  assert.equal(byId['xi9/xi26'], 2);
  assert.equal(byId['xi10/xi26'], 2);
  assert.equal(nodes.find(n => n.id === 'xi9/xi26')?.label, 'XI26');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:layout`
Expected: FAIL — `Cannot find module './correlate'`.

- [ ] **Step 4: Write the implementation (helpers only)**

Create `src/layout-viewer/correlate.ts`:
```ts
import type { Design } from '../parser/types';

export interface HierNode { id: string; label: string; depth: number; segs: string[] }

// Lowercase a hierarchical name and split into segments, dropping finger
// suffixes (`<@n>`, trailing `@n`). `seps` is the set of separator chars to
// split on (DSPF divider+delimiter, or the CDL separators).
export function normSegments(name: string, seps: string[]): string[] {
  const escaped = seps.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const splitter = new RegExp(`[${escaped}]`);
  return name
    .toLowerCase()
    .split(splitter)
    .map(seg => seg.replace(/<@[^>]*>/g, '').replace(/@\d+$/, '').trim())
    .filter(Boolean);
}

// Walk the CDL instance tree from the top cell. Returns one node per instance
// at every depth, plus the depth-0 root (id ""). `id` is the normalized,
// "/"-joined instance path; `segs` is the same as an array for prefix matching.
export function enumerateHierarchy(design: Design): HierNode[] {
  const nodes: HierNode[] = [{ id: '', label: design.topCell, depth: 0, segs: [] }];
  const walk = (cellName: string, prefix: string[], depth: number) => {
    const cell = design.cells.get(cellName);
    if (!cell) return;
    for (const inst of cell.instances) {
      const segs = [...prefix, inst.id.toLowerCase()];
      nodes.push({ id: segs.join('/'), label: inst.id, depth, segs });
      if (design.cells.has(inst.master)) walk(inst.master, segs, depth + 1);
    }
  };
  walk(design.topCell, [], 1);
  return nodes;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (10 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/layout-viewer/__fixtures__/fixtures.ts src/layout-viewer/correlate.ts src/layout-viewer/correlate.test.ts
git commit -m "feat(layout): correlation helpers — name normalization + hierarchy walk"
```

---

## Task 5: Correlation — assemble the LayoutModel

**Files:**
- Modify: `src/layout-viewer/correlate.ts`
- Modify: `src/layout-viewer/correlate.test.ts`

**Interfaces:**
- Produces: `correlate(design: Design, data: LayoutData): LayoutModel` — instance bboxes (devices grouped under hierarchy nodes), net bboxes + touched instances, RC-skeleton connections, extent, and stats.

- [ ] **Step 1: Write the failing test**

Append to `src/layout-viewer/correlate.test.ts`:
```ts
import { correlate } from './correlate';
import { parseDspf } from './dspf/parseDspf';

test('correlate computes instance + net boxes, connections, stats', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|DIVIDER /', '*|DELIMITER :',
    '*|NET VOUT 1',
    '*|S (X9/M1:o 4 5)',
    '*|S (X9/M2:o 8 9)',
    'R1 X9/M1:o X9/M2:o 1 $layer=metal2',
    '*|I (X9/M1:d X9/M1 d nch 0.5 4 5)',
    '*|I (X9/M2:d X9/M2 d nch 0.5 8 9)',
  ].join('\n'));

  const m = correlate(design, dspf);

  const x9 = m.instances.find(i => i.id === 'x9')!;
  assert.deepEqual(x9.bbox, [4, 5, 8, 9]);
  assert.equal(x9.deviceCount, 2);
  assert.equal(x9.depth, 1);

  const root = m.instances.find(i => i.id === '')!;
  assert.deepEqual(root.bbox, [4, 5, 8, 9]);

  const net = m.nets.find(n => n.name === 'VOUT')!;
  assert.deepEqual(net.bbox, [4, 5, 8, 9]);
  assert.equal(net.subnodes, 2);
  assert.deepEqual(net.layers, ['metal2']);
  assert.ok(net.instances.includes('x9'));

  assert.deepEqual(m.connections, [{ net: 'VOUT', layer: 'metal2', points: [[4, 5], [8, 9]] }]);
  assert.deepEqual(m.extent, [4, 5, 8, 9]);
  assert.equal(m.layers.length, 1);
  assert.equal(m.stats.devicesMatched, 2);
  assert.equal(m.stats.instancesMatched, 1);    // x9 (root excluded from the instances total)
});

test('no-layer DSPF ⇒ layers [], connection layer null', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|NET N 1', '*|S (X9/M1:o 0 0)', '*|S (X9/M2:o 2 2)',
    'R1 X9/M1:o X9/M2:o 1',
    '*|I (X9/M1:d X9/M1 d nch 0.5 0 0)',
  ].join('\n'));
  const m = correlate(design, dspf);
  assert.deepEqual(m.layers, []);
  assert.equal(m.connections[0].layer, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:layout`
Expected: FAIL — `correlate is not exported`.

- [ ] **Step 3: Add `correlate` to `src/layout-viewer/correlate.ts`**

Append these imports at the top (merge with the existing `import type`):
```ts
import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel, LayoutInstance, LayoutNet, LayoutConnection, Bbox } from './model';
import { emptyBbox, extendBbox, bboxValid } from './model';
```

Append the function:
```ts
export function correlate(design: Design, data: LayoutData): LayoutModel {
  const hierSeps = ['/']; // node ids are normalized with "/" (see enumerateHierarchy)
  const dspfSeps = [data.divider, data.delimiter];
  const nodes = enumerateHierarchy(design);

  // Index nodes by their normalized path string for prefix lookup.
  const nodeBox = new Map<string, Bbox>();
  const nodeCount = new Map<string, number>();
  for (const n of nodes) { nodeBox.set(n.id, emptyBbox()); nodeCount.set(n.id, 0); }

  // Assign each device to every ancestor node whose path is a prefix of it.
  let devicesMatched = 0;
  for (const dev of data.devices) {
    const segs = normSegments(dev.path, dspfSeps);
    let matched = false;
    // root (id "") always contains the device
    extendBbox(nodeBox.get('')!, dev.x, dev.y);
    nodeCount.set('', nodeCount.get('')! + 1);
    for (let len = 1; len <= segs.length; len++) {
      const id = segs.slice(0, len).join('/');
      const box = nodeBox.get(id);
      if (box) { extendBbox(box, dev.x, dev.y); nodeCount.set(id, nodeCount.get(id)! + 1); matched = true; }
    }
    if (matched) devicesMatched++;
  }

  const instances: LayoutInstance[] = nodes
    .filter(n => bboxValid(nodeBox.get(n.id)!))
    .map(n => ({
      id: n.id, label: n.label, depth: n.depth,
      deviceCount: nodeCount.get(n.id)!, bbox: nodeBox.get(n.id)!,
    }));

  // Net bboxes + which instance nodes each net touches (by subnode prefix).
  const nodeIds = new Set(nodes.map(n => n.id));
  const nets: LayoutNet[] = data.nets.map(dn => {
    const box = emptyBbox();
    const touched = new Set<string>();
    const layerSet = new Set<string>();
    for (const s of dn.subnodes) {
      extendBbox(box, s.x, s.y);
      const segs = normSegments(s.name, dspfSeps);
      // deepest matching instance node for this subnode
      for (let len = segs.length - 1; len >= 1; len--) {
        const id = segs.slice(0, len).join('/');
        if (nodeIds.has(id)) { touched.add(id); break; }
      }
    }
    for (const r of dn.resistors) if (r.layer) layerSet.add(r.layer);
    return {
      name: dn.name,
      bbox: bboxValid(box) ? box : [0, 0, 0, 0],
      subnodes: dn.subnodes.length, parasitics: dn.parasitics,
      layers: [...layerSet], instances: [...touched],
    };
  });

  // RC skeleton: one polyline per resistor, endpoints resolved by subnode name.
  const connections: LayoutConnection[] = [];
  for (const dn of data.nets) {
    const coord = new Map<string, [number, number]>();
    for (const s of dn.subnodes) coord.set(s.name, [s.x, s.y]);
    for (const r of dn.resistors) {
      const a = coord.get(r.a); const b = coord.get(r.b);
      if (a && b) connections.push({ net: dn.name, layer: r.layer, points: [a, b] });
    }
  }

  const extent = nodeBox.get('')!;
  return {
    design: design.topCell,
    extent: bboxValid(extent) ? extent : [0, 0, 1, 1],
    layers: data.layers,
    instances, nets, connections,
    stats: {
      instancesMatched: instances.filter(i => i.depth >= 1).length,
      instancesTotal: nodes.filter(n => n.depth >= 1).length,
      devicesMatched,
    },
  };
}
```

Also keep `hierSeps` only if used; if the linter flags it as unused, delete that line (node ids are already normalized).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (12 tests total).

- [ ] **Step 5: Typecheck + lint the new module**

Run: `npx tsc --noEmit -p tsconfig.app.json` (expect no errors) and `npx eslint src/layout-viewer` (expect clean; remove any unused symbol it flags).

- [ ] **Step 6: Commit**

```bash
git add src/layout-viewer/correlate.ts src/layout-viewer/correlate.test.ts
git commit -m "feat(layout): correlate Design + DSPF into a LayoutModel"
```

---

## Task 6: World↔screen view transform

**Files:**
- Create: `src/components/layout/transform.ts`
- Create: `src/components/layout/transform.test.ts`

**Interfaces:**
- Consumes: `Bbox` from `../../layout-viewer/model`.
- Produces: `View` type and `fitView`, `worldToScreen`, `screenToWorld`, `zoomAt`, `panBy`.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/transform.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitView, worldToScreen, screenToWorld, zoomAt } from './transform';

test('fitView centers the extent and round-trips coords (Y is flipped)', () => {
  const v = fitView([0, 0, 10, 10], 200, 200, 20);
  // bottom-left world (0,0) maps near the bottom of the screen (large sy)
  const [, sy0] = worldToScreen(v, 0, 0);
  const [, sy1] = worldToScreen(v, 0, 10);
  assert.ok(sy0 > sy1, 'higher world Y is higher on screen (smaller sy)');
  // round trip
  const [wx, wy] = screenToWorld(v, ...worldToScreen(v, 4, 6));
  assert.ok(Math.abs(wx - 4) < 1e-9 && Math.abs(wy - 6) < 1e-9);
});

test('zoomAt keeps the cursor world point fixed', () => {
  const v = fitView([0, 0, 10, 10], 200, 200, 20);
  const before = screenToWorld(v, 150, 150);
  const z = zoomAt(v, 2, 150, 150);
  const after = screenToWorld(z, 150, 150);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9);
  assert.ok(Math.abs(before[1] - after[1]) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:layout`
Expected: FAIL — `Cannot find module './transform'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/layout/transform.ts`:
```ts
import type { Bbox } from '../../layout-viewer/model';

// screenX = wx*scale + tx ;  screenY = H - (wy*scale + ty)   (Y flipped: µm up)
export interface View { scale: number; tx: number; ty: number; h: number }

export function fitView(extent: Bbox, width: number, height: number, pad: number): View {
  const w = Math.max(extent[2] - extent[0], 1e-6);
  const h = Math.max(extent[3] - extent[1], 1e-6);
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  // center the extent in the viewport
  const tx = (width - (extent[0] + extent[2]) * scale) / 2;
  const ty = (height - (extent[1] + extent[3]) * scale) / 2;
  return { scale, tx, ty, h: height };
}

export function worldToScreen(v: View, x: number, y: number): [number, number] {
  return [x * v.scale + v.tx, v.h - (y * v.scale + v.ty)];
}

export function screenToWorld(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.tx) / v.scale, (v.h - sy - v.ty) / v.scale];
}

export function panBy(v: View, dxScreen: number, dyScreen: number): View {
  // dragging right/down should move the world right/down on screen
  return { ...v, tx: v.tx + dxScreen, ty: v.ty - dyScreen };
}

export function zoomAt(v: View, factor: number, sx: number, sy: number): View {
  const [wx, wy] = screenToWorld(v, sx, sy);
  const scale = v.scale * factor;
  // solve tx,ty so that (wx,wy) stays under (sx,sy)
  const tx = sx - wx * scale;
  const ty = (v.h - sy) - wy * scale;
  return { ...v, scale, tx, ty };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/transform.ts src/components/layout/transform.test.ts
git commit -m "feat(layout): pure world<->screen view transform with Y-flip"
```

---

## Task 7: Hit-testing (pure pick function)

**Files:**
- Create: `src/components/layout/pick.ts`
- Create: `src/components/layout/pick.test.ts`

**Interfaces:**
- Consumes: `LayoutModel`, `bboxArea`, `Bbox` from `../../layout-viewer/model`.
- Produces: `pickInstance(model, depth, wx, wy): string | null` — id of the smallest-area instance box at or below `depth` containing the world point (smallest = "topmost").

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/pick.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickInstance } from './pick';
import type { LayoutModel } from '../../layout-viewer/model';

const model = {
  instances: [
    { id: '', label: 'TOP', depth: 0, deviceCount: 9, bbox: [0, 0, 10, 10] },
    { id: 'x9', label: 'X9', depth: 1, deviceCount: 4, bbox: [0, 0, 5, 5] },
    { id: 'x9/m1', label: 'M1', depth: 2, deviceCount: 1, bbox: [1, 1, 2, 2] },
  ],
} as unknown as LayoutModel;

test('returns the smallest box at/under depth that contains the point', () => {
  assert.equal(pickInstance(model, 2, 1.5, 1.5), 'x9/m1');
  assert.equal(pickInstance(model, 1, 1.5, 1.5), 'x9');   // m1 hidden at depth 1
  assert.equal(pickInstance(model, 1, 9, 9), '');          // only root contains it
  assert.equal(pickInstance(model, 2, 20, 20), null);      // outside everything
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:layout`
Expected: FAIL — `Cannot find module './pick'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/layout/pick.ts`:
```ts
import type { LayoutModel } from '../../layout-viewer/model';
import { bboxArea } from '../../layout-viewer/model';

// Topmost = smallest-area instance box (depth ≤ maxDepth) containing (wx,wy).
export function pickInstance(model: LayoutModel, maxDepth: number, wx: number, wy: number): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const inst of model.instances) {
    if (inst.depth > maxDepth) continue;
    const [x0, y0, x1, y1] = inst.bbox;
    if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
    const area = bboxArea(inst.bbox);
    if (area < bestArea) { bestArea = area; best = inst.id; }
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/pick.ts src/components/layout/pick.test.ts
git commit -m "feat(layout): pure instance hit-testing"
```

---

## Task 8: Store — appMode + layout state and actions

**Files:**
- Modify: `src/store/viewerStore.ts`
- Create: `src/store/viewerStore.layout.test.ts`

**Interfaces:**
- Consumes: `LayoutData`, `LayoutModel` from `../layout-viewer/model`; `correlate` from `../layout-viewer/correlate`.
- Produces store fields `appMode`, `layoutData`, `layoutModel`, `layoutDepth`, `layerVisibility` and actions `setAppMode`, `loadLayout(data)`, `setLayoutDepth(d)`, `toggleLayer(name)`. `LayoutDepth = 0 | 1 | 2 | 'all'`.

- [ ] **Step 1: Write the failing test**

Create `src/store/viewerStore.layout.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from './viewerStore';
import { makeDesign } from '../layout-viewer/__fixtures__/fixtures';
import { parseDspf } from '../layout-viewer/dspf/parseDspf';

test('loadLayout correlates against the loaded design and inits layer visibility', () => {
  const s = useViewerStore.getState();
  s.loadDesign(makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] }));
  const data = parseDspf([
    '*|NET N 1', '*|S (X9/M1:o 0 0)', '*|S (X9/M2:o 2 2)',
    'R1 X9/M1:o X9/M2:o 1 $layer=metal2',
    '*|I (X9/M1:d X9/M1 d nch 0.5 0 0)',
    '*|I (X9/M2:d X9/M2 d nch 0.5 2 2)',
  ].join('\n'));
  useViewerStore.getState().loadLayout(data);

  const st = useViewerStore.getState();
  assert.ok(st.layoutModel);
  assert.equal(st.layoutModel!.instances.some(i => i.id === 'x9'), true);
  assert.deepEqual(st.layerVisibility, { metal2: true });

  st.toggleLayer('metal2');
  assert.equal(useViewerStore.getState().layerVisibility.metal2, false);

  st.setAppMode('layout');
  assert.equal(useViewerStore.getState().appMode, 'layout');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:layout`
Expected: FAIL — `loadLayout is not a function`.

- [ ] **Step 3: Update the store**

In `src/store/viewerStore.ts`:

Add imports at the top:
```ts
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import { correlate } from '../layout-viewer/correlate';
```

Add types near `ViewMode`:
```ts
export type AppMode = 'schematic' | 'layout';
export type LayoutDepth = 0 | 1 | 2 | 'all';
```

Add fields to the `ViewerState` interface (after `focusRequest`):
```ts
  appMode: AppMode;
  layoutData: LayoutData | null;
  layoutModel: LayoutModel | null;
  layoutDepth: LayoutDepth;
  layerVisibility: Record<string, boolean>;
```
and actions (after `setSearchOpen`):
```ts
  setAppMode: (mode: AppMode) => void;
  loadLayout: (data: LayoutData) => void;
  setLayoutDepth: (depth: LayoutDepth) => void;
  toggleLayer: (name: string) => void;
```

Add initial values to the `create(...)` object (after `focusRequest: 0,`):
```ts
  appMode: 'schematic',
  layoutData: null,
  layoutModel: null,
  layoutDepth: 1,
  layerVisibility: {},
```

Add action implementations (after `setSearchOpen`):
```ts
  setAppMode: (appMode) => set({ appMode }),

  loadLayout: (data) => {
    const { design } = get();
    if (!design) return;
    const model = correlate(design, data);
    const layerVisibility: Record<string, boolean> = {};
    for (const l of model.layers) layerVisibility[l] = true;
    set({ layoutData: data, layoutModel: model, layerVisibility });
  },

  setLayoutDepth: (layoutDepth) => set({ layoutDepth }),

  toggleLayer: (name) =>
    set(s => ({ layerVisibility: { ...s.layerVisibility, [name]: !s.layerVisibility[name] } })),
```

Also clear layout state inside `loadDesign` (a new CDL invalidates the old correlation). In the `loadDesign` `set({...})`, add:
```ts
      layoutData: null,
      layoutModel: null,
      layerVisibility: {},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:layout`
Expected: PASS (16 tests total). Then `npm test` — 65 passed (store change doesn't touch the CDL adapter).

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.layout.test.ts
git commit -m "feat(layout): add appMode + layout state/actions to the store"
```

---

## Task 9: DSPF worker + async wrapper

**Files:**
- Create: `src/layout-viewer/dspf/dspf.worker.ts`
- Create: `src/layout-viewer/dspf/parseDspfAsync.ts`

**Interfaces:**
- Produces: `parseDspfAsync(text: string): Promise<LayoutData>` (mirrors `parseCDLAsync`).

> Worker glue isn't unit-tested (no DOM Worker in node); it's verified by the app build (Task 12) and manual validation. The parsing logic it calls is already covered by Tasks 2–3.

- [ ] **Step 1: Create the worker**

Create `src/layout-viewer/dspf/dspf.worker.ts`:
```ts
// Module worker: parse a DSPF off the main thread (files reach ~22 MB).
import { parseDspf } from './parseDspf';
import type { LayoutData } from '../model';

export interface DspfRequest { id: number; text: string }
export interface DspfResponse { id: number; ok: boolean; data?: LayoutData; error?: string }

const ctx = self as unknown as Worker;
ctx.onmessage = (e: MessageEvent<DspfRequest>) => {
  const { id, text } = e.data;
  try {
    const data = parseDspf(text);
    ctx.postMessage({ id, ok: true, data } satisfies DspfResponse);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies DspfResponse);
  }
};
```

- [ ] **Step 2: Create the async wrapper**

Create `src/layout-viewer/dspf/parseDspfAsync.ts`:
```ts
import type { LayoutData } from '../model';
import type { DspfRequest, DspfResponse } from './dspf.worker';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (d: LayoutData) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./dspf.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<DspfResponse>) => {
    const { id, ok, data, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok && data) entry.resolve(data);
    else entry.reject(new Error(error ?? 'Unknown DSPF parse error'));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message)); pending.clear(); };
  return worker;
}

export function parseDspfAsync(text: string): Promise<LayoutData> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text } satisfies DspfRequest);
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/layout-viewer/dspf/dspf.worker.ts src/layout-viewer/dspf/parseDspfAsync.ts
git commit -m "feat(layout): DSPF web worker + async wrapper"
```

---

## Task 10: LayoutCanvas (Canvas2D render + interaction)

**Files:**
- Create: `src/components/layout/LayoutCanvas.tsx`

**Interfaces:**
- Consumes: store (`layoutModel`, `layoutDepth`, `layerVisibility`, `selection`, `setSelection`); `fitView/worldToScreen/zoomAt/panBy/View` from `./transform`; `pickInstance` from `./pick`.
- Produces: `<LayoutCanvas />` — draws connections, net boxes (for the selected instance/net), instance boxes (≤ depth), and a selection glow; supports wheel-zoom, drag-pan, click-select.

- [ ] **Step 1: Implement the component**

Create `src/components/layout/LayoutCanvas.tsx`:
```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import type { View } from './transform';
import { fitView, worldToScreen, zoomAt, panBy } from './transform';
import { pickInstance } from './pick';
import type { LayoutModel } from '../../layout-viewer/model';

const PAD = 40;
const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
};
const NEUTRAL = '#6b7689';

function depthMax(d: 0 | 1 | 2 | 'all'): number { return d === 'all' ? Infinity : d; }

function draw(ctx: CanvasRenderingContext2D, model: LayoutModel, v: View, w: number, h: number,
             depth: number, layers: Record<string, boolean>, hasLayers: boolean,
             selId: string | null, selNet: string | null) {
  ctx.clearRect(0, 0, w, h);

  // nets to show: the selected net, or the nets touching the selected instance
  const showNets = new Set<string>();
  if (selNet) showNets.add(selNet);
  else if (selId !== null) for (const n of model.nets) if (n.instances.includes(selId)) showNets.add(n.name);

  // connections (under everything)
  for (const c of model.connections) {
    if (hasLayers && c.layer && layers[c.layer] === false) continue;
    const color = hasLayers && c.layer ? (LAYER_COLOR[c.layer] ?? NEUTRAL) : NEUTRAL;
    const hot = selNet === c.net;
    ctx.strokeStyle = color;
    ctx.globalAlpha = hot ? 0.95 : (selNet ? 0.12 : 0.7);
    ctx.lineWidth = hot ? 2.4 : 1.4;
    ctx.beginPath();
    c.points.forEach((p, i) => {
      const [sx, sy] = worldToScreen(v, p[0], p[1]);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // net boxes (translucent dashed green / yellow when the net itself is selected)
  ctx.setLineDash([6, 4]);
  for (const n of model.nets) {
    if (!showNets.has(n.name)) continue;
    const hot = selNet === n.name;
    const [x0, y1s] = worldToScreen(v, n.bbox[0], n.bbox[3]);
    const [x1, y0s] = worldToScreen(v, n.bbox[2], n.bbox[1]);
    ctx.strokeStyle = hot ? '#ffd23f' : '#5fd0a0';
    ctx.fillStyle = hot ? 'rgba(255,210,63,0.10)' : 'rgba(95,208,160,0.08)';
    ctx.lineWidth = 1.4;
    ctx.fillRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.strokeRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.setLineDash([]);
    ctx.fillStyle = hot ? '#ffd23f' : '#5fd0a0';
    ctx.font = '11px "Space Mono", monospace';
    ctx.fillText(`${n.name} ·net`, x0 + 4, y1s + 12);
    ctx.setLineDash([6, 4]);
  }
  ctx.setLineDash([]);

  // instance boxes (solid blue, yellow when selected)
  for (const inst of model.instances) {
    if (inst.depth === 0 || inst.depth > depth) continue;
    const hot = selId === inst.id;
    const dim = selNet !== null;
    const [x0, y1s] = worldToScreen(v, inst.bbox[0], inst.bbox[3]);
    const [x1, y0s] = worldToScreen(v, inst.bbox[2], inst.bbox[1]);
    ctx.globalAlpha = dim ? 0.3 : 1;
    ctx.strokeStyle = hot ? '#ffd23f' : '#4f9dff';
    ctx.fillStyle = hot ? 'rgba(255,210,63,0.14)' : 'rgba(79,157,255,0.12)';
    ctx.lineWidth = hot ? 2 : 1.3;
    ctx.fillRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.strokeRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.fillStyle = hot ? '#ffd23f' : '#9cc4ff';
    ctx.font = '11px "Space Mono", monospace';
    ctx.fillText(inst.label, x0 + 4, y1s + 13);
    ctx.globalAlpha = 1;
  }
}

export function LayoutCanvas() {
  const model = useViewerStore(s => s.layoutModel);
  const layoutDepth = useViewerStore(s => s.layoutDepth);
  const layerVisibility = useViewerStore(s => s.layerVisibility);
  const selection = useViewerStore(s => s.selection);
  const setSelection = useViewerStore(s => s.setSelection);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const [, force] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const render = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap || !model) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!viewRef.current) viewRef.current = fitView(model.extent, w, h, PAD);
    else viewRef.current = { ...viewRef.current, h };
    const depth = depthMax(layoutDepth);
    const selId = selection?.type === 'instance' ? selection.id : null;
    const selNet = selection?.type === 'net' ? selection.name : null;
    draw(ctx, model, viewRef.current, w, h, depth, layerVisibility, model.layers.length > 0, selId, selNet);
  }, [model, layoutDepth, layerVisibility, selection]);

  // Refit when a new model loads.
  useEffect(() => { viewRef.current = null; render(); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { render(); });
  useEffect(() => {
    const ro = new ResizeObserver(render);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [render]);

  const onWheel = (e: React.WheelEvent) => {
    if (!viewRef.current) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    viewRef.current = zoomAt(viewRef.current, factor, e.clientX - r.left, e.clientY - r.top);
    force(n => n + 1);
  };
  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY }; };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current || !viewRef.current) return;
    viewRef.current = panBy(viewRef.current, e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
    force(n => n + 1);
  };
  const onUp = (e: React.MouseEvent) => {
    const wasDrag = drag.current && (Math.abs(e.clientX - drag.current.x) > 3 || Math.abs(e.clientY - drag.current.y) > 3);
    drag.current = null;
    if (wasDrag || !viewRef.current || !model) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const { screenToWorld } = require('./transform'); // avoids unused import churn
    const [wx, wy] = screenToWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top);
    const id = pickInstance(model, depthMax(layoutDepth), wx, wy);
    setSelection(id !== null ? { type: 'instance', id } : null);
  };

  return (
    <div ref={wrapRef} className="layout-canvas-wrap"
         onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => (drag.current = null)}>
      <canvas ref={canvasRef} />
    </div>
  );
}
```

> Note: replace the `require('./transform')` line with a top-of-file `import { ..., screenToWorld } from './transform';` — add `screenToWorld` to the existing import and delete the inline `require`. (Written this way only to keep the import list visible in this step.)

- [ ] **Step 2: Fix the import (apply the note)**

Edit the import line to:
```tsx
import { fitView, worldToScreen, screenToWorld, zoomAt, panBy } from './transform';
```
and in `onUp` replace the `require` line with direct use of `screenToWorld`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/LayoutCanvas.tsx
git commit -m "feat(layout): Canvas2D LayoutCanvas with pan/zoom/select"
```

---

## Task 11: Controls — DepthSelector, LayerPanel, LayoutInspector, LayoutView

**Files:**
- Create: `src/components/layout/DepthSelector.tsx`
- Create: `src/components/layout/LayerPanel.tsx`
- Create: `src/components/layout/LayoutInspector.tsx`
- Create: `src/components/layout/LayoutView.tsx`

**Interfaces:**
- Consumes: store fields/actions from Task 8; `LayoutCanvas` from Task 10; existing `HierarchyPanel`, `InspectorPanel` frame conventions.
- Produces: `<LayoutView />` — the full layout-mode body (left controls reuse `HierarchyPanel`; center is depth selector + canvas; right is `LayoutInspector`).

- [ ] **Step 1: DepthSelector**

Create `src/components/layout/DepthSelector.tsx`:
```tsx
import { useViewerStore, type LayoutDepth } from '../../store/viewerStore';

const OPTS: Array<{ v: LayoutDepth; label: string }> = [
  { v: 0, label: '0' }, { v: 1, label: '1' }, { v: 2, label: '2' }, { v: 'all', label: 'All' },
];

export function DepthSelector() {
  const depth = useViewerStore(s => s.layoutDepth);
  const setDepth = useViewerStore(s => s.setLayoutDepth);
  return (
    <div className="depth-row">
      <span className="depth-label">Depth</span>
      {OPTS.map(o => (
        <button key={String(o.v)} className={depth === o.v ? 'on' : ''} onClick={() => setDepth(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: LayerPanel (hidden when no layers)**

Create `src/components/layout/LayerPanel.tsx`:
```tsx
import { useViewerStore } from '../../store/viewerStore';

const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
};

export function LayerPanel() {
  const model = useViewerStore(s => s.layoutModel);
  const vis = useViewerStore(s => s.layerVisibility);
  const toggle = useViewerStore(s => s.toggleLayer);
  if (!model || model.layers.length === 0) return null; // graceful no-layer degradation
  return (
    <div className="layer-panel">
      <div className="layer-title">Metal layers</div>
      <div className="layer-chips">
        {model.layers.map(l => (
          <button key={l} className={`layer-chip${vis[l] ? '' : ' off'}`} onClick={() => toggle(l)}>
            <span className="layer-sw" style={{ background: LAYER_COLOR[l] ?? '#6b7689' }} />{l}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: LayoutInspector**

Create `src/components/layout/LayoutInspector.tsx`:
```tsx
import { useViewerStore } from '../../store/viewerStore';

export function LayoutInspector() {
  const model = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const setSelection = useViewerStore(s => s.setSelection);
  if (!model) return <div className="insp-empty">Load a DSPF to see the physical map.</div>;
  if (!selection || selection.type === 'primitive')
    return <div className="insp-empty">Select a block or net on the canvas.</div>;

  if (selection.type === 'instance') {
    const i = model.instances.find(x => x.id === selection.id);
    if (!i) return <div className="insp-empty">No physical data for this block.</div>;
    const nets = model.nets.filter(n => n.instances.includes(i.id));
    const [w, h] = [i.bbox[2] - i.bbox[0], i.bbox[3] - i.bbox[1]];
    return (
      <div className="insp-body">
        <div className="det-h"><span className="tag inst">Instance</span><span className="ttl">{i.label}</span></div>
        <div className="det-sub">depth {i.depth}</div>
        <div className="kv"><span>Devices</span><span>{i.deviceCount}</span></div>
        <div className="kv"><span>Width × Height</span><span>{w.toFixed(2)} × {h.toFixed(2)} µm</span></div>
        <div className="sub-h">Instance bbox</div>
        <div className="bboxline">SW {i.bbox[0].toFixed(2)}, {i.bbox[1].toFixed(2)}<br />NE {i.bbox[2].toFixed(2)}, {i.bbox[3].toFixed(2)}</div>
        <div className="sub-h">Nets at this block ({nets.length})</div>
        <div>{nets.map(n => <span key={n.name} className="chip net" onClick={() => setSelection({ type: 'net', name: n.name })}>{n.name}</span>)}</div>
      </div>
    );
  }

  const n = model.nets.find(x => x.name === selection.name);
  if (!n) return <div className="insp-empty">No physical data for this net.</div>;
  const [w, h] = [n.bbox[2] - n.bbox[0], n.bbox[3] - n.bbox[1]];
  return (
    <div className="insp-body">
      <div className="det-h"><span className="tag net">Net (PEX)</span><span className="ttl">{n.name}</span></div>
      <div className="kv"><span>Subnodes</span><span>{n.subnodes}</span></div>
      <div className="kv"><span>Parasitics</span><span>{n.parasitics}</span></div>
      <div className="kv"><span>Width × Height</span><span>{w.toFixed(2)} × {h.toFixed(2)} µm</span></div>
      <div className="sub-h">Net bbox</div>
      <div className="bboxline">SW {n.bbox[0].toFixed(2)}, {n.bbox[1].toFixed(2)}<br />NE {n.bbox[2].toFixed(2)}, {n.bbox[3].toFixed(2)}</div>
      <div className="sub-h">Metal layers</div>
      {model.layers.length === 0
        ? <div className="nolayer-note">Not available — this DSPF was extracted without layer tags.</div>
        : <div>{n.layers.map(l => <span key={l} className="chip lay">{l}</span>)}</div>}
    </div>
  );
}
```

- [ ] **Step 4: LayoutView (composition)**

Create `src/components/layout/LayoutView.tsx`:
```tsx
import { HierarchyPanel } from '../HierarchyPanel';
import { LayoutCanvas } from './LayoutCanvas';
import { DepthSelector } from './DepthSelector';
import { LayerPanel } from './LayerPanel';
import { LayoutInspector } from './LayoutInspector';
import { useViewerStore } from '../../store/viewerStore';

export function LayoutView() {
  const model = useViewerStore(s => s.layoutModel);
  return (
    <div className="shell">
      <div className="panel-left">
        <HierarchyPanel />
        <LayerPanel />
      </div>
      <div className="canvas-col">
        <div className="layout-bar"><DepthSelector />{model && <span className="layout-stats">{model.stats.instancesMatched}/{model.stats.instancesTotal} blocks placed</span>}</div>
        {model ? <LayoutCanvas /> : <div className="insp-empty" style={{ marginTop: 80 }}>Load a DSPF (top bar) to build the physical map.</div>}
      </div>
      <div className="panel-right"><LayoutInspector /></div>
    </div>
  );
}
```

> If `HierarchyPanel` already renders its own outer container, wrap as needed to match the existing left-column markup; check `src/components/HierarchyPanel.tsx` and mirror its class names rather than introducing `panel-left` if that class doesn't exist.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/DepthSelector.tsx src/components/layout/LayerPanel.tsx src/components/layout/LayoutInspector.tsx src/components/layout/LayoutView.tsx
git commit -m "feat(layout): depth selector, layer panel, inspector, and layout view"
```

---

## Task 12: Wire into the app (mode toggle, Add DSPF, CSS) + final verification

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `LayoutView`, store `appMode`/`setAppMode`/`loadLayout`, `parseDspfAsync`.

- [ ] **Step 1: Render LayoutView when in layout mode**

In `src/App.tsx`, import and branch on `appMode`. Replace the `design` branch body:
```tsx
import { LayoutView } from './components/layout/LayoutView';
// ...
export default function App() {
  const { design, warnings, currentCell, appMode } = useViewerStore();
  return (
    <div className="app">
      <TopBar />
      {!design ? (
        <DropZone />
      ) : appMode === 'layout' ? (
        <LayoutView />
      ) : (
        <div className="shell">
          <HierarchyPanel />
          <div className="canvas-col">
            <CanvasErrorBoundary resetKey={currentCell}>
              <SchematicCanvas />
            </CanvasErrorBoundary>
          </div>
          <InspectorPanel />
        </div>
      )}
      <SearchPalette />
      {warnings.length > 0 && (
        <details className="warnings-bar">
          <summary>{warnings.length} parse warning{warnings.length !== 1 ? 's' : ''}</summary>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the mode toggle + Add DSPF to TopBar**

In `src/components/TopBar.tsx`: pull `appMode, setAppMode, loadLayout, layoutModel` from the store, add a hidden DSPF file input + handler, and render a Schematic/Layout toggle (Layout disabled until a DSPF is correlated). Add inside the `design && (<> ... </>)` block, before the view-mode buttons:
```tsx
            {/* App mode toggle */}
            <div className="mode-btns">
              <button className={appMode === 'schematic' ? 'on' : ''} onClick={() => setAppMode('schematic')}>Schematic</button>
              <button className={appMode === 'layout' ? 'on' : ''} disabled={!layoutModel}
                      title={layoutModel ? '' : 'Load a DSPF first'}
                      onClick={() => setAppMode('layout')}>Layout</button>
            </div>
            <input ref={dspfRef} type="file" accept=".dspf,.spf,.txt" style={{ display: 'none' }} onChange={handleDspf} />
            <button onClick={() => dspfRef.current?.click()}>Add DSPF</button>
```
Add near the other refs/handlers:
```tsx
  const dspfRef = useRef<HTMLInputElement>(null);
  const { appMode, setAppMode, loadLayout, layoutModel } = useViewerStore();
  const handleDspf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try { const data = await parseDspfAsync(ev.target?.result as string); loadLayout(data); setAppMode('layout'); }
      catch (err) { setParseError(err instanceof Error ? err.message : String(err)); }
    };
    reader.readAsText(file); e.target.value = '';
  };
```
and import: `import { parseDspfAsync } from '../layout-viewer/dspf/parseDspfAsync';`
(Note: `useViewerStore()` is already called once in TopBar — merge the new fields into the existing destructure rather than calling it twice.)

- [ ] **Step 3: Add CSS**

Append to `src/index.css`:
```css
/* ── Abstract Layout Viewer ───────────────────────────────── */
.layout-canvas-wrap { position: absolute; inset: 46px 0 0 0; overflow: hidden; cursor: grab; background:
  radial-gradient(circle at 1px 1px, #1a2029 1px, transparent 0); background-size: 24px 24px; background-color: #0a0d12; }
.layout-canvas-wrap:active { cursor: grabbing; }
.layout-bar { position: absolute; top: 0; left: 0; right: 0; height: 46px; display: flex; align-items: center;
  gap: 14px; padding: 0 16px; z-index: 5; }
.layout-stats { margin-left: auto; font-size: 11px; color: var(--txt-faint); font-family: 'Space Mono', monospace; }
.depth-row { display: flex; align-items: center; gap: 5px; }
.depth-label { font-size: 10px; letter-spacing: 1px; color: var(--txt-faint); text-transform: uppercase; margin-right: 4px; }
.depth-row button { background: var(--panel-2); border: 1px solid var(--line); color: var(--txt-dim);
  padding: 5px 10px; border-radius: 7px; font-size: 12px; cursor: pointer; font-family: 'Space Mono', monospace; }
.depth-row button.on { background: var(--accent-soft); color: #cfe3ff; border-color: #2c4a6e; }
.layer-panel { padding: 14px 15px; border-top: 1px solid var(--line-soft); }
.layer-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1.1px; color: var(--txt-faint); margin-bottom: 8px; }
.layer-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.layer-chip { font-size: 10px; font-family: 'Space Mono', monospace; padding: 4px 8px; border-radius: 6px;
  border: 1px solid var(--line); cursor: pointer; color: var(--txt-dim); background: var(--panel-2);
  display: flex; align-items: center; gap: 5px; }
.layer-chip.off { opacity: .4; text-decoration: line-through; }
.layer-sw { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.nolayer-note { font-size: 11px; color: var(--txt-faint); font-style: italic; line-height: 1.5; }
```

- [ ] **Step 4: Full verification**

Run each and confirm:
```bash
npm run test:layout   # expect: all layout tests pass
npm test              # expect: 65 passed, 0 failed
npx tsc --noEmit -p tsconfig.app.json   # expect: no errors
npm run lint          # expect: no errors (fix any unused imports)
npm run build         # expect: built successfully
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/TopBar.tsx src/index.css
git commit -m "feat(layout): wire layout mode into app shell, top bar, and styles"
```

- [ ] **Step 6: Manual validation handoff (user)**

The user loads a CDL then a real DSPF and confirms the four acceptance criteria from the spec (§12): layer-tagged DSPF shows colored connections + working layer toggles; no-layer DSPF degrades to neutral with the panel hidden; selecting a block shows its instance + touching net boxes with inspector details; schematic mode and the 65 tests are unaffected.

---

## Self-Review

**Spec coverage:** appMode integration (Task 8, 12) ✓; DSPF parser incl. header/coords/parasitics/layers/device-fallback (Tasks 2–3) ✓; correlation normalize/hierarchy/instance-bbox/net-bbox/connections/stats (Tasks 4–5) ✓; Canvas2D render + pan/zoom/select (Tasks 6, 7, 10) ✓; depth selector + layer panel + graceful no-layer degradation (Tasks 11, 12) ✓; two-file load (Task 12) ✓; TDD with synthetic fixtures (Tasks 1–8) ✓; 65 CDL tests untouched (verified in Tasks 1, 8, 12) ✓. Out-of-scope items (zone dropdown, deck.gl) correctly absent.

**Placeholder scan:** No TBD/TODO. The one inline-`require` in Task 10 is explicitly flagged and removed in Task 10 Step 2. The `HierarchyPanel` markup caveat in Task 11 instructs verifying the existing class names before composing.

**Type consistency:** `LayoutData`/`LayoutModel`/`Bbox` defined once in `model.ts` (Task 1) and imported everywhere; `correlate(Design, LayoutData): LayoutModel` signature matches its consumers (store Task 8); `pickInstance(model, depth, wx, wy)` and the `View` transform API match `LayoutCanvas` usage; `LayoutDepth`/`AppMode` defined in the store and reused by `DepthSelector`/`App`/`TopBar`.

**Open validation risks (carry into manual testing):** (1) the per-directive coordinate arity heuristic in `parseDspf` may need tuning against real vendor lines; (2) name-normalization separators may need extending if a real file uses a separator not in {divider, delimiter}; (3) `net.instances` deepest-prefix matching is approximate. All three are isolated to pure functions with fixtures and surfaced via `stats`.
