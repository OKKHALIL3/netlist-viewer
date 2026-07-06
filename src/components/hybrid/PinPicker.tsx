import { useRef, useState } from 'react';
import { T } from './theme';

// Stage-1 row of the picker: an instance a pin ref can anchor on. `ref` is
// the ORIGINAL-CASE label path ("XI_deskew_top/XD0", root = "top") — the
// same form the tree shows; resolvePinRef normalizes it to the model path.
export interface InstanceOption { ref: string; cell: string }

const ROW_CAP = 40;

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  instances: InstanceOption[];
  // Port names of the named instance's master, or null when the ref names no
  // real instance (typo / still typing).
  pinsFor: (instRef: string) => string[] | null;
}

// Guided two-stage combobox (Amr: "choose instance & then pin"): no ':' in
// the value = choosing an instance; picking one appends ':' and the list
// switches to that instance's pins. Free-typed refs stay valid — the store
// validates through resolvePinRef either way.
export function PinPicker({ label, value, onChange, instances, pinsFor }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ci = value.lastIndexOf(':');
  const stage: 'inst' | 'pin' = ci < 0 ? 'inst' : 'pin';
  const instPart = ci < 0 ? '' : value.slice(0, ci);
  const needle = (ci < 0 ? value : value.slice(ci + 1)).toLowerCase();

  const pins = stage === 'pin' ? pinsFor(instPart) : null;
  const rows =
    stage === 'inst'
      ? instances
          .filter(o => o.ref.toLowerCase().includes(needle) || o.cell.toLowerCase().includes(needle))
          .map(o => ({ text: o.ref, sub: o.cell as string | undefined, pick: `${o.ref}:`, closes: false }))
      : (pins ?? [])
          .filter(p => p.toLowerCase().includes(needle))
          .map(p => ({ text: p, sub: undefined as string | undefined, pick: `${instPart}:${p}`, closes: true }));
  const shown = rows.slice(0, ROW_CAP);
  const hiC = Math.min(hi, shown.length - 1);

  const pick = (r: { pick: string; closes: boolean }) => {
    onChange(r.pick);
    setHi(0);
    if (r.closes) setOpen(false);
    else inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && shown[hiC]) { e.preventDefault(); pick(shown[hiC]); } }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: T.muted, margin: '6px 0 2px' }}>{label} ◈</div>
      <div style={{ position: 'relative' }}>
        <input ref={inputRef} value={value}
               onChange={e => { onChange(e.target.value); setOpen(true); setHi(0); }}
               onFocus={() => setOpen(true)}
               onBlur={() => setOpen(false)}
               onKeyDown={onKeyDown}
               placeholder="instance : pin"
               style={{ width: '100%', fontSize: 12, fontFamily: T.mono, padding: '5px 6px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.panel2, color: T.text }} />
        {open && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 2,
                        background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 6,
                        maxHeight: 238, overflowY: 'auto', boxShadow: '0 8px 22px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '3px 7px', fontSize: 9.5,
                          letterSpacing: '0.5px', textTransform: 'uppercase', fontWeight: 600, color: T.faint,
                          borderBottom: `1px solid ${T.border}` }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {stage === 'inst' ? '1 · choose instance' : `2 · pin of ${instPart || 'top'}`}
              </span>
              {stage === 'pin' && (
                // mousedown beats the input's blur — same reason as the rows
                <span onMouseDown={e => { e.preventDefault(); onChange(instPart); setHi(0); }}
                      style={{ cursor: 'pointer', color: T.accent, textTransform: 'none', flexShrink: 0 }}>
                  ‹ instance
                </span>
              )}
            </div>
            {shown.map((r, i) => (
              <div key={`${r.pick}|${i}`}
                   onMouseDown={e => { e.preventDefault(); pick(r); }}
                   onMouseEnter={() => setHi(i)}
                   style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3.5px 7px', cursor: 'pointer',
                            background: i === hiC ? T.accentSoft : 'transparent' }}>
                <span title={r.text}
                      style={{ fontFamily: T.mono, fontSize: 11.5, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.text}
                </span>
                {r.sub && (
                  <span title={r.sub}
                        style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.muted, flexShrink: 0,
                                 maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.sub}
                  </span>
                )}
              </div>
            ))}
            {shown.length === 0 && (
              <div style={{ padding: '5px 7px', fontSize: 11, color: T.muted }}>
                {stage === 'pin' && pins === null ? 'Unknown instance — pick one from the list first.' : 'No matches.'}
              </div>
            )}
            {rows.length > shown.length && (
              <div style={{ padding: '3px 7px', fontSize: 10, color: T.faint }}>
                +{rows.length - shown.length} more — keep typing to narrow
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
