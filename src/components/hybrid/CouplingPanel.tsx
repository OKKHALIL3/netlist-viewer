// src/components/hybrid/CouplingPanel.tsx
import { useMemo } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { couplingFor } from '../../hybrid/coupling';
import { computeSlots } from '../../hybrid/slots';
import { T } from './theme';
import { Panel } from './HybridControls';

export function CouplingPanel() {
  const { design, layoutData, model, selected, rootPath, depth, coupling, couplingPairs } = useHybridStore();
  const layout = useMemo(
    () => (model ? computeSlots(model, rootPath, depth) : null),
    [model, rootPath, depth],
  );
  const neighbors = useMemo(() => {
    if (!coupling.on || !selected || !couplingPairs || !layoutData || !design || !model || !layout) return [];
    return couplingFor(design, model, layoutData, couplingPairs, selected, [...layout.slot.keys()], coupling.minC, coupling.includeSupply);
  }, [coupling, selected, couplingPairs, layoutData, design, model, layout]);
  if (!model || !coupling.on || selected === null) return null;
  return (
    // Sits in the right overlay rail (HybridViewer) — shrinks + scrolls internally.
    <div style={{ flex: '0 1 auto', minHeight: 96, pointerEvents: 'auto', overflowY: 'auto' }}>
      <Panel title="Coupling" subject={model.blocks.get(selected)?.label}>
        {neighbors.length === 0 && (
          <div style={{ fontSize: 11, color: T.muted }}>No coupling above threshold.</div>
        )}
        {neighbors.map(n => (
          <div key={n.block} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: T.mono, fontSize: 11.5, color: T.text, fontWeight: 700 }}>
              <span title={n.block} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.blocks.get(n.block)?.label ?? n.block}</span>
              <span style={{ flexShrink: 0, color: T.coupling }}>{(n.total * 1e15).toFixed(1)} fF</span>
            </div>
            {n.pairs.map((p, i) => (
              <div key={i} title={`${p.netA} ↔ ${p.netB}`}
                   style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, padding: '1px 0',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.netA} ↔ {p.netB} · {(p.cap * 1e15).toFixed(1)} fF
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
