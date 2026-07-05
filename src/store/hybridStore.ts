import { create } from 'zustand';
import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import type { HybridModel, HybridBlock } from '../hybrid/model';
import { buildHybridModel, displayPath } from '../hybrid/model';
import { attachLayoutStats, type NetPairCoupling } from '../hybrid/layoutStats';
import { buildConductors, traceConnectivity, type Conductors, type TraceResult } from '../hybrid/connectivity';
import { classifyModel, UNCLASSIFIED } from '../hybrid/classify';
import { findPath, resolvePinRef, type PinRef, type PathResult } from '../hybrid/path';
import { normSegments, normSeg } from '../layout-viewer/correlate';

export function passesFilters(b: HybridBlock, funcOff: Set<string>, supplyOff: Set<string>): boolean {
  const catOk = b.category === null || b.category === UNCLASSIFIED || !funcOff.has(b.category);
  const domOk = b.domains.length === 0 || b.domains.some(d => !supplyOff.has(d));
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
  trace: TraceResult | null;
  couplingPairs: NetPairCoupling[] | null;
  netLayers: Map<string, string[]> | null;
  // The open chain (Amr's round-3 navigation model): openPath[i] is the block
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

  build: (design: Design, layoutData: LayoutData | null, layoutModel: LayoutModel | null) => void;
  toggleOpen: (path: string) => void;
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
}

// Everything that must die on navigation (spec §5 + approved design decision).
const CLEARED = {
  selected: null as string | null, trace: null as TraceResult | null,
  pathResult: null as PathResult | null, startPin: '', endPin: '',
  pathPinsValid: false, pathEnds: null as [PinRef, PinRef] | null,
};

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
    set({
      design, layoutData, model, conductors, couplingPairs, netLayers,
      openPath: [], ...CLEARED,
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
      trace: traceConnectivity(design, model, conductors, path),
    });
  },

  select: (path) => {
    const { design, model, conductors } = get();
    if (path === null || !design || !model || !conductors) { set({ selected: path, trace: null }); return; }
    set({ selected: path, trace: traceConnectivity(design, model, conductors, path) });
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
}));
