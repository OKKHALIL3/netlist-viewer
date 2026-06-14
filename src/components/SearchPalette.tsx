import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerStore, type SelectionType } from '../store/viewerStore';
import { buildSearchIndex, findPath, type SearchResult } from '../search/searchIndex';
import type { Design } from '../parser/types';

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  instance: 'Instance',
  primitive: 'Primitive',
  net: 'Net',
  cell: 'Cell',
  pin: 'Pin',
};

const MAX_RESULTS = 40;

// Mounted only while open (see SearchPalette below), so its local state
// starts fresh every time the palette is opened — no reset effect needed.
function SearchModal({ design, onClose }: { design: Design; onClose: () => void }) {
  const { goToPath, setFocusNet } = useViewerStore();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildSearchIndex(design), [design]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index
      // Pins only match on their own name — their detail carries the
      // connected net name, and matching that too would flood results with
      // every pin tied to a common net (e.g. "vdd!") whenever that net is searched.
      .filter(r => r.id.toLowerCase().includes(q) || (r.kind !== 'pin' && r.detail.toLowerCase().includes(q)))
      .slice(0, MAX_RESULTS);
  }, [index, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted result in view when navigating with arrow keys.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIdx(0);
  };

  const select = (result: SearchResult) => {
    const targetCell = result.kind === 'cell' ? result.id : result.cellName;
    const path = findPath(design, targetCell);
    if (!path) return;
    // A pin result jumps to the specific instance/primitive that owns it
    // (so two matches of the same pin name, e.g. on X9 and X10, land on
    // distinct targets) and focuses its net so the matched pin row is
    // highlighted there, rather than highlighting every node on that net.
    const selection: SelectionType | null =
      result.kind === 'instance' ? { type: 'instance', id: result.id } :
      result.kind === 'primitive' ? { type: 'primitive', id: result.id } :
      result.kind === 'net' ? { type: 'net', name: result.id } :
      result.kind === 'pin'
        ? (result.ownerKind === 'primitive' ? { type: 'primitive', id: result.ownerId! } : { type: 'instance', id: result.ownerId! })
        : null;
    goToPath(path, selection);
    if (result.kind === 'pin' && result.netName) setFocusNet(result.netName);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) select(r);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search instances, nets, primitives, and cells across the whole design…"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="search-results">
          {query.trim() === '' && (
            <div className="search-hint">Type to search · ↑↓ to navigate · Enter to jump · Esc to close</div>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <div className="search-hint">No matches</div>
          )}
          {results.map((r, i) => (
            <div
              key={`${r.kind}:${r.cellName}:${r.id}:${i}`}
              ref={i === activeIdx ? activeRef : undefined}
              className={`search-result${i === activeIdx ? ' active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => select(r)}
            >
              <span className={`search-kind kind-${r.kind}`}>{KIND_LABELS[r.kind]}</span>
              <span className="search-id">{r.id}</span>
              <span className="search-detail">{r.detail}</span>
              <span className="search-loc">in {r.cellName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SearchPalette() {
  const { design, searchOpen, setSearchOpen } = useViewerStore();

  // "/" or Cmd/Ctrl+K opens the palette from anywhere (standard search shortcuts).
  useEffect(() => {
    if (!design) return;
    const handler = (e: KeyboardEvent) => {
      const isSlash = e.key === '/';
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isSlash || isCmdK) {
        const tag = (e.target as HTMLElement).tagName;
        if (isSlash && (tag === 'INPUT' || tag === 'TEXTAREA')) return;
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [design, setSearchOpen]);

  if (!design || !searchOpen) return null;

  return <SearchModal design={design} onClose={() => setSearchOpen(false)} />;
}
