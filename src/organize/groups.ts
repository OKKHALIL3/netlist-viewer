// Functional grouping for the "Organize" schematic view.
//
// Given the CellView the canvas already renders, assign every display node
// (sub-block instances + raw devices) to a coarse functional group so the
// layout can box them into labeled dotted sections — Analog Core, Bias, Digital,
// I/O, Passives. This is the deterministic backbone of the organized view; the
// LLM only sharpens the labels afterward (see labelGroups.ts).
//
// Evidence, in order:
//   • sub-block instances → the existing name classifier (ruleClassifier) run on
//     the master cell name, then folded from the 26-category taxonomy down to a
//     handful of display groups.
//   • raw devices → transistors are analog/logic core, R/C are passives.
// Rails are never grouped (they're excluded from the schematic core anyway), so
// a shared VDD/VSS can't glue every block into one section.

import type { Design } from '../parser/types';
import type { CellView } from '../layout/cellView';
import { ruleClassifier } from '../hybrid/classify';
import { detectDeviceStructures } from './deviceStructures';

// The coarse display groups. Deliberately fewer than the fine taxonomy: the goal
// is a readable analog/digital/bias/io split a reviewer takes in at a glance,
// not a precise functional label (Claude adds the sharp name).
export type GroupKind = 'core' | 'bias' | 'digital' | 'io' | 'passive' | 'other';

export interface OrganizeGroup {
  /** Stable id — equal to the kind (one group per kind per cell). */
  id: string;
  kind: GroupKind;
  /** Deterministic label, always present so the view works with no API key. */
  label: string;
  /** Display-node ids (instances + primitives) that belong to this group. */
  memberIds: string[];
}

const GROUP_LABEL: Record<GroupKind, string> = {
  io: 'I/O',
  bias: 'Bias / Reference',
  core: 'Analog Core',
  digital: 'Digital / Control',
  passive: 'Passives / Protect',
  other: 'Other',
};

// Left→right display order — a stable tie-break for groups ELK places on the
// same layer. Real placement still follows connectivity (I/O feeds core feeds
// output), this only decides ties.
const GROUP_ORDER: GroupKind[] = ['io', 'bias', 'core', 'digital', 'passive', 'other'];

// Fold a fine taxonomy category (A:AMP, D:LOGIC, AMS:IO, …) into a display group.
export function kindOfCategory(cat: string | null): GroupKind {
  if (!cat) return 'other';
  if (cat === 'A:REF/BIAS' || cat === 'A:PM') return 'bias';
  if (cat === 'A:PROT') return 'passive';
  if (cat === 'AMS:IO') return 'io';
  const domain = cat.split(':')[0];
  if (domain === 'D') return 'digital';
  if (domain === 'A' || domain === 'AMS') return 'core';
  return 'other';
}

// Assign every display node to a group and return the non-empty groups in
// left→right order. Pure: depends only on the view + the design's cell names.
export function computeGroups(view: CellView, design: Design | null): OrganizeGroup[] {
  const classifier = ruleClassifier();
  const members = new Map<GroupKind, string[]>();
  const add = (kind: GroupKind, id: string) => {
    const list = members.get(kind);
    if (list) list.push(id);
    else members.set(kind, [id]);
  };

  for (const inst of view.instances) {
    const cat = classifier.classify(inst.master, design?.cells.get(inst.master));
    add(kindOfCategory(cat), inst.id);
  }

  // Device-level idioms first — differential pairs, cross-coupled pairs,
  // current mirrors, CMOS pairs, stacks, dummy ties — each occurrence its own
  // labeled box. Only devices no structure claimed fall into the coarse
  // core/passive buckets below (the old behavior).
  const structures = detectDeviceStructures(view, view.primitives);
  const structured = new Set(structures.flatMap(s => s.memberIds));
  for (const prim of view.primitives) {
    if (structured.has(prim.id)) continue;
    add(prim.kind === 'M' ? 'core' : 'passive', prim.id);
  }

  const groups: OrganizeGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const ids = members.get(kind);
    if (ids && ids.length) {
      groups.push({ id: kind, kind, label: GROUP_LABEL[kind], memberIds: ids });
    }
  }
  groups.push(...structures);
  return groups;
}

// id → group kind, for coloring/lookup on the canvas.
export function groupOfNode(groups: OrganizeGroup[]): Map<string, GroupKind> {
  const map = new Map<string, GroupKind>();
  for (const g of groups) for (const id of g.memberIds) map.set(id, g.kind);
  return map;
}
