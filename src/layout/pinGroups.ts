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

// Groups an instance's pin→net connections into the four sections and computes
// each pin row's vertical position. Bus collapsing (groupPinConnections) runs
// within each group — bus bits share a direction and net kind, so a run always
// lands in one group and stays contiguous, collapsing exactly as before.
export function computeInstanceLayout(
  conn: Record<string, string>,
  ports: Port[],
  netKindOf: (net: string) => NetKind,
): InstanceLayout {
  const buckets = new Map<PinGroup, Array<[string, string]>>();
  for (const group of GROUP_ORDER) buckets.set(group, []);
  for (const [pin, net] of Object.entries(conn)) {
    buckets.get(classifyPin(pin, netKindOf(net), ports))!.push([pin, net]);
  }

  const sections: LaidOutSection[] = [];
  let y = HEADER_H;
  for (const group of GROUP_ORDER) {
    const entries = buckets.get(group)!;
    if (entries.length === 0) continue;
    y += SECTION_H; // section header
    const rows = groupPinConnections(entries).map(row => {
      const laid: LaidOutRow = { row, top: y + PIN_ROW_H / 2 };
      y += PIN_ROW_H;
      return laid;
    });
    const meta = GROUP_META[group];
    sections.push({ group, label: meta.label, color: meta.color, rows });
  }

  return { sections, height: y + BODY_PAD };
}
