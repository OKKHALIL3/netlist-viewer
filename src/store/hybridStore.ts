import { create } from 'zustand';
import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import type { HybridModel, HybridBlock } from '../hybrid/model';
import { buildHybridModel } from '../hybrid/model';
import { attachLayoutStats, type NetPairCoupling } from '../hybrid/layoutStats';
import { buildConductors, traceConnectivity, type Conductors, type TraceResult } from '../hybrid/connectivity';
import { classifyModel, UNCLASSIFIED } from '../hybrid/classify';

export function passesFilters(b: HybridBlock, funcOff: Set<string>, supplyOff: Set<string>): boolean {
  const catOk = b.category === null || b.category === UNCLASSIFIED || !funcOff.has(b.category);
  const domOk = b.domains.length === 0 || b.domains.some(d => !supplyOff.has(d));
  return catOk && domOk;
}

interface HybridState {
  design: Design | null;
  model: HybridModel | null;
  conductors: Conductors | null;
  trace: TraceResult | null;
  couplingPairs: NetPairCoupling[] | null;
  rootPath: string;
  crumbs: string[];
  depth: number;
  zoneColors: boolean;
  sizeByContent: boolean;
  weights: [number, number, number, number];
  funcOff: Set<string>;
  supplyOff: Set<string>;
  selected: string | null;
  version: number;

  build: (design: Design, layoutData: LayoutData | null, layoutModel: LayoutModel | null) => void;
  drillDown: (path: string) => void;
  goToCrumb: (i: number) => void;
  setDepth: (d: number) => void;
  select: (path: string | null) => void;
  clearOverlays: () => void;
  toggleZoneColors: () => void;
  toggleSizeByContent: () => void;
  toggleFunc: (key: string) => void;
  toggleSupply: (name: string) => void;
  reclassify: () => void;
}

// Everything that must die on navigation (spec §5 + approved design decision).
const CLEARED = { selected: null as string | null, trace: null as TraceResult | null };

export const useHybridStore = create<HybridState>((set, get) => ({
  design: null,
  model: null,
  conductors: null,
  trace: null,
  couplingPairs: null,
  rootPath: '',
  crumbs: [''],
  depth: 3,
  zoneColors: true,
  sizeByContent: true,
  weights: [0.3, 0.2, 0.3, 0.2],
  funcOff: new Set<string>(),
  supplyOff: new Set<string>(),
  selected: null,
  version: 0,

  build: (design, layoutData, layoutModel) => {
    const model = buildHybridModel(design);
    classifyModel(model, design, design.topCell);
    const conductors = buildConductors(design, model);
    let couplingPairs: NetPairCoupling[] | null = null;
    if (layoutData && layoutModel) couplingPairs = attachLayoutStats(model, layoutData, layoutModel);
    set({ design, model, conductors, couplingPairs, rootPath: '', crumbs: [''], depth: Math.min(3, model.maxDepth), ...CLEARED });
  },

  drillDown: (path) => {
    const { model, crumbs } = get();
    if (!model?.blocks.has(path)) return;
    set({ rootPath: path, crumbs: [...crumbs, path], ...CLEARED });
  },

  goToCrumb: (i) => {
    const { crumbs } = get();
    if (i < 0 || i >= crumbs.length) return;
    set({ rootPath: crumbs[i], crumbs: crumbs.slice(0, i + 1), ...CLEARED });
  },

  setDepth: (d) => set({ depth: Math.max(0, d), ...CLEARED }),
  select: (path) => {
    const { design, model, conductors } = get();
    if (path === null || !design || !model || !conductors) { set({ selected: path, trace: null }); return; }
    set({ selected: path, trace: traceConnectivity(design, model, conductors, path) });
  },
  clearOverlays: () => set({ ...CLEARED }),
  toggleZoneColors: () => set(s => ({ zoneColors: !s.zoneColors })),
  toggleSizeByContent: () => set(s => ({ sizeByContent: !s.sizeByContent })),
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
}));
