import { useEffect, useMemo } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import { useHybridStore, passesFilters } from '../../store/hybridStore';
import { computeSlots } from '../../hybrid/slots';
import { HierTreePanel } from './HierTreePanel';
import { HybridControls } from './HybridControls';
import { RailsCanvas } from './RailsCanvas';
import { BlockStatsCard } from './BlockStatsCard';
import { PropagationPanel } from './PropagationPanel';
import { CouplingPanel } from './CouplingPanel';
import { T } from './theme';

export function HybridViewer() {
  const { design, layoutData, layoutModel } = useViewerStore();
  const { model, build, crumbs, goToCrumb, rootPath, depth, clearOverlays, funcOff, supplyOff, version, coupling, selected } = useHybridStore();

  useEffect(() => {
    if (design) build(design, layoutData, layoutModel);
  }, [design, layoutData, layoutModel, build]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearOverlays(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearOverlays]);

  const footer = useMemo(() => {
    // Invalidate on version change when reclassify() mutates block categories
    void version;
    if (!model) return { pins: 0, nets: 0, devices: 0 };
    const layout = computeSlots(model, rootPath, depth);
    let pins = 0, nets = 0, devices = 0;
    for (const p of layout.slot.keys()) {
      const b = model.blocks.get(p)!;
      if (!passesFilters(b, funcOff, supplyOff)) continue;
      pins += b.pins; nets += b.netCount; devices += b.devices;
    }
    return { pins, nets, devices };
  }, [model, rootPath, depth, funcOff, supplyOff, version]);

  if (!model) return null;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: T.bg }}>
      {/* Same .breadcrumb/.crumb-item/.crumb-sep language as the schematic
          top-bar trail (Space Mono, dim → accent on hover, current in text). */}
      <div className="breadcrumb"
           style={{ flex: 'none', justifyContent: 'flex-start', padding: '6px 14px', borderBottom: `1px solid ${T.border}` }}>
        {crumbs.map((c, i) => (
          <span key={c || 'root'} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span className="crumb-sep">/</span>}
            <span className={`crumb-item${i === crumbs.length - 1 ? ' cur' : ''}`} onClick={() => goToCrumb(i)}>
              {model.blocks.get(c)?.label ?? c}
            </span>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        <HybridControls />
        <HierTreePanel />
        <RailsCanvas />
        <BlockStatsCard />
        <PropagationPanel />
        {coupling.on && selected && <CouplingPanel />}
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
