import type { Cell } from '../parser/types';

const API_KEY_STORAGE = 'cdl-viewer:anthropic-api-key';
const DESC_CACHE_STORAGE = 'cdl-viewer:cell-descriptions';
const MODEL = 'claude-haiku-4-5-20251001';

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE);
}

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

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key set.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPrompt(cell) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      message = JSON.parse(body)?.error?.message ?? body;
    } catch {
      // keep raw body
    }
    throw new Error(`Anthropic API error (${res.status}): ${message}`);
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('')
    .trim();

  if (!text) throw new Error('Anthropic API returned an empty response.');

  setCachedDescription(cell.name, text);
  return text;
}
