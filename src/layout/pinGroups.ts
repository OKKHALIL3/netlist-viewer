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

// ── BETA layout: pins placed around the four edges of the block ──────────────
// the block is drawn as a schematic symbol — a thicker box with pin stubs (tick
// marks) on its four edges: inputs left, outputs right, supply top, ground
// bottom. There is no inline pin/net text — the pin→net mapping lives in the
// Inspector. Pins on each edge are spread evenly along that edge.

const SYM_WIDTH = 152; // base box width (widened if a rail needs more room)
const TICK_PITCH = 12; // min spacing between adjacent pins on an edge
const EDGE_PAD = 16; // keep pins away from the corners
const MIN_SYM_H = 64; // so the centered name label always fits

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface PlacedRow {
  row: PinRow;
  side: Side;
  /** Handle center, relative to the node's top-left corner. */
  x: number;
  y: number;
}

export interface RadialLayout {
  /** Every placed pin, all sides — for emitting handles + repPin mapping. */
  rows: PlacedRow[];
  left: PlacedRow[];
  right: PlacedRow[];
  top: PlacedRow[];
  bottom: PlacedRow[];
  width: number;
  height: number;
}

export function computeRadialLayout(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): RadialLayout {
  const grouped = bucketPinRows(conn, ports, netKindOf);
  const nL = grouped.input.length;
  const nR = grouped.output.length;
  const nT = grouped.supply.length;
  const nB = grouped.ground.length;

  const height = Math.max(Math.max(nL, nR) * TICK_PITCH + 2 * EDGE_PAD, MIN_SYM_H);
  const width = Math.max(SYM_WIDTH, Math.max(nT, nB) * TICK_PITCH + 2 * EDGE_PAD);

  // Even spread of n pins along an edge of length `span`.
  const along = (n: number, i: number, span: number) => EDGE_PAD + ((i + 0.5) / n) * (span - 2 * EDGE_PAD);
  const left = grouped.input.map((row, i): PlacedRow => ({ row, side: 'left', x: 0, y: along(nL, i, height) }));
  const right = grouped.output.map((row, i): PlacedRow => ({ row, side: 'right', x: width, y: along(nR, i, height) }));
  const top = grouped.supply.map((row, i): PlacedRow => ({ row, side: 'top', x: along(nT, i, width), y: 0 }));
  const bottom = grouped.ground.map((row, i): PlacedRow => ({ row, side: 'bottom', x: along(nB, i, width), y: height }));

  return { rows: [...left, ...right, ...top, ...bottom], left, right, top, bottom, width, height };
}
