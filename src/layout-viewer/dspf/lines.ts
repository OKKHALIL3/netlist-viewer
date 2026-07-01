// Reassemble DSPF physical lines into logical lines:
//  - a line whose (leading-trimmed) content starts with '+' continues the previous one
//  - a line ending with '\' continues onto the next
// Continuation joins collapse to a single space; blank lines are ignored;
// each emitted logical line is trimmed.
// `onProgress` (0..1, by raw-line position) fires every ~64k raw lines so a
// 22 MB parse can report itself without measurable overhead.
export function forEachLogicalLine(
  text: string,
  cb: (line: string) => void,
  onProgress?: (frac: number) => void,
): void {
  const raw = text.split(/\r?\n/);
  let cur = '';
  let have = false;
  const flush = () => { if (have && cur.trim()) cb(cur.trim()); have = false; cur = ''; };
  for (let i = 0; i < raw.length; i++) {
    if (onProgress && (i & 0xffff) === 0 && i > 0) onProgress(i / raw.length);
    const line = raw[i].replace(/\s+$/, '');
    const lead = line.replace(/^\s+/, '');
    if (lead === '') continue;
    if (lead.startsWith('+')) {
      const cont = lead.slice(1).trim();
      if (have) {
        if (cur.endsWith('\\')) cur = cur.slice(0, -1);
        cur = cur.replace(/\s+$/, '') + (cont ? ' ' + cont : '');
      } else { cur = cont; have = true; }
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
