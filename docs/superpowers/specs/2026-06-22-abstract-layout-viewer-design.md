# Abstract Layout Viewer — v1 Design Spec

- **Date:** 2026-06-22
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Branch:** `worktree-abstract-layout-viewer`
- **Source brief:** `~/Downloads/Abstract_Layout_Viewer_Handoff/` (README + `brief/Abstract_Layout_Viewer_Brief.pdf`)

## 1. Summary

Add an **Abstract Layout Viewer** as a second mode inside the existing CDL Schematic
Viewer. It correlates a **CDL netlist** (logical hierarchy/instances/nets) with a
**DSPF parasitic file** (device X,Y coordinates, PEX nets, R/C, optional metal-layer
tags) and draws an abstract *physical* map: a bright **instance bounding box** per
block, a translucent dashed **net bounding box** per net, and **RC-skeleton
connection traces** colored by metal layer when the DSPF carries layer tags. It is an
abstraction, not a layout — boxes and polylines, never polygons. Read-only.

The core insight the tool surfaces: a tight instance box sitting inside a much wider
net box (a net reaching far beyond the block it belongs to).

## 2. Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Where it lives | **Second mode in the current app** | Reuse the CDL parser, hierarchy tree, inspector frame, selection model, theme; enables cross-mode selection later. |
| v1 scope | **Core + connections + layers** (no zone dropdown) | The full "layer story" (graceful degradation) is the crux feature; zone dropdown is deferred. |
| Test data | **Synthetic fixtures; user validates** | The real `sample_cdl/` and `sample_dspf/` files stay private and are NOT read by the agent. Hand-authored fixtures drive TDD; the user validates real samples. |
| DSPF parser | **Focused custom TypeScript reader in a web worker** | DSPF is line-oriented (`*|S/*|I/*|P/R/C`); `eda-netlist-parser`'s DSPF support is unverified; a custom reader gives full control over header divider/delimiter and streams the ~22 MB file. |
| CDL parser | **Reuse existing Pyodide `eda-netlist-parser`** | Already works; 65 tests pass; unchanged. |
| Render surface | **Canvas2D** | At the abstraction level we draw boxes + a bounded set of polylines (not 117k raw parasitics), so the object count is modest. Zero new deps; deck.gl is the documented upgrade path. |

## 3. Architecture & integration

Add a top-level mode to `viewerStore`:

```ts
appMode: 'schematic' | 'layout'   // distinct from existing `mode: inst | both | net`
```

A toggle in `TopBar` switches modes. **Schematic mode is untouched.** Layout mode
reuses the shell — `TopBar`, `HierarchyPanel`, the `InspectorPanel` frame — and swaps
the center canvas for a new `LayoutCanvas`, plus a `DepthSelector` and `LayerPanel`.

Layout mode requires a DSPF. If none is loaded (or correlation hasn't run), the Layout
toggle is **disabled** with a "load a DSPF" hint.

**Navigation model (important difference):** Layout mode is a **single flat physical
canvas of the whole design** with a depth selector (`0 / 1 / 2 / All`) controlling how
deep instance boxes are drawn. It does NOT use the schematic's "descend into a cell"
breadcrumb navigation. The hierarchy tree still renders; in layout mode a click on a
tree node **highlights/selects** that block (and pans/zooms to it) rather than
descending.

**What "depth" means:** an `instance` in the model is a CDL **hierarchy node** at a
given level below the top cell (depth 0 = the top cell / whole-design box, depth 1 =
its direct child instances, depth 2 = grandchildren, `All` = leaf instances). A node's
bbox is the union of all DSPF devices whose normalized path falls under that node's
path prefix. The `DepthSelector` hides nodes whose `depth` exceeds the selected level
(matching the mockup's `inst.depth > depth` filter).

## 4. Data flow

```
CDL  → existing Pyodide parser  → Design   (cells/instances/nets)          [unchanged]
DSPF → new custom TS parser (worker) → LayoutData (coords, PEX nets, R/C, layers?)
                              │
                              ▼
        correlate(Design, LayoutData) → LayoutModel   (the brief's §7 JSON)
                              │
                              ▼
                       LayoutCanvas (Canvas2D)
```

## 5. Data model

`LayoutData` — the raw, design-agnostic parse of one DSPF:

```ts
interface DspfDevice {   // from *|I lines (instance pins) grouped per device, or *|S fallback
  path: string;          // raw fully-qualified name, e.g. "X100|X55|X1|noxref_10:3"
  x: number; y: number;  // µm
}
interface DspfNet {
  name: string;          // raw PEX net name
  subnodes: Array<{ name: string; x: number; y: number }>;  // *|S (and *|P/*|I coords)
  parasitics: number;    // count of R + C elements on this net
  resistors: Array<{ a: string; b: string; layer?: string }>; // for the RC skeleton
}
interface LayoutData {
  divider: string;       // from *|DIVIDER header (e.g. "/")
  delimiter: string;     // from *|DELIMITER header (e.g. ":")
  nets: DspfNet[];
  devices: DspfDevice[];
  layersPresent: boolean;// any $layer= seen?
  layers: string[];      // distinct layer names, [] when none
}
```

`LayoutModel` — the compact, viewer-ready model (mirrors brief §7):

```ts
interface LayoutModel {
  design: string;
  extent: [number, number, number, number];      // [minx, miny, maxx, maxy] µm
  layers: string[];                               // [] ⇒ no-layer mode
  instances: Array<{
    id: string; depth: number; deviceCount: number;
    bbox: [number, number, number, number];       // [minx, miny, maxx, maxy]
  }>;
  nets: Array<{
    name: string; bbox: [number, number, number, number];
    subnodes: number; parasitics: number;
    layers: string[]; instances: string[];         // instances the net touches
  }>;
  connections: Array<{ net: string; layer: string | null; points: Array<[number, number]> }>;
  stats: { instancesMatched: number; instancesTotal: number; devicesMatched: number };
}
```

## 6. Modules (each isolated + unit-testable)

| Module | Responsibility | Signature |
|---|---|---|
| `src/layout-viewer/dspf/parseDspf.ts` | Line-oriented DSPF reader: header divider/delimiter, `*|S/*|I/*|P` coords, `R/C` with optional `$layer=`. | `(text: string) => LayoutData` (pure) |
| `src/layout-viewer/dspf/dspf.worker.ts` | Run `parseDspf` off the main thread for the ~22 MB file; post progress. | message worker |
| `src/layout-viewer/correlate.ts` | **The crux.** Match CDL instance paths ↔ DSPF node names; group devices → instance bboxes; net bboxes; RC-skeleton connections. | `(design: Design, data: LayoutData) => LayoutModel` (pure) |
| `src/layout-viewer/model.ts` | `LayoutData` / `LayoutModel` types + small helpers (bbox union, extent). | types |
| `src/components/layout/LayoutCanvas.tsx` | Canvas2D world→screen transform, pan/zoom, draw, hit-test → select. | React component |
| `src/components/layout/LayerPanel.tsx` | Layer toggle chips; hidden when `layers: []`. | React component |
| `src/components/layout/DepthSelector.tsx` | `0 / 1 / 2 / All` depth control. | React component |
| `src/components/layout/LayoutInspector.tsx` | Block/net details inside the existing `InspectorPanel` frame. | React component |

**Store additions:** `appMode`, `layoutData`, `layoutModel`, `layoutDepth`,
`layerVisibility: Record<string, boolean>`. Selection reuses the existing `selection`
union (`instance` / `net`).

## 7. DSPF parser spec

`parseDspf(text) → LayoutData`:

1. **Header.** Read `*|DIVIDER <c>` and `*|DELIMITER <c>`; default to `/` and `:` if
   absent. Never hard-code — the three sample vendors use `/ :`, `| :`, and `/ #`.
2. **Nets.** `*|NET <name> <totalCap>` opens a net context.
3. **Coordinates.** `*|S (<sub> X Y)` → subnode; `*|P (<pin> ... X Y)` → port;
   `*|I (<instPin> ... X Y)` → instance pin. Some files (CLKGEN) emit `*|I` with **no**
   coordinates — when `*|I` lacks X,Y, take device positions from `*|S` only.
4. **Devices.** Derive a device path from instance-pin / subnode names (strip the pin
   suffix after the delimiter). Used for correlation and instance bboxes.
5. **Parasitics.** `R <a> <b> <val> [$layer=<m>]` and `C <a> <b> <val>`; count per net;
   keep resistor endpoints + layer for the RC skeleton. `$layer=` is OPTIONAL.
6. **Layers.** `layersPresent = true` and collect distinct names only if `$layer=` tags
   are seen; otherwise `layers: []`.

## 8. Correlation spec (the hard part)

`correlate(design, data) → LayoutModel`:

1. **Normalize** both name spaces to a canonical lowercase, divider-agnostic path:
   split CDL paths on the CDL separator and DSPF names on the header divider/delimiter;
   strip finger suffixes (`<@finger>`, trailing `:N`), and case-fold.
2. **Index** DSPF device coordinates by normalized path prefix.
3. **Instance bbox.** Enumerate CDL hierarchy nodes at every depth (§3). For each node,
   gather DSPF devices whose normalized path is under that node's prefix → min/max XY.
   Regroup fingered devices into the single block.
4. **Net bbox.** For each PEX net, min/max XY over its subnode coordinates. Map a CDL
   net to its DSPF PEX net by normalized name.
5. **Connections.** RC skeleton per net: each resistor's two endpoints are node names;
   resolve their coordinates from the net's subnode/pin coordinate table (by name) and
   join them into polylines; tag each segment with its `$layer=` when present (else
   `layer: null`). Honestly labeled an RC abstraction, not routing.
6. **Stats.** Record `instancesMatched / instancesTotal / devicesMatched`. Partial
   correlation is acceptable and surfaced in the inspector — never silently hidden. An
   instance with zero matched devices has no bbox and is not drawn (noted in inspector).

## 9. Rendering spec (Canvas2D)

- **Transform.** World µm → screen with a fit transform and **Y-flip** (µm up). Pan =
  drag; zoom = wheel around the cursor. A "Fit" control resets.
- **Draw order.** connections (under) → net bboxes (dashed translucent green) →
  instance bboxes (solid blue) → selection glow (yellow) + labels.
- **Palette.** Reuse the schematic tokens (`--inst #4f9dff`, `--net #5fd0a0`,
  `--sel #ffd23f`) and the mockup's layer palette (poly/od/metal1–5).
- **Depth.** `DepthSelector` filters instance boxes by `depth`.
- **Layers.** `LayerPanel` toggles filter connections by layer.
- **Selection.** Click hit-tests the topmost instance box (or a net box) → select →
  inspector + highlight + show that block's touching net boxes (the mockup behavior).
  Hierarchy-tree click selects the same way and recenters.

## 10. File loading & graceful degradation

- `DropZone` / `TopBar` accept a CDL and optionally a DSPF: load the CDL (schematic
  works immediately), then "Add DSPF" to enable Layout mode.
- **No-layer DSPF** (`layers: []`): hide `LayerPanel`, draw all connections neutral
  gray, inspector shows "Metal layers — Not available (DSPF extracted without layer
  tags)". This is the second mockup's behavior and a v1 acceptance criterion.
- DSPF parse/correlation errors surface as a banner and **never break schematic mode**.

## 11. Testing strategy (TDD, synthetic fixtures)

- `parseDspf` unit tests: the three header forms (`/ :`, `| :`, `/ #`); `*|S/*|I/*|P`
  coordinate extraction; `R` with and without `$layer=`; the CLKGEN case (`*|I` lacks
  coords → fall back to `*|S`); `layersPresent` true/false.
- `correlate` unit tests: separator normalization, finger regrouping, prefix matching,
  instance-bbox and net-bbox math, the `stats` counts, and the no-layer path
  (`connections[].layer === null`, `layers: []`).
- Fixtures are tiny hand-authored CDL + DSPF strings checked into the test tree
  (`src/layout-viewer/__fixtures__/`). No real sample files are read.
- The existing 65 CDL adapter tests stay green (regression guard).
- Rendering and real-sample accuracy are validated manually by the user against the
  three real samples (full layers / partial / none).

## 12. Acceptance criteria (v1 "done")

1. Load CDL + a layer-tagged DSPF → Layout mode shows instance boxes at a selectable
   depth, net boxes for the selected block, and layer-colored connection traces with a
   working layer-toggle panel.
2. Load a no-layer DSPF → boxes + neutral connections, layer panel hidden, inspector
   reports layers unavailable.
3. Selecting a block (canvas or tree) shows its instance bbox + touching net bboxes and
   populates the inspector with coords, size, device/subnode/parasitic counts.
4. Schematic mode and the 65 CDL tests are unaffected.

## 13. Out of scope (v1)

Zone dropdown; GDS / layout-database ingestion; true routing polygons; editing /
simulation / DRC-LVS; coupling-capacitor visualization; deck.gl (upgrade path only).

## 14. Risks

- **Correlation** is the dominant risk (different delimiters, fingering, name mangling).
  Mitigated by isolating it as a pure function with rich fixtures and surfaced match
  stats; the user validates real-sample matching early.
- **Large-file handling** (~22 MB DSPF): mitigated by worker-based streaming parse and
  rendering an abstraction (boxes/polylines), not raw parasitics.
- **Synthetic-fixture gap**: fixtures may not capture every real-format quirk; the
  user's validation pass on the three samples is the safety net.
