import { useMemo } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { TAXONOMY } from '../../hybrid/classify';
import { T } from './theme';

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, borderRadius: 12, padding: '12px 14px', marginBottom: 12, border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function HybridControls() {
  const {
    design, model, rootPath, depth, setDepth,
    zoneColors, toggleZoneColors, sizeByContent, toggleSizeByContent,
    weights, setWeights,
    funcOff, toggleFunc, supplyOff, toggleSupply,
    pathMode, togglePathMode, startPin, endPin, setPathPins, pathResult, pathLayers,
    coupling, toggleCoupling, setCouplingMinC, toggleCouplingSupply,
  } = useHybridStore();
  const pinOptions = useMemo(
    () => (design && model
      ? [...model.blocks.values()].flatMap(b => (design.cells.get(b.master)?.ports ?? []).map(p => `${b.path}:${p.name}`))
      : []),
    [design, model],
  );
  if (!model) return null;
  const maxBelow = model.maxDepth - model.blocks.get(rootPath)!.depth;
  return (
    <div style={{ width: 244, padding: 12, overflowY: 'auto', borderRight: `1px solid ${T.border}`, background: T.bg }}>
      <Panel title="Hier depth">
        <input type="range" min={0} max={Math.max(1, maxBelow)} value={Math.min(depth, maxBelow)}
               onChange={e => setDepth(+e.target.value)} style={{ width: '100%', accentColor: T.blue }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.muted }}>
          <span>Top only</span><span>All levels</span>
        </div>
      </Panel>

      <Panel title="Display">
        <label style={{ display: 'flex', gap: 7, fontSize: 13, color: T.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={zoneColors} onChange={toggleZoneColors} style={{ accentColor: T.blue }} />
          Zone colors
        </label>
        <label style={{ display: 'flex', gap: 7, fontSize: 13, color: T.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={sizeByContent} onChange={toggleSizeByContent} style={{ accentColor: T.blue }} />
          Size by content (criticality)
        </label>
        <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>Siblings are ordered most critical first.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
          {(['dev', 'net', 'para', 'coup'] as const).map((label, i) => (
            <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.muted }}>
              {label}
              <input type="number" step={0.05} min={0} max={1} value={weights[i]}
                     onChange={e => {
                       const w = [...weights] as [number, number, number, number];
                       w[i] = +e.target.value;
                       setWeights(w);
                     }}
                     style={{ width: 48, fontSize: 12 }} />
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Functional map">
        {(Object.keys(TAXONOMY) as Array<keyof typeof TAXONOMY>).map(g => {
          const keys = TAXONOMY[g].map(c => `${g}:${c}`);
          const allOn = keys.every(k => !funcOff.has(k));
          return (
            <div key={g} style={{ marginBottom: 6 }}>
              <label style={{ display: 'flex', gap: 7, fontSize: 13, color: T.text, fontWeight: 700, cursor: 'pointer' }}>
                <input type="checkbox" checked={allOn}
                       onChange={() => keys.forEach(k => (allOn === !funcOff.has(k)) && toggleFunc(k))}
                       style={{ accentColor: T.blue }} />
                <span style={{ width: 10, height: 10, borderRadius: 3, background: T.groupColors[g], alignSelf: 'center' }} />
                {g}
              </label>
              <div style={{ marginLeft: 22, borderLeft: `2px solid ${T.border}`, paddingLeft: 8 }}>
                {keys.map(k => (
                  <label key={k} style={{ display: 'flex', gap: 7, fontSize: 12, color: T.text, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!funcOff.has(k)} onChange={() => toggleFunc(k)} style={{ accentColor: T.blue }} />
                    {k.split(':')[1]}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </Panel>

      <Panel title="Supply domain map">
        {model.supplyDomains.map(d => (
          <label key={d} style={{ display: 'flex', gap: 7, fontSize: 13, color: T.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={!supplyOff.has(d)} onChange={() => toggleSupply(d)} style={{ accentColor: T.blue }} />
            {d}
          </label>
        ))}
      </Panel>

      <Panel title="Path view">
        <label style={{ display: 'flex', gap: 7, fontSize: 13, color: T.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={pathMode} onChange={togglePathMode} style={{ accentColor: T.blue }} />
          Enable path propagation
        </label>
        {pathMode && (
          <div style={{ marginTop: 6 }}>
            {(['Start pin', 'End pin'] as const).map((label, i) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: T.muted, margin: '6px 0 2px' }}>{label} ◈</div>
                <input list="hybrid-pins" value={i ? endPin : startPin}
                       onChange={e => setPathPins(i ? startPin : e.target.value, i ? e.target.value : endPin)}
                       placeholder="block/path:pin"
                       style={{ width: '100%', fontSize: 12, padding: 4, borderRadius: 6, border: `1px solid ${T.border}`, background: T.panel2, color: T.text }} />
              </div>
            ))}
            <datalist id="hybrid-pins">
              {pinOptions.map(o => <option key={o} value={o} />)}
            </datalist>
            {pathResult && (
              <div style={{ marginTop: 10, background: T.panel2, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: T.text, border: `1px solid ${T.border}` }}>
                <div>Total net count <b style={{ color: T.path }}>⟨{pathResult.netCount}⟩</b></div>
                <div>Layers included <b style={{ color: T.path }}>⟨{pathLayers ? pathLayers.join(', ') : 'unavailable'}⟩</b></div>
              </div>
            )}
            {startPin && endPin && !pathResult && (
              <div style={{ marginTop: 8, fontSize: 12, color: T.danger }}>No signal path found (supplies excluded).</div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Coupling">
        <label style={{ display: 'flex', gap: 7, fontSize: 13, color: model.hasLayout ? T.text : T.muted, cursor: model.hasLayout ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={coupling.on} disabled={!model.hasLayout} onChange={toggleCoupling} style={{ accentColor: T.blue }} />
          Show coupling overlay
        </label>
        {!model.hasLayout && (
          <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>Load a DSPF to see coupling capacitance.</div>
        )}
        {coupling.on && (
          <div style={{ marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
              Threshold (fF)
              <input type="number" min={0} step={0.1} value={coupling.minC * 1e15}
                     onChange={e => setCouplingMinC(+e.target.value * 1e-15)}
                     style={{ width: 64, fontSize: 12 }} />
            </label>
            <label style={{ display: 'flex', gap: 7, fontSize: 13, color: T.text, cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={coupling.includeSupply} onChange={toggleCouplingSupply} style={{ accentColor: T.blue }} />
              Include supply nets
            </label>
          </div>
        )}
      </Panel>
    </div>
  );
}
