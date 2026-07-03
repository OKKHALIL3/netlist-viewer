import { create } from 'zustand';
import type { Design } from '../parser/types';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import type { HybridModel } from '../hybrid/model';
import { buildHybridModel } from '../hybrid/model';
import { attachLayoutStats, type NetPairCoupling } from '../hybrid/layoutStats';

interface HybridState {
  model: HybridModel | null;
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
}

// Everything that must die on navigation (spec §5 + approved design decision).
const CLEARED = { selected: null as string | null };

export const useHybridStore = create<HybridState>((set, get) => ({
  model: null,
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

  build: (design, layoutData, layoutModel) => {
    const model = buildHybridModel(design);
    let couplingPairs: NetPairCoupling[] | null = null;
    if (layoutData && layoutModel) couplingPairs = attachLayoutStats(model, layoutData, layoutModel);
    set({ model, couplingPairs, rootPath: '', crumbs: [''], depth: Math.min(3, model.maxDepth), ...CLEARED });
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
  select: (path) => set({ selected: path }),
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
}));
