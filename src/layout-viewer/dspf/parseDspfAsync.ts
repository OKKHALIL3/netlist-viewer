// Main-thread wrapper around dspf.worker.ts: spawns the worker lazily and
// resolves a LayoutData per request. Mirrors pyodideParser's parseCDLAsync.
// Progress messages (0..1) stream to the optional onProgress callback.
import type { LayoutData } from '../model';
import type { DspfRequest, DspfResponse } from './dspf.worker';

interface Pending {
  resolve: (d: LayoutData) => void;
  reject: (e: Error) => void;
  onProgress?: (frac: number) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./dspf.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<DspfResponse>) => {
    const entry = pending.get(e.data.id);
    if (!entry) return;
    if ('progress' in e.data) {
      entry.onProgress?.(e.data.progress);
      return;
    }
    pending.delete(e.data.id);
    if (e.data.ok && e.data.data) entry.resolve(e.data.data);
    else entry.reject(new Error(e.data.error ?? 'Unknown DSPF parse error'));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message)); pending.clear(); };
  return worker;
}

export function parseDspfAsync(text: string, onProgress?: (frac: number) => void): Promise<LayoutData> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, text } satisfies DspfRequest);
  });
}
