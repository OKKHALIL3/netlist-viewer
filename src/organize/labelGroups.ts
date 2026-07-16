// Optional LLM layer for the Organize view: sharpen each functional group's
// deterministic label and add a one-line "what this does" note. This is the
// "understanding from claude" part — but it is strictly additive. The groups,
// boxes, and generic labels ("Analog Core", "Bias") come from the deterministic
// engine and render with no API key; when a key is present this upgrades the
// wording. One cached call per cell, keyed by cell name, mirroring describeCell.

import type { CellView } from '../layout/cellView';
import type { OrganizeGroup } from './groups';
import { simpleCompletion } from '../chat/client';

const CACHE_STORAGE = 'cdl-viewer:group-labels';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_MEMBERS = 12;

export interface GroupLabel {
  /** Sharpened section name, e.g. "Input diff pair". */
  name: string;
  /** ≤12-word note on function / signal flow. */
  note: string;
}
// Keyed by group id (the GroupKind).
export type GroupLabels = Record<string, GroupLabel>;

function loadCache(): Record<string, GroupLabels> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_STORAGE) ?? '{}');
  } catch {
    return {};
  }
}

export function getCachedGroupLabels(cellName: string): GroupLabels | null {
  return loadCache()[cellName] ?? null;
}

function setCached(cellName: string, labels: GroupLabels): void {
  const cache = loadCache();
  cache[cellName] = labels;
  localStorage.setItem(CACHE_STORAGE, JSON.stringify(cache));
}

// A compact "what's in this group" line for the prompt: sub-block master names
// and device kinds, deduped with counts and capped.
function describeMembers(view: CellView, group: OrganizeGroup): string {
  const counts = new Map<string, number>();
  for (const id of group.memberIds) {
    const inst = view.instancesById.get(id);
    const name = inst
      ? inst.master
      : (() => {
          const p = view.primitivesById.get(id);
          if (!p) return id;
          const kind = p.kind === 'M' ? p.model : p.kind === 'R' ? 'resistor' : 'capacitor';
          return kind;
        })();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .slice(0, MAX_MEMBERS)
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name));
  if (counts.size > MAX_MEMBERS) parts.push(`+${counts.size - MAX_MEMBERS} more`);
  return parts.join(', ');
}

function buildPrompt(view: CellView, groups: OrganizeGroup[]): string {
  const lines = groups.map(
    g => `  ${g.id} ("${g.label}"): ${describeMembers(view, g)}`,
  );
  return [
    'You are an IC design assistant labeling functional sections of a schematic.',
    `Subcircuit: ${view.name}`,
    'These are the functional groups found in it, each with its members (sub-block cell names and/or device types):',
    ...lines,
    '',
    'For EACH group id, return a sharper section name and a terse note.',
    '- "name": ≤4 words, a specific function (e.g. "Input diff pair", "Current-mirror bias", "Output driver"). Fall back to the generic label if unsure.',
    '- "note": ≤12 words on what it does or how signal flows through it.',
    'Respond with ONLY a JSON object mapping each group id to {"name": "...", "note": "..."}. No prose, no code fences.',
  ].join('\n');
}

// Pull the first {...} block out of the model response and parse it, tolerating
// stray code fences or preamble.
function parseLabels(text: string, groups: OrganizeGroup[]): GroupLabels | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const valid = new Set(groups.map(g => g.id));
  const out: GroupLabels = {};
  for (const [id, v] of Object.entries(obj)) {
    if (!valid.has(id) || typeof v !== 'object' || v === null) continue;
    const name = (v as Record<string, unknown>).name;
    const note = (v as Record<string, unknown>).note;
    if (typeof name === 'string' && name.trim()) {
      out[id] = { name: name.trim(), note: typeof note === 'string' ? note.trim() : '' };
    }
  }
  return Object.keys(out).length ? out : null;
}

// Fetch sharpened labels for a cell's groups. Returns cached labels immediately
// when present. Requires an API key — callers should treat a throw/absence as
// "keep the deterministic labels" (the view already works without this).
export async function labelGroups(view: CellView, groups: OrganizeGroup[], force = false): Promise<GroupLabels> {
  if (!force) {
    const cached = getCachedGroupLabels(view.name);
    if (cached) return cached;
  }

  const text = await simpleCompletion({ model: MODEL, maxTokens: 500, prompt: buildPrompt(view, groups) });

  const labels = parseLabels(text, groups);
  if (!labels) throw new Error('Could not parse group labels from the model response.');

  setCached(view.name, labels);
  return labels;
}
