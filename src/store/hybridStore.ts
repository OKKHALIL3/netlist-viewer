import { create } from 'zustand';
import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import type { HybridModel, HybridBlock } from '../hybrid/model';
import { buildHybridModel, displayPath, setGroupExpanded } from '../hybrid/model';
import { attachLayoutStats, type NetPairCoupling } from '../hybrid/layoutStats';
import { buildConductors, traceDeviceConnectivity, type Conductors, type DeviceTrace } from '../hybrid/connectivity';
import { couplingFor, buildSupplyIndex, type CouplingNeighbor } from '../hybrid/coupling';
import { visiblePaths } from '../hybrid/slots';
import { classifyModel, UNCLASSIFIED } from '../hybrid/classify';
import { findPath, resolvePinRef, type PinRef, type PathResult } from '../hybrid/path';
import { normSegments, normSeg } from '../layout-viewer/correlate';

export function passesFilters(b: HybridBlock, funcOff: Set<string>, supplyOff: Set<string>, supplyDomains: Set<string>): boolean {
  const catOk = b.category === null || b.category === UNCLASSIFIED || !funcOff.has(b.category);
  // Only rails the supply map actually lists are filterable. A block-local power
  // net (topology-voted, e.g. an internal rail) has no checkbox, so it can
  // neither be toggled nor rescue a block whose MAPPED rail is unchecked —
  // intersect with the map before testing. Grounds are already out of both.
  const filterable = b.powerDomains.filter(d => supplyDomains.has(d));
  const domOk = filterable.length === 0 || filterable.some(d => !supplyOff.has(d));
  return catOk && domOk;
}

export function layersFor(r: PathResult, netLayers: Map<string, string[]> | null): string[] | null {
  if (!netLayers) return null;                       // no DSPF → unavailable
  const out = new Set<string>();
  let any = false;
  for (const n of r.netNames) {
    // netLayers keys are built with normSegments (normSeg per '/'-segment) —
    // apply the same normalization here or a mismatched-case/finger-suffix
    // net name silently misses its layer tags.
    const key = n.split('/').map(normSeg).join('/');
    const ls = netLayers.get(key);
    if (ls) { any = true; for (const l of ls) out.add(l); }
  }
  return any ? [...out].sort() : null;               // no tags → unavailable, never guessed
}

interface HybridState {
  design: Design | null;
  layoutData: LayoutData | null;
  model: HybridModel | null;
  conductors: Conductors | null;
  trace: DeviceTrace | null;
  couplingPairs: NetPairCoupling[] | null;
  netLayers: Map<string, string[]> | null;
  // The open chain (path-expansion navigation): openPath[i] is the block
  // whose children are expanded on rail i+1. [] = nothing open (top box only);
  // non-empty chains always start at '' (the root). The breadcrumb IS this
  // chain. Siblings of open blocks render as slivers; the frontier rail
  // (children of the last entry) renders full.
  openPath: string[];
  zoneColors: boolean;
  sizeByContent: boolean;
  weights: [number, number, number, number];
  funcOff: Set<string>;
  supplyOff: Set<string>;
  selected: string | null;
  version: number;
  pathMode: boolean;
  startPin: string;
  endPin: string;
  pathResult: PathResult | null;
  pathLayers: string[] | null;
  pathPinsValid: boolean;
  // resolved endpoints in DISPLAY terms (for the canvas markers) — the raw
  // input strings may differ in case or name an array member
  pathEnds: [PinRef, PinRef] | null;
  coupling: { on: boolean; minC: number; includeSupply: boolean };
  // couplingFor on a big DSPF takes visible time — it runs OFF the render
  // path (refreshCoupling) so the canvas can show a "computing" indicator
  // instead of freezing mid-click.
  couplingBusy: boolean;
  couplingNeighbors: CouplingNeighbor[] | null;

  build: (design: Design, layoutData: LayoutData | null, layoutModel: LayoutModel | null) => void;
  toggleOpen: (path: string) => void;
  toggleGroup: (gpath: string) => void;
  drillDown: (path: string) => void;
  goToCrumb: (i: number) => void;
  jumpTo: (labels: string[]) => void;
  jumpToPath: (path: string) => void;
  select: (path: string | null) => void;
  clearOverlays: () => void;
  toggleZoneColors: () => void;
  toggleSizeByContent: () => void;
  setWeights: (w: [number, number, number, number]) => void;
  toggleFunc: (key: string) => void;
  toggleSupply: (name: string) => void;
  reclassify: () => void;
  togglePathMode: () => void;
  setPathPins: (startPin: string, endPin: string) => void;
  toggleCoupling: () => void;
  setCouplingMinC: (v: number) => void;
  toggleCouplingSupply: () => void;
  refreshCoupling: () => void;
}

// Everything that must die on navigation.
const CLEARED = {
  selected: null as string | null, trace: null as DeviceTrace | null,
  pathResult: null as PathResult | null, startPin: '', endPin: '',
  pathPinsValid: false, pathEnds: null as [PinRef, PinRef] | null,
  couplingBusy: false, couplingNeighbors: null as CouplingNeighbor[] | null,
};

// Cached across selections (invalidated by build()): the supply-net index
// depends only on the design + DSPF. The token discards stale async coupling
// results when the user clicks on before a computation lands.
let supplyIdxCache: Set<number> | null = null;
let couplingToken = 0;

// build() input identity — tracked outside reactive state (spec: "non-reactive
// fields are fine") so a re-mount of HybridViewer with the same design/DSPF
// references (every mode switch) is a no-op instead of wiping rootPath/crumbs.
let lastBuildDesign: Design | null = null;
let lastBuildLayoutData: LayoutData | null = null;
let lastBuildLayoutModel: LayoutModel | null = null;

// Full breadcrumb trail (root … path) in display terms — the crumb bar is a
// LOCATION, so every intermediate ancestor must be present and clickable.
function trailTo(model: HybridModel, path: string): string[] {
  const trail: string[] = [path];
  for (let p: string | null = model.blocks.get(path)?.parent ?? null; p !== null; ) {
    const d = displayPath(model, p);              // members surface as their group
    if (trail[0] !== d) trail.unshift(d);
    p = model.blocks.get(d)?.parent ?? null;
  }
  if (trail[0] !== '') trail.unshift('');
  return trail;
}

export const useHybridStore = create<HybridState>((set, get) => ({
  design: null,
  layoutData: null,
  model: null,
  conductors: null,
  trace: null,
  couplingPairs: null,
  netLayers: null,
  openPath: [],
  zoneColors: true,
  sizeByContent: true,
  weights: [0.3, 0.2, 0.3, 0.2],
  funcOff: new Set<string>(),
  supplyOff: new Set<string>(),
  selected: null,
  version: 0,
  pathMode: false,
  startPin: '',
  endPin: '',
  pathResult: null,
  pathLayers: null,
  pathPinsValid: false,
  pathEnds: null,
  coupling: { on: false, minC: 1e-15, includeSupply: false },
  couplingBusy: false,
  couplingNeighbors: null,

  build: (design, layoutData, layoutModel) => {
    // Every HybridViewer mount (i.e. every mode switch) calls build() with
    // the SAME references when nothing changed — skip the full rebuild so
    // navigation state (rootPath/crumbs/depth) survives a mode round-trip.
    if (design === lastBuildDesign && layoutData === lastBuildLayoutData && layoutModel === lastBuildLayoutModel) {
      return;
    }

    const model = buildHybridModel(design);
    classifyModel(model, design, design.topCell);
    const conductors = buildConductors(design, model);
    let couplingPairs: NetPairCoupling[] | null = null;
    let netLayers: Map<string, string[]> | null = null;
    if (layoutData && layoutModel) {
      couplingPairs = attachLayoutStats(model, layoutData, layoutModel);
      const seps = [layoutData.divider, layoutData.delimiter];
      netLayers = new Map();
      for (const n of layoutModel.nets) netLayers.set(normSegments(n.name, seps).join('/'), n.layers);
    }
    // Latch input identity only AFTER a successful build — latching first
    // would turn one mid-build exception into a permanently blank viewer
    // (every remount would hit the early return above).
    lastBuildDesign = design;
    lastBuildLayoutData = layoutData;
    lastBuildLayoutModel = layoutModel;
    supplyIdxCache = null;
    couplingToken++;
    set({
      design, layoutData, model, conductors, couplingPairs, netLayers,
      // A new design has its own rail names — a supply toggle carried over from
      // the previous design would dim blocks with no checkbox to restore them.
      // (Only runs on a genuine rebuild; a mode-switch early-returns above.)
      openPath: [], supplyOff: new Set<string>(), ...CLEARED,
    });
  },

  // Canvas double-click: open the block's children on the rail BELOW it (the
  // block itself stays put), or close them if it is already open. Opening a
  // sibling of an open block switches the branch at that level — the old
  // branch's deeper rails collapse. Leaves have nothing to open → no-op.
  toggleOpen: (path) => {
    const { model, openPath } = get();
    const block = model?.blocks.get(path);
    if (!model || !block || block.children.length === 0) return;
    const trail = trailTo(model, path);
    const isOpen = trail.length <= openPath.length && trail.every((p, i) => openPath[i] === p);
    set({ openPath: isOpen ? trail.slice(0, -1) : trail, ...CLEARED });
  },

  // ×N chip click: pop an array group open into its individual members, or
  // fold them back. Structural swap in the model (setGroupExpanded) + version
  // bump — layout, traces, search and stats all read the swapped tree. Any
  // open level that named the group (or a member being folded away) no longer
  // exists on its rail, so the open chain truncates there.
  toggleGroup: (gpath) => {
    const { model, openPath } = get();
    const g = model?.blocks.get(gpath);
    if (!model || !g?.members) return;
    const expanding = !g.expanded;
    if (!setGroupExpanded(model, gpath, expanding)) return;
    const gone = (p: string) => (expanding ? p === gpath : g.members!.includes(p));
    const cut = openPath.findIndex(gone);
    set(s => ({
      openPath: cut >= 0 ? openPath.slice(0, cut) : openPath,
      ...CLEARED,
      version: s.version + 1,
    }));
  },

  // Open the rails down to `path` (tree-panel double-click / programmatic
  // "show me this block's contents"). Full ancestor trail, never a shortcut:
  // every intermediate level gets its rail and crumb. A leaf opens to its
  // parent instead — the leaf stays a visible block on the frontier rail.
  drillDown: (path) => {
    const { model } = get();
    const block = model?.blocks.get(path);
    if (!model || !block) return;
    const trail = trailTo(model, path);
    if (block.children.length === 0) trail.pop();
    set({ openPath: trail, ...CLEARED });
  },

  goToCrumb: (i) => {
    const { openPath } = get();
    if (i < 0 || i >= openPath.length) return;
    set({ openPath: openPath.slice(0, i + 1), ...CLEARED });
  },

  // Design-wide search jump (breadcrumb rule: build the full trail, don't
  // descend): labels are raw instance ids from the top cell down to the
  // target. Delegates to jumpToPath after normalization.
  jumpTo: (labels) => {
    const { model } = get();
    if (!model) return;
    const real = labels.map(l => normSeg(l) || l.toLowerCase()).filter(Boolean).join('/');
    get().jumpToPath(displayPath(model, real));
  },

  // Jump to a display path: open the rails down to its PARENT (the target
  // itself stays a selectable full block on the frontier rail), select it,
  // and run the connectivity trace.
  jumpToPath: (path) => {
    const { design, model, conductors } = get();
    if (!design || !model || !conductors) return;
    const block = model.blocks.get(path);
    if (!block) return; // not in the model (unresolved master etc.) — no-op
    const trail = trailTo(model, path);
    trail.pop();
    set({
      openPath: trail,
      ...CLEARED,
      selected: path,
      trace: traceDeviceConnectivity(design, model, conductors, path),
    });
  },

  select: (path) => {
    const { design, model, conductors } = get();
    if (path === null || !design || !model || !conductors) { set({ selected: path, trace: null }); return; }
    set({ selected: path, trace: traceDeviceConnectivity(design, model, conductors, path) });
  },
  clearOverlays: () => set({ ...CLEARED }),
  toggleZoneColors: () => set(s => ({ zoneColors: !s.zoneColors })),
  toggleSizeByContent: () => set(s => ({ sizeByContent: !s.sizeByContent })),
  setWeights: (w) => set({ weights: w }),
  toggleFunc: (key) => set(s => {
    const n = new Set(s.funcOff);
    if (n.has(key)) n.delete(key); else n.add(key);
    return { funcOff: n };
  }),
  toggleSupply: (name) => set(s => {
    const n = new Set(s.supplyOff);
    if (n.has(name)) n.delete(name); else n.add(name);
    return { supplyOff: n };
  }),
  reclassify: () => {
    const { design, model } = get();
    if (!design || !model) return;
    classifyModel(model, design, design.topCell);
    set(s => ({ version: s.version + 1 }));
  },
  togglePathMode: () => set(s => ({ pathMode: !s.pathMode, ...CLEARED })),
  setPathPins: (startPin, endPin) => {
    const { design, model, conductors } = get();
    set({ startPin, endPin });
    if (!design || !model || !conductors || !startPin || !endPin) { set({ pathResult: null, pathLayers: null, pathPinsValid: false }); return; }
    const parse = (s2: string): PinRef => {
      const i = s2.lastIndexOf(':');
      return { block: s2.slice(0, i), pin: s2.slice(i + 1) };
    };
    // Resolve typed refs (display case → canonical paths/ports) and run the
    // BFS only once both name real pins — partial input while typing must
    // neither burn a graph search per keystroke nor flash the "no path" error.
    const a = resolvePinRef(design, model, parse(startPin));
    const b = resolvePinRef(design, model, parse(endPin));
    if (!a || !b) {
      set({ pathResult: null, pathLayers: null, pathPinsValid: false, pathEnds: null });
      return;
    }
    const result = findPath(design, model, conductors, a, b);
    set({
      pathResult: result,
      pathLayers: result ? layersFor(result, get().netLayers) : null,
      pathPinsValid: true,
      pathEnds: [
        { block: displayPath(model, a.block), pin: a.pin },
        { block: displayPath(model, b.block), pin: b.pin },
      ],
    });
  },
  toggleCoupling: () => set(s => ({ coupling: { ...s.coupling, on: !s.coupling.on } })),
  setCouplingMinC: (v) => set(s => ({ coupling: { ...s.coupling, minC: v } })),
  toggleCouplingSupply: () => set(s => ({ coupling: { ...s.coupling, includeSupply: !s.coupling.includeSupply } })),

  // Recompute coupling neighbors for the current selection, off the render
  // path. The timeout is deliberate: it lets React paint the busy indicator
  // before the synchronous pair scan runs (spinners can't spin mid-freeze).
  refreshCoupling: () => {
    const token = ++couplingToken;
    const { design, layoutData, model, couplingPairs, coupling, selected, openPath } = get();
    if (!coupling.on || !selected || !couplingPairs || !layoutData || !design || !model) {
      set({ couplingNeighbors: null, couplingBusy: false });
      return;
    }
    set({ couplingBusy: true });
    setTimeout(() => {
      if (token !== couplingToken) return;
      if (!supplyIdxCache) supplyIdxCache = buildSupplyIndex(design, model, layoutData);
      const neighbors = couplingFor(
        design, model, layoutData, couplingPairs, selected,
        visiblePaths(model, openPath), coupling.minC, coupling.includeSupply, supplyIdxCache,
      );
      if (token === couplingToken) set({ couplingNeighbors: neighbors, couplingBusy: false });
    }, 30);
  },
}));
