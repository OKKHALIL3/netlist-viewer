// Shared types + geometry helpers for the Abstract Layout Viewer.
// Bbox is always [minx, miny, maxx, maxy] in µm.
export type Bbox = [number, number, number, number];

// ---- DSPF parse output (design-agnostic) -------------------------------
export interface DspfSubnode { name: string; x: number; y: number }
export interface DspfResistor { a: string; b: string; layer: string | null }
export interface DspfNet {
  name: string;
  subnodes: DspfSubnode[];
  parasitics: number;          // count of R + C elements
  resistors: DspfResistor[];   // endpoints + layer, for the RC skeleton
}
export interface DspfDevice { path: string; x: number; y: number }
export interface LayoutData {
  divider: string;             // hierarchy separator from *|DIVIDER (e.g. "/")
  delimiter: string;           // pin separator from *|DELIMITER (e.g. ":")
  nets: DspfNet[];
  devices: DspfDevice[];       // coordinate-bearing device points
  layersPresent: boolean;
  layers: string[];            // distinct layer names, [] when none
}

// ---- Correlated, viewer-ready model ------------------------------------
export interface LayoutInstance {
  id: string;                  // normalized path, e.g. "xi9/xi26"
  label: string;               // leaf instance id as written in CDL
  depth: number;               // 0 = whole design, 1 = top children, ...
  deviceCount: number;
  bbox: Bbox;
}
export interface LayoutNet {
  name: string;
  bbox: Bbox;
  subnodes: number;
  parasitics: number;
  layers: string[];
  instances: string[];         // instance ids this net touches
}
export interface LayoutConnection {
  net: string;
  layer: string | null;
  points: Array<[number, number]>;
}
export interface LayoutModel {
  design: string;
  extent: Bbox;
  layers: string[];            // [] ⇒ no-layer mode
  instances: LayoutInstance[];
  nets: LayoutNet[];
  connections: LayoutConnection[];
  stats: { instancesMatched: number; instancesTotal: number; devicesMatched: number };
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
