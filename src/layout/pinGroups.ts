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

// ── BETA layout: a schematic-symbol block with pins on all four edges ────────
// The classic cell-symbol convention: INPUTS run down the LEFT edge, OUTPUTS
// down the RIGHT, SUPPLY pins sit along the TOP, GROUND pins along the BOTTOM.
// Supply/ground leave the side columns (so the in/out lists stay short) and
// spread horizontally across the top/bottom bands. Rows show the PIN NAME only
// (the net mapping lives in the Inspector).

const CHAR_W = 6.7; // ~width of one Space Mono char at the pin-row font size
const LABEL_CAP = 18; // longer pin names ellipsize rather than widen the box
const COL_PAD = 20; // handle + inner padding per column
const MID_GAP = 40; // clear gap between the two name columns (block-like center)
const H_SLOT_PAD = 14; // padding around each top/bottom (supply/ground) pin label
const BAND_H = 24; // height of the top (supply) and bottom (ground) bands
const MIN_W = 190;
const MAX_W = 440;

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface PlacedRow {
  row: PinRow;
  side: Side;
  group: PinGroup;
  /** Handle center, relative to the node's top-left corner. */
  x: number;
  y: number;
}

export interface RadialLayout {
  /** Every placed pin, all four edges — for emitting handles + repPin mapping. */
  rows: PlacedRow[];
  left: PlacedRow[];
  right: PlacedRow[];
  top: PlacedRow[];
  bottom: PlacedRow[];
  width: number;
  height: number;
  /** y where the in/out band starts, and its height — so the rendered side
      columns line up with the absolutely-placed handles. */
  midTop: number;
  midHeight: number;
  /** Heights of the supply (top) and ground (bottom) bands; 0 when empty. */
  topHeight: number;
  bottomHeight: number;
}

const colWidth = (rows: PinRow[]) =>
  rows.length === 0 ? 0 : Math.min(Math.max(...rows.map(r => r.pinLabel.length)), LABEL_CAP) * CHAR_W + COL_PAD;
const slotWidth = (row: PinRow) => Math.min(row.pinLabel.length, LABEL_CAP) * CHAR_W + H_SLOT_PAD;
const bandWidth = (rows: PinRow[]) =>
  rows.length === 0 ? 0 : rows.reduce((sum, r) => sum + slotWidth(r), 0) + COL_PAD;

export function computeRadialLayout(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): RadialLayout {
  const grouped = bucketPinRows(conn, ports, netKindOf);
  const { input: inputs, output: outputs, supply, ground } = grouped;

  const innerW = inputs.length || outputs.length
    ? colWidth(inputs) + MID_GAP + colWidth(outputs)
    : 0;
  const width = Math.min(Math.max(innerW, bandWidth(supply), bandWidth(ground), MIN_W), MAX_W);

  const topHeight = supply.length ? BAND_H : 0;
  const bottomHeight = ground.length ? BAND_H : 0;
  const midTop = HEADER_H + topHeight;
  const midHeight = Math.max(inputs.length, outputs.length) * PIN_ROW_H;
  const height = midTop + midHeight + bottomHeight + BODY_PAD;

  const rowY = (i: number) => midTop + i * PIN_ROW_H + PIN_ROW_H / 2;
  const left = inputs.map((row, i): PlacedRow => ({ row, group: 'input', side: 'left', x: 0, y: rowY(i) }));
  const right = outputs.map((row, i): PlacedRow => ({ row, group: 'output', side: 'right', x: width, y: rowY(i) }));

  // Supply/ground pins spread horizontally across their band, centered.
  const layBand = (rows: PinRow[], group: PinGroup, side: Side, y: number): PlacedRow[] => {
    const widths = rows.map(slotWidth);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = (width - total) / 2;
    return rows.map((row, i): PlacedRow => {
      const cx = x + widths[i] / 2;
      x += widths[i];
      return { row, group, side, x: cx, y };
    });
  };
  const top = layBand(supply, 'supply', 'top', HEADER_H + topHeight / 2);
  const bottom = layBand(ground, 'ground', 'bottom', height - BODY_PAD - bottomHeight / 2);

  return {
    rows: [...left, ...right, ...top, ...bottom],
    left, right, top, bottom,
    width, height, midTop, midHeight, topHeight, bottomHeight,
  };
}
