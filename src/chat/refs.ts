// Typed citations linking chat prose to viewer elements. The model (and the
// basic parser's templates) embed inline markers like [[block:XTOP/XPLL]] in
// answer text; the panel parses them into clickable chips. Anything that
// fails to parse stays literal text — a bad marker must never crash a turn.

export type Ref =
  | { kind: 'cell'; cell: string }
  | { kind: 'block'; path: string }
  | { kind: 'net'; net: string; scope?: string }
  | { kind: 'device'; cell: string; id: string };

export function formatRef(r: Ref): string {
  switch (r.kind) {
    case 'cell': return `[[cell:${r.cell}]]`;
    case 'block': return `[[block:${r.path}]]`;
    case 'net': return r.scope !== undefined ? `[[net:${r.scope}|${r.net}]]` : `[[net:${r.net}]]`;
    case 'device': return `[[device:${r.cell}/${r.id}]]`;
  }
}

export function refKey(r: Ref): string {
  switch (r.kind) {
    case 'cell': return `cell:${r.cell}`;
    case 'block': return `block:${r.path}`;
    case 'net': return `net:${r.scope ?? ''}|${r.net}`;
    case 'device': return `device:${r.cell}/${r.id}`;
  }
}

export function refLabel(r: Ref): string {
  switch (r.kind) {
    case 'cell': return r.cell;
    case 'block': return r.path.split('/').pop() || r.path;
    case 'net': return r.net;
    case 'device': return r.id;
  }
}

function parsePayload(kind: string, payload: string): Ref | null {
  if (!payload) return null;
  switch (kind) {
    case 'cell': return { kind: 'cell', cell: payload };
    case 'block': return { kind: 'block', path: payload };
    case 'net': {
      const bar = payload.indexOf('|');
      if (bar < 0) return { kind: 'net', net: payload };
      const net = payload.slice(bar + 1);
      if (!net) return null;
      return { kind: 'net', net, scope: payload.slice(0, bar) };
    }
    case 'device': {
      const slash = payload.indexOf('/');
      if (slash <= 0 || slash === payload.length - 1) return null;
      return { kind: 'device', cell: payload.slice(0, slash), id: payload.slice(slash + 1) };
    }
    default: return null;
  }
}

const MARKER_RE = /\[\[(\w+):([^\]]+)\]\]/g;

// Split prose into plain-text runs and Refs, in document order.
export function parseMarkers(text: string): Array<string | Ref> {
  const out: Array<string | Ref> = [];
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    const ref = parsePayload(m[1], m[2]);
    if (!ref) continue; // unknown kind / bad payload: leave it inside the surrounding text
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(ref);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
