// Main-thread wrapper around dspf.worker.ts: spawns the worker lazily and
// resolves a LayoutData per request. Mirrors pyodideParser's parseCDLAsync.
import type { LayoutData } from '../model';
import type { DspfRequest, DspfResponse } from './dspf.worker';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (d: LayoutData) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./dspf.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<DspfResponse>) => {
    const { id, ok, data, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok && data) entry.resolve(data);
    else entry.reject(new Error(error ?? 'Unknown DSPF parse error'));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message)); pending.clear(); };
  return worker;
}

export function parseDspfAsync(text: string): Promise<LayoutData> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text } satisfies DspfRequest);
  });
}
