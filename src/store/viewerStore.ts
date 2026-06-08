import { create } from 'zustand';
import type { Design, Cell } from '../parser/types';

export type ViewMode = 'inst' | 'both' | 'net';

export type SelectionType =
  | { type: 'instance'; id: string }
  | { type: 'primitive'; id: string }
  | { type: 'net'; name: string };

export interface ReviewItem {
  type: 'instance' | 'primitive' | 'net';
  id: string;
}

export interface BreadcrumbEntry {
  label: string;
  cellName: string;
}

interface ViewerState {
  design: Design | null;
  currentCell: string;
  breadcrumb: BreadcrumbEntry[];
  mode: ViewMode;
  hideSupply: boolean;
  focusNet: string | null;
  selection: SelectionType | null;
  reviewList: ReviewItem[];
  warnings: string[];

  // actions
  loadDesign: (design: Design) => void;
  descend: (instanceId: string, masterCell: string) => void;
  ascendTo: (index: number) => void;
  setMode: (mode: ViewMode) => void;
  toggleHideSupply: () => void;
  setFocusNet: (net: string | null) => void;
  setSelection: (sel: SelectionType | null) => void;
  addToReview: (item: ReviewItem) => void;
  removeFromReview: (index: number) => void;
  getCell: () => Cell | undefined;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  design: null,
  currentCell: '',
  breadcrumb: [],
  mode: 'both',
  hideSupply: true,
  focusNet: null,
  selection: null,
  reviewList: [],
  warnings: [],

  loadDesign: (design) => {
    set({
      design,
      currentCell: design.topCell,
      breadcrumb: [{ label: design.topCell, cellName: design.topCell }],
      selection: null,
      focusNet: null,
      warnings: design.warnings,
      reviewList: [],
    });
  },

  descend: (instanceId, masterCell) => {
    const { breadcrumb, design } = get();
    if (!design?.cells.has(masterCell)) return;
    set({
      currentCell: masterCell,
      breadcrumb: [...breadcrumb, { label: instanceId, cellName: masterCell }],
      selection: null,
      focusNet: null,
    });
  },

  ascendTo: (index) => {
    const { breadcrumb } = get();
    const entry = breadcrumb[index];
    if (!entry) return;
    set({
      currentCell: entry.cellName,
      breadcrumb: breadcrumb.slice(0, index + 1),
      selection: null,
      focusNet: null,
    });
  },

  setMode: (mode) => {
    set({ mode, focusNet: mode !== 'net' ? null : get().focusNet });
  },

  toggleHideSupply: () => set(s => ({ hideSupply: !s.hideSupply })),

  setFocusNet: (net) => set({ focusNet: net }),

  setSelection: (sel) => set({ selection: sel }),

  addToReview: (item) => {
    const { reviewList } = get();
    if (!reviewList.some(r => r.type === item.type && r.id === item.id)) {
      set({ reviewList: [...reviewList, item] });
    }
  },

  removeFromReview: (index) => {
    const { reviewList } = get();
    set({ reviewList: reviewList.filter((_, i) => i !== index) });
  },

  getCell: () => {
    const { design, currentCell } = get();
    return design?.cells.get(currentCell);
  },
}));
