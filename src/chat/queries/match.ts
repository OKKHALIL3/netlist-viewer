import type { SearchResult } from '../../search/searchIndex';

// Design-wide name matching shared by the search palette and the chat
// resolver. Pins only match on their own name — their detail carries the
// connected net name, and matching that too would flood results with every
// pin tied to a common net (e.g. "vdd!") whenever that net is searched.
// Rank: exact id > id prefix > id substring > detail-only; stable sort keeps
// document order within a tier.
export function matchIndex(index: SearchResult[], query: string, limit?: number): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = index.filter(
    r => r.id.toLowerCase().includes(q) || (r.kind !== 'pin' && r.detail.toLowerCase().includes(q)),
  );
  const rankOf = (r: SearchResult): number => {
    const id = r.id.toLowerCase();
    return id === q ? 0 : id.startsWith(q) ? 1 : id.includes(q) ? 2 : 3;
  };
  matches.sort((a, b) => rankOf(a) - rankOf(b));
  return limit !== undefined ? matches.slice(0, limit) : matches;
}
