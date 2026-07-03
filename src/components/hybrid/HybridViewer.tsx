import { useEffect, useMemo } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import { useHybridStore } from '../../store/hybridStore';
import { computeSlots } from '../../hybrid/slots';
import { HierTreePanel } from './HierTreePanel';
import { HybridControls } from './HybridControls';
import { RailsCanvas } from './RailsCanvas';
import { BlockStatsCard } from './BlockStatsCard';
import { PropagationPanel } from './PropagationPanel';
import { T } from './theme';

export function HybridViewer() {
  const { design, layoutData, layoutModel } = useViewerStore();
  const { model, build, crumbs, goToCrumb, rootPath, depth, clearOverlays } = useHybridStore();

  useEffect(() => {
    if (design) build(design, layoutData, layoutModel);
  }, [design, layoutData, layoutModel, build]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearOverlays(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearOverlays]);

  const footer = useMemo(() => {
    if (!model) return { pins: 0, nets: 0, devices: 0 };
    const layout = computeSlots(model, rootPath, depth);
    let pins = 0, nets = 0, devices = 0;
    for (const p of layout.slot.keys()) {
      const b = model.blocks.get(p)!;
      pins += b.pins; nets += b.netCount; devices += b.devices;
    }
    return { pins, nets, devices };
  }, [model, rootPath, depth]);

  if (!model) return null;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: T.bg }}>
      <div style={{ padding: '6px 14px', display: 'flex', gap: 6, fontSize: 12, color: T.muted, borderBottom: `1px solid ${T.border}` }}>
        {crumbs.map((c, i) => (
          <span key={c || 'root'}>
            {i > 0 && <span style={{ margin: '0 4px' }}>/</span>}
            <span style={{ cursor: 'pointer', color: i === crumbs.length - 1 ? T.text : T.blue }}
                  onClick={() => goToCrumb(i)}>
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
      </div>
      <div style={{ background: T.panel, borderTop: `1px solid ${T.border}`, padding: '8px 18px', display: 'flex', gap: 26, fontSize: 13, color: T.text }}>
        <span>Pins <b style={{ color: T.blue }}>({footer.pins})</b></span>
        <span>Nets <b style={{ color: T.blue }}>({footer.nets})</b></span>
        <span>Devices <b style={{ color: T.blue }}>({footer.devices})</b></span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: T.muted }}>
          Pins not rendered on blocks · supplies excluded from propagation
        </span>
      </div>
    </div>
  );
}
