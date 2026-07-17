import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerStore, type SelectionType, type BreadcrumbEntry } from '../store/viewerStore';
import { useHybridStore } from '../store/hybridStore';
import { buildSearchIndex, buildOccurrenceCounts, type SearchResult } from '../search/searchIndex';
import { matchIndex } from '../chat/queries/match';
import { buildViewerSections, type ViewerKind } from '../search/viewerRows';
import { normSeg } from '../layout-viewer/correlate';
import { HYBRID_ENABLED, LAYOUT_ENABLED } from '../flags';
import type { Design } from '../parser/types';

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  instance: 'Instance',
  primitive: 'Primitive',
  net: 'Net',
  cell: 'Cell',
  pin: 'Pin',
};

const ACTIVE_CAP = 24; // clickable rows in the active viewer's section
const OTHER_CAP = 8;   // clickable rows per other-viewer section
const MAX_OCC = 8;     // occurrences shown per matched item before "+N more"

const VIEWER_LABELS: Record<ViewerKind, string> = {
  schematic: 'Schematic viewer',
  hybrid: 'Hybrid viewer',
  layout: 'Layout viewer',
};

// A clickable occurrence (a match reached via one instantiation path, opening
// in one specific viewer), a muted "+N more" tail for items reused more than
// MAX_OCC times, or a viewer section header (active viewer's section first).
type OccRow = { type: 'occ'; viewer: ViewerKind; result: SearchResult; path: BreadcrumbEntry[]; loc: string; clickIdx: number };
type MoreRow = { type: 'more'; key: string; count: number };
type HeaderRow = { type: 'header'; viewer: ViewerKind; current: boolean };
type Row = OccRow | MoreRow | HeaderRow;

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
  const { goToPath, setFocusNet, setSelection, selectAndFocus, setAppMode, appMode, layoutModel } = useViewerStore();
  const hybridJump = useHybridStore(s => s.jumpTo);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildSearchIndex(design), [design]);
  const occCounts = useMemo(() => buildOccurrenceCounts(design), [design]);
  // Physical presence keys for the layout section (normalized like the
  // LayoutModel builds them: normSeg per '/'-segment).
  const layoutNets = useMemo(
    () => (layoutModel ? new Set(layoutModel.nets.map(n => n.name.split(/[/:]/).map(normSeg).filter(Boolean).join('/'))) : null),
    [layoutModel],
  );
  const layoutInstances = useMemo(
    () => (layoutModel ? new Set(layoutModel.instances.map(i => i.id)) : null),
    [layoutModel],
  );

  // Matches are grouped by the viewer a row opens in — the ACTIVE viewer's
  // section first, then the other viewers (Amr-style "results from this
  // viewer first"). Each matched item expands into one row per instantiation
  // path, capped per section with a "+N more" tail. `clickable` is the
  // keyboard-navigable subset across all sections.
  const { rows, clickable } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: Row[] = [];
    const clickable: OccRow[] = [];
    if (!q) return { rows, clickable };

    const matches = matchIndex(index, q);
    const sections = buildViewerSections(design, matches, occCounts, {
      activeViewer: appMode as ViewerKind,
      hybridEnabled: HYBRID_ENABLED,
      layoutEnabled: LAYOUT_ENABLED,
      layoutNets,
      layoutInstances,
      activeCap: ACTIVE_CAP,
      otherCap: OTHER_CAP,
      maxOcc: MAX_OCC,
    });

    for (const section of sections) {
      if (sections.length > 1) rows.push({ type: 'header', viewer: section.viewer, current: section.viewer === appMode });
      for (const e of section.entries) {
        if (e.type === 'more') {
          rows.push({ type: 'more', key: e.key, count: e.count });
          continue;
        }
        const occ: OccRow = { type: 'occ', viewer: e.viewer, result: e.result, path: e.path, loc: locLabel(e.path), clickIdx: clickable.length };
        rows.push(occ);
        clickable.push(occ);
      }
    }
    return { rows, clickable };
  }, [index, occCounts, design, query, appMode, layoutNets, layoutInstances]);

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
    const { result, path, viewer } = occ;
    // A row opens in ITS OWN viewer (the section it sits under), switching
    // the app mode when that differs from the current one.
    if (viewer === 'hybrid') {
      // Instances (and pins on instances) land on that block; primitives/
      // nets/cells land on the cell occurrence that contains them.
      // Everything below the top entry of the occurrence path is an
      // instance id.
      const labels = path.slice(1).map(p => p.label);
      if (result.kind === 'instance') labels.push(result.id);
      else if (result.kind === 'pin' && result.ownerKind !== 'primitive' && result.ownerId) labels.push(result.ownerId);
      if (appMode !== 'hybrid') setAppMode('hybrid');
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
    if (appMode !== viewer) setAppMode(viewer);
    goToPath(path, selection);
    if (viewer === 'layout' && selection) {
      // The layout canvas frames on layoutFocusRequest, not focusRequest.
      selectAndFocus(selection);
    } else if (viewer === 'layout') {
      setSelection(null);
    }
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
            if (row.type === 'header') {
              return (
                <div key={`hdr:${row.viewer}`} className="search-section">
                  {VIEWER_LABELS[row.viewer]}{row.current ? ' · current' : ''}
                </div>
              );
            }
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
