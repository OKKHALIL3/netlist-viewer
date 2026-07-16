import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerStore, type SelectionType, type BreadcrumbEntry } from '../store/viewerStore';
import { useHybridStore } from '../store/hybridStore';
import { buildSearchIndex, buildOccurrenceCounts, pathsToCell, type SearchResult } from '../search/searchIndex';
import { matchIndex } from '../chat/queries/match';
import type { Design } from '../parser/types';

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  instance: 'Instance',
  primitive: 'Primitive',
  net: 'Net',
  cell: 'Cell',
  pin: 'Pin',
};

const MAX_RESULTS = 40; // total clickable occurrence rows
const MAX_OCC = 8; // occurrences shown per matched item before "+N more"

// A clickable occurrence (a match reached via one instantiation path), or a
// muted "+N more" note tail for items reused more than MAX_OCC times.
type OccRow = { type: 'occ'; result: SearchResult; path: BreadcrumbEntry[]; loc: string; clickIdx: number };
type MoreRow = { type: 'more'; key: string; count: number };
type Row = OccRow | MoreRow;

// Instantiation path as a short "XI9 / XI26" trail (instance labels below the
// top), so the same item reached via different parents is distinguishable. Keeps
// the first and last instance when long (the top-level instance is usually what
// differs between occurrences); the full path is in the row's title.
function locLabel(path: BreadcrumbEntry[]): string {
  if (path.length <= 1) return path[0]?.label ?? '';
  const labels = path.slice(1).map(p => p.label);
  return (labels.length > 3 ? [labels[0], '…', labels[labels.length - 1]] : labels).join(' / ');
}

function fullLoc(path: BreadcrumbEntry[]): string {
  return path.map(p => p.label).join(' / ');
}

// Mounted only while open (see SearchPalette below), so its local state
// starts fresh every time the palette is opened — no reset effect needed.
function SearchModal({ design, onClose }: { design: Design; onClose: () => void }) {
  const { goToPath, setFocusNet, appMode } = useViewerStore();
  const hybridJump = useHybridStore(s => s.jumpTo);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildSearchIndex(design), [design]);
  const occCounts = useMemo(() => buildOccurrenceCounts(design), [design]);

  // Each matched item is expanded into one row per instantiation path (so an
  // item inside a reused cell is found once per occurrence), capped at MAX_OCC
  // with a "+N more" tail. `clickable` is the keyboard-navigable subset.
  const { rows, clickable } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: Row[] = [];
    const clickable: OccRow[] = [];
    if (!q) return { rows, clickable };

    // Matching + ranking shared with the chat resolver (queries/match.ts):
    // ranked before the result cap so an exact or prefix id match is never
    // pushed off the end by earlier substring hits.
    const matches = matchIndex(index, q);

    for (const r of matches) {
      if (clickable.length >= MAX_RESULTS) break;
      const targetCell = r.kind === 'cell' ? r.id : r.cellName;
      const { paths, total } = pathsToCell(design, targetCell, MAX_OCC, occCounts);
      for (const path of paths) {
        if (clickable.length >= MAX_RESULTS) break;
        const occ: OccRow = { type: 'occ', result: r, path, loc: locLabel(path), clickIdx: clickable.length };
        rows.push(occ);
        clickable.push(occ);
      }
      if (total > paths.length && clickable.length < MAX_RESULTS) {
        rows.push({ type: 'more', key: `more:${r.kind}:${r.cellName}:${r.id}`, count: total - paths.length });
      }
    }
    return { rows, clickable };
  }, [index, occCounts, design, query]);

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

  const select = (occ: OccRow) => {
    const { result, path } = occ;
    // In hybrid mode, jump inside the hybrid viewer itself: instances (and
    // pins on instances) land on that block; primitives/nets/cells land on
    // the cell occurrence that contains them. Everything below the top entry
    // of the occurrence path is an instance id.
    if (appMode === 'hybrid') {
      const labels = path.slice(1).map(p => p.label);
      if (result.kind === 'instance') labels.push(result.id);
      else if (result.kind === 'pin' && result.ownerKind !== 'primitive' && result.ownerId) labels.push(result.ownerId);
      hybridJump(labels);
      onClose();
      return;
    }
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
      setActiveIdx(i => Math.min(i + 1, clickable.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const occ = clickable[activeIdx];
      if (occ) select(occ);
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
          {query.trim() !== '' && clickable.length === 0 && (
            <div className="search-hint">No matches</div>
          )}
          {rows.map(row => {
            if (row.type === 'more') {
              return (
                <div key={row.key} className="search-more">+{row.count} more occurrence{row.count === 1 ? '' : 's'}</div>
              );
            }
            const { result: r, clickIdx, loc } = row;
            return (
              <div
                key={`${r.kind}:${r.id}:${clickIdx}`}
                ref={clickIdx === activeIdx ? activeRef : undefined}
                className={`search-result${clickIdx === activeIdx ? ' active' : ''}`}
                onMouseEnter={() => setActiveIdx(clickIdx)}
                onClick={() => select(row)}
              >
                <span className={`search-kind kind-${r.kind}`}>{KIND_LABELS[r.kind]}</span>
                <span className="search-id">{r.id}</span>
                <span className="search-detail">{r.detail}</span>
                <span className="search-loc" title={fullLoc(row.path)}>in {loc}</span>
              </div>
            );
          })}
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
