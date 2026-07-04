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
    <div style={{ position: 'absolute', top: 14, right: 14, width: 248, background: T.panel, borderRadius: T.radius,
                  padding: '12px 15px', border: `1px solid ${T.border}`, boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* .insp-title convention: mono, 700 */}
        <div style={{ fontFamily: T.mono, fontWeight: 700, color: T.text, fontSize: 14, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</div>
        {b.members && (
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: T.bg, background: T.accent, borderRadius: 6, padding: '1px 6px' }}>
            ×{b.members.length}
          </span>
        )}
        <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.5px', color: T.bg, background: badgeColor,
                       borderRadius: 5, padding: '2px 7px' }}>
          {b.category ?? UNCLASSIFIED}
        </span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, margin: '2px 0 8px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {b.master}{b.domains.length ? ` · ${b.domains.join(', ')}` : ''}
      </div>
      {rows.map(([l, v]) => (
        // .kv-row / .kv-key / .kv-val convention (mono values, soft rules)
        <div key={l} className="kv-row">
          <span className="kv-key">{l}</span><span className="kv-val">{v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: T.text, padding: '8px 0 2px' }}>
        <span style={{ color: T.muted }}>Category</span>
        <select
          value={b.category ?? UNCLASSIFIED}
          onChange={e => {
            if (!design) return;
            const value = e.target.value;
            saveOverride(design.topCell, b.master, value === 'auto' ? null : value);
            reclassify();
          }}
          style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, fontFamily: T.mono, padding: '3px 5px' }}>
          <option value="auto">auto</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {!model.hasLayout && <div style={{ fontSize: 10.5, color: T.faint, marginTop: 6 }}>Load a DSPF for parasitic stats.</div>}
    </div>
  );
}
