import { create } from 'zustand';
import type { Design, Cell } from '../parser/types';
import type { LayoutData, LayoutModel } from '../layout-viewer/model';
import { correlate } from '../layout-viewer/correlate';

export type ViewMode = 'inst' | 'both' | 'net';

// Top-level app mode: the original schematic view, or the physical layout view.
export type AppMode = 'schematic' | 'layout' | 'hybrid';
// Hierarchy depth shown on the layout canvas: any level 0..maxDepth, or all.
export type LayoutDepth = number | 'all';

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
  // Collapsible side panels (hierarchy on the left, inspector on the right).
  // Shared across schematic and layout modes.
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  // Bumped whenever the canvas should pan/zoom to the current selection
  // (e.g. after jumping to a search result), even if the cell didn't change.
  focusRequest: number;

  // Abstract Layout Viewer state (second app mode).
  appMode: AppMode;
  layoutData: LayoutData | null;
  layoutModel: LayoutModel | null;
  layoutDepth: LayoutDepth;
  layerVisibility: Record<string, boolean>;
  // Bumped to ask the layout canvas to frame the current selection (used by the
  // zone dropdown and the sprawl-insights panel, not by plain canvas clicks).
  layoutFocusRequest: number;
  // Net whose extent is previewed on the canvas (inspector chip hover).
  netPreview: string | null;
  // Opt-in: outline ALL nets touching the selected block (off by default —
  // a block can touch dozens of nets and the boxes overwhelm the canvas).
  showNetExtents: boolean;
  // Focus mode: selecting a block hides everything off its branch instead of
  // just dimming it, and shows the full subtree regardless of the depth cap.
  focusMode: boolean;

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
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setAppMode: (mode: AppMode) => void;
  loadLayout: (data: LayoutData) => void;
  setLayoutDepth: (depth: LayoutDepth) => void;
  toggleLayer: (name: string) => void;
  selectAndFocus: (sel: SelectionType) => void;
  setNetPreview: (name: string | null) => void;
  toggleNetExtents: () => void;
  toggleFocusMode: () => void;
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
  leftPanelOpen: true,
  rightPanelOpen: true,
  focusRequest: 0,
  appMode: 'schematic',
  layoutData: null,
  layoutModel: null,
  layoutDepth: 1,
  layerVisibility: {},
  layoutFocusRequest: 0,
  netPreview: null,
  showNetExtents: false,
  focusMode: true,

  loadDesign: (design) => {
    set({
      design,
      currentCell: design.topCell,
      breadcrumb: [{ label: design.topCell, cellName: design.topCell }],
      selection: null,
      focusNet: null,
      warnings: design.warnings,
      // A new CDL invalidates any correlated layout; return to schematic mode.
      appMode: 'schematic',
      layoutData: null,
      layoutModel: null,
      layerVisibility: {},
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

  // Selection changes always drop any hover preview (the chip that set it is
  // about to unmount, so its mouse-leave may never fire).
  setSelection: (sel) => set({ selection: sel, netPreview: null }),

  setParsing: (parsing) => set({ parsing }),

  setParseError: (error) => set({ parseError: error }),

  setSearchOpen: (open) => set({ searchOpen: open }),

  toggleLeftPanel: () => set(s => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set(s => ({ rightPanelOpen: !s.rightPanelOpen })),

  setAppMode: (appMode) => set({ appMode }),

  loadLayout: (data) => {
    const { design } = get();
    if (!design) return;
    const model = correlate(design, data);
    const layerVisibility: Record<string, boolean> = {};
    for (const l of model.layers) layerVisibility[l] = true;
    set({ layoutData: data, layoutModel: model, layerVisibility, selection: null, netPreview: null });
  },

  setLayoutDepth: (layoutDepth) => set({ layoutDepth }),

  toggleLayer: (name) =>
    set(s => ({ layerVisibility: { ...s.layerVisibility, [name]: !s.layerVisibility[name] } })),

  // Select something AND request the canvas frame it (intentional navigation).
  selectAndFocus: (sel) =>
    set(s => ({ selection: sel, netPreview: null, layoutFocusRequest: s.layoutFocusRequest + 1 })),

  setNetPreview: (name) => set({ netPreview: name }),
  toggleNetExtents: () => set(s => ({ showNetExtents: !s.showNetExtents })),
  toggleFocusMode: () => set(s => ({ focusMode: !s.focusMode })),

  getCell: () => {
    const { design, currentCell } = get();
    return design?.cells.get(currentCell);
  },
}));
