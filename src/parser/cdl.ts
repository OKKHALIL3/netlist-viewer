import type { Cell, Design, Net, Port } from './types';

// ── Model-name heuristics ──────────────────────────────────────────────────
//
// For X* instances, only classify as pseudo-device for R or C.
// Transistors always appear as native M* lines in CDL; X* instances that
// happen to have "_mac" in their cell name (e.g. trans_18_mac_pcell_…)
// must NOT be treated as primitives — they are real sub-circuit instances.

const R_MODEL_X = /^(rhim|rpoly|rp_|rn_|rpo|rnw|poly_r|res_)/i;
const C_MODEL_X = /^(mim|mom|cfmom|crtmom|cpo_)/i;


function inferXKind(master: string): 'R' | 'C' | null {
  if (R_MODEL_X.test(master)) return 'R';
  if (C_MODEL_X.test(master)) return 'C';
  return null;
}

// ── Net classification ─────────────────────────────────────────────────────

const PWR_RE = /^(vcc|vdd|vddio|vccio|vccpst|vcco|vddo|dvdd|avdd|pvdd|iovdd)/i;
const GND_RE = /^(vss|gnd|vssio|vsso|agnd|dgnd|pgnd|iovss|avss)/i;

function netKind(name: string): Net['kind'] {
  if (PWR_RE.test(name)) return 'power';
  if (GND_RE.test(name)) return 'ground';
  return 'signal';
}

// ── Bus detection ──────────────────────────────────────────────────────────

const BUS_RE = /^(.*?)(?:<(\d+)>|\[(\d+)\])$/;

function parseBusId(id: string): { base: string; index: number } | null {
  const m = id.match(BUS_RE);
  if (!m) return null;
  return { base: m[1], index: parseInt(m[2] ?? m[3]) };
}

// ── Param parsing ──────────────────────────────────────────────────────────

function parseParams(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq !== -1) out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

// ── Instance line parsing ──────────────────────────────────────────────────
//
// Two forms:
//   Slash:    Xinst net1 net2 … /\n+ MASTER [params…]
//   No-slash: Xinst net1 net2 … MASTER [params…]
//
// After continuation-line joining the full token list is passed here.

function parseXLine(
  tokens: string[],
): { id: string; nets: string[]; master: string; params: Record<string, string> } {
  const id = tokens[0];
  const rest = tokens.slice(1);

  const slashIdx = rest.indexOf('/');
  if (slashIdx !== -1) {
    const nets = rest.slice(0, slashIdx);
    const afterSlash = rest.slice(slashIdx + 1);
    const master = afterSlash[0] ?? '';
    const params = parseParams(afterSlash.slice(1));
    return { id, nets, master, params };
  }

  // No-slash: scan from end; param tokens contain '='
  let i = rest.length - 1;
  while (i >= 0 && rest[i].includes('=')) i--;
  const master = rest[i] ?? '';
  const nets = rest.slice(0, i);
  const params = parseParams(rest.slice(i + 1));
  return { id, nets, master, params };
}

// ── PININFO comment parsing ────────────────────────────────────────────────
// *.PININFO A:I B:O C:B (possibly multi-line, pre-joined)

function parsePinInfo(line: string): Port[] {
  const parts = line.replace(/^\*\.PININFO\s+/i, '').trim().split(/\s+/);
  return parts.map(p => {
    const [name, dir] = p.split(':');
    return { name, dir: (dir as Port['dir']) ?? null };
  });
}

// ── Main parser ────────────────────────────────────────────────────────────

export function parseCDL(text: string): Design {
  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Join continuation lines (+)
  const logical: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('+') && logical.length > 0) {
      logical[logical.length - 1] += ' ' + trimmed.slice(1).trim();
    } else {
      logical.push(trimmed);
    }
  }

  const cells = new Map<string, Cell>();
  const warnings: string[] = [];
  let headerTopCell = '';   // from "* Top Cell Name: X" header comment

  let current: Cell | null = null;
  let pendingPinInfo: Port[] | null = null;

  for (let lineNo = 0; lineNo < logical.length; lineNo++) {
    const line = logical[lineNo];
    if (!line) continue;

    // Parse "Top Cell Name:" from CDL header comment
    if (!current && line.startsWith('*')) {
      const tcMatch = line.match(/Top Cell Name:\s*(\S+)/i);
      if (tcMatch) headerTopCell = tcMatch[1];
    }

    if (line.startsWith('*') && !line.toUpperCase().startsWith('*.PININFO')) continue;

    // PININFO comment
    if (line.toUpperCase().startsWith('*.PININFO')) {
      pendingPinInfo = parsePinInfo(line);
      if (current && pendingPinInfo.length > 0) {
        current.ports = pendingPinInfo;
        pendingPinInfo = null;
      }
      continue;
    }

    // Skip other * comment lines
    if (line.startsWith('*') || line.startsWith('$')) continue;

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const kw = tokens[0].toUpperCase();

    // .SUBCKT / .subckt
    if (kw === '.SUBCKT') {
      const name = tokens[1];
      const ports: Port[] = tokens.slice(2).map(p => ({ name: p, dir: null }));
      current = { name, ports, instances: [], primitives: [], nets: [] };
      cells.set(name, current);
      if (pendingPinInfo) {
        current.ports = pendingPinInfo;
        pendingPinInfo = null;
      }
      continue;
    }

    // .ENDS
    if (kw === '.ENDS') {
      current = null;
      continue;
    }

    if (!current) continue;

    const first = tokens[0][0].toUpperCase();

    // MOSFET: M* — 4 terminals (D G S B) + model + params
    if (first === 'M') {
      if (tokens.length < 6) { warnings.push(`L${lineNo}: short M line: ${line}`); continue; }
      const [id, d, g, s, b, model, ...rest] = tokens;
      const terms: Array<[string, string]> = [['d', d], ['g', g], ['s', s], ['b', b]];
      current.primitives.push({ id, kind: 'M', model, terms, params: parseParams(rest) });
      continue;
    }

    // Native capacitor: C*
    if (first === 'C') {
      const [id, n1, n2, , model, ...rest] = tokens;
      const terms: Array<[string, string]> = [['p', n1], ['n', n2]];
      current.primitives.push({ id, kind: 'C', model: model ?? 'cap', terms, params: parseParams(rest) });
      continue;
    }

    // Native resistor: R*
    if (first === 'R') {
      const [id, n1, n2, , model, ...rest] = tokens;
      const terms: Array<[string, string]> = [['p', n1], ['n', n2]];
      current.primitives.push({ id, kind: 'R', model: model ?? 'res', terms, params: parseParams(rest) });
      continue;
    }

    // Sub-circuit instance: X*
    if (first === 'X') {
      const { id, nets: portMap, master, params } = parseXLine(tokens);
      if (!master) { warnings.push(`L${lineNo}: no master for ${id}`); continue; }

      // Only classify as pseudo-device for clear R/C model names (never M for X* lines —
      // transistors always appear as native M* in CDL; cell names with "_mac" are not models)
      const xKind = inferXKind(master);
      if (xKind === 'R' || xKind === 'C') {
        const terms: Array<[string, string]> = portMap.slice(0, 3).map((n, i) => {
          return (['a', 'b', 'c'] as const)[i] !== undefined
            ? [(['a', 'b', 'c'] as const)[i], n] as [string, string]
            : ['x', n] as [string, string];
        });
        current.primitives.push({ id, kind: xKind, model: master, terms, params });
        continue;
      }

      const busInfo = parseBusId(id);
      current.instances.push({
        id,
        master,
        conn: {},        // resolved in second pass
        portMap,
        busBase: busInfo?.base,
        busIndex: busInfo?.index,
      });
      continue;
    }

    // Skip .PARAM, .INCLUDE, .GLOBAL, .MODEL, .EQUATION, etc.
  }

  // ── Second pass: resolve conn mappings ───────────────────────────────────

  for (const cell of cells.values()) {
    for (const inst of cell.instances) {
      const masterCell = cells.get(inst.master);
      if (masterCell) {
        masterCell.ports.forEach((port, i) => {
          inst.conn[port.name] = inst.portMap[i] ?? '';
        });
      } else {
        // External master: use positional keys
        inst.portMap.forEach((net, i) => {
          inst.conn[`p${i}`] = net;
        });
      }
    }
  }

  // ── Build net lists per cell ─────────────────────────────────────────────

  for (const cell of cells.values()) {
    const netMap = new Map<string, Net>();

    const addEndpoint = (netName: string, nodeId: string, pin: string) => {
      if (!netName) return;
      let net = netMap.get(netName);
      if (!net) {
        net = { name: netName, kind: netKind(netName), endpoints: [] };
        netMap.set(netName, net);
      }
      net.endpoints.push([nodeId, pin]);
    };

    // Cell ports as endpoints (pseudo-node '__port__')
    cell.ports.forEach(p => addEndpoint(p.name, '__port__', p.name));

    // Instance connections
    for (const inst of cell.instances) {
      for (const [pin, net] of Object.entries(inst.conn)) {
        addEndpoint(net, inst.id, pin);
      }
    }

    // Primitive terminals
    for (const prim of cell.primitives) {
      for (const [pin, net] of prim.terms) {
        addEndpoint(net, prim.id, pin);
      }
    }

    cell.nets = [...netMap.values()].filter(n => n.endpoints.length >= 1);
  }

  // ── Find top cell ────────────────────────────────────────────────────────
  // Priority: 1) CDL header "Top Cell Name:" comment
  //           2) Last cell defined with no instances referencing it
  //           3) Last cell defined

  let topCell = headerTopCell && cells.has(headerTopCell) ? headerTopCell : '';

  if (!topCell) {
    const referenced = new Set<string>();
    for (const cell of cells.values()) {
      for (const inst of cell.instances) referenced.add(inst.master);
    }
    // Use the LAST unreferenced cell (CDL files are bottom-up, top cell comes last)
    for (const name of [...cells.keys()].reverse()) {
      if (!referenced.has(name)) { topCell = name; break; }
    }
  }

  if (!topCell && cells.size > 0) topCell = [...cells.keys()].at(-1)!;

  return { cells, topCell, warnings };
}
