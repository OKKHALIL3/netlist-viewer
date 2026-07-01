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
    // Provisional: node "0" is always ground. The section parser refines this
    // with the declared ground nets and the owning net's name (same-net caps
    // are not coupling).
    coupling: b !== '' && b !== '0',
  };
}

// A device statement (M/X/D/Q/… line, typically in the trailing "Instance
// Section"): instance name, terminal-node refs, then the model, then params.
export function parseDeviceStatement(
  tokens: string[],
): { name: string; nodes: string[]; model: string | null } | null {
  if (tokens.length < 2) return null;
  const name = tokens[0];
  const { rest } = parseKeyVals(tokens.slice(1));
  if (rest.length === 0) return null;
  // last non-param token is the model; everything before it is node refs
  const model = rest.length >= 2 ? rest[rest.length - 1] : null;
  const nodes = model !== null ? rest.slice(0, -1) : rest;
  return { name, nodes, model };
}
