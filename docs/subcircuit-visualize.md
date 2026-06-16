# `subcircuit_visualize` — JSON in, schematic scene out

This document describes the data contract for feeding subcircuits into the
viewer programmatically, so the tool can be integrated with another product.

There are **two JSON schemas** involved:

1. **Design JSON** — the input. This is exactly what the CDL parser produces
   (everything we extract from a `.cdl`), and what the route accepts. A
   subcircuit of *any depth* is expressed naturally: every cell references its
   children by name, and the `cells` map holds the whole hierarchy.
2. **Scene JSON** — the output. The laid-out nodes + wires the viewer draws,
   with positions already computed. A consumer can render it with
   [React Flow](https://reactflow.dev) (even our exact node components) or any
   renderer.

The route is a thin wrapper around `visualizeSubcircuit()` in
[`src/viz/buildScene.ts`](../src/viz/buildScene.ts) — the *same* code path the
in-app canvas uses, so the API and the UI never drift.

---

## 1. The route

```
POST /subcircuit_visualize
Content-Type: application/json
```

**Request body** — either the Design JSON directly, or an envelope that adds
render options:

```jsonc
{
  "design": { /* Design JSON, see §2 */ },
  "cell":   "buffer_stage",   // which cell to render; default = design.topCell
  "mode":   "both",            // "inst" | "both" (default) | "net"
  "hideSupply": true,          // hide power/ground WIRES (pins stay); default true
  "nodeLayout": "classic",     // "classic" (default) | "beta"
  "focusNet": null,            // optional net name to pre-highlight
  "selection": null            // optional pre-selection (see §4)
}
```

If the body has no `design` key, the whole body is treated as the Design JSON
and all options take their defaults.

**Response** `200` — the Scene JSON (see §3):

```jsonc
{ "cell": "...", "topCell": "...", "nodes": [...], "edges": [...],
  "positions": { "<id>": { "x", "y", "width", "height" } }, "warnings": [...] }
```

**Errors**

| Status | When |
| ------ | ---- |
| `400`  | Body is not valid JSON |
| `413`  | Body exceeds 64 MB |
| `422`  | Schema invalid, or the requested `cell` doesn't exist. `error` names the exact path, e.g. `cells.TOP.instances[2].master: expected string, got number` |

### Running it

```bash
npm run serve:viz          # starts on http://localhost:8787 (override with PORT)
curl -X POST localhost:8787/subcircuit_visualize \
     -H 'Content-Type: application/json' \
     --data @design.json
```

The server ([`server/subcircuit_visualize.ts`](../server/subcircuit_visualize.ts))
uses only Node's built-in `http` — no framework. CORS is open (`*`) so a browser
product can call it directly.

> **Embedding instead of HTTP?** `visualizeSubcircuit(design, options)` is a
> plain async function with no browser or server dependencies — import it
> directly in Node, a worker, or another bundle if you'd rather not run a server.

---

## 2. Input: the Design JSON (everything extracted from a CDL)

```jsonc
{
  "topCell": "demo_logic_top",   // entry cell the viewer opens on
  "warnings": ["..."],                  // non-fatal parse notes (optional)
  "cells": {
    "<cellName>": {
      "name": "<cellName>",
      "ports":      [ /* Port */ ],
      "instances":  [ /* Instance — child subcircuits */ ],
      "primitives": [ /* Primitive — leaf devices */ ],
      "nets":       [ /* Net — connectivity */ ]
    }
    // ...one entry per .SUBCKT in the netlist; depth is unbounded
  }
}
```

### Port — a cell boundary pin

```jsonc
{ "name": "CLK", "dir": "I" }   // dir: "I" input | "O" output | "B" bidir | null unknown
```
`dir` comes from the CDL `*.PININFO` directive when present, else `null`.

### Instance — a child subcircuit (`X…` in CDL)

```jsonc
{
  "id": "X26",                 // instance name, unique within the cell
  "master": "buffer_stage",   // the cell it instantiates → recurse via cells[master]
  "conn": { "A": "net12", "Y": "out" },   // pin → net (resolved from master ports)
  "portMap": ["net12", "out", "vdd", "vss"], // raw ordered nets from the X line
  "busBase": "X",              // present if the id is a bus bit, e.g. "X<3>"
  "busIndex": 3                // the bit index, e.g. 3
}
```

- `conn` is the authoritative pin→net map. **It may be omitted** in input — the
  route derives it from `portMap` using the master cell's port order (or
  positional `p0,p1,…` if the master isn't in the design).
- `busBase`/`busIndex` let the hierarchy tree collapse `X<0>…X<7>` into one row.

### Primitive — a leaf device (`M…`, `R…`, `C…`, or pseudo-device `X…`)

```jsonc
{
  "id": "M1",
  "kind": "M",                 // "M" MOSFET | "R" resistor | "C" capacitor
  "model": "nmos_generic",          // device/model name
  "terms": [["d","out"], ["g","in"], ["s","vss"], ["b","vss"]], // [terminal, net]
  "params": { "w": "1u", "l": "18n" }   // device parameters
}
```
MOSFET terminals are `d,g,s,b`; R/C are `p,n`. Resistor/capacitor *subcircuit*
instances whose model matches a known R/C cell name (e.g. `rhi…`, `mim…`) are
classified here as primitives rather than instances.

### Net — connectivity within the cell

```jsonc
{
  "name": "out",
  "kind": "signal",            // "signal" | "power" | "ground" (by name heuristic)
  "endpoints": [               // every pin on this net, as [nodeId, pin]
    ["M1", "d"],               //   a primitive terminal
    ["X26", "Y"],              //   an instance pin
    ["__port__", "out"]        //   the cell boundary (a Port)
  ]
}
```
`kind` is inferred from the net name (`vdd*/vcc*…` → power, `vss*/gnd*…` →
ground, else signal). `nets` **may be omitted** in input — the route rebuilds it
from ports + instance `conn` + primitive `terms`.

> **Minimum viable input.** Only the structure is required:
> `{ topCell, cells: { <name>: { ports, instances, primitives } } }`.
> `conn` and `nets` are derived when absent — so a product can emit a lean
> design and let the route fill in connectivity.

---

## 3. Output: the Scene JSON

```jsonc
{
  "cell": "demo_logic_top",   // the cell that was laid out
  "topCell": "demo_logic_top",
  "nodes": [ /* React Flow Node */ ],
  "edges": [ /* React Flow Edge */ ],
  "positions": { "X26": { "x": 162, "y": 35, "width": 180, "height": 120 } },
  "warnings": []
}
```

### Node

```jsonc
{
  "id": "X26",
  "type": "instanceNode",       // "instanceNode" | "primitiveNode" | "portNode"
  "position": { "x": 162, "y": 35 },   // top-left, from the ELK layout engine
  "data": { /* shape depends on type — instance/primitive/port + highlight flags */ },
  "style": { "width": 180 }     // instance blocks carry their measured width
}
```
Boundary ports become nodes with id `__port__:<portName>`.

### Edge

```jsonc
{
  "id": "e_out_1",
  "source": "__port__:A", "sourceHandle": "port-src",
  "target": "X26",        "targetHandle": "A-tgt",
  "type": "smoothstep",
  "label": "out",               // a single net, or a bus range like "D<7:0>"
  "style": { "stroke": "var(--net-sig)", "strokeWidth": 1.6, "opacity": 0.65 },
  "className": "bus-edge",       // present only on merged bus ribbons
  "data": { "netName": "out" }
}
```

### Colors

Styles reference CSS custom properties so they match the app theme. A non-browser
consumer should resolve these (values from [`src/index.css`](../src/index.css)):

| Variable | Meaning | Value |
| -------- | ------- | ----- |
| `--net-sig` / `--net-sig-hi` | signal wire / highlighted | `#4f9dff` / `#7ec5ff` |
| `--net-pwr` / `--net-pwr-hi` | power wire / highlighted | `#ff5c7a` / `#ff89a3` |
| `--net-gnd` / `--net-gnd-hi` | ground wire / highlighted | `#8b95a7` / `#cfd8e8` |
| `--txt-faint` | edge labels | `#566073` |

---

## 4. Render options reference

| Option | Values | Effect |
| ------ | ------ | ------ |
| `cell` | any cell name | Which cell of the design to lay out. Default `topCell`. |
| `mode` | `inst` / `both` / `net` | `inst` draws blocks only; `both` (default) adds wires; `net` keeps supply wires visible for net tracing. |
| `hideSupply` | `true` / `false` | Hide power/ground **wires** (pins stay). Default `true`. |
| `nodeLayout` | `classic` / `beta` | `classic` stacks pins in IN/OUT/PWR/GND sections; `beta` spreads them on two side columns. |
| `focusNet` | net name | Pre-highlights that net's wires and pins. |
| `selection` | see below | Pre-selects an element and highlights its connections. |

`selection` is one of:

```jsonc
{ "type": "instance",  "id": "X26" }
{ "type": "primitive", "id": "M1" }
{ "type": "net",       "name": "clk" }
```

---

## 5. End-to-end example

```bash
curl -s -X POST localhost:8787/subcircuit_visualize \
  -H 'Content-Type: application/json' \
  -d '{
        "design": {
          "topCell": "INV",
          "cells": {
            "INV": {
              "name": "INV",
              "ports": [{"name":"A","dir":"I"},{"name":"Y","dir":"O"},
                        {"name":"VDD","dir":null},{"name":"VSS","dir":null}],
              "instances": [],
              "primitives": [
                {"id":"M1","kind":"M","model":"pch","terms":[["d","Y"],["g","A"],["s","VDD"],["b","VDD"]]},
                {"id":"M2","kind":"M","model":"nch","terms":[["d","Y"],["g","A"],["s","VSS"],["b","VSS"]]}
              ]
            }
          }
        },
        "hideSupply": false
      }'
```

Returns the laid-out inverter: two `primitiveNode`s, four boundary `portNode`s,
and the wires between them — `conn` and `nets` derived automatically.
