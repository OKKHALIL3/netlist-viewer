import type { Port } from '../parser/types';

const BUS_SUFFIX_RE = /^(.*?)(?:<(\d+)>|\[(\d+)\])$/;

export interface BusSuffix {
  base: string;
  index: number;
  brackets: '<>' | '[]';
}

export function parseBusSuffix(name: string): BusSuffix | null {
  const m = BUS_SUFFIX_RE.exec(name);
  if (!m) return null;
  return {
    base: m[1],
    index: Number(m[2] ?? m[3]),
    brackets: m[2] !== undefined ? '<>' : '[]',
  };
}

export function busLabel(base: string, brackets: '<>' | '[]', indices: number[]): string {
  const [open, close] = brackets === '<>' ? ['<', '>'] : ['[', ']'];
  if (indices.length === 0) return base;
  // Fold, don't spread: Math.min(...indices) throws RangeError (stack overflow)
  // on a very large scalarized array (a big SRAM/word array).
  let lo = indices[0], hi = indices[0];
  for (let k = 1; k < indices.length; k++) {
    const v = indices[k];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === hi ? `${base}${open}${lo}${close}` : `${base}${open}${hi}:${lo}${close}`;
}

const BUS_LABEL_RE = /^(.*?)(?:<(\d+)(?::(\d+))?>|\[(\d+)(?::(\d+))?\])$/;

export function netInBusLabel(net: string, label: string): boolean {
  const m = parseBusSuffix(net);
  if (!m) return false;
  const lm = BUS_LABEL_RE.exec(label);
  if (!lm) return false;
  const angle = lm[2] !== undefined;
  const base = lm[1];
  const a = Number(lm[2] ?? lm[4]);
  const b = lm[3] ?? lm[5];
  const hi = b !== undefined ? Math.max(a, Number(b)) : a;
  const lo = b !== undefined ? Math.min(a, Number(b)) : a;
  return m.base === base && m.brackets === (angle ? '<>' : '[]') && m.index >= lo && m.index <= hi;
}

const MIN_BUS_SIZE = 2;

export interface PinRow {
  pins: string[];
  nets: string[];
  pinLabel: string;
  netLabel: string;
  repPin: string;
  isBus: boolean;
}

export function groupPinConnections(conn: Array<[string, string]>): PinRow[] {
  const rows: PinRow[] = [];
  let i = 0;
  while (i < conn.length) {
    const [pin0, net0] = conn[i];
    const pb0 = parseBusSuffix(pin0);
    const nb0 = parseBusSuffix(net0);

    if (pb0 && nb0) {
      let j = i + 1;
      let dir = 0;
      let prevP = pb0;
      let prevN = nb0;
      while (j < conn.length) {
        const [pinJ, netJ] = conn[j];
        const pb = parseBusSuffix(pinJ);
        const nb = parseBusSuffix(netJ);
        if (!pb || !nb || pb.base !== pb0.base || pb.brackets !== pb0.brackets ||
            nb.base !== nb0.base || nb.brackets !== nb0.brackets) break;
        const pStep = pb.index - prevP.index;
        const nStep = nb.index - prevN.index;
        if (pStep !== nStep || (pStep !== 1 && pStep !== -1)) break;
        if (dir === 0) dir = pStep;
        else if (pStep !== dir) break;
        prevP = pb;
        prevN = nb;
        j++;
      }
      const runLen = j - i;
      if (runLen >= MIN_BUS_SIZE) {
        const pins = conn.slice(i, j).map(c => c[0]);
        const nets = conn.slice(i, j).map(c => c[1]);
        rows.push({
          pins,
          nets,
          pinLabel: busLabel(pb0.base, pb0.brackets, pins.map(p => parseBusSuffix(p)!.index)),
          netLabel: busLabel(nb0.base, nb0.brackets, nets.map(n => parseBusSuffix(n)!.index)),
          repPin: pins[0],
          isBus: true,
        });
        i = j;
        continue;
      }
    }

    rows.push({ pins: [pin0], nets: [net0], pinLabel: pin0, netLabel: net0, repPin: pin0, isBus: false });
    i++;
  }
  return rows;
}

export interface Ribbon<T> {
  label: string;
  members: T[];
}

export function clusterBusRibbons<T>(items: T[], nameOf: (item: T) => string): Ribbon<T>[] {
  const groups = new Map<string, { base: string; brackets: '<>' | '[]'; entries: Array<{ item: T; index: number }> }>();
  const ribbons: Ribbon<T>[] = [];

  for (const item of items) {
    const name = nameOf(item);
    const parsed = parseBusSuffix(name);
    if (!parsed) {
      ribbons.push({ label: name, members: [item] });
      continue;
    }
    const key = `${parsed.base}|${parsed.brackets}`;
    let group = groups.get(key);
    if (!group) {
      group = { base: parsed.base, brackets: parsed.brackets, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ item, index: parsed.index });
  }

  for (const group of groups.values()) {
    const sorted = [...group.entries].sort((a, b) => a.index - b.index);
    let run: typeof sorted = [];
    const flush = () => {
      if (run.length === 0) return;
      if (run.length >= MIN_BUS_SIZE) {
        ribbons.push({ label: busLabel(group.base, group.brackets, run.map(e => e.index)), members: run.map(e => e.item) });
      } else {
        for (const e of run) ribbons.push({ label: nameOf(e.item), members: [e.item] });
      }
      run = [];
    };
    for (const entry of sorted) {
      if (run.length > 0 && entry.index !== run[run.length - 1].index + 1) flush();
      run.push(entry);
    }
    flush();
  }

  return ribbons;
}

export interface PortGroup {
  repName: string;
  names: string[];
  label: string;
  dir: Port['dir'];
  isBus: boolean;
}

export function groupPorts(ports: Port[]): PortGroup[] {
  return clusterBusRibbons(ports, p => p.name).map(r => ({
    repName: r.members[0].name,
    names: r.members.map(m => m.name),
    label: r.label,
    dir: r.members[0].dir,
    isBus: r.members.length > 1,
  }));
}
