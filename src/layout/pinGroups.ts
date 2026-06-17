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
// SUPPLY pins along the TOP, GROUND along the BOTTOM, INPUTS (and bidirectional
// pins) down the LEFT, OUTPUTS down the RIGHT — the textbook cell symbol, now
// that PININFO directions parse in full (see cdl_adapter.py). A side with many
// pins WRAPS into several sub-columns rather than growing into one tall tower,
// so an input-heavy IO cell stays roughly square. Rows show the PIN NAME only
// (the net mapping lives in the Inspector).

const CHAR_W = 6.7; // ~width of one Space Mono char at the pin-row font size
const LABEL_CAP = 18; // longer pin names ellipsize rather than widen the column
const COL_PAD = 20; // handle + inner padding per column
const MID_GAP = 36; // clear gap between the left (input) and right (output) banks
const H_SLOT_PAD = 14; // padding around each top/bottom (supply/ground) pin label
const BAND_H = 30; // height of the top (supply) and bottom (ground) bands (room for dot + label)
const MAX_COL_ROWS = 30; // wrap a side into another sub-column past this many rows
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

export interface RadialLayout {
  /** Every placed pin (all edges) — handles, labels, and repPin mapping. */
  rows: PlacedRow[];
  width: number;
  height: number;
}

const colWidth = (rows: PinRow[]) =>
  rows.length === 0 ? 0 : Math.min(Math.max(...rows.map(r => r.pinLabel.length)), LABEL_CAP) * CHAR_W + COL_PAD;
const slotWidth = (row: PinRow) => Math.min(row.pinLabel.length, LABEL_CAP) * CHAR_W + H_SLOT_PAD;
const bandWidth = (rows: PinRow[]) =>
  rows.length === 0 ? 0 : rows.reduce((sum, r) => sum + slotWidth(r), 0) + COL_PAD;

// Split one side's rows into balanced sub-columns (≤ MAX_COL_ROWS each), so a
// 90-input bank becomes a few short columns instead of one tall tower.
interface SideCols { chunks: PinRow[][]; colWidths: number[]; totalWidth: number; tall: number; }
function sideColumns(rows: PinRow[]): SideCols {
  if (rows.length === 0) return { chunks: [], colWidths: [], totalWidth: 0, tall: 0 };
  const cols = Math.max(1, Math.ceil(rows.length / MAX_COL_ROWS));
  const perCol = Math.ceil(rows.length / cols);
  const chunks: PinRow[][] = [];
  for (let k = 0; k < cols; k++) chunks.push(rows.slice(k * perCol, (k + 1) * perCol));
  const colWidths = chunks.map(colWidth);
  return { chunks, colWidths, totalWidth: colWidths.reduce((a, b) => a + b, 0), tall: chunks[0].length };
}

export function computeRadialLayout(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): RadialLayout {
  const grouped = bucketPinRows(conn, ports, netKindOf);
  const { input: inputs, output: outputs, supply, ground } = grouped;

  const inCols = sideColumns(inputs);
  const outCols = sideColumns(outputs);

  const innerW = inputs.length || outputs.length ? inCols.totalWidth + MID_GAP + outCols.totalWidth : 0;
  const width = Math.max(innerW, bandWidth(supply), bandWidth(ground), MIN_W);

  const topHeight = supply.length ? BAND_H : 0;
  const bottomHeight = ground.length ? BAND_H : 0;
  const midTop = HEADER_H + topHeight;
  const midHeight = Math.max(inCols.tall, outCols.tall) * PIN_ROW_H;
  const height = midTop + midHeight + bottomHeight + BODY_PAD;

  const rowY = (i: number) => midTop + i * PIN_ROW_H + PIN_ROW_H / 2;
  const placed: PlacedRow[] = [];

  // Inputs: sub-columns left → right, handle on each column's LEFT edge.
  let lx = 0;
  inCols.chunks.forEach((chunk, k) => {
    chunk.forEach((row, i) => placed.push({ row, group: 'input', side: 'left', x: lx, y: rowY(i) }));
    lx += inCols.colWidths[k];
  });

  // Outputs: sub-columns right → left, handle on each column's RIGHT edge.
  let rx = width;
  outCols.chunks.forEach((chunk, k) => {
    chunk.forEach((row, i) => placed.push({ row, group: 'output', side: 'right', x: rx, y: rowY(i) }));
    rx -= outCols.colWidths[k];
  });

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
  // Dot sits near the band's outer edge (top for supply, bottom for ground);
  // BetaPinLabel offsets the label inward so the dot never lands on the word.
  layBand(supply, 'supply', 'top', HEADER_H + 9);
  layBand(ground, 'ground', 'bottom', height - BODY_PAD - 9);

  return { rows: placed, width, height };
}
