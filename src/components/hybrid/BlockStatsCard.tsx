import { useHybridStore } from '../../store/hybridStore';
import { T } from './theme';

const fmtCap = (f: number | null) =>
  f === null ? '—' : f >= 1e-12 ? `${(f * 1e12).toFixed(2)} pF` : `${(f * 1e15).toFixed(1)} fF`;

export function BlockStatsCard() {
  const { model, selected } = useHybridStore();
  if (!model || selected === null) return null;
  const b = model.blocks.get(selected);
  if (!b) return null;
  const rows: Array<[string, string]> = [
    ['Devices', String(b.devices)],
    ['Parasitic R', b.parasiticR === null ? '—' : String(b.parasiticR)],
    ['Parasitic C', b.parasiticC === null ? '—' : String(b.parasiticC)],
    ['Coupling C', fmtCap(b.couplingC)],
    ['Pins', `${b.pins} (${b.pinRoles.signal} sig · ${b.pinRoles.supply} sup · ${b.pinRoles.control} ctl)`],
    ['Children', String(b.children.length)],
  ];
  return (
    <div style={{ position: 'absolute', top: 14, right: 14, width: 240, background: T.panel, borderRadius: 12,
                  padding: '12px 16px', border: `1px solid ${T.border}`, boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
      <div style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>{b.label}</div>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
        {b.master}{b.domains.length ? ` · ${b.domains.join(', ')}` : ''}
      </div>
      {rows.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.text, padding: '2px 0' }}>
          <span style={{ color: T.muted }}>{l}</span><span>{v}</span>
        </div>
      ))}
      {!model.hasLayout && <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>Load a DSPF for parasitic stats.</div>}
    </div>
  );
}
