import { Position } from '@xyflow/react';
import type { Primitive } from '../../parser/types';

// Real schematic symbols for leaf devices. Each symbol is drawn in its own
// pixel-space box; `slots` gives the exact (x, y) tip of every electrical
// terminal plus the React Flow side it faces, so the wire handles can be
// anchored onto the symbol instead of onto a generic box.
//
// The handle ids the rest of the app wires to are `${term}-src` / `${term}-tgt`
// (see SchematicCanvas / PrimitiveNode). The `term` keys here therefore MUST
// match the terminal names the parser emits:
//   M (transistor) → d, g, s, b      C/R → p, n      X-passive → a, b, c

export interface TermSlot {
  x: number;
  y: number;
  position: Position;
}

export interface DeviceSymbol {
  width: number;
  height: number;
  slots: Record<string, TermSlot>;
  svg: React.ReactNode;
}

// ── NMOS vs PMOS from the model name ──────────────────────────────────────
// CDL stores only the model string (e.g. "nch_18", "pfet_g5v0", "pmos_rf").
// There's no flag for polarity, so we read the conventional n-/p- prefixes
// PDKs use. Returns 'p', 'n', or null (unknown → drawn as a plain MOSFET).
export function mosPolarity(model: string): 'n' | 'p' | null {
  const m = model.toLowerCase();
  if (/(?:^|[^a-z])(?:pmos|pfet|pch|pjf|pdio|pmoscap)/.test(m)) return 'p';
  if (/(?:^|[^a-z])(?:nmos|nfet|nch|njf|ndio|nmoscap)/.test(m)) return 'n';
  // Fall back to the leading polarity letter many compact models use.
  if (/^p[a-z]*(?:fet|mos|ch|_|\d)/.test(m)) return 'p';
  if (/^n[a-z]*(?:fet|mos|ch|_|\d)/.test(m)) return 'n';
  return null;
}

const STROKE = 1.6;

// ── MOSFET (4-terminal) ───────────────────────────────────────────────────
// Vertical channel bar with the gate plate to its left; drain at the top,
// source at the bottom, bulk to the right. The substrate arrow encodes
// polarity: it points INTO the channel for NMOS, OUT for PMOS (the textbook
// 4-terminal convention).
function mosfetSymbol(polarity: 'n' | 'p' | null): DeviceSymbol {
  const W = 64;
  const H = 72;
  const chX = 40;        // channel bar x
  const midY = 36;
  // Arrow sits on the bulk lead, between channel (x=40) and bulk term (x=62).
  // Points INTO the channel for NMOS, OUT for PMOS; omitted when unknown.
  const arrow = polarity === 'n'
    ? '48,36 54,32 54,40'   // tip points left → into channel (NMOS)
    : polarity === 'p'
    ? '56,36 50,32 50,40'   // tip points right → out (PMOS)
    : null;

  return {
    width: W,
    height: H,
    slots: {
      d: { x: chX, y: 4, position: Position.Top },
      s: { x: chX, y: H - 4, position: Position.Bottom },
      g: { x: 2, y: midY, position: Position.Left },
      b: { x: W - 2, y: midY, position: Position.Right },
    },
    svg: (
      <svg width={W} height={H} className="dev-svg" fill="none" stroke="currentColor"
        strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {/* gate */}
        <line x1={2} y1={midY} x2={28} y2={midY} />
        <line x1={28} y1={18} x2={28} y2={54} />
        {/* channel */}
        <line x1={chX} y1={16} x2={chX} y2={56} strokeWidth={2.6} />
        {/* drain / source leads */}
        <line x1={chX} y1={4} x2={chX} y2={16} />
        <line x1={chX} y1={56} x2={chX} y2={H - 4} />
        {/* bulk lead + polarity arrow */}
        <line x1={chX} y1={midY} x2={W - 2} y2={midY} />
        {arrow && <polygon points={arrow} fill="currentColor" stroke="none" />}
      </svg>
    ),
  };
}

// ── Resistor (vertical zig-zag, p top / n bottom) ─────────────────────────
function resistorSymbol(thirdTerm?: string): DeviceSymbol {
  const W = 44;
  const H = 72;
  const cx = W / 2;
  const top = 14;
  const bot = 58;
  // Six-segment zig-zag between top and bot.
  const segs = 6;
  const pts: string[] = [`${cx},${top}`];
  for (let i = 0; i < segs; i++) {
    const y = top + ((i + 0.5) * (bot - top)) / segs;
    pts.push(`${i % 2 === 0 ? cx + 9 : cx - 9},${y}`);
  }
  pts.push(`${cx},${bot}`);

  const slots: Record<string, TermSlot> = {
    p: { x: cx, y: 4, position: Position.Top },
    n: { x: cx, y: H - 4, position: Position.Bottom },
  };
  if (thirdTerm) slots[thirdTerm] = { x: 4, y: H / 2, position: Position.Left };

  return {
    width: W,
    height: H,
    slots,
    svg: (
      <svg width={W} height={H} className="dev-svg" fill="none" stroke="currentColor"
        strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <line x1={cx} y1={4} x2={cx} y2={top} />
        <polyline points={pts.join(' ')} />
        <line x1={cx} y1={bot} x2={cx} y2={H - 4} />
        {thirdTerm && <line x1={4} y1={H / 2} x2={cx} y2={H / 2} />}
      </svg>
    ),
  };
}

// ── Capacitor (two plates, p top / n bottom) ──────────────────────────────
function capacitorSymbol(thirdTerm?: string): DeviceSymbol {
  const W = 44;
  const H = 72;
  const cx = W / 2;
  const p1 = 32;
  const p2 = 40;
  const plateHalf = 14;

  const slots: Record<string, TermSlot> = {
    p: { x: cx, y: 4, position: Position.Top },
    n: { x: cx, y: H - 4, position: Position.Bottom },
  };
  if (thirdTerm) slots[thirdTerm] = { x: 4, y: H / 2, position: Position.Left };

  return {
    width: W,
    height: H,
    slots,
    svg: (
      <svg width={W} height={H} className="dev-svg" fill="none" stroke="currentColor"
        strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <line x1={cx} y1={4} x2={cx} y2={p1} />
        <line x1={cx - plateHalf} y1={p1} x2={cx + plateHalf} y2={p1} strokeWidth={2.4} />
        <line x1={cx - plateHalf} y1={p2} x2={cx + plateHalf} y2={p2} strokeWidth={2.4} />
        <line x1={cx} y1={p2} x2={cx} y2={H - 4} />
        {thirdTerm && <line x1={4} y1={H / 2} x2={cx} y2={H / 2} />}
      </svg>
    ),
  };
}

// Pick the right symbol for a device. Returns null for kinds we don't have a
// symbol for (so the caller can fall back to the generic glyph box).
export function deviceSymbol(prim: Primitive): DeviceSymbol | null {
  const termNames = prim.terms.map(([t]) => t);
  if (prim.kind === 'M') return mosfetSymbol(mosPolarity(prim.model));
  // Passives may arrive as native R/C (p,n) or as X-pseudo devices (a,b,c).
  // Map the first two terminals to the symbol's top/bottom and keep any third
  // as a side tap, so every parsed terminal still gets a wire handle.
  const third = termNames.length > 2 ? termNames[2] : undefined;
  const sym = prim.kind === 'R' ? resistorSymbol(third)
    : prim.kind === 'C' ? capacitorSymbol(third)
    : null;
  if (!sym) return null;
  // For X-passives the terminal names are a/b/c, not p/n — alias them onto the
  // symbol's top/bottom slots.
  if (termNames[0] !== 'p' && termNames[0] !== 'n') {
    const { p, n, ...rest } = sym.slots;
    sym.slots = { [termNames[0]]: p, [termNames[1]]: n, ...rest } as Record<string, TermSlot>;
  }
  return sym;
}
