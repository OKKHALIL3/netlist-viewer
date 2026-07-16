import type { Design } from '../parser/types';
import type { BreadcrumbEntry } from '../store/viewerStore';
import type { HybridModel } from '../hybrid/model';
import { displayPath } from '../hybrid/model';
import { normSeg } from '../layout-viewer/correlate';
import { buildSearchIndex, buildOccurrenceCounts, pathsToCell } from '../search/searchIndex';
import { matchIndex } from './queries/match';

// One mention ("the PLL", "ck", "M3") → candidates carrying every address
// scheme the app uses: breadcrumb paths for the schematic/layout stores,
// normSeg'd slash paths for the hybrid store, plus the owning cell. This is
// the single translation point between the three schemes — everything in
// src/chat resolves through here.

export type CanonicalRef =
  | { kind: 'cell'; cellName: string; occurrences: BreadcrumbEntry[][]; total: number }
  | { kind: 'block'; hybridPath: string; crumbs: BreadcrumbEntry[]; cellName: string; category: string | null }
  | { kind: 'net'; netName: string; cellName: string; scopes: string[] }
  | { kind: 'device'; cellName: string; id: string };

export interface Resolution {
  candidates: CanonicalRef[];
  note?: string;
}

const MAX_CANDIDATES = 8;
const MAX_OCC = 4;

// Hybrid block paths are normSeg'd instance ids joined by '/', mapped onto the
// array-collapsed display tree. Crumbs[0] is the top cell (not an instance).
export function crumbsToHybridPath(crumbs: BreadcrumbEntry[], model: HybridModel | null): string {
  const raw = crumbs
    .slice(1)
    .map(c => normSeg(c.label) || c.label.toLowerCase())
    .join('/');
  return model ? displayPath(model, raw) : raw;
}

export interface Resolver {
  resolveEntity(mention: string, kindHint?: 'cell' | 'block' | 'net' | 'device'): Resolution;
}

export function createResolver(design: Design, model: HybridModel | null): Resolver {
  const index = buildSearchIndex(design);
  const counts = buildOccurrenceCounts(design);

  const occurrencesOf = (cellName: string) => pathsToCell(design, cellName, MAX_OCC, counts);

  const blockRefFromCrumbs = (crumbs: BreadcrumbEntry[], cellName: string): CanonicalRef => {
    const hybridPath = crumbsToHybridPath(crumbs, model);
    return {
      kind: 'block',
      hybridPath,
      crumbs,
      cellName,
      category: model?.blocks.get(hybridPath)?.category ?? null,
    };
  };

  const resolveEntity = (mention: string, kindHint?: 'cell' | 'block' | 'net' | 'device'): Resolution => {
    const q = mention.trim();
    if (!q) return { candidates: [], note: 'empty mention' };
    const out: CanonicalRef[] = [];
    const seen = new Set<string>();
    const push = (ref: CanonicalRef) => {
      const key = JSON.stringify([ref.kind, ref.kind === 'block' ? ref.hybridPath : ref.kind === 'cell' ? ref.cellName : ref.kind === 'net' ? `${ref.cellName}|${ref.netName}` : `${ref.cellName}/${ref.id}`]);
      if (seen.has(key) || out.length >= MAX_CANDIDATES) return;
      seen.add(key);
      out.push(ref);
    };

    // Direct hybrid path ("xtop/xpll" or a path the model knows verbatim).
    if (model && (!kindHint || kindHint === 'block')) {
      const norm = q.split('/').map(s => normSeg(s) || s.toLowerCase()).join('/');
      const direct = model.blocks.get(displayPath(model, norm));
      if (direct && direct.path !== '') {
        const crumbs: BreadcrumbEntry[] = [{ label: design.topCell, cellName: design.topCell }];
        // Rebuild crumbs from block labels down the parent chain.
        const chain: string[] = [];
        for (let p: string | null = direct.path; p; p = model.blocks.get(p)?.parent || null) chain.unshift(p);
        for (const p of chain) {
          const b = model.blocks.get(p)!;
          crumbs.push({ label: b.label, cellName: b.master });
        }
        push({ kind: 'block', hybridPath: direct.path, crumbs, cellName: direct.master, category: direct.category });
      }
    }

    // Name/detail matches over the design-wide index.
    for (const r of matchIndex(index, q, 24)) {
      if (out.length >= MAX_CANDIDATES) break;
      if (r.kind === 'cell' && (!kindHint || kindHint === 'cell' || kindHint === 'block')) {
        const { paths, total } = occurrencesOf(r.id);
        if (kindHint === 'block') {
          for (const path of paths.slice(0, 2)) push(blockRefFromCrumbs(path, r.id));
        } else {
          push({ kind: 'cell', cellName: r.id, occurrences: paths, total });
        }
      } else if (r.kind === 'instance' && (!kindHint || kindHint === 'block')) {
        const master = design.cells.get(r.cellName)?.instances.find(i => i.id === r.id)?.master ?? r.cellName;
        const { paths } = occurrencesOf(r.cellName);
        for (const path of paths.slice(0, 2)) {
          push(blockRefFromCrumbs([...path, { label: r.id, cellName: master }], master));
        }
      } else if (r.kind === 'net' && (!kindHint || kindHint === 'net')) {
        const { paths } = occurrencesOf(r.cellName);
        const scopes = paths.map(p => crumbsToHybridPath(p, model));
        push({ kind: 'net', netName: r.id, cellName: r.cellName, scopes });
      } else if (r.kind === 'primitive' && (!kindHint || kindHint === 'device')) {
        push({ kind: 'device', cellName: r.cellName, id: r.id });
      }
    }

    // Category matches: "pll" hits blocks classified AMS:PLL even when no name
    // contains the token. Display blocks only, so ×N members don't flood.
    if (model && (!kindHint || kindHint === 'block')) {
      const needle = q.toLowerCase();
      for (const b of model.blocks.values()) {
        if (out.length >= MAX_CANDIDATES) break;
        if (!b.category || b.path === '' || displayPath(model, b.path) !== b.path) continue;
        const label = b.category.slice(b.category.indexOf(':') + 1).toLowerCase();
        if (!label.includes(needle)) continue;
        const chain: string[] = [];
        for (let p: string | null = b.path; p; p = model.blocks.get(p)?.parent || null) chain.unshift(p);
        const crumbs: BreadcrumbEntry[] = [{ label: design.topCell, cellName: design.topCell }];
        for (const p of chain) {
          const blk = model.blocks.get(p)!;
          crumbs.push({ label: blk.label, cellName: blk.master });
        }
        push({ kind: 'block', hybridPath: b.path, crumbs, cellName: b.master, category: b.category });
      }
    }

    return {
      candidates: out,
      note: out.length === 0 ? `nothing in the design matches "${q}"` : out.length > 1 ? 'multiple candidates — pick by path or ask the user' : undefined,
    };
  };

  return { resolveEntity };
}
