import type { Net } from '../parser/types';

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
