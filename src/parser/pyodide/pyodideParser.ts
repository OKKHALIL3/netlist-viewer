// Main-thread wrapper around parser.worker.ts: spawns the worker lazily,
// converts the worker's Design JSON into the Map-based Design shape.
import type { Cell, Design } from '../types';
import { refineNetKinds } from '../netKinds';
import type { ParseRequest, ParseResponse } from './parser.worker';

interface DesignJSON {
  cells: Record<string, Cell>;
  topCell: string;
  warnings: string[];
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (design: Design) => void; reject: (err: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (e: MessageEvent<ParseResponse>) => {
    const { id, ok, json, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok && json) {
      entry.resolve(jsonToDesign(json));
    } else {
      entry.reject(new Error(error ?? 'Unknown parser error'));
    }
  };

  worker.onerror = (e) => {
    for (const entry of pending.values()) entry.reject(new Error(e.message));
    pending.clear();
  };

  return worker;
}

function jsonToDesign(json: string): Design {
  const parsed = JSON.parse(json) as DesignJSON;
  const design: Design = {
    cells: new Map(Object.entries(parsed.cells)),
    topCell: parsed.topCell,
    warnings: parsed.warnings,
  };
  // The Python adapter classifies nets by NAME only; refine with the
  // topology + hierarchy evidence (catches rails like AVRH/AVRL).
  refineNetKinds(design);
  return design;
}

export function parseCDLAsync(text: string): Promise<Design> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text } satisfies ParseRequest);
  });
}
