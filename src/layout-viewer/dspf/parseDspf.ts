import type { LayoutData, DspfNet } from '../model';

// Parse the "(...)" payload of a coordinate directive. Returns the leading
// name plus X,Y when the inner-token arity and trailing floats indicate coords.
function parseParen(payload: string, minArityForCoords: number):
  { name: string; x: number; y: number } | { name: string; x: null; y: null } | null {
  const inner = payload.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return null;
  const tok = inner.split(/\s+/);
  const name = tok[0];
  if (tok.length >= minArityForCoords) {
    const x = Number(tok[tok.length - 2]);
    const y = Number(tok[tok.length - 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { name, x, y };
  }
  return { name, x: null, y: null };
}

const LAYER_RE = /\$layer\s*=\s*(\S+)/i;

export function parseDspf(text: string): LayoutData {
  const data: LayoutData = {
    divider: '/', delimiter: ':', nets: [], devices: [],
    layersPresent: false, layers: [],
  };
  const layerSet = new Set<string>();
  let net: DspfNet | null = null;
  let sawInstCoords = false;
  // Buffer of *|S points so the device fallback (and never net binding) can use
  // them when no *|I line carried coordinates (the CLKGEN case).
  const subnodePoints: Array<{ name: string; x: number; y: number }> = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('*|DIVIDER')) { data.divider = line.split(/\s+/)[1] ?? '/'; continue; }
    if (line.startsWith('*|DELIMITER')) { data.delimiter = line.split(/\s+/)[1] ?? ':'; continue; }
    if (line.startsWith('*|NET')) {
      net = { name: line.split(/\s+/)[1] ?? '', subnodes: [], parasitics: 0, resistors: [] };
      data.nets.push(net);
      continue;
    }
    if (line.startsWith('*|S')) {
      const p = parseParen(line.slice(3).trim(), 3);
      if (p && p.x !== null) {
        if (net) net.subnodes.push({ name: p.name, x: p.x, y: p.y });
        subnodePoints.push({ name: p.name, x: p.x, y: p.y });
      }
      continue;
    }
    if (line.startsWith('*|P')) {
      const p = parseParen(line.slice(3).trim(), 5);
      if (p && p.x !== null && net) net.subnodes.push({ name: p.name, x: p.x, y: p.y });
      continue;
    }
    if (line.startsWith('*|I')) {
      const p = parseParen(line.slice(3).trim(), 7);
      if (p && p.x !== null) {
        sawInstCoords = true;
        const cut = p.name.lastIndexOf(data.delimiter);
        data.devices.push({ path: cut > 0 ? p.name.slice(0, cut) : p.name, x: p.x, y: p.y });
      }
      continue;
    }
    if (line.startsWith('*|')) continue; // other directives ignored

    // Parasitic elements: "R<id> a b val [$layer=m]" / "C<id> a b val ..."
    const head = line[0];
    if ((head === 'R' || head === 'r' || head === 'C' || head === 'c') && net) {
      net.parasitics += 1;
      if (head === 'R' || head === 'r') {
        const tok = line.split(/\s+/);
        const m = line.match(LAYER_RE);
        const layer = m ? m[1] : null;
        if (layer) { data.layersPresent = true; layerSet.add(layer); }
        net.resistors.push({ a: tok[1] ?? '', b: tok[2] ?? '', layer });
      }
    }
  }

  // CLKGEN case: no *|I coordinates → derive device points from *|S names.
  if (!sawInstCoords) {
    for (const s of subnodePoints) {
      const cut = s.name.lastIndexOf(data.delimiter);
      data.devices.push({ path: cut > 0 ? s.name.slice(0, cut) : s.name, x: s.x, y: s.y });
    }
  }

  data.layers = [...layerSet];
  return data;
}
