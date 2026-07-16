import { useViewerStore } from '../../store/viewerStore';
import { useHybridStore } from '../../store/hybridStore';
import { buildSupplyIndex } from '../../hybrid/coupling';
import { classifyNets, type NetClass } from '../queries/netClass';
import { createResolver, type Resolver } from '../resolve';
import type { Design } from '../../parser/types';
import type { HybridModel } from '../../hybrid/model';
import type { LayoutData } from '../../layout-viewer/model';
import type { ChatCtx } from './types';

// Binds the tool context to the real zustand stores. Derived indexes
// (resolver, supply set, net classes) are identity-cached: they rebuild only
// when a new design/DSPF is loaded, not on every chat turn.

interface DerivedCache {
  design: Design;
  model: HybridModel | null;
  layoutData: LayoutData | null;
  resolver: Resolver;
  netClasses: Map<string, NetClass> | null;
  supplyIdx: Set<number> | null;
}

let cache: DerivedCache | null = null;

export function makeChatCtx(): ChatCtx | null {
  const v = useViewerStore.getState();
  if (!v.design) return null;

  // Make sure the hybrid model exists even if the hybrid viewer was never
  // opened — build() is identity-cached, so this is free after the first call.
  useHybridStore.getState().build(v.design, v.layoutData, v.layoutModel);
  const h = useHybridStore.getState();

  if (!cache || cache.design !== v.design || cache.model !== h.model || cache.layoutData !== v.layoutData) {
    cache = {
      design: v.design,
      model: h.model,
      layoutData: v.layoutData,
      resolver: createResolver(v.design, h.model),
      netClasses: h.model ? classifyNets(v.design, h.model) : null,
      supplyIdx: h.model && v.layoutData ? buildSupplyIndex(v.design, h.model, v.layoutData) : null,
    };
  }

  return {
    design: v.design,
    resolver: cache.resolver,
    layoutData: v.layoutData,
    layoutModel: v.layoutModel,
    supplyIdx: cache.supplyIdx,
    netClasses: cache.netClasses,
    dspfLoaded: v.layoutData !== null,
    viewer: {
      appMode: v.appMode,
      currentCell: v.currentCell,
      breadcrumb: v.breadcrumb,
      selection: v.selection,
      goToPath: (path, selection) => useViewerStore.getState().goToPath(path, selection),
      setAppMode: mode => useViewerStore.getState().setAppMode(mode),
      readBreadcrumb: () => useViewerStore.getState().breadcrumb,
    },
    hybrid: {
      model: h.model,
      conductors: h.conductors,
      couplingPairs: h.couplingPairs,
      weights: h.weights,
      pathMode: h.pathMode,
      selected: h.selected,
      jumpToPath: path => useHybridStore.getState().jumpToPath(path),
      select: path => useHybridStore.getState().select(path),
      togglePathMode: () => useHybridStore.getState().togglePathMode(),
      setPathPins: (a, b) => useHybridStore.getState().setPathPins(a, b),
      readSelected: () => useHybridStore.getState().selected,
      readPathState: () => {
        const s = useHybridStore.getState();
        return { pathResult: s.pathResult, pathParasitics: s.pathParasitics, pathLayers: s.pathLayers, pathPinsValid: s.pathPinsValid };
      },
    },
  };
}
