import { parseSpiceNumber, isNumericToken } from './units';

export function splitTokens(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

export interface SplitKV { params: Map<string, string>; rest: string[] }

export function parseKeyVals(tokens: string[]): SplitKV {
  const params = new Map<string, string>();
  const rest: string[] = [];
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq > 0) params.set(t.slice(0, eq).replace(/^\$/, '').toLowerCase(), t.slice(eq + 1));
    else rest.push(t);
  }
  return { params, rest };
}

// `rest` is the full positional token list (name at rest[0]) so directive
// consumers can read the fields between the name and the coordinates
// (*|I instance identity, *|P pin type / cap).
export interface ParenInfo { name: string; rest: string[]; x: number | null; y: number | null; params: Map<string, string> }

export function parseParenPayload(payload: string): ParenInfo | null {
  const inner = payload.trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return null;
  const { params, rest } = parseKeyVals(splitTokens(inner));
  if (rest.length === 0) return null;
  const name = rest[0];
  let x: number | null = null;
  let y: number | null = null;
  if (params.has('x') && params.has('y')) {
    const px = parseSpiceNumber(params.get('x')!);
    const py = parseSpiceNumber(params.get('y')!);
    if (Number.isFinite(px) && Number.isFinite(py)) { x = px; y = py; }
  }
  if (x === null && rest.length >= 3) {
    const a = rest[rest.length - 2];
    const b = rest[rest.length - 1];
    if (isNumericToken(a) && isNumericToken(b)) { x = Number(a); y = Number(b); }
  }
  return { name, rest, x, y, params };
}
