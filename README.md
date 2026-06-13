# CDL Schematic Viewer

**Step 1 of the ACE workflow — interactive CDL netlist browser.**

Live demo → **[okkhalil3.github.io/cdl-netlist](https://okkhalil3.github.io/cdl-netlist)**

---

## What it does

Drag a CDL netlist file onto the window (or click **Open CDL…**) and the viewer:

- Parses the full hierarchy — subcircuits, instances, primitive devices (M/R/C), and nets
- Draws an interactive schematic canvas with ELK-computed layout
- Lets you navigate the hierarchy top-down via breadcrumb or the left tree panel
- Lets you inspect any block, wire, or device in the right panel

No server, no install, no data leaves your machine — everything runs in the browser. The parser ([`eda-netlist-parser`](https://pypi.org/project/eda-netlist-parser/)) runs in-browser via [Pyodide](https://pyodide.org) (Python compiled to WASM), in a Web Worker — the first file you load downloads the Python runtime (~10 MB, cached after that).

---

## Running locally

```bash
npm install
npm run dev        # → http://localhost:5173
```

Production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the build locally
```

---

## CDL dialect support

All four major CDL dialects are handled:

| Dialect | Notes |
|---|---|
| auCdl (slash-form) | Nets before `/`, master on `+` continuation line |
| ICnet / LVS | Lowercase keywords, `[n]` bus indices, no slash |
| Slash-form large hierarchies | `XR*` sub-circuit resistors (`rhim_m` model) |
| CRLF + native passives | Windows line endings, native `CC*` capacitors |

Parsing is `eda-netlist-parser` (open-source Python) plus a small adapter
(`src/parser/pyodide/cdl_adapter.py`) that adds CDL-specific handling on top:

- `+` continuation lines
- `*.PININFO` pin-direction comments (before or after `.SUBCKT`)
- `<n>` and `[n]` bus instance scalarisation — grouped back into a single tree row
- `X*` pseudo-devices: resistors and capacitors inferred from model name (`rhim`, `rpoly`, `mim`, `cfmom`, …); cell names containing `_mac` are **not** confused with MOSFETs
- Native `M*` / `C*` / `R*` primitive lines
- Top-cell detection: header comment `* Top Cell Name: X` → last unreferenced cell → last defined cell

---

## Interface

```
┌──────────────────────────────────────────────────────────────────┐
│  ACE  1·Schematic  ──  breadcrumb  ──  mode buttons  [Load file] │
├─────────────┬────────────────────────────────┬───────────────────┤
│  HIERARCHY  │                                │  INSPECTOR        │
│             │      Schematic canvas          │                   │
│  tree of    │      (React Flow + ELK)        │  Current          │
│  instances  │                                │  Selection / Review│
└─────────────┴────────────────────────────────┴───────────────────┘
```

**Left panel — Hierarchy browser**
- Click a row to navigate into that cell
- Bus instances (`XI1<5:0>`) are collapsed into a single row

**Center — Schematic canvas**
- Sub-circuit instances render as blocks with pin → net tables
- Primitive devices (MOSFET, resistor, capacitor) render as labelled glyphs
- Cell-boundary I/O pins render as small port nodes, so pins only connected to the cell's own ports still show a wire
- Click a block, port, or net to highlight everything electrically connected to it
- Scroll / pinch to zoom; drag to pan
- Double-click a block to descend; click breadcrumb to ascend
- Click a wire to inspect or focus that net

**Right panel — Inspector**
- Instance: master cell (clickable to descend), parent, child count, full pin → net map
- AI-generated functional description of the selected instance's master cell (e.g. "2-input NAND gate") — requires an Anthropic API key, entered once and stored only in your browser's localStorage
- Net: kind (signal / power / ground), fanout, all connected pins
- Primitive: model, terminals, parameters

**View modes**

| Mode | Shows |
|---|---|
| Instances | Blocks only — structural overview |
| Nets + Instances | Blocks + wires (default) |
| Net focus | Click a wire to highlight one net; everything else dims |

**Hide supply nets** toggle removes power/ground wires from the canvas — useful for large cells where every instance ties to VDD/VSS.

---

## Parser test results

```
npm test   →   65/65 (test-adapter.mjs)
```

Tested against: empty files, unclosed subckts, CRLF/CR line endings, `$` characters in IDs, long pcell hashes, diamond dependencies, deep chains, `.PARAM`/`.GLOBAL`/`.MODEL` directive skip, all device-classification edge cases, and bus notation (`<n>`/`[n]`) — run through the real `eda-netlist-parser` + adapter via Pyodide under Node. Also validated against the 4 real sample CDL files and live in-browser.

---

## Scope

A standalone, read-only CDL viewer. It does not edit, simulate, or reconstruct the designer's original schematic drawing.

Out of scope:
- Transistor-level beautified analog symbols
- Pixel-perfect reconstruction of the original layout
