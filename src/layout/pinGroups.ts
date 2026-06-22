// Classifies an instance's pins into four groups — input, output, supply, and
// ground — and lays out the instance node body as four labeled sections. The
// geometry it returns (per-row handle `top`, total node `height`) is the single
// source of truth shared by the ELK layout (reserved node height), InstanceNode
// (handle positions + rendering), and SchematicCanvas (repPin → handle mapping),
// so the rendered DOM, the wire endpoints, and the reserved space all agree.

import { groupPinConnections, type PinRow } from './busGrouping';
import type { Port, Net } from '../parser/types';

// These MUST match the fixed heights pinned in index.css (.inst-head,
// .pin-section-head, .pin-row, .inst-body). Handles are absolutely positioned
// from them, so any drift between these and the CSS lands wires off their rows.
export const HEADER_H = 42;
export const SECTION_H = 16;
export const PIN_ROW_H = 20;
export const BODY_PAD = 10;

export type PinGroup = 'input' | 'output' | 'supply' | 'ground';

// Render order, top → bottom, with the label and CSS color shown per section.
export const GROUP_ORDER: readonly PinGroup[] = ['input', 'output', 'supply', 'ground'];
export const GROUP_META: Record<PinGroup, { label: string; color: string }> = {
  input: { label: 'IN', color: 'var(--pin-i)' },
  output: { label: 'OUT', color: 'var(--pin-o)' },
  supply: { label: 'PWR', color: 'var(--net-pwr)' },
  ground: { label: 'GND', color: 'var(--net-gnd)' },
};

type NetKind = Net['kind'];

// Pin direction: prefer the master cell's declared port direction (from
// PININFO); fall back to a name heuristic when the master is unresolved. This
// is the single source of truth for direction — InstanceNode and
// SchematicCanvas both call it.
export function pinDirection(name: string, ports: Port[]): 'I' | 'O' | 'B' {
  const p = ports.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (p?.dir) return p.dir;
  if (/^(out|y|z|q|qb?|do|dout|co|cout|s|sum|f|g)$/i.test(name)) return 'O';
  if (/(_o|_out|_y)$/i.test(name)) return 'O';
  return 'I';
}

// A pin tied to a power/ground net is a supply/ground pin regardless of its
// declared direction; otherwise it's an input or output by direction.
// Bidirectional / unknown-direction pins fall in with the inputs (left side).
export function classifyPin(pin: string, netKind: NetKind, ports: Port[]): PinGroup {
  if (netKind === 'power') return 'supply';
  if (netKind === 'ground') return 'ground';
  return pinDirection(pin, ports) === 'O' ? 'output' : 'input';
}

export interface LaidOutRow {
  row: PinRow;
  /** Handle-center y, relative to the node's top edge. */
  top: number;
}

export interface LaidOutSection {
  group: PinGroup;
  label: string;
  color: string;
  rows: LaidOutRow[];
}

export interface InstanceLayout {
  sections: LaidOutSection[];
  height: number;
}

// Classifies an instance's connections into the four groups and bus-collapses
// each group's rows. Bus collapsing runs within each group — bus bits share a
// direction and net kind, so a run always lands in one group and stays
// contiguous, collapsing exactly as before. Shared by both layouts.
export function bucketPinRows(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): Record<PinGroup, PinRow[]> {
  const buckets: Record<PinGroup, Array<[string, string]>> = { input: [], output: [], supply: [], ground: [] };
  for (const [pin, net] of Object.entries(conn)) {
    buckets[classifyPin(pin, netKindOf(net), ports)].push([pin, net]);
  }
  return {
    input: groupPinConnections(buckets.input),
    output: groupPinConnections(buckets.output),
    supply: groupPinConnections(buckets.supply),
    ground: groupPinConnections(buckets.ground),
  };
}

// CLASSIC layout: the four groups stacked as labeled IN/OUT/PWR/GND sections,
// each pin row tagged with its handle-center y.
export function computeInstanceLayout(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): InstanceLayout {
  const grouped = bucketPinRows(conn, ports, netKindOf);

  const sections: LaidOutSection[] = [];
  let y = HEADER_H;
  for (const group of GROUP_ORDER) {
    const groupRows = grouped[group];
    if (groupRows.length === 0) continue;
    y += SECTION_H; // section header
    const rows = groupRows.map(row => {
      const laid: LaidOutRow = { row, top: y + PIN_ROW_H / 2 };
      y += PIN_ROW_H;
      return laid;
    });
    const meta = GROUP_META[group];
    sections.push({ group, label: meta.label, color: meta.color, rows });
  }

  return { sections, height: y + BODY_PAD };
}

// ── BETA layout: a compact schematic-symbol block, pins on all four edges ────
// SUPPLY pins band the TOP, GROUND bands the BOTTOM. Between them the pins are
// split into an INPUT group then an OUTPUT group, stacked top → bottom. Each
// group fills BOTH columns — pin 0 sits on the left edge, pin 1 on the right,
// pin 2 left, pin 3 right, and so on down the rows. Inputs usually outnumber
// outputs heavily, so spreading each group across two columns roughly halves
// the row count and keeps the block from growing into one very tall tower —
// the layout engineers expect from a cell symbol. Rows show the PIN NAME only
// (the net mapping lives in the Inspector).

const CHAR_W = 6.7; // ~width of one Space Mono char at the pin-row font size
const LABEL_CAP = 18; // longer pin names ellipsize rather than widen the column
const COL_PAD = 20; // handle + inner padding per column
const MID_GAP = 36; // clear gap between the left and right pin columns
const H_SLOT_PAD = 14; // padding around each top/bottom (supply/ground) pin label
const BAND_H = 30; // height of the top (supply) and bottom (ground) bands (room for dot + label)
const MIN_W = 190;

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface PlacedRow {
  row: PinRow;
  side: Side;
  group: PinGroup;
  /** Handle center, relative to the node's top-left corner. */
  x: number;
  y: number;
}

// A centered IN/OUT divider label spanning the block, marking where one group's
// rows give way to the next. `y` is its center, relative to the node's top-left.
export interface RadialSection {
  group: PinGroup;
  label: string;
  color: string;
  y: number;
}

export interface RadialLayout {
  /** Every placed pin (all edges) — handles, labels, and repPin mapping. */
  rows: PlacedRow[];
  /** The INPUT/OUTPUT divider labels between the supply and ground bands. */
  sections: RadialSection[];
  width: number;
  height: number;
}

const slotWidth = (row: PinRow) => Math.min(row.pinLabel.length, LABEL_CAP) * CHAR_W + H_SLOT_PAD;
const bandWidth = (rows: PinRow[]) =>
  rows.length === 0 ? 0 : rows.reduce((sum, r) => sum + slotWidth(r), 0) + COL_PAD;
// Widest pin label among the given rows → the width to reserve for one column.
const colWidth = (rows: PinRow[]) =>
  rows.length === 0 ? 0 : Math.min(Math.max(...rows.map(r => r.pinLabel.length)), LABEL_CAP) * CHAR_W + COL_PAD;
// Each group fills both columns top → bottom, so the on-side row count (and the
// space a column must fit) is half the group, rounded up.
const colRows = (n: number) => Math.ceil(n / 2);

export function computeRadialLayout(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): RadialLayout {
  const grouped = bucketPinRows(conn, ports, netKindOf);
  const { input: inputs, output: outputs, supply, ground } = grouped;

  // Left column carries the even-indexed pins of both groups, right the odd —
  // each column must fit the widest label that lands in it.
  const evens = (rows: PinRow[]) => rows.filter((_, i) => i % 2 === 0);
  const odds = (rows: PinRow[]) => rows.filter((_, i) => i % 2 === 1);
  const leftPins = [...evens(inputs), ...evens(outputs)];
  const rightPins = [...odds(inputs), ...odds(outputs)];
  const innerW = leftPins.length || rightPins.length ? colWidth(leftPins) + MID_GAP + colWidth(rightPins) : 0;
  const width = Math.max(innerW, bandWidth(supply), bandWidth(ground), MIN_W);

  const topHeight = supply.length ? BAND_H : 0;
  const bottomHeight = ground.length ? BAND_H : 0;
  const inSecH = inputs.length ? SECTION_H : 0;
  const outSecH = outputs.length ? SECTION_H : 0;

  const inSecTop = HEADER_H + topHeight;                  // INPUT divider band
  const inTop = inSecTop + inSecH;                        // first input row
  const outSecTop = inTop + colRows(inputs.length) * PIN_ROW_H; // OUTPUT divider
  const outTop = outSecTop + outSecH;                     // first output row
  const height = outTop + colRows(outputs.length) * PIN_ROW_H + bottomHeight + BODY_PAD;

  const placed: PlacedRow[] = [];
  // Fill a group down BOTH columns: even index → left edge, odd → right edge,
  // advancing one row every two pins.
  const layGroup = (rows: PinRow[], group: PinGroup, top: number) => {
    rows.forEach((row, i) => {
      const side: Side = i % 2 === 0 ? 'left' : 'right';
      const y = top + Math.floor(i / 2) * PIN_ROW_H + PIN_ROW_H / 2;
      placed.push({ row, group, side, x: side === 'left' ? 0 : width, y });
    });
  };
  layGroup(inputs, 'input', inTop);
  layGroup(outputs, 'output', outTop);

  // Supply/ground pins spread horizontally across the top/bottom bands, centered.
  const layBand = (rows: PinRow[], group: PinGroup, side: Side, y: number) => {
    const widths = rows.map(slotWidth);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = (width - total) / 2;
    for (let i = 0; i < rows.length; i++) {
      placed.push({ row: rows[i], group, side, x: x + widths[i] / 2, y });
      x += widths[i];
    }
  };
  // Supply rides the very top edge of the symbol body, ground the very bottom
  // edge of the box — each rail leaves the side that matches its type (VDD up,
  // VSS down), the way a schematic symbol reads. BetaPinLabel offsets the label
  // inward (below the top dot, above the bottom dot) so it never lands on the dot.
  layBand(supply, 'supply', 'top', HEADER_H);
  layBand(ground, 'ground', 'bottom', height - 4);

  const sections: RadialSection[] = [];
  if (inputs.length) sections.push({ group: 'input', label: 'INPUTS', color: GROUP_META.input.color, y: inSecTop + SECTION_H / 2 });
  if (outputs.length) sections.push({ group: 'output', label: 'OUTPUTS', color: GROUP_META.output.color, y: outSecTop + SECTION_H / 2 });

  return { rows: placed, sections, width, height };
}
