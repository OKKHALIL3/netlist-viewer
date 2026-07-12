import { useMemo, useState } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { TAXONOMY } from '../../hybrid/classify';
import { displayPath } from '../../hybrid/model';
import { normSeg } from '../../layout-viewer/correlate';
import { T } from './theme';
import { PinPicker, type InstanceOption } from './PinPicker';
import { PathParasiticsReport } from './PathParasiticsReport';

// Display names for the taxonomy groups — category keys stay 'A:AMP'
// style everywhere (store, overrides, zone colors).
const GROUP_LABELS: Record<keyof typeof TAXONOMY, string> = { A: 'Analog', D: 'Digital', AMS: 'AMS' };

// `subject` renders verbatim in mono next to the uppercase title — instance
// ids are case-significant and must never be uppercased by styling.
export function Panel({ title, subject, children }: { title: string; subject?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, borderRadius: T.radius, padding: '12px 14px', marginBottom: 12, border: `1px solid ${T.border}` }}>
      {/* .sub-h convention: 10px uppercase, 1px tracking, faint, 600 */}
      <div title={subject ? `${title} ${subject}` : undefined}
           style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, fontSize: 10, fontWeight: 600,
                    letterSpacing: '1px', textTransform: 'uppercase', color: T.faint, marginBottom: 8 }}>
        <span style={{ flexShrink: 0 }}>{title}</span>
        {subject && (
          <span style={{ textTransform: 'none', letterSpacing: 0, fontFamily: T.mono, fontSize: 10.5, color: T.muted,
                         minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subject}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function HybridControls() {
  const {
    design, model,
    funcOff, toggleFunc, supplyOff, toggleSupply,
    pathMode, togglePathMode, startPin, endPin, setPathPins, pathResult, pathLayers, pathParasitics, pathPinsValid,
    coupling, toggleCoupling, setCouplingMinC, toggleCouplingSupply,
  } = useHybridStore();
  // Functional-map groups start collapsed — expansion is view state,
  // not filter state, so it lives here rather than in the store.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // Stage-1 list for the pin pickers, built only while Path view is on and
  // capped so the dropdown source can't grow unbounded on hpio-scale designs.
  // Refs are original-case label paths (what the tree shows); labelPath walks
  // the REAL parent chain so children of array representatives anchor on a
  // typable real path (the group path itself has no blocks-map subtree).
  const INSTANCE_CAP = 4000;
  const instances = useMemo(
    () => {
      if (!pathMode || !design || !model) return [];
      const memo = new Map<string, string>([['', '']]);
      const labelPath = (p: string): string => {
        const hit = memo.get(p);
        if (hit !== undefined) return hit;
        const b = model.blocks.get(p)!;
        const pl = b.parent === null ? '' : labelPath(b.parent);
        const lp = pl ? `${pl}/${b.label}` : b.label;
        memo.set(p, lp);
        return lp;
      };
      const out: InstanceOption[] = [{ ref: 'top', cell: design.topCell }];
      for (const b of model.blocks.values()) {
        if (out.length >= INSTANCE_CAP) break;
        // display-reachable blocks only: array members (and non-representative
        // subtrees) would flood the list with duplicate instances
        if (b.path === '' || displayPath(model, b.path) !== b.path) continue;
        // master stacks have synthetic '#' paths and prefix labels — not a
        // typable pin scope; expand the stack to path through one member
        if (b.path.split('/').pop()!.startsWith('#')) continue;
        out.push({ ref: labelPath(b.path), cell: b.master });
      }
      return out;
    },
    [pathMode, design, model],
  );
  const pinsFor = (instRef: string): string[] | null => {
    if (!design || !model) return null;
    let cellName: string | undefined;
    if (instRef === '' || instRef.toLowerCase() === 'top') cellName = design.topCell;
    else {
      const p = instRef.split('/').map(s => normSeg(s) || s.toLowerCase()).join('/');
      cellName = model.blocks.get(p)?.master;
    }
    const cell = cellName ? design.cells.get(cellName) : undefined;
    return cell ? cell.ports.map(p => p.name) : null;
  };
  if (!model) return null;
  return (
    <div style={{ width: 244, padding: 12, overflowY: 'auto', borderRight: `1px solid ${T.border}`, background: T.bg }}>
      {/* The "Hier depth" expand-all slider was removed — depth follows the
          open chain on the canvas itself (double-click opens the level
          below; the rest stays collapsed). */}
      {/* The "Display" tuning card (zone-color / criticality-sizing toggles +
          weight inputs) was removed — zone colors and criticality
          sizing/ordering stay on with default weights. */}
      <Panel title="Functional map">
        {(Object.keys(TAXONOMY) as Array<keyof typeof TAXONOMY>).map(g => {
          const keys = TAXONOMY[g].map(c => `${g}:${c}`);
          const allOn = keys.every(k => !funcOff.has(k));
          const someOn = keys.some(k => !funcOff.has(k));
          const open = openGroups.has(g);
          return (
            <div key={g} style={{ marginBottom: 6 }}>
              {/* Collapsed by default: checkbox toggles the whole group;
                  name/chevron expands the subcategory list. Indeterminate =
                  partially off, so the collapsed row can't hide a mixed state. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <input type="checkbox" checked={allOn}
                       ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                       onChange={() => keys.forEach(k => (allOn === !funcOff.has(k)) && toggleFunc(k))}
                       style={{ accentColor: T.blue, cursor: 'pointer' }} />
                <span style={{ width: 10, height: 10, borderRadius: 3, background: T.groupColors[g], flexShrink: 0 }} />
                <span onClick={() => setOpenGroups(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })}
                      style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                               fontSize: 13, color: T.text, fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}>
                  {GROUP_LABELS[g]}
                  <span style={{ fontSize: 10, color: T.muted }}>{open ? '▾' : '▸'}</span>
                </span>
              </div>
              {open && (
                <div style={{ marginLeft: 22, borderLeft: `2px solid ${T.border}`, paddingLeft: 8 }}>
                  {keys.map(k => (
                    <label key={k} style={{ display: 'flex', gap: 7, fontSize: 12, color: T.text, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!funcOff.has(k)} onChange={() => toggleFunc(k)} style={{ accentColor: T.blue }} />
                      {k.split(':')[1]}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Panel>

      <Panel title="Supply domain map">
        {model.supplyDomains.map(d => (
          <label key={d} style={{ display: 'flex', gap: 7, fontSize: 12, color: T.text, cursor: 'pointer', fontFamily: T.mono }}>
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
              <PinPicker key={label} label={label} value={i ? endPin : startPin}
                         onChange={v => setPathPins(i ? startPin : v, i ? v : endPin)}
                         instances={instances} pinsFor={pinsFor} />
            ))}
            {pathResult && (
              <div style={{ marginTop: 10, background: T.panel2, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: T.text, border: `1px solid ${T.border}` }}>
                <div>Total net count <b style={{ fontFamily: T.mono, color: T.path }}>⟨{pathResult.netCount}⟩</b></div>
                <div>Layers included <b style={{ fontFamily: T.mono, color: T.path }}>⟨{pathLayers ? pathLayers.join(', ') : 'unavailable'}⟩</b></div>
                {pathParasitics
                  ? <PathParasiticsReport p={pathParasitics} />
                  : <div style={{ marginTop: 6, fontSize: 10, color: T.muted }}>Load a DSPF to see path parasitics.</div>}
              </div>
            )}
            {pathPinsValid && !pathResult && (
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
              <input type="number" min={0} step={0.1} value={+(coupling.minC * 1e15).toFixed(3)}
                     onChange={e => setCouplingMinC(+e.target.value * 1e-15)}
                     style={{ width: 64, fontSize: 12, fontFamily: T.mono, padding: '3px 5px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.panel2, color: T.text }} />
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
