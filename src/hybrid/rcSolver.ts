// Exact nodal analysis of one extracted net's parasitic resistor network —
// the DC solve SPICE would run, done directly on the conductance Laplacian.
// Nodes are the DSPF node names verbatim; capacitors hang off nodes as loads.
//
// One linear solve per query gives BOTH numbers the path report needs:
// ground the entry supernode, inject 1 A at the exit supernode, and the
// resulting node voltages v are transfer resistances — v[exit] is the
// point-to-point effective resistance, and Σ Cᵢ·vᵢ is the Elmore delay
// (first moment of the impulse response; exact for trees, still the standard
// first-order estimate for meshes).

export interface RcNet {
  idOf: Map<string, number>;
  parent: number[];                                  // union-find (0 Ω merges)
  edges: Array<[number, number, number]>;            // [a, b, conductance]
  caps: Array<[number, number]>;                     // [node, farads]
  shortedResistors: number;                          // 0 Ω / valueless, merged
}

export type RcSolve =
  | { kind: 'ok'; r: number; elmore: number; nodes: number }
  | { kind: 'open' }        // entry and exit share no resistive component
  | { kind: 'unanchored' }  // an anchor set names no node of this network
  | { kind: 'tooLarge' };   // guard tripped — refuse rather than freeze

// A component this large is a power-grid-scale mesh, not a signal net; the
// elimination could go quadratic on it, so the solver declines honestly.
const MAX_SOLVE_NODES = 40_000;

export function newRcNet(): RcNet {
  return { idOf: new Map(), parent: [], edges: [], caps: [], shortedResistors: 0 };
}

function nodeId(net: RcNet, name: string): number {
  let id = net.idOf.get(name);
  if (id === undefined) { id = net.parent.length; net.idOf.set(name, id); net.parent.push(id); }
  return id;
}

function find(parent: number[], i: number): number {
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
}

// ohms === null (parameterized value) or ≤ 0 counts as a short: dropping the
// element instead would cut the net open, which is the worse wrong answer.
export function addResistor(net: RcNet, a: string, b: string, ohms: number | null): void {
  const ia = nodeId(net, a), ib = nodeId(net, b);
  if (ohms === null || !(ohms > 0)) {
    if (find(net.parent, ia) !== find(net.parent, ib)) net.parent[find(net.parent, ia)] = find(net.parent, ib);
    net.shortedResistors++;
    return;
  }
  net.edges.push([ia, ib, 1 / ohms]);
}

export function addCap(net: RcNet, node: string, farads: number): void {
  if (farads > 0) net.caps.push([nodeId(net, node), farads]);
}

export function hasNode(net: RcNet, name: string): boolean {
  return net.idOf.has(name);
}

export function solveBetween(net: RcNet, entry: string[], exit: string[]): RcSolve {
  // Solve-local union-find: anchor sets collapse to one supernode each
  // without mutating the net (a path query must not poison the next one).
  const parent = [...net.parent];
  const uf = (i: number) => find(parent, i);
  const collapse = (names: string[]): number | null => {
    let root: number | null = null;
    for (const n of names) {
      const id = net.idOf.get(n);
      if (id === undefined) continue;
      const r = uf(id);
      if (root === null) root = r;
      else if (r !== root) { parent[r] = root; }
    }
    return root === null ? null : uf(root);
  };
  const s0 = collapse(entry);
  const e0 = collapse(exit);
  if (s0 === null || e0 === null) return { kind: 'unanchored' };
  const S = uf(s0), E = uf(e0);
  if (S === E) return { kind: 'ok', r: 0, elmore: 0, nodes: 1 };

  // Adjacency over union-find roots, parallel conductances summed, self-loops
  // (edges inside a merged supernode) dropped.
  const adj = new Map<number, Map<number, number>>();
  const at = (i: number) => { let m = adj.get(i); if (!m) adj.set(i, m = new Map()); return m; };
  for (const [a, b, g] of net.edges) {
    const ra = uf(a), rb = uf(b);
    if (ra === rb) continue;
    at(ra).set(rb, (at(ra).get(rb) ?? 0) + g);
    at(rb).set(ra, (at(rb).get(ra) ?? 0) + g);
  }

  // Restrict to the exit's resistive component (BFS). Entry outside it = open.
  const comp = new Set<number>([E]);
  const bfs = [E];
  while (bfs.length) {
    const cur = bfs.pop()!;
    for (const nb of adj.get(cur)?.keys() ?? []) {
      if (!comp.has(nb)) { comp.add(nb); bfs.push(nb); }
    }
  }
  if (!comp.has(S)) return { kind: 'open' };
  if (comp.size > MAX_SOLVE_NODES) return { kind: 'tooLarge' };

  // Reduced Laplacian: S is ground — its row/column vanish, but edges INTO S
  // stay on the neighbors' diagonals. Everything below works on dense local
  // indices over comp∖{S}.
  const idx = new Map<number, number>();
  for (const r of comp) if (r !== S) idx.set(r, idx.size);
  const n = idx.size;
  const diag = new Float64Array(n);
  const rhs = new Float64Array(n);
  const rows: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  for (const [r, i] of idx) {
    for (const [nb, g] of adj.get(r) ?? []) {
      diag[i] += g;
      if (nb !== S) rows[i].set(idx.get(nb)!, g);
    }
  }
  rhs[idx.get(E)!] = 1;

  // Symmetric sparse elimination in min-degree order. The pick uses a lazy
  // min-heap: every degree change pushes a fresh (deg, node) entry, and pops
  // discard entries that are stale or already eliminated. RC extractions are
  // tree-dominant, so fill-in stays near zero and the solve is ~linear.
  const deg = new Uint32Array(n);
  const hd: number[] = [], hn: number[] = [];
  const hpush = (d: number, i: number) => {
    let c = hd.length;
    hd.push(d); hn.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hd[p] <= hd[c]) break;
      [hd[p], hd[c]] = [hd[c], hd[p]];
      [hn[p], hn[c]] = [hn[c], hn[p]];
      c = p;
    }
  };
  const hpop = (): number => {
    const top = hn[0];
    const ld = hd.pop()!, li = hn.pop()!;
    if (hd.length) {
      hd[0] = ld; hn[0] = li;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === c) break;
        [hd[m], hd[c]] = [hd[c], hd[m]];
        [hn[m], hn[c]] = [hn[c], hn[m]];
        c = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++) { deg[i] = rows[i].size; hpush(deg[i], i); }

  type Step = { i: number; d: number; nbs: Array<[number, number]> };
  const order: Step[] = [];
  const eliminated = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    let i = -1;
    while (hd.length) {
      const d0 = hd[0], cand = hpop();
      if (!eliminated[cand] && d0 === deg[cand]) { i = cand; break; }
    }
    if (i < 0) return { kind: 'open' }; // heap dry with live nodes left — bookkeeping bug guard
    eliminated[i] = 1;

    const d = diag[i];
    if (!(d > 0)) return { kind: 'open' }; // numerically floating — treat as unsolvable
    const nbs: Array<[number, number]> = [];
    for (const [j, g] of rows[i]) if (!eliminated[j]) nbs.push([j, g]);
    order.push({ i, d, nbs });

    for (const [j, gij] of nbs) {
      rows[j].delete(i);
      const f = gij / d;
      rhs[j] += f * rhs[i];
      diag[j] -= f * gij;
      for (const [k2, gik] of nbs) {
        if (k2 === j) continue;
        const prev = rows[j].get(k2);
        rows[j].set(k2, (prev ?? 0) + f * gik);
        if (prev === undefined) deg[j]++;
      }
      deg[j]--; // lost the edge to i
      hpush(deg[j], j);
    }
    rows[i].clear();
  }

  // Back-substitution in reverse elimination order: every neighbor recorded at
  // elimination time is later in the order, so its v is already known.
  const v = new Float64Array(n);
  for (let k = order.length - 1; k >= 0; k--) {
    const { i, d, nbs } = order[k];
    let acc = rhs[i];
    for (const [j, g] of nbs) acc += g * v[j];
    v[i] = acc / d;
  }

  const r = v[idx.get(E)!];
  let elmore = 0;
  for (const [node, c] of net.caps) {
    const root = uf(node);
    if (root === S || !comp.has(root)) continue;   // grounded end or floating island
    elmore += c * v[idx.get(root)!];
  }
  return { kind: 'ok', r, elmore, nodes: comp.size };
}
