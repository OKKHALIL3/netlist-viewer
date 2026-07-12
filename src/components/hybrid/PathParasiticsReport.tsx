// src/components/hybrid/PathParasiticsReport.tsx — the parasitic block of the
// Path view card: totals (R / C / Elmore delay) solved from the DSPF, with a
// collapsible per-net breakdown. Numbers come straight from pathParasitics —
// this component only formats; anything unsolved is labeled, never zeroed.
import { useState } from 'react';
import { T } from './theme';
import type { PathParasitics, SegmentParasitics } from '../../hybrid/pathParasitics';

const ENG: Array<[number, string]> = [
  [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];
function fmtEng(v: number, unit: string): string {
  if (v === 0) return `0 ${unit}`;
  const a = Math.abs(v);
  for (const [s, p] of ENG) {
    if (a >= s * 0.9995) return `${Number((v / s).toPrecision(3))} ${p}${unit}`;
  }
  return `${Number((v / 1e-18).toPrecision(3))} a${unit}`;
}

// Why a segment has no solved R/delay — shown verbatim next to its C.
const NOTE: Record<SegmentParasitics['status'], string | null> = {
  ok: null,
  'no-r': 'no R extracted',
  'no-dspf': 'no DSPF match',
  unanchored: 'contact pins not found',
  open: 'open — no resistive route',
  'too-large': 'too large to solve',
};

function Row({ label, value, qual }: { label: string; value: string; qual?: string }) {
  return (
    <div>
      {label} <b style={{ fontFamily: T.mono, color: T.path }}>⟨{value}⟩</b>
      {qual && <span style={{ fontSize: 10, color: T.faint }}> {qual}</span>}
    </div>
  );
}

export function PathParasiticsReport({ p }: { p: PathParasitics }) {
  const [open, setOpen] = useState(false);
  const n = p.segments.length;
  if (p.matched === 0) {
    return (
      <div style={{ marginTop: 6, fontSize: 10, color: T.muted }}>
        No DSPF net matched this path — parasitics unavailable.
      </div>
    );
  }
  const solvedQual = p.solved < n ? `${p.solved} of ${n} nets` : undefined;
  const matchedQual = p.matched < n ? `${p.matched} of ${n} nets` : undefined;
  return (
    <div style={{ marginTop: 6, borderTop: `1px solid ${T.border}`, paddingTop: 6 }}>
      <Row label="Resistance" value={fmtEng(p.totalR, 'Ω')} qual={solvedQual} />
      <Row label="Capacitance" value={fmtEng(p.totalC, 'F')} qual={matchedQual} />
      <Row label="Elmore delay" value={fmtEng(p.totalElmore, 's')} qual={solvedQual} />
      <div onClick={() => setOpen(o => !o)}
           style={{ marginTop: 5, fontSize: 10, color: T.muted, cursor: 'pointer', userSelect: 'none' }}>
        {open ? '▾' : '▸'} Per-net breakdown ({n})
      </div>
      {open && p.segments.map((seg, i) => {
        const note = NOTE[seg.status];
        const vals = [
          seg.r !== null ? fmtEng(seg.r, 'Ω') : null,
          seg.c !== null ? fmtEng(seg.c, 'F') : null,
          seg.elmore !== null ? fmtEng(seg.elmore, 's') : null,
        ].filter(Boolean).join(' · ');
        return (
          <div key={i} style={{ marginTop: 3 }}>
            <div title={seg.dspfNet ?? seg.net}
                 style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, color: T.conn,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i + 1}. {seg.net}
            </div>
            <div style={{ paddingLeft: 11, fontFamily: T.mono, fontSize: 10.5, color: T.text }}>
              {vals || '—'}
              {note && <span style={{ color: T.faint }}>{vals ? ' · ' : ''}{note}</span>}
            </div>
          </div>
        );
      })}
      {/* The nets are solvable from extraction; the blocks between them are
          transistors — their delay needs device models a DSPF doesn't carry. */}
      <div style={{ marginTop: 5, fontSize: 9.5, color: T.faint }}>
        Interconnect RC only — device delay through blocks is not included.
      </div>
    </div>
  );
}
