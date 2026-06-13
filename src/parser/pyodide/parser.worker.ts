// Module worker: runs eda-netlist-parser (via Pyodide) off the main thread.
// See cdl_adapter.py for the Python side of the contract.
import cdlAdapterSource from './cdl_adapter.py?raw';

const PYODIDE_VERSION = '0.29.4';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

interface PyProxy {
  install(packages: string | string[]): Promise<void>;
}

interface PyCallable {
  (text: string): string;
}

interface PyodideInterface {
  loadPackage(names: string | string[]): Promise<void>;
  pyimport(name: string): PyProxy;
  runPython(code: string): unknown;
  globals: { get(name: string): PyCallable };
}

type LoadPyodide = (options: { indexURL: string }) => Promise<PyodideInterface>;

let pyodidePromise: Promise<PyodideInterface> | null = null;

async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const mod = (await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)) as {
        loadPyodide: LoadPyodide;
      };
      const pyodide = await mod.loadPyodide({ indexURL: PYODIDE_CDN });
      await pyodide.loadPackage('micropip');
      const micropip = pyodide.pyimport('micropip');
      await micropip.install('eda-netlist-parser');
      pyodide.runPython(cdlAdapterSource);
      return pyodide;
    })();
  }
  return pyodidePromise;
}

export interface ParseRequest {
  id: number;
  text: string;
}

export interface ParseResponse {
  id: number;
  ok: boolean;
  json?: string;
  error?: string;
}

const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { id, text } = e.data;
  try {
    const pyodide = await getPyodide();
    const parseCdl = pyodide.globals.get('parse_cdl');
    const json = parseCdl(text);
    ctx.postMessage({ id, ok: true, json } satisfies ParseResponse);
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ParseResponse);
  }
};
