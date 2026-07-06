import { useEffect, useMemo } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import { useHybridStore, passesFilters } from '../../store/hybridStore';
import { visiblePaths } from '../../hybrid/slots';
import { HierTreePanel } from './HierTreePanel';
import { HybridControls } from './HybridControls';
import { RailsCanvas } from './RailsCanvas';
import { BlockStatsCard } from './BlockStatsCard';
import { PropagationPanel } from './PropagationPanel';
import { CouplingPanel } from './CouplingPanel';
import { T } from './theme';

export function HybridViewer() {
  const { design, layoutData, layoutModel } = useViewerStore();
  const { model, build, openPath, goToCrumb, clearOverlays, funcOff, supplyOff, version, coupling, selected, refreshCoupling } = useHybridStore();

  useEffect(() => {
    if (design) build(design, layoutData, layoutModel);
  }, [design, layoutData, layoutModel, build]);

  // Coupling recomputes off the render path whenever its inputs move — the
  // busy flag drives the "computing coupling…" indicators (canvas + panel).
  useEffect(() => {
    refreshCoupling();
  }, [coupling.on, coupling.minC, coupling.includeSupply, selected, openPath, version, model, refreshCoupling]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the search palette first — don't also wipe the selection.
      if (e.key === 'Escape' && !useViewerStore.getState().searchOpen) clearOverlays();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearOverlays]);

  const footer = useMemo(() => {
    // Invalidate on version change when reclassify() mutates block categories
    void version;
    if (!model) return { pins: 0, nets: 0, devices: 0 };
    let pins = 0, nets = 0, devices = 0;
    for (const p of visiblePaths(model, openPath)) {
      const b = model.blocks.get(p)!;
      if (!passesFilters(b, funcOff, supplyOff)) continue;
      pins += b.pins; nets += b.netCount; devices += b.devices;
    }
    return { pins, nets, devices };
  }, [model, openPath, funcOff, supplyOff, version]);

  if (!model) return null;
  // The crumb bar IS the open chain — clicking a crumb collapses everything
  // below that level (the clicked level's children stay on canvas).
  const crumbs = openPath.length ? openPath : [''];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: T.bg }}>
      {/* Same .breadcrumb/.crumb-item/.crumb-sep language as the schematic
          top-bar trail (Space Mono, dim → accent on hover, current in text). */}
      <div className="breadcrumb"
           style={{ flex: 'none', justifyContent: 'flex-start', padding: '6px 14px', borderBottom: `1px solid ${T.border}` }}>
        {crumbs.map((c, i) => (
          <span key={c || 'root'} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span className="crumb-sep">/</span>}
            <span className={`crumb-item${i === crumbs.length - 1 ? ' cur' : ''}`}
                  title={i === 0 ? model.blocks.get('')?.label : undefined}
                  onClick={i === crumbs.length - 1 ? undefined : () => goToCrumb(i)}>
              {i === 0 ? 'top' : (model.blocks.get(c)?.label ?? c)}
            </span>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        <HybridControls />
        <HierTreePanel />
        <RailsCanvas />
        {/* Right overlay rail: stats, coupling, and propagation stack in one
            bounded column — the two list cards shrink and scroll internally,
            so the cards can never overlap (and the rail itself never needs a
            scrollbar). pointer-events pass through the empty rail. */}
        <div style={{ position: 'absolute', top: 14, right: 14, bottom: 14, width: 260,
                      display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'none' }}>
          <BlockStatsCard />
          {coupling.on && selected && <CouplingPanel />}
          <PropagationPanel />
        </div>
      </div>
      <div style={{ background: T.panel, borderTop: `1px solid ${T.border}`, padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 26, fontSize: 12.5, color: T.text }}>
        <span>Pins <b style={{ fontFamily: T.mono, color: T.blue }}>({footer.pins})</b></span>
        <span>Nets <b style={{ fontFamily: T.mono, color: T.blue }}>({footer.nets})</b></span>
        <span>Devices <b style={{ fontFamily: T.mono, color: T.blue }}>({footer.devices})</b></span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: T.faint, fontFamily: T.mono }}>
          Pins not rendered on blocks · supplies excluded from propagation
        </span>
      </div>
    </div>
  );
}
