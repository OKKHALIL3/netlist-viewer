// Shared types + geometry helpers for the Abstract Layout Viewer.
// Bbox is always [minx, miny, maxx, maxy] in µm.
export type Bbox = [number, number, number, number];

// ---- DSPF parse output (design-agnostic) -------------------------------
export interface DspfPoint { name: string; x: number | null; y: number | null; layer: string | null }

export interface DspfResistor {
  name: string; a: string; b: string;
  value: number | null;
  layer: string | null;
  x1: number | null; y1: number | null;
  x2: number | null; y2: number | null;
  width: number | null; length: number | null;
}

export interface DspfCapacitor {
  name: string; a: string; b: string;
  value: number | null;
  layer: string | null;
  x: number | null; y: number | null;
  coupling: boolean;
}

export interface DspfNet {
  name: string;
  totalCap: number | null;
  ports: DspfPoint[];
  subnodes: DspfPoint[];
  instPins: DspfPoint[];
  resistors: DspfResistor[];
  capacitors: DspfCapacitor[];
}

export interface DspfDevice { path: string; x: number; y: number }

export interface DspfDiagnostics {
  logicalLines: number; nets: number; devices: number;
  resistors: number; resistorsWithGeometry: number;
  capacitors: number; couplingCaps: number;
  pointsWithCoords: number; unitScale: number;
  unrecognized: number; warnings: string[];
}

export interface LayoutData {
  divider: string; delimiter: string; busDelimiter: string | null;
  groundNets: string[]; design: string | null; generator: string | null;
  layerMap: Record<string, string>; layersPresent: boolean; layers: string[];
  nets: DspfNet[]; devices: DspfDevice[]; diagnostics: DspfDiagnostics;
}

// ---- Correlated, viewer-ready model ------------------------------------
export interface LayoutInstance {
  id: string; label: string; depth: number; deviceCount: number; bbox: Bbox;
}
export interface LayoutNet {
  name: string; bbox: Bbox; subnodes: number; parasitics: number;
  layers: string[]; instances: string[];
}
export interface LayoutConnection {
  net: string; layer: string | null; points: Array<[number, number]>;
}
export interface LayoutModel {
  design: string; extent: Bbox; layers: string[];
  instances: LayoutInstance[]; nets: LayoutNet[]; connections: LayoutConnection[];
  stats: {
    instancesMatched: number; instancesTotal: number;
    devicesMatched: number; devicesTotal: number;
    // Breakdown of uncorrelated devices: layout-only dummies (LVS unmatched),
    // direct top-cell devices, and devices whose hierarchy path isn't in the CDL.
    devicesDummy: number; devicesTopLevel: number; devicesHierMiss: number;
  };
  // Correlation-level advisories (e.g. low/zero CDL↔DSPF match). Parse-level
  // advisories live in diagnostics.warnings.
  warnings: string[];
  diagnostics: DspfDiagnostics;
}

// ---- Geometry helpers --------------------------------------------------
export function emptyBbox(): Bbox { return [Infinity, Infinity, -Infinity, -Infinity]; }
export function extendBbox(b: Bbox, x: number, y: number): void {
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x;
  if (y > b[3]) b[3] = y;
}
export function bboxValid(b: Bbox): boolean { return b[0] <= b[2] && b[1] <= b[3]; }
export function bboxSize(b: Bbox): [number, number] { return [b[2] - b[0], b[3] - b[1]]; }
export function bboxArea(b: Bbox): number { return (b[2] - b[0]) * (b[3] - b[1]); }
export function unionInto(a: Bbox, b: Bbox): void {
  if (b[0] < a[0]) a[0] = b[0];
  if (b[1] < a[1]) a[1] = b[1];
  if (b[2] > a[2]) a[2] = b[2];
  if (b[3] > a[3]) a[3] = b[3];
}
