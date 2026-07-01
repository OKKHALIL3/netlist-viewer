// Module worker: parse a DSPF off the main thread (files reach ~22 MB).
// Emits { id, progress } messages while parsing, then the final result.
import { parseDspf } from './parseDspf';
import type { LayoutData } from '../model';

export interface DspfRequest { id: number; text: string }
export type DspfResponse =
  | { id: number; progress: number }
  | { id: number; ok: boolean; data?: LayoutData; error?: string };

const ctx = self as unknown as Worker;
ctx.onmessage = (e: MessageEvent<DspfRequest>) => {
  const { id, text } = e.data;
  try {
    const data = parseDspf(text, {
      onProgress: (frac) => ctx.postMessage({ id, progress: frac } satisfies DspfResponse),
    });
    ctx.postMessage({ id, ok: true, data } satisfies DspfResponse);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies DspfResponse);
  }
};
