import type { Cell } from '../parser/types';
import { simpleCompletion } from '../chat/client';

const DESC_CACHE_STORAGE = 'cdl-viewer:cell-descriptions';
const MODEL = 'claude-haiku-4-5-20251001';

// Key storage lives in ./apiKey; re-exported here so existing importers keep
// their import path.
export { getApiKey, setApiKey, clearApiKey } from './apiKey';

function loadCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DESC_CACHE_STORAGE) ?? '{}');
  } catch {
    return {};
  }
}

export function getCachedDescription(cellName: string): string | null {
  return loadCache()[cellName] ?? null;
}

function setCachedDescription(cellName: string, text: string): void {
  const cache = loadCache();
  cache[cellName] = text;
  localStorage.setItem(DESC_CACHE_STORAGE, JSON.stringify(cache));
}

const DIR_LABEL: Record<string, string> = { I: 'input', O: 'output', B: 'bidirectional/supply' };

function buildPrompt(cell: Cell): string {
  const lines: string[] = [];
  lines.push(`Subcircuit name: ${cell.name}`);
  lines.push('Ports:');
  for (const port of cell.ports) {
    lines.push(`  ${port.name} (${port.dir ? DIR_LABEL[port.dir] ?? port.dir : 'unknown direction'})`);
  }

  const MAX_ITEMS = 60;
  if (cell.primitives.length > 0) {
    lines.push('Devices:');
    for (const prim of cell.primitives.slice(0, MAX_ITEMS)) {
      const terms = prim.terms.map(([t, n]) => `${t}=${n}`).join(' ');
      lines.push(`  ${prim.id}: ${prim.kind} model=${prim.model} ${terms}`);
    }
    if (cell.primitives.length > MAX_ITEMS) lines.push(`  ...and ${cell.primitives.length - MAX_ITEMS} more devices`);
  }

  if (cell.instances.length > 0) {
    lines.push('Sub-blocks:');
    for (const inst of cell.instances.slice(0, MAX_ITEMS)) {
      const conn = Object.entries(inst.conn).map(([p, n]) => `${p}=${n}`).join(' ');
      lines.push(`  ${inst.id}: ${inst.master} ${conn}`);
    }
    if (cell.instances.length > MAX_ITEMS) lines.push(`  ...and ${cell.instances.length - MAX_ITEMS} more sub-blocks`);
  }

  if (cell.primitives.length === 0 && cell.instances.length === 0) {
    lines.push('(No internal devices visible — this is a black-box/leaf cell, likely from a standard-cell or PDK library. Infer its function from its name and port list using standard-cell naming conventions.)');
  }

  return [
    'You are an IC design assistant helping an engineer review a schematic viewer.',
    'Given the following subcircuit definition, describe what this block does electrically/logically, formatted for a quick skim:',
    '- Line 1: a short function label (e.g. "2-input NAND gate", "differential input buffer with hysteresis", "cross-coupled regeneration latch").',
    '- Then 2-3 short bullet points (each starting with "- "), covering only the most important behavior — e.g. key inputs/outputs and what they do, notable structure, or operating mode. Each bullet under ~12 words.',
    'Be terse. No preamble, no restating the port list, no closing summary.',
    '',
    ...lines,
  ].join('\n');
}

export async function describeCell(cell: Cell, force = false): Promise<string> {
  if (!force) {
    const cached = getCachedDescription(cell.name);
    if (cached) return cached;
  }

  const text = await simpleCompletion({ model: MODEL, maxTokens: 300, prompt: buildPrompt(cell) });

  setCachedDescription(cell.name, text);
  return text;
}
