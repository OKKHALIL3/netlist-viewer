import type { DspfResistor, DspfCapacitor } from '../model';
import { parseKeyVals } from './tokens';
import { parseSpiceNumber, num } from './units';

export type ResolveLayer = (params: Map<string, string>) => string | null;

export function parseResistor(tokens: string[], resolveLayer: ResolveLayer): DspfResistor | null {
  if (tokens.length < 3) return null;
  const name = tokens[0];
  const { params, rest } = parseKeyVals(tokens.slice(1));
  const a = rest[0] ?? '';
  const b = rest[1] ?? '';
  if (!a || !b) return null;
  const value = rest[2] !== undefined ? parseSpiceNumber(rest[2]) : NaN;
  return {
    name, a, b,
    value: Number.isFinite(value) ? value : null,
    layer: resolveLayer(params),
    x1: num(params.get('x')), y1: num(params.get('y')),
    x2: num(params.get('x2')), y2: num(params.get('y2')),
    width: num(params.get('w')), length: num(params.get('l')),
  };
}

export function parseCapacitor(tokens: string[], resolveLayer: ResolveLayer): DspfCapacitor | null {
  if (tokens.length < 3) return null;
  const name = tokens[0];
  const { params, rest } = parseKeyVals(tokens.slice(1));
  const a = rest[0] ?? '';
  const b = rest[1] ?? '';
  if (!a) return null;
  const value = rest[2] !== undefined ? parseSpiceNumber(rest[2]) : NaN;
  return {
    name, a, b,
    value: Number.isFinite(value) ? value : null,
    layer: resolveLayer(params),
    x: num(params.get('x')), y: num(params.get('y')),
    coupling: b !== '' && b !== '0',
  };
}
