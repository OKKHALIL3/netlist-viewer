import type { Net, Cell } from '../parser/types';

// A "floating" (dangling) net touches at most one endpoint, so it can't
// electrically connect anything — e.g. a resistor terminal wired to a net no
// other device uses, or a declared port left unconnected inside the cell.
//
// This is distinct from fanout: a pass-through port net (the __port__ endpoint
// plus one device pin = 2 endpoints) is NOT floating even though its device
// fanout is 1, because the port carries it up to the parent.
export function isFloatingNet(net: Pick<Net, 'endpoints'>): boolean {
  return net.endpoints.length <= 1;
}

const DMY_RE = /__?dmy/i;

// Why is this net dangling? auCdl netlists snake long resistors into segment
// chains whose interior nets/instances carry a "__dmy" marker, and one end of
// a matching/dummy leg is legitimately left open in the source. Distinguishing
// that from an accidental float answers "is it floating in the design itself?"
// (a real reviewer question) inside the tool.
export function classifyDangling(
  net: Pick<Net, 'name' | 'endpoints'>,
  cell?: Pick<Cell, 'primitives'>,
): 'floating' | 'dummy-leg' | null {
  if (!isFloatingNet(net)) return null;
  if (DMY_RE.test(net.name)) return 'dummy-leg';
  if (net.endpoints.some(([id]) => DMY_RE.test(id))) return 'dummy-leg';
  if (cell) {
    for (const [id] of net.endpoints) {
      const prim = cell.primitives.find(p => p.id === id);
      if (prim && prim.terms.some(([, n]) => DMY_RE.test(n))) return 'dummy-leg';
    }
  }
  return 'floating';
}
