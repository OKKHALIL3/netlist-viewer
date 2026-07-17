import type { Design } from '../parser/types';
import type { BreadcrumbEntry } from '../store/viewerStore';
import { pathsToCell, type SearchResult } from './searchIndex';
import { normSeg } from '../layout-viewer/correlate';

// Viewer-grouped search results: the palette shows the ACTIVE viewer's
// matches first, then the same matches re-targeted at the other viewers a
// result can meaningfully open in — clicking a row jumps into that row's
// viewer. Schematic presents every element; hybrid presents blocks
// (instances/cells); layout presents only elements that physically exist in
// the correlated DSPF (per occurrence, since presence depends on the scope).

export type ViewerKind = 'schematic' | 'hybrid' | 'layout';

export interface ViewerRowsOpts {
  activeViewer: ViewerKind;
  hybridEnabled: boolean;
  layoutEnabled: boolean;
  layoutNets: Set<string> | null;        // normalized 'scope/net' keys from the LayoutModel
  layoutInstances: Set<string> | null;   // normalized slash-path instance ids
  activeCap?: number;                    // clickable rows in the active section
  otherCap?: number;                     // clickable rows per other section
  maxOcc?: number;                       // occurrences shown per matched item
}

export type ViewerEntry =
  | { type: 'occ'; viewer: ViewerKind; result: SearchResult; path: BreadcrumbEntry[] }
  | { type: 'more'; key: string; count: number };

export interface ViewerSection {
  viewer: ViewerKind;
  entries: ViewerEntry[];
}

const VIEWERS: ViewerKind[] = ['schematic', 'hybrid', 'layout'];

function kindEligible(viewer: ViewerKind, r: SearchResult): boolean {
  if (viewer === 'schematic') return true;
  if (viewer === 'hybrid') return r.kind === 'instance' || r.kind === 'cell';
  return r.kind === 'net' || r.kind === 'instance';
}

// Layout presence is per-occurrence: the same net/instance name may exist
// physically under one instantiation path and not another.
function layoutHas(r: SearchResult, path: BreadcrumbEntry[], opts: ViewerRowsOpts): boolean {
  const labels = path.slice(1).map(p => normSeg(p.label)).filter(Boolean);
  const key = [...labels, normSeg(r.id)].filter(Boolean).join('/');
  if (r.kind === 'net') return opts.layoutNets?.has(key) ?? false;
  return opts.layoutInstances?.has(key) ?? false;
}

export function buildViewerSections(
  design: Design,
  matches: SearchResult[],
  occCounts: Map<string, number>,
  opts: ViewerRowsOpts,
): ViewerSection[] {
  const order = [opts.activeViewer, ...VIEWERS.filter(v => v !== opts.activeViewer)];
  const enabled = (v: ViewerKind) =>
    v === 'schematic' ? true
    : v === 'hybrid' ? opts.hybridEnabled
    : opts.layoutEnabled && opts.layoutNets !== null;

  const sections: ViewerSection[] = [];
  for (const viewer of order) {
    if (!enabled(viewer)) continue;
    const cap = viewer === opts.activeViewer ? opts.activeCap ?? 24 : opts.otherCap ?? 8;
    const maxOcc = opts.maxOcc ?? 8;
    const entries: ViewerEntry[] = [];
    let clickable = 0;
    for (const r of matches) {
      if (clickable >= cap) break;
      if (!kindEligible(viewer, r)) continue;
      const targetCell = r.kind === 'cell' ? r.id : r.cellName;
      const { paths, total } = pathsToCell(design, targetCell, maxOcc, occCounts);
      let shown = 0;
      for (const path of paths) {
        if (clickable >= cap) break;
        if (viewer === 'layout' && !layoutHas(r, path, opts)) continue;
        entries.push({ type: 'occ', viewer, result: r, path });
        clickable++;
        shown++;
      }
      if (shown > 0 && total > paths.length && clickable < cap) {
        entries.push({ type: 'more', key: `${viewer}:${r.kind}:${r.cellName}:${r.id}`, count: total - paths.length });
      }
    }
    if (entries.length > 0) sections.push({ viewer, entries });
  }
  return sections;
}
