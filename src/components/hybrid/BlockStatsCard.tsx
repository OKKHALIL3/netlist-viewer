import { useHybridStore } from '../../store/hybridStore';
import { TAXONOMY, UNCLASSIFIED, saveOverride } from '../../hybrid/classify';
import { T } from './theme';

const fmtCap = (f: number | null) =>
  f === null ? '—' : f >= 1e-12 ? `${(f * 1e12).toFixed(2)} pF` : `${(f * 1e15).toFixed(1)} fF`;

const ALL_CATEGORIES = (Object.keys(TAXONOMY) as Array<keyof typeof TAXONOMY>)
  .flatMap(g => TAXONOMY[g].map(c => `${g}:${c}`));

export function BlockStatsCard() {
  const { model, selected, design, reclassify } = useHybridStore();
  if (!model || selected === null) return null;
  const b = model.blocks.get(selected);
  if (!b) return null;
  const rows: Array<[string, string]> = [
    ...(b.members ? [['Array size', `${b.members.length} instances`] as [string, string]] : []),
    ['Devices', String(b.devices)],
    ['Parasitic R', b.parasiticR === null ? '—' : String(b.parasiticR)],
    ['Parasitic C', b.parasiticC === null ? '—' : String(b.parasiticC)],
    ['Coupling C', fmtCap(b.couplingC)],
    ['Pins', `${b.pins} (${b.pinRoles.signal} sig · ${b.pinRoles.supply} sup · ${b.pinRoles.control} ctl)`],
    ['Children', String(b.children.length)],
  ];
  const group = b.category && b.category !== UNCLASSIFIED ? b.category.split(':')[0] : null;
  const badgeColor = group ? T.groupColors[group] : T.unclass;
  return (
    <div style={{ position: 'absolute', top: 14, right: 14, width: 240, background: T.panel, borderRadius: 12,
                  padding: '12px 16px', border: `1px solid ${T.border}`, boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>{b.label}</div>
        {b.members && (
          <span style={{ fontSize: 10, fontWeight: 700, color: T.bg, background: T.accent, borderRadius: 6, padding: '1px 6px' }}>
            ×{b.members.length}
          </span>
        )}
        <span style={{ fontSize: 10, fontWeight: 700, color: T.bg, background: badgeColor,
                       borderRadius: 4, padding: '1px 6px' }}>
          {b.category ?? UNCLASSIFIED}
        </span>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
        {b.master}{b.domains.length ? ` · ${b.domains.join(', ')}` : ''}
      </div>
      {rows.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.text, padding: '2px 0' }}>
          <span style={{ color: T.muted }}>{l}</span><span>{v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: T.text, padding: '4px 0 2px' }}>
        <span style={{ color: T.muted }}>Category</span>
        <select
          value={b.category ?? UNCLASSIFIED}
          onChange={e => {
            if (!design) return;
            const value = e.target.value;
            saveOverride(design.topCell, b.master, value === 'auto' ? null : value);
            reclassify();
          }}
          style={{ background: T.card, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 11, padding: '2px 4px' }}>
          <option value="auto">auto</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {!model.hasLayout && <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>Load a DSPF for parasitic stats.</div>}
    </div>
  );
}
