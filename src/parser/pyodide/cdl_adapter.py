"""Adapter: netlist_parser.Netlist -> the app's Design JSON shape.

Runs inside Pyodide. `netlist_parser` (PyPI: eda-netlist-parser) does the
heavy lifting of tokenizing CDL/SPICE-family lines; this module fixes up
two systematic issues in its CDL output and re-adds the CDL-specific
business logic (device classification, net classification, bus grouping,
top-cell detection, PININFO directions) that the generic parser doesn't
know about. See ARCHITECTURE.md section 5 for context.
"""

import json
import re

from netlist_parser import NetlistParser

# ── Model-name heuristics (ported from src/parser/cdl.ts) ──────────────────
#
# For X* instances, only classify as pseudo-device for R or C.
# Transistors always appear as native M* lines in CDL; X* instances whose
# cell name happens to contain "_mac" (e.g. trans_18_mac_pcell_...) must NOT
# be treated as primitives -- they are real sub-circuit instances.

R_MODEL_X = re.compile(r"^(rhim|rpoly|rp_|rn_|rpo|rnw|poly_r|res_)", re.I)
C_MODEL_X = re.compile(r"^(mim|mom|cfmom|crtmom|cpo_)", re.I)


def infer_x_kind(master: str):
    if R_MODEL_X.match(master):
        return "R"
    if C_MODEL_X.match(master):
        return "C"
    return None


# ── Net classification ──────────────────────────────────────────────────────

# Supply/ground name heuristics. Cover the VDD/VCC and VSS/GND families with an
# optional domain prefix (a=analog, d=digital, p=periphery, io) AND the
# voltage-suffixed analog rails this PDK uses (AVD_0V8, AVS_1V2, ...). The
# single-letter forms (V[DC]/VS) only count when followed by a digit, underscore
# or end-of-string, so plain signals like "vdata"/"vsig" are not misread as
# supplies. Keep in sync with PWR_NAME/GND_NAME in src/layout/pinGroups.ts.
PWR_RE = re.compile(r"^(?:a|d|p|io|dig)?v(?:dd|cc)|^(?:a|d|p|io|dig)?v[dc](?:[0-9_]|$)", re.I)
GND_RE = re.compile(r"^(?:a|d|p|io|dig)?(?:gnd|vss)|^(?:a|d|p|io|dig)?vs(?:[0-9_]|$)", re.I)


def net_kind(name: str) -> str:
    if PWR_RE.match(name):
        return "power"
    if GND_RE.match(name):
        return "ground"
    return "signal"


# ── Bus detection ────────────────────────────────────────────────────────────

BUS_RE = re.compile(r"^(.*?)(?:<(\d+)>|\[(\d+)\])$")


def parse_bus_id(id_: str):
    m = BUS_RE.match(id_)
    if not m:
        return None
    idx = m.group(2) or m.group(3)
    return {"base": m.group(1), "index": int(idx)}


# ── PININFO / top-cell pre-pass over raw text ───────────────────────────────
#
# netlist_parser silently drops "*.PININFO ..." comments and has no concept
# of a "top cell" header comment. Both are presentation/structure metadata
# layered on top of the CDL grammar, so we recover them with a small
# line-joining pass over the raw text -- the same logical-line join the old
# TS parser did.

def _logical_lines(text: str):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    logical = []
    for raw in lines:
        t = raw.strip()
        if t.startswith("+") and logical:
            logical[-1] += " " + t[1:].strip()
        else:
            logical.append(t)
    return logical


def _raw_x_master(tokens: list[str]) -> str | None:
    """Extract an X* instance's master name straight from its tokens, preserving
    case. netlist_parser lowercases `device_name`, which breaks resolution of
    masters defined elsewhere with mixed-case names (e.g. standard cells).
    Mirrors src/parser/cdl.ts's parseXLine.
    """
    rest = tokens[1:]
    if "/" in rest:
        after = rest[rest.index("/") + 1:]
        return after[0] if after else None
    # No-slash: scan from the end past param tokens (those contain '=')
    i = len(rest) - 1
    while i >= 0 and "=" in rest[i]:
        i -= 1
    return rest[i] if i >= 0 else None


def extract_pininfo_and_topcell(text: str):
    pininfo_by_cell: dict[str, dict[str, str | None]] = {}
    raw_masters: dict[str, dict[str, str]] = {}
    header_top_cell = None
    current_cell = None
    pending_pininfo = None

    for line in _logical_lines(text):
        if not line:
            continue

        if current_cell is None and line.startswith("*"):
            m = re.search(r"Top Cell Name:\s*(\S+)", line, re.I)
            if m:
                header_top_cell = m.group(1)

        if line.upper().startswith("*.PININFO"):
            parts = re.sub(r"^\*\.PININFO\s+", "", line, flags=re.I).strip().split()
            dirs: dict[str, str | None] = {}
            for p in parts:
                if ":" in p:
                    name, d = p.split(":", 1)
                    dirs[name] = d
                else:
                    dirs[p] = None
            # A cell's PININFO is usually split across MANY "*.PININFO" lines
            # (one per ~3 pins). Merge them — assigning (=) kept only the last
            # line, so a 100-pin cell ended up with directions for ~5 pins and
            # everything else fell back to the input/name heuristic.
            if current_cell:
                pininfo_by_cell.setdefault(current_cell, {}).update(dirs)
            else:
                pending_pininfo = {**(pending_pininfo or {}), **dirs}
            continue

        if line.startswith("*") or line.startswith("$"):
            continue

        tokens = line.split()
        if not tokens:
            continue
        kw = tokens[0].upper()

        if kw == ".SUBCKT":
            current_cell = tokens[1]
            if pending_pininfo is not None:
                pininfo_by_cell.setdefault(current_cell, {}).update(pending_pininfo)
                pending_pininfo = None
        elif kw == ".ENDS":
            current_cell = None
        elif current_cell and tokens[0][0] in ("x", "X"):
            master = _raw_x_master(tokens)
            if master:
                raw_masters.setdefault(current_cell, {})[tokens[0]] = master

    return pininfo_by_cell, header_top_cell, raw_masters


# ── Main adapter ──────────────────────────────────────────────────────────

def parse_cdl(text: str) -> str:
    pininfo_by_cell, header_top_cell, raw_masters = extract_pininfo_and_topcell(text)

    with open("/tmp/_input.cdl", "w") as f:
        f.write(text)
    netlist = NetlistParser().parse("/tmp/_input.cdl")

    cell_lower_to_name = {c.name.lower(): c.name for c in netlist.cells}
    order = [c.name for c in netlist.cells]
    warnings: list[str] = []

    design_cells: dict[str, dict] = {}

    for cell in netlist.cells:
        dirs = pininfo_by_cell.get(cell.name, {})
        ports = [{"name": p, "dir": dirs.get(p)} for p in cell.ports]

        instances = []
        primitives = []

        for inst in cell.instances:
            # Strip the trailing "/" token netlist_parser leaves behind when
            # an X* instance uses auCdl's slash-form (nets... / MASTER).
            nodes = [n for n in inst.nodes if n != "/"]

            if inst.code == "m":
                if len(nodes) < 4:
                    warnings.append(f"{cell.name}: short M line for {inst.name}")
                    continue
                terms = list(zip(["d", "g", "s", "b"], nodes[:4]))
                primitives.append({
                    "id": inst.name,
                    "kind": "M",
                    "model": inst.device_name or "",
                    "terms": terms,
                    "params": inst.parameters,
                })

            elif inst.code in ("c", "r"):
                terms = list(zip(["p", "n"], nodes[:2]))
                default_model = "cap" if inst.code == "c" else "res"
                model = inst.device_name or inst.number or default_model
                primitives.append({
                    "id": inst.name,
                    "kind": inst.code.upper(),
                    "model": model,
                    "terms": terms,
                    "params": inst.parameters,
                })

            elif inst.code == "x":
                # Prefer the master name extracted directly from the source
                # text (preserves case); netlist_parser's device_name is
                # always lowercased.
                master_raw = raw_masters.get(cell.name, {}).get(inst.name) or inst.device_name or ""
                if not master_raw:
                    warnings.append(f"{cell.name}: no master for {inst.name}")
                    continue

                x_kind = infer_x_kind(master_raw)
                if x_kind in ("R", "C"):
                    term_names = ["a", "b", "c"]
                    terms = [
                        [term_names[i] if i < 3 else "x", n]
                        for i, n in enumerate(nodes[:3])
                    ]
                    primitives.append({
                        "id": inst.name,
                        "kind": x_kind,
                        "model": master_raw,
                        "terms": terms,
                        "params": inst.parameters,
                    })
                    continue

                # Normalize against a defined cell's exact-case name when one
                # exists (handles stray case differences between the
                # reference and the .SUBCKT line itself).
                master = cell_lower_to_name.get(master_raw.lower(), master_raw)
                bus = parse_bus_id(inst.name)
                instances.append({
                    "id": inst.name,
                    "master": master,
                    "conn": {},
                    "portMap": nodes,
                    "busBase": bus["base"] if bus else None,
                    "busIndex": bus["index"] if bus else None,
                })

            # 'd' (diodes) and anything else: no Primitive/Instance shape in
            # the app's data model yet -- skip, same as the old TS parser.

        design_cells[cell.name] = {
            "name": cell.name,
            "ports": ports,
            "instances": instances,
            "primitives": primitives,
            "nets": [],
        }

    # ── second pass: resolve instance pin -> net maps ───────────────────────

    for cell in design_cells.values():
        for inst in cell["instances"]:
            master_cell = design_cells.get(inst["master"])
            if master_cell:
                for i, port in enumerate(master_cell["ports"]):
                    inst["conn"][port["name"]] = inst["portMap"][i] if i < len(inst["portMap"]) else ""
            else:
                for i, net in enumerate(inst["portMap"]):
                    inst["conn"][f"p{i}"] = net

    # ── build net lists per cell ─────────────────────────────────────────────

    for cell in design_cells.values():
        net_map: dict[str, dict] = {}

        def add_endpoint(net_name: str, node_id: str, pin: str):
            if not net_name:
                return
            net = net_map.get(net_name)
            if net is None:
                net = {"name": net_name, "kind": net_kind(net_name), "endpoints": []}
                net_map[net_name] = net
            net["endpoints"].append([node_id, pin])

        for p in cell["ports"]:
            add_endpoint(p["name"], "__port__", p["name"])

        for inst in cell["instances"]:
            for pin, net in inst["conn"].items():
                add_endpoint(net, inst["id"], pin)

        for prim in cell["primitives"]:
            for pin, net in prim["terms"]:
                add_endpoint(net, prim["id"], pin)

        cell["nets"] = [n for n in net_map.values() if len(n["endpoints"]) >= 1]

    # ── find top cell ─────────────────────────────────────────────────────────
    # Priority: 1) CDL header "Top Cell Name:" comment
    #           2) Last cell defined with no instances referencing it
    #           3) Last cell defined

    top_cell = header_top_cell if header_top_cell in design_cells else None

    if not top_cell:
        referenced = set()
        for cell in design_cells.values():
            for inst in cell["instances"]:
                referenced.add(inst["master"])
        for name in reversed(order):
            if name not in referenced:
                top_cell = name
                break

    if not top_cell and order:
        top_cell = order[-1]

    return json.dumps({
        "cells": design_cells,
        "topCell": top_cell or "",
        "warnings": warnings,
    })
