export type PinDir = 'I' | 'O' | 'B';

export interface Port {
  name: string;
  dir: PinDir | null;
}

export interface Instance {
  id: string;
  master: string;
  conn: Record<string, string>; // pin → net (ordered by master port list)
  portMap: string[];             // ordered nets, kept for unresolved masters
  busBase?: string;
  busIndex?: number;
}

export interface Primitive {
  id: string;
  kind: 'M' | 'R' | 'C';
  model: string;
  terms: Array<[string, string]>; // [terminalName, netName]
  params: Record<string, string>;
}

export interface Net {
  name: string;
  kind: 'signal' | 'power' | 'ground';
  endpoints: Array<[string, string]>; // [nodeId, pinName]
}

export interface Cell {
  name: string;
  ports: Port[];
  instances: Instance[];
  primitives: Primitive[];
  nets: Net[];
}

export interface Design {
  cells: Map<string, Cell>;
  topCell: string;
  warnings: string[];
}

export interface ParseWarning {
  line: number;
  message: string;
}
