import type { Design } from '../../parser/types';
import type { BreadcrumbEntry, SelectionType } from '../../store/viewerStore';
import type { HybridModel } from '../../hybrid/model';
import type { Conductors } from '../../hybrid/connectivity';
import type { PathResult } from '../../hybrid/path';
import type { PathParasitics } from '../../hybrid/pathParasitics';
import type { LayoutData, LayoutModel } from '../../layout-viewer/model';
import type { NetPairCoupling } from '../../hybrid/layoutStats';
import type { Ref } from '../refs';
import type { Resolver } from '../resolve';
import type { NetClass } from '../queries/netClass';

// The context a chat turn runs against — a NARROW slice of the two zustand
// stores plus the derived indexes, so tools stay testable with plain objects.
// Built fresh per turn by makeChatCtx() (tools/liveCtx.ts); tests hand-roll it.

export interface ViewerCtx {
  appMode: 'schematic' | 'layout' | 'hybrid';
  currentCell: string;
  breadcrumb: BreadcrumbEntry[];
  selection: SelectionType | null;
  goToPath(path: BreadcrumbEntry[], selection: SelectionType | null): void;
  setAppMode(mode: 'schematic' | 'layout' | 'hybrid'): void;
  // Fresh reads for post-dispatch verification (the store setters are
  // synchronous, but tools must confirm the jump actually landed — several
  // store actions silently no-op on unknown targets).
  readBreadcrumb(): BreadcrumbEntry[];
}

export interface HybridCtx {
  model: HybridModel | null;
  conductors: Conductors | null;
  couplingPairs: NetPairCoupling[] | null;
  weights: [number, number, number, number];
  pathMode: boolean;
  selected: string | null;
  jumpToPath(path: string): void;
  select(path: string | null): void;
  togglePathMode(): void;
  setPathPins(startPin: string, endPin: string): void;
  readSelected(): string | null;
  readPathState(): {
    pathResult: PathResult | null;
    pathParasitics: PathParasitics | null;
    pathLayers: string[] | null;
    pathPinsValid: boolean;
  };
}

export interface ChatCtx {
  design: Design;
  resolver: Resolver;
  viewer: ViewerCtx;
  hybrid: HybridCtx;
  layoutData: LayoutData | null;
  layoutModel: LayoutModel | null;
  supplyIdx: Set<number> | null;
  netClasses: Map<string, NetClass> | null;
  dspfLoaded: boolean;
}

export interface ResultTable {
  columns: string[];
  rows: Array<{ cells: string[]; ref?: Ref }>;
  note?: string;
}

export interface ToolResult {
  data: unknown;            // what the model reasons over — compact JSON
  refs?: Ref[];             // typed citations for the UI
  table?: ResultTable;      // find/rank answers render this directly
  uiEffect?: string;        // human-readable "what changed on screen"
  isError?: boolean;
}

export interface ChatTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

export const err = (msg: string): ToolResult => ({ data: msg, isError: true });
export const NO_DESIGN = 'No design loaded — load a CDL first.';
export const NO_DSPF = 'No DSPF loaded — parasitic data is unavailable. Connectivity, explain, and navigation still work.';
