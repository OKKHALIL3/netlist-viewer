// SPICE engineering-suffix number parsing for DSPF values.
const SUFFIX: Record<string, number> = {
  f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, '\u00b5': 1e-6, m: 1e-3,
  k: 1e3, x: 1e6, g: 1e9, t: 1e12,
};

export function parseSpiceNumber(raw: string): number {
  if (!raw) return NaN;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/.exec(raw.trim());
  if (!m) return NaN;
  const mantissa = Number(m[1]);
  if (!Number.isFinite(mantissa)) return NaN;
  const tail = m[2].trim().toLowerCase();
  if (!tail) return mantissa;
  if (tail.startsWith('meg')) return mantissa * 1e6;
  const f = SUFFIX[tail[0]];
  return f !== undefined ? mantissa * f : mantissa;
}

export function isNumericToken(tok: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(tok);
}

export function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const v = parseSpiceNumber(raw);
  return Number.isFinite(v) ? v : null;
}
