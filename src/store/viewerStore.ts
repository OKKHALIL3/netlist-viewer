import { create } from 'zustand';
import type { Design, Cell } from '../parser/types';

export type ViewMode = 'inst' | 'both' | 'net';

// How each instance block arranges its pins. 'classic' is the stacked
// IN/OUT/PWR/GND section list. 'beta' (the default) draws a schematic-symbol
// block: inputs on the left edge, outputs on the right (each wrapping into
// sub-columns when long), supply along the top, ground along the bottom.
// Name-only rows; the net mapping lives in the Inspector.
export type NodeLayout = 'beta' | 'classic';

export type SelectionType =
  | { type: 'instance'; id: string }
  | { type: 'primitive'; id: string }
  | { type: 'net'; name: string };

export interface BreadcrumbEntry {
  label: string;
  cellName: string;
}

interface ViewerState {
  design: Design | null;
  currentCell: string;
  breadcrumb: BreadcrumbEntry[];
  mode: ViewMode;
  nodeLayout: NodeLayout;
  hideSupply: boolean;
  focusNet: string | null;
  selection: SelectionType | null;
  warnings: string[];
  parsing: boolean;
  parseError: string | null;
  searchOpen: boolean;
  // Bumped whenever the canvas should pan/zoom to the current selection
  // (e.g. after jumping to a search result), even if the cell didn't change.
  focusRequest: number;

  // actions
  loadDesign: (design: Design) => void;
  descend: (instanceId: string, masterCell: string) => void;
  ascendTo: (index: number) => void;
  goToPath: (path: BreadcrumbEntry[], selection: SelectionType | null) => void;
  setMode: (mode: ViewMode) => void;
  toggleNodeLayout: () => void;
  toggleHideSupply: () => void;
  setFocusNet: (net: string | null) => void;
  setSelection: (sel: SelectionType | null) => void;
  setParsing: (parsing: boolean) => void;
  setParseError: (error: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  getCell: () => Cell | undefined;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  design: null,
  currentCell: '',
  breadcrumb: [],
  mode: 'both',
  nodeLayout: 'beta',
  hideSupply: true,
  focusNet: null,
  selection: null,
  warnings: [],
  parsing: false,
  parseError: null,
  searchOpen: false,
  focusRequest: 0,

  loadDesign: (design) => {
    set({
      design,
      currentCell: design.topCell,
      breadcrumb: [{ label: design.topCell, cellName: design.topCell }],
      selection: null,
      focusNet: null,
      warnings: design.warnings,
    });
  },

  descend: (instanceId, masterCell) => {
    const { breadcrumb, design } = get();
    if (!design?.cells.has(masterCell)) return;
    // Already at this instance — don't push duplicate entry
    if (breadcrumb[breadcrumb.length - 1]?.label === instanceId) return;
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

  // Used by design-wide search to jump straight to a result anywhere in the
  // hierarchy — replaces the breadcrumb wholesale instead of pushing one level.
  goToPath: (path, selection) => {
    const entry = path[path.length - 1];
    if (!entry) return;
    set(s => ({
      currentCell: entry.cellName,
      breadcrumb: path,
      selection,
      focusNet: null,
      focusRequest: s.focusRequest + 1,
    }));
  },

  setMode: (mode) => {
    set({ mode, focusNet: mode !== 'net' ? null : get().focusNet });
  },

  toggleNodeLayout: () => set(s => ({ nodeLayout: s.nodeLayout === 'beta' ? 'classic' : 'beta' })),

  toggleHideSupply: () => set(s => ({ hideSupply: !s.hideSupply })),

  setFocusNet: (net) => set({ focusNet: net }),

  setSelection: (sel) => set({ selection: sel }),

  setParsing: (parsing) => set({ parsing }),

  setParseError: (error) => set({ parseError: error }),

  setSearchOpen: (open) => set({ searchOpen: open }),

  getCell: () => {
    const { design, currentCell } = get();
    return design?.cells.get(currentCell);
  },
}));
