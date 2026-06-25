# DSPF Parser Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc line-`startsWith` DSPF reader (`src/layout-viewer/dspf/parseDspf.ts`) with a robust, modular DSPF parser that handles real-world extraction-tool output — SPICE `+` continuations, resistor/capacitor geometry (`$X/$Y/$X2/$Y2`), multiple layer-tag spellings (`$layer=` and `$lvl=`+`*N name` map), engineering-suffix numbers, header dialect variation, and meters↔microns units — while emitting a richer `LayoutData` plus parse diagnostics.

**Architecture:** A small pipeline of pure, separately-tested modules — `units` (number parsing) → `lines` (logical-line reassembly) → `tokens` (paren/key-value tokenizing) → `elements` (R/C element parsing) → `parseDspf` (streaming orchestrator/state machine). The orchestrator produces a richer `LayoutData`; `correlate()` is updated to consume the new geometry (resistor coordinates, multi-source net bboxes, layer sets). DSPF parsing keeps running in the existing web worker. Everything except the worker glue and the React inspector is a pure function with unit tests.

**Tech Stack:** TypeScript, React 19, Zustand, Canvas2D, Vite module worker. Tests via Node's built-in test runner through `tsx` (`node --import tsx --test`), invoked by the existing `npm run test:layout` script. The CDL parser (Pyodide `eda-netlist-parser`) and its `npm test` suite are untouched.

## Global Constraints

- **Do NOT read** the private real sample files (`sample_cdl/`, `sample_dspf/`, or any `~/Downloads/Abstract_Layout_Viewer_Handoff/*`). All automated tests use hand-authored synthetic fixtures inline in the test files. Real files are validated by the user.
- The existing **65 CDL adapter tests (`npm test`) must stay green** the entire time — they are independent of this work.
- **Schematic mode behavior must be unchanged** — this is all under `src/layout-viewer/` and the layout components.
- Layout tests run via: `npm run test:layout` (globs `src/layout-viewer/**/*.test.ts`, `src/components/layout/**/*.test.ts`, `src/store/**/*.test.ts`).
- Coordinates are µm; bbox tuples are always `[minx, miny, maxx, maxy]`.
- **No new runtime dependencies.** Built-ins only (Canvas2D, workers). `tsx` is already a devDependency.
- TypeScript strict mode is on (`tsc -b` must pass). Avoid `any`; use `null` for "absent coordinate", never `NaN`, in stored data.

---

## Background: why a rewrite (read before starting)

The current `parseDspf.ts` works on the synthetic fixtures but fails on real DSPF because:

1. **No SPICE line continuation.** Real `R`/`C`/`*|I`/`*|S` lines wrap onto `+` lines; the old reader parses each physical line alone and drops the continuation.
2. **It never reads resistor geometry.** Real extractors put the metal-slab rectangle on the R line as key-values, e.g.
   `rnet8|6 net8:9 net8:11 0.322765 $w=0.05 $l=0.0353553 $layer=M1 $X=1.322 $Y=0.7 $X2=1.347 $Y2=0.945`
   The old reader only reads coordinates from `*|S (name X Y)` parentheses, so the RC skeleton and many net boxes come out empty on these files.
3. **Fragile coordinate detection.** `parseParen(payload, minArity)` assumes "coords are the last two tokens if token-count ≥ a magic number," which misreads variable-arity lines (grabs a width/value as a coordinate, or misses coords).
4. **One layer spelling only.** It matches `$layer=` on R lines only. Real files also use `$lvl=<n>` with a separate `*<n> <name>` layer map, and carry layers on C lines and `*|S` nodes too — so the "layer story" silently degrades.
5. **No units handling.** QRC emits microns, Calibre xRC emits meters; without normalization boxes can be off by 1e6.
6. **No engineering suffixes.** Values like `0.5p`, `1.2u` are not understood.
7. **No diagnostics.** When a real file produces a bad map there is no signal about coverage (how many points had coords, how many R had geometry, etc.).

There is **no off-the-shelf parser to adopt**: no JS/TS DSPF parser exists; the one Python library that claims DSPF (`eda-netlist-parser`, already used here for CDL) extracts RC + layer interfaces but **discards X,Y coordinates entirely** (its `*|S/*|I/*|P` regexes capture name+`$lvl` only and require `$lvl=`). DSPF is also not strictly standardized — vendors hand-roll readers. So we build a robust custom one, which is what this plan does.

### DSPF format reference (what the parser must accept)

```
*|DSPF 1.5                          ← generator/version banner (varies)
*|DESIGN "TOP"
*|DIVIDER /                         ← hierarchy separator (/ or | or .)
*|DELIMITER :                       ← pin separator (: or #)
*|BUSBIT [ ]                        ← optional bus delimiter
*|GROUND_NET VSS                    ← zero or more
*5 metal3                           ← layer map entry: number → name (for $lvl=)
...
*|NET VOUTP 1.234e-13               ← opens a net context; second field is total cap
*|P (VOUTP outpin 4 9.94 3.81)      ← port; coords are the trailing X Y (NOT fixed arity)
*|S (VOUTP:1 9.94 3.81)             ← subnode (polygon fracture point)
*|S (VOUTP:2 $lvl=5 18.69 12.86)    ← subnode with layer via $lvl + map
*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)   ← instance pin WITH coords → a device point
*|I (X100/M2:g X100/M2 g pch 0.5)             ← instance pin WITHOUT coords (CLKGEN case)
R1 VOUTP:1 VOUTP:2 12.3 $layer=metal3 $X=9.94 $Y=3.81 $X2=18.69 $Y2=12.86
C1 VOUTP:1 0 0.5f                   ← grounded cap
C7 VOUTP:1 VCLK:3 0.02f             ← coupling cap (second node is another net)
```

Continuations:
```
*|I (X100/M1:d X100/M1
+    d pch 0.5 3.99 8.33)           ← '+' continues the previous logical line
R9 a b 1.0 $w=0.05 \               ← trailing '\' also continues
+   $layer=M2 $X=1 $Y=2 $X2=3 $Y2=4
```

Dialect facts to honor: divider/delimiter vary (`/ :`, `| :`, `/ #`); coordinates are trailing numeric tokens **or** explicit `$X=/$Y=`; layer is `$layer=<name>` **or** `$lvl=<n>` resolved through the `*<n> <name>` map; numbers may carry SI suffixes (`f p n u m k meg g t`); coordinates may be in meters (sub-milli magnitudes) and need ×1e6.

---

## File Structure

**Create:**
- `src/layout-viewer/dspf/units.ts` — `parseSpiceNumber`, `isNumericToken`, `num`.
- `src/layout-viewer/dspf/units.test.ts`
- `src/layout-viewer/dspf/lines.ts` — `forEachLogicalLine`, `toLogicalLines` (continuation reassembly).
- `src/layout-viewer/dspf/lines.test.ts`
- `src/layout-viewer/dspf/tokens.ts` — `splitTokens`, `parseKeyVals`, `parseParenPayload`.
- `src/layout-viewer/dspf/tokens.test.ts`
- `src/layout-viewer/dspf/elements.ts` — `parseResistor`, `parseCapacitor`, `ResolveLayer`.
- `src/layout-viewer/dspf/elements.test.ts`

**Rewrite:**
- `src/layout-viewer/model.ts` — richer `LayoutData`/`DspfNet`/`DspfPoint`/`DspfResistor`/`DspfCapacitor`/`DspfDevice`/`DspfDiagnostics`; `LayoutModel` gains `diagnostics`; bbox helpers unchanged.
- `src/layout-viewer/dspf/parseDspf.ts` — streaming orchestrator.
- `src/layout-viewer/dspf/parseDspf.test.ts` — new end-to-end tests.
- `src/layout-viewer/correlate.ts` — consume new geometry.
- `src/layout-viewer/correlate.test.ts` — keep 2 existing tests; add geometry/coupling/units/`$lvl` tests.

**Modify:**
- `src/components/layout/LayoutInspector.tsx` — show a parse report from `model.diagnostics` when nothing is selected.

**Unchanged (verify they still compile):** `src/layout-viewer/dspf/dspf.worker.ts`, `parseDspfAsync.ts`, `src/store/viewerStore.ts`, `insights.ts`, `transform.ts`, `pick.ts` — all import only stable names (`LayoutData`, `LayoutModel`, `parseDspf`).

---

## Canonical types (defined in Task 1; reused verbatim everywhere)

```ts
export type Bbox = [number, number, number, number];

export interface DspfPoint { name: string; x: number | null; y: number | null; layer: string | null }

export interface DspfResistor {
  name: string; a: string; b: string;
  value: number | null;        // ohms (suffixes resolved)
  layer: string | null;
  x1: number | null; y1: number | null;   // metal-slab rectangle corners (µm)
  x2: number | null; y2: number | null;
  width: number | null; length: number | null;
}

export interface DspfCapacitor {
  name: string; a: string; b: string;
  value: number | null;        // farads
  layer: string | null;
  x: number | null; y: number | null;
  coupling: boolean;           // true when b is not ground ("0")
}

export interface DspfNet {
  name: string;
  totalCap: number | null;
  ports: DspfPoint[];          // *|P
  subnodes: DspfPoint[];       // *|S
  instPins: DspfPoint[];       // *|I that carried coords (and those that didn't, x/y null)
  resistors: DspfResistor[];
  capacitors: DspfCapacitor[];
}

export interface DspfDevice { path: string; x: number; y: number }  // coordinate-bearing only

export interface DspfDiagnostics {
  logicalLines: number; nets: number; devices: number;
  resistors: number; resistorsWithGeometry: number;
  capacitors: number; couplingCaps: number;
  pointsWithCoords: number; unitScale: number;
  unrecognized: number; warnings: string[];
}

export interface LayoutData {
  divider: string; delimiter: string; busDelimiter: string | null;
  groundNets: string[]; design: string | null; generator: string | null;
  layerMap: Record<string, string>; layersPresent: boolean; layers: string[];
  nets: DspfNet[]; devices: DspfDevice[]; diagnostics: DspfDiagnostics;
}

export interface LayoutInstance { id: string; label: string; depth: number; deviceCount: number; bbox: Bbox }
export interface LayoutNet { name: string; bbox: Bbox; subnodes: number; parasitics: number; layers: string[]; instances: string[] }
export interface LayoutConnection { net: string; layer: string | null; points: Array<[number, number]> }
export interface LayoutModel {
  design: string; extent: Bbox; layers: string[];
  instances: LayoutInstance[]; nets: LayoutNet[]; connections: LayoutConnection[];
  stats: { instancesMatched: number; instancesTotal: number; devicesMatched: number };
  diagnostics: DspfDiagnostics;
}
```

---

## Task 1: Rewrite the data model (rich types + diagnostics)

**Files:**
- Rewrite: `src/layout-viewer/model.ts`
- Modify: `src/layout-viewer/model.test.ts` (keep bbox tests; add a diagnostics-shape guard)

**Interfaces:**
- Produces: all canonical types above, plus the unchanged geometry helpers `emptyBbox()`, `extendBbox(b,x,y)`, `bboxValid(b)`, `bboxSize(b)`, `bboxArea(b)`, `unionInto(a,b)`. Every later task imports from here.

- [ ] **Step 1: Keep the existing bbox test, add a model-surface test**

Append to `src/layout-viewer/model.test.ts`:
```ts
import { emptyBbox } from './model';
import type { LayoutData } from './model';

test('LayoutData has the rich shape with diagnostics', () => {
  const d: LayoutData = {
    divider: '/', delimiter: ':', busDelimiter: null,
    groundNets: [], design: null, generator: null,
    layerMap: {}, layersPresent: false, layers: [],
    nets: [], devices: [],
    diagnostics: {
      logicalLines: 0, nets: 0, devices: 0, resistors: 0,
      resistorsWithGeometry: 0, capacitors: 0, couplingCaps: 0,
      pointsWithCoords: 0, unitScale: 1, unrecognized: 0, warnings: [],
    },
  };
  assert.equal(d.diagnostics.unitScale, 1);
  assert.equal(emptyBbox().length, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:layout`
Expected: FAIL — type error / property mismatch against the old `LayoutData` shape (old model has `parasitics`, no `diagnostics`).

- [ ] **Step 3: Rewrite `src/layout-viewer/model.ts`**

Replace the entire file with:
```ts
// Shared types + geometry helpers for the Abstract Layout Viewer.
// Bbox is always [minx, miny, maxx, maxy] in µm.
export type Bbox = [number, number, number, number];

// ---- DSPF parse output (design-agnostic) -------------------------------
export interface DspfPoint { name: string; x: number | null; y: number | null; layer: string | null }

export interface DspfResistor {
  name: string; a: string; b: string;
  value: number | null;
  layer: string | null;
  x1: number | null; y1: number | null;
  x2: number | null; y2: number | null;
  width: number | null; length: number | null;
}

export interface DspfCapacitor {
  name: string; a: string; b: string;
  value: number | null;
  layer: string | null;
  x: number | null; y: number | null;
  coupling: boolean;
}

export interface DspfNet {
  name: string;
  totalCap: number | null;
  ports: DspfPoint[];
  subnodes: DspfPoint[];
  instPins: DspfPoint[];
  resistors: DspfResistor[];
  capacitors: DspfCapacitor[];
}

export interface DspfDevice { path: string; x: number; y: number }

export interface DspfDiagnostics {
  logicalLines: number; nets: number; devices: number;
  resistors: number; resistorsWithGeometry: number;
  capacitors: number; couplingCaps: number;
  pointsWithCoords: number; unitScale: number;
  unrecognized: number; warnings: string[];
}

export interface LayoutData {
  divider: string; delimiter: string; busDelimiter: string | null;
  groundNets: string[]; design: string | null; generator: string | null;
  layerMap: Record<string, string>; layersPresent: boolean; layers: string[];
  nets: DspfNet[]; devices: DspfDevice[]; diagnostics: DspfDiagnostics;
}

// ---- Correlated, viewer-ready model ------------------------------------
export interface LayoutInstance {
  id: string; label: string; depth: number; deviceCount: number; bbox: Bbox;
}
export interface LayoutNet {
  name: string; bbox: Bbox; subnodes: number; parasitics: number;
  layers: string[]; instances: string[];
}
export interface LayoutConnection {
  net: string; layer: string | null; points: Array<[number, number]>;
}
export interface LayoutModel {
  design: string; extent: Bbox; layers: string[];
  instances: LayoutInstance[]; nets: LayoutNet[]; connections: LayoutConnection[];
  stats: { instancesMatched: number; instancesTotal: number; devicesMatched: number };
  diagnostics: DspfDiagnostics;
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

> Note: this makes `parseDspf.ts` and `correlate.ts` fail to compile until Tasks 6–7. That is expected; `model.test.ts` is the only test that should pass at the end of this task. Run the single test file to confirm the model itself is sound.

- [ ] **Step 4: Run the model test in isolation**

Run: `node --import tsx --test src/layout-viewer/model.test.ts`
Expected: PASS (3 tests). `npm run test:layout` will still fail to compile elsewhere — that is fine until Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/model.ts src/layout-viewer/model.test.ts
git commit -m "feat(dspf): rich LayoutData model + parse diagnostics"
```

---

## Task 2: SPICE number parsing (`units.ts`)

**Files:**
- Create: `src/layout-viewer/dspf/units.ts`
- Create: `src/layout-viewer/dspf/units.test.ts`

**Interfaces:**
- Produces: `parseSpiceNumber(raw: string): number` (resolves SI suffixes; `NaN` on failure), `isNumericToken(tok: string): boolean` (whole token is a plain/scientific number), `num(raw: string | undefined): number | null` (parse or `null`).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/layout-viewer/dspf/units.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpiceNumber, isNumericToken, num } from './units';

test('parseSpiceNumber: plain + scientific', () => {
  assert.equal(parseSpiceNumber('1.5'), 1.5);
  assert.equal(parseSpiceNumber('-3.99e-6'), -3.99e-6);
  assert.equal(parseSpiceNumber('.25'), 0.25);
});

test('parseSpiceNumber: engineering suffixes', () => {
  assert.equal(parseSpiceNumber('0.5p'), 0.5e-12);
  assert.equal(parseSpiceNumber('1.2u'), 1.2e-6);
  assert.equal(parseSpiceNumber('5k'), 5e3);
  assert.equal(parseSpiceNumber('1meg'), 1e6);   // meg before milli
  assert.equal(parseSpiceNumber('2m'), 2e-3);
  assert.equal(parseSpiceNumber('3f'), 3e-15);
});

test('parseSpiceNumber: trailing unit letters are ignored after the scale', () => {
  assert.equal(parseSpiceNumber('12.3ohm'), 12.3);   // 'o' is not a scale → value as-is
  assert.equal(Number.isNaN(parseSpiceNumber('abc')), true);
  assert.equal(Number.isNaN(parseSpiceNumber('')), true);
});

test('isNumericToken only accepts whole numeric tokens', () => {
  assert.equal(isNumericToken('9.94'), true);
  assert.equal(isNumericToken('-1e3'), true);
  assert.equal(isNumericToken('X9/M1:o'), false);
  assert.equal(isNumericToken('0.5p'), false);       // has suffix → not a bare coordinate
});

test('num returns null on absent/invalid', () => {
  assert.equal(num(undefined), null);
  assert.equal(num('1.322'), 1.322);
  assert.equal(num('nope'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/layout-viewer/dspf/units.test.ts`
Expected: FAIL — `Cannot find module './units'`.

- [ ] **Step 3: Write the implementation**

Create `src/layout-viewer/dspf/units.ts`:
```ts
// SPICE engineering-suffix number parsing for DSPF values.
const SUFFIX: Record<string, number> = {
  f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, '\u00b5': 1e-6, m: 1e-3,
  k: 1e3, x: 1e6, g: 1e9, t: 1e12,
};

export function parseSpiceNumber(raw: string): number {
  if (!raw) return NaN;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/.exec(raw.trim());
  if (!m) return NaN;
  const mantissa = Number(m[1]);
  if (!Number.isFinite(mantissa)) return NaN;
  const tail = m[2].trim().toLowerCase();
  if (!tail) return mantissa;
  if (tail.startsWith('meg')) return mantissa * 1e6;
  const f = SUFFIX[tail[0]];
  return f !== undefined ? mantissa * f : mantissa;
}

export function isNumericToken(tok: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(tok);
}

export function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const v = parseSpiceNumber(raw);
  return Number.isFinite(v) ? v : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/layout-viewer/dspf/units.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/units.ts src/layout-viewer/dspf/units.test.ts
git commit -m "feat(dspf): SPICE engineering-suffix number parsing"
```

---

## Task 3: Logical-line reassembly (`lines.ts`)

**Files:**
- Create: `src/layout-viewer/dspf/lines.ts`
- Create: `src/layout-viewer/dspf/lines.test.ts`

**Interfaces:**
- Produces: `forEachLogicalLine(text: string, cb: (line: string) => void): void` and `toLogicalLines(text: string): string[]`. Joins `+`-continuation lines and trailing-`\` continuations; drops blank lines; right-trims each line; the orchestrator streams over `forEachLogicalLine`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/layout-viewer/dspf/lines.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLogicalLines } from './lines';

test('joins +-continuation lines into one logical line', () => {
  const text = [
    '*|I (X100/M1:d X100/M1',
    '+    d pch 0.5 3.99 8.33)',
    'R1 a b 1.0',
  ].join('\n');
  assert.deepEqual(toLogicalLines(text), [
    '*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)',
    'R1 a b 1.0',
  ]);
});

test('joins trailing-backslash continuations', () => {
  const text = 'R9 a b 1.0 $w=0.05 \\\n+   $layer=M2 $X=1 $Y=2';
  assert.deepEqual(toLogicalLines(text), ['R9 a b 1.0 $w=0.05  $layer=M2 $X=1 $Y=2']);
});

test('drops blank lines and CRLF, right-trims', () => {
  const text = '*|NET N 1   \r\n\r\n*|S (N:1 0 0)\r\n';
  assert.deepEqual(toLogicalLines(text), ['*|NET N 1', '*|S (N:1 0 0)']);
});

test('handles multiple consecutive + continuations', () => {
  const text = 'R1 a b 1\n+ $x=1\n+ $y=2\n+ $x2=3';
  assert.deepEqual(toLogicalLines(text), ['R1 a b 1 $x=1 $y=2 $x2=3']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/layout-viewer/dspf/lines.test.ts`
Expected: FAIL — `Cannot find module './lines'`.

- [ ] **Step 3: Write the implementation**

Create `src/layout-viewer/dspf/lines.ts`:
```ts
// Reassemble DSPF physical lines into logical lines:
//  - a line whose (leading-trimmed) content starts with '+' continues the previous one
//  - a line ending with '\' continues onto the next
// Blank logical lines are dropped; trailing whitespace is removed.
export function forEachLogicalLine(text: string, cb: (line: string) => void): void {
  const raw = text.split(/\r?\n/);
  let cur = '';
  let have = false;
  const flush = () => { if (have && cur.trim()) cb(cur); have = false; cur = ''; };
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].replace(/\s+$/, '');
    const lead = line.replace(/^\s+/, '');
    if (lead.startsWith('+')) {
      if (have) cur += ' ' + lead.slice(1).trim();
      else { cur = lead.slice(1).trim(); have = true; }
      continue;
    }
    if (have && cur.endsWith('\\')) {
      cur = cur.slice(0, -1).replace(/\s+$/, '') + ' ' + lead.trim();
      continue;
    }
    flush();
    cur = line; have = true;
  }
  flush();
}

export function toLogicalLines(text: string): string[] {
  const out: string[] = [];
  forEachLogicalLine(text, (l) => out.push(l));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/layout-viewer/dspf/lines.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/lines.ts src/layout-viewer/dspf/lines.test.ts
git commit -m "feat(dspf): logical-line reassembly for + and backslash continuations"
```

---

## Task 4: Tokenizing — key-values and parenthesized payloads (`tokens.ts`)

**Files:**
- Create: `src/layout-viewer/dspf/tokens.ts`
- Create: `src/layout-viewer/dspf/tokens.test.ts`

**Interfaces:**
- Produces:
  - `splitTokens(s: string): string[]` — whitespace split, no empties.
  - `parseKeyVals(tokens: string[]): { params: Map<string,string>; rest: string[] }` — pulls `key=val` / `$key=val` into `params` (lowercased, leading `$` stripped); everything else preserved in order in `rest`.
  - `parseParenPayload(payload: string): ParenInfo | null` where `ParenInfo = { name: string; x: number | null; y: number | null; params: Map<string,string> }`. `name` is the first non-kv token; coords come from `$x`/`$y` if present, else the trailing two **numeric** tokens.
- Consumes: `parseSpiceNumber`, `isNumericToken` from `./units`.

- [ ] **Step 1: Write the failing test**

Create `src/layout-viewer/dspf/tokens.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTokens, parseKeyVals, parseParenPayload } from './tokens';

test('parseKeyVals separates $key=val from positional tokens', () => {
  const { params, rest } = parseKeyVals(splitTokens('a b 1.0 $w=0.05 $layer=M1 tc1=0.001'));
  assert.deepEqual(rest, ['a', 'b', '1.0']);
  assert.equal(params.get('w'), '0.05');
  assert.equal(params.get('layer'), 'M1');
  assert.equal(params.get('tc1'), '0.001');
});

test('parseParenPayload: trailing two numerics are the coords', () => {
  assert.deepEqual(parseParenPayload('(VOUTP:1 9.94 3.81)'),
    { name: 'VOUTP:1', x: 9.94, y: 3.81, params: new Map() });
});

test('parseParenPayload: variable arity, coords still trailing', () => {
  const info = parseParenPayload('(X100/M1:d X100/M1 d pch 0.5 3.99 8.33)')!;
  assert.equal(info.name, 'X100/M1:d');
  assert.equal(info.x, 3.99);
  assert.equal(info.y, 8.33);
});

test('parseParenPayload: no trailing numerics → null coords (CLKGEN)', () => {
  const info = parseParenPayload('(X100/M2:g X100/M2 g pch 0.5)')!;
  assert.equal(info.name, 'X100/M2:g');
  assert.equal(info.x, null);
  assert.equal(info.y, null);
});

test('parseParenPayload: explicit $x/$y override + layer param survives', () => {
  const info = parseParenPayload('(N:2 $lvl=5 $x=18.69 $y=12.86)')!;
  assert.equal(info.x, 18.69);
  assert.equal(info.y, 12.86);
  assert.equal(info.params.get('lvl'), '5');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/layout-viewer/dspf/tokens.test.ts`
Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 3: Write the implementation**

Create `src/layout-viewer/dspf/tokens.ts`:
```ts
import { parseSpiceNumber, isNumericToken } from './units';

export function splitTokens(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

export interface SplitKV { params: Map<string, string>; rest: string[] }

export function parseKeyVals(tokens: string[]): SplitKV {
  const params = new Map<string, string>();
  const rest: string[] = [];
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq > 0) params.set(t.slice(0, eq).replace(/^\$/, '').toLowerCase(), t.slice(eq + 1));
    else rest.push(t);
  }
  return { params, rest };
}

export interface ParenInfo { name: string; x: number | null; y: number | null; params: Map<string, string> }

export function parseParenPayload(payload: string): ParenInfo | null {
  const inner = payload.trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return null;
  const { params, rest } = parseKeyVals(splitTokens(inner));
  if (rest.length === 0) return null;
  const name = rest[0];
  let x: number | null = null;
  let y: number | null = null;
  if (params.has('x') && params.has('y')) {
    const px = parseSpiceNumber(params.get('x')!);
    const py = parseSpiceNumber(params.get('y')!);
    if (Number.isFinite(px) && Number.isFinite(py)) { x = px; y = py; }
  }
  if (x === null && rest.length >= 3) {
    const a = rest[rest.length - 2];
    const b = rest[rest.length - 1];
    if (isNumericToken(a) && isNumericToken(b)) { x = Number(a); y = Number(b); }
  }
  return { name, x, y, params };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/layout-viewer/dspf/tokens.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/tokens.ts src/layout-viewer/dspf/tokens.test.ts
git commit -m "feat(dspf): paren-payload + key-value tokenizing with robust coord detection"
```

---

## Task 5: Element parsing — resistors and capacitors (`elements.ts`)

**Files:**
- Create: `src/layout-viewer/dspf/elements.ts`
- Create: `src/layout-viewer/dspf/elements.test.ts`

**Interfaces:**
- Produces:
  - `type ResolveLayer = (params: Map<string,string>) => string | null`
  - `parseResistor(tokens: string[], resolveLayer: ResolveLayer): DspfResistor | null` — `tokens` includes the element name at index 0; reads nodes `a,b`, optional `value`, layer via `resolveLayer`, geometry from `$x/$y/$x2/$y2`, `$w/$l`.
  - `parseCapacitor(tokens: string[], resolveLayer: ResolveLayer): DspfCapacitor | null` — `coupling = b !== "" && b !== "0"`.
- Consumes: `parseKeyVals` from `./tokens`; `parseSpiceNumber`, `num` from `./units`; `DspfResistor`, `DspfCapacitor` from `../model`.

- [ ] **Step 1: Write the failing test**

Create `src/layout-viewer/dspf/elements.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResistor, parseCapacitor, type ResolveLayer } from './elements';
import { splitTokens } from './tokens';

const direct: ResolveLayer = (p) => p.get('layer') ?? null;

test('parseResistor reads nodes, value, layer, slab geometry', () => {
  const r = parseResistor(
    splitTokens('rnet8|6 net8:9 net8:11 0.322765 $w=0.05 $l=0.0353553 $layer=M1 $X=1.322 $Y=0.7 $X2=1.347 $Y2=0.945'),
    direct,
  )!;
  assert.equal(r.name, 'rnet8|6');
  assert.equal(r.a, 'net8:9');
  assert.equal(r.b, 'net8:11');
  assert.equal(r.value, 0.322765);
  assert.equal(r.layer, 'M1');
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [1.322, 0.7, 1.347, 0.945]);
  assert.equal(r.width, 0.05);
});

test('parseResistor with no geometry → null coords, still valid', () => {
  const r = parseResistor(splitTokens('R1 a b 1'), direct)!;
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [null, null, null, null]);
  assert.equal(r.layer, null);
});

test('parseCapacitor: grounded vs coupling', () => {
  const grounded = parseCapacitor(splitTokens('C1 VOUTP:1 0 0.5f'), direct)!;
  assert.equal(grounded.coupling, false);
  assert.equal(grounded.value, 0.5e-15);
  const coupling = parseCapacitor(splitTokens('C7 VOUTP:1 VCLK:3 0.02f'), direct)!;
  assert.equal(coupling.coupling, true);
  assert.equal(coupling.b, 'VCLK:3');
});

test('resolveLayer maps $lvl through a provided map', () => {
  const map = new Map([['5', 'metal3']]);
  const viaLvl: ResolveLayer = (p) => p.get('layer') ?? (p.get('lvl') ? map.get(p.get('lvl')!) ?? null : null);
  const r = parseResistor(splitTokens('R2 a b 1 $lvl=5'), viaLvl)!;
  assert.equal(r.layer, 'metal3');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/layout-viewer/dspf/elements.test.ts`
Expected: FAIL — `Cannot find module './elements'`.

- [ ] **Step 3: Write the implementation**

Create `src/layout-viewer/dspf/elements.ts`:
```ts
import type { DspfResistor, DspfCapacitor } from '../model';
import { parseKeyVals } from './tokens';
import { parseSpiceNumber, num } from './units';

export type ResolveLayer = (params: Map<string, string>) => string | null;

export function parseResistor(tokens: string[], resolveLayer: ResolveLayer): DspfResistor | null {
  if (tokens.length < 3) return null;
  const name = tokens[0];
  const { params, rest } = parseKeyVals(tokens.slice(1));
  const a = rest[0] ?? '';
  const b = rest[1] ?? '';
  if (!a || !b) return null;
  const value = rest[2] !== undefined ? parseSpiceNumber(rest[2]) : NaN;
  return {
    name, a, b,
    value: Number.isFinite(value) ? value : null,
    layer: resolveLayer(params),
    x1: num(params.get('x')), y1: num(params.get('y')),
    x2: num(params.get('x2')), y2: num(params.get('y2')),
    width: num(params.get('w')), length: num(params.get('l')),
  };
}

export function parseCapacitor(tokens: string[], resolveLayer: ResolveLayer): DspfCapacitor | null {
  if (tokens.length < 3) return null;
  const name = tokens[0];
  const { params, rest } = parseKeyVals(tokens.slice(1));
  const a = rest[0] ?? '';
  const b = rest[1] ?? '';
  if (!a) return null;
  const value = rest[2] !== undefined ? parseSpiceNumber(rest[2]) : NaN;
  return {
    name, a, b,
    value: Number.isFinite(value) ? value : null,
    layer: resolveLayer(params),
    x: num(params.get('x')), y: num(params.get('y')),
    coupling: b !== '' && b !== '0',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/layout-viewer/dspf/elements.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/dspf/elements.ts src/layout-viewer/dspf/elements.test.ts
git commit -m "feat(dspf): resistor/capacitor element parsing with geometry + layers"
```

---

## Task 6: Orchestrator — `parseDspf` streaming state machine

**Files:**
- Rewrite: `src/layout-viewer/dspf/parseDspf.ts`
- Rewrite: `src/layout-viewer/dspf/parseDspf.test.ts`

**Interfaces:**
- Produces: `parseDspf(text: string, opts?: { unitScale?: number }): LayoutData`. Streams logical lines; fills header/dialect, layer map, nets, `*|P/S/I` points, R/C elements; derives `devices` from `*|I` coords (fallback to `*|S` when no `*|I` carried coords); infers meters→µm units; fills `diagnostics`.
- Consumes: `forEachLogicalLine` (`./lines`), `splitTokens`/`parseParenPayload` (`./tokens`), `parseResistor`/`parseCapacitor`/`ResolveLayer` (`./elements`), types from `../model`.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/layout-viewer/dspf/parseDspf.test.ts` with:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDspf } from './parseDspf';

test('header divider/delimiter parsed; defaults when absent', () => {
  const withHeader = parseDspf('*|DIVIDER |\n*|DELIMITER #\n');
  assert.equal(withHeader.divider, '|');
  assert.equal(withHeader.delimiter, '#');
  const noHeader = parseDspf('* nothing\n');
  assert.equal(noHeader.divider, '/');
  assert.equal(noHeader.delimiter, ':');
});

test('net subnodes capture coords; *|I with coords yields a device, without does not', () => {
  const d = parseDspf([
    '*|NET VOUTP 1.0',
    '*|S (VOUTP:1 9.94 3.81)',
    '*|S (VOUTP:2 18.69 12.86)',
    '*|I (X100/M1:d X100/M1 d pch 0.5 3.99 8.33)',
    '*|I (X100/M2:g X100/M2 g pch 0.5)',
  ].join('\n'));
  assert.equal(d.nets.length, 1);
  assert.equal(d.nets[0].subnodes.length, 2);
  assert.deepEqual([d.nets[0].subnodes[0].x, d.nets[0].subnodes[0].y], [9.94, 3.81]);
  assert.deepEqual(d.devices, [{ path: 'X100/M1', x: 3.99, y: 8.33 }]);
});

test('resistor geometry + $layer captured; layers collected', () => {
  const d = parseDspf([
    '*|NET N 1',
    '*|S (N:1 0 0)', '*|S (N:2 1 1)',
    'R1 N:1 N:2 12.3 $layer=metal3 $X=0 $Y=0 $X2=1 $Y2=1',
    'C1 N:1 0 0.5f',
  ].join('\n'));
  const r = d.nets[0].resistors[0];
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 1, 1]);
  assert.equal(r.layer, 'metal3');
  assert.deepEqual(d.layers, ['metal3']);
  assert.equal(d.layersPresent, true);
  assert.equal(d.diagnostics.resistorsWithGeometry, 1);
  assert.equal(d.diagnostics.capacitors, 1);
});

test('$lvl resolves through the *N layer map', () => {
  const d = parseDspf([
    '*5 metal3',
    '*|NET N 1',
    '*|S (N:1 0 0)', '*|S (N:2 1 1)',
    'R1 N:1 N:2 1 $lvl=5',
  ].join('\n'));
  assert.equal(d.nets[0].resistors[0].layer, 'metal3');
  assert.deepEqual(d.layers, ['metal3']);
});

test('+ continuation across an *|I line is parsed', () => {
  const d = parseDspf([
    '*|NET N 1',
    '*|I (X1/M1:d X1/M1',
    '+    d nch 0.5 4 5)',
  ].join('\n'));
  assert.deepEqual(d.devices, [{ path: 'X1/M1', x: 4, y: 5 }]);
});

test('no $layer anywhere ⇒ layersPresent false, layers []', () => {
  const d = parseDspf('*|NET N 1\n*|S (N:1 0 0)\nR1 N:1 N:2 5\n');
  assert.equal(d.layersPresent, false);
  assert.deepEqual(d.layers, []);
});

test('devices fall back to *|S names when no *|I has coords (CLKGEN)', () => {
  const d = parseDspf([
    '*|DELIMITER :',
    '*|NET N 1',
    '*|S (X9/X26/M1:s 4 5)',
    '*|I (X9/X26/M1:g X9/X26/M1 g nch 0.5)',
  ].join('\n'));
  assert.deepEqual(d.devices, [{ path: 'X9/X26/M1', x: 4, y: 5 }]);
});

test('meters coordinates are auto-scaled to microns', () => {
  const d = parseDspf([
    '*|NET N 1',
    '*|S (N:1 1.322e-6 0.7e-6)',
    '*|S (N:2 1.347e-6 0.945e-6)',
  ].join('\n'));
  assert.equal(d.diagnostics.unitScale, 1e6);
  assert.equal(d.nets[0].subnodes[0].x, 1.322);
  assert.equal(d.nets[0].subnodes[0].y, 0.7);
});

test('opts.unitScale overrides inference', () => {
  const d = parseDspf('*|NET N 1\n*|S (N:1 2 4)\n', { unitScale: 1 });
  assert.equal(d.nets[0].subnodes[0].x, 2);
});

test('coupling capacitor flagged; ground net + design captured', () => {
  const d = parseDspf([
    '*|DESIGN "TOP"',
    '*|GROUND_NET VSS',
    '*|NET N 1',
    '*|S (N:1 0 0)',
    'C7 N:1 VCLK:3 0.02f',
  ].join('\n'));
  assert.equal(d.design, 'TOP');
  assert.deepEqual(d.groundNets, ['VSS']);
  assert.equal(d.nets[0].capacitors[0].coupling, true);
  assert.equal(d.diagnostics.couplingCaps, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/layout-viewer/dspf/parseDspf.test.ts`
Expected: FAIL — old `parseDspf` does not compile against the new model / lacks the new behavior.

- [ ] **Step 3: Rewrite `src/layout-viewer/dspf/parseDspf.ts`**

Replace the entire file with:
```ts
import type { LayoutData, DspfNet, DspfPoint, DspfDevice, DspfDiagnostics } from '../model';
import { forEachLogicalLine } from './lines';
import { splitTokens, parseParenPayload } from './tokens';
import { parseResistor, parseCapacitor, type ResolveLayer } from './elements';

export interface ParseDspfOptions { unitScale?: number }

function freshDiagnostics(): DspfDiagnostics {
  return {
    logicalLines: 0, nets: 0, devices: 0, resistors: 0,
    resistorsWithGeometry: 0, capacitors: 0, couplingCaps: 0,
    pointsWithCoords: 0, unitScale: 1, unrecognized: 0, warnings: [],
  };
}

function stripPin(name: string, delimiter: string): string {
  const cut = name.lastIndexOf(delimiter);
  return cut > 0 ? name.slice(0, cut) : name;
}

export function parseDspf(text: string, opts: ParseDspfOptions = {}): LayoutData {
  const layerMap = new Map<string, string>();
  const resolveLayer: ResolveLayer = (p) => {
    const direct = p.get('layer');
    if (direct) return direct;
    const lvl = p.get('lvl');
    if (lvl && layerMap.has(lvl)) return layerMap.get(lvl)!;
    return null;
  };

  const diag = freshDiagnostics();
  const data: LayoutData = {
    divider: '/', delimiter: ':', busDelimiter: null,
    groundNets: [], design: null, generator: null,
    layerMap: {}, layersPresent: false, layers: [],
    nets: [], devices: [], diagnostics: diag,
  };
  const layerSet = new Set<string>();
  let net: DspfNet | null = null;
  let sawInstCoords = false;
  const subnodePoints: DspfPoint[] = [];
  const instDevices: DspfDevice[] = [];

  const addLayer = (l: string | null) => { if (l) layerSet.add(l); };
  const recordPoint = (pt: DspfPoint) => { if (pt.x !== null) diag.pointsWithCoords++; addLayer(pt.layer); };

  forEachLogicalLine(text, (line) => {
    diag.logicalLines++;

    if (line.startsWith('*|')) {
      const sp = line.indexOf(' ');
      const tag = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
      const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
      switch (tag) {
        case '*|DIVIDER': data.divider = rest.split(/\s+/)[0] || '/'; break;
        case '*|DELIMITER': data.delimiter = rest.split(/\s+/)[0] || ':'; break;
        case '*|BUSBIT':
        case '*|BUS_DELIMITER': data.busDelimiter = rest.split(/\s+/)[0] || null; break;
        case '*|GROUND_NET': if (rest) data.groundNets.push(rest.split(/\s+/)[0]); break;
        case '*|DESIGN': data.design = rest.replace(/^"|"$/g, '') || null; break;
        case '*|DSPF':
        case '*|PROGRAM':
        case '*|VERSION': data.generator = (data.generator ? data.generator + ' ' : '') + rest; break;
        case '*|NET': {
          const tok = rest.split(/\s+/);
          const cap = tok[1] !== undefined ? Number(tok[1]) : NaN;
          net = {
            name: tok[0] ?? '', totalCap: Number.isFinite(cap) ? cap : null,
            ports: [], subnodes: [], instPins: [], resistors: [], capacitors: [],
          };
          data.nets.push(net); diag.nets++;
          break;
        }
        case '*|P': {
          const info = parseParenPayload(rest);
          if (info && net) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            net.ports.push(pt); recordPoint(pt);
          }
          break;
        }
        case '*|S': {
          const info = parseParenPayload(rest);
          if (info && net) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            net.subnodes.push(pt); recordPoint(pt);
            if (pt.x !== null && pt.y !== null) subnodePoints.push(pt);
          }
          break;
        }
        case '*|I': {
          const info = parseParenPayload(rest);
          if (info) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            if (net) net.instPins.push(pt);
            recordPoint(pt);
            if (info.x !== null && info.y !== null) {
              sawInstCoords = true;
              instDevices.push({ path: stripPin(info.name, data.delimiter), x: info.x, y: info.y });
            }
          }
          break;
        }
        default: diag.unrecognized++; break;
      }
      return;
    }

    if (line.startsWith('*')) {
      const m = /^\*(\d+)\s+(\S+)/.exec(line);
      if (m) layerMap.set(m[1], m[2].replace(/:.*$/, ''));
      return; // plain comment
    }

    const head = line[0];
    if (head === '.') return; // .SUBCKT/.ENDS/.GLOBAL/.PARAM — structure not needed for the abstract map

    const c = head.toLowerCase();
    if (c === 'r') {
      const r = parseResistor(splitTokens(line), resolveLayer);
      if (r && net) {
        net.resistors.push(r); diag.resistors++;
        if (r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null) diag.resistorsWithGeometry++;
        addLayer(r.layer);
      }
      return;
    }
    if (c === 'c') {
      const cap = parseCapacitor(splitTokens(line), resolveLayer);
      if (cap && net) {
        net.capacitors.push(cap); diag.capacitors++;
        if (cap.coupling) diag.couplingCaps++;
        addLayer(cap.layer);
      }
      return;
    }
    // device instance lines (m/x/q/d/...) carry no coordinates for the abstract map → ignored
  });

  // CLKGEN fallback: no *|I carried coords → derive device points from *|S names.
  if (!sawInstCoords) {
    for (const s of subnodePoints) {
      instDevices.push({ path: stripPin(s.name, data.delimiter), x: s.x as number, y: s.y as number });
    }
  }
  data.devices = instDevices;
  diag.devices = instDevices.length;

  const scale = opts.unitScale ?? inferUnitScale(data);
  if (scale !== 1) applyScale(data, scale);
  diag.unitScale = scale;

  data.layerMap = Object.fromEntries(layerMap);
  data.layers = [...layerSet];
  data.layersPresent = data.layers.length > 0;
  return data;
}

function inferUnitScale(data: LayoutData): number {
  let maxAbs = 0;
  const consider = (x: number | null, y: number | null) => {
    if (x !== null) maxAbs = Math.max(maxAbs, Math.abs(x));
    if (y !== null) maxAbs = Math.max(maxAbs, Math.abs(y));
  };
  for (const n of data.nets) {
    for (const p of n.ports) consider(p.x, p.y);
    for (const p of n.subnodes) consider(p.x, p.y);
    for (const p of n.instPins) consider(p.x, p.y);
    for (const r of n.resistors) { consider(r.x1, r.y1); consider(r.x2, r.y2); }
  }
  for (const d of data.devices) consider(d.x, d.y);
  return maxAbs > 0 && maxAbs < 1e-3 ? 1e6 : 1;
}

function applyScale(data: LayoutData, s: number): void {
  const sp = (p: DspfPoint) => { if (p.x !== null) p.x *= s; if (p.y !== null) p.y *= s; };
  for (const n of data.nets) {
    n.ports.forEach(sp); n.subnodes.forEach(sp); n.instPins.forEach(sp);
    for (const r of n.resistors) {
      if (r.x1 !== null) r.x1 *= s; if (r.y1 !== null) r.y1 *= s;
      if (r.x2 !== null) r.x2 *= s; if (r.y2 !== null) r.y2 *= s;
    }
    for (const cp of n.capacitors) { if (cp.x !== null) cp.x *= s; if (cp.y !== null) cp.y *= s; }
  }
  for (const d of data.devices) { d.x *= s; d.y *= s; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/layout-viewer/dspf/parseDspf.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Verify the worker + async wrapper still typecheck**

Run: `npx tsc -b`
Expected: PASS for `dspf.worker.ts` and `parseDspfAsync.ts` (they import only `parseDspf` and `LayoutData`). `correlate.ts` will still error until Task 7 — that is expected; confirm the only remaining errors are in `correlate.ts`/`correlate.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/layout-viewer/dspf/parseDspf.ts src/layout-viewer/dspf/parseDspf.test.ts
git commit -m "feat(dspf): streaming parser orchestrator with geometry, layers, units, diagnostics"
```

---

## Task 7: Update `correlate` to consume the new geometry

**Files:**
- Rewrite: `src/layout-viewer/correlate.ts`
- Modify: `src/layout-viewer/correlate.test.ts` (keep the 2 existing tests; add geometry/coupling/units coverage)

**Interfaces:**
- Produces: `correlate(design: Design, data: LayoutData): LayoutModel` (signature unchanged) plus the unchanged exports `normSegments(name, seps)`, `enumerateHierarchy(design)`, `interface HierNode`. Now builds net bboxes from `ports ∪ subnodes ∪ instPins` (+ resistor corners), collects layers from points + R + C, and builds connections from resistor `(x1,y1)-(x2,y2)` when present, else by resolving endpoints through a name→coord map. `LayoutModel.diagnostics` is passed through from `data.diagnostics`.
- Consumes: types + bbox helpers from `../model`; `Design` from `../parser/types`.

- [ ] **Step 1: Extend the test file**

Append to `src/layout-viewer/correlate.test.ts`:
```ts
test('connections use resistor slab geometry when present', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*|NET VOUT 1',
    '*|S (X9/M1:o 4 5)', '*|S (X9/M2:o 8 9)',
    'R1 X9/M1:o X9/M2:o 1 $layer=metal2 $X=4 $Y=5 $X2=8 $Y2=9',
    '*|I (X9/M1:d X9/M1 d nch 0.5 4 5)',
  ].join('\n'));
  const m = correlate(design, dspf);
  assert.deepEqual(m.connections, [{ net: 'VOUT', layer: 'metal2', points: [[4, 5], [8, 9]] }]);
  assert.equal(m.diagnostics.resistorsWithGeometry, 1);
});

test('net layers gather from subnode + resistor + coupling cap', () => {
  const design = makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] });
  const dspf = parseDspf([
    '*3 m1', '*5 m3',
    '*|NET N 1',
    '*|S (X9/M1:o $lvl=3 0 0)', '*|S (X9/M2:o 2 2)',
    'R1 X9/M1:o X9/M2:o 1 $lvl=5',
    '*|I (X9/M1:d X9/M1 d nch 0.5 0 0)',
  ].join('\n'));
  const m = correlate(design, dspf);
  const net = m.nets.find(n => n.name === 'N')!;
  assert.deepEqual(net.layers.sort(), ['m1', 'm3']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:layout`
Expected: FAIL — `correlate.ts` references old `data.nets[].subnodes` shape / lacks `diagnostics`.

- [ ] **Step 3: Rewrite `src/layout-viewer/correlate.ts`**

Replace the entire file with:
```ts
import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel, LayoutInstance, LayoutNet, LayoutConnection, Bbox } from './model';
import { emptyBbox, extendBbox, bboxValid } from './model';

export interface HierNode { id: string; label: string; depth: number; segs: string[] }

// Lowercase a hierarchical name and split into segments, dropping finger
// suffixes (`<@n>`, trailing `@n`). `seps` is the set of separator chars.
export function normSegments(name: string, seps: string[]): string[] {
  const escaped = seps.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const splitter = new RegExp(`[${escaped}]`);
  return name
    .toLowerCase()
    .split(splitter)
    .map(seg => seg.replace(/<@[^>]*>/g, '').replace(/@\d+$/, '').trim())
    .filter(Boolean);
}

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

export function correlate(design: Design, data: LayoutData): LayoutModel {
  const dspfSeps = [data.divider, data.delimiter];
  const nodes = enumerateHierarchy(design);

  const nodeBox = new Map<string, Bbox>();
  const nodeCount = new Map<string, number>();
  for (const n of nodes) { nodeBox.set(n.id, emptyBbox()); nodeCount.set(n.id, 0); }

  let devicesMatched = 0;
  for (const dev of data.devices) {
    const segs = normSegments(dev.path, dspfSeps);
    let matched = false;
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

  const nodeIds = new Set(nodes.map(n => n.id));
  const nets: LayoutNet[] = data.nets.map(dn => {
    const box = emptyBbox();
    const touched = new Set<string>();
    const layerSet = new Set<string>();
    const points = [...dn.ports, ...dn.subnodes, ...dn.instPins];
    for (const s of points) {
      if (s.layer) layerSet.add(s.layer);
      if (s.x === null || s.y === null) continue;
      extendBbox(box, s.x, s.y);
      const segs = normSegments(s.name, dspfSeps);
      for (let len = segs.length - 1; len >= 1; len--) {
        const id = segs.slice(0, len).join('/');
        if (nodeIds.has(id)) { touched.add(id); break; }
      }
    }
    for (const r of dn.resistors) {
      if (r.layer) layerSet.add(r.layer);
      if (r.x1 !== null && r.y1 !== null) extendBbox(box, r.x1, r.y1);
      if (r.x2 !== null && r.y2 !== null) extendBbox(box, r.x2, r.y2);
    }
    for (const cp of dn.capacitors) if (cp.layer) layerSet.add(cp.layer);
    return {
      name: dn.name,
      bbox: bboxValid(box) ? box : [0, 0, 0, 0],
      subnodes: dn.subnodes.length,
      parasitics: dn.resistors.length + dn.capacitors.length,
      layers: [...layerSet], instances: [...touched],
    };
  });

  // RC skeleton: prefer resistor slab geometry; else resolve endpoints by name.
  const connections: LayoutConnection[] = [];
  for (const dn of data.nets) {
    const coord = new Map<string, [number, number]>();
    for (const s of [...dn.ports, ...dn.subnodes, ...dn.instPins]) {
      if (s.x !== null && s.y !== null) coord.set(s.name, [s.x, s.y]);
    }
    for (const r of dn.resistors) {
      if (r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null) {
        connections.push({ net: dn.name, layer: r.layer, points: [[r.x1, r.y1], [r.x2, r.y2]] });
        continue;
      }
      const a = coord.get(r.a);
      const b = coord.get(r.b);
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
    diagnostics: data.diagnostics,
  };
}
```

- [ ] **Step 4: Run the full layout suite**

Run: `npm run test:layout`
Expected: PASS — all model/units/lines/tokens/elements/parseDspf/correlate tests, plus the pre-existing transform/pick/store tests, green.

- [ ] **Step 5: Commit**

```bash
git add src/layout-viewer/correlate.ts src/layout-viewer/correlate.test.ts
git commit -m "feat(dspf): correlate consumes resistor geometry, multi-source net bboxes, layer sets"
```

---

## Task 8: Surface parse diagnostics in the inspector

**Files:**
- Modify: `src/components/layout/LayoutInspector.tsx`

**Interfaces:**
- Consumes: `model.diagnostics` (a `DspfDiagnostics`) from the store's `layoutModel`. No new exports.

- [ ] **Step 1: Replace the "nothing selected" branch with a parse report**

In `src/components/layout/LayoutInspector.tsx`, replace these two lines:
```tsx
  } else if (!selection || selection.type === 'primitive') {
    body = <div className="insp-empty"><div className="insp-empty-icon">▦</div>Select a block or net on the canvas.</div>;
```
with:
```tsx
  } else if (!selection || selection.type === 'primitive') {
    const d = model.diagnostics;
    body = (
      <div className="insp-body">
        <div className="insp-empty"><div className="insp-empty-icon">▦</div>Select a block or net on the canvas.</div>
        <div className="sub-h">Parse report</div>
        <div className="kv"><span className="k">Nets</span><span className="v">{d.nets}</span></div>
        <div className="kv"><span className="k">Devices</span><span className="v">{d.devices}</span></div>
        <div className="kv"><span className="k">Resistors</span><span className="v">{d.resistors} ({d.resistorsWithGeometry} w/ geometry)</span></div>
        <div className="kv"><span className="k">Capacitors</span><span className="v">{d.capacitors} ({d.couplingCaps} coupling)</span></div>
        <div className="kv"><span className="k">Points w/ coords</span><span className="v">{d.pointsWithCoords}</span></div>
        {d.unitScale !== 1 && <div className="kv"><span className="k">Units</span><span className="v">scaled ×{d.unitScale.toLocaleString()}</span></div>}
      </div>
    );
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -b`
Expected: PASS (no type errors anywhere).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/LayoutInspector.tsx
git commit -m "feat(layout): show DSPF parse report (coverage + units) in the inspector"
```

---

## Task 9: Full regression, build, and real-file validation

**Files:** none (verification + handoff).

- [ ] **Step 1: Layout suite green**

Run: `npm run test:layout`
Expected: PASS (all tests across model, units, lines, tokens, elements, parseDspf, correlate, transform, pick, store).

- [ ] **Step 2: CDL adapter suite still green (regression guard)**

Run: `npm test`
Expected: `ADAPTER TEST RESULTS: 65 passed, 0 failed / 65 total`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `tsc -b` clean, Vite build succeeds.

- [ ] **Step 4: Performance smoke (large synthetic file)**

Run:
```bash
node --import tsx -e "import('./src/layout-viewer/dspf/parseDspf.ts').then(({parseDspf})=>{const L=[];for(let i=0;i<200000;i++){L.push('*|NET N'+i+' 1','*|S (N'+i+':1 '+(i%1000)+' '+(i%777)+')','R'+i+' N'+i+':1 N'+i+':2 1 \$layer=m1 \$X='+(i%1000)+' \$Y=0 \$X2='+((i%1000)+1)+' \$Y2=1');}const t=Date.now();const d=parseDspf(L.join('\n'));console.log('lines',d.diagnostics.logicalLines,'nets',d.diagnostics.nets,'R w/geo',d.diagnostics.resistorsWithGeometry,'ms',Date.now()-t);});"
```
Expected: completes in a few seconds for ~800k logical lines; `resistorsWithGeometry` equals the resistor count. If it is unacceptably slow, note it for a follow-up (chunked streaming), do not block.

- [ ] **Step 5: Real-file validation (USER-DRIVEN — agent must not read the private samples)**

Hand the user this checklist to run against their real `sample_dspf/` files in the running app (`npm run dev`, Layout mode, "Add DSPF"):
1. The inspector "Parse report" shows non-zero **Devices** and **Resistors**, and **Resistors w/ geometry** is > 0 if their extractor emits `$X/$Y`.
2. Instance boxes appear at sensible positions and sizes (µm) for a known block.
3. If their DSPF has layer tags, connection traces are colored and the LayerPanel lists the expected metals; if not, traces are neutral and the inspector reports layers unavailable.
4. **Units** row appears only when their coordinates were in meters (auto-scaled ×1e6); boxes should not be off by 1e6 either way.
5. Coupling caps count looks plausible (> 0 for signal nets in a coupled extraction).

If any check fails, capture 3–5 representative lines (one `*|I`, one `*|S`, one `R`, one `C`) with structure intact (names may be anonymized) and open a follow-up to extend the synthetic fixtures + parser for that dialect quirk.

- [ ] **Step 6: Final commit (if Step 5 surfaced fixture additions)**

```bash
git add -A
git commit -m "test(dspf): add fixtures for real-sample dialect quirks"
```

---

## Self-Review

**Spec coverage:** continuation handling (Task 3), resistor/cap geometry (Tasks 5–6), coordinate robustness (Task 4), `$layer=` + `$lvl=`+map (Tasks 5–6), engineering suffixes (Task 2), units meters→µm (Task 6), header dialects + ground/design (Task 6), diagnostics + UI surfacing (Tasks 1, 6, 8), correlate consuming geometry (Task 7), regression + perf + real-file validation (Task 9). All covered.

**Type consistency:** `LayoutData`/`DspfNet`/`DspfPoint`/`DspfResistor`/`DspfCapacitor`/`DspfDevice`/`DspfDiagnostics`/`LayoutModel` are defined once in Task 1 and imported everywhere; `parseDspf(text, opts?)`, `ResolveLayer`, `parseParenPayload`/`ParenInfo`, `forEachLogicalLine`/`toLogicalLines`, `parseResistor`/`parseCapacitor`, `correlate` signatures match across tasks.

**No placeholders:** every code step contains complete code; every run step has an exact command and expected result.

**Risk notes:** (a) coordinate heuristic "trailing two numerics" can misfire if a tool puts width/length last without `$w/$l` — mitigated by `$X/$Y` override and Task 9 validation; (b) unit inference threshold (`<1e-3`) is conservative and overridable via `opts.unitScale`; (c) very large files build one `string[]` of lines — acceptable in the worker, flagged in Task 9 Step 4 for a chunked-streaming follow-up if needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-dspf-parser-rewrite.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).
2. **Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).
