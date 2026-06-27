import type { LayoutData, DspfNet, DspfPoint, DspfDevice, DspfDiagnostics } from '../model';
import { forEachLogicalLine } from './lines';
import { splitTokens, parseParenPayload } from './tokens';
import { parseResistor, parseCapacitor, type ResolveLayer } from './elements';

export interface ParseDspfOptions { unitScale?: number }

function freshDiagnostics(): DspfDiagnostics {
  return {
    logicalLines: 0, nets: 0, devices: 0, resistors: 0,
    resistorsWithGeometry: 0, capacitors: 0, couplingCaps: 0,
    pointsWithCoords: 0, unitScale: 1, unrecognized: 0, warnings: [],
  };
}

function stripPin(name: string, delimiter: string): string {
  const cut = name.lastIndexOf(delimiter);
  return cut > 0 ? name.slice(0, cut) : name;
}

export function parseDspf(text: string, opts: ParseDspfOptions = {}): LayoutData {
  const layerMap = new Map<string, string>();
  const resolveLayer: ResolveLayer = (p) => {
    const direct = p.get('layer');
    if (direct) return direct;
    const lvl = p.get('lvl');
    if (lvl && layerMap.has(lvl)) return layerMap.get(lvl)!;
    return null;
  };

  const diag = freshDiagnostics();
  const data: LayoutData = {
    divider: '/', delimiter: ':', busDelimiter: null,
    groundNets: [], design: null, generator: null,
    layerMap: {}, layersPresent: false, layers: [],
    nets: [], devices: [], diagnostics: diag,
  };
  const layerSet = new Set<string>();
  let net: DspfNet | null = null;
  let sawInstCoords = false;
  const subnodePoints: DspfPoint[] = [];
  const instDevices: DspfDevice[] = [];

  const addLayer = (l: string | null) => { if (l) layerSet.add(l); };
  const recordPoint = (pt: DspfPoint) => { if (pt.x !== null) diag.pointsWithCoords++; addLayer(pt.layer); };

  forEachLogicalLine(text, (line) => {
    diag.logicalLines++;

    if (line.startsWith('*|')) {
      // Tag and value are separated by whitespace — a space (Calibre xRC,
      // Quantus) OR a tab (Calibre xACT). Splitting on space alone silently
      // dropped every header directive in tab-delimited files.
      const sp = line.search(/\s/);
      const tag = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
      const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
      switch (tag) {
        case '*|DIVIDER': data.divider = rest.split(/\s+/)[0] || '/'; break;
        case '*|DELIMITER': data.delimiter = rest.split(/\s+/)[0] || ':'; break;
        case '*|BUSBIT':
        case '*|BUS_DELIMITER': data.busDelimiter = rest.split(/\s+/)[0] || null; break;
        case '*|GROUND_NET': if (rest) data.groundNets.push(rest.split(/\s+/)[0]); break;
        case '*|DESIGN': data.design = rest.replace(/^"|"$/g, '') || null; break;
        case '*|DSPF':
        case '*|PROGRAM':
        case '*|VERSION': data.generator = (data.generator ? data.generator + ' ' : '') + rest; break;
        case '*|NET': {
          const tok = rest.split(/\s+/);
          const cap = tok[1] !== undefined ? Number(tok[1]) : NaN;
          net = {
            name: tok[0] ?? '', totalCap: Number.isFinite(cap) ? cap : null,
            ports: [], subnodes: [], instPins: [], resistors: [], capacitors: [],
          };
          data.nets.push(net); diag.nets++;
          break;
        }
        case '*|P': {
          const info = parseParenPayload(rest);
          if (info && net) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            net.ports.push(pt); recordPoint(pt);
          }
          break;
        }
        case '*|S': {
          const info = parseParenPayload(rest);
          if (info && net) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            net.subnodes.push(pt); recordPoint(pt);
            if (pt.x !== null && pt.y !== null) subnodePoints.push(pt);
          }
          break;
        }
        case '*|I': {
          const info = parseParenPayload(rest);
          if (info) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            if (net) net.instPins.push(pt);
            recordPoint(pt);
            if (info.x !== null && info.y !== null) {
              sawInstCoords = true;
              instDevices.push({ path: stripPin(info.name, data.delimiter), x: info.x, y: info.y });
            }
          }
          break;
        }
        default: diag.unrecognized++; break;
      }
      return;
    }

    if (line.startsWith('*')) {
      const m = /^\*(\d+)\s+(\S+)/.exec(line);
      if (m) layerMap.set(m[1], m[2].replace(/:.*$/, ''));
      return; // plain comment
    }

    const head = line[0];
    if (head === '.') return; // .SUBCKT/.ENDS/.GLOBAL/.PARAM — structure not needed for the abstract map

    const c = head.toLowerCase();
    if (c === 'r') {
      const r = parseResistor(splitTokens(line), resolveLayer);
      if (r && net) {
        net.resistors.push(r); diag.resistors++;
        if (r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null) diag.resistorsWithGeometry++;
        addLayer(r.layer);
      }
      return;
    }
    if (c === 'c') {
      const cap = parseCapacitor(splitTokens(line), resolveLayer);
      if (cap && net) {
        net.capacitors.push(cap); diag.capacitors++;
        if (cap.coupling) diag.couplingCaps++;
        addLayer(cap.layer);
      }
      return;
    }
    // device instance lines (m/x/q/d/...) carry no coordinates for the abstract map → ignored
  });

  // CLKGEN fallback: no *|I carried coords → derive device points from *|S names.
  if (!sawInstCoords) {
    for (const s of subnodePoints) {
      instDevices.push({ path: stripPin(s.name, data.delimiter), x: s.x as number, y: s.y as number });
    }
  }
  data.devices = instDevices;
  diag.devices = instDevices.length;

  const scale = opts.unitScale ?? inferUnitScale(data);
  if (scale !== 1) applyScale(data, scale);
  diag.unitScale = scale;

  // Honest signal: an RC-only extraction (no X/Y anywhere) can't be drawn.
  if (diag.pointsWithCoords === 0 && (diag.nets > 0 || diag.devices > 0)) {
    diag.warnings.push('This DSPF carries no coordinates — the physical map cannot be built (RC-only extraction).');
  }

  data.layerMap = Object.fromEntries(layerMap);
  data.layers = [...layerSet];
  data.layersPresent = data.layers.length > 0;
  return data;
}

function inferUnitScale(data: LayoutData): number {
  let maxAbs = 0;
  const consider = (x: number | null, y: number | null) => {
    if (x !== null) maxAbs = Math.max(maxAbs, Math.abs(x));
    if (y !== null) maxAbs = Math.max(maxAbs, Math.abs(y));
  };
  for (const n of data.nets) {
    for (const p of n.ports) consider(p.x, p.y);
    for (const p of n.subnodes) consider(p.x, p.y);
    for (const p of n.instPins) consider(p.x, p.y);
    for (const r of n.resistors) { consider(r.x1, r.y1); consider(r.x2, r.y2); }
    for (const cp of n.capacitors) consider(cp.x, cp.y);
  }
  for (const d of data.devices) consider(d.x, d.y);
  return maxAbs > 0 && maxAbs < 1e-3 ? 1e6 : 1;
}

function applyScale(data: LayoutData, s: number): void {
  const sp = (p: DspfPoint) => { if (p.x !== null) p.x *= s; if (p.y !== null) p.y *= s; };
  for (const n of data.nets) {
    n.ports.forEach(sp); n.subnodes.forEach(sp); n.instPins.forEach(sp);
    for (const r of n.resistors) {
      if (r.x1 !== null) r.x1 *= s; if (r.y1 !== null) r.y1 *= s;
      if (r.x2 !== null) r.x2 *= s; if (r.y2 !== null) r.y2 *= s;
    }
    for (const cp of n.capacitors) { if (cp.x !== null) cp.x *= s; if (cp.y !== null) cp.y *= s; }
  }
  for (const d of data.devices) { d.x *= s; d.y *= s; }
}
