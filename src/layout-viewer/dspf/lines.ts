// Reassemble DSPF physical lines into logical lines:
//  - a line whose (leading-trimmed) content starts with '+' continues the previous one
//  - a line ending with '\' continues onto the next
// Blank logical lines are dropped; trailing whitespace is removed.
export function forEachLogicalLine(text: string, cb: (line: string) => void): void {
  const raw = text.split(/\r?\n/);
  let cur = '';
  let have = false;
  const flush = () => { if (have && cur.trim()) cb(cur); have = false; cur = ''; };
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].replace(/\s+$/, '');
    const lead = line.replace(/^\s+/, '');
    if (lead.startsWith('+')) {
      if (have) {
        if (cur.endsWith('\\')) cur = cur.slice(0, -1);
        cur += ' ' + lead.slice(1).trim();
      } else { cur = lead.slice(1).trim(); have = true; }
      continue;
    }
    if (have && cur.endsWith('\\')) {
      cur = cur.slice(0, -1).replace(/\s+$/, '') + ' ' + lead.trim();
      continue;
    }
    flush();
    cur = line; have = true;
  }
  flush();
}

export function toLogicalLines(text: string): string[] {
  const out: string[] = [];
  forEachLogicalLine(text, (l) => out.push(l));
  return out;
}
