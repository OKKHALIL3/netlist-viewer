import type {
  LayoutData, DspfNet, DspfPoint, DspfPort, DspfInstPin,
  DspfDevicePoint, DspfDeviceInfo, DspfDiagnostics,
} from '../model';
import { forEachLogicalLine } from './lines';
import { splitTokens, parseParenPayload, type ParenInfo } from './tokens';
import { parseResistor, parseCapacitor, type ResolveLayer } from './elements';
import { parseSpiceNumber, isNumericToken } from './units';

export interface ParseDspfOptions { unitScale?: number }

function freshDiagnostics(): DspfDiagnostics {
  return {
    logicalLines: 0, nets: 0, netsMerged: 0,
    devices: 0, devicePinPoints: 0,
    resistors: 0, resistorsWithGeometry: 0, capacitors: 0, couplingCaps: 0,
    ports: 0, instPins: 0, subnodes: 0,
    pointsWithCoords: 0, unitScale: 1, unrecognized: 0, warnings: [],
  };
}

function stripPin(name: string, delimiter: string): string {
  const cut = name.lastIndexOf(delimiter);
  return cut > 0 ? name.slice(0, cut) : name;
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');

// The positional fields between a paren payload's name and its trailing
// coordinates (e.g. *|I's "instName pin pinType cap"). Coordinates consumed
// two tokens only when they came positionally (not from $x/$y params).
function midFields(info: ParenInfo): string[] {
  const posCoords = info.x !== null && !info.params.has('x');
  return info.rest.slice(1, info.rest.length - (posCoords ? 2 : 0));
}

function numOrNull(tok: string | undefined): number | null {
  if (tok === undefined) return null;
  const v = parseSpiceNumber(tok);
  return Number.isFinite(v) ? v : null;
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
    divider: '/', delimiter: ':', busDelimiter: null, fingerDelim: null,
    groundNets: [], design: null, generator: null,
    topCellName: null, topPorts: [],
    layerMap: {}, layersPresent: false, layers: [],
    nets: [], devicePoints: [], devices: [],
    nodeCoord: new Map(), diagnostics: diag,
  };
  const layerSet = new Set<string>();
  const netByName = new Map<string, DspfNet>();
  const groundSet = new Set<string>();
  const uniqueDevices = new Map<string, DspfDeviceInfo>();
  let net: DspfNet | null = null;
  let sawInstCoords = false;
  const subnodeFallback: DspfDevicePoint[] = [];
  const devicePoints: DspfDevicePoint[] = [];

  const addLayer = (l: string | null) => { if (l) layerSet.add(l); };
  const recordCoord = (name: string, x: number | null, y: number | null) => {
    if (x === null || y === null) return;
    diag.pointsWithCoords++;
    if (!data.nodeCoord.has(name)) data.nodeCoord.set(name, [x, y]);
  };

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
        case '*|BUS_DELIMITER': data.busDelimiter = unquote(rest.split(/\s+/)[0] ?? '') || null; break;
        case '*|DEVICEFINGERDELIM': data.fingerDelim = unquote(rest.trim()) || null; break;
        case '*|GROUND_NET':
          for (const g of rest.split(/\s+/).filter(Boolean)) {
            const name = unquote(g);
            if (!groundSet.has(name)) { groundSet.add(name); data.groundNets.push(name); }
          }
          break;
        case '*|DESIGN': data.design = unquote(rest) || null; break;
        case '*|DSPF':
        case '*|PROGRAM':
        case '*|VERSION': data.generator = (data.generator ? data.generator + ' ' : '') + unquote(rest); break;
        case '*|DATE':
        case '*|VENDOR':
        case '*|GLOBAL_TEMPERATURE':
        case '*|OPERATING_TEMPERATURE':
          break; // recognized; nothing the viewer needs
        case '*|NET': {
          const tok = rest.split(/\s+/);
          const name = unquote(tok[0] ?? '');
          const cap = tok[1] !== undefined ? parseSpiceNumber(tok[1]) : NaN;
          const existing = netByName.get(name);
          if (existing) {
            // Extractors may re-open a net section (or declare a ground net
            // before its section) — merge rather than duplicate.
            if (existing.totalCap === null && Number.isFinite(cap)) existing.totalCap = cap;
            net = existing;
            diag.netsMerged++;
          } else {
            net = {
              name, totalCap: Number.isFinite(cap) ? cap : null,
              isGround: groundSet.has(name),
              ports: [], subnodes: [], instPins: [], resistors: [], capacitors: [],
            };
            netByName.set(name, net);
            data.nets.push(net);
            diag.nets++;
          }
          break;
        }
        case '*|P': {
          const info = parseParenPayload(rest);
          if (info && net) {
            const f = midFields(info);
            const port: DspfPort = {
              name: info.name,
              pinType: f[0] !== undefined && !isNumericToken(f[0]) ? f[0] : null,
              cap: numOrNull(f[0] !== undefined && !isNumericToken(f[0]) ? f[1] : f[0]),
              x: info.x, y: info.y, layer: resolveLayer(info.params),
            };
            net.ports.push(port);
            diag.ports++;
            recordCoord(port.name, port.x, port.y);
            addLayer(port.layer);
          }
          break;
        }
        case '*|S': {
          const info = parseParenPayload(rest);
          if (info && net) {
            const pt: DspfPoint = { name: info.name, x: info.x, y: info.y, layer: resolveLayer(info.params) };
            net.subnodes.push(pt);
            diag.subnodes++;
            recordCoord(pt.name, pt.x, pt.y);
            addLayer(pt.layer);
            if (pt.x !== null && pt.y !== null) {
              subnodeFallback.push({ path: stripPin(pt.name, data.delimiter), x: pt.x, y: pt.y });
            }
          }
          break;
        }
        case '*|I': {
          const info = parseParenPayload(rest);
          if (info) {
            const f = midFields(info);
            const inst = f[0] ?? stripPin(info.name, data.delimiter);
            const pin: DspfInstPin = {
              name: info.name, inst,
              pin: f[1] ?? '', pinType: f[2] ?? null, cap: numOrNull(f[3]),
              x: info.x, y: info.y, layer: resolveLayer(info.params),
            };
            if (net) net.instPins.push(pin);
            diag.instPins++;
            recordCoord(pin.name, pin.x, pin.y);
            addLayer(pin.layer);
            const known = uniqueDevices.get(inst);
            if (known) known.pins++;
            else uniqueDevices.set(inst, { path: inst, model: null, pins: 1 });
            if (pin.x !== null && pin.y !== null) {
              sawInstCoords = true;
              devicePoints.push({ path: inst, x: pin.x, y: pin.y });
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
      return; // plain comment ("*Net Section", "*Instance Section", …)
    }

    const head = line[0];
    if (head === '.') {
      // .SUBCKT carries the extracted cell's name and port order; other dot
      // cards (.ENDS/.END/.PARAM/.GLOBAL) add nothing to the abstract map.
      const tok = splitTokens(line);
      if (tok[0].toUpperCase() === '.SUBCKT' && data.topCellName === null) {
        data.topCellName = tok[1] ?? null;
        data.topPorts = tok.slice(2);
      }
      return;
    }

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
    // other letters: device instance statements — handled in the instance
    // section pass (parseDeviceStatement); nothing to do for the map yet
  });

  // Ground nets declared but never sectioned still deserve a record (the
  // inspector lists them); sectioned ones get flagged.
  for (const g of data.groundNets) {
    const existing = netByName.get(g);
    if (existing) { existing.isGround = true; continue; }
    const ghost: DspfNet = {
      name: g, totalCap: null, isGround: true,
      ports: [], subnodes: [], instPins: [], resistors: [], capacitors: [],
    };
    netByName.set(g, ghost);
    data.nets.push(ghost);
    diag.nets++;
  }

  // CLKGEN fallback: *|I carried no coords anywhere → derive coordinate
  // samples from *|S names (net-node paths still prefix-match the blocks).
  data.devicePoints = sawInstCoords ? devicePoints : subnodeFallback;
  data.devices = [...uniqueDevices.values()];
  diag.devices = data.devices.length;
  diag.devicePinPoints = data.devicePoints.length;

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
  for (const d of data.devicePoints) consider(d.x, d.y);
  return maxAbs > 0 && maxAbs < 1e-3 ? 1e6 : 1;
}

function applyScale(data: LayoutData, s: number): void {
  const sp = (p: { x: number | null; y: number | null }) => {
    if (p.x !== null) p.x *= s;
    if (p.y !== null) p.y *= s;
  };
  for (const n of data.nets) {
    n.ports.forEach(sp); n.subnodes.forEach(sp); n.instPins.forEach(sp);
    for (const r of n.resistors) {
      if (r.x1 !== null) r.x1 *= s; if (r.y1 !== null) r.y1 *= s;
      if (r.x2 !== null) r.x2 *= s; if (r.y2 !== null) r.y2 *= s;
    }
    for (const cp of n.capacitors) { if (cp.x !== null) cp.x *= s; if (cp.y !== null) cp.y *= s; }
  }
  for (const d of data.devicePoints) { d.x *= s; d.y *= s; }
  for (const [name, [x, y]] of data.nodeCoord) data.nodeCoord.set(name, [x * s, y * s]);
}
